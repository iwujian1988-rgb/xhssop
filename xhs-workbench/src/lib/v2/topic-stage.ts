import { callOpenAICompatibleJsonWithUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getProductPromptProfile, hasForbiddenProductIdentity } from '@/lib/product-prompt-profiles';
import { getRecentTitleFingerprints } from '@/lib/title-usage-store';
import { getXhsSearchKeywords } from '@/lib/xhs-search-keywords';
import type { ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';
import type { CompetitorCreativeCard, MigratedTopic } from '@/types/reference-workflow';
import { stableHash, type TemplateCapability, type TopicLane, type TopicOption, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { listVerifiedExamFacts } from './verified-exam-facts';

export const TOPIC_PROMPT_VERSION = 'v2-topic-8';

const REQUIRED_TOPIC_LANES: TopicLane[] = ['broad_pain', 'result_need', 'narrow_knowledge', 'product_value'];
const MACHINE_TOPIC_PATTERN = /资料太散|卡住|卡在|拖后腿|正在白背|白背了|写作任务|这一关|多数人|真正的原因|底层逻辑|闭环|赋能|抓手|痛点人群|用户痛点/;

// 选题阶段只拦截会把整篇笔记带到错误商品/错误封面的情况。
// 说法不够自然、字段漏填、SEO词缺失等，后续标题/正文阶段仍可修复，不能让一张卡直接失败。
const TOPIC_HARD_FAILURES = new Set([
  'cross_product_identity',
  'cover_goal_mismatch',
  'cover_content_shape_mismatch',
  'product_showcase_mode_mismatch',
]);

interface TopicStageInput {
  productId: ProductId;
  card: CompetitorCreativeCard;
  capability: TemplateCapability;
  facts: ProductFacts;
  direction?: string;
  contentMode?: 'standard' | 'product_showcase';
  limit?: number;
  recentAngles?: string[];
}

interface RawTopicResponse {
  topics?: Array<Partial<TopicOption> & Record<string, unknown>>;
}

export async function generateTopicOptions(input: TopicStageInput): Promise<VersionedArtifact<TopicOption[]>> {
  const profile = getProductPromptProfile(input.productId);
  const templateSpec = getCoverTemplateSpec(input.capability.renderer);
  const keywords = getXhsSearchKeywords(input.productId);
  const history = await getRecentTitleFingerprints(input.productId, { days: 30 });
  const factSignals = summarizeFacts(input.facts, `${input.card.id}|${history.records.length}`);
  const verifiedExamFacts = listVerifiedExamFacts(input.productId);
  // This is the final number selected in the frontend. Keep the request aligned
  // with it; a hidden larger candidate pool made one selected topic cost 6.
  const limit = Math.max(1, Math.min(6, input.limit ?? 1));
  const candidateCount = limit;
  const productShowcaseMode = input.contentMode === 'product_showcase';
  const promptInput = {
    product: {
      id: input.productId,
      identity: profile.noteIdentity,
      scope: profile.topicScopePrompt,
      product_facts: factSignals,
      verified_exam_facts: verifiedExamFacts.map(item => ({ id: item.id, text: item.text })),
    },
    cover: {
      id: input.card.id,
      name: input.card.name,
      family: input.capability.family,
      compiler: input.capability.compiler,
      content_mechanism: input.card.content_mechanism,
      click_mechanism: input.card.click_mechanism,
      accepted_blocks: input.capability.acceptedBlockKinds,
      allowed_goals: input.capability.allowedGoals,
      content_instruction: templateSpec?.contentInstruction || '',
      forbidden_instruction: templateSpec?.forbiddenInstruction || '',
    },
    search_signals: [...keywords.primary, ...keywords.secondary].slice(0, 12),
    recent_topics_to_avoid: [...history.recentTopics.slice(-20), ...(input.recentAngles || []).slice(-20)],
    current_batch_topics_to_avoid: (input.recentAngles || []).slice(-20),
    direction: input.direction || '',
    requested_content_mode: input.contentMode || 'standard',
    count: candidateCount,
  };
  const inputHash = stableHash(promptInput);
  const result = await callOpenAICompatibleJsonWithUsage<RawTopicResponse>([
    {
      role: 'system',
      content: [
        '你是资深小红书法语教育编辑。当前阶段只决定“这篇笔记讲什么”，不要写标题、正文、封面文案或内页文案。',
        '先写出一条自然、具体、用户看得懂的选题，再补齐结构字段。选题质量优先级：商品身份正确 > 用户确实会遇到 > 说人话 > 能被当前封面承载 > 有自然搜索词 > 能承接商品。',
        '每个候选必须输出 plannedBlockKind，值只能从 cover.accepted_blocks 中选择；它只是后续排版提示，不要为了迁就它改变选题主题。',
        '人群、场景、痛点、承诺和商品承接是给后续写作使用的背景字段，不要把这些字段名硬塞进公开选题句子。',
        productShowcaseMode
          ? `当前是“介绍知识库”模式：输出${candidateCount}个明显不同的商品介绍选题，全部使用topicLane=product_value；primaryGoal优先用conversion，若当前封面不支持conversion则用该封面允许的目标。每个选题都要有不同的商品展示角度，例如目录结构、模块组合、样张使用、适合人群、备考场景或资料稀缺价值，不能退回普通知识分享。`
          : `输出${candidateCount}个明显不同的候选；当数量为1时只输出1个最合适的选题，不要额外扩写。`,
        'topicLane=broad_pain讲用户普遍遇到的大问题；result_need讲用户想获得的结果或省事方法；narrow_knowledge讲一个具体但真实有用的知识点；product_value讲资料包能给用户带来的具体获得感，不等于罗列目录。',
        '当前封面只决定视觉承载方式，不决定内容主题。痛点/真人经验封面优先写用户经历和问题；表格/目录封面优先写可分组、可对照、可速查的内容；不要为了套模板硬改商品主题。',
        '大痛点要像备考者平时会说的话，表达具体问题和想要的结果，避免抽象运营术语、广告腔和生硬的“X→Y”句式。',
        '细分干货可以具体，但要有上位需求；商品展示不能只罗列页数和模块，要说明用户为什么需要看。',
        'SEO词只自然选择1个主词和少量相关词，不堆词。不得复制近期选题，不得跨商品。',
        'product_facts 是商品内容、方法和卖点，不自动等于官方考试规则；verified_exam_facts 才能支撑“官方要求、评分标准、题数、时长、最低字数”等硬事实。没有证据时可以做学习建议或科普，但不要伪装成官方规则。',
        'DELF B2 写作官方评分是 5 个维度按表现档位评分，不是按错误逐项扣分。禁止写“考官逐条扣分、每错一项扣几分、扣分表”这类错误角度。',
        '评分选题优先做“5个维度如何自查、四档表现是什么意思”；不要把AI原创例文包装成官方0分/5分标准答案，也不要承诺模拟考官精确打分。',
        'primaryGoal只能是search/save/click/conversion；knowledgeMode只能是product_grounded/exam_grounded/educational_original/mixed。',
        '只返回JSON对象，顶层字段topics。每项必须使用这些字段：id, primaryGoal, topicLane, topic, audienceState, scene, painOrDesire, promise, contentAngle, productBridge, seo{primary,related}, knowledgeMode, factTerms, seedSignals, noveltyFingerprint。字段可以简洁，但不能留空。',
        '禁止返回旧字段title、targetAudience、useCase、painPoint、sellingPoint、knowledgeAsset、contentModule、coverBlock、searchKeywords、avoidDuplicate。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(promptInput) },
  ], { maxTokens: 2200, temperature: 0.8, retries: 2 });

  const responseData = result.data as RawTopicResponse | Partial<TopicOption>[] | Record<string, unknown>;
  const rawTopics = Array.isArray(responseData)
    ? responseData
    : Array.isArray((responseData as RawTopicResponse)?.topics)
      ? (responseData as RawTopicResponse).topics || []
      : [];
  const normalizedTopics = rawTopics
    .map((raw, index) => normalizeTopic(raw, input, index))
    .filter((topic): topic is TopicOption => Boolean(topic));
  const rejected = normalizedTopics.filter(topic => topicGateFailures(topic, input).some(failure => TOPIC_HARD_FAILURES.has(failure)));
  const topics = selectTopicPortfolio(normalizedTopics, input);
  const softWarnings = topics.flatMap(topic => topicGateFailures(topic, input)
    .filter(failure => !TOPIC_HARD_FAILURES.has(failure))
    .map(failure => `${topic.topic}: ${failure}`));
  if (topics.length < limit) {
    console.error('[v2-topic-rejected]', JSON.stringify({
      product_id: input.productId,
      card_id: input.card.id,
      response_keys: responseData && typeof responseData === 'object' && !Array.isArray(responseData) ? Object.keys(responseData) : [],
      raw_count: rawTopics.length,
      normalized_count: normalizedTopics.length,
      rejected: rejected.map(topic => ({ topic: topic.topic, failures: topicGateFailures(topic, input), public_text: publicTopicText(topic) })),
      response_preview: JSON.stringify(responseData).slice(0, 3000),
    }));
    if (topics.length > 0) {
      return artifact(
        topics.slice(0, limit),
        inputHash,
        result.usage,
        result.requestId,
        [`AI返回${topics.length}个可用选题，少于请求的${limit}个；已继续生成，不阻断任务。`, ...softWarnings],
      );
    }
    // 单卡只请求一个选题时，不要因为唯一候选的轻微封面形态偏差整卡失败。
    // 只要没有跨商品/跨模式风险，就保留这条选题，让后续内容围绕它生成并显示提醒。
    const fallback = normalizedTopics.find(topic => {
      const failures = topicGateFailures(topic, input);
      return !failures.includes('cross_product_identity') && !failures.includes('product_showcase_mode_mismatch');
    });
    if (fallback) {
      return artifact(
        [fallback],
        inputHash,
        result.usage,
        result.requestId,
        [`唯一候选存在轻微匹配提醒，已继续生成：${topicGateFailures(fallback, input).join('、') || '无'}`],
      );
    }
    throw new Error(`V2选题阶段没有得到合格选题（原始${rawTopics.length}，规则拒绝${rejected.length}）`);
  }

  return artifact(topics.slice(0, limit), inputHash, result.usage, result.requestId, softWarnings);
}

export function topicOptionToMigrated(topic: TopicOption): MigratedTopic & { v2_topic: TopicOption } {
  return {
    id: topic.id,
    scope_level: topic.primaryGoal === 'search' || topic.primaryGoal === 'conversion' ? 'broad' : 'narrow',
    topic_type: topic.primaryGoal === 'search' ? 'search_pain' : topic.primaryGoal === 'conversion' ? 'product_showcase' : topic.primaryGoal === 'save' ? 'selling_point' : 'narrow_knowledge',
    topic: topic.topic,
    audience: topic.audienceState,
    scene: topic.scene,
    pain: topic.painOrDesire,
    content_promise: topic.promise,
    product_bridge: topic.productBridge,
    why_this_reference_fits: topic.contentAngle,
    novelty: topic.noveltyFingerprint,
    search_terms: [topic.seo.primary, ...topic.seo.related].filter(Boolean),
    content_source_plan: {
      knowledge_base: topic.knowledgeMode === 'educational_original' ? '仅用于核对商品承接，不限定科普内容' : '按factTerms检索少量商品事实',
      ai_original: topic.knowledgeMode === 'product_grounded' ? '只补表达与组织方式' : '可原创科普、方法、解释和示例',
    },
    dynamic_fact_terms: topic.factTerms,
    title_trigger_types: topic.seedSignals,
    content_shape: undefined,
    v2_topic: topic,
  };
}

export function migratedToTopicOption(topic: MigratedTopic & { v2_topic?: TopicOption }, productId: ProductId, card: CompetitorCreativeCard): TopicOption {
  if (topic.v2_topic) return topic.v2_topic;
  return {
    id: topic.id || `topic_${stableHash(topic.topic)}`,
    productId,
    templateId: card.renderer_id,
    primaryGoal: topic.topic_type === 'product_showcase' ? 'conversion' : topic.topic_type === 'search_pain' ? 'search' : topic.topic_type === 'selling_point' ? 'save' : 'click',
    topicLane: topic.topic_type === 'product_showcase' ? 'product_value' : topic.topic_type === 'search_pain' ? 'broad_pain' : topic.topic_type === 'selling_point' ? 'result_need' : 'narrow_knowledge',
    topic: topic.topic,
    audienceState: topic.audience,
    scene: topic.scene,
    painOrDesire: topic.pain,
    promise: topic.content_promise,
    contentAngle: topic.why_this_reference_fits,
    plannedBlockKind: inferPlannedBlockKind(card, topic.why_this_reference_fits),
    productBridge: topic.product_bridge,
    seo: { primary: topic.search_terms?.[0] || getProductPromptProfile(productId).noteIdentity, related: topic.search_terms?.slice(1, 5) || [] },
    knowledgeMode: topic.content_source_plan?.ai_original?.includes('原创') ? 'mixed' : 'product_grounded',
    factTerms: topic.dynamic_fact_terms || topic.search_terms || [],
    seedSignals: topic.title_trigger_types || [],
    noveltyFingerprint: topic.novelty || stableHash(`${topic.topic}|${topic.content_promise}`),
  };
}

function normalizeTopic(raw: Partial<TopicOption> & Record<string, unknown>, input: TopicStageInput, index: number): TopicOption | null {
  const requestedGoal = ['search', 'save', 'click', 'conversion'].includes(String(raw.primaryGoal)) ? raw.primaryGoal as TopicOption['primaryGoal'] : undefined;
  const goal = requestedGoal && input.capability.allowedGoals.includes(requestedGoal)
    ? requestedGoal
    : input.capability.allowedGoals[index % input.capability.allowedGoals.length];
  const topic = clean(raw.topic) || clean(raw.title);
  if (!topic) return null;
  const searchKeywords = unique(raw.searchKeywords);
  const seoPrimary = clean(raw.seo?.primary) || searchKeywords[0] || getProductPromptProfile(input.productId).noteIdentity;
  const audienceState = clean(raw.audienceState) || resolveFactRef(input.facts, raw.targetAudience);
  const scene = clean(raw.scene) || resolveFactRef(input.facts, raw.useCase);
  const painOrDesire = clean(raw.painOrDesire) || resolveFactRef(input.facts, raw.painPoint);
  const sellingPoint = resolveFactRef(input.facts, raw.sellingPoint);
  const knowledgeAsset = resolveFactRef(input.facts, raw.knowledgeAsset);
  const contentModule = resolveFactRef(input.facts, raw.contentModule);
  return {
    id: clean(raw.id) || `v2_topic_${stableHash(`${input.card.id}|${topic}`)}`,
    productId: input.productId,
    templateId: input.card.renderer_id,
    primaryGoal: goal,
    topicLane: normalizeTopicLane(raw.topicLane, goal, topic, index),
    topic,
    audienceState,
    scene,
    painOrDesire,
    promise: clean(raw.promise) || sellingPoint || clean(raw.avoidDuplicate),
    contentAngle: clean(raw.contentAngle) || [knowledgeAsset, contentModule].filter(Boolean).join('；'),
    plannedBlockKind: normalizePlannedBlockKind(raw.plannedBlockKind, input.capability),
    productBridge: clean(raw.productBridge) || sellingPoint,
    seo: { primary: seoPrimary, related: unique(raw.seo?.related).concat(searchKeywords.slice(1)).slice(0, 5) },
    knowledgeMode: ['product_grounded', 'exam_grounded', 'educational_original', 'mixed'].includes(String(raw.knowledgeMode)) ? raw.knowledgeMode as TopicOption['knowledgeMode'] : 'mixed',
    factTerms: unique(raw.factTerms).concat([knowledgeAsset, contentModule].filter(Boolean)).slice(0, 8),
    seedSignals: unique(raw.seedSignals).concat(unique([raw.coverBlock])).slice(0, 8),
    noveltyFingerprint: clean(raw.noveltyFingerprint) || stableHash(`${goal}|${topic}|${raw.contentAngle || ''}`),
  };
}

function resolveFactRef(facts: ProductFacts, value: unknown): string {
  const ref = clean(value);
  if (!ref) return '';
  for (const items of Object.values(facts)) {
    const match = items.find(item => item.id === ref);
    if (match) return clean(match.text);
  }
  return ref;
}

function summarizeFacts(facts: ProductFacts, rotationSeed: string) {
  return Object.fromEntries(Object.entries(facts).map(([category, items]) => {
    if (!items.length) return [category, []];
    // 选题只需要知道商品有哪些方向，不需要读取整张事实卡。
    // 完整事实卡留给选题确定后的 resolveProductEvidence；否则每个封面都会重复发送
    // 全量事实，17个封面会把同一份资料发送17遍。
    const coreCount = category === 'raw_pain_points' || category === 'raw_selling_points' ? 2 : 1;
    const targetCount = category === 'knowledge_assets' || category === 'displayable_assets' ? 5 : 4;
    const core = items.slice(0, coreCount);
    const remaining = items.slice(coreCount);
    const start = remaining.length
      ? parseInt(stableHash(`${rotationSeed}|${category}`), 36) % remaining.length
      : 0;
    const rotated = remaining.length
      ? [...remaining.slice(start), ...remaining.slice(0, start)].slice(0, Math.max(0, targetCount - core.length))
      : [];
    return [category, [...core, ...rotated].map(item => ({
      id: item.id,
      text: item.text.slice(0, 120),
      keywords: item.raw_keywords.slice(0, 8),
    }))];
  }));
}

function publicTopicText(topic: TopicOption) {
  return [topic.topic, topic.audienceState, topic.scene, topic.painOrDesire, topic.promise, topic.productBridge].join(' ');
}

function hasUnsupportedExamFraming(topic: TopicOption) {
  const text = publicTopicText(topic);
  return /(?:考官.{0,10}(?:逐条|每项|怎么).{0,8}扣分|每错.{0,10}扣.{0,4}分|逐项扣分表|错误扣分表)/i.test(text);
}

export function diagnoseTopicOption(topic: TopicOption, input: Pick<TopicStageInput, 'productId' | 'capability'>) {
  return topicGateFailures(topic, input);
}

export function selectTopicPortfolio(topics: TopicOption[], input: Pick<TopicStageInput, 'productId' | 'capability' | 'contentMode'>) {
  const eligible = topics.filter(topic => topicGateFailures(topic, input).every(failure => !TOPIC_HARD_FAILURES.has(failure)));
  const selected: TopicOption[] = [];
  const requiredLanes = input.contentMode === 'product_showcase'
    ? (['product_value'] as TopicLane[])
    : REQUIRED_TOPIC_LANES;
  for (const lane of requiredLanes) {
    const candidate = eligible.find(topic => topic.topicLane === lane && !isNearDuplicate(topic, selected));
    if (candidate) selected.push(candidate);
  }
  for (const candidate of eligible) {
    if (selected.length >= 4) break;
    if (!selected.includes(candidate) && !isNearDuplicate(candidate, selected)) selected.push(candidate);
  }
  return selected.slice(0, 4);
}

function topicGateFailures(topic: TopicOption, input: Pick<TopicStageInput, 'productId' | 'capability' | 'contentMode'>) {
  const failures: string[] = [];
  const publicText = publicTopicText(topic);
  if (hasForbiddenProductIdentity(input.productId, publicText)) failures.push('cross_product_identity');
  if (hasUnsupportedExamFraming(topic)) failures.push('unsupported_exam_framing');
  if (MACHINE_TOPIC_PATTERN.test(publicText)) failures.push('machine_expression');
  if (!input.capability.allowedGoals.includes(topic.primaryGoal)) failures.push('cover_goal_mismatch');
  if (topicShapeMismatch(topic, input.capability)) failures.push('cover_content_shape_mismatch');
  if (!topic.topic || !topic.audienceState || !topic.painOrDesire || !topic.promise) failures.push('missing_user_context');
  if (!topic.productBridge) failures.push('missing_product_bridge');
  if (!topic.seo.primary) failures.push('missing_seo_primary');
  if (input.contentMode === 'product_showcase' && topic.topicLane !== 'product_value') {
    failures.push('product_showcase_mode_mismatch');
  }
  return failures;
}

function topicShapeMismatch(topic: TopicOption, capability: TemplateCapability) {
  const angle = `${topic.topic} ${topic.promise} ${topic.contentAngle}`;
  if (topic.plannedBlockKind && !capability.acceptedBlockKinds.includes(topic.plannedBlockKind)) return true;
  if (capability.family === 'experience') {
    const listOrLessonPlan = /(?:先讲|再列|逐条|对照表|词汇表|短语表|清单|大全|速查|口诀|规则解析|句型整理|分组整理)/i;
    const experienceAngle = /(?:观察|经历|复盘|误区|场景|感受|变化|建议|为什么|少走弯路|容易犯)/i;
    return listOrLessonPlan.test(angle) && !experienceAngle.test(angle);
  }
  if (capability.family === 'phrase' || capability.family === 'flashcard' || capability.family === 'table') {
    return /(?:长篇经历|完整故事|纯经验分享|情绪随笔)/i.test(angle);
  }
  if (capability.family === 'directory') {
    return /(?:完整故事|长篇经历|情绪随笔|个人成长叙事|第一人称复盘)/i.test(angle);
  }
  if (capability.family === 'pain') {
    return /(?:词汇表|短语表|固定搭配表|资料目录|课程路径|阶段规划|逐句解析)/i.test(angle);
  }
  if (capability.family === 'offer') {
    const pureLesson = /(?:只讲|专讲|逐句解释|语法规则解析|词义辨析|例句精讲)/i.test(angle);
    const productUse = /(?:资料|知识库|包含|适合|使用|解决|能查|怎么用|获得)/i.test(angle);
    return pureLesson && !productUse;
  }
  if (capability.family === 'document') {
    const incompatible = /(?:学习路径|阶段规划|真人经历|情绪故事|资料包介绍)/i.test(angle);
    const documentShape = /(?:原句|例句|范文|素材|解析|改写|迁移|批改|对照)/i.test(angle);
    return incompatible && !documentShape;
  }
  if (capability.family === 'roadmap') {
    const isolatedKnowledge = /(?:单词表|短语表|固定搭配|逐句解析|一条语法规则)/i.test(angle);
    const roadmapShape = /(?:阶段|路径|计划|顺序|安排|从.+到|第\s*[一二三四1234].+步)/i.test(angle);
    return isolatedKnowledge && !roadmapShape;
  }
  return false;
}

function normalizePlannedBlockKind(value: unknown, capability: TemplateCapability) {
  const requested = clean(value) as TopicOption['plannedBlockKind'];
  return requested && capability.acceptedBlockKinds.includes(requested)
    ? requested
    : capability.acceptedBlockKinds[0];
}

function inferPlannedBlockKind(card: CompetitorCreativeCard, angle: string) {
  const capability = getCapabilityFallback(card);
  const text = clean(angle);
  const preferred = /(?:原句|例句|解析|改写)/i.test(text) ? 'example'
    : /(?:经历|复盘|观察|故事)/i.test(text) ? 'paragraph'
      : /(?:步骤|路径|阶段|顺序)/i.test(text) ? 'step'
        : /(?:收益|适合|解决|获得)/i.test(text) ? 'benefit'
          : /(?:短语|词汇|搭配|对照)/i.test(text) ? 'pair'
            : capability.acceptedBlockKinds[0];
  return capability.acceptedBlockKinds.includes(preferred as never)
    ? preferred as TopicOption['plannedBlockKind']
    : capability.acceptedBlockKinds[0];
}

function normalizeTopicLane(value: unknown, goal: TopicOption['primaryGoal'], topic: string, index: number): TopicLane {
  if (REQUIRED_TOPIC_LANES.includes(String(value) as TopicLane)) return String(value) as TopicLane;
  if (goal === 'conversion') return 'product_value';
  if (/资料|知识库|资料包|合集|大全|速查/.test(topic)) return 'product_value';
  if (/不会|写不好|分不清|不知道|总是|容易|常犯|丢分/.test(topic) || goal === 'search') return 'broad_pain';
  if (/方法|怎么|提分|省时|计划|路径|结果/.test(topic) || goal === 'save') return 'result_need';
  return REQUIRED_TOPIC_LANES[index % REQUIRED_TOPIC_LANES.length];
}

function isNearDuplicate(candidate: TopicOption, selected: TopicOption[]) {
  const candidateTokens = semanticBigrams(`${candidate.topic}${candidate.painOrDesire}${candidate.promise}`);
  return selected.some(item => {
    const tokens = semanticBigrams(`${item.topic}${item.painOrDesire}${item.promise}`);
    const intersection = Array.from(candidateTokens).filter(token => tokens.has(token)).length;
    const union = new Set([...candidateTokens, ...tokens]).size;
    return union > 0 && intersection / union >= 0.52;
  });
}

function semanticBigrams(value: string) {
  const normalized = value.toLowerCase()
    .replace(/delf|tef|tcf|canada|b2|法语|写作|备考|考试|资料|知识库|用户|人群|内容|方法/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const chars = Array.from(normalized);
  const tokens = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) tokens.add(`${chars[index]}${chars[index + 1]}`);
  return tokens;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function unique(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(clean).filter(Boolean))) : [];
}

function artifact(data: TopicOption[], inputHash: string, usage: AiUsageSummary, requestId: string, warnings: string[] = []): VersionedArtifact<TopicOption[]> {
  return { data, schema_version: V2_SCHEMA_VERSION, prompt_version: TOPIC_PROMPT_VERSION, input_hash: inputHash, created_at: new Date().toISOString(), usage, warnings, request_id: requestId };
}

export function getCapabilityFallback(card: CompetitorCreativeCard): TemplateCapability {
  const spec = getCoverTemplateSpec(card.renderer_id);
  if (!spec) throw new Error(`模板 ${card.renderer_id} 没有V2能力配置`);
  return {
    renderer: card.renderer_id,
    family: spec.family,
    compiler: ['phrase', 'flashcard', 'table'].includes(spec.family) ? 'pairs' : ['pain', 'experience'].includes(spec.family) ? 'narrative' : spec.family === 'document' ? 'document' : spec.family === 'offer' || spec.family === 'roadmap' || spec.family === 'book' ? 'offer' : 'directory',
    renderMode: spec.renderMode,
    allowedGoals: spec.family === 'pain' || spec.family === 'experience' ? ['click', 'search'] : spec.family === 'offer' || spec.family === 'roadmap' ? ['conversion', 'save', 'search'] : ['save', 'search', 'click', 'conversion'],
    acceptedBlockKinds: ['phrase', 'flashcard', 'table'].includes(spec.family) ? ['pair', 'group'] : ['pain', 'experience'].includes(spec.family) ? ['paragraph', 'quote', 'step'] : spec.family === 'document' ? ['example', 'pair', 'group'] : spec.family === 'offer' || spec.family === 'roadmap' || spec.family === 'book' ? ['benefit', 'group', 'step'] : ['group', 'step', 'benefit'],
    allowedTitleMechanisms: spec.allowedCoverTitleTypes || [],
    densityTiers: buildTiers(spec.sectionCount, spec.itemsPerSection, spec.maxPrimaryVisualLength, spec.maxSecondaryVisualLength),
    languagePolicy: spec.primaryFrenchOnly ? 'primary_french' : 'mixed',
  };
}

function buildTiers(sections: number, items: number, primary: number, secondary: number): TemplateCapability['densityTiers'] {
  const compactSections = sections === 1 ? 1 : Math.max(2, sections - 1);
  const normalSectionMin = sections === 1 ? 1 : Math.max(2, sections - 1);
  // Small narrative/card templates use every item as part of their visual
  // structure (for example plain_experience is exactly two paragraphs).
  // Letting the compact tier subtract two would silently turn that contract
  // into a one-paragraph cover. Dense lists can still shed two items.
  const compactItemMin = items <= 2 ? items : Math.max(1, items - 2);
  const compactItemMax = Math.max(compactItemMin, items - 1);
  const normalItemMin = Math.max(1, items - 1);
  const normalItemMax = Math.max(normalItemMin, items);
  const denseItemMin = Math.max(1, items);
  return [
    { id: 'compact', sectionRange: [compactSections, compactSections], itemRange: [compactItemMin, compactItemMax], primaryVisualLength: [1, primary], secondaryVisualLength: [0, secondary] },
    { id: 'normal', sectionRange: [normalSectionMin, sections], itemRange: [normalItemMin, normalItemMax], primaryVisualLength: [1, primary], secondaryVisualLength: [0, secondary] },
    { id: 'dense', sectionRange: [sections, sections], itemRange: [denseItemMin, denseItemMin + 1], primaryVisualLength: [1, primary], secondaryVisualLength: [0, secondary] },
  ];
}
