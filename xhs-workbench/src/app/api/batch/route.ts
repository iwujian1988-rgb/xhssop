import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { emptyAiUsage, getRecentAiUsage, mergeAiUsage, resetRecentAiUsage } from '@/lib/ai-client';
import { formatBatchId, formatJobId, createPlannedBatchAtomic, deleteJob, listBatches, loadAllJobs, loadBatch, loadJob, saveJob, updateCommercialPageDelivery, type Batch, type BatchJob, type BatchJobFailureStage, type ContentMode, type KnowledgeMode, type NoteMode } from '@/lib/batch-store';
import { applyDraftTitleSelection, getDraftTitleSelection } from '@/lib/draft-title-selection';
import { resolveCanonicalTitlePackage, withCanonicalTitlePackage } from '@/lib/canonical-title-package';
import { getActiveRunner, startBatchRunner } from '@/lib/batch-runner';
import { getCompetitorCreativeCard, standardCreativeCards, productShowcaseCreativeCards } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { generateTopics, refineSeededTopics } from '@/lib/reference-compose';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { compactProductContext } from '@/lib/product-fact-retrieval';
import { planSeededTopics } from '@/lib/editorial-seed-library';
import { getRecentSeedIds } from '@/lib/seed-usage-store';
import { findSimilarTopic } from '@/lib/title-usage-store';
import type { ExamScope, ProductId } from '@/types/data';
import { compileCover, isV2PipelineEnabled, planTopicsV2 } from '@/lib/v2/pipeline';
import { resolvePipelineFeatures, usesStandardEducationalAutoPlan } from '@/lib/v2/pipeline-features';
import { topicDedupText } from '@/lib/v2/batch-topic-selection';
import { BATCH_TOPIC_EXPRESSIONS, editorialTaskToTopicOption, planBatchEditorialTasks } from '@/lib/v2/batch-editorial-plan';
import { getCapabilityFallback } from '@/lib/v2/topic-stage';
import { topicOptionToMigrated } from '@/lib/v2/topic-stage';
import type { ConsensusTopicOption } from '@/lib/v2/consensus-topic-stage';
import type { BatchPlanMeta } from '@/lib/batch-store';
import { planBatchTopicMap } from '@/lib/v2/batch-topic-map';
import { readTopicCoordinateUsage } from '@/lib/v2/topic-coordinate-store';
import { matchTopicCoordinatesToCoverSlots } from '@/lib/v2/cover-topic-matcher';
import type { TopicOption } from '@/lib/v2/contracts';
import type { DemandArchetype } from '@/lib/v2/product-topic-scope-plan';
import { demandTypeForBatchIndex, granularityForBatchIndex, valueTypeForBatchIndex } from '@/lib/v2/topic-value';
import { generateFinalCoverBlocks } from '@/lib/v2/content-stage';
import { resolveExamScope } from '@/lib/product-exam-context';
import { PRODUCT_NOTE_ANGLES, type ProductNoteAngleId } from '@/lib/product-note';
import { buildLockedProductionBrief } from '@/lib/v2/content-brief';
import { getMarketTopicReferences } from '@/lib/v2/market-topic-pool';

export const runtime = 'nodejs';
import { assertReviewedInner, lockInnerWorkingCopy, saveInnerWorkingCopy, teachingPages, dropInnerJob, assertNotDropped } from '@/lib/manual-inner-review';
import { stableHash } from '@/lib/v2/contracts';
import { repaginateDraftForOverflow } from '@/lib/render-repagination';
import {projectReadablePages,type ReadablePagePlan} from '@/lib/readable-inner-layout';

function comparableReferenceTitle(value: string) {
  return value.replace(/[\s.…。！!？?，,：:｜|、]/gu, '').toLowerCase();
}

async function hydrateMarketReferenceAssets(jobs: BatchJob[]) {
  const productIds = Array.from(new Set(jobs.filter(job => job.topic.topicSource === 'market').map(job => job.product_id)));
  if (!productIds.length) return jobs;
  const referencesByProduct = new Map<ProductId, Awaited<ReturnType<typeof getMarketTopicReferences>>>();
  await Promise.all(productIds.map(async productId => {
    referencesByProduct.set(productId, await getMarketTopicReferences(productId, 220));
  }));
  return jobs.map(job => {
    if (job.topic.topicSource !== 'market' || !job.topic.marketReference?.sourceTitle) return job;
    const references = referencesByProduct.get(job.product_id) || [];
    const wanted = comparableReferenceTitle(job.topic.marketReference.sourceTitle);
    const reference = references.find(item => item.sourceTitle === job.topic.marketReference?.sourceTitle)
      || references.find(item => comparableReferenceTitle(item.sourceTitle) === wanted)
      || references.find(item => comparableReferenceTitle(item.sourceTitle).includes(wanted) || wanted.includes(comparableReferenceTitle(item.sourceTitle)));
    if (!reference) return job;
    return {
      ...job,
      topic: {
        ...job.topic,
        marketReference: {
          ...job.topic.marketReference,
          sourceNoteUrl: job.topic.marketReference.sourceNoteUrl || reference.sourceNoteUrl,
          sourceCoverUrl: job.topic.marketReference.sourceCoverUrl || reference.sourceCoverUrl,
          noteId: job.topic.marketReference.noteId || reference.noteId,
        },
      },
    };
  });
}

// Serialize read/modify/write with runner-start actions in this server process.
let mutationQueue: Promise<unknown> = Promise.resolve();
function mutate<T>(work: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(work, work);
  mutationQueue = result.catch(() => undefined);
  return result;
}

const productIds: ProductId[] = ['delf_b2_writing', 'tef_tcf_canada', 'tcf_canada_writing_7day'];
let planQueue = Promise.resolve();

interface PlanBody {
  topic_scope?: 'large' | 'medium';
  product_id: ProductId;
  card_ids?: string[];
  job_count?: number;
  direction?: string;
  content_mode?: ContentMode;
  knowledge_mode?: KnowledgeMode;
  topics_per_card?: number;
  exam_scope?: ExamScope;
  note_mode?: NoteMode;
  product_note_angles?: ProductNoteAngleId[];
  market_reference_titles_used?: string[];
  round_topic_titles?: string[];
}

interface RunBody {
  batch_id: string;
  /** Internal/smoke-run target. Omitted keeps the existing whole-batch behavior. */
  job_id?: string;
}

interface RetryFailedBody {
  batch_id: string;
  job_ids?: string[];
}

interface ResumeSelectedJobsBody {
  batch_id: string;
  job_ids: string[];
}

interface DeleteJobBody {
  batch_id: string;
  job_id: string;
}

interface UpdateDraftStateBody {
  batch_id: string;
  job_id: string;
  selected_bundle_id?: string;
  selected_cover_title_id?: string;
  selected_cover_template_id?: string;
  expected_cover_request_id?: string;
  cover_edit_state?: { bundleId: string; blocks: unknown[] };
  inner_pages?: NonNullable<BatchJob['draft']>['inner_pages'];
  rerun_downstream?: boolean;
  confirm_inner_review?: boolean;
  drop_inner_review?: boolean;
  expected_inner_hash?: string;
  render_overflow_page_no?: number;
  readable_page_plan?: ReadablePagePlan;
  cover_route?: 'MARKET_REFERENCE_COVER' | 'DAZIBAO';
  selected_market_reference_id?: number;
  selected_dazibao_reference_id?: string;
}

