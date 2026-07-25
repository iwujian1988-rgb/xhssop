import { type AiUsageSummary } from '@/lib/ai-client';
import { composeWithRetry } from '@/lib/compose-with-retry';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { compactProductContext, retrieveProductFacts } from '@/lib/product-fact-retrieval';
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
  const batch = await loadBatch(batchId);
  await updateBatchStatus(batchId, 'running');
  const factsCache = new Map<ProductId, ProductFacts>();

  for (const summary of batch.jobs) {
    const job = await loadJob(batchId, summary.id);
    if (job.status !== 'pending') continue;
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
      continue;
    }

    let facts = factsCache.get(job.product_id);
    if (!facts) {
      facts = await loadProductFacts(job.product_id);
      factsCache.set(job.product_id, facts);
    }
    const evidence = retrieveProductFacts(facts, job.topic);

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
      continue;
    }

    // Image-to-image templates need server-side image generation. The actual
    // generation step is added in a later commit; for now the runner records
    // the draft and leaves cover_image_url undefined. Image generation hooks
    // in here once commit 8 lands generateCoverImageWithRetry.
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (spec?.renderMode === 'image_to_image') {
      // placeholder: image step is wired up by the cover-image module
      // (intentional no-op until that lands; the draft is still a success).
    }

    await saveJob(batchId, {
      ...job,
      status: 'success',
      attempts: outcome.attempts,
      draft: outcome.draft,
      usage: outcome.usage,
      finished_at: new Date().toISOString(),
    });
  }

  await updateBatchStatus(batchId, 'done');
}

function emptyUsage(): AiUsageSummary {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
}

export type { Batch, BatchJob };
