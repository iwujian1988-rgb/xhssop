import type { ProductId } from '@/types/data';
import type { EvidenceSnippet } from '@/types/reference-workflow';
import { countVisibleUnits, type ContentPackage, type TemplateCapability, type TopicOption } from './contracts';

export interface PublishIssue {
  code: string;
  message: string;
  path?: string;
}

export interface PublishInspection {
  content: ContentPackage;
  hardIssues: PublishIssue[];
  warnings: string[];
}

const RELEASE_BLOCKING_ISSUES = new Set([
  'cover_density_below_contract',
  'cover_group_underfilled',
  'inner_pages_too_few',
  'false_product_form',
  'fabricated_authority',
  'unsupported_exam_consequence',
]);

export function isReleaseBlockingIssue(issue: PublishIssue) {
  return RELEASE_BLOCKING_ISSUES.has(issue.code);
}

export function issueAsWarning(issue: PublishIssue) {
  return `${issue.message}${issue.path ? `（${issue.path}）` : ''}`;
}

const FREE_CTA = /(?:私信|评论区|留言).{0,8}(?:领取|发你|获取)|免费(?:领|送)|回复.{0,6}(?:领取|获取)/i;
const RISKY_EXAM_FACT = /(?:评分标准|考官.{0,8}(?:扣分|评分)|官方.{0,12}(?:评分标准|(?:要求|规定).{0,10}\d+)|(?:至少|考试|题目|总时长|包含|共).{0,20}\d+.{0,10}(?:题|词|字|分钟|小时|部分|科|项|练习|天|分)|\d+\s*(?:道|个)?(?:题|词|分钟|小时|部分|科).{0,12}(?:考试|要求|必须|至少))/i;
const UNSUPPORTED_EXAM_CONSEQUENCE = /(?:少于|不够|没到).{0,12}\d+.{0,8}(?:扣分|影响得分|直接0分)|(?:每错|逐项).{0,12}扣.{0,5}分/i;
const RISKY_PRODUCT_FACT = /(?:知识库|资料包|资料|范文|句型|词汇|观点|清单).{0,24}(?:共|包含|涵盖|收录|整理|有).{0,10}\d+|\d+.{0,10}(?:篇|条|份|套|个).{0,10}(?:范文|句型|词汇|观点|表达|资料|模板|清单)|\d+\s*(?:expressions?|mod[eè]les?)/i;
const FALSE_PRODUCT_FORM = /(?:课程|网课|一对一|老师批改|直播课|无限答疑)/i;
const FAKE_AUTHORITY = /(?:一项|有项|相关)?研究表明|数据显示|调查显示|考官(?:透露|表示|说)/i;
const UNSUPPORTED_LEARNING_NUMBER = /(?:每(?:一)?段|一段).{0,24}(?:80|100|120|150|200)\s*词|(?:很多|多数|大部分)考生.{0,20}\d+\s*词/i;
const INTERNAL_SOURCE_ID = /\b(?:OFF-[A-Z-]+-\d{2,4}|[A-Z]{2,5}-\d{2,4})(?:\s*[~～—–]\s*(?:[A-Z]{2,5}-)?\d{2,4})?\b/i;
const AI_CLICHE = /不是.{0,24}而是|真正的(?:原因|问题)|建议收藏|这一页最值得/i;
const EXAM_FACT_DISCLAIMER = /(?:(?:不代表|不等于|并非|不是).{0,8}(?:官方)?评分标准|非(?:官方)?评分标准)/i;
const WORD_COUNT_TRANSFORMATION = /从\s*(\d+)\s*词?.{0,8}(?:到|扩到|写到)\s*(\d+)\s*词?/i;
const PADDING_BY_PARAPHRASE = /用不同表达方式展开同一观点|反复(?:阐述|表达).{0,10}(?:同一|一个)观点|(?:换用|改用).{0,18}(?:再谈一次|再说一次)/i;
const OVERSIMPLIFIED_EXAM_CHOICE = /(?:擅长|喜欢|偏好|不擅长|害怕|长篇论证|短小精悍|反应快|不怕即兴).{0,32}(?:TEF|TCF).{0,18}(?:更适合|就选|更合拍|发挥空间)|(?:TEF|TCF).{0,32}(?:更适合你|直接选|更合拍|发挥空间)/i;