interface UpdateCommercialDeliveryBody {
  batch_id: string;
  job_id: string;
  delivered_page_ids: string[];
  artifact_paths?: Record<string, string>;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    switch (body?.action) {
      case 'plan':
        return await handlePlan(body as PlanBody);
      case 'run':
        return await mutate(() => handleRun(body as RunBody));
      case 'retry_failed':
        return await mutate(() => handleRetryFailed(body as RetryFailedBody));
      case 'switch_title_artifact':
        return await mutate(() => handleSwitchTitleArtifact(body as { batch_id: string; job_id: string }));
      case 'resume_reviewed_inner':
        return await mutate(async () => {
          if (getActiveRunner()) return error('生产正在运行，请结束后再继续', 409);
          const job = await loadJob(body.batch_id, body.job_id);
          assertNotDropped(job);
          if (!job.artifacts?.content?.data.manualInnerReview) return error('请先确认审校', 409);
          assertReviewedInner(job.artifacts.content.data);
          if (!job.draft || (job.draft.downstreamStale && stableHash(teachingPages(job.draft.inner_pages)) !== job.artifacts.content.data.manualInnerReview.innerHash)) return error('工作副本已变更，请重新确认', 409);
          await saveJob(body.batch_id, { ...job, status: 'pending', failure: undefined });
          return NextResponse.json(await startBatchRunner(body.batch_id, body.job_id));
        });
      case 'resume_selected_jobs':
        return await mutate(() => handleResumeSelectedJobs(body as ResumeSelectedJobsBody));
      case 'delete_job':
        return await handleDeleteJob(body as DeleteJobBody);
      case 'update_draft_state':
        return await mutate(() => handleUpdateDraftState(body as UpdateDraftStateBody));
      case 'update_commercial_delivery':
        return await handleUpdateCommercialDelivery(body as UpdateCommercialDeliveryBody);
      default:
        return error(`未知 action: ${body?.action ?? '(missing)'}`, 400);
    }
  } catch (cause) {
    console.error('batch POST failed:', cause);
    return error(cause instanceof Error ? cause.message : '批量请求失败', 500);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const batchId = url.searchParams.get('batch_id');
    if (batchId) {
      const batch = await loadBatch(batchId);
      const jobs = await hydrateMarketReferenceAssets(await loadAllJobs(batchId));
      const readyJobs = jobs.filter(job => job.commercial?.status === 'READY');
      const repairJobs = jobs.filter(job => job.commercial?.status === 'NEEDS_REPAIR');
      const failedJobs = jobs.filter(job => job.commercial?.status === 'FAILED');
      return NextResponse.json({
        batch,
        jobs,
        requestedJobs: jobs.length,
        readyJobs: readyJobs.map(job => job.id),
        repairJobs: repairJobs.map(job => job.id),
        failedJobs: failedJobs.map(job => job.id),
        status: readyJobs.length === jobs.length ? 'PASS' : readyJobs.length ? 'PARTIAL_SUCCESS' : 'PARTIAL_SUCCESS',
        active_runner: getActiveRunner(),
      });
    }
    if (url.searchParams.get('list')) {
      const batches = await listBatches();
      return NextResponse.json({ batches });
    }
    return error('请提供 batch_id 或 list=1', 400);
  } catch (cause) {
    console.error('batch GET failed:', cause);
    return error(cause instanceof Error ? cause.message : '批量查询失败', 500);
  }
}

async function handlePlan(body: PlanBody) {
  const previous = planQueue;
  let release!: () => void;
  planQueue = new Promise<void>(resolve => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await handlePlanUnlocked(body);
  } finally {
    release();
  }
}

