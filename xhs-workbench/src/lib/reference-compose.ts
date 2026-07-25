import { callOpenAICompatibleJson } from '@/lib/ai-client';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getDenseDirectoryTitleFormulas } from '@/lib/full-title-formula-catalog';
import { collectFrenchCheckTargets, findSuspiciousFrenchTokens } from '@/lib/french-spellcheck';
import { getCoverTemplatePrompt, getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { retrieveProductFacts } from '@/lib/product-fact-retrieval';
import { normalizeDenseDirectoryCover, validateReferenceDraft } from '@/lib/reference-workflow-validation';
import type { ProductId } from '@/types/data';
import type {
  GeneratedInnerPage,
  MigratedTopic,
  ReferenceDrivenDraft,
  TitleCandidate,
  UnifiedContentBrief,
} from '@/types/reference-workflow';

export type ProductCard = NonNullable<ReturnType<typeof getCompetitorCreativeCard>>;

export interface GenerateTopicsInput {
  productId: ProductId;
  card: ProductCard;
  productContext: unknown;
  direction: string;
}

export interface ComposeDraftInput {
  productId: ProductId;
  card: ProductCard;
  topic: MigratedTopic;
  evidence: ReturnType<typeof retrieveProductFacts>;
}

export async function generateTopics(input: GenerateTopicsInput): Promise<MigratedTopic[]> {
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const result = await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是资深小红书法语学习内容主编。任务不是套模板，而是像真人编辑一样，从竞品成功机制出发迁移选题。',
        '只返回JSON。必须给出3个真正不同、值得发布、可以由当前商品或正确科普内容支撑的选题。',
        '人群、场景、痛点、内容和商品承接必须构成一条自然关系，禁止随机拼接。',
        '不要把商品资料里没有的内容说成商品自带；AI可以原创正确的科普、例句和练习。',
        '商品1考试名称只能写DELF B2，绝不能写DALF；商品2只能写TEF/TCF Canada。',
        '任何给用户看的字段都不许出现AU-001、CH-085等内部ID，也不要出现括号里的内部标签。',
        '商品事实可用于判断，但选题表述必须像真人编辑说话，简洁、具体，避免“实现跃迁、四合一、全局观”等企划腔。',
        templatePrompt,
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        optional_direction: input.direction,
        competitor_creative_card: input.card,
        product_map_material: input.productContext,
        output_schema: {
          topics: [{
            id: 'topic_1',
            topic: '一句话选题',
            audience: '具体人群和阶段',
            scene: '具体使用场景',
            pain: '具体行为或卡点',
            content_promise: '用户点开后实际得到什么',
            product_bridge: '如何自然连接商品；不需要强卖',
            why_this_reference_fits: '为什么适合当前高密度资料封面',
            novelty: '与常规法语清单有什么不同',
            search_terms: ['用于检索本地知识库的关键词'],
            content_source_plan: {
              knowledge_base: '优先从商品里找什么',
              ai_original: '知识库不足时AI可以原创什么',
            },
          }],
        },
      }),
    },
  ], { maxTokens: 3000, retries: 3 });
  const root = asRecord(result);
  const topics: MigratedTopic[] = Array.isArray(root.topics)
    ? root.topics.map(normalizeTopic).filter((topic): topic is MigratedTopic => topic !== null)
    : [];
  if (topics.length < 3) throw new Error('AI没有返回3个可用迁移选题');
  return topics.slice(0, 3);
}