export function inspectForPublish(
  original: ContentPackage,
  input: { productId: ProductId; topic: TopicOption; capability: TemplateCapability; evidence: EvidenceSnippet[] },
): PublishInspection {
  const content = structuredClone(original);
  const hardIssues: PublishIssue[] = [];
  const warnings: string[] = [];
  applyPaidProductBridge(content, input.productId);
  fitCaptionLength(content);
  removeKnownAiCliches(content);
  ensureSeoOpening(content, input.topic);
  normalizeIncompleteEnumerations(content, warnings);
  fitDirectoryCoverItems(content, input.capability, warnings);
  removeVisibleSourceIds(content, warnings);

  const caption = captionText(content);
  const captionUnits = countVisibleUnits(caption);
  if (captionUnits < 280) hardIssues.push(issue('caption_too_short', `正文只有 ${captionUnits} 字，至少需要 280 字`, 'captionParts'));
  if (captionUnits > 850) hardIssues.push(issue('caption_too_long', `正文有 ${captionUnits} 字，超过 850 字`, 'captionParts'));
  if (!normalize(caption.slice(0, 100)).includes(normalize(input.topic.seo.primary))) {
    hardIssues.push(issue('seo_missing_from_opening', '正文前 100 字没有自然出现主搜索词', 'captionParts.opening'));
  }
  if (FREE_CTA.test(caption)) hardIssues.push(issue('free_cta_conflicts_with_paid_product', '付费商品笔记仍在引导免费领取或私信领取', 'captionParts'));
  if (content.captionParts.value.length < 3) hardIssues.push(issue('caption_value_too_thin', '正文干货段少于 3 段', 'captionParts.value'));
  content.captionParts.value.forEach((paragraph, index) => {
    const units = countVisibleUnits(paragraph);
    if (units < 35) hardIssues.push(issue('caption_paragraph_too_thin', `第 ${index + 1} 段只有 ${units} 字，像提纲而不是正文`, `captionParts.value[${index}]`));
  });
  if (content.innerPages.length < 2) hardIssues.push(issue('inner_pages_too_few', '内页少于 2 页', 'innerPages'));

  const compact = input.capability.densityTiers[0];
  const validBlocks = content.coverBlocks.filter(block => input.capability.acceptedBlockKinds.includes(block.kind));
  const fittingBlocks = validBlocks
    .map(block => ({
      block,
      items: block.items.filter(item => (
        countVisibleUnits(item.primary) <= compact.primaryVisualLength[1]
        && countVisibleUnits(item.secondary || '') <= compact.secondaryVisualLength[1]
      )),
    }))
    .filter(entry => entry.items.length > 0);
  const totalItems = fittingBlocks.reduce((sum, entry) => sum + entry.items.length, 0);
  const minimumItems = compact.sectionRange[0] * compact.itemRange[0];
  if (fittingBlocks.length < compact.sectionRange[0] || totalItems < minimumItems) {
    hardIssues.push(issue('cover_density_below_contract', `封面编译后只有 ${fittingBlocks.length} 组 ${totalItems} 条完整短条目，模板至少需要 ${compact.sectionRange[0]} 组 ${minimumItems} 条`, 'coverBlocks'));
  }
  const underfilledBlocks = fittingBlocks.filter(entry => entry.items.length < compact.itemRange[0]);
  if (underfilledBlocks.length > Math.floor(fittingBlocks.length / 2)) {
    hardIssues.push(issue('cover_group_underfilled', '超过一半的封面分组在移出长解释后条目不足', 'coverBlocks'));
  }
  for (const [blockIndex, block] of validBlocks.entries()) {
    for (const [itemIndex, item] of block.items.entries()) {
      if (countVisibleUnits(item.primary) > compact.primaryVisualLength[1]) warnings.push(`封面长主条目将转入内页：coverBlocks[${blockIndex}].items[${itemIndex}].primary`);
      if (item.secondary && countVisibleUnits(item.secondary) > compact.secondaryVisualLength[1]) warnings.push(`封面长副条目将转入内页：coverBlocks[${blockIndex}].items[${itemIndex}].secondary`);
    }
  }

  const evidenceById = new Map(input.evidence.map(item => [item.id, item]));
  const invalidClaimIndexes = new Set<number>();
  for (const [index, claim] of content.factualClaims.entries()) {
    if (claim.type !== 'product' && claim.type !== 'exam') continue;
    const sources = claim.sourceIds.map(id => evidenceById.get(id)).filter((item): item is EvidenceSnippet => Boolean(item));
    if (!sources.length) {
      invalidClaimIndexes.add(index);
      warnings.push(`已丢弃无有效证据的内部事实声明：${claim.text.slice(0, 40)}`);
      continue;
    }
    const support = normalize(sources.map(item => `${item.text} ${item.evidence}`).join(' '));
    if (claim.type === 'exam' && !sources.some(item => item.category === 'official_exam_fact')) {
      invalidClaimIndexes.add(index);
      warnings.push(`已丢弃未引用官方事实卡的考试声明：${claim.text.slice(0, 40)}`);
    }
    const missingNumbers = numericTokens(claim.text).filter(token => !support.includes(normalize(token)));
    if (missingNumbers.length) {
      invalidClaimIndexes.add(index);
      warnings.push(`已丢弃数字无证据的内部事实声明：${claim.text.slice(0, 40)}`);
    }
  }
  if (invalidClaimIndexes.size) content.factualClaims = content.factualClaims.filter((_, index) => !invalidClaimIndexes.has(index));

  sanitizeUnsupportedPracticeFacts(content, evidenceById);

  const productBridge = content.captionParts.productBridge;
  const productEvidence = input.evidence.filter(item => item.category !== 'official_exam_fact');
  const fallbackAsset = productEvidence
    .slice()
    .sort((left, right) => conversionAssetRank(left.category) - conversionAssetRank(right.category))[0];
  if (fallbackAsset && /这套(?:资料库|知识库|资料包)里的[“\"]/.test(content.captionParts.productBridge)) {
    content.captionParts.productBridge = fitCompleteText(naturalProductBridge(fallbackAsset.text, input.productId), 105);
    warnings.push('商品承接已从内部证据引语改成面向用户的自然说明');
  }
  const groundedProductClaims = content.factualClaims.filter(claim => claim.type === 'product' && claim.sourceIds.some(id => productEvidence.some(item => item.id === id)));
  const bridgeHasProductIdentity = /(?:知识库|资料包|商品|资料库|这套.{0,6}资料|资料中的)/i.test(productBridge);
  const bridgeHasConcreteAsset = productEvidence.some(item => sharedBigrams(normalize(productBridge), normalize(`${item.text} ${item.evidence}`)) >= 3)
    || groundedProductClaims.some(claim => sharedBigrams(normalize(productBridge), normalize(claim.text)) >= 2);
  if (!bridgeHasProductIdentity || !bridgeHasConcreteAsset) {
    if (fallbackAsset) {
      content.captionParts.productBridge = fitCompleteText(naturalProductBridge(fallbackAsset.text, input.productId), 105);
      if (!content.factualClaims.some(claim => claim.type === 'product' && claim.sourceIds.includes(fallbackAsset.id))) {
        content.factualClaims.push({ text: fallbackAsset.text, type: 'product', sourceIds: [fallbackAsset.id] });
      }
      warnings.push(`商品承接已自动落到证据资产：${fallbackAsset.text}`);
    } else {
      hardIssues.push(issue('product_bridge_not_grounded', '商品承接没有落到本次证据中的具体资料资产', 'captionParts.productBridge'));
    }
  }

  if (input.productId === 'tef_tcf_canada' && OVERSIMPLIFIED_EXAM_CHOICE.test(content.captionParts.productBridge) && fallbackAsset) {
    content.captionParts.productBridge = fitCompleteText(
      `这套资料库里的“${fallbackAsset.text}”，可以接着本篇对照两种考试的任务和备考安排；报名前仍按目标项目认可范围和官方样题决定。`,
      105,
    );
    if (!content.factualClaims.some(claim => claim.type === 'product' && claim.sourceIds.includes(fallbackAsset.id))) {
      content.factualClaims.push({ text: fallbackAsset.text, type: 'product', sourceIds: [fallbackAsset.id] });
    }
    warnings.push('商品承接中的武断选考建议已自动改成中性决策动作');
  }

  for (const entry of publicTextEntries(content)) {
    if (claimsUnavailableProductForm(entry.text, entry.path)) hardIssues.push(issue('false_product_form', `知识库/资料包被写成了不存在的课程或服务：${entry.text.slice(0, 80)}`, entry.path));
    if (FAKE_AUTHORITY.test(entry.text)) hardIssues.push(issue('fabricated_authority', `内容引用了未提供证据的研究、数据或考官说法：${entry.text.slice(0, 80)}`, entry.path));
    if (UNSUPPORTED_LEARNING_NUMBER.test(entry.text)) {
      const officialClaims = content.factualClaims.filter(claim => claim.type === 'exam');
      const supported = isFactSupportedByCombinedSources(entry.text, officialClaims, evidenceById, true);
      if (!supported) hardIssues.push(issue('unsupported_learning_number', `内容编造了没有依据的段落字数或人群统计：${entry.text.slice(0, 80)}`, entry.path));
    }
    if (INTERNAL_SOURCE_ID.test(entry.text)) hardIssues.push(issue('internal_source_id_visible', `用户可见内容出现内部资料编号：${entry.text.slice(0, 80)}`, entry.path));
    if (AI_CLICHE.test(entry.text)) hardIssues.push(issue('ai_cliche_visible', `用户可见内容仍有明显AI套话：${entry.text.slice(0, 80)}`, entry.path));
    if (PADDING_BY_PARAPHRASE.test(entry.text)) hardIssues.push(issue('content_padding_by_paraphrase', `把重复改写同一观点误当成扩写方法：${entry.text.slice(0, 80)}`, entry.path));
    const oversimplifiedChoice = OVERSIMPLIFIED_EXAM_CHOICE.test(entry.text);
    if (oversimplifiedChoice) hardIssues.push(issue('oversimplified_exam_choice', `用单一强弱项武断推荐TEF或TCF：${entry.text.slice(0, 80)}`, entry.path));
    const transformation = WORD_COUNT_TRANSFORMATION.exec(entry.text);
    if (transformation) {
      const target = Number(transformation[2]);
      const hasCompleteExample = content.innerPages.some(page => countFrenchWords([page.lead, ...page.bullets].join(' ')) >= target);
      if (!hasCompleteExample) hardIssues.push(issue('word_count_transformation_without_full_example', `承诺扩写到${target}词，但内页没有一篇达到该词数的完整法语示例`, entry.path));
    }
    if (UNSUPPORTED_EXAM_CONSEQUENCE.test(entry.text)) {
      const support = normalize(input.evidence.filter(item => item.category === 'official_exam_fact').map(item => `${item.text} ${item.evidence}`).join(' '));
      if (!/(扣分|影响得分|0分)/.test(support)) hardIssues.push(issue('unsupported_exam_consequence', `把最低要求外推成扣分结果：${entry.text.slice(0, 80)}`, entry.path));
    }
    if (oversimplifiedChoice) continue;
    const isProductRisk = RISKY_PRODUCT_FACT.test(entry.text);
    const isExamRisk = !isProductRisk && isExamFactRisk(entry.text);
    if (!isExamRisk && !isProductRisk) continue;
    if (!numericTokens(entry.text).length && EXAM_FACT_DISCLAIMER.test(entry.text)) continue;
    const relevantClaims = content.factualClaims.filter(claim => claim.type === (isExamRisk ? 'exam' : 'product'));
    if (!isExamRisk && sourceBoundProductFactSupported(entry.text, entry.sourceIds || [], relevantClaims, evidenceById)) continue;
    const pathSourcesSupport = factSupportedByPathSources(entry.text, entry.sourceIds || [], evidenceById, isExamRisk);
    // A sentence may combine an official exam fact with a product checklist
    // fact. Explicit path sources are strong enough to validate both claim
    // types together without weakening checks for unbound public text.
    const pathClaimSupport = factRegisteredByPathClaim(entry.text, entry.sourceIds || [], content.factualClaims, evidenceById, isExamRisk);
    const registered = pathSourcesSupport || pathClaimSupport || (isExamRisk
      ? isFactSupportedByCombinedSources(entry.text, relevantClaims, evidenceById, true)
      : relevantClaims.some(claim => textOverlaps(entry.text, claim.text))
        || isFactSupportedByCombinedSources(entry.text, relevantClaims, evidenceById, false));
    if (!registered) {
      const code = isExamRisk ? 'unsupported_exam_fact' : 'risky_fact_not_registered';
      const label = isExamRisk ? '考试事实与官方事实卡不一致' : '商品数字事实尚未登记核对';
      hardIssues.push(issue(code, `${label}：${entry.text.slice(0, 80)}`, entry.path));
    }
  }

  if (/[，。！？；：]{2,}/u.test(caption)) hardIssues.push(issue('broken_punctuation', '正文存在连续标点', 'captionParts'));
  return { content, hardIssues: dedupeIssues(hardIssues), warnings };
}

function sourceBoundProductFactSupported(
  text: string,
  sourceIds: string[],
  claims: ContentPackage['factualClaims'],
  evidenceById: Map<string, EvidenceSnippet>,
) {
  const pathIds = new Set(sourceIds);
  const matched = claims.filter(claim => claim.sourceIds.some(id => pathIds.has(id)));
  if (!matched.length) return false;
  const sources = sourceIds.map(id => evidenceById.get(id)).filter((item): item is EvidenceSnippet => Boolean(item));
  const support = normalize([...matched.map(claim => claim.text), ...sources.map(item => `${item.text} ${item.evidence}`)].join(' '));
  return numericTokens(text).every(token => support.includes(normalize(token)));
}

function conversionAssetRank(category: EvidenceSnippet['category']) {
  const order = ['displayable_assets', 'knowledge_assets', 'raw_selling_points', 'content_modules', 'use_cases'];
  const rank = order.indexOf(category);
  return rank === -1 ? order.length : rank;
}

function applyPaidProductBridge(content: ContentPackage, productId: ProductId) {
  const raw = content.captionParts.productBridge.replace(FREE_CTA, '').trim();
  const existing = FALSE_PRODUCT_FORM.test(raw) ? '' : raw;
  content.captionParts.productBridge = existing || (productId === 'delf_b2_writing'
    ? '我把写作里反复要查的范文、词汇句型、观点和自查项整理成了一套 DELF B2 写作知识库，练习时可以按自己的问题直接查。'
    : '我把选考、自测、四科练习、句型词汇和备考安排整理成了一套 TEF/TCF Canada 资料库，复习时可以按当前阶段直接查。');
  content.captionParts.cta = '完整内容已经放在商品里，需要的话可以点小黄车看详情。';
}

function fitCaptionLength(content: ContentPackage) {
  content.captionParts.opening = fitCompleteText(content.captionParts.opening, 85);
  content.captionParts.value = content.captionParts.value.map(item => fitCompleteText(item, 115)).filter(Boolean);
  const nonSellingValue = content.captionParts.value.filter(item => !/(?:资料包|知识库|资料库|小黄车|商品)/i.test(item));
  if (nonSellingValue.length >= 3) content.captionParts.value = nonSellingValue;
  const substantial = content.captionParts.value.filter(item => countVisibleUnits(item) >= 35);
  if (substantial.length >= 3) content.captionParts.value = substantial;
  content.captionParts.productBridge = fitCompleteText(content.captionParts.productBridge, 105);
  while (content.captionParts.value.length > 3 && countVisibleUnits(captionText(content)) > 850) content.captionParts.value.pop();
  if (countVisibleUnits(captionText(content)) > 850) {
    content.captionParts.value = content.captionParts.value.map(item => fitCompleteText(item, 95));
  }
}

function naturalProductBridge(assetText: string, productId: ProductId) {
  const cleanAsset = cleanVisibleSourceReferences(assetText).replace(/[。！？!?]+$/u, '').trim();
  if (productId === 'tef_tcf_canada' && /TEF\s*\/?\s*TCF|选考|考试选择/i.test(cleanAsset)) {
    return '这套 TEF/TCF Canada 资料库先整理了选考决策，确定考试后还可以按当前阶段继续查自测、练习和备考安排。';
  }
  return `这套知识库整理了“${cleanAsset}”，练习到相关问题时可以直接按这一项继续查。`;
}

function removeKnownAiCliches(content: ContentPackage) {
  const cleanValue = (value: string) => value
    .replace(/第一步不是[^，。！？；]{1,30}[，,]\s*而是/g, '第一步')
    .replace(/选考不是凭感觉[，,]\s*而是基于目标和任务差异的理性决策。?/g, '选考时要一起看目标项目和任务差异。')
    .replace(/[^。！？]{0,20}不是[^，。！？]{1,35}[，,]\s*而是/g, '')
    .replace(/真正的(?:原因|问题)是/g, '更常见的是')
    .replace(/建议收藏/g, '需要时直接对照');
  content.innerPages = content.innerPages.map(page => ({
    ...page,
    lead: cleanValue(page.lead),
    bullets: page.bullets.map(cleanValue),
  }));
  content.captionParts.opening = cleanValue(content.captionParts.opening);
  content.captionParts.value = content.captionParts.value.map(cleanValue);
  content.captionParts.productBridge = cleanValue(content.captionParts.productBridge);
}

function ensureSeoOpening(content: ContentPackage, topic: TopicOption) {
  const primary = topic.seo.primary.trim();
  if (normalize(content.captionParts.opening.slice(0, 100)).includes(normalize(primary))) return;
  const topicSentence = topic.topic.trim().replace(/[。！？!?]+$/u, '');
  const replacement = topicSentence.includes(primary)
    ? `${topicSentence}？`
    : `${primary}：${topicSentence}。`;
  content.captionParts.opening = fitCompleteText(replacement, 85);
}

function extractEnumeratedCount(value: string) {
  const match = value.match(/(\d+)\s*(类|种|个)\s*(常见|典型)?\s*(错误|原因|方法|差异|步骤)/u);
  if (!match) return null;
  return { count: Number(match[1]), unit: match[2], object: `${match[3] || ''}${match[4]}` };
}

function normalizeIncompleteEnumerations(content: ContentPackage, warnings: string[]) {
  const enumeration = /\d+\s*(?:类|种|个)\s*(?:常见|典型)?\s*(错误|原因|方法|差异|步骤)/gu;
  content.innerPages = content.innerPages.map((page, index) => {
    const promised = extractEnumeratedCount(`${page.page_title} ${page.lead}`);
    if (!promised || page.bullets.length >= promised.count) return page;
    const replacement = promised.object.endsWith('错误') ? '常见错误' : promised.object.replace(/^(?:常见|典型)/u, '');
    warnings.push(`内页只列出${page.bullets.length}条，已移除未兑现的“${promised.count}${promised.unit}${promised.object}”数量承诺：innerPages[${index}]`);
    return {
      ...page,
      page_title: page.page_title.replace(enumeration, replacement),
      lead: page.lead.replace(enumeration, replacement),
    };
  });
}

function fitCompleteText(value: string, maximum: number) {
  if (countVisibleUnits(value) <= maximum) return finishSentence(value);
  const sentences = value.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) || [value];
  let output = '';
  for (const sentence of sentences) {
    if (output && countVisibleUnits(output + sentence) > maximum) break;
    if (!output && countVisibleUnits(sentence) > maximum) {
      const clauses = sentence.match(/[^，,：:]+[，,：:]?/gu) || [sentence];
      for (const clause of clauses) {
        if (output && countVisibleUnits(output + clause) > maximum) break;
        if (countVisibleUnits(output + clause) <= maximum) output += clause;
      }
      break;
    }
    output += sentence;
  }
  return finishSentence(output);
}