async function handlePlanUnlocked(body: PlanBody) {
  if (!productIds.includes(body.product_id)) return error('不支持的商品', 400);
  const contentMode: ContentMode = body.content_mode === 'product_showcase' ? 'product_showcase' : 'standard';
  const noteMode: NoteMode = body.note_mode === 'product_note' ? 'product_note' : 'content_note';
  if (noteMode === 'product_note') {
    if (body.product_id !== 'delf_b2_writing') return error('Phase 1B 当前只支持商品1 DELF B2写作资料', 400);
    const angles = Array.from(new Set(Array.isArray(body.product_note_angles) ? body.product_note_angles : []));
    if (!angles.length || angles.length > 3 || angles.some(id => !PRODUCT_NOTE_ANGLES.some(item => item.id === id))) return error('商品笔记请选择1至3个有效Selling Angle', 400);
    const card = productShowcaseCreativeCards[0];
    if (!card) return error('商品笔记缺少截图模板', 500);
    const batchId = formatBatchId();
    const jobs: BatchJob[] = angles.map((angleId, index) => {
      const angle = PRODUCT_NOTE_ANGLES.find(item => item.id === angleId)!;
      const topic: TopicOption = {
        id: `product_note_${angleId}_${Date.now()}_${index}`, productId: body.product_id, templateId: card.renderer_id,
        primaryGoal: 'conversion', topicLane: 'product_value', topic: `DELF B2写作资料：${angle.label}`,
        audienceState: '正在准备DELF B2写作、想先确认资料是否值得买的学习者', scene: angle.instruction,
        painOrDesire: angle.instruction, promise: angle.instruction, contentAngle: angle.instruction,
        plannedBlockKind: 'group', productBridge: '用真实PDF截图证明商品包含的内容和使用方式',
        seo: { primary: 'DELF B2写作资料', related: ['DELF B2写作备考', '法语写作资料'] }, knowledgeMode: 'product_grounded',
        factTerms: [], seedSignals: ['product_note', angleId], noveltyFingerprint: stableHash(`${batchId}|${angleId}`),
      };
      topic.productionBrief = buildLockedProductionBrief(topic);
      return { id: formatJobId(index + 1), seq: index + 1, product_id: body.product_id, reference_card_id: card.id,
        topic: topicOptionToMigrated(topic), status: 'pending', attempts: 0, pipeline_version: 'v2' as const, current_stage: 'topic_selected' as const };
    });
    const batch: Batch = { id: batchId, product_id: body.product_id, exam_scope: 'common', direction: body.direction || '', topic_scope: 'large',
      content_mode: 'product_showcase', note_mode: noteMode, product_note_angles: angles, knowledge_mode: 'product_grounded', created_at: new Date().toISOString(),
      status: 'planned', pipeline_version: 'v2', jobs: [] };
    await createPlannedBatchAtomic(batch, jobs);
    return NextResponse.json({ batch: await loadBatch(batchId), status: 'PASS', successfulJobs: jobs.map(job => job.id), failedJobs: [], usage: emptyAiUsage(), pipeline_version: 'v2' });
  }
  const knowledgeMode: KnowledgeMode = contentMode === 'product_showcase'
    ? 'product_grounded'
    : body.knowledge_mode === 'educational_original' || body.knowledge_mode === 'product_grounded'
      ? body.knowledge_mode
      : 'mixed';
  const autoCoverPlan = usesStandardEducationalAutoPlan(body.product_id, contentMode, knowledgeMode);
  const explicitJobCount = autoCoverPlan && body.job_count !== undefined;
  if (body.job_count !== undefined && !autoCoverPlan) return error('当前模式请按模板创建计划', 400);
  if (explicitJobCount && (!Number.isInteger(body.job_count) || body.job_count! < 1 || body.job_count! > 20)) return error('生成篇数必须是1至20的整数', 400);
  if (!explicitJobCount && (!Array.isArray(body.card_ids) || body.card_ids.length === 0)) return error('card_ids 不能为空', 400);
  const cardIds = Array.isArray(body.card_ids) ? body.card_ids : [];
  const topicsPerCard = clamp(body.topics_per_card ?? 2, 1, 3);
  const direction = (body.direction || '').trim();
  if (body.exam_scope && !['tef_canada', 'tcf_canada', 'common'].includes(body.exam_scope)) return error('考试范围只能是 TEF、TCF 或共同内容', 400);
  const examScope = resolveExamScope(body.product_id, body.exam_scope);
  if (body.topic_scope !== undefined && body.topic_scope !== 'large' && body.topic_scope !== 'medium') return error('选题范围只能是大范围或中等范围',400);
  resetRecentAiUsage();
  const batchId = formatBatchId();
  const facts = await loadProductFacts(body.product_id);
  const productContext = compactProductContext(facts);

  const batch: Batch = {
    id: batchId,
    product_id: body.product_id,
    exam_scope: examScope,
    direction,
    topic_scope: body.topic_scope || 'large',
    content_mode: contentMode,
    knowledge_mode: knowledgeMode,
    created_at: new Date().toISOString(),
    status: 'planned',
    pipeline_version: isV2PipelineEnabled() ? 'v2' : 'v1',
    jobs: [],
  };

  const seenTopics = new Set<string>();
  // 批内发牌上下文：上一张卡发过的 seed 和确认的选题文本要传给下一张卡，
  // 否则各卡独立选牌会把同一个 seed 发 5 次（batch_1786754651839 的
  // delf_pain_logic_jump），不同 seed 也会收敛到同一知识点。
  const batchUsedSeedIds: string[] = [];
  const batchUsedTopicTexts: string[] = [];
  // 修复4（阶段F）：跨卡方向轮转。只在下方 useConsensusPlan 分支读写，
  // 商品2/3 与 showcase 走不到该分支，方向挑选行为零变化。
  const batchUsedDirections: string[] = [];
  // 商品1保持坐标选题链；商品2/3只在普通+AI原创模式复用自动批量/封面入口，
  // showcase 和 mixed 仍走原有模板路径。
  const useCoordinatePlan = autoCoverPlan || (contentMode === 'standard' && resolvePipelineFeatures(body.product_id).consensusTopicStage);
  const planMeta: BatchPlanMeta = {};
  let seq = 1;
  let v2Usage = emptyAiUsage();
  const plannedJobs: BatchJob[] = [];
  const planningFailures: Array<{ job_id: string; status: string; reason: string }> = [];

  // One existing Topic AI sees the entire requested batch, not a cover or
  // coordinate/Mother-score task. Card IDs below are legacy allocation metadata.
  if (useCoordinatePlan) {
    // The initial card is compatibility metadata only, never the final Cover selection.
    const placeholder = standardCreativeCards.find(card => card.supported
      && getCoverTemplateSpec(card.renderer_id)?.productionFit !== 'disabled');
    const slots = explicitJobCount
      ? (placeholder ? Array.from({ length: body.job_count! }, () => placeholder) : [])
      : cardIds.flatMap(id => {
      const card = getCompetitorCreativeCard(id);
      return card?.supported && card.renderer_id !== 'showcase_screenshot'
        ? Array.from({ length: topicsPerCard }, () => card) : [];
    });
    if (!slots.length) throw new Error('没有可用的生成名额');
    const recentBatches=(await listBatches({recentLimit:20})).filter(item=>item.product_id===body.product_id && item.content_mode==='standard')
      .sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,5);
    const historyJobs=recentBatches.flatMap(item=>item.jobs);
    const roundTopicTitles = (body.round_topic_titles || []).filter(Boolean).slice(-30);
    const recentAngles=[...historyJobs.map(job=>job.topic.topic), ...roundTopicTitles].slice(-30).reverse();
    // planned large不是人工确认的大题。历史交付不再进入模型输入。
    const verifiedLargeJobs=historyJobs.filter(job=>{
      const assignment=(job.topic as typeof job.topic & {v2_topic?:TopicOption}).v2_topic?.topicAssignment;
      return assignment?.scopeReviewSource==='human' && assignment.actualGranularity==='large';
    });
    const avoidTopics=[...(body.topic_scope==='medium'?historyJobs:verifiedLargeJobs).map(job=>job.topic.topic), ...roundTopicTitles].slice(-30);
    const recentDomainIds=historyJobs.map(job=>(job.topic as typeof job.topic & {v2_topic?:TopicOption}).v2_topic?.topicAssignment?.domainId||'').filter(Boolean);
    const recentDemandArchetypes=historyJobs
      .map(job=>(job.topic as typeof job.topic & {v2_topic?:TopicOption}).v2_topic?.topicAssignment?.demandCard?.demandArchetype)
      .filter((value): value is DemandArchetype => Boolean(value));
    const topicGenerationAttemptId = `attempt_${randomUUID()}`;
    const planned = await planTopicsV2({
      productId: body.product_id, card: slots[0], facts, direction, contentMode,
      limit: slots.length, topicMode: 'batch', topicSourceMode: body.topic_scope === 'medium' ? 'long_tail' : 'market', topicScope:body.topic_scope||'large',recentAngles,avoidTopics,recentDomainIds,recentDemandArchetypes, knowledgeModeOverride: knowledgeMode,
      ...(contentMode === 'standard' && body.topic_scope !== 'medium' ? { topicGenerationAttemptId, debugRound: 1 } : {}),
      examScope, usedMarketReferenceTitles: body.market_reference_titles_used,
    });
    v2Usage = mergeAiUsage(v2Usage, planned.usage);
    // 复用现有 semantic dedupe：跨5条批次的本轮已生成Topic也视为已占用，
    // 不新增历史表或独立去重系统；后续refill仍沿用原流程。
    const acceptedTopicTexts: string[] = [...roundTopicTitles];
    const marketBatchContext: { reasonIds: string[]; exhaustedReasonIds: string[]; primaryReferences: string[]; topicCores: string[]; finalTopics: string[] } = { reasonIds: [], exhaustedReasonIds: [], primaryReferences: [], topicCores: [], finalTopics: [] };
    const marketReferenceFirstMetrics: Array<Record<string, number>> = [];
    const collectExhaustedReasons = (warnings: string[] | undefined) => {
      if (!warnings) return;
      for (const warning of warnings) {
        const match = warning.match(/^DELF_EXHAUSTED_REASON:(.+)$/);
        if (match && !marketBatchContext.exhaustedReasonIds.includes(match[1])) marketBatchContext.exhaustedReasonIds.push(match[1]);
        if (warning.startsWith('MARKET_REFERENCE_FIRST_METRICS:')) {
          try { marketReferenceFirstMetrics.push(JSON.parse(warning.slice('MARKET_REFERENCE_FIRST_METRICS:'.length)) as Record<string, number>); }
          catch { /* malformed diagnostics must not block production */ }
        }
      }
    };
    collectExhaustedReasons(planned.artifact.warnings);
    const usedDemandArchetypes: DemandArchetype[] = [];
    const acceptedDemandByText = new Map<string, DemandArchetype | undefined>();
    let duplicateCandidates = 0;
    const acceptTopic = (topic: TopicOption) => {
      const card = slots[plannedJobs.length];
      if (!card) return;
      // All products share this final batch-level safety net. Scope cards do
      // the main allocation; this only catches true collisions inside the
      // same user-need archetype. It must not delete a planned "听力跟丢"
      // merely because its full work order shares generic study words with a
      // planned "模考后不知道下一步" note.
      // DELF Reference-first already dedupes fixed Topic Cores and finalTopic.
      // The route keeps the same 0.56 safety threshold, but compares the public
      // finalTopic rather than generic promise boilerplate shared by every slot.
      const dedupText = topic.seedSignals?.includes('market_reference_first')
        ? topic.topic.trim()
        : `${topic.topic} ${topic.promise} ${topic.contentAngle}`.trim();
      const archetype = topic.topicAssignment?.demandCard?.demandArchetype as DemandArchetype | undefined;
      const collision = findSimilarTopic(dedupText, acceptedTopicTexts, 0.56);
      const matchedArchetype = collision ? acceptedDemandByText.get(collision.similar) : undefined;
      if (collision && (!archetype || !matchedArchetype || matchedArchetype === archetype)) {
        duplicateCandidates += 1;
        if (topic.topicSource === 'market') {
          marketBatchContext.topicCores.push(topic.topicCore || topic.topic);
          marketBatchContext.finalTopics.push(topic.topic);
          if (topic.clickReasonId) marketBatchContext.reasonIds.push(topic.clickReasonId);
          if (topic.primaryReferenceTitle) marketBatchContext.primaryReferences.push(topic.primaryReferenceTitle);
        }
        (planMeta.unselected_candidates ??= []).push({
          card_id: card.id,
          topic: topic.topic,
          reason: '与本批已保留选题高度重复，未作为另一篇独立笔记创建。',
        });
        return false;
      }
      acceptedTopicTexts.push(dedupText);
      if (topic.topicSource === 'market') {
        if (topic.clickReasonId) marketBatchContext.reasonIds.push(topic.clickReasonId);
        if (topic.primaryReferenceTitle) marketBatchContext.primaryReferences.push(topic.primaryReferenceTitle);
        if (topic.topicCore) marketBatchContext.topicCores.push(topic.topicCore);
        marketBatchContext.finalTopics.push(topic.topic);
      }
      acceptedDemandByText.set(dedupText, archetype);
      if (archetype) usedDemandArchetypes.push(archetype);
      plannedJobs.push({
        id: formatJobId(seq), seq: seq++, product_id: body.product_id,
        reference_card_id: card.id,
        topic: topicOptionToMigrated({ ...topic, templateId: card.renderer_id }),
        status: 'pending', attempts: 0, pipeline_version: 'v2', current_stage: 'topic_selected',
      });
      return true;
    };
    planned.artifact.data.forEach(acceptTopic);
    let refillRound = 0;
    const isMarketReferenceFirst = contentMode === 'standard' && body.topic_scope !== 'medium';
    const minimumAcceptable = Math.min(slots.length, 8);
    const maxRefillRounds = isMarketReferenceFirst ? 1 : 2;
    while (plannedJobs.length < slots.length && refillRound < maxRefillRounds
      && (!isMarketReferenceFirst || plannedJobs.length < minimumAcceptable)) {
      refillRound += 1;
      const missing = slots.length - plannedJobs.length;
      const refill = await planTopicsV2({
        productId: body.product_id, card: slots[0], facts, direction, contentMode,
        limit: missing, topicMode: 'batch', topicSourceMode: body.topic_scope === 'medium' ? 'long_tail' : 'market', topicScope: body.topic_scope || 'large', recentAngles,
        avoidTopics: [...avoidTopics, ...acceptedTopicTexts], recentDomainIds,
        recentDemandArchetypes: [...recentDemandArchetypes, ...usedDemandArchetypes],
        excludeDemandArchetypes: [...new Set(usedDemandArchetypes)],
        knowledgeModeOverride: knowledgeMode, examScope,
        usedMarketReferenceTitles: [...(body.market_reference_titles_used || []), ...marketBatchContext.primaryReferences, ...planned.artifact.data
          .filter(topic => topic.topicSource === 'market').map(topic => topic.marketReference?.sourceTitle).filter((title): title is string => Boolean(title))],
        ...(isMarketReferenceFirst ? { usedMarketReasonIds: marketBatchContext.reasonIds, exhaustedMarketReasonIds: marketBatchContext.exhaustedReasonIds, usedMarketTopicCores: marketBatchContext.topicCores, usedMarketFinalTopics: marketBatchContext.finalTopics, topicGenerationAttemptId, debugRound: refillRound + 1 } : {}),
      });
      v2Usage = mergeAiUsage(v2Usage, refill.usage);
      collectExhaustedReasons(refill.artifact.warnings);
      refill.artifact.data.forEach(acceptTopic);
    }
    planMeta.candidate_pool = { requested_jobs: slots.length, generated_candidates: planned.artifact.data.length,
      production_jobs: plannedJobs.length, reserve_candidates: Math.max(0, planned.artifact.data.length - plannedJobs.length) };
    if (isMarketReferenceFirst && marketReferenceFirstMetrics.length) {
      const sum = (key: string) => marketReferenceFirstMetrics.reduce((total, item) => total + (item[key] || 0), 0);
      planMeta.market_reference_first = {
        requested: slots.length,
        reference_slots_prepared: sum('referenceSlotsPrepared'),
        recent_core_window_size: 40,
        pre_generation_recent_core_skipped: sum('preGenerationRecentCoreSkipped'),
        ai_topic_call_count: sum('aiTopicCallCount'),
        raw_generated: sum('rawGenerated'),
        final_retained: plannedJobs.length,
        refill_call_count: refillRound,
        unique_reference_count: new Set(plannedJobs.map(job => job.topic.referenceId).filter(value => value !== undefined)).size,
        unique_click_reason_count: new Set(plannedJobs.map(job => job.topic.clickReasonId).filter(Boolean)).size,
        unique_topic_core_count: new Set(plannedJobs.map(job => job.topic.topicCore).filter(Boolean)).size,
        recent_core_duplicate_dropped: sum('recentCoreDuplicateDropped'),
        full_history_title_duplicate_dropped: sum('fullHistoryTitleDuplicateDropped'),
        reused_old_reference_count: sum('reusedOldReferenceCount'),
        reused_old_topic_family_count: sum('reusedOldTopicFamilyCount'),
      };
    }
    if (planned.artifact.data.length < slots.length) {
      (planMeta.warnings ??= []).push(`本次请求 ${slots.length} 篇，AI 返回 ${planned.artifact.data.length} 个候选；已保留全部可用选题，可直接继续后续流程。`);
    }
    if (duplicateCandidates) {
      (planMeta.warnings ??= []).push(`本批发现 ${duplicateCandidates} 个高度重复候选，已进行最多2轮补齐；当前保留 ${plannedJobs.length}/${slots.length} 篇。`);
    }
    if (plannedJobs.length < slots.length) {
      const missing = slots.length - plannedJobs.length;
      planMeta.unfilled_demand_archetypes = Array.from({length: missing}, (_, index) => `UNMET_DEMAND_SLOT_${index + 1}`);
      (planMeta.warnings ??= []).push(`PARTIAL_TOPIC_BATCH：两轮补齐后仍只有 ${plannedJobs.length}/${slots.length} 篇；未填补的是用户需求槽位，不会伪装成“缺某科目”。`);
    }
  }

  for (const cardId of cardIds) {
    const card = getCompetitorCreativeCard(cardId);
    if (!card || !card.supported) continue;
    // 商品展示截图只能在“介绍知识库”模式使用，防止绕过前台直接提交错模式卡片。
    if (contentMode === 'standard' && card.renderer_id === 'showcase_screenshot') continue;
    if (contentMode === 'product_showcase' && card.renderer_id !== 'showcase_screenshot') continue;
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (!spec) continue;
    if (useCoordinatePlan) continue;
    let topics;
    if (isV2PipelineEnabled()) {
      const planned = await planTopicsV2({
        productId: body.product_id, card, facts, direction, contentMode,
        limit: topicsPerCard, recentAngles: batchUsedTopicTexts,
        topicMode: 'batch', topicSourceMode: body.topic_scope === 'medium' ? 'long_tail' : 'market', knowledgeModeOverride: knowledgeMode,
        examScope,
      });
      v2Usage = mergeAiUsage(v2Usage, planned.usage);
      topics = planned.topics;
    } else {
      const recentSeedIds = await getRecentSeedIds(body.product_id, card.id);
      const seededTopics = planSeededTopics({
        productId: body.product_id,
        card,
        facts,
        direction,
        limit: topicsPerCard,
        recentSeedIds,
        batchUsedSeedIds,
        batchUsedTopicTexts,
      });
      topics = seededTopics.length ? await refineSeededTopics({
        productId: body.product_id,
        card,
        seededTopics,
        direction,
      }) : await generateTopics({
          productId: body.product_id,
          card,
          productContext,
          direction,
        });
    }

    let acceptedForCard = 0;
    // 介绍模式中，每张截图本身就是一个独立商品展示任务，不能被跨卡去重吞掉。
    const cardUsedTopicTexts: string[] = [];
    for (const topic of topics) {
      if (acceptedForCard >= topicsPerCard) break;
      const topicText = `${topic.topic} ${topic.content_promise || ''}`.trim();
      // 每张已选封面都是独立 job；只在同一张封面内去重。
      // 之前普通模式使用 batchUsedTopicTexts，导致不同封面拿到相似选题时被跨卡吞掉。
      const duplicateScope = cardUsedTopicTexts;
      // 新坐标路径已在上游完成全批分配，末尾旧相似度检查不得再静默吞掉名额。
      if (!useCoordinatePlan && findSimilarTopic(topicText, duplicateScope, 0.56)) continue;
      const topicKey = `${cardId}:${topic.seed_id || topic.id || topic.topic}`;
      if (seenTopics.has(topicKey)) continue;
      seenTopics.add(topicKey);
      if (topic.seed_id) batchUsedSeedIds.push(topic.seed_id);
      const fullTopic = (topic as typeof topic & { v2_topic?: ConsensusTopicOption }).v2_topic;
      batchUsedTopicTexts.push(fullTopic
        ? topicDedupText(fullTopic)
        : `${topic.topic} ${topic.content_promise || ''} ${(topic.dynamic_fact_terms || []).join(' ')}`);
      cardUsedTopicTexts.push(topicText);
      const job: BatchJob = {
        id: formatJobId(seq),
        seq,
        product_id: body.product_id,
        reference_card_id: cardId,
        topic,
        status: 'pending',
        attempts: 0,
      pipeline_version: 'v2',
        current_stage: isV2PipelineEnabled() ? 'topic_selected' : undefined,
      };
      plannedJobs.push(job);
      acceptedForCard += 1;
      seq += 1;
    }
  }

  const hasPartialPlan = Boolean(planMeta.candidate_pool && planMeta.candidate_pool.production_jobs < planMeta.candidate_pool.requested_jobs);
  planMeta.status = planningFailures.length || hasPartialPlan ? 'PARTIAL_SUCCESS' : 'PASS';
  if (planningFailures.length) planMeta.failed_jobs = planningFailures;
  if (planMeta.candidate_pool || planMeta.unselected_candidates || planMeta.warnings || planMeta.needs_manual_review || planMeta.failed_jobs?.length) {
    batch.plan_meta = planMeta;
  }
  if (!plannedJobs.length) throw new Error('没有任何可落盘的有效Job');
  // 只有所有名额均已在内存准备完成后，才把 batch 与 jobs 一次性提交到正式目录。
  batch.planning_usage = isV2PipelineEnabled() ? v2Usage : getRecentAiUsage();
  await createPlannedBatchAtomic(batch, plannedJobs);
  const finalBatch = await loadBatch(batchId);
  return NextResponse.json({
    batch: finalBatch,
    status: planMeta.status,
    successfulJobs: plannedJobs.map(job => job.id),
    failedJobs: planningFailures,
    usage: isV2PipelineEnabled() ? v2Usage : getRecentAiUsage(),
    pipeline_version: isV2PipelineEnabled() ? 'v2' : 'v1',
  });
}

