import { mergeAiUsage, setAiRequestContext, type AiUsageSummary } from '@/lib/ai-client';
import { composeWithRetry } from '@/lib/compose-with-retry';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { submitCoverImageTask, waitForCoverImageTask, type CoverImageWaitResult } from '@/lib/cover-image';
import { ImageSubmissionUncertainError } from '@/lib/image-client';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence, resolveProductEvidenceByIds } from '@/lib/product-fact-retrieval';
import {
  type Batch,
  type BatchJob,
  type BatchJobFailureStage,
  appendBatchWarning,
  loadBatch,
  loadAllJobs,
  loadJob,
  saveJob,
  updateBatchStatus,
} from '@/lib/batch-store';
import type { ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';
import type { ReferenceDrivenDraft } from '@/types/reference-workflow';
import { recordSeedUsage } from '@/lib/seed-usage-store';
import { recordTitleUsage } from '@/lib/title-usage-store';
import { composeV2, isV2PipelineEnabled } from '@/lib/v2/pipeline';
import { pickProductShowcasePlan } from '@/lib/product-showcase-library';
import { planProductNote, productNoteToShowcasePlan } from '@/lib/product-note';
import { readProductAssetLibrary } from '@/lib/product-asset-manifest';
import { confirmTopicCoordinateUsage } from '@/lib/v2/topic-coordinate-store';
import type { TopicOption } from '@/lib/v2/contracts';

let activeRunner: string | null = null;
import { assertReviewedInner, teachingPages, assertNotDropped, prepareJobForHumanReview, lockInnerWorkingCopy, isRunnableJob } from '@/lib/manual-inner-review';
import { stableHash } from '@/lib/v2/contracts';

export function getActiveRunner() {
  return activeRunner;
}

export async function startBatchRunner(batchId: string, onlyJobIds?: string | string[]): Promise<{ started: boolean; reason?: string }> {
  if (activeRunner) return { started: false, reason: `batch ${activeRunner} 正在运行` };
  activeRunner = batchId;
  runBatch(batchId, onlyJobIds)
    .catch(error => {
      console.error(`batch ${batchId} runner crashed:`, error);
    })
    .finally(() => {
      activeRunner = null;
    });
  return { started: true };
}

async function runBatch(batchId: string, onlyJobIds?: string | string[]): Promise<void> {
  const selectedJobIds = onlyJobIds ? new Set(Array.isArray(onlyJobIds) ? onlyJobIds : [onlyJobIds]) : null;
  let batch = await loadBatch(batchId);
  await updateBatchStatus(batchId, 'running');
  const factsCache = new Map<ProductId, ProductFacts>();

  // A process may stop after a job was persisted as running but before its
  // result was saved. On restart that job must re-enter the queue instead of
  // remaining an orphan forever.
  for (const summary of batch.jobs.filter(job => job.status === 'running' && (!selectedJobIds || selectedJobIds.has(job.id)))) {
    const job = await loadJob(batchId, summary.id);
    await saveJob(batchId, {
      ...job,
      status: 'pending',
      started_at: undefined,
    });
  }
  batch = await loadBatch(batchId);

  // ai-client currently records usage/autofix in one process-global context.
  // Keep compose serial until that state becomes request-scoped; otherwise two
  // jobs reset and accumulate each other's token figures and repair events.
  const CONCURRENCY = 1;
  const pending = batch.jobs.filter(summary => summary.status === 'pending' && (!selectedJobIds || selectedJobIds.has(summary.id)));
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(summary => runOneJob(batchId, summary.id, factsCache)));
  }

  // A targeted run (for example a single-job retry or a selected post-review
  // continuation) must not close the whole batch while other jobs are still
  // waiting in the queue.  Keep the batch reopenable so the remaining pending
  // jobs can be started later.  `awaiting_review` is intentionally terminal
  // for the runner: those jobs have already produced a draft and are waiting
  // for the user's next action.
  const remainingJobs = await loadAllJobs(batchId);
  const hasUnprocessedJobs = remainingJobs.some(job => job.status === 'pending' || job.status === 'running');
  await updateBatchStatus(batchId, hasUnprocessedJobs ? 'planned' : 'done');
}

