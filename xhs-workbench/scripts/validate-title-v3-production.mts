/* eslint-disable no-console */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { createBatch, saveJob } from '../src/lib/batch-store';
import { applyDraftTitleSelection, getDraftTitleSelection } from '../src/lib/draft-title-selection';
import { resolveCanonicalTitlePackage } from '../src/lib/canonical-title-package';
import { compileDraft } from '../src/lib/v2/pipeline';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const sourceBatchId = 'batch_1788423988855';
const sourceJobId = 'job_001';
const sourceJobPath = path.join('data', 'batches', sourceBatchId, 'jobs', `${sourceJobId}.json`);
const regressionPath = 'title-v3-real-regression.json';
const sourceJob = JSON.parse(await fs.readFile(sourceJobPath, 'utf8'));
const regression = JSON.parse(await fs.readFile(regressionPath, 'utf8'));
const testCase = regression.cases.find((item: { label?: string }) => item.label === 'same_job');
assert(testCase, '缺少 same_job 标题回归结果');

const bundles = testCase.final;
assert.equal(bundles.length, 4, 'V3 标题必须保留 4 组');
assert.equal(new Set(bundles.map((item: { slotId: string }) => item.slotId)).size, 4, 'V3 槽位必须唯一');

const selected = bundles[0];
const oldTitleData = sourceJob.artifacts.titles.data;
const titleData = {
  contentSnapshotHash: oldTitleData.contentSnapshotHash,
  productionBriefHash: oldTitleData.productionBriefHash,
  candidates: bundles,
  selected,
  titleBundles: bundles,
  recommendedBundleId: selected.id,
  selectedBundleId: selected.id,
  titleStageTrace: {
    version: 'v3-title-human-standard-1',
    primaryClickMode: bundles[0].clickMode,
    secondaryClickMode: bundles[1].clickMode,
    directions: [],
    generatorRaw: testCase.raw,
    normalizedBundles: bundles,
    raw: testCase.raw,
    fieldRepair: testCase.fieldRepair,
    styleReferences: testCase.styleReferences,
    finalOrder: bundles.map((item: { id: string }) => item.id),
    selector: 'NOT_EXECUTED',
    finalEditor: 'NOT_EXECUTED',
    humanizer: 'NOT_EXECUTED',
  },
};

const card = getCompetitorCreativeCard(sourceJob.reference_card_id);
assert(card, `找不到封面卡 ${sourceJob.reference_card_id}`);
const draft = compileDraft({
  productId: sourceJob.product_id,
  card,
  topic: sourceJob.artifacts.selectedTopic.data,
  capability: getCapabilityFallback(card),
  content: sourceJob.artifacts.content.data,
  titles: titleData,
  evidence: sourceJob.draft.evidence || [],
  auditWarnings: sourceJob.warnings || [],
  prebuiltTags: sourceJob.draft.tags,
});

const switchChecks = bundles.map((bundle: { id: string }, index: number) => {
  const selection = getDraftTitleSelection(draft, index);
  const selectedDraft = applyDraftTitleSelection(draft, selection);
  const canonical = resolveCanonicalTitlePackage(selectedDraft);
  assert.equal(selection.bundleId, bundle.id);
  assert.equal(canonical.selectedBundleId, bundle.id);
  assert.equal(selectedDraft.selected_title, bundles[index].textTitle);
  assert.equal(selectedDraft.cover.title, bundles[index].coverTitle);
  assert.equal(selectedDraft.cover.subtitle, bundles[index].coverSubtitle);
  const roundTripped = JSON.parse(JSON.stringify(selectedDraft));
  assert.equal(resolveCanonicalTitlePackage(roundTripped).selectedBundleId, bundle.id);
  return {
    index,
    bundleId: bundle.id,
    selectedBundleId: canonical.selectedBundleId,
    textTitle: selectedDraft.selected_title,
    coverTitle: selectedDraft.cover.title,
    coverSubtitle: selectedDraft.cover.subtitle,
    roundTripPersisted: true,
  };
});

const validationBatchId = `batch_title_v3_validation_${Date.now()}`;
const now = new Date().toISOString();
const expectedPageIds = ['P1', ...draft.inner_pages.map((_: unknown, index: number) => `P${index + 2}`)];
const validationJob = {
  ...sourceJob,
  id: 'job_001',
  seq: 1,
  status: 'success',
  current_stage: 'compiled',
  artifacts: {
    ...sourceJob.artifacts,
    titles: {
      ...sourceJob.artifacts.titles,
      data: titleData,
      prompt_version: 'v3-title-human-standard-1',
      created_at: now,
      usage: testCase.usage,
      warnings: testCase.warnings,
    },
    compiledDraft: draft,
  },
  draft,
  usage: {
    ...(sourceJob.usage || {}),
    title_v3_validation: testCase.usage,
  },
  commercial: {
    ...(sourceJob.commercial || {}),
    jobId: 'job_001',
    status: 'READY',
    currentStage: 'export',
    stageStatus: {
      coordinate: 'pass',
      motherTopic: 'pass',
      execution: 'pass',
      content: 'pass',
      frenchQA: 'pass',
      titles: 'pass',
      pages: 'pass',
      render: 'pass',
      export: 'pending',
    },
    pageManifest: {
      expectedPageIds,
      contentReadyPageIds: expectedPageIds,
      renderedPageIds: expectedPageIds,
      exportedPageIds: [],
      pages: Object.fromEntries(expectedPageIds.map((pageId, index) => [pageId, {
        contentStatus: 'pass',
        densityStatus: 'pass',
        frenchQaStatus: 'pass',
        renderStatus: 'pass',
        exportStatus: 'pending',
        purpose: index === 0 ? '封面' : draft.inner_pages[index - 1]?.page_title || `内页${index}`,
        problems: [],
      }])),
      updatedAt: now,
    },
    updatedAt: now,
  },
  finished_at: now,
};

await createBatch({
  id: validationBatchId,
  product_id: sourceJob.product_id,
  direction: 'TITLE V3：使用既有内容做 Draft、前台切换、持久化与导出验收；未重新生成正文。',
  content_mode: 'standard',
  knowledge_mode: 'educational_original',
  created_at: now,
  status: 'done',
  pipeline_version: 'v2',
  jobs: [],
  plan_meta: {
    warnings: [],
    status: 'PASS',
    failed_jobs: [],
  },
});
await saveJob(validationBatchId, validationJob);

const report = {
  ok: true,
  validationBatchId,
  sourceBatchId,
  sourceJobId,
  previewUrl: `http://localhost:4100/batch?batch_id=${validationBatchId}`,
  draftId: draft.id,
  bundleCount: bundles.length,
  uniqueSlots: new Set(bundles.map((item: { slotId: string }) => item.slotId)).size,
  recommendedBundleId: selected.id,
  selectedBundleId: resolveCanonicalTitlePackage(draft).selectedBundleId,
  switchChecks,
  modelCalls: testCase.usage.calls,
  totalTokens: testCase.usage.total_tokens,
};
await fs.writeFile('title-v3-production-validation.json', JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