export async function composeDraft(input: ComposeDraftInput): Promise<ReferenceDrivenDraft> {
  const spec = getCoverTemplateSpec(input.card.renderer_id);
  if (!spec) throw new Error('封面模板规格不存在');
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const editorialPromise = generateEditorialOutput(input);
  const coreResult = await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是资深小红书法语编辑兼出版物信息设计师。根据已确认选题生成一套可直接进入模板的笔记数据，只返回JSON。',
        '整篇只能讲一件事。笔记文字标题、封面标题、内页和正文必须共享同一个核心承诺，但两种标题承担不同任务，禁止强行写成同一句。',
        templatePrompt,
        `primary视觉长度不得超过${spec.maxPrimaryVisualLength}，secondary视觉长度不得超过${spec.maxSecondaryVisualLength}；超出的解释和例句移到内页。`,
        '每条必须让普通中国备考者一眼看懂：primary写法语词/短语或中文知识点，secondary给简短中文释义。禁止只写vocabulaire B2、concordance等无解释的内部速记，禁止把条目写成冗长的是非问句。',
        '每条法语和备考规则输出前先自查准确性。禁止把建议写成官方硬规则；禁止声称每段必须空行、Cordialement一律错误、每个论点必须有数据。必须区分正式信与论坛投稿。',
        '禁止自创数量门槛，例如“至少2个B2级词汇”“至少1个虚拟式”“每段必须1个连接词”。词汇等级没有可机械计数的官方清单，虚拟式也只在语义需要时使用。',
        '知识库证据可直接引用或改写；AI原创内容必须保持法语正确，source_type标为ai_original或mixed。',
        '商品数量、模块、服务只能来自给定证据。科普、例句、练习可以原创。',
        '笔记文字标题不超过22个字符，至少提供3个不同心理触发的候选；它负责搜索和点击，可以使用情绪、好奇、反常识或损失感，不得机械使用“XXX？YYY”的同一种句式。',
        '75个公式只服务于笔记文字标题：先自然原创，再把公式作为灵感进行仿写，禁止为了套公式扭曲内容。候选中恰好包含1个自然原创标题（formula_id=free_original）、1个公式仿写标题（使用给定公式ID）和1个竞品机制迁移标题（formula_id=reference_migration）。',
        `封面标题不使用75个爆款公式。${spec.titleInstruction}`,
        '例如：笔记文字标题“法语B2写作越改越乱？先查这5类”；封面标题“DELF B2写作自查体系”；副标题“5类25项，交卷前逐项检查”。只参考分工，不得照抄。',
        '封面标题或副标题若写具体数量（N句/个/条/项），N必须等于封面实际条目总数；写N类/组时必须等于分组数。拿不准就不要写具体数字。',
        '标题必须像中国用户自然说话，读出声不拗口。标题至少有明确对象、具体利益或信息缺口中的两项。',
        '每个笔记文字标题和封面主标题都必须出现“法语”、DELF B2、TEF或TCF中的至少一个，让用户一眼知道领域。',
        '标题和封面都禁止“万能、必背、捷径、阅卷老师看重、考官最想要、考官追着给分、扣10分、保分、必过、白考”等无法证明或廉价夸张的词。',
        '没有明确证据时，禁止任何百分比、多少人会用、多少考生不知道、星级标记、具体扣分或提分数字。',
        '任何用户可见内容不得出现AU-、CH-、FW-、GD-等内部编号。商品1永远写DELF B2，绝不能写DALF。',
        '这一轮只生成统一任务单、标题和封面内容，不写正文和内页。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        competitor_creative_card: input.card,
        confirmed_topic: input.topic,
        retrieved_product_evidence: input.evidence,
        title_formula_candidates: getDenseDirectoryTitleFormulas(input.topic.topic),
        output_schema: {
          brief: {
            product_id: input.productId,
            reference_card_id: input.card.id,
            topic: '', audience: '', scene: '', pain: '', content_value: '', content_shape: 'dense_directory',
            selling_point: '', buying_reason: '', product_claim_limit: '', knowledge_base_plan: '', ai_original_plan: '',
            cover_requirement: '', difference_from_recent: '',
          },
          title_candidates: [{
            title: '', formula_id: '', trigger_type: '', formula_skeleton: '', reason: '', risk_flags: [],
          }],
          selected_title: '',
          cover: {
            kind: 'dense_directory', title: '', subtitle: '',
            sections: [{
              side_label: '2至4字', heading: '分组标题', columns: 3,
              items: [{ primary: '知识点', secondary: '可选法语或解释', note: '' }],
              source_type: 'knowledge_base|ai_derived|ai_original|mixed', source_ids: [],
            }],
          },
        },
      }),
    },
  ], { maxTokens: 6500, retries: 3 });

  const core = asRecord(coreResult);
  const brief = normalizeBrief(core.brief, input);
  const allowedTitleFormulas = getDenseDirectoryTitleFormulas(input.topic.topic);
  const allowedTitleFormulaIds = new Set(allowedTitleFormulas.map(item => item.id));
  let titleCandidates = normalizeTitles(core.title_candidates, allowedTitleFormulaIds);
  let cover = ensureCoverIdentity(normalizeDenseDirectoryCover(core.cover), input.card.renderer_id);
  titleCandidates = ensureTitleCandidateMix(titleCandidates, allowedTitleFormulas, cover.title);
  let selectedTitle = chooseSafeTitle(core.selected_title, titleCandidates, cover.title);
  ({ titleCandidates, selectedTitle } = syncTitlesWithCoverCounts(titleCandidates, selectedTitle, cover));
  let coreIssues = getCoreIssues(titleCandidates, cover, input.card.renderer_id);
  for (let repairAttempt = 0; coreIssues.length && repairAttempt < 3; repairAttempt += 1) {
    const repairResult = await repairCoreOutput({
      brief,
      titleCandidates,
      selectedTitle,
      cover,
      issues: coreIssues,
      evidence: input.evidence,
      allowedTitleFormulas,
      renderer: input.card.renderer_id,
    });
    const repaired = asRecord(repairResult);
    titleCandidates = normalizeTitles(repaired.title_candidates, allowedTitleFormulaIds);
    cover = ensureCoverIdentity(normalizeDenseDirectoryCover(repaired.cover), input.card.renderer_id);
    titleCandidates = ensureTitleCandidateMix(titleCandidates, allowedTitleFormulas, cover.title);
    selectedTitle = chooseSafeTitle(repaired.selected_title, titleCandidates, cover.title);
    ({ titleCandidates, selectedTitle } = syncTitlesWithCoverCounts(titleCandidates, selectedTitle, cover));
    coreIssues = getCoreIssues(titleCandidates, cover, input.card.renderer_id);
  }
  if (coreIssues.length) throw new Error(`标题或封面返修后仍未达标：${coreIssues.join(', ')}`);

  const editorialResult = await editorialPromise;

  let editorial = asRecord(editorialResult);
  let innerPages = normalizePages(editorial.inner_pages);
  let caption = sanitizePublicText(asString(editorial.caption));
  const seoKeywords = buildSeoKeywords(input.productId, input.topic);
  let tags = normalizeTags(editorial.tags, seoKeywords);
  innerPages = ensureMinimumInnerPages(innerPages, cover);
  caption = ensurePublishableCaption(caption, seoKeywords[0], cover);
  const editorialIssues = getEditorialIssues(innerPages, caption, seoKeywords);
  if (editorialIssues.length) {
    editorial = asRecord(await repairEditorialOutput({ brief, selectedTitle, cover, evidence: input.evidence, issues: editorialIssues, seoKeywords }));
    innerPages = normalizePages(editorial.inner_pages);
    caption = sanitizePublicText(asString(editorial.caption));
    tags = normalizeTags(editorial.tags, seoKeywords);
    innerPages = ensureMinimumInnerPages(innerPages, cover);
    caption = ensurePublishableCaption(caption, seoKeywords[0], cover);
    const remainingIssues = getEditorialIssues(innerPages, caption, seoKeywords);
    if (remainingIssues.length) throw new Error(`内页或正文返修后仍未达标：${remainingIssues.join(', ')}`);
  }
  let audited = await auditEducationalContent({
    productId: input.productId,
    cover,
    innerPages,
    evidence: input.evidence,
    renderer: input.card.renderer_id,
  });
  for (let auditAttempt = 0; !audited.summary.approved && auditAttempt < 2; auditAttempt += 1) {
    audited = await auditEducationalContent({
      productId: input.productId,
      cover: audited.cover,
      innerPages: audited.innerPages,
      evidence: input.evidence,
      renderer: input.card.renderer_id,
    });
  }
  if (!audited.summary.approved) {
    throw new Error(`法语与考试事实审校未通过：${audited.summary.issues.join('；')}`);
  }
  cover = audited.cover;
  innerPages = audited.innerPages;
  const draft: ReferenceDrivenDraft = {
    id: `draft_${Date.now()}`,
    brief,
    title_candidates: titleCandidates,
    selected_title: selectedTitle,
    cover,
    inner_pages: innerPages,
    caption,
    tags,
    seo_keywords: seoKeywords,
    accuracy_audit: audited.summary,
    evidence: input.evidence,
    checks: {
      title_cover_consistent: false,
      template_capacity_ok: false,
      product_claims_grounded: false,
      content_density_ok: false,
      issues: [],
    },
  };
  draft.checks = validateReferenceDraft(draft, input.card.renderer_id);
  return draft;
}