async function handleRun(body: RunBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  const batch = await loadBatch(body.batch_id).catch(() => null);
  if (!batch) return error(`找不到 batch: ${body.batch_id}`, 404);
  const outcome = await startBatchRunner(body.batch_id, body.job_id);
  if (!outcome.started) return NextResponse.json({ started: false, reason: outcome.reason }, { status: 409 });
  return NextResponse.json({ started: true });
}

async function handleRetryFailed(body: RetryFailedBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  const jobs = await loadAllJobs(body.batch_id);
  const requestedJobIds = new Set(Array.isArray(body.job_ids) ? body.job_ids.filter(Boolean) : []);
  const failedJobs = jobs.filter(job => job.status === 'failed' && (!requestedJobIds.size || requestedJobIds.has(job.id)));
  if (!failedJobs.length) return error('没有 failed 状态的 job 可重试', 400);
  let resetCount = 0;
  for (const job of failedJobs) {
    // A locked Inner is valid retry context, not a reason to skip the Job.
    // Post-Inner failures (Fact Brief/Title/Cover) must be retryable without
    // regenerating or reopening the already locked Inner.
    const commercialStage = commercialStageFromFailure(job.failure?.stage);
    const previousRepairs = job.commercial?.repairAttempts?.[commercialStage] || 0;
    if (previousRepairs >= 2) {
      await saveJob(body.batch_id, {
        ...job,
        commercial: job.commercial ? {
          ...job.commercial,
          status: 'FAILED',
          failedStage: commercialStage,
          failedReason: job.failure?.message || '当前节点局部重试后仍失败',
          updatedAt: new Date().toISOString(),
        } : job.commercial,
      });
      continue;
    }
    // 挂在生图阶段的 job 保留 failure 标记：runOneJob 靠 `failure.stage==='image' && draft`
    // 识别"compose 已成功、只差图"的状态，跳过 LLM 重跑直接恢复生图任务。
    const keepFailure = job.failure?.stage === 'image' && job.draft ? job.failure : undefined;
    await saveJob(body.batch_id, {
      ...job,
      status: 'pending',
      attempts: 0,
      failure: keepFailure,
      current_stage: job.failure?.stage === 'audit' && job.artifacts?.content ? 'audited' : job.current_stage,
      artifacts: job.artifacts,
      started_at: undefined,
      finished_at: undefined,
      commercial: job.commercial ? {
        ...job.commercial,
        status: 'NEEDS_REPAIR',
        currentStage: commercialStage,
        repairAttempts: { ...job.commercial.repairAttempts, [commercialStage]: previousRepairs + 1 },
        updatedAt: new Date().toISOString(),
      } : job.commercial,
    });
    resetCount += 1;
  }
  if (!resetCount) return error('失败Job的当前节点局部重试次数已用完', 409);
  const outcome = await startBatchRunner(body.batch_id);
  if (!outcome.started) return NextResponse.json({ started: false, reason: outcome.reason }, { status: 409 });
  return NextResponse.json({ started: true, reset_count: resetCount });
}