function finishSentence(value: string) {
  const text = value.trim().replace(/[，,；;：:]$/u, '。');
  if (!text || /[。！？）】”’]$/u.test(text)) return text;
  return `${text}。`;
}

function captionText(content: ContentPackage) {
  return [content.captionParts.opening, ...content.captionParts.value, content.captionParts.productBridge, content.captionParts.cta].filter(Boolean).join('\n\n');
}

function countFrenchWords(value: string) {
  return (value.match(/[A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+)*/g) || []).length;
}

function publicTextEntries(content: ContentPackage) {
  const entries: Array<{ path: string; text: string; sourceIds?: string[] }> = [];
  content.coverBlocks.forEach((block, blockIndex) => {
    if (block.heading) entries.push({ path: `coverBlocks[${blockIndex}].heading`, text: block.heading, sourceIds: block.sourceIds });
    block.items.forEach((item, itemIndex) => entries.push({ path: `coverBlocks[${blockIndex}].items[${itemIndex}]`, text: [item.primary, item.secondary, item.note].filter(Boolean).join(' '), sourceIds: block.sourceIds }));
  });
  content.innerPages.forEach((page, pageIndex) => {
    if (page.page_title) entries.push({ path: `innerPages[${pageIndex}].page_title`, text: page.page_title, sourceIds: page.source_ids });
    if (page.lead) entries.push({ path: `innerPages[${pageIndex}].lead`, text: page.lead, sourceIds: page.source_ids });
    page.bullets.forEach((bullet, bulletIndex) => entries.push({ path: `innerPages[${pageIndex}].bullets[${bulletIndex}]`, text: bullet, sourceIds: page.source_ids }));
  });
  entries.push({ path: 'captionParts.opening', text: content.captionParts.opening });
  content.captionParts.value.forEach((paragraph, index) => entries.push({ path: `captionParts.value[${index}]`, text: paragraph }));
  entries.push({ path: 'captionParts.productBridge', text: content.captionParts.productBridge });
  entries.push({ path: 'captionParts.cta', text: content.captionParts.cta });
  return entries;
}