export async function auditEducationalContent(input: {
  productId: ProductId;
  cover: ReturnType<typeof normalizeDenseDirectoryCover>;
  innerPages: GeneratedInnerPage[];
  evidence: ReturnType<typeof retrieveProductFacts>;
  renderer: ProductCard['renderer_id'];
}) {
  const family = getCoverTemplateSpec(input.renderer)?.family;
  const result = asRecord(await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是严谨的法语教师和DELF/TEF内容审校员。只做事实审校，不改文风，不扩写，只返回JSON。',
        '检查法语语法、拼写、搭配、语域、中文释义、考试任务类型和规则表述。',
        '重点找：把建议写成官方强制要求、正式信与论坛投稿混用、敬语适用范围错误、真正写错的法语、绝对化结论、虚构“至少N个B2词汇/虚拟式/连接词”等数量门槛。',
        '检查用户可理解性：法语术语必须配清楚的中文含义，不能留下vocabulaire B2、concordance等只有作者自己懂的速记。',
        '封面短条目允许是合法法语词干/搭配开头（例如 Pour remédier à cette、Je sollicite votre），也允许以"..."结尾表示句子刻意未写完、留给读者自行续写；完整补全放在内页；不要把“条目偏短/未补全整句/以...结尾”判成 error。',
        '“避免说：口语表达”这类语域对照，只要口语句本身没错且意图是提醒正式语域，标 warning 即可，不要当 error。',
        '只有拼写错误、错误变位、错误搭配、错误敬语、虚假考试规则才标 error。',
        '你只负责法语语法/搭配/敬语和考试规则事实的正确性，不负责评价中文表达是否够正式、够精确、够地道；像"字数失控/时间分配"这类中文短语只要意思清楚、没有事实错误，禁止标 error，最多标 warning。法语术语没配中文释义、可打印成一句更完整的表达，这类可读性建议同样最多 warning，不能 error。',
        '只对确定有错或明显误导的地方给修正；不确定时标为warning，不要凭空新增规则。',
        '每条issue的problem必须给出单一、确定的结论，禁止先说"有错误"又说"无错误/无误/正确/无问题"这种自我否定或自我改判的表述；如果分析到最后发现其实没有错误、只是更地道的表达偏好、或者是封面短条目允许的词干/未完整礼貌结语，直接把severity设为warning或完全不放进issues数组，不要标severity为error后又在problem里说它其实不构成错误。',
        '检查每个法语词/短语本身是否是真实存在、拼写完整的词形；如果像是被截断或多个词拼接在一起产生的不存在词形（例如缺少空格、词尾被截断后接了另一个词），必须标为error并给出修正。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        cover_family: family,
        cover: input.cover,
        inner_pages: input.innerPages,
        supporting_evidence: input.evidence,
        output_schema: {
          approved: true,
          issues: [{ severity: 'error|warning', location: 'cover.sections[0].items[0].primary 或 inner_pages[0].bullets[0] 这种点/方括号路径', problem: '', correction: '' }],
          cover_corrections: [{ section_index: 0, item_index: 0, primary: '', secondary: '', note: '' }],
          page_corrections: [{ page_index: 0, bullet_index: 0, corrected_text: '' }],
        },
      }),
    },
  ], { maxTokens: 2600, retries: 2, temperature: 0.15 }));

  const coverCopy = structuredClone(input.cover);
  const pagesCopy = structuredClone(input.innerPages);
  let correctedCount = 0;
  const correctedLocations = new Set<string>();
  if (Array.isArray(result.cover_corrections)) {
    for (const value of result.cover_corrections) {
      const correction = asRecord(value);
      const section = coverCopy.sections[Number(correction.section_index)];
      const item = section?.items[Number(correction.item_index)];
      if (!item) continue;
      const primary = sanitizePublicText(asString(correction.primary));
      const secondary = sanitizePublicText(asString(correction.secondary));
      const note = sanitizePublicText(asString(correction.note));
      const baseLocation = `cover.sections[${Number(correction.section_index)}].items[${Number(correction.item_index)}]`;
      if (primary) { item.primary = primary; correctedLocations.add(`${baseLocation}.primary`); }
      if (secondary) { item.secondary = secondary; correctedLocations.add(`${baseLocation}.secondary`); }
      if (note) { item.note = note; correctedLocations.add(`${baseLocation}.note`); }
      correctedCount += 1;
    }
  }
  if (Array.isArray(result.page_corrections)) {
    for (const value of result.page_corrections) {
      const correction = asRecord(value);
      const page = pagesCopy[Number(correction.page_index)];
      const bulletIndex = Number(correction.bullet_index);
      const correctedText = sanitizePublicText(asString(correction.corrected_text));
      if (!page || !page.bullets[bulletIndex] || !correctedText) continue;
      page.bullets[bulletIndex] = correctedText;
      correctedLocations.add(`inner_pages[${Number(correction.page_index)}].bullets[${bulletIndex}]`);
      correctedCount += 1;
    }
  }
  const issueRecords = Array.isArray(result.issues)
    ? result.issues.map(value => {
        const issue = asRecord(value);
        return {
          severity: asString(issue.severity).toLowerCase(),
          location: asString(issue.location),
          problem: asString(issue.problem),
        };
      }).filter(issue => issue.location || issue.problem)
    : [];
  const truncationTolerantFamily = family === 'phrase' || family === 'document';
  const falsePositivePattern = truncationTolerantFamily
    ? /不完整|缺少动词|缺少名词|缺少完整|缺少\s*[“"]?que|条目偏短|未补全|应补全为整句|避免说|\.\.\.[\s\S]{0,30}?(缺少|应为|应接|应补全)|(缺少|应为|应接)[\s\S]{0,30}?\.\.\./
    : /应改为\s*同句|避免说/;
  const selfContradictionPattern = /无错误|无误|没有错误|并无不妥|表述正确|无问题|是正确的|并无问题|应改为\s*warning|标记?为?错误不准确|更(自然|地道|准确)(?!.{0,6}(拼写|变位|搭配)错)|不(是|算|构成)错误|并非错误|不构成问题/;
  // The model writes "location" as free text ("cover > sections[0] > items[2]
  // > primary", "cover.sections[0].items[2].primary", etc.) so an exact-string
  // match against our internally-tracked dot/bracket paths almost never hits.
  // That silently defeats "don't count issues we already corrected" - the
  // field gets fixed but the stale issue about the old text still blocks
  // approval. Normalize both sides to bare alphanumerics before comparing.
  const normalizeLocation = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const normalizedCorrectedLocations = [...correctedLocations].map(normalizeLocation);
  const llmIssues = issueRecords
    .filter(issue => issue.severity === 'error')
    .filter(issue => {
      const normalized = normalizeLocation(issue.location);
      return !normalizedCorrectedLocations.some(location => normalized === location || normalized.startsWith(location));
    })
    .filter(issue => !falsePositivePattern.test(issue.problem))
    .filter(issue => !selfContradictionPattern.test(issue.problem))
    .map(issue => `${issue.location}：${issue.problem}`.replace(/^：/, ''));

  // Deterministic second layer: a real French dictionary lookup, independent
  // of whatever the LLM audit above did or didn't catch. This is not a
  // matter of judgement (word exists or it doesn't), so high-confidence
  // findings (a token that decomposes into two real words glued together)
  // are treated as hard errors and feed the same repair loop as LLM issues.
  // Plain "not in this dictionary" hits are kept as non-blocking, human-
  // reviewable notes since they can be proper nouns or rare-but-real words.
  let dictionaryErrors: string[] = [];
  let dictionaryWarnings: string[] = [];
  try {
    const findings = await findSuspiciousFrenchTokens(collectFrenchCheckTargets(coverCopy, pagesCopy));
    dictionaryErrors = findings
      .filter(f => f.certain)
      .map(f => `${f.location}：词典硬校验发现疑似缺空格拼接词"${f.token}"，可能应为"${f.suggestion}"`);
    dictionaryWarnings = findings
      .filter(f => !f.certain)
      .slice(0, 5)
      .map(f => `${f.location}：词典未收录"${f.token}"（可能是专有名词或生僻词，仅供人工复核，不阻塞发布）`);
  } catch {
    // Dictionary unavailable for some reason - degrade to LLM-only audit rather than failing the whole request.
  }

  const issues = [...llmIssues, ...dictionaryErrors].slice(0, 12);
  return {
    cover: normalizeDenseDirectoryCover(coverCopy),
    innerPages: pagesCopy,
    summary: {
      approved: !issues.length,
      corrected_count: correctedCount,
      issues: [...issues, ...dictionaryWarnings],
    },
  };
}

