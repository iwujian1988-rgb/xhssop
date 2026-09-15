import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('data', 'batches');
const sources = [
  ['batch_content_root_fix_1788531182467', 'job_001'],
  ['batch_content_root_fix_1788531949693', 'job_002'],
  ['batch_content_root_fix_1788531182467', 'job_003'],
];
const batchId = `batch_final_commercial_${Date.now()}`;
const target = path.join(root, batchId);
await fs.mkdir(path.join(target, 'jobs'), { recursive: true });

const jobs = [];
for (const [sourceBatchId, jobId] of sources) {
  const source = path.join(root, sourceBatchId, 'jobs', `${jobId}.json`);
  const job = JSON.parse(await fs.readFile(source, 'utf8'));
  if (job.status !== 'success' || !job.draft) throw new Error(`${sourceBatchId}/${jobId} is not READY`);
  jobs.push(job);
  await fs.writeFile(path.join(target, 'jobs', `${jobId}.json`), JSON.stringify(job, null, 2), 'utf8');
}

const batch = {
  id: batchId,
  product_id: 'delf_b2_writing',
  direction: 'FINAL COMMERCIAL OUTPUT：同3主题最终交付',
  content_mode: 'standard',
  knowledge_mode: 'mixed',
  created_at: new Date().toISOString(),
  status: 'done',
  pipeline_version: 'v2',
  plan_meta: {
    status: 'PASS',
    candidate_pool: { requested_jobs: 3, generated_candidates: 3, production_jobs: 3, reserve_candidates: 0 },
  },
  jobs: jobs.map(({ id, seq, reference_card_id, topic, status, pipeline_version, current_stage }) => ({
    id, seq, reference_card_id, topic, status, pipeline_version, current_stage,
  })),
};
await fs.writeFile(path.join(target, 'batch.json'), JSON.stringify(batch, null, 2), 'utf8');
process.stdout.write(JSON.stringify({ batchId, previewUrl: `http://localhost:4100/batch?batch_id=${batchId}`, target }, null, 2));