async function handleSwitchTitleArtifact(body: { batch_id: string; job_id: string }) {
  if (!body.batch_id || !body.job_id) return error('batch_id 和 job_id 不能为空', 400);
  if (getActiveRunner()) return error('生产正在运行，请结束后再继续', 409);
  const job = await loadJob(body.batch_id, body.job_id);
  assertNotDropped(job);
  if (!job.product_note_plan || !job.artifacts?.content) return error('该 Job 没有可复用的商品笔记策划和正文缓存', 409);
  const draft = job.draft ? {
    ...job.draft,
    selected_title: '',
    title_candidates: [],
    title_bundles: [],
    titlePackage: undefined,
    recommended_bundle_id: undefined,
    selected_bundle_id: undefined,
    cover_title_candidates: [],
    cover: { kind: 'dense_directory' as const, title: '', subtitle: '', sections: [] },
  } : undefined;
  await saveJob(body.batch_id, {
    ...job,
    status: 'pending', current_stage: 'audited', failure: undefined,
    started_at: undefined, finished_at: undefined,
    artifacts: { selectedTopic: job.artifacts.selectedTopic, content: job.artifacts.content },
    draft,
  });
  const outcome = await startBatchRunner(body.batch_id, body.job_id);
  if (!outcome.started) return NextResponse.json({ started: false, reason: outcome.reason }, { status: 409 });
  return NextResponse.json({ started: true, switched: true, job_id: body.job_id, reused: ['product_note_plan', 'content'] });
}