function factSupportedByPathSources(
  text: string,
  sourceIds: string[],
  evidenceById: Map<string, EvidenceSnippet>,
  examFact: boolean,
) {
  const sources = sourceIds.map(id => evidenceById.get(id))
    .filter((item): item is EvidenceSnippet => Boolean(item))
    .filter(item => !examFact || item.category === 'official_exam_fact');
  if (!sources.length) return false;
  const sourceText = normalize(sources.map(item => `${item.text} ${item.evidence}`).join(' '))
    .replace(/(\d+(?:\.\d+)?)道题/gu, '$1题');
  const numbers = numericTokens(text);
  const units = quantityUnitTokens(text);
  if (!numbers.every(token => sourceText.includes(normalize(token)))) return false;
  if (!units.every(token => sourceText.includes(token))) return false;
  const subjects = examSubjects(text);
  if (examFact && subjects.length && !subjects.every(subject => sourceText.includes(subject))) return false;
  return sharedBigrams(normalize(text), sourceText) >= 3;
}

function factRegisteredByPathClaim(
  text: string,
  sourceIds: string[],
  claims: ContentPackage['factualClaims'],
  evidenceById: Map<string, EvidenceSnippet>,
  examFact: boolean,
) {
  if (!sourceIds.length) return false;
  const pathIds = new Set(sourceIds);
  const matchedClaims = claims.filter(claim => claim.sourceIds.some(id => pathIds.has(id)));
  if (!matchedClaims.length) return false;
  const sources = sourceIds.map(id => evidenceById.get(id)).filter((item): item is EvidenceSnippet => Boolean(item));
  if (examFact && !sources.some(item => item.category === 'official_exam_fact')) return false;
  // 一条公开文案可能同时包含商品结构数字和官方考试数字，例如
  // “E5 字数时间 4 项：至少 250 词”。只按单条 claim 检查会把它误杀，
  // 因此在页面已经明确绑定 source_ids 时，按该页面的全部事实卡联合核对。
  const support = normalize([
    ...matchedClaims.map(claim => claim.text),
    ...sources.map(item => `${item.text} ${item.evidence}`),
  ].join(' '));
  const numbers = numericTokens(text);
  if (!numbers.every(token => support.includes(normalize(token)))) return false;
  const subjects = examSubjects(text);
  if (examFact && subjects.length && !subjects.every(subject => support.includes(subject))) return false;
  return examFact ? sharedBigrams(normalize(text), support) >= 1 : true;
}