async function runOneJob(
  batchId: string,
  jobId: string,
  factsCache: Map<ProductId, ProductFacts>,
): Promise<void> {
  setAiRequestContext({ jobId });
  try {
    await runOneJobUnsafe(batchId, jobId, factsCache);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Job生命周期发生未处理异常';
    try {
      const latest = await loadJob(batchId, jobId);
      await saveJob(batchId, {
        ...latest,
        status: 'failed',
        failure: {
          stage: inferV2FailureStage(message),
          message,
          attempts: (latest.attempts || 0) + 1,
          usage: latest.usage || emptyUsage(),
        },
        stage_failures: [
          ...(latest.stage_failures || []),
          { stage: inferV2FailureStage(message), message, retryable: true },
        ],
        finished_at: new Date().toISOString(),
      });
    } catch (persistCause) {
      console.error(`job ${batchId}/${jobId} failed and could not persist failure:`, persistCause);
      await appendBatchWarning(batchId, `Job ${jobId} 隔离失败：${message}`).catch(() => undefined);
    }
  } finally {
    setAiRequestContext();
  }
}

async function runOneJobUnsafe(
  batchId: string,
  jobId: string,
  factsCache: Map<ProductId, ProductFacts>,
): Promise<void> {
  const job = await loadJob(batchId, jobId);
  if (!isRunnableJob(job)) return;
  if (job.image_submission_uncertain) {
    // A proxy timeout can mean the provider already accepted a paid task.
    // Keep this job paused until its task_id is reconciled; never resubmit it
    // merely because a batch retry was requested.
    await saveJob(batchId, {
      ...job,
      status: 'awaiting_review',
      failure: job.failure || {
        stage: 'image',
        message: '生图提交状态不确定：请先核对服务商任务列表，确认没有已入队任务后再重试。',
        attempts: job.attempts || 1,
        usage: job.usage || emptyUsage(),
      },
    });
    return;
  }
  assertNotDropped(job);
  if (job.artifacts?.content?.data.manualInnerReview || job.draft?.manualInnerReview) {
    assertReviewedInner(job.artifacts?.content?.data);
    if (!job.draft || (job.draft.downstreamStale && stableHash(teachingPages(job.draft.inner_pages)) !== job.artifacts!.content!.data.manualInnerReview?.innerHash)) throw new Error('INNER_NEEDS_HUMAN_REVIEW');
  }
  await saveJob(batchId, {
    ...job,
    status: 'running',
    started_at: new Date().toISOString(),
  });

  const card = getCompetitorCreativeCard(job.reference_card_id);
  const batch = await loadBatch(batchId);
  if (!card) {
    await saveJob(batchId, {
      ...job,
      status: 'failed',
      attempts: 0,
      failure: {
        stage: 'unknown' as BatchJobFailureStage,
        message: `批量任务找不到创作卡：${job.reference_card_id}`,
        attempts: 0,
        usage: emptyUsage(),
      },
      finished_at: new Date().toISOString(),
    });
    return;
  }

  // 上一轮 compose 已成功、只挂在生图阶段的 job：不重跑 LLM compose（贵且没必要），
  // 直接复用上轮 draft 恢复生图任务（finishJobWithCoverImage 会先查旧 task_id）。
  if (job.failure?.stage === 'image' && job.draft) {
    await finishJobWithCoverImage(batchId, { ...job, failure: undefined }, card, job.draft, job.usage || emptyUsage(), job.attempts || 1);
    return;
  }

  let facts = factsCache.get(job.product_id);
  if (!facts) {
    facts = await loadProductFacts(job.product_id);
    factsCache.set(job.product_id, facts);
  }
  // 大容量封面模板（4组×8条=30+）要求远超默认 10 条证据；证据不够时 LLM 会
  // 只写有据可依的条目，第一次生成就注定 cover_density_severely_low。提到 25 条。
  const useV2 = true;
  let evidence = await resolveProductEvidence(job.product_id, facts, job.topic, useV2 ? 8 : 25);
  if (useV2 && job.current_stage === 'audited' && job.artifacts?.content) {
    const resumed = job.artifacts.content.data;
    const requiredIds = Array.from(new Set([
      ...resumed.factualClaims.flatMap(claim => claim.sourceIds),
      ...resumed.coverBlocks.flatMap(block => block.sourceIds),
      ...resumed.innerPages.flatMap(page => page.source_ids),
    ]));
    const boundEvidence = resolveProductEvidenceByIds(job.product_id, facts, requiredIds);
    evidence = Array.from(new Map([...boundEvidence, ...evidence].map(item => [item.id, item])).values());
  }
  // AI原创模式不把商品2/3的商品资料带入正文生成；官方考试事实仍由
  // content-stage按主题选择性消费。商品1保持原有证据行为不变。
  const topicMode = (job.topic as typeof job.topic & { v2_topic?: { knowledgeMode?: string } }).v2_topic?.knowledgeMode
    || (job.topic.content_source_plan.knowledge_base === '不检索本地知识库' ? 'educational_original' : undefined);
  if (topicMode === 'educational_original'
    && job.product_id !== 'delf_b2_writing') {
    evidence = evidence.filter(item => item.category === 'official_exam_fact');
  }

  // Phase 1B: selling angle is selected at planning time; this single planner
  // call chooses only proof assets and their short display copy. Cache before
  // compose so retries never spend another planner call.
  let productNotePlan = job.product_note_plan;
  let productNoteUsage = emptyUsage();
  let productNoteShowcasePlan;
  if (batch.note_mode === 'product_note') {
    if (!productNotePlan) {
      const angleId = batch.product_note_angles?.[job.seq - 1];
      if (!angleId) throw new Error(`商品笔记Job缺少已选Selling Angle：${job.id}`);
      const planned = await planProductNote(job.product_id, angleId as import('@/lib/product-note').ProductNoteAngleId);
      productNotePlan = planned.plan;
      productNoteUsage = planned.usage;
      await saveJob(batchId, { ...job, status: 'running', product_note_plan: productNotePlan, usage: productNoteUsage });
    } else {
      productNoteUsage = productNotePlan.usage || emptyUsage();
    }
    const library = await readProductAssetLibrary();
    if (!library) throw new Error('商品素材库尚未初始化');
    productNoteShowcasePlan = productNoteToShowcasePlan(productNotePlan, library.manifest.pdfHash);
  }

  if (useV2) {
    try {
      const earlierJobs = (await loadAllJobs(batchId)).filter(item => item.seq < job.seq);
      const recentGeneratedTextTitles = earlierJobs.flatMap(item =>
        item.artifacts?.titles?.data.humanSelectableTextTitles?.map(candidate => candidate.textTitle) || []
      );
      const result = await composeV2({
        // Cover generation pauses before success for human choice, so counting
        // only successful jobs made every job in a batch think no cover had
        // been used yet. Include earlier jobs that already reached a choice.
        recentCoverTemplateIds: batch.jobs
          .filter(item => item.seq < job.seq && (item.status === 'awaiting_review' || item.status === 'success'))
          .map(item => item.reference_card_id),
        recentGeneratedTextTitles,
        productNoteContext: productNotePlan,
        productId: job.product_id,
        card,
        topic: job.topic,
        evidence,
        contentMode: batch.content_mode,
        showcasePlan: batch.note_mode === 'product_note'
          ? productNoteShowcasePlan
          : batch.content_mode === 'product_showcase'
            ? pickProductShowcasePlan(job.product_id, facts, `${job.id}|${job.topic.id}`)
          : undefined,
        endingShowcasePlan: batch.content_mode === 'standard'
          ? pickProductShowcasePlan(job.product_id, facts, `ending|${job.id}|${job.topic.id}`)
          : undefined,
        appendProductPromoPage: batch.note_mode !== 'product_note',
        resumeArtifacts: job.artifacts?.content
          ? job.artifacts
          : undefined,
        resumeDraft: job.draft,
        onCheckpoint: async (stage, artifacts) => {
          const checkpointStage = stage === 'execution' ? 'topic_selected'
            : stage === 'content' ? 'audited'
              : stage === 'titles' ? 'title_ready'
                : 'compiled';
          const latest = await loadJob(batchId, job.id);
          await saveJob(batchId, {
            ...latest,
            status: 'running',
            current_stage: checkpointStage,
            artifacts: { ...(latest.artifacts || {}), ...artifacts },
          });
        },
      });
      await finishJobWithCoverImage(
        batchId,
        {
          ...job,
          product_note_plan: productNotePlan,
          pipeline_version: 'v2',
          current_stage: result.currentStage,
          artifacts: result.artifacts,
          // §8.1-3：compose 警告（含补页警告/法语返修提醒）随 job 落盘，前台可见。
          warnings: result.warnings,
        },
        card,
        result.draft,
        mergeAiUsage(productNoteUsage, result.usage),
        1,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'V2内容流水线失败';
      const stageContext = cause && typeof cause === 'object' ? cause as {
        v2Stage?: 'topic' | 'content' | 'audit' | 'title' | 'compile';
        usage?: AiUsageSummary;
        partialArtifacts?: BatchJob['artifacts'];
        partialDraft?: ReferenceDrivenDraft;
      } : {};
      const stage = stageContext.v2Stage || inferV2FailureStage(message);
      const failureUsage = stageContext.usage || emptyUsage();
      const latest = await loadJob(batchId, job.id);
      if (message === 'INNER_AWAITING_HUMAN_REVIEW' && stageContext.partialArtifacts?.content) {
        // Production defaults the generated Inner to approved. Keep the same
        // canonical review marker so every downstream hash guard continues to
        // work; only the mandatory human click is removed.
        const prepared = prepareJobForHumanReview({ ...latest, artifacts: stageContext.partialArtifacts, usage: failureUsage });
        const approved = lockInnerWorkingCopy(prepared);
        await saveJob(batchId, { ...approved, status: 'pending', failure: undefined });
        await runOneJobUnsafe(batchId, job.id, factsCache);
        return;
      }
      if ((message === 'TEXT_TITLE_AWAITING_HUMAN_CHOICE' || message === 'COVER_AWAITING_HUMAN_CHOICE') && stageContext.partialDraft) {
        await saveJob(batchId,{...latest,status:'awaiting_review',current_stage:'title_ready',failure:undefined,
          reference_card_id:stageContext.partialDraft.selectedCoverTemplateId || latest.reference_card_id,
          artifacts:stageContext.partialArtifacts,draft:stageContext.partialDraft,usage:failureUsage});
        return;
      }
      const hasPersistedContent = Boolean(stageContext.partialArtifacts?.content || latest.artifacts?.content);
      const failureCheckpoint = stage === 'topic'
        ? 'topic_selected'
        : stage === 'content'
          ? (hasPersistedContent ? 'content_ready' : 'topic_selected')
          : stage === 'title'
            ? 'audited'
            : 'audited';
      await saveJob(batchId, {
        ...latest,
        pipeline_version: 'v2',
        current_stage: failureCheckpoint,
        artifacts: stageContext.partialArtifacts || latest.artifacts,
        status: 'failed',
        attempts: 1,
        failure: {
          stage,
          message,
          attempts: 1,
          usage: failureUsage,
        },
        stage_failures: [
          ...(job.stage_failures || []),
          { stage, message, retryable: true },
        ],
        usage: failureUsage,
        finished_at: new Date().toISOString(),
      });
    }
    return;
  }

  const outcome = await composeWithRetry({
    productId: job.product_id,
    card,
    topic: job.topic,
    evidence,
  });

  if (!outcome.ok) {
    await saveJob(batchId, {
      ...job,
      status: 'failed',
      attempts: outcome.failure.attempts,
      failure: outcome.failure,
      usage: outcome.failure.usage,
      finished_at: new Date().toISOString(),
    });
    return;
  }

  await finishJobWithCoverImage(batchId, job, card, outcome.draft, outcome.usage, outcome.attempts);
}

function inferV2FailureStage(message: string): 'topic' | 'content' | 'audit' | 'title' | 'compile' {
  if (/标题/.test(message)) return 'title';
  if (/审校|法语|事实/.test(message)) return 'audit';
  if (/编译|分组|短条目/.test(message)) return 'compile';
  if (/选题/.test(message)) return 'topic';
  return 'content';
}

// 生图阶段统一收口。关键规则：task_id 提交即扣款，所以
// 1) 提交成功后立刻把 task_id 落盘，然后再开始轮询——进程这时崩了也能恢复；
// 2) 轮询只认终态（completed/failed/超10分钟），网络抖动重试不判死；
// 3) 上一轮挂在生图阶段的 job 重试时，先查旧 task_id（旧任务可能已完成），
//    只有旧任务被供应商判死才提交新任务。
async function finishJobWithCoverImage(
  batchId: string,
  job: BatchJob,
  card: NonNullable<ReturnType<typeof getCompetitorCreativeCard>>,
  draft: ReferenceDrivenDraft,
  usage: AiUsageSummary,
  attempts: number,
): Promise<void> {
  card = getCompetitorCreativeCard(draft.brief.reference_card_id) || card;
  job = { ...job, reference_card_id: card.id };
  const spec = getCoverTemplateSpec(card.renderer_id);
  const batch = await loadBatch(batchId);
  // The selected template alone owns the rendering route.
  if (spec?.renderMode !== 'image_to_image') {
    await saveJob(batchId, {
      ...job,
      status: 'success',
      attempts,
      draft,
      usage,
      finished_at: new Date().toISOString(),
    });
    await recordUsageStores(batchId, job, card, draft);
    return;
  }

  const failWithTask = async (imageTaskId: string | undefined, message: string) => {
    await saveJob(batchId, {
      ...job,
      status: 'failed',
      attempts,
      draft,
      image_task_id: imageTaskId,
      failure: {
        stage: 'image' as BatchJobFailureStage,
        message,
        attempts: 1,
        usage,
      },
      usage,
      finished_at: new Date().toISOString(),
    });
  };

  let taskId: string | undefined = job.image_task_id;
  let requestHash: string | undefined = job.image_request_hash;
  let wait: CoverImageWaitResult | undefined = taskId
    ? await waitForCoverImageTask(taskId)
    : undefined;

  if (wait && wait.ok) {
    // 上一轮提交的任务其实完成了——直接收图，一分钱不多花。
    console.info(`[image] 恢复旧任务 ${taskId} 成功`);
  } else {
    if (wait && !wait.terminal) {
      // 旧任务状态不明（超时/查询不可达）：不重新提交，保留 task_id 下次再恢复。
      await failWithTask(taskId, wait.error);
      return;
    }
    if (wait) console.info(`[image] 旧任务 ${taskId} 已判死：${wait.error}，重新提交`);
    try {
      const handle = await submitCoverImageTask(card, draft.cover, job.product_id, job.topic.exam_scope);
      taskId = handle.taskId;
      requestHash = handle.requestHash;
    } catch (cause) {
      if (cause instanceof ImageSubmissionUncertainError) {
        // The provider may have accepted the async job even though the proxy
        // returned 524/timeout. Do not mark it as a confirmed failure and do
        // not auto-retry: without a task_id a retry could charge twice.
        await saveJob(batchId, {
          ...job,
          status: 'awaiting_review',
          attempts,
          draft,
          image_submission_uncertain: true,
          image_request_hash: cause.requestHash,
          failure: {
            stage: 'image' as BatchJobFailureStage,
            message: cause.message,
            attempts: 1,
            usage,
          },
          usage,
        });
        console.warn(`[image] 提交响应不确定，暂停自动重提：${job.id}：${cause.message}`);
        return;
      }
      await failWithTask(undefined, cause instanceof Error ? cause.message : '生图任务提交失败');
      return;
    }
    // task_id 先落盘再轮询：这一刻进程崩了，下次重试仍能凭 id 恢复这张已扣款的图。
    await saveJob(batchId, { ...job, status: 'running', draft, image_task_id: taskId, image_request_hash: requestHash });
    wait = await waitForCoverImageTask(taskId);
    if (!wait.ok) {
      await failWithTask(taskId, wait.error);
      return;
    }
  }

  await saveJob(batchId, {
    ...job,
    status: 'success',
    attempts,
    draft,
    cover_image_url: wait.ok ? wait.url : undefined,
    image_task_id: taskId,
    image_request_hash: requestHash,
    usage,
    finished_at: new Date().toISOString(),
  });
  await recordUsageStores(batchId, job, card, draft);
}

async function recordUsageStores(
  batchId: string,
  job: BatchJob,
  card: NonNullable<ReturnType<typeof getCompetitorCreativeCard>>,
  draft: ReferenceDrivenDraft,
): Promise<void> {
  await recordSeedUsage({ productId: job.product_id, cardId: card.id, draft })
    .catch(cause => console.error('record seed usage failed:', cause));
  // 跨 batch 标题去重库：成功后记录本 job 的 selected title + 全部候选 + cover title/subtitle。
  // 失败不阻塞主流程——下一个 job 仍能成功，只是少了一条去重参考。
  const titleCandidates = draft.title_candidates || [];
  if (draft.titlePackage?.mode==='text_only' && !draft.titlePackage.humanSelectableTextTitles?.some(c=>
    c.id===draft.titlePackage?.humanSelectedTextTitleId && c.textTitle===draft.selected_title)) return;
  await recordTitleUsage({
    productId: job.product_id,
    seedId: job.topic.seed_id || '',
    cardId: card.id,
    title: draft.selected_title || '',
    candidates: titleCandidates.map(item => item.title).filter(Boolean),
    coverTitle: draft.cover.title || '',
    coverSubtitle: draft.cover.subtitle || '',
    topic: job.topic.topic || draft.brief.topic || '',
    tags: draft.tags || [],
    pageTitles: (draft.inner_pages || []).map(page => page.page_title),
    narrativeSkeleton: draft.narrative_skeleton || '',
    caption: draft.caption || '',
  }).catch(cause => console.error('record title usage failed:', cause));

  const coordinate = (job.topic as typeof job.topic & { v2_topic?: TopicOption }).v2_topic?.batchEditorialTask?.coordinate;
  if (coordinate) {
    const result = await confirmTopicCoordinateUsage({
      productId: job.product_id,
      coordinate,
      batchId,
      jobId: job.id,
      publicTopic: job.topic.topic || draft.brief.topic || '',
      successAt: new Date().toISOString(),
    });
    for (const warning of result.warnings) {
      console.warn('[topic-coordinate-store]', warning);
      await appendBatchWarning(batchId, warning).catch(cause => console.error('append coordinate warning failed:', cause));
    }
  }
}

function emptyUsage(): AiUsageSummary {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
}

export type { Batch, BatchJob };