async function handleResumeSelectedJobs(body: ResumeSelectedJobsBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  const jobIds = Array.from(new Set(Array.isArray(body.job_ids) ? body.job_ids.filter(Boolean) : []));
  if (!jobIds.length) return error('请至少勾选一篇', 400);
  if (getActiveRunner()) return error('生产正在运行，请结束后再继续', 409);
  const selectedJobs: BatchJob[] = [];
  for (const jobId of jobIds) {
    const job = await loadJob(body.batch_id, jobId).catch(() => null);
    if (!job) return error(`找不到 Job: ${jobId}`, 404);
    assertNotDropped(job);
    const content = job.artifacts?.content?.data;
    if (!job.draft || !content?.manualInnerReview) return error(`${jobId} 正文尚未就绪`, 409);
    assertReviewedInner(content);
    if (job.draft.downstreamStale && stableHash(teachingPages(job.draft.inner_pages)) !== content.manualInnerReview.innerHash) {
      return error(`${jobId} 工作副本已变更`, 409);
    }
    const titlePackage = resolveCanonicalTitlePackage(job.draft);
    if (titlePackage.bundles.length && !titlePackage.humanSelectedTextTitleId) return error(`${jobId} 请先选择一个文字标题`, 409);
    if (titlePackage.mode === 'text_only' && !titlePackage.humanSelectedCoverTitleId) return error(`${jobId} 请再选择一个封面标题`, 409);
    if (content.coverCopy && content.coverCandidates?.some(candidate => !candidate.rejectionReason)
      && !content.coverSelection?.confirmedTemplateId) return error(`${jobId} 请先选择并确认一个封面`, 409);
    selectedJobs.push(job);
  }
  for (const job of selectedJobs) {
    await saveJob(body.batch_id, { ...job, status: 'pending', failure: undefined, started_at: undefined, finished_at: undefined });
  }
  const outcome = await startBatchRunner(body.batch_id, jobIds);
  if (!outcome.started) return NextResponse.json({ started: false, reason: outcome.reason }, { status: 409 });
  return NextResponse.json({ started: true, job_ids: jobIds });
}

function commercialStageFromFailure(stage: BatchJobFailureStage | undefined) {
  if (stage === 'image') return 'render' as const;
  if (stage === 'title') return 'titles' as const;
  if (stage === 'audit') return 'frenchQA' as const;
  if (stage === 'compile') return 'pages' as const;
  if (stage === 'topic' || stage === 'topics') return 'motherTopic' as const;
  return 'content' as const;
}

async function handleDeleteJob(body: DeleteJobBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  if (!body.job_id) return error('job_id 不能为空', 400);
  await deleteJob(body.batch_id, body.job_id);
  return NextResponse.json({ deleted: true });
}

