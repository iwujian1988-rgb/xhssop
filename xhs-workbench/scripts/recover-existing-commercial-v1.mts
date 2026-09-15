import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJob, saveJob, type BatchJob } from '../src/lib/batch-store';

const targets = [
  { batchId: 'single_1788332748568', jobId: 'job_001', role: 'mother_replacement' },
  { batchId: 'batch_1788415775434', jobId: 'job_001', role: 'french_sentence_repair' },
  { batchId: 'batch_1788415832139', jobId: 'job_001', role: 'sparse_page_repair' },
  { batchId: 'batch_1788415850647', jobId: 'job_001', role: 'export_recovery' },
  { batchId: 'batch_1788415873985', jobId: 'job_001', role: 'resume_failed_stage' },
  { batchId: 'batch_1788415892286', jobId: 'job_001', role: 'export_recovery' },
] as const;

function patchStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll("S'employer à / Mettre son grain de sel", "S'employer à / contribuer à")
      .replaceAll('前者正式努力，后者贡献意见', '前者表示致力于，后者表示为……作贡献')
      .replaceAll('diront 语气较弱', 'disent 指代仍然过于笼统')
      .replaceAll('三个不同主题的 sentence', '三个不同主题的句子');
  }
  if (Array.isArray(value)) return value.map(patchStrings);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, patchStrings(item)]));
  }
  return value;
}

function removeSparsePages(job: BatchJob): BatchJob {
  if (!job.draft) return job;
  const contentPages = job.draft.inner_pages.filter(page => page.page_type !== 'product_bridge');
  const kept = contentPages.filter(page => {
    const bullets = (page.bullets || []).map(item => item.trim()).filter(Boolean);
    return bullets.length >= 3 || Boolean(page.renderPayload && Object.keys(page.renderPayload).length);
  });
  const product = job.draft.inner_pages.findLast(page => page.page_type === 'product_bridge');
  const innerPages = [...kept, ...(product ? [product] : [])].map((page, index) => ({ ...page, page_no: index + 1 }));
  return { ...job, draft: { ...job.draft, inner_pages: innerPages } };
}

const results = [];
for (const target of targets) {
  let job = await loadJob(target.batchId, target.jobId);
  if (target.role === 'french_sentence_repair') job = patchStrings(job) as BatchJob;
  if (target.role === 'sparse_page_repair') job = removeSparsePages(job);
  await saveJob(target.batchId, job);
  const persisted = await loadJob(target.batchId, target.jobId);
  results.push({
    ...target,
    topic: persisted.topic.topic,
    runtimeStatus: persisted.status,
    commercialStatus: persisted.commercial?.status,
    currentStage: persisted.commercial?.currentStage,
    pageManifest: persisted.commercial?.pageManifest,
    failure: persisted.failure,
  });
}

const outputDir = path.resolve(process.cwd(), 'data/commercial-controller');
await fs.mkdir(outputDir, { recursive: true });
const output = path.join(outputDir, 'controller-existing-6.json');
await fs.writeFile(output, JSON.stringify({ controllerVersion: '1', requestedJobs: 6, jobs: results, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
console.log(output);
console.log(JSON.stringify(results.map(item => ({ batchId: item.batchId, role: item.role, status: item.commercialStatus, pages: item.pageManifest?.expectedPageIds.length, failure: item.failure?.message })), null, 2));
