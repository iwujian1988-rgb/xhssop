import assert from 'node:assert/strict';

const base = process.env.TEST_BASE_URL || 'http://localhost:4012';

const topics = await post('/api/reference-studio', {
  action: 'topics',
  product_id: 'delf_b2_writing',
  reference_card_id: 'resource_01_grammar_parchment_red',
  direction: '',
});
assert.equal(topics.pipeline_version, 'v2');
assert.ok(Array.isArray(topics.topics) && topics.topics.length >= 1);

const composed = await post('/api/reference-studio', {
  action: 'compose',
  product_id: 'delf_b2_writing',
  reference_card_id: 'resource_01_grammar_parchment_red',
  topic: topics.topics[0],
});
assert.equal(composed.pipeline_version, 'v2');
assert.ok(composed.draft?.selected_title);
assert.ok(composed.draft?.cover?.sections?.length >= 4);
assert.ok((composed.draft?.inner_pages?.length || 0) >= 5);
assert.ok(composed.draft?.caption?.length >= 100);
assert.ok(composed.draft?.tags?.length >= 6);
assert.ok(composed.artifacts?.content && composed.artifacts?.titles && composed.artifacts?.compiledDraft);

const saved = await get(`/api/batch?batch_id=${encodeURIComponent(composed.saved_batch_id)}`);
assert.equal(saved.jobs[0].pipeline_version, 'v2');
assert.equal(saved.jobs[0].current_stage, 'compiled');

const batchPlan = await post('/api/batch', {
  action: 'plan',
  product_id: 'tef_tcf_canada',
  card_ids: ['resource_01_grammar_parchment_red', 'resource_02_grammar_white_green'],
  topics_per_card: 1,
  direction: '',
});
assert.equal(batchPlan.pipeline_version, 'v2');
assert.equal(batchPlan.batch.pipeline_version, 'v2');
assert.equal(batchPlan.batch.jobs.length, 2);

const started = await post('/api/batch', { action: 'run', batch_id: batchPlan.batch.id });
assert.equal(started.started, true);
let batch;
for (let index = 0; index < 240; index += 1) {
  await new Promise(resolve => setTimeout(resolve, 500));
  batch = await get(`/api/batch?batch_id=${encodeURIComponent(batchPlan.batch.id)}`);
  if (batch.batch.status === 'done') break;
}
assert.equal(batch.batch.status, 'done');
assert.ok(batch.jobs.every((job: Record<string, any>) => job.status === 'success'));
assert.ok(batch.jobs.every((job: Record<string, any>) => job.pipeline_version === 'v2' && job.current_stage === 'compiled'));
assert.ok(batch.jobs.every((job: Record<string, any>) => job.draft?.cover?.sections?.length >= 3));
assert.ok(batch.jobs.every((job: Record<string, any>) => (job.draft?.inner_pages?.length || 0) >= 5));

console.log(JSON.stringify({
  ok: true,
  single: {
    topics: topics.topics.length,
    title: composed.draft.selected_title,
    cover_sections: composed.draft.cover.sections.length,
    pages: composed.draft.inner_pages.length,
    tags: composed.draft.tags.length,
  },
  batch: {
    id: batchPlan.batch.id,
    jobs: batch.jobs.length,
    statuses: batch.jobs.map((job: Record<string, any>) => job.status),
  },
}, null, 2));

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function get(path: string) {
  const response = await fetch(`${base}${path}`);
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