function generateEditorialOutput(input: ComposeDraftInput) {
  const sharedBrief = normalizeBrief({}, input);
  const seoKeywords = buildSeoKeywords(input.productId, input.topic);
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是资深小红书法语内容编辑。选题、人群、场景、痛点和内容承诺已经锁定，不能另起主题。只返回JSON。',
        '生成4-6张真正给用户看的内页，以及一篇可直接发布的正文。内页不是把正文切片粘贴。',
        '每张内页必须有具体知识、例子、对照、步骤或练习；禁止写幕后设计意图。',
        '正文控制在300-500个中文字符，图片已经承载干货，正文只补充使用方法、关键提醒和自然商品承接。',
        '商品事实只能来自证据；正确科普、法语例句、练习可以原创，但不能伪装成商品自带内容。',
        '逐条核对法语语法、搭配、语域和适用场景；不确定就删除。不要把学习建议描述成DELF官方强制规则。',
        '核心搜索词必须自然出现在正文前80字，长尾词自然出现1次，不能堆砌。',
        '禁止“不是……而是……”“问题的关键”“很多同学都会遇到”等AI套话。商品1只能写DELF B2。',
        `当前封面创作卡要求：${templatePrompt}`,
        '内页要承接封面未展开的信息：短条目在封面，完整解释、例句、对照、使用条件和练习进入内页。内页顺序应形成“看懂主题→获得方法→看到例子→能够自查→自然了解商品”的阅读链。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        locked_brief: sharedBrief,
        confirmed_topic: input.topic,
        competitor_content_mechanism: input.card.content_mechanism,
        product_evidence: input.evidence,
        seo_keywords: seoKeywords,
        output_schema: {
          inner_pages: [{
            page_no: 2,
            page_type: 'knowledge_list|example_explain|wrong_right|steps|product_bridge',
            page_title: '', lead: '', bullets: [], source_ids: [],
          }],
          caption: '完整正文，300-500个中文字符，分短段',
          tags: ['#法语学习'],
        },
      }),
    },
  ], { maxTokens: 5000, retries: 3 });
}

function normalizeTopic(value: unknown, index: number): MigratedTopic | null {
  const input = asRecord(value);
  const sourcePlan = asRecord(input.content_source_plan);
  const topic = sanitizePublicText(asString(input.topic));
  if (!topic) return null;
  return {
    id: asString(input.id) || `topic_${index + 1}`,
    topic,
    audience: sanitizePublicText(asString(input.audience)),
    scene: sanitizePublicText(asString(input.scene)),
    pain: sanitizePublicText(asString(input.pain)),
    content_promise: sanitizePublicText(asString(input.content_promise)),
    product_bridge: sanitizePublicText(asString(input.product_bridge)),
    why_this_reference_fits: asString(input.why_this_reference_fits),
    novelty: asString(input.novelty),
    search_terms: Array.isArray(input.search_terms) ? input.search_terms.map(asString).filter(Boolean).slice(0, 12) : [],
    content_source_plan: {
      knowledge_base: asString(sourcePlan.knowledge_base),
      ai_original: asString(sourcePlan.ai_original),
    },
  };
}

function normalizeBrief(value: unknown, input: ComposeDraftInput): UnifiedContentBrief {
  const brief = asRecord(value);
  return {
    product_id: input.productId,
    reference_card_id: input.card.id,
    topic: asString(brief.topic) || input.topic.topic,
    audience: asString(brief.audience) || input.topic.audience,
    scene: asString(brief.scene) || input.topic.scene,
    pain: asString(brief.pain) || input.topic.pain,
    content_value: asString(brief.content_value) || input.topic.content_promise,
    content_shape: input.card.renderer_id,
    selling_point: asString(brief.selling_point),
    buying_reason: asString(brief.buying_reason),
    product_claim_limit: asString(brief.product_claim_limit),
    knowledge_base_plan: asString(brief.knowledge_base_plan),
    ai_original_plan: asString(brief.ai_original_plan),
    cover_requirement: asString(brief.cover_requirement),
    difference_from_recent: asString(brief.difference_from_recent),
  };
}

function normalizeTitles(value: unknown, allowedIds?: Set<string>): TitleCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const input = asRecord(item);
    return {
      title: sanitizePublicText(asString(input.title)),
      formula_id: asString(input.formula_id),
      trigger_type: asString(input.trigger_type),
      formula_skeleton: asString(input.formula_skeleton),
      reason: asString(input.reason),
      risk_flags: Array.isArray(input.risk_flags) ? input.risk_flags.map(asString).filter(Boolean) : [],
    };
  }).filter(item => item.title
    && item.title.length <= 22
    && /法语|DELF|B2|TEF|TCF/i.test(item.title)
    && (!allowedIds || allowedIds.has(item.formula_id) || item.formula_id === 'free_original' || item.formula_id === 'reference_migration')
    && !/万能|必背|捷径|阅卷老师|考官|白考|高分的秘密|隐形扣分|扣\s*\d+\s*分|保分|必过|包过|\d+\s*%|百分之/.test(item.title)
  ).slice(0, 5);
}

function normalizePages(value: unknown): GeneratedInnerPage[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const input = asRecord(item);
    const validTypes = ['knowledge_list', 'example_explain', 'wrong_right', 'steps', 'product_bridge'];
    const pageType = asString(input.page_type);
    return {
      page_no: Number(input.page_no) || index + 2,
      page_type: (validTypes.includes(pageType) ? pageType : 'knowledge_list') as GeneratedInnerPage['page_type'],
      page_title: normalizeInnerPageTitle(sanitizePublicText(asString(input.page_title)), index),
      lead: clip(sanitizePublicText(asString(input.lead)), 90),
      bullets: Array.isArray(input.bullets)
        ? input.bullets.map(item => sanitizePublicText(asString(item))).filter(Boolean).slice(0, 7)
        : [],
      source_ids: Array.isArray(input.source_ids) ? input.source_ids.map(asString).filter(Boolean).slice(0, 10) : [],
    };
  }).filter(page => page.page_title).slice(0, 6);
}