function removeVisibleSourceIds(content: ContentPackage, warnings: string[]) {
  let removed = 0;
  const clean = (value: string) => value.replace(new RegExp(INTERNAL_SOURCE_ID.source, 'gi'), () => {
    removed += 1;
    return '';
  });
  const finish = (value: string) => cleanVisibleSourceReferences(clean(value));
  content.coverBlocks.forEach(block => {
    if (block.heading) block.heading = finish(block.heading);
    block.items.forEach(item => {
      item.primary = finish(item.primary);
      if (item.secondary) item.secondary = finish(item.secondary);
      if (item.note) item.note = finish(item.note);
    });
  });
  content.innerPages.forEach(page => {
    page.page_title = finish(page.page_title);
    page.lead = finish(page.lead);
    page.bullets = page.bullets.map(finish).filter(Boolean);
  });
  content.captionParts.opening = finish(content.captionParts.opening);
  content.captionParts.value = content.captionParts.value.map(finish).filter(Boolean);
  content.captionParts.productBridge = finish(content.captionParts.productBridge);
  content.captionParts.cta = finish(content.captionParts.cta);
  if (removed) warnings.push(`已从用户可见内容移除${removed}个内部资料编号`);
}

function cleanVisibleSourceReferences(value: string) {
  return value
    .replace(new RegExp(INTERNAL_SOURCE_ID.source, 'gi'), '')
    .replace(/[（(]\s*来自\s*(?:和|、|及|与|\s)*[）)]/gu, '')
    .replace(/[（(]\s*[）)]/gu, '')
    .replace(/\s*[~～—–]\s*(?=[，。；;）)])/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^\s*[-:：·]+\s*/u, '')
    .trim();
}