async function handleUpdateDraftState(body: UpdateDraftStateBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  if (!body.job_id) return error('job_id 不能为空', 400);
  const job = await loadJob(body.batch_id, body.job_id).catch(() => null);
  if (!job?.draft) return error(`找不到可编辑 Draft: ${body.job_id}`, 404);
  if (job.status === 'dropped' || job.draft.manualInnerReview?.status === 'dropped') return error('这篇已放弃，只能查看', 409);
  if (getActiveRunner() || job.status === 'running') return error('生产正在运行，不能同时修改正文或封面', 409);
  if (body.drop_inner_review) {
    if (!body.expected_inner_hash || body.expected_inner_hash !== stableHash(teachingPages(job.draft.inner_pages))) return error('正文已更新，请重新加载后操作', 409);
    await saveJob(body.batch_id, dropInnerJob(job));
    return NextResponse.json({ job: await loadJob(body.batch_id, body.job_id) });
  }
  if(body.readable_page_plan){
    if(job.draft.downstreamStale || body.inner_pages || body.confirm_inner_review) return error('请先完成正文审核',409);
    projectReadablePages(job.draft.inner_pages,body.readable_page_plan);
    if(job.draft.readablePagePlan && stableHash(job.draft.readablePagePlan)===stableHash(body.readable_page_plan))return NextResponse.json({job});
    const updated={...job,draft:{...job.draft,readablePagePlan:body.readable_page_plan},commercial:undefined};
    await saveJob(body.batch_id,updated);
    return NextResponse.json({job:await loadJob(body.batch_id,body.job_id)});
  }
  if (body.render_overflow_page_no !== undefined) {
    if(job.draft.readablePagePlan)return error('当前已使用无损展示分页，请重新导出',409);
    if (body.inner_pages || body.confirm_inner_review || job.draft.downstreamStale) return error('不能对未完成正文做导出分页', 409);
    const paginated = repaginateDraftForOverflow(job.draft, body.render_overflow_page_no);
    if (!paginated) return error('无法无损分页', 409);
    await saveJob(body.batch_id, { ...job, draft: paginated });
    return NextResponse.json({ job: await loadJob(body.batch_id, body.job_id) });
  }
  if (body.inner_pages || body.confirm_inner_review) {
    if (!body.expected_inner_hash || body.expected_inner_hash !== stableHash(teachingPages(job.draft.inner_pages))) return error('正文已被其他操作更新，请重新加载后编辑', 409);
    if (body.confirm_inner_review && body.inner_pages) return error('请先保存草稿，再单独确认审校', 400);
    if (body.confirm_inner_review) {
      const updated = lockInnerWorkingCopy(job);
      await saveJob(body.batch_id, updated);
      return NextResponse.json({ job: await loadJob(body.batch_id, body.job_id) });
    }
    const saved = saveInnerWorkingCopy(job, body.inner_pages!, { invalidateDownstream: body.rerun_downstream !== false });
    if (body.rerun_downstream) {
      const locked = lockInnerWorkingCopy(saved);
      locked.status = 'pending';
      locked.failure = undefined;
      await saveJob(body.batch_id, locked);
      return NextResponse.json(await startBatchRunner(body.batch_id, body.job_id));
    }
    await saveJob(body.batch_id, saved);
    return NextResponse.json({ job: await loadJob(body.batch_id, body.job_id) });
  }

  if (body.selected_cover_template_id) {
    if (body.selected_bundle_id || body.selected_cover_title_id || body.cover_edit_state) return error('请分别保存标题和封面模板选择',400);
    let artifact = job.artifacts?.content;
    const title = job.artifacts?.titles?.data;
    let content = artifact?.data;
    if (!content || !artifact || !title?.humanSelectedTextTitleId || !title.humanSelectedCoverTitleId || !content.coverCopy) return error('请先选择文字标题和封面标题，再生成封面推荐',409);
    assertReviewedInner(content);
    const hash = content.manualInnerReview!.innerHash;
    const previousSelectedCoverTemplateId = content.selectedCoverTemplateId;
    if (job.draft.downstreamStale || content.coverCopy.sourceInnerHash !== hash
      || content.coverCopy.titleId !== title.humanSelectedTextTitleId
      || content.coverCopy.coverTitleId !== title.humanSelectedCoverTitleId
      || content.coverCopy.requestId !== body.expected_cover_request_id) return error('封面推荐已过期，请刷新后选择',409);
    let candidate = content.coverCandidates?.find(c=>c.templateId===body.selected_cover_template_id && !c.rejectionReason);
    let card = getCompetitorCreativeCard(body.selected_cover_template_id);
    let manualCoverUsage = emptyAiUsage();
    if (!candidate) {
      if (!card?.supported || getCoverTemplateSpec(card.renderer_id)?.productionFit === 'disabled') return error('这个封面模板当前不可用于生产',400);
      const selectedTextTitle = title.humanSelectableTextTitles?.find(item => item.id === title.humanSelectedTextTitleId);
      const selectedCoverTitle = title.humanSelectableTextTitles?.find(item => item.id === title.humanSelectedCoverTitleId);
      const selectedTopic = job.artifacts?.selectedTopic?.data;
      if (!selectedTextTitle || !selectedCoverTitle || !selectedTopic) return error('缺少已选文字标题、封面标题或选题数据，无法适配封面',409);
      resetRecentAiUsage();
      let generated;
      try {
        generated = await generateFinalCoverBlocks(artifact, {
          topic:selectedTopic, capability:getCapabilityFallback(card), evidence:[],
          selectedTextTitle:{id:selectedTextTitle.id,textTitle:selectedTextTitle.textTitle},
          selectedCoverTitle:{id:selectedCoverTitle.id,textTitle:selectedCoverTitle.textTitle},
          requestedCoverTemplateId:body.selected_cover_template_id,
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        if (reason.includes('visual_density') || reason.includes('total_capacity')
          || reason.includes('item_capacity') || reason.includes('section_capacity')) {
          return error('这个模板需要更多可展示内容，当前笔记无法把画面填满，请换一个信息容量更合适的模板',400);
        }
        throw cause;
      }
      manualCoverUsage = getRecentAiUsage();
      candidate = generated.data.coverCandidates?.find(c=>c.templateId===body.selected_cover_template_id && !c.rejectionReason);
      if (!candidate) return error('这个模板无法承载当前内容，请换一个模板',400);
      const previousCandidates = content.coverCandidates || [];
      generated.data.coverCandidates = [candidate, ...previousCandidates.filter(item => item.templateId !== candidate!.templateId)];
      artifact = generated;
      content = generated.data;
    }
    card = candidate && getCompetitorCreativeCard(candidate.templateId);
    if (!candidate || !card?.supported || !candidate.coverTitle?.trim()) return error('封面模板适配失败',400);
    if (!content.coverCopy) return error('封面文案状态缺失，请刷新后重试',409);
    const activeCoverCopy = content.coverCopy;
    const sections = compileCover(getCapabilityFallback(card),candidate.coverBlocks).sections;
    const changed = previousSelectedCoverTemplateId !== candidate.templateId;
    const updated = structuredClone(job);
    updated.artifacts!.content = structuredClone(artifact);
    const next = updated.artifacts!.content!.data;
    next.selectedCoverTemplateId = candidate.templateId;
    next.coverBlocks = structuredClone(candidate.coverBlocks);
    next.coverCopy = {...activeCoverCopy,coverTitle:candidate.coverTitle,coverSubtitle:candidate.coverSubtitle || ''};
    next.coverSelection = {titleId:title.humanSelectedTextTitleId,coverTitleId:title.humanSelectedCoverTitleId,
      sourceInnerHash:hash,confirmedTemplateId:candidate.templateId};
    updated.draft = {...updated.draft!,selectedCoverTemplateId:candidate.templateId,
      coverCopy:next.coverCopy,coverSelection:{...next.coverSelection,downstreamComplete:!changed && job.status==='success'},
      cover:{kind:'dense_directory',title:candidate.coverTitle,subtitle:candidate.coverSubtitle || '',sections},
      ...(changed?{coverEditStates:undefined,cover_edit_meta:undefined}:{}),
    };
    updated.reference_card_id = candidate.templateId;
    updated.usage = mergeAiUsage(job.usage || emptyAiUsage(), manualCoverUsage);
    if (changed) {
      next.finalTeachingQa=undefined;
      updated.artifacts!.compiledDraft=undefined;
      // Old image files remain on disk, but cannot be exported as the newly chosen cover.
      updated.cover_image_url=undefined;updated.image_task_id=undefined;updated.commercial=undefined;
      updated.status='awaiting_review';updated.current_stage='title_ready';updated.failure=undefined;
    } else if (updated.artifacts?.compiledDraft) {
      updated.artifacts.compiledDraft.data = updated.draft;
    }
    await saveJob(body.batch_id,updated);
    return NextResponse.json({job:updated});
  }

  let draft = job.draft;
  if (body.cover_route === 'MARKET_REFERENCE_COVER' || body.cover_route === 'DAZIBAO') {
    draft = {
      ...draft,
      coverRoute: body.cover_route,
      coverReferenceSource: body.cover_route === 'MARKET_REFERENCE_COVER' ? 'MARKET_REFERENCE' : 'DAZIBAO_POOL',
      ...(body.selected_market_reference_id !== undefined ? { selectedMarketReferenceId: body.selected_market_reference_id } : {}),
      ...(body.selected_dazibao_reference_id ? { selectedDazibaoReferenceId: body.selected_dazibao_reference_id } : {}),
    };
  }
  const titlePackage = resolveCanonicalTitlePackage(draft);
  if (body.selected_bundle_id) {
    const index = titlePackage.bundles.findIndex(bundle => bundle.id === body.selected_bundle_id);
    if (index < 0) return error(`标题 Bundle 不存在: ${body.selected_bundle_id}`, 400);
    draft = applyDraftTitleSelection(draft, getDraftTitleSelection(draft, index), true);
  }
  if (body.selected_cover_title_id) {
    if (!titlePackage.humanSelectableTextTitles?.some(candidate => candidate.id === body.selected_cover_title_id)) {
      return error(`封面标题候选不存在: ${body.selected_cover_title_id}`, 400);
    }
    draft = withCanonicalTitlePackage(draft, { humanSelectedCoverTitleId: body.selected_cover_title_id });
  }

  if (body.cover_edit_state) {
    const { bundleId, blocks } = body.cover_edit_state;
    if (!titlePackage.bundles.some(bundle => bundle.id === bundleId)) {
      return error(`封面编辑状态对应的 Bundle 不存在: ${bundleId}`, 400);
    }
    if (!Array.isArray(blocks)) return error('cover_edit_state.blocks 必须是数组', 400);
    const editableBlocks = blocks as Array<{ id?: string; text?: string }>;
    const selectedPackage = resolveCanonicalTitlePackage(draft);
    const currentBundle = selectedPackage.bundles.find(bundle => bundle.id === bundleId);
    const title = editableBlocks.find(block => block.id === 'coverTitle')?.text ?? currentBundle?.coverTitle ?? draft.cover.title;
    const subtitle = editableBlocks.find(block => block.id === 'coverSubtitle')?.text ?? currentBundle?.coverSubtitle ?? draft.cover.subtitle;
    const kicker = editableBlocks.find(block => block.id === 'coverKicker')?.text ?? currentBundle?.coverKicker;
    // The generated four-slot package is immutable source data. User edits live
    // only in coverEditStates so switching/restoring a Bundle can always recover
    // its generated defaults.
    draft = withCanonicalTitlePackage({
      ...draft,
      cover: selectedPackage.selectedBundleId === bundleId ? { ...draft.cover, title, subtitle } : draft.cover,
      coverEditStates: {
        ...(draft.coverEditStates || {}),
        [bundleId]: { edited: true, blocks, updatedAt: new Date().toISOString() },
      },
      cover_edit_meta: {
        edited: true,
        bundleId,
        editedBlocks: blocks
          .map(block => block && typeof block === 'object' && 'id' in block ? String((block as { id: unknown }).id) : '')
          .filter(Boolean),
        blocks,
      },
    });
  }

  const updatedJob = { ...job, draft };
  if ((body.selected_bundle_id || body.selected_cover_title_id) && job.artifacts?.titles && (job.artifacts.titles.data.mode==='text_only' || job.artifacts.titles.data.humanSelectedCandidateId !== undefined)) {
    const artifact = job.artifacts.titles;
    const selected = body.selected_bundle_id ? artifact.data.candidates.find(c => c.id === body.selected_bundle_id) : undefined;
    const selectedCover = body.selected_cover_title_id ? artifact.data.candidates.find(c => c.id === body.selected_cover_title_id) : undefined;
    if (body.selected_bundle_id && !selected) return error('文字标题候选已更新，请刷新后选择', 409);
    if (body.selected_cover_title_id && !selectedCover) return error('封面标题候选已更新，请刷新后选择', 409);
    updatedJob.artifacts = { ...job.artifacts, titles: { ...artifact, data: { ...artifact.data,
      ...(selected ? {humanSelectedCandidateId:selected.id!,selectedBundleId:selected.id,selected} : {}),
      ...(artifact.data.mode==='text_only'?{
        ...(selected ? {humanSelectedTextTitleId:selected.id!,humanSelectedCandidateId:null} : {}),
        ...(selectedCover ? {humanSelectedCoverTitleId:selectedCover.id!} : {}),
      }:{}),
    } } };
    const titleChoiceChanged = Boolean(selected && artifact.data.humanSelectedTextTitleId !== selected.id);
    const coverTitleChoiceChanged = Boolean(selectedCover && artifact.data.humanSelectedCoverTitleId !== selectedCover.id);
    if (artifact.data.mode==='text_only' && (titleChoiceChanged || coverTitleChoiceChanged)) {
      if (draft.downstreamStale || artifact.data.sourceInnerHash !== job.artifacts.content?.data.manualInnerReview?.innerHash) return error('标题来源已过期，请重新生成',409);
      updatedJob.artifacts = structuredClone(updatedJob.artifacts);
      if (updatedJob.artifacts.content) {
        Object.assign(updatedJob.artifacts.content.data,{coverSelection:undefined,coverCopy:undefined,coverSourceInnerHash:undefined,
          selectedCoverTemplateId:undefined,coverBlocks:[],coverCandidates:undefined,finalTeachingQa:undefined});
      }
      updatedJob.artifacts.compiledDraft=undefined;
      updatedJob.draft = {...updatedJob.draft!,coverSelection:undefined,coverCopy:undefined,
        cover:{kind:'dense_directory',title:'',subtitle:'',sections:[]},coverEditStates:undefined,cover_edit_meta:undefined};
      updatedJob.cover_image_url=undefined;updatedJob.image_task_id=undefined;updatedJob.commercial=undefined;
      updatedJob.status='awaiting_review';updatedJob.current_stage='title_ready';updatedJob.failure=undefined;
    }
  }
  await saveJob(body.batch_id, updatedJob);
  return NextResponse.json({ job: updatedJob });
}

async function handleUpdateCommercialDelivery(body: UpdateCommercialDeliveryBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  if (!body.job_id) return error('job_id 不能为空', 400);
  if (!Array.isArray(body.delivered_page_ids)) return error('delivered_page_ids 必须是数组', 400);
  const job = await updateCommercialPageDelivery(body.batch_id, body.job_id, body.delivered_page_ids, body.artifact_paths || {});
  return NextResponse.json({ job, status: job.commercial?.status });
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
