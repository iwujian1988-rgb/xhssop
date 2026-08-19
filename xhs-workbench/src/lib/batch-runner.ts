import { type AiUsageSummary } from '@/lib/ai-client';
import { composeWithRetry } from '@/lib/compose-with-retry';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { submitCoverImageTask, waitForCoverImageTask, type CoverImageWaitResult } from '@/lib/cover-image';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence, resolveProductEvidenceByIds } from '@/lib/product-fact-retrieval';
import {
  type Batch,
  type BatchJob,
  type BatchJobFailureStage,
  loadBatch,
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

let activeRunner: string | null = null;

export function getActiveRunner() {
  return activeRunner;
}

export async function startBatchRunner(batchId: string): Promise<{ started: boolean; reason?: string }> {
  if (activeRunner) return { started: false, reason: `batch ${activeRunner} 正在运行` };
  activeRunner = batchId;
  runBatch(batchId)
    .catch(error => {
      console.error(`batch ${batchId} runner crashed:`, error);
    })
    .finally(() => {
      activeRunner = null;
    });
  return { started: true };
}

async function runBatch(batchId: string): Promise<void> {
  let batch = await loadBatch(batchId);
  await updateBatchStatus(batchId, 'running');
  const factsCache = new Map<ProductId, ProductFacts>();

  // A process may stop after a job was persisted as running but before its
  // result was saved. On restart that job must re-enter the queue instead of
  // remaining an orphan forever.
  for (const summary of batch.jobs.filter(job => job.status === 'running')) {
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
  const pending = batch.jobs.filter(summary => summary.status === 'pending');
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const chunk = pending.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(summary => runOneJob(batchId, summary.id, factsCache)));
  }

  await updateBatchStatus(batchId, 'done');
}

async function runOneJob(
  batchId: string,
  jobId: string,
  factsCache: Map<ProductId, ProductFacts>,
): Promise<void> {
  const job = await loadJob(batchId, jobId);
  if (job.status !== 'pending') return;
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

  if (useV2) {
    try {
      const result = await composeV2({
        productId: job.product_id,
        card,
        topic: job.topic,
        evidence,
        contentMode: batch.content_mode,
        showcasePlan: batch.content_mode === 'product_showcase'
          ? pickProductShowcasePlan(job.product_id, facts, `${job.id}|${job.topic.id}`)
          : undefined,
        resumeArtifacts: job.current_stage === 'audited' && job.artifacts?.content
          ? job.artifacts
          : undefined,
      });
      await finishJobWithCoverImage(
        batchId,
        {
          ...job,
          pipeline_version: 'v2',
          current_stage: result.currentStage,
          artifacts: result.artifacts,
        },
        card,
        result.draft,
        result.usage,
        1,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'V2内容流水线失败';
      const stageContext = cause && typeof cause === 'object' ? cause as {
        v2Stage?: 'topic' | 'content' | 'audit' | 'title' | 'compile';
        usage?: AiUsageSummary;
        partialArtifacts?: BatchJob['artifacts'];
      } : {};
      const stage = stageContext.v2Stage || inferV2FailureStage(message);
      const failureUsage = stageContext.usage || emptyUsage();
      await saveJob(batchId, {
        ...job,
        pipeline_version: 'v2',
        current_stage: stage === 'topic' ? 'topic_selected' : stage === 'content' ? 'content_ready' : stage === 'title' ? 'audited' : 'audited',
        artifacts: stageContext.partialArtifacts || job.artifacts,
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
// 2) 轮询只认终态（completed/failed/超5分钟），网络抖动重试不判死；
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
  const spec = getCoverTemplateSpec(card.renderer_id);
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
      const handle = await submitCoverImageTask(card, draft.cover, job.product_id);
      taskId = handle.taskId;
    } catch (cause) {
      await failWithTask(undefined, cause instanceof Error ? cause.message : '生图任务提交失败');
      return;
    }
    // task_id 先落盘再轮询：这一刻进程崩了，下次重试仍能凭 id 恢复这张已扣款的图。
    await saveJob(batchId, { ...job, status: 'running', draft, image_task_id: taskId });
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
}

function emptyUsage(): AiUsageSummary {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
}

export type { Batch, BatchJob };
