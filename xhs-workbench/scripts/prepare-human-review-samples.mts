import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareJobForHumanReview } from '../src/lib/manual-inner-review';
import type { Batch, BatchJob } from '../src/lib/batch-store';

const isolated = process.argv.includes('--isolated');
const titlePending = process.argv.includes('--title-pending');
const root = process.cwd();
const output = isolated ? await fs.mkdtemp(path.join(root, '.tmp-review-ui-')) : root;
if (isolated) process.env.INNER_REVIEW_TEST_DATA_DIR = path.join(output, 'data/batches');
const { createPlannedBatchAtomic } = await import('../src/lib/batch-store');
const sources = titlePending ? [
  ['Checklist（待人工审核）', 'batch_1788619087639', 'job_006'],
  ['考前方法（待人工审核）', 'batch_1788665344053', 'job_001'],
] : [
  ['正式信', 'batch_1788674634433', 'job_002'],
  ['论据素材', 'batch_1788674367253', 'job_003'],
  ['Before / After', 'batch_1788619087639', 'job_002'],
];
const id = isolated ? 'review_ui_smoke' : titlePending ? 'batch_title_v1_pending_review' : `batch_human_review_${Date.now()}`;
if (!isolated && titlePending) {
  try { await fs.access(path.join(root, 'data/batches', id)); throw new Error('REVIEW_BATCH_ALREADY_EXISTS:do not overwrite user edits'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
const provenance = [];
const jobs: BatchJob[] = [];
for (const [scene, sourceBatch, sourceJob] of sources) {
  const source = path.join(root, 'data/batches', sourceBatch, 'jobs', `${sourceJob}.json`);
  const bytes = await fs.readFile(source, 'utf8');
  const original = JSON.parse(bytes) as BatchJob;
  const copy = structuredClone(original);
  copy.id = `job_00${jobs.length + 1}`;
  copy.seq = jobs.length + 1;
  // Review the existing real Inner, never a generated or supposedly human-approved replacement.
  delete copy.artifacts!.content!.data.manualInnerReview;
  copy.draft = undefined;
  const job = prepareJobForHumanReview(copy);
  jobs.push(job);
  provenance.push({ scene, source, jobId: job.id, topic: job.topic.topic,
    pageTitles: job.draft!.inner_pages.map(p => p.page_title), status: 'needs_review',
    originalUnchanged: bytes === await fs.readFile(source, 'utf8') });
}
await createPlannedBatchAtomic({ id, product_id: jobs[0].product_id, direction: isolated ? '隔离浏览器测试（非人审成品）' : titlePending ? 'Title V1 后两篇：Checklist / 考前方法待本人审核；不要继续生成后半程' : '三篇真实 Inner：等待用户本人审核', status: 'done', created_at: new Date().toISOString(), pipeline_version: 'v2', jobs: [] } as Batch, jobs);
await fs.writeFile(path.join(output, isolated ? 'fixture.json' : `data/batches/${id}/review-sources.json`), JSON.stringify({ id, isolated, output, aiCalls: 0, provenance }, null, 2));
console.log(JSON.stringify({ id, output, provenance }, null, 2));
