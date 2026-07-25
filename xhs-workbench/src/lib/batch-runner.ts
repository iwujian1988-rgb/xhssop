import { type AiUsageSummary } from '@/lib/ai-client';
import { composeWithRetry } from '@/lib/compose-with-retry';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { generateCoverImageWithRetry } from '@/lib/cover-image';
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
        continue;
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
  }

  await updateBatchStatus(batchId, 'done');
}

function emptyUsage(): AiUsageSummary {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
}

export type { Batch, BatchJob };
