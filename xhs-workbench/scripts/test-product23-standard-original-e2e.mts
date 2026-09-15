import fs from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const products = ['tef_tcf_canada', 'tcf_canada_writing_7day'] as const;
const results: any[] = [];

for (const product_id of products) {
  const plan = await post('/api/batch', {
    action: 'plan',
    product_id,
    content_mode: 'standard',
    knowledge_mode: 'educational_original',
    job_count: 1,
  });
  const batchId = plan.batch?.id || plan.batch_id;
  if (!batchId) throw new Error(`${product_id}: plan did not return batch id`);
  await post('/api/batch', { action: 'run', batch_id: batchId });

  let latest: any;
  for (let i = 0; i < 180; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    latest = await get(`/api/batch?batch_id=${encodeURIComponent(batchId)}`);
    const status = latest.batch?.status;
    if (status === 'done' || status === 'failed') break;
  }
  const jobs = latest?.jobs || latest?.batch?.jobs || [];
  results.push({
    product_id,
    batch_id: batchId,
    batch_status: latest?.batch?.status,
    jobs: jobs.map((job: any) => ({
      id: job.id,
      status: job.status,
      current_stage: job.current_stage,
      error: job.error,
      topic: job.artifacts?.selectedTopic?.data?.topic || job.topic?.v2_topic?.topic || job.topic?.topic,
      selected_title: job.draft?.selected_title,
      title_candidates: job.draft?.title_candidates?.length || job.draft?.title_bundles?.length || 0,
      pages: job.draft?.inner_pages?.length || 0,
      cover_sections: job.draft?.cover?.sections?.length || 0,
      caption_length: job.draft?.caption?.length || 0,
      tags: job.draft?.tags || [],
      warnings: job.warnings || [],
      checks: job.draft?.checks,
    })),
  });
}

await fs.writeFile('data/product23-standard-original-e2e-latest.json', JSON.stringify(results, null, 2), 'utf8');
console.log(JSON.stringify(results, null, 2));

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
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
