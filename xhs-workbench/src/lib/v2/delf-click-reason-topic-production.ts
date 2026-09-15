import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { callOpenAICompatibleJsonWithUsage, emptyAiUsage } from '@/lib/ai-client';
import { listBatches, loadAllJobs } from '@/lib/batch-store';
import { getProductPromptProfile } from '@/lib/product-prompt-profiles';
import { hasForbiddenProductIdentity, hasRequiredProductIdentity } from '@/lib/product-prompt-profiles';
import { findSimilarTopic } from '@/lib/title-usage-store';
import type { ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';
import type { CompetitorCreativeCard, MigratedTopic } from '@/types/reference-workflow';
import { stableHash, type TemplateCapability, type TopicOption, type VersionedArtifact, V2_SCHEMA_VERSION } from './contracts';
import { findHistoricalTopicMatch } from './topic-history-dedup';
import { getMarketTopicReferences, type MarketTopicReference } from './market-topic-pool';

const RECENT_TOPIC_CORE_WINDOW = 40;
const REFERENCE_SLOT_BUFFER = 4;
const VALID_HISTORY_STATUSES = new Set(['pending', 'running', 'success', 'awaiting_review']);

type ReferenceSeed = {
  referenceId: number;
  sourceTitle: string;
  sourceSummary?: string;
  sourceNoteUrl?: string;
  sourceCoverUrl?: string;
  noteId?: string;
  date?: string;
  likes?: number;
  favorites?: number;
  comments?: number;
  shares?: number;
  clickReasonId: string;
  clickReason: string;
  referenceTopicCoreSeed: string;
  productTopicCoreSeed: string;
  delfWritingTopicCoreSeed?: string;
  referenceTitleSkeleton: string;
  transferable: boolean;
};

type SeedArtifact = { version: string; source: string; generatedAt: string; seedCount: number; seeds: ReferenceSeed[] };
type HistoryItem = {
  batchCreatedAt: string;
  seq: number;
  finalTopic: string;
  topicCore?: string;
  clickReasonId?: string;
  referenceId?: number;
  primaryReferenceTitle?: string;
};
type ReferenceSlot = {
  slotId: string;
  referenceId: number;
  clickReasonId: string;
  clickReason: string;
  primaryReferenceTitle: string;
  sourceSummary?: string;
  sourceNoteUrl?: string;
  sourceCoverUrl?: string;
  noteId?: string;
  referenceTopicCoreSeed: string;
  productTopicCoreSeed: string;
  delfWritingTopicCoreSeed?: string;
  referenceTitleSkeleton: string;
  imitationMode: 'DIRECT_NEIGHBOR' | 'STRUCTURE_ONLY';
  metrics: Pick<ReferenceSeed, 'date' | 'likes' | 'favorites' | 'comments' | 'shares'>;
};
type RawResult = {
  slotId?: string;
  finalTopic?: string;
  skeletonInstantiation?: string;
  audienceState?: string;
  scene?: string;
  painOrDesire?: string;
  promise?: string;
  contentAngle?: string;
};

export type DelfReferenceFirstMetrics = {
  requested: number;
  referenceSlotsPrepared: number;
  recentCoreWindowSize: number;
  preGenerationRecentCoreSkipped: number;
  aiTopicCallCount: number;
  rawGenerated: number;
  finalRetained: number;
  uniqueReferenceCount: number;
  uniqueClickReasonCount: number;
  uniqueTopicCoreCount: number;
  recentCoreDuplicateDropped: number;
  fullHistoryTitleDuplicateDropped: number;
  batchDuplicateDropped: number;
  invalidGeneratedDropped: number;
  reusedOldReferenceCount: number;
  reusedOldTopicFamilyCount: number;
};

function interactionScore(seed: ReferenceSeed) {
  return (seed.likes || 0) + (seed.favorites || 0) * 1.2 + (seed.comments || 0) * 1.5 + (seed.shares || 0) * 1.8;
}

function topicCoreMatch(topicCore: string, existing: readonly string[]) {
  return Boolean(findHistoricalTopicMatch(topicCore, existing) || findSimilarTopic(topicCore, [...existing], 0.56));
}

function isUnsupportedOrChapterTopic(topic: string) {
  return /最近都考|考了什么|题目趋势|最新考情|真题|报名考位|出分反馈|真实成绩|用户评价|社群|招募|播客|电影|博主推荐|免费资源合集|资源一键|课程购买|提分方法|超详细|照抄|攻略|指南|合集/i.test(topic)
    || /词汇.{0,6}(分类|积累)|句法.{0,6}(分类|积累)|语法.{0,6}(怎么练|知识)|段落结构|开头.{0,8}(套用|写法)|某一段|批改后.{0,8}(记|复盘)|评分维度.{0,8}(对应|位置)|写作.{0,8}框架|表达.{0,8}替换|第[一二三四五六七八九\d]+类/i.test(topic);
}

function hasUnsupportedClaim(value: string) {
  return /我|此女|本人|学员|个人认为|做考官|她|他|喜报|喜提|上岸|下岸|拿证|拿下|高分|满分|\d+分|终于过了|不合格|保底|必过|速通|提分最快|高级词.{0,8}减分|通过了?DELF|写作这关终于过了/u.test(value);
}

function seedIsUsable(seed: ReferenceSeed, productId: ProductId) {
  if (!seed.transferable || !seed.sourceTitle?.trim() || !seed.productTopicCoreSeed?.trim() || !seed.referenceTitleSkeleton?.trim()) return false;
  if (hasForbiddenProductIdentity(productId, `${seed.sourceTitle} ${seed.sourceSummary || ''}`)) return false;
  if (productId !== 'delf_b2_writing') return true;
  const core = seed.productTopicCoreSeed;
  if (/一起备考|同伴|指导|出分|成绩反馈|现成.{0,8}材料|阅读材料|外刊|口语任务|辩论/u.test(seed.clickReason)) return false;
  if (/实时|最新考情|近期真题|真题|考场回忆|出分|成绩反馈|学员|用户评价|社群|论坛|求助|招募|导师|批改伙伴|针对性指导|新闻稿|外刊|播客|电影|博主|免费资源包|现成背诵材料|课程促销/u.test(core)) return false;
  if (/以[^，。]{0,40}身份|分享.{0,24}(经历|经验|高分|满分|通过)|高分经验|低分飘过|裸考经验|证书到手|获得写作高分|顺利通过|\d+页|背完保底|第[一二三四五六七八九\d]+类/u.test(core)) return false;
  if (/(喜报|喜提|上岸|下岸|拿证|拿下|高分|满分|\d+分|终于过了|通过|不合格|保底|必过|速通|我|此女|个人认为|学员|考官|真题|法国场|上海场|照抄|提分方法|超详细|高级词.{0,8}减分)/u.test(seed.sourceTitle)) return false;
  return true;
}

function inferImitationMode(seed: ReferenceSeed, productId: ProductId): ReferenceSlot['imitationMode'] {
  const identity = productId === 'delf_b2_writing' ? /DELF\s*B2.{0,8}(写作|作文)|写作.{0,8}DELF\s*B2/iu : /TCF.{0,12}(写作|作文)|写作.{0,12}TCF/iu;
  return identity.test(seed.sourceTitle) ? 'DIRECT_NEIGHBOR' : 'STRUCTURE_ONLY';
}

function hasRequiredProductIdentityForTopic(productId: ProductId, topic: string) {
  if (productId === 'delf_b2_writing') return /(?:DELF\s*)?B2/iu.test(topic) && /写作|作文/u.test(topic);
  if (productId === 'tcf_canada_writing_7day') return /TCF\s*(?:Canada|加拿大)?/iu.test(topic) && /写作|作文|T[123]/iu.test(topic);
  return hasRequiredProductIdentity(productId, topic);
}

async function loadReferenceSeeds(productId: ProductId): Promise<SeedArtifact> {
  if (productId === 'delf_b2_writing') {
    const file = path.join(process.cwd(), 'data', 'market', 'delf-reference-topic-seeds.json');
    const value = JSON.parse(await readFile(file, 'utf8')) as SeedArtifact;
    if (!Array.isArray(value.seeds) || value.seeds.length === 0) throw new Error('DELF_REFERENCE_TOPIC_SEEDS_EMPTY');
    // The offline seed file owns the editorial mapping, while the CSV owns the
    // source-note assets. Join them by the already-bound reference title so the
    // cover stage can lazily preview the real source cover without a new store.
    const csvReferences = await getMarketTopicReferences(productId, 220);
    const csvByTitle = new Map(csvReferences.map(reference => [reference.sourceTitle.trim(), reference]));
    const seeds = value.seeds.map(seed => ({
      ...seed,
      productTopicCoreSeed: seed.productTopicCoreSeed || seed.delfWritingTopicCoreSeed || seed.referenceTopicCoreSeed,
      ...(csvByTitle.get(seed.sourceTitle.trim()) ? {
        sourceNoteUrl: csvByTitle.get(seed.sourceTitle.trim())?.sourceNoteUrl,
        sourceCoverUrl: csvByTitle.get(seed.sourceTitle.trim())?.sourceCoverUrl,
        noteId: csvByTitle.get(seed.sourceTitle.trim())?.noteId,
      } : {}),
    }));
    return { ...value, seeds };
  }
  const references = await getMarketTopicReferences(productId, 220);
  const boundary = productId === 'tcf_canada_writing_7day' ? 'TCF Canada写作考前7天' : 'TCF Canada备考';
  const seeds: ReferenceSeed[] = references.map((reference: MarketTopicReference, index) => ({
    referenceId: index,
    sourceTitle: reference.sourceTitle,
    sourceSummary: reference.sourceSummary,
    sourceNoteUrl: reference.sourceNoteUrl,
    sourceCoverUrl: reference.sourceCoverUrl,
    noteId: reference.noteId,
    date: reference.date,
    likes: reference.likes,
    favorites: reference.favorites,
    comments: reference.comments,
    shares: reference.shares,
    clickReasonId: `market_ref_${stableHash(reference.sourceTitle).slice(0, 12)}`,
    clickReason: `用户想了解：${reference.sourceTitle}`,
    referenceTopicCoreSeed: reference.sourceTitle,
    productTopicCoreSeed: `${boundary}中的${reference.sourceTitle}`,
    referenceTitleSkeleton: reference.sourceTitle,
    transferable: true,
  }));
  return { version: `${productId}-market-reference-seeds-v1`, source: 'market-topic-pool', generatedAt: new Date().toISOString(), seedCount: seeds.length, seeds };
}

async function loadMarketHistory(productId: ProductId): Promise<HistoryItem[]> {
  const batches = (await listBatches()).filter(batch => batch.product_id === productId && batch.content_mode !== 'product_showcase');
  const grouped = await Promise.all(batches.map(async batch => ({ batch, jobs: await loadAllJobs(batch.id).catch(() => []) })));
  return grouped.flatMap(({ batch, jobs }) => jobs
    .filter(job => VALID_HISTORY_STATUSES.has(job.status) && job.topic.topicSource === 'market')
    .map(job => {
      const topic = job.topic as MigratedTopic;
      return {
        batchCreatedAt: batch.created_at,
        seq: job.seq,
        finalTopic: topic.topic,
        topicCore: topic.topicCore,
        clickReasonId: topic.clickReasonId,
        referenceId: topic.referenceId,
        primaryReferenceTitle: topic.primaryReferenceTitle,
      };
    }))
    .sort((a, b) => b.batchCreatedAt.localeCompare(a.batchCreatedAt) || b.seq - a.seq);
}

function chooseReferenceSlots(input: {
  productId: ProductId;
  seeds: ReferenceSeed[];
  history: HistoryItem[];
  targetCount: number;
  rotationIndex: number;
  usedReferenceTitles: string[];
  usedReasonIds: string[];
  usedTopicCores: string[];
  exhaustedReasonIds?: string[];
}) {
  const recentHistory = input.history.slice(0, RECENT_TOPIC_CORE_WINDOW);
  const recentCores = recentHistory.map(item => item.topicCore).filter((value): value is string => Boolean(value));
  const recentReferenceIds = new Set(recentHistory.map(item => item.referenceId).filter((value): value is number => Number.isFinite(value)));
  const recentReferenceTitles = new Set(recentHistory.map(item => item.primaryReferenceTitle).filter((value): value is string => Boolean(value)));
  const anyHistoricalReferenceIds = new Set(input.history.map(item => item.referenceId).filter((value): value is number => Number.isFinite(value)));
  const oldCores = input.history.slice(RECENT_TOPIC_CORE_WINDOW).map(item => item.topicCore).filter((value): value is string => Boolean(value));
  const usedReferencesThisBatch = new Set(input.usedReferenceTitles);
  const usedReasonsThisBatch = new Set(input.usedReasonIds);
  let preGenerationRecentCoreSkipped = 0;
  const exhaustedReasons = new Set(input.exhaustedReasonIds || []);
  const eligible = input.seeds.filter(seed => {
    if (!seedIsUsable(seed, input.productId) || usedReferencesThisBatch.has(seed.sourceTitle) || exhaustedReasons.has(seed.clickReasonId)) return false;
    if (topicCoreMatch(seed.productTopicCoreSeed, input.usedTopicCores)) return false;
    if (topicCoreMatch(seed.productTopicCoreSeed, recentCores)) {
      preGenerationRecentCoreSkipped += 1;
      return false;
    }
    return true;
  });
  const historyCountByReason = new Map<string, number>();
  for (const item of input.history) if (item.clickReasonId) historyCountByReason.set(item.clickReasonId, (historyCountByReason.get(item.clickReasonId) || 0) + 1);
  const sorted = eligible.sort((a, b) =>
    Number(usedReasonsThisBatch.has(a.clickReasonId)) - Number(usedReasonsThisBatch.has(b.clickReasonId))
    || Number(recentReferenceIds.has(a.referenceId) || recentReferenceTitles.has(a.sourceTitle)) - Number(recentReferenceIds.has(b.referenceId) || recentReferenceTitles.has(b.sourceTitle))
    || (historyCountByReason.get(a.clickReasonId) || 0) - (historyCountByReason.get(b.clickReasonId) || 0)
    || interactionScore(b) - interactionScore(a));
  const start = sorted.length ? input.rotationIndex % sorted.length : 0;
  const rotated = [...sorted.slice(start), ...sorted.slice(0, start)];
  const selected: ReferenceSeed[] = [];
  const selectedReasons = new Set(input.usedReasonIds);
  const selectedCores: string[] = [...input.usedTopicCores];
  const take = (seed: ReferenceSeed) => {
    if (selected.length >= input.targetCount || selected.some(item => item.referenceId === seed.referenceId)) return false;
    if (topicCoreMatch(seed.productTopicCoreSeed, selectedCores)) return false;
    selected.push(seed);
    selectedReasons.add(seed.clickReasonId);
    selectedCores.push(seed.productTopicCoreSeed);
    return true;
  };
  for (const seed of rotated) {
    if (selectedReasons.has(seed.clickReasonId)) continue;
    take(seed);
    if (selected.length >= input.targetCount) break;
  }
  if (selected.length < input.targetCount) {
    for (const seed of rotated) {
      take(seed);
      if (selected.length >= input.targetCount) break;
    }
  }
  const slots: ReferenceSlot[] = selected.map((seed, index) => ({
    slotId: `reference_slot_${index + 1}`,
    referenceId: seed.referenceId,
    clickReasonId: seed.clickReasonId,
    clickReason: seed.clickReason,
    primaryReferenceTitle: seed.sourceTitle,
    sourceSummary: seed.sourceSummary,
    sourceNoteUrl: seed.sourceNoteUrl,
    sourceCoverUrl: seed.sourceCoverUrl,
    noteId: seed.noteId,
    referenceTopicCoreSeed: seed.referenceTopicCoreSeed,
    productTopicCoreSeed: seed.productTopicCoreSeed,
    ...(seed.delfWritingTopicCoreSeed ? { delfWritingTopicCoreSeed: seed.delfWritingTopicCoreSeed } : {}),
    referenceTitleSkeleton: seed.referenceTitleSkeleton,
    imitationMode: inferImitationMode(seed, input.productId),
    metrics: { date: seed.date, likes: seed.likes, favorites: seed.favorites, comments: seed.comments, shares: seed.shares },
  }));
  return {
    slots,
    recentCores,
    preGenerationRecentCoreSkipped,
    reusedOldReferenceCount: selected.filter(seed => anyHistoricalReferenceIds.has(seed.referenceId) && !recentReferenceIds.has(seed.referenceId)).length,
    reusedOldTopicFamilyCount: selected.filter(seed => topicCoreMatch(seed.productTopicCoreSeed, oldCores)).length,
  };
}

export async function generateMarketReferenceFirstTopics(input: {
  productId: ProductId; card: CompetitorCreativeCard; capability: TemplateCapability; facts: ProductFacts; limit: number;
  direction?: string; recentTopics?: string[]; avoidTopics?: string[]; usedMarketReferenceTitles?: string[];
  usedMarketReasonIds?: string[]; usedMarketTopicCores?: string[]; usedMarketFinalTopics?: string[]; topicRotationIndex?: number;
  exhaustedMarketReasonIds?: string[]; topicGenerationAttemptId?: string; debugRound?: number; examScope?: import('@/types/data').ExamScope;
}): Promise<VersionedArtifact<TopicOption[]>> {
  const seedArtifact = await loadReferenceSeeds(input.productId);
  const history = await loadMarketHistory(input.productId);
  const targetCount = Math.min(20, Math.max(1, input.limit) + REFERENCE_SLOT_BUFFER);
  const selection = chooseReferenceSlots({
    productId: input.productId,
    seeds: seedArtifact.seeds,
    history,
    targetCount,
    rotationIndex: input.topicRotationIndex || 0,
    usedReferenceTitles: input.usedMarketReferenceTitles || [],
    usedReasonIds: input.usedMarketReasonIds || [],
    usedTopicCores: input.usedMarketTopicCores || [],
    exhaustedReasonIds: input.exhaustedMarketReasonIds || [],
  });
  const baseMetrics: DelfReferenceFirstMetrics = {
    requested: input.limit,
    referenceSlotsPrepared: selection.slots.length,
    recentCoreWindowSize: RECENT_TOPIC_CORE_WINDOW,
    preGenerationRecentCoreSkipped: selection.preGenerationRecentCoreSkipped,
    aiTopicCallCount: selection.slots.length ? 1 : 0,
    rawGenerated: 0,
    finalRetained: 0,
    uniqueReferenceCount: 0,
    uniqueClickReasonCount: 0,
    uniqueTopicCoreCount: 0,
    recentCoreDuplicateDropped: 0,
    fullHistoryTitleDuplicateDropped: 0,
    batchDuplicateDropped: 0,
    invalidGeneratedDropped: 0,
    reusedOldReferenceCount: selection.reusedOldReferenceCount,
    reusedOldTopicFamilyCount: selection.reusedOldTopicFamilyCount,
  };
  if (!selection.slots.length) {
    return {
      data: [], schema_version: V2_SCHEMA_VERSION, prompt_version: 'market-reference-first-v2',
      input_hash: stableHash({ productId: input.productId, limit: input.limit, seedVersion: seedArtifact.version }),
      created_at: new Date().toISOString(), usage: emptyAiUsage(), warnings: [`MARKET_REFERENCE_FIRST_METRICS:${JSON.stringify(baseMetrics)}`],
    };
  }
  const profile = getProductPromptProfile(input.productId);
  const productBoundary = input.productId === 'delf_b2_writing'
    ? '当前账号只生产DELF B2写作内容。Market Reference可以来自DELF B2整体备考，但最终Topic必须自然落到DELF B2写作。'
    : input.productId === 'tcf_canada_writing_7day'
      ? '当前账号只生产TCF Canada写作考前7天内容。最终Topic必须落到TCF Canada写作的T1/T2/T3与考前纠错训练。'
      : `当前账号生产${profile.noteIdentity}普通备考内容。最终Topic必须保持TEF/TCF Canada语境，并遵守当前选择的考试范围。`;
  const result = await callOpenAICompatibleJsonWithUsage<{ results?: RawResult[] }>([
    { role: 'system', content: [
      `你是${profile.noteIdentity}的小红书Market Topic文字编辑。代码已经为每条任务选定真实Market Reference和固定Topic Core。`,
      `你无权发明、替换、扩大或缩小Topic Core。每个slot必须围绕productTopicCoreSeed表达同一个整篇笔记主题；Reference决定这篇写什么，也决定怎么说。`,
      '优先继承referenceTitleSkeleton的开头、节奏、句式类型与信息顺序，但不能机械复制原文，也不能搬用原帖的个人成绩、身份、上岸、通过、满分或第一人称经历。必要时中性化具体事实，但不要把所有结果改成统一问句。',
      'finalTopic就是后续封面主标题：一句自然、可点击、可直接放封面的小红书整篇笔记主题。不得写成课程章节、SEO标题、商品目录、攻略/指南/合集/全规划，也不得依赖实时考情、外部资源清单、学员案例或未验证数据。',
      '不要输出topicCore；它已经由代码固定。不要跳到另一个Click Reason或Reference。若骨架含不安全事实，只保留可迁移的语言节奏并中性化。',
      '只返回JSON对象：{"results":[{"slotId":"reference_slot_1","finalTopic":"...","skeletonInstantiation":"...","audienceState":"...","scene":"...","painOrDesire":"...","promise":"...","contentAngle":"..."}]}。每个输入slot最多返回一次。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ contentBoundary: productBoundary, productScope: profile.topicScopePrompt, examScope: input.examScope, fixedReferenceSlots: selection.slots, batchAvoidFinalTopics: input.usedMarketFinalTopics || [] }) },
  ], { stage: 'delf-reference-first-market-topic', model: 'deepseek-flash', maxTokens: Math.min(9000, Math.max(3000, selection.slots.length * 460)), temperature: 0.55, retries: 1 });

  const rawResults = Array.isArray(result.data.results) ? result.data.results : [];
  const metrics = { ...baseMetrics, rawGenerated: rawResults.length };
  const accepted: TopicOption[] = [];
  const acceptedFinalTopics: string[] = [];
  const acceptedCores: string[] = [];
  const fullHistoryFinalTopics = [...history.map(item => item.finalTopic), ...(input.usedMarketFinalTopics || []), ...(input.recentTopics || []), ...(input.avoidTopics || [])].filter(Boolean);
  const slotById = new Map(selection.slots.map(slot => [slot.slotId, slot]));
  const seenSlots = new Set<string>();
  for (const raw of rawResults) {
    const slot = raw.slotId ? slotById.get(raw.slotId) : undefined;
    const topic = raw.finalTopic?.trim() || '';
    const hasRequiredProductIdentity = hasRequiredProductIdentityForTopic(input.productId, topic);
    if (!slot || seenSlots.has(slot.slotId) || !topic || topic.length < 6 || !hasRequiredProductIdentity || isUnsupportedOrChapterTopic(topic) || hasUnsupportedClaim(topic) || hasForbiddenProductIdentity(input.productId, topic)) {
      metrics.invalidGeneratedDropped += 1;
      continue;
    }
    seenSlots.add(slot.slotId);
    if (topicCoreMatch(slot.productTopicCoreSeed, selection.recentCores)) {
      metrics.recentCoreDuplicateDropped += 1;
      continue;
    }
    if (topicCoreMatch(slot.productTopicCoreSeed, acceptedCores) || findHistoricalTopicMatch(topic, acceptedFinalTopics)) {
      metrics.batchDuplicateDropped += 1;
      continue;
    }
    if (findHistoricalTopicMatch(topic, fullHistoryFinalTopics)) {
      metrics.fullHistoryTitleDuplicateDropped += 1;
      continue;
    }
    acceptedCores.push(slot.productTopicCoreSeed);
    acceptedFinalTopics.push(topic);
    const profile = getProductPromptProfile(input.productId);
    accepted.push({
      id: `market_reference_first_${stableHash(`${input.productId}|${slot.referenceId}|${slot.productTopicCoreSeed}|${topic}`)}`,
      productId: input.productId, templateId: input.card.renderer_id,
      primaryGoal: input.capability.allowedGoals.includes('save') ? 'save' : input.capability.allowedGoals[0] || 'click',
      topicLane: 'result_need', topic, topicSource: 'market',
      marketReference: { sourceTitle: slot.primaryReferenceTitle, sourceSummary: slot.sourceSummary, sourceNoteUrl: slot.sourceNoteUrl, sourceCoverUrl: slot.sourceCoverUrl, noteId: slot.noteId, sourceExam: input.productId === 'delf_b2_writing' ? 'DELF B2' : 'TCF', ...slot.metrics },
      imitationMode: slot.imitationMode, clickReasonId: slot.clickReasonId, clickReason: slot.clickReason,
      referenceId: slot.referenceId, referenceTopicCoreSeed: slot.referenceTopicCoreSeed,
      ...(slot.delfWritingTopicCoreSeed ? { delfWritingTopicCoreSeed: slot.delfWritingTopicCoreSeed } : {}),
      primaryReferenceTitle: slot.primaryReferenceTitle, referenceTitleSkeleton: slot.referenceTitleSkeleton,
      skeletonInstantiation: raw.skeletonInstantiation || topic,
      referenceCandidates: [{ title: slot.primaryReferenceTitle, titleSkeleton: slot.referenceTitleSkeleton, compatibility: 'ACCEPT' }],
      rawModelFinalTopic: topic, postprocessedFinalTopic: topic, topicCore: slot.productTopicCoreSeed,
      historicalTopicCoresForReasonCount: history.filter(item => item.clickReasonId === slot.clickReasonId && item.topicCore).length,
      audienceState: raw.audienceState?.trim() || `正在准备${profile.noteIdentity}、需要一个现实可执行入口的备考者`,
      scene: raw.scene?.trim() || `用户正在安排或调整${profile.noteIdentity}备考`, painOrDesire: raw.painOrDesire?.trim() || slot.clickReason,
      promise: raw.promise?.trim() || `围绕“${slot.productTopicCoreSeed}”给出可执行的准备思路`,
      contentAngle: raw.contentAngle?.trim() || slot.productTopicCoreSeed, productBridge: '',
      plannedBlockKind: input.capability.acceptedBlockKinds[0], seo: { primary: profile.seoKeywords[0] || profile.noteIdentity, related: [] },
      knowledgeMode: 'mixed', factTerms: [], seedSignals: ['market_reference_first', String(slot.referenceId)],
      noveltyFingerprint: stableHash(`${input.productId}|${slot.referenceId}|${slot.productTopicCoreSeed}|${topic}`), expandContents: [],
    });
  }
  metrics.finalRetained = accepted.length;
  metrics.uniqueReferenceCount = new Set(accepted.map(item => item.referenceId)).size;
  metrics.uniqueClickReasonCount = new Set(accepted.map(item => item.clickReasonId)).size;
  metrics.uniqueTopicCoreCount = new Set(accepted.map(item => item.topicCore)).size;
  const warnings = [`MARKET_REFERENCE_FIRST_METRICS:${JSON.stringify(metrics)}`];
  if (accepted.length < input.limit) warnings.push(`${profile.noteIdentity} Reference-first只保留${accepted.length}/${input.limit}条；未用重复标题或近期重复母题强行补齐。`);
  return {
    data: accepted, schema_version: V2_SCHEMA_VERSION, prompt_version: 'market-reference-first-v2',
    input_hash: stableHash({ productId: input.productId, limit: input.limit, seedVersion: seedArtifact.version, slots: selection.slots.map(slot => slot.referenceId) }),
    created_at: new Date().toISOString(), usage: result.usage, request_id: result.requestId, warnings,
  };
}

// Keep the historical export name for already-running Next/Turbopack module
// graphs and any internal tooling that still imports the DELF-specific name.
// The implementation is now shared by all three content_note Market paths.
export const generateDelfMarketTopics = generateMarketReferenceFirstTopics;