function fitDirectoryCoverItems(content: ContentPackage, capability: TemplateCapability, warnings: string[]) {
  if (capability.compiler !== 'directory') return;
  const compact = capability.densityTiers[0];
  const moved: string[] = [];
  content.coverBlocks = content.coverBlocks.map(block => ({
    ...block,
    items: block.items.map(item => {
      const primaryTooLong = countVisibleUnits(item.primary) > compact.primaryVisualLength[1];
      const secondaryFits = Boolean(item.secondary)
        && countVisibleUnits(item.secondary || '') <= compact.primaryVisualLength[1];
      if (!primaryTooLong || !secondaryFits) return item;
      moved.push([block.heading, item.primary, item.secondary, item.note].filter(Boolean).join('：'));
      return {
        primary: item.secondary!,
        secondary: item.note && countVisibleUnits(item.note) <= compact.secondaryVisualLength[1]
          ? item.note
          : undefined,
      };
    }),
  }));
  if (!moved.length) return;
  content.innerPages.push({
    page_no: content.innerPages.length + 2,
    page_type: 'knowledge_list',
    page_title: '封面条目的完整表达',
    lead: '封面保留短标签，完整法语表达和使用提示放在这里。',
    bullets: moved.slice(0, 12),
    source_ids: Array.from(new Set(content.coverBlocks.flatMap(block => block.sourceIds))),
  });
  warnings.push(`已把${moved.length}条过长表达移到内页，封面改用对应短标签`);
}

