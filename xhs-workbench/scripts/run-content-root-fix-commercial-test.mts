import fs from 'node:fs/promises';
import path from 'node:path';

import { createPlannedBatchAtomic, formatJobId, saveJob, updateBatchStatus, type Batch, type BatchJob } from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { pickProductShowcasePlan } from '../src/lib/product-showcase-library';
import { resolveProductEvidence } from '../src/lib/product-fact-retrieval';
import { emptyAiUsage, type AiUsageSummary } from '../src/lib/ai-client';
import { composeV2 } from '../src/lib/v2/pipeline';
import type { MigratedTopic } from '../src/types/reference-workflow';
import type { TopicOption } from '../src/lib/v2/contracts';

const REQUEST_FILES = ['note_1_request.json', 'note_2_request.json', 'note_3_request.json'];
const fixtureRoot = path.resolve('data', 'full-commercial-content-test', 'full_commercial_content_test_1788504233326');
const requestedJobNumbers = new Set(process.argv.slice(2).map(value => Number(value)).filter(Number.isFinite));
const selectedRequestFiles = REQUEST_FILES
  .map((file, index) => ({ file, index }))
  .filter(({ index }) => !requestedJobNumbers.size || requestedJobNumbers.has(index + 1));
const requests = await Promise.all(selectedRequestFiles.map(({ file }) => fs.readFile(path.join(fixtureRoot, file), 'utf8').then(JSON.parse)));
const batchId = `batch_content_root_fix_${Date.now()}`;
const createdAt = new Date().toISOString();

const jobs: BatchJob[] = requests.map((request, index) => ({
  id: formatJobId(selectedRequestFiles[index].index + 1),
  seq: selectedRequestFiles[index].index + 1,
  product_id: request.product_id,
  reference_card_id: request.reference_card_id,
  topic: request.topic as MigratedTopic & { v2_topic: TopicOption },
  status: 'pending',
  attempts: 0,
  pipeline_version: 'v2',
  current_stage: 'topic_selected',
}));

const batch: Batch = {
  id: batchId,
  product_id: 'delf_b2_writing',
  direction: 'CONTENT ROOT FIX：同3主题真实商用回归',
  content_mode: 'standard',
  knowledge_mode: 'mixed',
  created_at: createdAt,
  status: 'planned',
  pipeline_version: 'v2',
  plan_meta: {
    status: 'PASS',
    candidate_pool: { requested_jobs: 3, generated_candidates: 3, production_jobs: 3, reserve_candidates: 0 },
  },
  jobs: [],
};

await createPlannedBatchAtomic(batch, jobs);
await updateBatchStatus(batchId, 'running');
const facts = await loadProductFacts('delf_b2_writing');
const summary: Array<Record<string, unknown>> = [];

for (const job of jobs) {
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!card) throw new Error(`找不到参考卡：${job.reference_card_id}`);
  const selectedTopic = (job.topic as MigratedTopic & { v2_topic?: TopicOption }).v2_topic;
  if (!selectedTopic) throw new Error(`${job.id} 缺少v2_topic`);
  const evidence = await resolveProductEvidence(job.product_id, facts, job.topic, 12);
  const startedAt = new Date().toISOString();
  await saveJob(batchId, { ...job, status: 'running', attempts: 1, started_at: startedAt });
  process.stderr.write(`[content-root-fix] START ${job.id} ${selectedTopic.topic}\n`);
  try {
    const result = await composeV2({
      productId: job.product_id,
      card,
      topic: job.topic,
      evidence,
      contentMode: 'standard',
      endingShowcasePlan: pickProductShowcasePlan(job.product_id, facts, `content-root-fix|${job.id}|${selectedTopic.id}`),
      onCheckpoint: async (stage, artifacts) => {
        const stageName = stage === 'execution' ? 'topic_selected' : stage === 'content' ? 'audited' : stage === 'titles' ? 'title_ready' : 'compiled';
        await saveJob(batchId, { ...job, status: 'running', attempts: 1, started_at: startedAt, current_stage: stageName, artifacts });
      },
    });
    await saveJob(batchId, {
      ...job,
      status: 'success',
      attempts: 1,
      pipeline_version: 'v2',
      current_stage: result.currentStage,
      artifacts: result.artifacts,
      draft: result.draft,
      usage: result.usage,
      warnings: result.warnings,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    summary.push({
      jobId: job.id,
      status: 'READY',
      topic: selectedTopic.topic,
      pagePlan: result.artifacts.content?.data.pagePlan,
      contentPages: result.artifacts.content?.data.innerPages.map(page => ({ pageId: page.pageId, title: page.page_title, bullets: page.bullets.length })),
      caption: result.draft.caption,
      bridge: result.artifacts.content?.data.bridgePlan,
      titles: result.draft.title_bundles,
      usage: result.usage,
    });
    process.stderr.write(`[content-root-fix] PASS ${job.id} pages=${result.artifacts.content?.data.innerPages.length || 0}\n`);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const context = cause && typeof cause === 'object' ? cause as { v2Stage?: string; usage?: AiUsageSummary; partialArtifacts?: BatchJob['artifacts'] } : {};
    await saveJob(batchId, {
      ...job,
      status: 'failed',
      attempts: 1,
      current_stage: context.v2Stage === 'title' ? 'audited' : 'content_ready',
      artifacts: context.partialArtifacts,
      usage: context.usage || emptyAiUsage(),
      failure: { stage: (context.v2Stage || 'content') as NonNullable<BatchJob['failure']>['stage'], message: error.message, attempts: 1, usage: context.usage || emptyAiUsage() },
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    summary.push({ jobId: job.id, status: 'FAILED', topic: selectedTopic.topic, failedStage: context.v2Stage || 'content', failedReason: error.message });
    process.stderr.write(`[content-root-fix] FAIL ${job.id} ${error.message}\n`);
  }
}

await updateBatchStatus(batchId, 'done');
const reportPath = path.resolve('data', 'batches', batchId, 'content-root-fix-result.json');
await fs.writeFile(reportPath, JSON.stringify({ batchId, createdAt, summary }, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ batchId, previewUrl: `http://localhost:4100/batch?batch_id=${batchId}`, reportPath, summary }, null, 2));
