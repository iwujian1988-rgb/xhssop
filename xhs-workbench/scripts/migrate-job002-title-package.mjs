import fs from 'node:fs/promises';
import path from 'node:path';

const batchId = 'batch_1788145696701';
const jobId = 'job_002';
const root = process.cwd();
const jobPath = path.join(root, 'data', 'batches', batchId, 'jobs', `${jobId}.json`);
const smokePath = path.join(root, '.tmp-title-bundle-real-smoke-job002-final.json');

function stableHash(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
const smokeFile = JSON.parse(await fs.readFile(smokePath, 'utf8'));
const smoke = smokeFile.rows?.find(row => row.jobId === jobId);
if (!smoke) throw new Error(`Smoke 中找不到 ${jobId}`);

const currentContentHash = stableHash(job.artifacts?.content?.data);
const currentBriefHash = job.artifacts?.selectedTopic?.data?.productionBrief?.briefHash
  || job.artifacts?.content?.data?.productionBriefHash;
const storedContentHash = job.artifacts?.titles?.data?.contentSnapshotHash;
const storedBriefHash = job.artifacts?.titles?.data?.productionBriefHash;

const checks = {
  jobId: job.id === smoke.jobId,
  referenceCardId: job.reference_card_id === smoke.referenceCardId,
  topic: job.artifacts?.selectedTopic?.data?.topic === smoke.motherTopic,
  contentSnapshotHash: currentContentHash === storedContentHash,
  productionBriefHash: currentBriefHash === storedBriefHash,
};
if (Object.values(checks).some(value => !value)) {
  throw new Error(`LEGACY_DRAFT_TITLE_PACKAGE ${JSON.stringify(checks)}`);
}
if (!Array.isArray(smoke.bundles) || smoke.bundles.length !== 4) throw new Error('最新 smoke 不是4组 Bundle');
const slots = new Set(smoke.bundles.map(bundle => bundle.slotId));
if (slots.size !== 4 || !['primary', 'secondary', 'emotional', 'alternate'].every(slot => slots.has(slot))) {
  throw new Error('最新 smoke 槽位不完整');
}

const oldSelectedId = job.draft?.selected_bundle_id;
const validIds = new Set(smoke.bundles.map(bundle => bundle.id));
const selectedBundleId = validIds.has(oldSelectedId)
  ? oldSelectedId
  : validIds.has(smoke.selectedBundleId)
    ? smoke.selectedBundleId
    : smoke.bundles[0].id;
const selected = smoke.bundles.find(bundle => bundle.id === selectedBundleId);
const titlePackage = {
  schemaVersion: job.artifacts?.titles?.schema_version || '2.0.0',
  titlePackageVersion: 'title-bundle-smoke-final-20260903',
  contentSnapshotHash: currentContentHash,
  productionBriefHash: currentBriefHash,
  titleBundles: smoke.bundles,
  recommendedBundleId: smoke.recommendedBundleId,
  selectedBundleId,
  source: 'current_title_bundles',
  migratedAt: new Date().toISOString(),
};
const draft = {
  ...job.draft,
  titlePackage,
  title_bundles: smoke.bundles,
  recommended_bundle_id: smoke.recommendedBundleId,
  selected_bundle_id: selectedBundleId,
  selected_title: selected.textTitle,
  cover: {
    ...job.draft.cover,
    title: selected.coverTitle,
    subtitle: selected.coverSubtitle || '',
  },
};
const next = {
  ...job,
  draft,
  artifacts: {
    ...job.artifacts,
    titles: {
      ...job.artifacts.titles,
      data: {
        ...job.artifacts.titles.data,
        contentSnapshotHash: currentContentHash,
        productionBriefHash: currentBriefHash,
        candidates: smoke.bundles,
        selected,
        titleBundles: smoke.bundles,
        recommendedBundleId: smoke.recommendedBundleId,
        selectedBundleId,
        titleStageTrace: smoke.trace,
      },
    },
    compiledDraft: job.artifacts.compiledDraft ? {
      ...job.artifacts.compiledDraft,
      data: draft,
    } : job.artifacts.compiledDraft,
  },
};

const tempPath = `${jobPath}.${process.pid}.tmp`;
await fs.writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8');
await fs.rename(tempPath, jobPath);
console.log(JSON.stringify({ batchId, jobId, checks, contentSnapshotHash: currentContentHash, productionBriefHash: currentBriefHash, bundles: smoke.bundles.length, slots: [...slots], selectedBundleId, recommendedBundleId: smoke.recommendedBundleId }, null, 2));