function claimsUnavailableProductForm(text: string, path: string) {
  if (!FALSE_PRODUCT_FORM.test(text)) return false;
  if (path === 'captionParts.productBridge') return true;
  const product = '(?:知识库|资料包|资料库|商品|这套资料|本套资料|购买|下单|小黄车)';
  const service = '(?:课程|网课|一对一|老师批改|直播课|无限答疑)';
  const offer = '(?:提供|包含|附带|赠送|支持|可以|能享受|能获得)';
  return new RegExp(`${product}.{0,20}(?:${offer}.{0,8})?${service}|${service}.{0,20}(?:${offer}.{0,8})?${product}`, 'i').test(text)
    || new RegExp(`(?:我|我们|老师).{0,12}${offer}.{0,8}${service}`, 'i').test(text);
}

function isFactSupportedByCombinedSources(
  text: string,
  claims: ContentPackage['factualClaims'],
  evidenceById: Map<string, EvidenceSnippet>,
  examFact: boolean,
) {
  const referencedSources = claims.flatMap(claim => claim.sourceIds.map(id => evidenceById.get(id)))
    .filter((item): item is EvidenceSnippet => Boolean(item))
    .filter(item => !examFact || item.category === 'official_exam_fact');
  const directlyEligibleSources = Array.from(evidenceById.values())
    .filter(item => examFact ? item.category === 'official_exam_fact' : item.category !== 'official_exam_fact');
  const sources = Array.from(new Map([...referencedSources, ...directlyEligibleSources].map(item => [item.id, item])).values());
  if (!sources.length) return false;
  if (examFact) return examClausesSupported(text, sources);
  const sourceText = normalize(sources.map(item => `${item.text} ${item.evidence}`).join(' '));
  const normalizedText = normalize(text);
  const numbers = numericTokens(text);
  const numbersSupported = numbers.every(token => sourceText.includes(normalize(token)));
  return numbersSupported && sharedBigrams(normalizedText, sourceText) >= 4;
}

function isExamFactRisk(text: string) {
  const hasExamIdentity = /(?:DELF|TEF|TCF|CLB|NCLC)/i.test(text);
  const hasAuthorityLanguage = /(?:官方|考试|评分标准|考官)/i.test(text);
  if (RISKY_EXAM_FACT.test(text) && (hasExamIdentity || hasAuthorityLanguage)) return true;
  if (!hasExamIdentity) return false;
  // “DELF B2 + 论证/互动”通常只是学习建议，不是官方考试事实。
  // 只有可量化考试信息或明确以官方/考试规则口吻表述时才进入硬核验。
  return /\d+(?:\.\d+)?\s*(?:道)?(?:题|词|分钟|小时|部分|科|项|分)/i.test(stripLevelLabels(text))
    || /(?:官方|考试)(?:要求|规定|标准|时长|时间|包含)|评分标准|至少\s*\d+|题目可能采用|写作要求/i.test(text)
    || isExamTaskStructureClaim(text);
}

function isExamTaskStructureClaim(text: string) {
  return /(?:(?:包括|包含|分为|由|任务(?:是|为)).{0,30}|第[一二三四1234]部分.{0,12})(?:自我介绍|日常话题|获取信息|询问信息|说服|劝说|表达观点|互动|引导式面谈|引导式访谈|续写)/i.test(text);
}