function ensureMinimumInnerPages(
  pages: GeneratedInnerPage[],
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
) {
  const result = [...pages];
  for (const section of cover.sections) {
    if (result.length >= 4) break;
    const bullets = section.items
      .map(item => `${item.primary}${item.secondary ? `：${item.secondary}` : ''}`)
      .filter(Boolean)
      .slice(0, 7);
    while (bullets.length < 3) bullets.push('结合本篇主题完成一次替换练习');
    const rawTitle = `法语B2写作${section.heading}`;
    result.push({
      page_no: result.length + 2,
      page_type: 'knowledge_list',
      page_title: clip(rawTitle, 22),
      lead: cover.subtitle || '把封面的知识点展开成可直接理解的内容。',
      bullets,
      source_ids: section.source_ids,
    });
  }
  return result.slice(0, 6).map((page, index) => ({ ...page, page_no: index + 2 }));
}

function normalizeInnerPageTitle(value: string, index: number) {
  const trimmed = clip(value, 24);
  if (trimmed.length >= 8) return trimmed;
  const fallbacks = [
    '法语写作先看这一页',
    '这一页拆清楚用法',
    '常见错误这样检查',
    '例句放到作文里用',
    '写完之后这样复盘',
    '资料对应这样使用',
  ];
  return fallbacks[index] || '法语写作这一页怎么用';
}

function ensureCoreKeywordOpening(caption: string, keyword?: string) {
  if (!keyword || caption.slice(0, 100).includes(keyword)) return caption;
  return clip(`${keyword}备考时，${caption}`, 600);
}

function ensurePublishableCaption(
  caption: string,
  keyword: string | undefined,
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
) {
  let result = ensureCoreKeywordOpening(caption, keyword);
  if (result.length < 220) {
    const headings = cover.sections.map(section => section.heading).filter(Boolean).slice(0, 4).join('、');
    result += `使用时可以先看封面总览，再按${headings || '各个模块'}逐项核对。容易混淆的地方单独抄下来，下一篇练习时优先检查；确认已经掌握的内容再划掉。这样复盘会更具体，也方便看出自己反复出错的位置。`;
  }
  if (result.length < 220) {
    result += '收藏后不要一次把所有内容都背完，先选和当前作文最相关的一组，写进完整句子，再结合题目检查语境、搭配和语体是否合适。';
  }
  if (result.length > 600) {
    const candidate = result.slice(0, 580);
    const boundary = Math.max(candidate.lastIndexOf('。'), candidate.lastIndexOf('！'), candidate.lastIndexOf('？'));
    result = `${candidate.slice(0, boundary >= 220 ? boundary + 1 : 560).trim()}。`;
  }
  return result;
}

async function repairEditorialOutput(input: {
  brief: UnifiedContentBrief;
  selectedTitle: string;
  cover: ReturnType<typeof normalizeDenseDirectoryCover>;
  evidence: ReturnType<typeof retrieveProductFacts>;
  issues: string[];
  seoKeywords: string[];
}) {
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书法语内容总编。完整重写未过质检的内页和正文，只返回JSON，不能改变锁定主题。',
        '必须完整返回4-6张内页，每页标题8-22字、引导语和4-7条具体内容；不得输出半句话。',
        '必须完整返回300-500个中文字符的正文和5-8个标签。正文开头直接进入具体问题，不能虚构作者个人考试经历。',
        '逐条核对法语语法、搭配、语域和适用场景；不得把学习建议写成官方硬规则。',
        '核心搜索词必须出现在正文前80字，其他关键词自然出现，不得堆砌。',
        '禁止万能、必背、捷径、阅卷老师看重、百分比、考官追着给分、白考、保分、必过；禁止幕后设计说明和“不是……而是……”套话。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        locked_brief: input.brief,
        locked_title: input.selectedTitle,
        locked_cover: input.cover,
        failed_checks: input.issues,
        product_evidence: input.evidence,
        seo_keywords: input.seoKeywords,
        required_output: {
          inner_pages: [{ page_no: 2, page_type: 'knowledge_list', page_title: '', lead: '', bullets: ['', '', '', ''], source_ids: [] }],
          caption: '300-500个中文字符的完整正文',
          tags: ['#法语学习'],
        },
      }),
    },
  ], { maxTokens: 5000, retries: 3 });
}

async function repairCoreOutput(input: {
  brief: UnifiedContentBrief;
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  cover: ReturnType<typeof normalizeDenseDirectoryCover>;
  issues: string[];
  evidence: ReturnType<typeof retrieveProductFacts>;
  allowedTitleFormulas: ReturnType<typeof getDenseDirectoryTitleFormulas>;
  renderer: ProductCard['renderer_id'];
}) {
  const spec = getCoverTemplateSpec(input.renderer);
  if (!spec) throw new Error('封面模板规格不存在');
  const currentCounts = input.cover.sections.map(section => section.items.length);
  const currentTotal = currentCounts.reduce((sum, count) => sum + count, 0);
  const capacityHint = (input.issues.includes('cover_section_capacity_invalid')
    || input.issues.includes('cover_density_too_low')
    || input.issues.includes('cover_section_count_invalid'))
    ? `当前每组条目数为[${currentCounts.join(',')}]，共${input.cover.sections.length}组、${currentTotal}条，这不符合要求。请严格输出恰好${spec.sectionCount}组，每组恰好${spec.itemsPerSection}条（允许±1条误差），总条目不少于${spec.minTotalItems}条；宁可每组多写1-2条平淡但真实的短条目，也不能少于下限。`
    : '';
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书内容总编，负责定向修复未过质检的标题和封面数据。只返回JSON，不改变锁定选题。',
        '完整重写标题和封面，不能只返回修改的局部。',
        '75个公式只用于笔记文字标题且只是灵感库，不是硬模板。公式仿写候选的formula_id原样返回；自然原创或竞品机制迁移候选允许formula_id写free_original或reference_migration。',
        '必须恰好返回3个20字以内的笔记文字标题：1个自然原创、1个公式仿写、1个竞品机制迁移，且心理触发不同。禁止万能、必背、捷径、阅卷老师、百分比、考官、白考、虚构扣分/提分、保分、必过。',
        '每个标题和封面主标题必须出现法语、DELF B2、TEF或TCF中的至少一个。',
        getCoverTemplatePrompt(input.renderer),
        capacityHint,
        `primary视觉长度不得超过${spec.maxPrimaryVisualLength}，secondary视觉长度不得超过${spec.maxSecondaryVisualLength}；长解释和完整例句移到内页。`,
        '每条必须让普通中国备考者一眼看懂，法语术语配简短中文释义；禁止冗长的是非问句和无解释的内部速记。',
        '法语和备考规则必须准确，禁止把建议写成官方硬规则。',
        '禁止自创“至少N个B2词汇、虚拟式、连接词”等数量门槛；虚拟式只在语义需要时使用。',
        '封面标题或副标题若写具体数量（N句/个/条/项），N必须等于封面实际条目总数；写N类/组时必须等于分组数。',
        '商品1只写DELF B2，绝不能写DALF；用户可见文字不能出现内部ID。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        locked_brief: input.brief,
        failed_checks: input.issues,
        current_title_candidates: input.titleCandidates,
        current_selected_title: input.selectedTitle,
        current_cover: input.cover,
        product_evidence: input.evidence,
        allowed_title_formulas: input.allowedTitleFormulas,
        output_schema: {
          title_candidates: [{ title: '', formula_id: '', trigger_type: '', formula_skeleton: '', reason: '', risk_flags: [] }],
          selected_title: '',
          cover: {
            kind: 'dense_directory', title: '', subtitle: '',
            sections: [{ side_label: '', heading: '', columns: 3, items: [{ primary: '', secondary: '', note: '' }], source_type: 'mixed', source_ids: [] }],
          },
        },
      }),
    },
  ], { maxTokens: 6500, retries: 3 });
}

