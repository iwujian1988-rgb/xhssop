/* eslint-disable no-console */
import fs from 'node:fs/promises';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4015';
const POLL_MS = Number(process.env.POLL_MS || 5000);
const OUT_JSON = process.env.OUT_JSON || 'v2-real-acceptance.json';

const cards = [
  'resource_01_grammar_parchment_red',
  'resource_04_chalkboard_phrase_list',
  'resource_06_notes_course_offer',
  'resource_10_plain_text_experience',
  'resource_11_delf_doc_analysis',
] as const;

const products = [
  { id: 'delf_b2_writing', name: '商品1 DELF B2 写作知识库' },
  { id: 'tef_tcf_canada', name: '商品2 TEF/TCF Canada 备考资料' },
] as const;

type Json = Record<string, any>;
const report: Json = {
  pipeline_version: 'v2',
  model: 'deepseek-v4-flash',
  started_at: new Date().toISOString(),
  base_url: BASE_URL,
  cards,
  products: [],
};

for (const product of products) {
  const productResult: Json = { ...product };
  const planStarted = Date.now();
  console.log(`[real-v2] planning ${product.name}`);
  const planned = await post('/api/batch', {
    action: 'plan',
    product_id: product.id,
    card_ids: cards,
    topics_per_card: 1,
    direction: '用于真实发布验收。选题必须匹配当前封面结构，优先用户正在搜索或备考中真实会遇到的问题；标题说人话、有点击理由，正文有可执行干货和自然商品承接。不同模板不要重复同一角度。',
  });
  productResult.plan_duration_ms = Date.now() - planStarted;
  productResult.plan_usage = planned.usage || {};
  productResult.batch_id = planned.batch?.id;
  productResult.planned_jobs = planned.batch?.jobs?.length || 0;
  console.log(`[real-v2] planned ${productResult.batch_id} jobs=${productResult.planned_jobs} tokens=${planned.usage?.total_tokens || 0}`);

  const runStarted = Date.now();
  await post('/api/batch', { action: 'run', batch_id: productResult.batch_id });
  productResult.final = await waitForBatch(productResult.batch_id);
  productResult.run_duration_ms = Date.now() - runStarted;
  report.products.push(productResult);
  await fs.writeFile(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
}

report.finished_at = new Date().toISOString();
report.jobs = report.products.flatMap((entry: Json) => entry.final?.jobs || []);
report.summary = {
  total: report.jobs.length,
  success: report.jobs.filter((job: Json) => job.status === 'success').length,
  failed: report.jobs.filter((job: Json) => job.status === 'failed').length,
  plan_calls: report.products.reduce((sum: number, entry: Json) => sum + Number(entry.plan_usage?.calls || 0), 0),
  plan_tokens: report.products.reduce((sum: number, entry: Json) => sum + Number(entry.plan_usage?.total_tokens || 0), 0),
  compose_calls: report.jobs.reduce((sum: number, job: Json) => sum + Number(job.usage?.calls || job.failure?.usage?.calls || 0), 0),
  compose_tokens: report.jobs.reduce((sum: number, job: Json) => sum + Number(job.usage?.total_tokens || job.failure?.usage?.total_tokens || 0), 0),
};
await fs.writeFile(OUT_JSON, JSON.stringify(report, null, 2), 'utf8');
console.log(`[real-v2] done ${JSON.stringify(report.summary)} output=${OUT_JSON}`);

async function waitForBatch(batchId: string) {
  for (let poll = 1; poll <= 240; poll += 1) {
    await sleep(POLL_MS);
    const state = await get(`/api/batch?batch_id=${encodeURIComponent(batchId)}`);
    const jobs = state.jobs || [];
    const done = jobs.filter((job: Json) => ['success', 'failed'].includes(job.status)).length;
    const running = jobs.find((job: Json) => job.status === 'running');
    console.log(`[real-v2] ${batchId} ${done}/${jobs.length} running=${running?.reference_card_id || '-'}`);
    if (state.batch?.status === 'done') return state;
  }
  throw new Error(`batch timeout: ${batchId}`);
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20 * 60 * 1000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`);
  return data;
}

async function get(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(60_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data).slice(0, 1000)}`);
  return data;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