function examClausesSupported(text: string, sources: EvidenceSnippet[]) {
  const overallSubjects = examSubjects(text);
  const clauses = text.split(/[，,；;。！？!?]/).map(item => item.trim()).filter(Boolean);
  const factualClauses = clauses.filter(clause => RISKY_EXAM_FACT.test(clause)
    || /\d+(?:\.\d+)?\s*(?:道)?(?:题|词|分钟|小时|部分|科|项|分)/i.test(stripLevelLabels(clause))
    || /(?:官方|考试)(?:要求|规定|标准|时长|时间|包含)|评分标准|至少\s*\d+/i.test(clause)
    || isExamTaskStructureClaim(clause));
  const targets = factualClauses.length ? factualClauses : [text];
  return targets.every(clause => {
    const subjects = examSubjects(clause);
    const effectiveSubjects = subjects.length ? subjects : overallSubjects;
    const matchingSources = effectiveSubjects.length
      ? sources.filter(source => effectiveSubjects.some(subject => normalize(`${source.source_section} ${source.text}`).includes(subject)))
      : sources;
    if (!matchingSources.length) return false;
    const sourceText = normalize(matchingSources.map(item => `${item.text} ${item.evidence}`).join(' '))
      .replace(/(\d+(?:\.\d+)?)道题/gu, '$1题');
    const normalizedClause = normalize(clause);
    const numbers = numericTokens(clause.replace(/\d+(?:\.\d+)?\s*(?:个)?(?:论据|理由|例子|步骤|层次|角度)/g, ''));
    const quantityUnits = quantityUnitTokens(clause);
    const semanticMarkers = examSemanticMarkers(clause);
    const sourceMarkers = new Set(examSemanticMarkers(sourceText));
    const lexicalThreshold = numbers.length || quantityUnits.length ? 2 : 4;
    return numbers.every(token => sourceText.includes(normalize(token)))
      && quantityUnits.every(token => sourceText.includes(token))
      && semanticMarkers.every(marker => sourceMarkers.has(marker))
      && sharedBigrams(normalizedClause, sourceText) >= lexicalThreshold;
  });
}

function examSemanticMarkers(text: string) {
  const markers: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ['self_intro', /自我介绍/i],
    ['daily_topic', /日常话题/i],
    ['obtain_info', /获取信息|询问信息|收集信息/i],
    ['persuade', /说服|劝说/i],
    ['opinion', /表达(?:并论证)?观点|观点表达|陈述观点/i],
    ['interaction', /互动|交互/i],
    ['guided_interview', /引导式面谈|引导式访谈/i],
    ['preparation', /准备时间|分钟准备|无准备/i],
    ['continuation', /续写/i],
    ['argument', /论证/i],
  ];
  for (const [marker, pattern] of rules) if (pattern.test(text)) markers.push(marker);
  return markers;
}

function examSubjects(text: string) {
  const normalized = normalize(text);
  return ['delf', 'tef', 'tcf'].filter(subject => normalized.includes(subject));
}

function numericTokens(value: string) {
  return Array.from(new Set(stripLevelLabels(value).match(/\d+(?:\.\d+)?/g) || []));
}

function stripLevelLabels(value: string) {
  return value
    .replace(/\b(?:CEFR\s*)?[ABC]\s*[12]\b/giu, ' ')
    .replace(/\b(?:CLB|NCLC)\s*\d+\b/giu, ' ');
}

function quantityUnitTokens(value: string) {
  return Array.from(new Set((value.match(/\d+(?:\.\d+)?\s*(?:道)?(?:题|词|分钟|小时|部分|科|项|分)/gi) || [])
    .map(token => normalize(token).replace(/道题$/u, '题'))));
}

function sanitizeUnsupportedPracticeFacts(
  content: ContentPackage,
  evidenceById: Map<string, EvidenceSnippet>,
) {
  const claims = content.factualClaims.filter(claim => claim.type === 'exam');
  const clean = (value: string) => {
    if (!/(?:练习示例|模拟|练习)/i.test(value) || !isExamFactRisk(value)) return value;
    if (isFactSupportedByCombinedSources(value, claims, evidenceById, true)) return value;
    let next = value
      .replace(/[，,；;]?\s*(?:限时|持续|用时|时长(?:为|是)?|共)?\s*\d+(?:\.\d+)?\s*(?:分钟|小时)/giu, '')
      .replace(/第\s*\d+\s*(?:道)?(?:题|部分)/giu, '对应任务')
      .replace(/\d+\s*(?:道)?(?:题|部分|科|项)/giu, '对应任务')
      .replace(/[，,；;]{2,}/gu, '，')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (isExamFactRisk(next) && !isFactSupportedByCombinedSources(next, claims, evidenceById, true)) {
      next = next.replace(/(?:TEF|TCF|DELF)\s*/giu, '').trim();
    }
    return finishSentence(next);
  };
  content.innerPages = content.innerPages.map(page => ({
    ...page,
    lead: clean(page.lead),
    bullets: page.bullets.map(clean),
  }));
  content.captionParts.value = content.captionParts.value.map(clean);
}

function textOverlaps(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  return a.includes(b) || b.includes(a) || sharedBigrams(a, b) >= 4;
}

function sharedBigrams(a: string, b: string) {
  const set = new Set<string>();
  for (let i = 0; i < a.length - 1; i += 1) set.add(a.slice(i, i + 2));
  let count = 0;
  for (let i = 0; i < b.length - 1; i += 1) if (set.has(b.slice(i, i + 2))) count += 1;
  return count;
}

function normalize(value: string) {
  return value.toLowerCase().normalize('NFC').replace(/[\s\p{P}\p{S}]/gu, '');
}

function issue(code: string, message: string, path?: string): PublishIssue {
  return { code, message, path };
}

function dedupeIssues(items: PublishIssue[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.code}|${item.path}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
