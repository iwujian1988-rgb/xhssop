/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.TEST_BASE_URL || 'http://localhost:4019';
const inputPath = process.env.INPUT_JSON || 'v2-real-acceptance.json';
const outputPath = process.env.OUTPUT_JSON || 'v2-real-acceptance-composed.json';
const limit = Number(process.env.LIMIT || 10);
const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const existing = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : { jobs: [] };
const completed = new Map<string, any>((existing.jobs || []).map((job: any) => [`${job.product_id}|${job.reference_card_id}`, job]));
for (const recovered of recoverPersistedSuccesses()) {
  const key = `${recovered.product_id}|${recovered.reference_card_id}`;
  const current = completed.get(key);
  if (current?.status !== 'success' || (!current?.draft && recovered.draft) || String(recovered.finished_at || '') > String(current.finished_at || '')) completed.set(key, recovered);
}
const jobs: any[] = [];

for (const sourceJob of source.jobs.slice(0, limit)) {
  const key = `${sourceJob.product_id}|${sourceJob.reference_card_id}`;
  const previous = completed.get(key);
  if (previous?.status === 'success') {
    jobs.push(previous);
    continue;
  }
  const started = Date.now();
  try {
    const response = await fetch(`${base}/api/reference-studio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'compose',
        product_id: sourceJob.product_id,
        reference_card_id: sourceJob.reference_card_id,
        topic: sourceJob.topic,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
    jobs.push({
      ...sourceJob,
      status: 'success',
      duration_ms: Date.now() - started,
      pipeline_version: payload.pipeline_version,
      usage: payload.usage,
      artifacts: payload.artifacts,
      draft: payload.artifacts?.compiledDraft?.data,
      warnings: payload.warnings || [],
      saved_batch_id: payload.saved_batch_id,
      finished_at: new Date().toISOString(),
    });
    console.log(`[resume] PASS ${key} ${Date.now() - started}ms ${payload.usage?.total_tokens || 0} tokens`);
  } catch (cause) {
    jobs.push({
      ...sourceJob,
      status: 'failed',
      duration_ms: Date.now() - started,
      failure: { message: cause instanceof Error ? cause.message : String(cause) },
    });
    console.log(`[resume] FAIL ${key} ${Date.now() - started}ms ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  fs.writeFileSync(outputPath, JSON.stringify({
    ...source,
    base_url: base,
    resumed_at: new Date().toISOString(),
    jobs,
  }, null, 2));
}

fs.writeFileSync(outputPath, JSON.stringify({
  ...source,
  base_url: base,
  resumed_at: new Date().toISOString(),
  jobs,
}, null, 2));
console.log(`[resume] saved ${outputPath}: ${jobs.filter(job => job.status === 'success').length}/${jobs.length} success`);

function recoverPersistedSuccesses() {
  const batches = path.join(process.cwd(), 'data', 'batches');
  if (!fs.existsSync(batches)) return [];
  const recovered: any[] = [];
  for (const directory of fs.readdirSync(batches).filter(name => name.startsWith('single_'))) {
    const jobPath = path.join(batches, directory, 'jobs', 'job_001.json');
    if (!fs.existsSync(jobPath)) continue;
    try {
      const job = JSON.parse(fs.readFileSync(jobPath, 'utf8'));
      if (job.status !== 'success' || job.pipeline_version !== 'v2') continue;
      recovered.push({
        ...job,
        duration_ms: job.started_at && job.finished_at ? Date.parse(job.finished_at) - Date.parse(job.started_at) : undefined,
        warnings: job.artifacts?.compiledDraft?.warnings || [],
        saved_batch_id: directory,
      });
    } catch {}
  }
  return recovered;
}
