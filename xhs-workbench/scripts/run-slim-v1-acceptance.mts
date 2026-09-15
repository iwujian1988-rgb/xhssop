import fs from 'node:fs/promises';
import path from 'node:path';
const base = process.env.SLIM_TEST_BASE_URL || 'http://localhost:4180';
const output = path.resolve('data', 'slim-v1-acceptance', String(Date.now()));
await fs.mkdir(output, { recursive: true });
async function post(body: unknown) {
  const response = await fetch(base + '/api/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(900000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
// Real production entry. No seeded topics, patched responses or draft edits.
const planned = await post({
  action: 'plan', product_id: 'delf_b2_writing', content_mode: 'standard',
  knowledge_mode: 'mixed', topics_per_card: 1,
  card_ids: process.env.SLIM_TEST_CARDS?.split(',') || ['resource_09_notebook_warning', 'resource_08_book_cover_fle', 'resource_02_grammar_white_green'],
  direction: process.env.SLIM_TEST_DIRECTION || '三篇真实商用笔记：分别关注考前写作急救、正式信写作实用材料、覆盖多个常见场景的高密度句型或论据速查合集。选题像考生愿意点开的题，其中应有自然丰富、可收藏反复使用的资料合集。不要根据封面规划内容，不固定页数或条数，避免重复前面已选主题。',
});
await fs.writeFile(path.join(output, 'plan.json'), JSON.stringify(planned, null, 2));
const batchId = planned.batch.id;
console.log(JSON.stringify({ output, batchId, planningUsage: planned.usage }));
await post({ action: 'run', batch_id: batchId });
let previous = '';
for (;;) {
  const result = await fetch(base + '/api/batch?batch_id=' + batchId).then(r=>r.json());
  const snapshot = JSON.stringify(result.jobs.map((job: any) => ({
    id: job.id, status: job.status, stage: job.current_stage,
    topic: job.topic.topic, calls: job.usage?.calls, failure: job.failure?.message,
  })));
  if (snapshot !== previous) console.log(snapshot);
  previous = snapshot;
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  if (result.batch.status === 'done' || result.jobs.every((job: any) => ['success','failed'].includes(job.status))) break;
  await new Promise(resolve => setTimeout(resolve, 5000));
}
console.log('RESULT_DIRECTORY=' + output);