function chooseSafeTitle(value: unknown, candidates: TitleCandidate[], fallback: string) {
  const proposed = clip(sanitizePublicText(asString(value)), 24);
  return candidates.some(item => item.title === proposed) ? proposed : candidates[0]?.title || fallback;
}

function ensureTitleCandidateMix(
  candidates: TitleCandidate[],
  allowedFormulas: ReturnType<typeof getDenseDirectoryTitleFormulas>,
  coverTitle: string,
) {
  const result = [...candidates];
  const identity = /TEF|TCF/i.test(coverTitle) ? 'TEF/TCF法语' : /DELF/i.test(coverTitle) ? 'DELF B2写作' : '法语B2写作';
  const append = (candidate: TitleCandidate) => {
    if (!result.some(item => item.title === candidate.title)) result.push(candidate);
  };
  if (!result.some(item => item.formula_id === 'free_original')) append({
    title: `${identity}还在零散背？`,
    formula_id: 'free_original',
    trigger_type: '获得感',
    formula_skeleton: '明确对象 + 低效动作提醒',
    reason: '保留自然说话感，同时提醒用户当前学法可能低效。',
    risk_flags: [],
  });
  if (!result.some(item => item.formula_id === 'reference_migration')) append({
    title: `${identity}别再零散背了`,
    formula_id: 'reference_migration',
    trigger_type: '损失感',
    formula_skeleton: '对象 + 停止低效动作',
    reason: '迁移竞品的体系感与完整感。',
    risk_flags: [],
  });
  if (!result.some(item => item.formula_id !== 'free_original' && item.formula_id !== 'reference_migration')) {
    const formula = allowedFormulas[0];
    append({
      title: `${identity}越学越乱？先分清这几类`,
      formula_id: formula?.id || 'formula_fallback',
      trigger_type: '问题诊断',
      formula_skeleton: formula?.formula || '越做越乱？先分清这几类',
      reason: '用分类降低理解成本，适合高密度资料封面。',
      risk_flags: [],
    });
  }
  const required = [
    result.find(item => item.formula_id !== 'free_original' && item.formula_id !== 'reference_migration'),
    result.find(item => item.formula_id === 'reference_migration'),
    result.find(item => item.formula_id === 'free_original'),
  ].filter((item): item is TitleCandidate => Boolean(item));
  return [...required, ...result.filter(item => !required.includes(item))].slice(0, 5);
}

const COVER_COUNT_CLAIM_PATTERN = /(\d+)\s*(句|个|条|项|组|类)/g;
const NOTE_ITEM_COUNT_PATTERN = /(\d+)\s*(句|个|条|项|组)/g;

