import { callOpenAICompatibleJsonWithUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getRoutedTitleFormulas } from '@/lib/full-title-formula-catalog';
import { getProductPromptProfile, hasForbiddenProductIdentity, hasRequiredProductIdentity } from '@/lib/product-prompt-profiles';
import { fingerprintTitle, getRecentTitleFingerprints, titleTemplateFingerprint } from '@/lib/title-usage-store';
import type { MigratedTopic } from '@/types/reference-workflow';
import { countVisibleUnits, stableHash, type ContentPackage, type TemplateCapability, type TitlePackage, type TitlePair, type TopicOption, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { candidateMixForDirections, clampTitleCandidateCount, classifyTitleDirection, sampleDirectionsForNote, titleDirectionPromptLines, titlePromiseBeyondRange, titlePromiseRangeText, resolveTitleConsensusActive, type TitleDirection } from './title-consensus';
import { getProductEditorialMap } from './product-editorial-map';

export const TITLE_PROMPT_VERSION = 'v2-title-7';
export const TITLE_CANDIDATE_COUNT = 4;

type TitleMechanism = 'search_utility' | 'loss_tension' | 'cognitive_conflict' | 'result_gain';

type TitleCategoryFn = (pair: TitlePair) => string;

interface TitleStageInput {
  topic: TopicOption;
  capability: TemplateCapability;
  content: ContentPackage;
  /** 阶段 D（设计 §4.1）：输出组数入参；仅商品1普通模式（共识门控开）生效，clamp 1-8 默认 4。legacy 路径恒为 4。 */
  candidateCount?: number;
}

interface RawTitleResponse {
  candidates?: Array<Partial<TitlePair> & Record<string, unknown>>;
}

export function diagnoseTitlePair(
  pair: TitlePair,
  input: TitleStageInput,
  selected = new Set<string>(),
  coverTitles = new Set<string>(),
) {
  return titleGateFailures(pair, input, selected, coverTitles);
}

export function selectTitleCandidateForTest(
  candidates: TitlePair[],
  input: TitleStageInput,
  recentRecords: Array<{ title: string; cover_title: string }> = [],
) {
  return selectTitleCandidate(candidates, input, new Map(), recentRecords);
}

export function passesTitleHardGatesForTest(pair: TitlePair, input: TitleStageInput) {
  return passesHardGates(pair, input, new Set(), new Set());
}

export async function generateTitlePackage(input: TitleStageInput): Promise<VersionedArtifact<TitlePackage>> {
  const profile = getProductPromptProfile(input.topic.productId);
  const recent = await getRecentTitleFingerprints(input.topic.productId, { days: 30 });
  const migrated = toMigrated(input.topic);
  const formulas = getRoutedTitleFormulas(migrated, input.capability.family).map(item => ({ id: item.id, trigger: item.trigger_type, skeleton: item.formula }));
  const coverSummary = input.content.coverBlocks.slice(0, 6).map(block => ({ heading: block.heading, kind: block.kind, items: block.items.slice(0, 4) }));
  const coverRange = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  const supportedNumbers = contentNumbers(input);
  const productShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  // 阶段 D 门控：只有商品1普通模式走方向池新逻辑；showcase 与商品2/3 的最终
  // prompt 拼接结果与 4fdb786 现状逐字节一致（离线测试 sha256 锁定）。
  const consensusActive = resolveTitleConsensusActive(input.topic.productId, productShowcase);
  const effectiveCount = consensusActive ? clampTitleCandidateCount(input.candidateCount) : TITLE_CANDIDATE_COUNT;
  const directions = consensusActive ? sampleDirectionsForNote(input.topic.noveltyFingerprint, effectiveCount) : [];
  const categoryFn: TitleCategoryFn = consensusActive ? classifyTitleDirection : classifyTitleMechanism;
  const editorialMap = consensusActive ? getProductEditorialMap(input.topic.productId) : undefined;
  const baseActualContent = {
    cover: coverSummary,
    opening: input.content.captionParts.opening,
    value_points: input.content.captionParts.value.slice(0, 4),
  };
  const promptInput = {
    product: { identity: profile.noteIdentity, short_identity: profile.shortIdentity, scope: profile.editorialScopePrompt },
    topic: input.topic,
    actual_content: consensusActive ? {
      ...baseActualContent,
      // 阶段 D（设计 §4.1）：内页摘要 5 页 {page_title, lead, bullets前3} 进 prompt。
      inner_pages: input.content.innerPages.slice(0, 5).map(page => ({
        page_title: page.page_title,
        lead: page.lead,
        bullets: page.bullets.slice(0, 3),
      })),
    } : baseActualContent,
    cover: {
      renderer: input.capability.renderer,
      family: input.capability.family,
      allowed_mechanisms: input.capability.allowedTitleMechanisms,
      cover_title_visible_units: coverRange,
      text_title_visible_units: [12, 20],
    },
    allowed_numbers_from_actual_content: supportedNumbers,
    formula_skeletons: formulas,
    required_candidate_mix: consensusActive ? candidateMixForDirections(directions) : productShowcase ? {
      search_utility: 1,
      loss_tension: 1,
      cognitive_conflict: 1,
      result_gain: 1,
    } : {
      search_utility: 1,
      loss_tension: 1,
      cognitive_conflict: 1,
      result_gain: 1,
    },
    recent_selected_titles_to_avoid: recent.records.slice(-30).map(item => item.title),
    recent_cover_titles_to_avoid: recent.records.slice(-30).map(item => item.cover_title),
    product_showcase_title_directions: productShowcase ? [
      '平铺介绍：让用户一眼知道这个知识库具体有什么、怎么查、为什么值得收藏',
      '情绪痛点：从备考者正在经历的具体困扰切入，再自然指向这套资料',
      '强获得感：突出体系、大全、稀缺整理或考前可直接使用的价值，但不能只报数量',
      '适度吹爆：用有依据的强判断表达资料的完整、好用、值得看，不冒充官方或虚构效果',
    ] : undefined,
    // 阶段 D 输入增补（仅门控开；全部是结构化输入，不含固定文字示例）：
    // 商品能力列表、购买者地图三块全量、标题可承诺范围。legacy 路径这些键不存在。
    ...(consensusActive ? {
      product_capabilities: editorialMap ? editorialMap.capabilities.map(item => ({
        capability_id: item.capabilityId,
        capability: item.capability,
        modules: item.modules,
      })) : undefined,
      buyer_map: editorialMap?.buyerMap,
      title_promise_range: titlePromiseRangeText(input.topic),
    } : {}),
  };
  const inputHash = stableHash(promptInput);
  // 阶段 D（设计 §4.4）：candidateCount>4 时首轮 900+320*count，返修按 1800:1400 同比例放大；默认 4 维持 1800/1400。
  const firstMaxTokens = consensusActive && effectiveCount > 4 ? 900 + 320 * effectiveCount : 1800;
  const repairMaxTokens = firstMaxTokens === 1800 ? 1400 : Math.round((firstMaxTokens * 1400) / 1800);
  const result = await callOpenAICompatibleJsonWithUsage<RawTitleResponse>([
    {
      role: 'system',
      content: [
        '你是资深小红书标题主编。内容已经确定，你只生成“文字标题+封面标题+可选副标题”的成对候选，不得改内容。',
        '文字标题负责搜索和点击，必须让用户一眼知道法语考试/科目、具体对象和看完能得到什么；不超过20个可见字。',
        `文字标题必须为12到20个可见字；封面标题必须为${coverRange[0]}到${coverRange[1]}个可见字。汉字、字母、数字、标点各算1个，空格不算。`,
        '封面标题是用户第一眼看到的，只保留“法语身份/用户阶段或痛点/核心收益”中的最强两项；详细解释放副标题，不能把完整方法塞进封面标题。',
        '封面标题不能只是栏目名、资料名或内容摘要。必须让用户立刻看见“这和我有什么关系”：至少出现当前阶段、正在担心的后果、马上能做的动作或看完收益中的一项；纯“差异对比、知识体系、资料整理、任务详解”不合格。注意“自查、清单、大全”只是内容形式，不等于用户关系，封面还要写出没底、怕丢分、考前、报名前、不会检查等当前状态。',
        '封面标题本身必须明确出现本商品考试身份（DELF B2/法语B2，或TEF/TCF），不能把身份只放在小副标题，也不能只写“150到250、3步扩写”这类脱离领域的标题。',
        '封面标题必须兑现实际封面内容：高密度资料模板可用资料、大全、时效、稀缺；经验痛点模板用情绪、结果、反常识；文档解析说清解析对象。',
        productShowcase ? '这是知识库介绍模式：4组候选必须覆盖“平铺介绍、具体痛点、反常识、结果/强获得感”四个方向，标题要讲商品本身，但不能把“知识库宣传”写成内部栏目名。封面标题和文字标题都要让备考者看出这套资料与自己有关；至少有一部分候选出现“法语/DELF B2/写作”等身份和用户动作或获得感。' : '',
        '标题可以有冲突、恐惧、反常识、结果和适度夸张，但不得冒充不存在的官方、服务、经历或具体数据来源。',
        '标题里的数量、天数、分钟、分数和库存数字只能使用allowed_numbers_from_actual_content；B2、TEF、TCF、CLB7等考试名称中的数字除外。禁止为了钩子新编20词、10分钟、35分钟、1个月等数字。',
        '标题必须概括本篇主轴，而不是抓住某个次要条目另起题目。若写“3步、5点、36项”等数量结构，actual_content的主题、承诺或一级封面分组中必须真的存在同名数量结构，不能从评分档位、例句或角落数字拼出新钩子。',
        '标题和副标题只能写actual_content实际展开的维度；正文没有比较评分、费用、出分速度或考试难度，就不能在标题里新增这些维度。数字直接修饰“差异、原因、问题、方法、错误”等中文名词时必须带自然量词，禁止“4差异、3原因、5错误”这种省略。',
        '可以强化冲突，但不能偷换或升级用户问题：例如“练完没把握”不能改成“练了没用”，“不知道短板”不能改成“总跑题”。标题所写的具体症状必须与topic中的audienceState、scene、painOrDesire同义。',
        '选考类标题不得把单一能力直接等同于考试选择。禁止写“写作强选TEF”“口语弱选TCF”“某类人直接选某考试”等武断结论；标题应引导用户对比题型、任务形式和目标项目。',
        '必须说人话。禁用“资料太散、卡住、拖后腿、正在白背、格式正在偷分、写作任务、这一步、多数人”等空泛机器表达。',
        '每个标题必须是一句可以直接念出口的完整中文短句，词序要符合日常口语。禁止把“对象、数量、类别、动作”压成名词串，禁止为了缩短字数写成“语法错9类、清单查短板、5维度自查定位”这类电报式表达。',
        '具体痛点要用学习者会说的话表达，避免把编辑标签或内容分类直接当成标题。不要反复使用同一组情绪词或同义改写。',
        '不得整批都写成问句、冒号句或“别再X”句式；候选的机制、句式和核心对象必须有差异。',
        // 阶段 D：门控开时 legacy「四种机制各1组」两行替换为本次方向子集说明（title-consensus 模块生成）。
        ...(consensusActive
          ? titleDirectionPromptLines(directions, effectiveCount)
          : [
            '无论普通模式还是知识库介绍模式，最终只返回4组成对候选，四种机制各1组：search_utility（搜索/资料获得感）、loss_tension（风险/损失）、cognitive_conflict（反常识/认知冲突）、result_gain（结果/行动收益）。不要返回第5组或更多，也不要把四组写成同一个句式的改写。',
            'mechanism字段必须填写这4个英文值之一。四类候选的句式和核心点击理由必须真正不同，不能只换同义词。',
          ]),
        '标题末尾不能是冒号、逗号或顿号。若写“从X词到Y词”，实际内页必须包含完整达到Y词的法语示例；只有片段时不得使用该承诺。',
        'formula_skeletons只用于学习结构和心理触发，不得机械填槽或照抄固定措辞。',
        ...(consensusActive
          ? [
            `生成${effectiveCount}组成对候选，每方向恰好1组；缺少的方向要新写候选，不得用同一方向改写凑数。`,
            '标题只能承诺user输入里title_promise_range与actual_content实际展开的内容；超出范围的效果承诺（如保过、押题、快速提分）不得出现，返修时也要删掉。',
          ]
          : [productShowcase ? '生成4组成对候选，每类恰好1组：search_utility平铺介绍知识库具体有什么；loss_tension写备考者会直接说出的具体困扰；cognitive_conflict写反常识或改变原有做法；result_gain把资料价值说得很强、很值得买或马上能用。四类不能只换几个词。允许适度“吹爆”资料，但必须基于本篇真实内容，不能写空泛口号。' : '生成4组成对候选，每类恰好1组。']),
        'mechanism写本候选的实际机制；userRelation明确写它与用户的关系信号；noveltyFingerprint写“机制|对象|角度”。',
        '每个candidates项必须严格为{textTitle,coverTitle,coverSubtitle,mechanism,userRelation,seoKeyword,noveltyFingerprint}。禁止使用title、cover_title、cover_subtitle、title_type等旧字段。',
        '只返回JSON对象，顶层字段candidates。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(promptInput) },
  ], { maxTokens: firstMaxTokens, temperature: 0.86, retries: 1 });
  const normalizedCandidates = (Array.isArray(result.data.candidates) ? result.data.candidates : [])
    .map(normalizePair)
    .filter((pair): pair is TitlePair => Boolean(pair))
    .map(pair => normalizePairForInput(pair, input, { coverTruncate: !consensusActive }));
  let titleUsage = result.usage;
  const consensusWarnings: string[] = [];
  let candidates = normalizedCandidates.filter(pair => passesHardGates(pair, input, recent.selectedTitles, recent.coverTitles, false, consensusActive));
  if (candidates.length < effectiveCount) {
    const repairable = normalizedCandidates.slice(0, 8);
    if (repairable.length) {
      const repaired = await repairTitleCandidates(repairable, {
        productIdentity: profile.noteIdentity,
        topic: input.topic.topic,
        promise: input.topic.promise,
        audience: input.topic.audienceState,
        painOrDesire: input.topic.painOrDesire,
        coverRange,
        supportedNumbers,
        targetCount: effectiveCount,
        ...(consensusActive ? { required_directions: directions } : {}),
      }, input, recent.selectedTitles, recent.coverTitles, repairMaxTokens);
      titleUsage = mergeAiUsage(titleUsage, repaired.usage);
      const repairedCandidates = repaired.candidates
        .map(pair => normalizePairForInput(pair, input, { coverTruncate: !consensusActive }))
        .filter(pair => passesHardGates(pair, input, recent.selectedTitles, recent.coverTitles, false, consensusActive));
      candidates = dedupeCandidates([...candidates, ...repairedCandidates], categoryFn);
      if (!candidates.length) {
        candidates = repairable
          .map(pair => ({ ...pair, textTitle: fitTextTitle(pair.textTitle) }))
          .filter(pair => passesHardGates(pair, input, recent.selectedTitles, recent.coverTitles, false, consensusActive));
      }
      // 阶段 D（设计 §4.3）：门控开时封面标题超长先返修；返修后组数仍不足，
      // 才把「其余都合格、只是封面超长」的候选拿回来截断兜底，不让整篇 job 失败。
      // legacy 路径没有这一步（封面在 normalizePairForInput 已预先截断）。
      if (consensusActive && candidates.length < effectiveCount) {
        const rescuedCover = repairable
          .map(pair => {
            const truncated = fitCoverTitle(pair.coverTitle, input, true);
            return { pair: { ...pair, textTitle: fitTextTitle(pair.textTitle), coverTitle: truncated }, didTruncate: truncated !== pair.coverTitle };
          })
          .filter(item => passesHardGates(item.pair, input, recent.selectedTitles, recent.coverTitles, false, true));
        const before = candidates.length;
        candidates = dedupeCandidates([...candidates, ...rescuedCover.map(item => item.pair)], categoryFn);
        if (candidates.length > before && rescuedCover.some(item => item.didTruncate)) {
          consensusWarnings.push(`封面标题超长且返修未补齐，已截断兜底${candidates.length - before}组，请人工复核封面文案`);
        }
      }
    }
  }
  const diversified = diversifyCandidates(dedupeCandidates(candidates, categoryFn), input, recent.records, categoryFn, consensusActive ? directions : undefined);
  const { list: unique, warnings: coverFallbackWarnings } = applyCoverTruncateFallback(
    limitTitleCandidates(diversified, categoryFn, effectiveCount).slice(0, effectiveCount),
    input,
    consensusActive,
  );
  if (!unique.length) {
    // 标题是可返修字段，不应因为历史标题重复或某个窄正则把整篇内容判死。
    // 先在不读取历史占用的前提下保留一个当前内容最匹配的候选；后续仍会在
    // warnings 中记录降级，便于人工换标题，而不是让整篇 job 失败。
    const salvagePool = dedupeCandidates(
      normalizedCandidates
        .map(pair => normalizePairForInput(pair, input, { coverTruncate: !consensusActive }))
        .filter(pair => passesHardGates(pair, input, new Set(), new Set(), true)),
      categoryFn,
    );
    if (salvagePool.length) {
      const salvageCandidates = applyCoverTruncateFallback(
        limitTitleCandidates(diversifyCandidates(salvagePool, input, [], categoryFn, consensusActive ? directions : undefined), categoryFn, effectiveCount).slice(0, effectiveCount),
        input,
        consensusActive,
      );
      const salvageFinal = salvageCandidates.list.length ? salvageCandidates.list : salvagePool.slice(0, effectiveCount);
      const data: TitlePackage = {
        contentSnapshotHash: stableHash(input.content),
        candidates: salvageFinal,
        selected: selectTitleCandidate(salvageFinal, input, new Map(), []),
      };
      const categoryCount = new Set(data.candidates.map(categoryFn)).size;
      return artifact(data, inputHash, titleUsage, result.requestId, [
        '标题候选与历史或长度规则冲突，已保留当前内容最匹配的候选，请人工复核标题新鲜度',
        ...(categoryCount < 3 ? [`本次标题候选只覆盖${categoryCount}种点击机制`] : []),
        ...salvageCandidates.warnings,
        ...consensusWarnings,
        ...shortTextTitleWarnings(salvageFinal, consensusActive),
      ]);
    }
    console.error('[v2-title-rejected]', JSON.stringify({
      product_id: input.topic.productId,
      template_id: input.topic.templateId,
      raw_count: Array.isArray(result.data.candidates) ? result.data.candidates.length : 0,
      response_preview: JSON.stringify(result.data).slice(0, 5000),
    }));
    const error = new Error('V2标题阶段没有任何候选通过20字、商品身份、自然度和去重闸门');
    Object.assign(error, { v2Stage: 'title', usage: titleUsage });
    throw error;
  }
  const selected = selectTitleCandidate(unique, input, recent.selectedTitleTemplates, recent.records);
  const data: TitlePackage = { contentSnapshotHash: stableHash(input.content), candidates: unique, selected };
  const categoryCount = new Set(unique.map(categoryFn)).size;
  const warnings = [
    ...(unique.length < effectiveCount ? [`本次只有${unique.length}组标题通过硬门槛，未达到${effectiveCount}组`] : []),
    ...(categoryCount < 3 ? [`本次标题候选只覆盖${categoryCount}种点击机制`] : []),
    ...coverFallbackWarnings,
    ...consensusWarnings,
    ...shortTextTitleWarnings(unique, consensusActive),
  ];
  return artifact(data, inputHash, titleUsage, result.requestId, warnings);
}

/**
 * 阶段 D（设计 §4.3）：门控开时文字标题 <12 字只警告不淘汰。对最终存活的
 * 短标题候选记一条人工复核警告（legacy 路径 <12 仍在硬门槛判死，不产生该警告）。
 */
function shortTextTitleWarnings(candidates: TitlePair[], consensusActive: boolean): string[] {
  if (!consensusActive) return [];
  return candidates
    .filter(pair => countVisibleUnits(pair.textTitle) < 12)
    .map(pair => `文字标题仅${countVisibleUnits(pair.textTitle)}字，低于推荐下限12字，请人工复核：「${pair.textTitle}」`);
}

/**
 * 阶段 D（设计 §4.3）：门控开时封面标题超长先带 failures 进返修（fitCoverTitle
 * 不再预先截断）；返修后仍超长才在这里截断兜底并记警告。legacy 路径恒为直通。
 */
function applyCoverTruncateFallback(candidates: TitlePair[], input: TitleStageInput, consensusActive: boolean): { list: TitlePair[]; warnings: string[] } {
  if (!consensusActive) return { list: candidates, warnings: [] };
  const range = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  const warnings: string[] = [];
  const list = candidates.map(pair => {
    if (countVisibleUnits(pair.coverTitle) <= range[1]) return pair;
    warnings.push(`封面标题超长，返修后仍超${range[1]}字，已截断兜底：「${pair.coverTitle}」`);
    return { ...pair, coverTitle: trimTitleAtNaturalBoundary(pair.coverTitle, range[1]) };
  });
  return { list, warnings };
}

function fitTextTitle(value: string) {
  const text = compactTitleLanguage(value).replace(/DELF\s*B2/gi, 'DELF B2').replace(/TEF\s*TCF/gi, 'TEF/TCF');
  if (countVisibleUnits(text) <= 20) return text;
  return trimTitleAtNaturalBoundary(text, 20);
}

function compactTitleLanguage(value: string) {
  return value
    .replace(/TEF\s*(?:和|与|还是|\/|／)\s*TCF/gi, 'TEF/TCF')
    .replace(/DELF\s*B2\s*写作/gi, 'DELF B2写作')
    .replace(/个技巧/g, '招')
    .replace(/帮你/g, '')
    .replace(/轻松/g, '')
    .replace(/练了很多篇/g, '练了')
    .replace(/先搞懂/g, '先看')
    .replace(/到底|真正|完整地|系统地/g, '')
    .replace(/(\d+)个差异对比/g, '$1处差异')
    .replace(/(\d+)个(?:常见)?原因/g, '$1个原因')
    .replace(/自然凑满/g, '写够')
    .replace(/自然扩到/g, '扩到')
    .replace(/总是/g, '')
    .replace(/是因为/g, '：')
    .replace(/\s+/g, ' ')
    .trim();
}

// 阶段 D：共用机器（limit/dedupe/penalty/diversify）的分类器可传参，
// 默认值 = 现有 4 机制分类，legacy 调用点行为零变化；门控路径传 6 方向分类器。
function limitTitleCandidates(candidates: TitlePair[], classifier: TitleCategoryFn = classifyTitleMechanism, targetCount = TITLE_CANDIDATE_COUNT) {
  const limits = new Map<string, number>();
  const result: TitlePair[] = [];
  for (const candidate of candidates) {
    const mechanism = classifier(candidate);
    const count = limits.get(mechanism) || 0;
    if (count >= 1) continue;
    limits.set(mechanism, count + 1);
    result.push(candidate);
  }
  // AI偶尔漏掉某一机制时，用其余合格候选补足展示位，避免前台出现1组/2组。
  for (const candidate of candidates) {
    if (result.length >= targetCount) break;
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

function trimTitleAtNaturalBoundary(value: string, max: number) {
  const units = Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value), item => item.segment)
    .filter(unit => !/^\s+$/u.test(unit));
  let text = units.slice(0, max).join('').replace(/[A-Za-z0-9]+$/u, '').replace(/[，：、]$/u, '');
  const lastBoundary = Math.max(text.lastIndexOf('，'), text.lastIndexOf('！'), text.lastIndexOf('？'));
  if (lastBoundary >= Math.floor(max * 0.68)) text = text.slice(0, lastBoundary + 1);
  return text.replace(/[，：、]$/u, '');
}

function normalizePairForInput(pair: TitlePair, input: TitleStageInput, opts: { coverTruncate?: boolean } = {}): TitlePair {
  let coverTitle = pair.coverTitle;
  const hasExplicitCoverIdentity = input.topic.productId === 'delf_b2_writing'
    ? /(?:DELF\s*B2|法语\s*B2)/i.test(coverTitle)
    : /(?:TEF|TCF)/i.test(coverTitle);
  if (!hasExplicitCoverIdentity) {
    if (input.topic.productId === 'delf_b2_writing') {
      coverTitle = /^B2/i.test(coverTitle) ? `DELF ${coverTitle}` : `DELF B2 ${coverTitle}`;
    } else {
      coverTitle = `TEF/TCF ${coverTitle}`;
    }
  }
  return {
    ...pair,
    textTitle: fitTextTitle(pair.textTitle),
    coverTitle: fitCoverTitle(coverTitle, input, opts.coverTruncate !== false),
  };
}

function fitCoverTitle(value: string, input: TitleStageInput, allowTruncate = true) {
  const range = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  const text = compactTitleLanguage(normalizeNaturalCounters(value))
    .replace(/还在/g, '')
    .replace(/快速/g, '')
    .replace(/全解析/g, '看清')
    .replace(/\s+/g, ' ')
    .trim();
  if (countVisibleUnits(text) <= range[1]) return text;
  if (!allowTruncate) return text;
  return trimTitleAtNaturalBoundary(text, range[1]);
}

function passesHardGates(
  pair: TitlePair,
  input: TitleStageInput,
  selected: Set<string>,
  coverTitles: Set<string>,
  ignoreLength = false,
  // 阶段 D：门控开时 <12 字只警告不淘汰（设计 §0.7 / §4.3）；>20 硬上限两个路径都保留。
  relaxMinTextTitle = false,
) {
  if (!ignoreLength && (countVisibleUnits(pair.textTitle) > 20 || (!relaxMinTextTitle && countVisibleUnits(pair.textTitle) < 12))) return false;
  const coverRange = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  if (!ignoreLength && (countVisibleUnits(pair.coverTitle) < coverRange[0] || countVisibleUnits(pair.coverTitle) > coverRange[1])) return false;
  if (!hasRequiredProductIdentity(input.topic.productId, pair.textTitle)) return false;
  if (!hasRequiredProductIdentity(input.topic.productId, pair.coverTitle)) return false;
  if (hasForbiddenProductIdentity(input.topic.productId, `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`)) return false;
  if (hasRedundantIdentity(pair.textTitle, input.topic.productId) || hasRedundantIdentity(pair.coverTitle, input.topic.productId)) return false;
  if (hasOversimplifiedExamChoice(`${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`)) return false;
  if (selected.has(fingerprintTitle(pair.textTitle)) || coverTitles.has(fingerprintTitle(pair.coverTitle))) return false;
  if (isUnnatural(pair.textTitle) || isUnnatural(pair.coverTitle)) return false;
  if (/[：:，、]$/u.test(pair.textTitle) || /[：:，、]$/u.test(pair.coverTitle)) return false;
  if (!titleNumbersSupported(pair, input)) return false;
  if (!numericTransformationSupported(pair, input)) return false;
  if (introducesNewPain(pair, input)) return false;
  if (introducesUnsupportedFacet(pair, input)) return false;
  if (!contentSupports(pair, input)) return false;
  // 用户关系、点击理由和收益强度属于质量排序信号。它们不能和事实、身份、
  // 数字来源一样做全盘硬拦，否则模型给出的可用角度会被窄正则全部误杀。
  return true;
}

function introducesNewPain(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const context = [
    input.topic.topic,
    input.topic.audienceState,
    input.topic.scene,
    input.topic.painOrDesire,
    input.topic.promise,
    ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...input.content.innerPages.flatMap(page => [page.page_title, page.lead, ...page.bullets]),
    input.content.captionParts.opening,
    ...input.content.captionParts.value,
  ].join(' ');
  const painSignals: Array<[RegExp, RegExp]> = [
    [/跑题|偏题/, /跑题|偏题|审题|题意/],
    [/练了没用|练了没效果|白练/, /练了没用|练了没效果|白练|没有进步|分数没变化/],
    [/字数不够|写不够|凑字|差.{0,4}词/, /字数不够|写不够|凑字|差.{0,4}词|250词/],
    [/格式|称呼|结尾/, /格式|称呼|结尾|正式信|论坛投稿/],
    [/没思路|不会展开|写不出来/, /没思路|不会展开|写不出来|不知道怎么写|论点/],
    [/词汇少|背词|词汇量/, /词汇少|背词|词汇量|用词|词汇/],
    [/语法差|语法错|变位/, /语法差|语法错|变位|句法|配合/],
    [/来不及|时间不够|写不完/, /来不及|时间不够|写不完|时间分配/],
    [/丢分|分数上不去|提不上去/, /丢分|分数上不去|提不上去|扣分|评分/],
    [/选错|选哪个|怎么选/, /选错|选哪个|怎么选|不确定|纠结|选考/],
  ];
  return painSignals.some(([inTitle, inContext]) => inTitle.test(title) && !inContext.test(context));
}

async function repairTitleCandidates(
  candidates: TitlePair[],
  context: { productIdentity: string; topic: string; promise: string; audience: string; painOrDesire: string; coverRange: number[]; supportedNumbers: string[]; targetCount: number; required_directions?: string[] },
  input: TitleStageInput,
  selected: Set<string>,
  coverTitles: Set<string>,
  maxTokens = 1400,
) {
  const payload = candidates.map((candidate, index) => ({
    index,
    textTitle: candidate.textTitle,
    textTitleVisibleUnits: countVisibleUnits(candidate.textTitle),
    coverTitle: candidate.coverTitle,
    coverSubtitle: candidate.coverSubtitle,
    mechanism: candidate.mechanism,
    userRelation: candidate.userRelation,
    seoKeyword: candidate.seoKeyword,
    noveltyFingerprint: candidate.noveltyFingerprint,
    failures: titleGateFailures(candidate, input, selected, coverTitles),
  }));
  const result = await callOpenAICompatibleJsonWithUsage<RawTitleResponse>([
    {
      role: 'system',
      content: [
        '你是小红书标题精修编辑。候选角度已确定，逐项修复failures，不新增内容里没有的角度、承诺或数字。',
        context.required_directions
          ? `当前输入可能只有${candidates.length}组，但最终必须补齐到${context.targetCount}组；缺少的方向按required_directions补写新候选，每方向恰好1组，不得复制已有标题，也不能只返回原候选。`
          : `当前输入可能只有${candidates.length}组，但最终必须补齐到${context.targetCount}组；缺少的点击机制要补写新候选，不得复制已有标题，也不能只返回原候选。`,
        '每个textTitle必须为12到20个可见字；汉字、字母、数字、标点都各算1个，空格不算。',
        `每个coverTitle必须为${context.coverRange[0]}到${context.coverRange[1]}个可见字；只留用户关系和核心收益，解释移到coverSubtitle。`,
        `封面标题本身必须保留商品考试身份：${context.productIdentity}。标题末尾不能是冒号、逗号或顿号。`,
        '保留考试/科目身份、具体对象、冲突或收益；不能只删到剩下资料名。封面标题本身必须写出与用户当前状态、痛点或阶段的关系，不能只写“对照表、速览、决策树”等资料名。',
        '选考标题只能引导比较目标项目、题型和任务形式，不得用单一强弱项直接下“选TEF/选TCF”的结论。',
        `只能保留这些正文已有数字：${context.supportedNumbers.join('、') || '无'}；B2、TEF、TCF、CLB7等考试名称除外。其余新编数量、分数、天数和分钟必须删除。`,
        '禁止生造“资料太散”“卡住”“拖后腿”等机器表达。',
        '必须改成可以直接念出口的完整中文短句，禁止“短板不明确、练了没重点、清单查短板、语法错9类”这类书面硬拼。商品身份只出现一次，禁止标题前后重复DELF、B2、TEF或TCF。',
        '除考试缩写和actual_content里已有的法语词外，不得在中文标题或副标题里夹入未翻译的英文单词。',
        '修复中文数量搭配：数字修饰“差异、原因、问题、方法、错误”等名词时必须带自然量词；禁止“4差异”“3原因”“必考差异”等不说人话的组合。标题和副标题也不得新增正文没有展开的评分、费用、出分速度或难度。',
        '返回JSON对象，顶层为candidates；每项严格保留{textTitle,coverTitle,coverSubtitle,mechanism,userRelation,seoKeyword,noveltyFingerprint}。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ context, candidates: payload }) },
  ], { maxTokens, temperature: 0.35, retries: 1 });
  return {
    candidates: (Array.isArray(result.data.candidates) ? result.data.candidates : [])
      .map(normalizePair)
      .filter((pair): pair is TitlePair => Boolean(pair)),
    usage: result.usage,
  };
}

function contentSupports(pair: TitlePair, input: TitleStageInput) {
  const content = [input.topic.topic, input.topic.promise, input.content.captionParts.opening, ...input.content.captionParts.value, ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || ''])])].join('');
  const titleTokens = semanticBigrams(`${pair.textTitle}${pair.coverTitle}`);
  const contentTokens = semanticBigrams(content);
  let hit = 0;
  for (const token of titleTokens) if (contentTokens.has(token)) hit += 1;
  return hit >= 2;
}

function contentNumbers(input: TitleStageInput) {
  const text = [
    input.topic.topic,
    input.topic.promise,
    ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...input.content.innerPages.flatMap(page => [page.page_title, page.lead, ...page.bullets]),
    input.content.captionParts.opening,
    ...input.content.captionParts.value,
  ].join(' ');
  return Array.from(new Set(text.match(/\d+(?:\.\d+)?/g) || [])).filter(token => token !== '2');
}

function titleNumbersSupported(pair: TitlePair, input: TitleStageInput) {
  const allowed = new Set(contentNumbers(input));
  const text = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`
    .replace(/DELF\s*B2|B2|TEF|TCF|CLB\s*7|2026/gi, '');
  if (!(text.match(/\d+(?:\.\d+)?/g) || []).every(token => allowed.has(token))) return false;
  const claims = quantityClaims(text);
  if (!claims.length) return true;
  const majorContent = [
    input.topic.topic,
    input.topic.promise,
    input.topic.contentAngle,
    ...input.content.coverBlocks.flatMap(block => [
      block.heading || '',
      `${block.items.length}项`,
      ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || '']),
    ]),
  ].join(' ');
  const supportedClaims = new Set(quantityClaims(majorContent));
  return claims.every(claim => supportedClaims.has(claim));
}

function quantityClaims(value: string) {
  const claims = value.match(/\d+(?:\.\d+)?\s*(?:个)?(?:步|项|点|类|组|份|篇|条|题|词|天|分钟|小时|维度|维)/g) || [];
  return Array.from(new Set(claims.map(item => item.replace(/\s|个/g, '').replace(/维度$/u, '维'))));
}

function numericTransformationSupported(pair: TitlePair, input: TitleStageInput) {
  const text = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const match = /从\s*(\d+)\s*词?.{0,6}(?:到|扩到|写到)\s*(\d+)\s*词?/i.exec(text);
  if (!match) return true;
  const target = Number(match[2]);
  return input.content.innerPages.some(page => countFrenchWords([page.lead, ...page.bullets].join(' ')) >= target);
}

function countFrenchWords(value: string) {
  return (value.match(/[A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+)*/g) || []).length;
}

function userRelationVisible(title: string, topic: TopicOption) {
  const relationText = `${topic.audienceState}${topic.scene}${topic.painOrDesire}`;
  if (topic.productId === 'tef_tcf_canada' && /选考|选错|选哪|怎么选|报名|纠结|不确定/.test(relationText)) {
    return /报名前|准备报名|要报名|选考|怕选错|别选错|选错|纠结|怎么选|选哪|还是|先别报名|别急着报名/.test(title);
  }
  const titleTokens = semanticBigrams(title);
  const relationTokens = semanticBigrams(relationText);
  for (const token of titleTokens) if (relationTokens.has(token)) return true;
  return /考前|备考|写不好|不会写|不会检查|写完没底|没把握|心里没底|总丢分|想提分|要考试|上班族|零基础|冲刺|刚开始|来不及|选考|怎么选|选哪个|怕选错|别选错|不确定|纠结|先看目标项目|选对|短板|练了没提高|练了没进步|只数语法|别数语法/.test(title);
}

function coverHasClickReason(title: string, input: TitleStageInput) {
  const utility = /大全|清单|速查|必查|整理好|对照|一页|全套|稀缺|考前|报名前|备考|自查|避坑|少走弯路|先看|看清/;
  const tension = /选错|丢分|低分|没提高|没进步|白练|白背|白准备|浪费|重来|来不及|别急|先别|最怕|致命|反常识|竟然|原来|救急|冲刺|没把握|没底|心里没底|练了很多|别数语法/;
  const outcome = /提分|高分|写出来|会展开|看懂|搞懂|找短板|短板|定方向|选对|用得上/;
  void input;
  return tension.test(title) || outcome.test(title) || utility.test(title);
}

function textHasConcretePayoff(title: string) {
  return /自查|检查|清单|评分|短板|扣分|差异|题型|目标项目|一张表|字数|\d+层|选择|路线|计划|步骤|方法|范文|模板|句型|词汇|语法|连接词|资料|大全|速查|错误|写完|报名前|选对|定位|找到|看懂|写够|提分|高分/.test(title);
}

function classifyTitleMechanism(pair: TitlePair): TitleMechanism {
  const declared = pair.mechanism.toLowerCase();
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  if (/cognitive_conflict|反常识|认知冲突|争议|挑战/.test(declared)) return 'cognitive_conflict';
  if (/loss_tension|恐惧|损失|风险|避坑|警告/.test(declared)) return 'loss_tension';
  if (/result_gain|结果|收益|行动|获得感/.test(declared)) return 'result_gain';
  if (/search_utility|搜索|资料|清单|大全|稀缺|时效/.test(declared)) return 'search_utility';
  if (/原来|竟然|反而|越.+越|不是.+而是|别再|误区|真相/.test(title)) return 'cognitive_conflict';
  if (/选错|丢分|白练|白背|浪费|来不及|后悔|最怕|致命|千万别/.test(title)) return 'loss_tension';
  if (/提分|高分|写出来|会展开|选对|省时间|少走弯路|搞懂|看懂/.test(title)) return 'result_gain';
  return 'search_utility';
}

function preferredTitleMechanisms(input: TitleStageInput) {
  const preferred = new Set<TitleMechanism>();
  for (const value of input.capability.allowedTitleMechanisms) {
    if (/资料|大全|稀缺|时效/.test(value)) preferred.add('search_utility');
    if (/情绪/.test(value)) preferred.add('loss_tension');
    if (/反常识/.test(value)) preferred.add('cognitive_conflict');
    if (/结果/.test(value)) preferred.add('result_gain');
  }
  return preferred;
}

function titleMotifs(value: string) {
  const motifs = new Set<string>();
  const groups: Array<[string, RegExp]> = [
    ['uncertainty', /没底|没把握|心里没底|不知道好坏/],
    ['weakness', /短板|弱项|最弱|定位/],
    ['self_check', /自查|检查|核对|查漏/],
    ['wasted_effort', /白练|白背|没进步|没提高|练了很多/],
    ['deadline', /考前|冲刺|来不及|最后\d+天|最后\d+分钟/],
    ['choice_anxiety', /选错|纠结|怎么选|选哪个|报名前/],
    ['material_gain', /资料|大全|清单|速查|整理好|一张表/],
    ['score_loss', /丢分|扣分|低分|分数上不去/],
  ];
  for (const [name, pattern] of groups) if (pattern.test(value)) motifs.add(name);
  return motifs;
}

function recentTitlePenalty(pair: TitlePair, records: Array<{ title: string; cover_title: string }>, classifier: TitleCategoryFn = classifyTitleMechanism) {
  const recent = records.slice(-16);
  const candidateMotifs = titleMotifs(`${pair.textTitle} ${pair.coverTitle}`);
  const mechanism = classifier(pair);
  let motifHits = 0;
  let mechanismHits = 0;
  for (const record of recent) {
    const prior = `${record.title || ''} ${record.cover_title || ''}`;
    const priorMotifs = titleMotifs(prior);
    if ([...candidateMotifs].some(item => priorMotifs.has(item))) motifHits += 1;
    if (classifier({ ...pair, textTitle: record.title || '', coverTitle: record.cover_title || '', coverSubtitle: undefined, mechanism: '' }) === mechanism) mechanismHits += 1;
  }
  return Math.min(32, motifHits * 5) + Math.min(16, mechanismHits * 2);
}

function diversifyCandidates(
  candidates: TitlePair[],
  input: TitleStageInput,
  records: Array<{ title: string; cover_title: string }>,
  classifier: TitleCategoryFn = classifyTitleMechanism,
  categories?: string[],
) {
  const bucketKeys: string[] = categories && categories.length
    ? categories
    : ['search_utility', 'loss_tension', 'cognitive_conflict', 'result_gain'];
  const buckets = new Map<string, TitlePair[]>(bucketKeys.map(key => [key, []]));
  for (const candidate of candidates) buckets.get(classifier(candidate))?.push(candidate);
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => recentTitlePenalty(a, records, classifier) - recentTitlePenalty(b, records, classifier));
  }
  const ordered: TitlePair[] = [];
  for (let index = 0; index < 3; index += 1) {
    for (const mechanism of bucketKeys) {
      const candidate = buckets.get(mechanism)?.[index];
      if (candidate) ordered.push(candidate);
    }
  }
  const included = new Set(ordered);
  return [...ordered, ...candidates.filter(candidate => !included.has(candidate))];
}

function selectTitleCandidate(
  candidates: TitlePair[],
  input: TitleStageInput,
  templates: Map<string, number>,
  records: Array<{ title: string; cover_title: string }>,
) {
  const preferred = preferredTitleMechanisms(input);
  const compatible = preferred.size
    ? candidates.filter(candidate => preferred.has(classifyTitleMechanism(candidate)))
    : candidates;
  const pool = compatible.length ? compatible : candidates;
  return pool.slice().sort((a, b) => scorePair(b, input, templates, records) - scorePair(a, input, templates, records))[0];
}

function introducesUnsupportedFacet(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const actual = [
    ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...input.content.innerPages.flatMap(page => [page.page_title, page.lead, ...page.bullets]),
    input.content.captionParts.opening,
    ...input.content.captionParts.value,
  ].join(' ');
  const facets: Array<[RegExp, RegExp]> = [
    [/评分|分数|评分方式/, /评分|分数|评分方式/],
    [/费用|报名费|价格/, /费用|报名费|价格/],
    [/出分|查分|成绩速度/, /出分|查分|成绩速度/],
    [/难度|更难|更简单/, /难度|更难|更简单/],
  ];
  return facets.some(([inTitle, inContent]) => inTitle.test(title) && !inContent.test(actual));
}

function scorePair(
  pair: TitlePair,
  input: TitleStageInput,
  templates: Map<string, number>,
  records: Array<{ title: string; cover_title: string }>,
) {
  let score = 0;
  const title = `${pair.textTitle} ${pair.coverTitle}`;
  if (title.includes(input.topic.seo.primary)) score += 10;
  if (userRelationVisible(pair.coverTitle, input.topic)) score += 12;
  else score -= 12;
  if (coverHasClickReason(pair.coverTitle, input)) score += 12;
  else score -= 15;
  if (textHasConcretePayoff(pair.textTitle)) score += 10;
  else score -= 15;
  if (preferredTitleMechanisms(input).has(classifyTitleMechanism(pair))) score += 18;
  if (/\d+类(?:语法)?错|清单查短板|\d+维度自查定位|语法错\d+类/.test(title)) score -= 60;
  score += Math.min(18, majorContentOverlap(pair, input) * 3);
  const template = titleTemplateFingerprint(pair.textTitle);
  if (template) score -= Math.min(32, (templates.get(template) || 0) * 8);
  score -= recentTitlePenalty(pair, records);
  const length = countVisibleUnits(pair.textTitle);
  if (length >= 15 && length <= 20) score += 4;
  if (/[？?]/.test(pair.textTitle) && /[？?]/.test(pair.coverTitle)) score -= 6;
  return score;
}

function majorContentOverlap(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle}${pair.coverTitle}`.replace(/DELF|B2|TEF|TCF|Canada|法语|写作/gi, '');
  const major = [input.topic.topic, input.topic.promise, input.topic.contentAngle, ...input.content.coverBlocks.map(block => block.heading || '')].join('');
  const titleTokens = semanticBigrams(title);
  const majorTokens = semanticBigrams(major);
  let hit = 0;
  for (const token of titleTokens) if (majorTokens.has(token)) hit += 1;
  return hit;
}

function normalizePair(raw: Partial<TitlePair> & Record<string, unknown>): TitlePair | null {
  const textTitle = normalizeNaturalCounters(clean(raw.textTitle) || clean(raw.title) || clean(raw.text_title));
  const coverTitle = normalizeNaturalCounters(clean(raw.coverTitle) || clean(raw.cover_title));
  if (!textTitle || !coverTitle) return null;
  return {
    textTitle,
    coverTitle,
    coverSubtitle: normalizeNaturalCounters(clean(raw.coverSubtitle) || clean(raw.cover_subtitle)) || undefined,
    mechanism: clean(raw.mechanism) || clean(raw.title_type) || clean(raw.trigger_type) || '好奇缺口',
    userRelation: clean(raw.userRelation) || clean(raw.user_relation) || clean(raw.reason),
    seoKeyword: clean(raw.seoKeyword) || clean(raw.seo_keyword) || undefined,
    noveltyFingerprint: clean(raw.noveltyFingerprint) || clean(raw.novelty_fingerprint) || stableHash(`${textTitle}|${coverTitle}`),
  };
}

function normalizeNaturalCounters(value: string) {
  return value
    .replace(/\s*\bweakest\b\s*/gi, '最弱')
    .replace(/(\d+)\s*(差异|原因|问题|方法|错误|误区)/g, '$1个$2')
    .replace(/(\d+)\s*步骤/g, '$1个步骤')
    .replace(/语法错(\d+)类/g, '$1类语法错误')
    .replace(/必考差异/g, '关键差异');
}

function dedupeCandidates(candidates: TitlePair[], classifier: TitleCategoryFn = classifyTitleMechanism) {
  const seenExact = new Set<string>();
  const seenSemantic = new Set<string>();
  return candidates.filter(item => {
    const exactKey = `${fingerprintTitle(item.textTitle)}|${fingerprintTitle(item.coverTitle)}`;
    if (seenExact.has(exactKey)) return false;
    seenExact.add(exactKey);
    const objects = `${item.textTitle}${item.coverTitle}`.match(/自查|检查|评分|短板|差异|题型|范文|模板|句型|词汇|语法|连接词|资料|大全|速查|错误|选考|报名/g) || [];
    const motifs = [...titleMotifs(`${item.textTitle} ${item.coverTitle}`)].sort();
    const semanticKey = `${classifier(item)}|${motifs.join(',')}|${Array.from(new Set(objects)).sort().join(',')}`;
    if ((motifs.length || objects.length) && seenSemantic.has(semanticKey)) return false;
    seenSemantic.add(semanticKey);
    return true;
  });
}

function isUnnatural(value: string) {
  return /资料太散|卡住|卡在这一步|拖后腿|拖分|正在白背|格式正在|偷走|写作任务|多数人|真正的原因|你以为|不是.+而是|短板不明确|练了没重点|\d+类(?:语法)?错|清单查短板|\d+维度自查定位|语法错\d+类|(?:定位|适合|帮|让|告诉|解决)你的$/.test(value);
}

function hasRedundantIdentity(value: string, productId: TopicOption['productId']) {
  if (productId === 'delf_b2_writing') {
    return (value.match(/DELF/gi) || []).length > 1 || (value.match(/B2/gi) || []).length > 1;
  }
  return (value.match(/TEF/gi) || []).length > 1 || (value.match(/TCF/gi) || []).length > 1;
}

function hasOversimplifiedExamChoice(value: string) {
  return /(?:强|弱|喜欢|偏好|擅长).{0,8}(?:就?选|更适合)(?:TEF|TCF)|(?:直接|就)选(?:TEF|TCF)/i.test(value);
}

function titleGateFailures(pair: TitlePair, input: TitleStageInput, selected: Set<string>, coverTitles: Set<string>) {
  const failures: string[] = [];
  const coverRange = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  const textLength = countVisibleUnits(pair.textTitle);
  const coverLength = countVisibleUnits(pair.coverTitle);
  if (textLength < 12 || textLength > 20) failures.push(`文字标题${textLength}字，不在12-20字`);
  if (coverLength < coverRange[0] || coverLength > coverRange[1]) failures.push(`封面标题${coverLength}字，不在${coverRange[0]}-${coverRange[1]}字`);
  if (!hasRequiredProductIdentity(input.topic.productId, pair.textTitle)) failures.push('文字标题缺商品考试身份');
  if (!hasRequiredProductIdentity(input.topic.productId, pair.coverTitle)) failures.push('封面标题缺商品考试身份');
  if (hasForbiddenProductIdentity(input.topic.productId, `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`)) failures.push('混入了另一个商品或考试身份');
  if (hasRedundantIdentity(pair.textTitle, input.topic.productId) || hasRedundantIdentity(pair.coverTitle, input.topic.productId)) failures.push('同一标题重复写了考试身份');
  if (!userRelationVisible(pair.coverTitle, input.topic)) failures.push('封面标题没有写出与用户状态、痛点或阶段的关系');
  if (!coverHasClickReason(pair.coverTitle, input)) failures.push('封面标题只是内容摘要，没有风险、阶段、结果或资料获得感');
  if (!textHasConcretePayoff(pair.textTitle)) failures.push('文字标题只有泛口号，没有写出具体问题、方法或获得感');
  if (!pair.userRelation) failures.push('候选没有说明它与用户的关系');
  if (hasOversimplifiedExamChoice(`${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`)) failures.push('把单一强弱项武断等同于考试选择');
  if (!titleNumbersSupported(pair, input)) failures.push('使用了正文没有的数字');
  if (!numericTransformationSupported(pair, input)) failures.push('标题承诺的扩写词数没有完整示例支撑');
  if (introducesNewPain(pair, input)) failures.push('标题新增了选题和实际内容中都不存在的具体痛点或症状');
  if (introducesUnsupportedFacet(pair, input)) failures.push('标题或副标题新增了正文没有展开的比较维度');
  if (!contentSupports(pair, input)) failures.push('标题核心对象没有被本篇内容支撑');
  if (isUnnatural(pair.textTitle) || isUnnatural(pair.coverTitle)) failures.push('存在机器化或不说人话表达');
  if (/[：:，、]$/u.test(pair.textTitle) || /[：:，、]$/u.test(pair.coverTitle)) failures.push('标题句尾残缺');
  // 阶段 D（设计 §5 末尾 / §6.2）：标题承诺超出本篇可承诺范围只进返修级 failures，不加硬拦、不动内容阶段。
  if (resolveTitleConsensusActive(input.topic.productId, input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value')) {
    const beyondRange = titlePromiseBeyondRange(pair, input.topic);
    if (beyondRange) failures.push(beyondRange);
  }
  if (selected.has(fingerprintTitle(pair.textTitle)) || coverTitles.has(fingerprintTitle(pair.coverTitle))) failures.push('与近期标题重复');
  return failures;
}

function semanticBigrams(value: string) {
  const cleanText = value.toLowerCase().replace(/DELF|TEF|TCF|Canada|B2|CLB7|法语|写作|备考|资料|知识库|[\s\p{P}\p{S}]/gu, '');
  const set = new Set<string>();
  for (let i = 0; i < cleanText.length - 1; i += 1) set.add(cleanText.slice(i, i + 2));
  return set;
}

function toMigrated(topic: TopicOption): MigratedTopic {
  return {
    id: topic.id,
    topic_type: topic.primaryGoal === 'search' ? 'search_pain' : topic.primaryGoal === 'conversion' ? 'product_showcase' : topic.primaryGoal === 'save' ? 'selling_point' : 'narrow_knowledge',
    topic: topic.topic,
    audience: topic.audienceState,
    scene: topic.scene,
    pain: topic.painOrDesire,
    content_promise: topic.promise,
    product_bridge: topic.productBridge,
    why_this_reference_fits: topic.contentAngle,
    novelty: topic.noveltyFingerprint,
    search_terms: [topic.seo.primary, ...topic.seo.related],
    content_source_plan: { knowledge_base: '', ai_original: '' },
    title_trigger_types: topic.seedSignals,
  };
}

function artifact(data: TitlePackage, inputHash: string, usage: AiUsageSummary, requestId: string, warnings: string[]): VersionedArtifact<TitlePackage> {
  return { data, schema_version: V2_SCHEMA_VERSION, prompt_version: TITLE_PROMPT_VERSION, input_hash: inputHash, created_at: new Date().toISOString(), usage, warnings, request_id: requestId };
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
