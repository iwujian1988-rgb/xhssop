import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createPlannedBatchAtomic,
  formatJobId,
  loadJob,
  saveJob,
  updateBatchStatus,
  type Batch,
  type BatchJob,
} from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { pickProductShowcasePlan } from '../src/lib/product-showcase-library';
import { composeV2 } from '../src/lib/v2/pipeline';
import { emptyAiUsage, type AiUsageSummary } from '../src/lib/ai-client';
import type { MigratedTopic } from '../src/types/reference-workflow';
import type { TopicOption } from '../src/lib/v2/contracts';

const SOURCES = [
  { batchId: 'batch_title_v3_validation_1788444655678', jobId: 'job_001', label: '观点素材型' },
  { batchId: 'single_1788332748568', jobId: 'job_001', label: '写作误区型' },
  { batchId: 'batch_1788145696701', jobId: 'job_012', label: '正式信实用型' },
] as const;

function mergeTopic(source: BatchJob): MigratedTopic & { v2_topic: TopicOption } {
  const selected = source.artifacts?.selectedTopic?.data;
  if (!selected) throw new Error(`${source.id} 缺少已锁定 selectedTopic`);
  return {
    ...source.topic,
    topic: selected.topic,
    audience: selected.audienceState,
    scene: selected.scene,
    pain: selected.painOrDesire,
    content_promise: selected.promise,
    product_bridge: selected.productBridge,
    why_this_reference_fits: selected.contentAngle,
    search_terms: [selected.seo.primary, ...selected.seo.related],
    v2_topic: selected,
  };
}

const batchId = `batch_commercial_v1_${Date.now()}`;
const createdAt = new Date().toISOString();
const sourceJobs = await Promise.all(SOURCES.map(item => loadJob(item.batchId, item.jobId)));
const plannedJobs: BatchJob[] = sourceJobs.map((source, index) => ({
  id: formatJobId(index + 1),
  seq: index + 1,
  product_id: source.product_id,
  reference_card_id: source.reference_card_id,
  topic: mergeTopic(source),
  status: 'pending',
  attempts: 0,
  pipeline_version: 'v2',
  current_stage: 'topic_selected',
}));

const batch: Batch = {
  id: batchId,
  product_id: 'delf_b2_writing',
  direction: 'COMMERCIAL V1 FINAL TEST：观点素材 / 写作误区 / 正式信',
  content_mode: 'standard',
  knowledge_mode: 'educational_original',
  created_at: createdAt,
  status: 'planned',
  pipeline_version: 'v2',
  plan_meta: {
    status: 'PASS',
    candidate_pool: { requested_jobs: 3, generated_candidates: 3, production_jobs: 3, reserve_candidates: 0 },
  },
  jobs: [],
};

await createPlannedBatchAtomic(batch, plannedJobs);
await updateBatchStatus(batchId, 'running');
const facts = await loadProductFacts('delf_b2_writing');
const summary: Array<Record<string, unknown>> = [];

for (let index = 0; index < plannedJobs.length; index += 1) {
  const planned = plannedJobs[index];
  const source = sourceJobs[index];
  const sourceMeta = SOURCES[index];
  const card = getCompetitorCreativeCard(planned.reference_card_id);
  if (!card) throw new Error(`找不到参考卡：${planned.reference_card_id}`);
  const evidence = source.draft?.evidence || [];
  const startedAt = new Date().toISOString();
  await saveJob(batchId, { ...planned, status: 'running', attempts: 1, started_at: startedAt });
  process.stderr.write(`[commercial-v1] START ${planned.id} ${sourceMeta.label} ${planned.topic.topic}\n`);

  try {
    const result = await composeV2({
      productId: planned.product_id,
      card,
      topic: planned.topic,
      evidence,
      contentMode: 'standard',
      endingShowcasePlan: pickProductShowcasePlan(
        planned.product_id,
        facts,
        `commercial-v1|${planned.id}|${planned.topic.id}`,
      ),
      onCheckpoint: async (stage, artifacts) => {
        const latest = await loadJob(batchId, planned.id);
        const currentStage = stage === 'execution' ? 'topic_selected'
          : stage === 'content' ? 'audited'
            : stage === 'titles' ? 'title_ready'
              : 'compiled';
        await saveJob(batchId, {
          ...latest,
          status: 'running',
          current_stage: currentStage,
          artifacts: { ...(latest.artifacts || {}), ...artifacts },
        });
      },
    });
    const completed: BatchJob = {
      ...planned,
      status: 'success',
      attempts: 1,
      pipeline_version: 'v2',
      current_stage: result.currentStage,
      artifacts: result.artifacts,
      draft: result.draft,
      cover_image_url: source.cover_image_url,
      usage: result.usage,
      warnings: result.warnings,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    await saveJob(batchId, completed);
    summary.push({
      jobId: planned.id,
      source: `${sourceMeta.batchId}/${sourceMeta.jobId}`,
      label: sourceMeta.label,
      status: 'READY',
      motherTopic: (planned.topic as MigratedTopic & { v2_topic?: TopicOption }).v2_topic?.batchEditorialTask?.lockedMotherTopic || planned.topic.topic,
      finalTopic: planned.topic.topic,
      selectedTitle: result.draft.selected_title,
      titleBundles: result.draft.title_bundles?.length || 0,
      contentPages: result.draft.inner_pages.filter(page => page.page_type !== 'product_bridge').length,
      totalInnerPages: result.draft.inner_pages.length,
      warnings: result.warnings,
      usage: result.usage,
    });
    process.stderr.write(`[commercial-v1] PASS ${planned.id} pages=${result.draft.inner_pages.length} bundles=${result.draft.title_bundles?.length || 0}\n`);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const context = cause && typeof cause === 'object' ? cause as {
      v2Stage?: BatchJob['failure'] extends infer _ ? string : string;
      usage?: AiUsageSummary;
      partialArtifacts?: BatchJob['artifacts'];
    } : {};
    const failed: BatchJob = {
      ...planned,
      status: 'failed',
      attempts: 1,
      pipeline_version: 'v2',
      current_stage: context.v2Stage === 'title' ? 'audited' : context.v2Stage === 'compile' ? 'title_ready' : 'content_ready',
      artifacts: context.partialArtifacts,
      usage: context.usage || emptyAiUsage(),
      failure: {
        stage: (context.v2Stage || 'content') as NonNullable<BatchJob['failure']>['stage'],
        message: error.message,
        attempts: 1,
        usage: context.usage || emptyAiUsage(),
      },
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    };
    await saveJob(batchId, failed);
    summary.push({
      jobId: planned.id,
      source: `${sourceMeta.batchId}/${sourceMeta.jobId}`,
      label: sourceMeta.label,
      status: 'FAILED',
      failedStage: context.v2Stage || 'content',
      failedReason: error.message,
      usage: context.usage || emptyAiUsage(),
    });
    process.stderr.write(`[commercial-v1] FAIL ${planned.id} ${error.message}\n`);
  }
}

await updateBatchStatus(batchId, 'done');
const reportPath = path.resolve('data', 'batches', batchId, 'commercial-v1-result.json');
await fs.writeFile(reportPath, JSON.stringify({ batchId, createdAt, summary }, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ batchId, previewUrl: `http://localhost:4100/batch?batch_id=${batchId}`, reportPath, summary }, null, 2));