function scrubCheapClaims(text: string) {
  return text
    .replace(/考官追着给分/g, 'B2高阶表达')
    .replace(/考官最想要/g, '评分标准看重')
    .replace(/考官/g, '评分标准')
    .replace(/阅卷老师(?:最)?看重/g, 'B2写作常用')
    .replace(/阅卷老师/g, '评分标准')
    .replace(/万能/g, '常用')
    .replace(/必背/g, '常用')
    .replace(/捷径/g, '方法')
    .replace(/白考/g, '白费')
    .replace(/保分|必过|包过/g, '提分')
    .replace(/扣\s*\d+\s*分/g, '容易丢分')
    .replace(/\d+\s*%/g, '不少')
    .replace(/百分之\d*/g, '不少')
    .replace(/★+/g, '')
    .replace(/[，、。；]{2,}/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function alignCoverCountClaims(text: string, itemCount: number, sectionCount: number) {
  return text.replace(COVER_COUNT_CLAIM_PATTERN, (_match, rawCount: string, unit: string) => {
    const claimed = Number(rawCount);
    const expected = unit === '类' || unit === '组' ? sectionCount : itemCount;
    if (!Number.isFinite(claimed) || expected <= 0 || claimed === expected) {
      return `${rawCount}${unit}`;
    }
    return `${expected}${unit}`;
  });
}

function alignNoteItemCountClaims(text: string, itemCount: number, sectionCount: number) {
  return text.replace(NOTE_ITEM_COUNT_PATTERN, (_match, rawCount: string, unit: string) => {
    const claimed = Number(rawCount);
    const expected = unit === '组' ? sectionCount : itemCount;
    if (!Number.isFinite(claimed) || expected <= 0 || claimed === expected) {
      return `${rawCount}${unit}`;
    }
    return `${expected}${unit}`;
  });
}

function hasCoverCountMismatch(text: string, itemCount: number, sectionCount: number) {
  for (const match of text.matchAll(COVER_COUNT_CLAIM_PATTERN)) {
    const claimed = Number(match[1]);
    const unit = match[2];
    const expected = unit === '类' || unit === '组' ? sectionCount : itemCount;
    if (Number.isFinite(claimed) && expected > 0 && claimed !== expected) return true;
  }
  return false;
}

function syncTitlesWithCoverCounts(
  titles: TitleCandidate[],
  selectedTitle: string,
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
) {
  const itemCount = cover.sections.reduce((sum, section) => sum + section.items.length, 0);
  const sectionCount = cover.sections.length;
  const syncOne = (value: string) => clip(alignNoteItemCountClaims(scrubCheapClaims(value), itemCount, sectionCount), 22);
  return {
    titleCandidates: titles.map(item => ({ ...item, title: syncOne(item.title) })),
    selectedTitle: syncOne(selectedTitle),
  };
}

function ensureCoverIdentity(
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
  renderer: ProductCard['renderer_id'],
) {
  const spec = getCoverTemplateSpec(renderer);
  const family = spec?.family;
  const flexibleCapacity = Boolean(spec) && ['directory', 'document', 'offer', 'experience', 'pain', 'roadmap', 'book', 'table'].includes(spec!.family);
  const rawSections = flexibleCapacity && spec
    ? cover.sections.slice(0, spec.sectionCount + 1)
    : cover.sections;
  const explainShorthand = (value: string) => value
    .replace(/vocabulaire\s*B2/gi, 'B2词汇')
    .replace(/\bconcordance\b/gi, '时态配合')
    .replace(/\baccords?\b/gi, '性数配合');
  const sections = spec ? rawSections.map(section => ({
    ...section,
    heading: scrubCheapClaims(section.heading),
    side_label: scrubCheapClaims(section.side_label || ''),
    items: section.items.map(item => ({
      ...item,
      primary: clipVisual(explainShorthand(scrubCheapClaims(item.primary)), spec.maxPrimaryVisualLength),
      secondary: item.secondary
        ? clipVisual(explainShorthand(scrubCheapClaims(item.secondary)), spec.maxSecondaryVisualLength)
        : undefined,
      note: item.note ? scrubCheapClaims(item.note) : item.note,
    })),
  })) : rawSections;
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const sectionCount = sections.length;
  let title = alignCoverCountClaims(scrubCheapClaims(cover.title), itemCount, sectionCount);
  let subtitle = cover.subtitle.length >= 8
    ? clip(alignCoverCountClaims(scrubCheapClaims(cover.subtitle), itemCount, sectionCount), 24)
    : '';
  if (/法语|DELF|B2|TEF|TCF/i.test(title) && title.length >= 8 && title.length <= 18) {
    return { ...cover, title, subtitle, sections };
  }
  const fallbackTitle = family === 'document'
    ? 'DELF B2写作素材解析'
    : family === 'phrase'
      ? '法语B2写作高频表达'
      : family === 'offer' || family === 'roadmap'
        ? '法语B2写作学习方案'
        : 'DELF B2写作知识体系';
  title = fallbackTitle;
  return { ...cover, title, subtitle, sections };
}

function getCoreIssues(titles: TitleCandidate[], cover: ReturnType<typeof normalizeDenseDirectoryCover>, renderer: ProductCard['renderer_id']) {
  const issues: string[] = [];
  const spec = getCoverTemplateSpec(renderer);
  const itemCount = cover.sections.reduce((sum, section) => sum + section.items.length, 0);
  if (titles.length < 3) issues.push('title_candidate_mix_incomplete');
  if (!titles.some(item => item.formula_id === 'free_original')) issues.push('free_original_title_missing');
  if (!titles.some(item => item.formula_id === 'reference_migration')) issues.push('reference_migration_title_missing');
  if (!titles.some(item => item.formula_id !== 'free_original' && item.formula_id !== 'reference_migration')) issues.push('formula_title_missing');
  const flexibleCapacity = spec && ['directory', 'document', 'offer', 'experience', 'pain', 'roadmap', 'phrase', 'table', 'book'].includes(spec.family);
  const sectionCountInvalid = !spec || (flexibleCapacity
    ? cover.sections.length < Math.max(2, spec.sectionCount - 1) || cover.sections.length > spec.sectionCount + 1
    : cover.sections.length !== spec.sectionCount);
  if (sectionCountInvalid) issues.push('cover_section_count_invalid');
  const capacityInvalid = !spec || cover.sections.some(section => flexibleCapacity
    ? section.items.length < Math.max(1, spec.itemsPerSection - 2) || section.items.length > spec.itemsPerSection + 2
    : section.items.length !== spec.itemsPerSection);
  if (capacityInvalid) issues.push('cover_section_capacity_invalid');
  if (!spec || itemCount < spec.minTotalItems) issues.push('cover_density_too_low');
  if (spec && cover.sections.some(section => section.items.some(item => visualLength(item.primary) > spec.maxPrimaryVisualLength || visualLength(item.secondary || '') > spec.maxSecondaryVisualLength))) issues.push('cover_item_too_long');
  if (!/法语|DELF|B2|TEF|TCF/i.test(cover.title)) issues.push('cover_missing_french_identity');
  if (cover.title.length < 8 || cover.title.length > 18) issues.push('cover_title_length_invalid');
  if (cover.subtitle && (cover.subtitle.length < 8 || cover.subtitle.length > 24)) issues.push('cover_subtitle_length_invalid');
  if (
    hasCoverCountMismatch(cover.title, itemCount, cover.sections.length)
    || hasCoverCountMismatch(cover.subtitle || '', itemCount, cover.sections.length)
  ) {
    issues.push('cover_count_mismatch');
  }
  const publicText = `${titles.map(item => item.title).join(' ')} ${cover.title} ${cover.sections.map(section => `${section.heading} ${section.items.map(item => `${item.primary} ${item.secondary || ''}`).join(' ')}`).join(' ')}`;
  if (/万能|必背|捷径|阅卷老师|考官|白考|保分|必过|包过|扣\s*\d+\s*分|\d+\s*%|百分之|★/.test(publicText)) issues.push('cheap_or_unsupported_claim');
  if (/每段.{0,8}必须.{0,8}空行|Cordialement.{0,8}(错误|禁用)|每个论点.{0,10}必须.{0,10}(数据|例子)/i.test(publicText)) issues.push('overabsolute_exam_rule');
  if (/至少\s*\d+\s*个.{0,8}(B2.{0,4}词|词汇|虚拟式|连接词)|每段.{0,8}(必须|至少).{0,8}(连接词|例子|数据)/i.test(publicText)) issues.push('invented_quantity_rule');
  if (/\b(?:vocabulaire\s*B2|concordance|accords?)\b(?![^。；，\n]{0,12}(?:词汇|时态|一致|配合|阴阳性|单复数))/i.test(publicText)) issues.push('unexplained_french_shorthand');
  if (spec?.family === 'phrase' && cover.sections.some(section => section.items.some(item => !/[A-Za-zÀ-ÿ]/.test(item.primary) || !item.secondary))) issues.push('french_chinese_pair_required');
  if (spec?.family === 'flashcard' && cover.sections.some(section => section.items.some(item => !/[A-Za-zÀ-ÿ]/.test(item.primary) || !item.secondary || !item.note))) issues.push('flashcard_fields_incomplete');
  if (spec?.family === 'document' && cover.sections.flatMap(section => section.items)
    .filter(item => /[A-Za-zÀ-ÿ]{8,}/.test(`${item.primary} ${item.secondary || ''} ${item.note || ''}`)).length < 2) issues.push('document_examples_missing');
  if ((spec?.family === 'offer' || spec?.family === 'roadmap') && /一对一|直播课|老师批改|无限答疑|陪学|督学|课时|学习权利/.test(publicText)) issues.push('unsupported_service_claim');
  if ((spec?.family === 'experience' || spec?.family === 'pain') && /我.{0,12}(上岸|通过|考到|拿到|亲测|亲身|用了\d+|学了\d+)/.test(publicText)) issues.push('fabricated_first_person_experience');
  if (spec?.family === 'document' && /官方真题|历年真题|原题|真题原文/.test(publicText)) issues.push('unverified_exam_source');
  return issues;
}

function getEditorialIssues(pages: GeneratedInnerPage[], caption: string, seoKeywords: string[]) {
  const issues: string[] = [];
  if (pages.length < 4 || pages.length > 6) issues.push('inner_page_count_invalid');
  if (pages.some(page => page.page_title.length < 8 || page.page_title.length > 24)) issues.push('inner_page_title_invalid');
  if (pages.some(page => page.bullets.length < 3)) issues.push('inner_page_content_too_thin');
  if (caption.length < 220 || caption.length > 600) issues.push('caption_length_invalid');
  if (seoKeywords[0] && !caption.slice(0, 100).includes(seoKeywords[0])) issues.push('core_keyword_missing_from_opening');
  const editorialText = `${caption} ${pages.map(page => `${page.page_title} ${page.lead} ${page.bullets.join(' ')}`).join(' ')}`;
  if (/万能|必背|捷径|阅卷老师|考官|白考|保分|必过|包过|★/.test(editorialText)) issues.push('editorial_low_quality_phrase');
  if (/不是.{0,40}而是|不在于.{0,40}而在于|问题的关键|很多同学都会遇到/.test(caption)) issues.push('caption_ai_cliche');
  return issues;
}

function buildSeoKeywords(productId: ProductId, topic: MigratedTopic) {
  const base = productId === 'delf_b2_writing'
    ? ['DELF B2写作', '法语写作', 'DELF B2备考']
    : ['TEF TCF Canada', '法语备考', '加拿大法语考试'];
  const topicWords = topic.search_terms.filter(item => item.length >= 2 && item.length <= 12).slice(0, 3);
  return Array.from(new Set([...base, ...topicWords])).slice(0, 6);
}

function normalizeTags(value: unknown, seoKeywords: string[]) {
  const raw = Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
  const fallbacks = seoKeywords.slice(0, 5);
  const normalized = [...raw, ...fallbacks]
    .map(tag => `#${tag.replace(/^#+/, '').replace(/\s+/g, '')}`)
    .filter(tag => !/^#(AU|CH|FW|GD|JF|CL|ER|CB)-\w*/i.test(tag) && tag.length >= 3 && tag.length <= 18);
  return Array.from(new Set(normalized)).slice(0, 8);
}

function visualLength(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
}

function clipVisual(value: string, max: number) {
  const chars = Array.from(value);
  let result = '';
  let length = 0;
  let cutIndex = chars.length;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    const nextLength = length + (/[^\x00-\xff]/.test(char) ? 2 : 1);
    if (nextLength > max) { cutIndex = i; break; }
    result += char;
    length = nextLength;
  }
  const wasTruncated = cutIndex < chars.length;
  if (wasTruncated) {
    // A cut is only safe if it doesn't split a Latin word in half. Check the
    // actual boundary character (not just a length-ratio heuristic), so a
    // long trailing word (e.g. "distinguées") never survives as a mangled
    // fragment like "disti" - back off to the last space/punctuation instead.
    const cutsMidLatinWord = /[A-Za-zÀ-ÿ]$/.test(result) && /[A-Za-zÀ-ÿ]/.test(chars[cutIndex] || '');
    const boundary = Math.max(result.lastIndexOf(' '), result.lastIndexOf('，'), result.lastIndexOf('；'), result.lastIndexOf('、'));
    if (cutsMidLatinWord) {
      result = boundary >= 0 ? result.slice(0, boundary) : '';
    } else if (boundary >= Math.floor(result.length * 0.55)) {
      result = result.slice(0, boundary);
    }
  }
  result = result.trim();
  if (wasTruncated && result && !/[…。！？.!?,，:：]$/.test(result) && /[A-Za-zÀ-ÿ]$/.test(result)) {
    result += '...';
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number) {
  if (value.length <= max) return value;
  let result = value.slice(0, max);
  const cutsMidLatinWord = /[A-Za-zÀ-ÿ]$/.test(result) && /[A-Za-zÀ-ÿ]/.test(value[max] || '');
  if (cutsMidLatinWord) {
    const boundary = Math.max(result.lastIndexOf(' '), result.lastIndexOf('，'), result.lastIndexOf('、'), result.lastIndexOf('；'), result.lastIndexOf('。'));
    // A mid-word cut is never acceptable - always back off to the last safe
    // boundary rather than only doing so when it happens to be far enough in.
    if (boundary >= 0) result = result.slice(0, boundary);
  }
  return result.trim();
}

function sanitizePublicText(value: string) {
  return value
    .replace(/很多同学都会遇到(?:一个)?/g, '练习中常见的')
    .replace(/问题的关键(?:是|在于)?/g, '更需要注意的是')
    .replace(/不是([^，。；\n]{1,40})[，,]?而是/g, '别只看$1，更要看')
    .replace(/不在于([^，。；\n]{1,40})[，,]?而在于/g, '不能只看$1，更要看')
    .replace(/考官追着给分/g, 'B2高阶表达')
    .replace(/考官最想要/g, '评分标准看重')
    .replace(/考官/g, '评分标准')
    .replace(/万能/g, '常用')
    .replace(/必背/g, '常用')
    .replace(/阅卷老师(?:最)?看重/g, 'B2写作常用')
    .replace(/\d+\s*%\s*(?:的)?(?:考生|人|同学)?(?:都)?(?:不知道|会用|常用)/g, '很多人容易忽略')
    .replace(/百分之[一二三四五六七八九十百零]+(?:的)?(?:考生|人|同学)?(?:都)?(?:不知道|会用|常用)/g, '很多人容易忽略')
    .replace(/★+/g, '')
    .replace(/白考/g, '复习白费')
    .replace(/保分/g, '稳住基础')
    .replace(/必过|包过/g, '考前实用')
    .replace(/扣\s*\d+\s*分/g, '容易丢分')
    .replace(/DALF\s*B2/gi, 'DELF B2')
    .replace(/[（(][^）)]*(?:AU|CH|FW|GD|JF|CL|ER|CB)-\d+[^）)]*[）)]/gi, '')
    .replace(/\b(?:AU|CH|FW|GD|JF|CL|ER|CB)-\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
