import { type AiUsageSummary } from '@/lib/ai-client';
import { composeWithRetry } from '@/lib/compose-with-retry';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { generateCoverImageWithRetry } from '@/lib/cover-image';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence } from '@/lib/product-fact-retrieval';
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
import { recordSeedUsage } from '@/lib/seed-usage-store';
import { recordTitleUsage } from '@/lib/title-usage-store';

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

  let facts = factsCache.get(job.product_id);
  if (!facts) {
    facts = await loadProductFacts(job.product_id);
    factsCache.set(job.product_id, facts);
  }
  const evidence = await resolveProductEvidence(job.product_id, facts, job.topic);

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

  // Image-to-image templates: server-side image generation. Failure here
  // turns the job into a corpse even though compose succeeded - the cover
  // image is part of the deliverable for these templates.
  const spec = getCoverTemplateSpec(card.renderer_id);
  let coverImageUrl: string | undefined;
  if (spec?.renderMode === 'image_to_image') {
    const imageResult = await generateCoverImageWithRetry(card, outcome.draft.cover);
    if (!imageResult.ok) {
      await saveJob(batchId, {
        ...job,
        status: 'failed',
        attempts: outcome.attempts,
        draft: outcome.draft,
        failure: {
          stage: 'image' as BatchJobFailureStage,
          message: imageResult.error,
          attempts: 1,
          usage: outcome.usage,
        },
        usage: outcome.usage,
        finished_at: new Date().toISOString(),
      });
      return;
    }
    coverImageUrl = imageResult.url;
  }

  await saveJob(batchId, {
    ...job,
    status: 'success',
    attempts: outcome.attempts,
    draft: outcome.draft,
    cover_image_url: coverImageUrl,
    usage: outcome.usage,
    finished_at: new Date().toISOString(),
  });
  await recordSeedUsage({ productId: job.product_id, cardId: card.id, draft: outcome.draft })
    .catch(cause => console.error('record seed usage failed:', cause));
  // 跨 batch 标题去重库：成功后记录本 job 的 selected title + 全部候选 + cover title/subtitle。
  // 失败不阻塞主流程——下一个 job 仍能成功，只是少了一条去重参考。
  const titleCandidates = outcome.draft.title_candidates || [];
  await recordTitleUsage({
    productId: job.product_id,
    seedId: job.topic.seed_id || '',
    cardId: card.id,
    title: outcome.draft.selected_title || '',
    candidates: titleCandidates.map(item => item.title).filter(Boolean),
    coverTitle: outcome.draft.cover.title || '',
    coverSubtitle: outcome.draft.cover.subtitle || '',
  }).catch(cause => console.error('record title usage failed:', cause));
}

function emptyUsage(): AiUsageSummary {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
}

export type { Batch, BatchJob };
