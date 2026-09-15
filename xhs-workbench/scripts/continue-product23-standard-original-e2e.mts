import fs from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const batches = [
  { product_id: 'tef_tcf_canada', batch_id: 'batch_1789103111942' },
  { product_id: 'tcf_canada_writing_7day', batch_id: 'batch_1789103136480' },
] as const;
const results: any[] = [];

for (const item of batches) {
  let state = await get(`/api/batch?batch_id=${item.batch_id}`);
  const job = state.jobs[0];
  const titles = job.artifacts.titles.data.humanSelectableTextTitles;
  const titleId = titles[0].id;
  await post('/api/batch', {
    action: 'update_draft_state',
    batch_id: item.batch_id,
    job_id: job.id,
    selected_bundle_id: titleId,
    selected_cover_title_id: titleId,
  });
  if (!job.artifacts?.content?.data?.coverCandidates?.some((entry: any) => !entry.rejectionReason)) {
    await post('/api/batch', { action: 'resume_selected_jobs', batch_id: item.batch_id, job_ids: [job.id] });
  }
  state = await waitForBatch(item.batch_id);
  let current = state.jobs[0];
  const candidates = current.artifacts?.content?.data?.coverCandidates || [];
  const candidate = candidates.find((entry: any) => !entry.rejectionReason && entry.templateId);
  if (!candidate) {
    results.push({ product_id: item.product_id, batch_id: item.batch_id, stage: current.current_stage, error: 'no valid cover candidate', candidates });
    continue;
  }
  const content = current.artifacts.content.data;
  await post('/api/batch', {
    action: 'update_draft_state',
    batch_id: item.batch_id,
    job_id: current.id,
    selected_cover_template_id: candidate.templateId,
    expected_cover_request_id: content.coverCopy.requestId,
  });
  await post('/api/batch', { action: 'resume_selected_jobs', batch_id: item.batch_id, job_ids: [current.id] });
  state = await waitForBatch(item.batch_id);
  current = state.jobs[0];
  results.push({
    product_id: item.product_id,
    batch_id: item.batch_id,
    status: current.status,
    current_stage: current.current_stage,
    selected_title: current.draft?.selected_title,
    cover: current.draft?.cover,
    pages: current.draft?.inner_pages?.length || 0,
    caption: current.draft?.caption,
    tags: current.draft?.tags || [],
    checks: current.draft?.checks,
    error: current.failure,
  });
}

await fs.writeFile('data/product23-standard-original-e2e-continued-latest.json', JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results, null, 2));

async function waitForBatch(batchId: string) {
  let latest: any;
  for (let i = 0; i < 180; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    latest = await get(`/api/batch?batch_id=${batchId}`);
    if (latest.batch?.status === 'done' && latest.jobs?.[0]?.status !== 'running') return latest;
  }
  return latest;
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function get(path: string) {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(120_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
