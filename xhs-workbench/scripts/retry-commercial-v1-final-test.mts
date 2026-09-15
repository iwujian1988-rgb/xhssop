import fs from 'node:fs/promises';
import path from 'node:path';

import { loadBatch, loadJob, saveJob, type BatchJob } from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { pickProductShowcasePlan } from '../src/lib/product-showcase-library';
import { composeV2 } from '../src/lib/v2/pipeline';
import { emptyAiUsage, type AiUsageSummary } from '../src/lib/ai-client';

const batchId = process.argv[2];
if (!batchId) throw new Error('用法：retry-commercial-v1-final-test.mts <batchId>');
const sourceByJobId: Record<string, { batchId: string; jobId: string }> = {
  job_001: { batchId: 'batch_title_v3_validation_1788444655678', jobId: 'job_001' },
  job_002: { batchId: 'single_1788332748568', jobId: 'job_001' },
  job_003: { batchId: 'batch_1788145696701', jobId: 'job_012' },
};
const batch = await loadBatch(batchId);
const facts = await loadProductFacts(batch.product_id);
const outputs: Array<Record<string, unknown>> = [];

for (const item of batch.jobs) {
  const job = await loadJob(batchId, item.id);
  if (job.status === 'success') {
    outputs.push({ jobId: job.id, status: 'READY', skipped: 'already_passed' });
    continue;
  }
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!card) throw new Error(`找不到参考卡：${job.reference_card_id}`);
  const sourceRef = sourceByJobId[job.id];
  const sourceJob = sourceRef ? await loadJob(sourceRef.batchId, sourceRef.jobId) : undefined;
  const evidence = sourceJob?.draft?.evidence || job.draft?.evidence || [];
  const attempt = (job.attempts || 1) + 1;
  process.stderr.write(`[commercial-v1-retry] START ${job.id} attempt=${attempt} resume=${Object.keys(job.artifacts || {}).join(',')}\n`);
  try {
    const result = await composeV2({
      productId: job.product_id,
      card,
      topic: job.topic,
      evidence,
      contentMode: 'standard',
      endingShowcasePlan: pickProductShowcasePlan(job.product_id, facts, `commercial-v1-retry|${job.id}`),
      resumeArtifacts: job.artifacts,
      onCheckpoint: async (stage, artifacts) => {
        const latest = await loadJob(batchId, job.id);
        await saveJob(batchId, {
          ...latest,
          status: 'running',
          attempts: attempt,
          current_stage: stage === 'content' ? 'audited' : stage === 'titles' ? 'title_ready' : stage === 'pages' ? 'compiled' : latest.current_stage,
          artifacts: { ...(latest.artifacts || {}), ...artifacts },
        });
      },
    });
    await saveJob(batchId, {
      ...job,
      status: 'success',
      attempts: attempt,
      current_stage: result.currentStage,
      artifacts: result.artifacts,
      draft: result.draft,
      usage: result.usage,
      warnings: result.warnings,
      failure: undefined,
      finished_at: new Date().toISOString(),
    });
    outputs.push({
      jobId: job.id,
      status: 'READY',
      attempt,
      selectedTitle: result.draft.selected_title,
      titleBundles: result.draft.title_bundles?.length || 0,
      contentPages: result.draft.inner_pages.filter(page => page.page_type !== 'product_bridge').length,
      totalInnerPages: result.draft.inner_pages.length,
      usage: result.usage,
      warnings: result.warnings,
    });
    process.stderr.write(`[commercial-v1-retry] PASS ${job.id}\n`);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const context = cause && typeof cause === 'object' ? cause as {
      v2Stage?: string;
      usage?: AiUsageSummary;
      partialArtifacts?: BatchJob['artifacts'];
    } : {};
    const latest = await loadJob(batchId, job.id);
    await saveJob(batchId, {
      ...latest,
      status: 'failed',
      attempts: attempt,
      artifacts: context.partialArtifacts || latest.artifacts,
      usage: context.usage || emptyAiUsage(),
      failure: {
        stage: (context.v2Stage || 'content') as NonNullable<BatchJob['failure']>['stage'],
        message: error.message,
        attempts: attempt,
        usage: context.usage || emptyAiUsage(),
      },
      finished_at: new Date().toISOString(),
    });
    outputs.push({ jobId: job.id, status: 'FAILED', attempt, stage: context.v2Stage || 'content', reason: error.message, usage: context.usage || emptyAiUsage() });
    process.stderr.write(`[commercial-v1-retry] FAIL ${job.id} ${error.message}\n`);
  }
}

const reportPath = path.resolve('data', 'batches', batchId, `commercial-v1-retry-${Date.now()}.json`);
await fs.writeFile(reportPath, JSON.stringify({ batchId, outputs }, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ batchId, previewUrl: `http://localhost:4100/batch?batch_id=${batchId}`, reportPath, outputs }, null, 2));
