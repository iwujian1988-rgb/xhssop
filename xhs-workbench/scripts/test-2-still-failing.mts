/* eslint-disable no-console */
/**
 * 重跑剩下 2 个仍失败的模板：grid_purple_directory 和 collocation_dense。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

const CARDS = [
  { id: 'resource_15_grammar_grid_purple', renderer: 'grid_purple_directory' },
  { id: 'resource_14_collocation_dense_green', renderer: 'collocation_dense' },
];

async function postJson(body: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/api/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

async function getBatch(batchId: string) {
  const response = await fetch(`${BASE_URL}/api/batch?batch_id=${encodeURIComponent(batchId)}`);
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json };
}

async function main() {
  console.log(`[2-still] base=${BASE_URL} cards=${CARDS.length}`);
  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: CARDS.map(c => c.id),
    topics_per_card: 1,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch;
  console.log(`plan: batch=${batch.id} jobs=${batch.jobs.length} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await postJson({ action: 'run', batch_id: batch.id });

  const runStartedAt = Date.now();
  let pollCount = 0;
  let lastJobs: any[] = [];
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) { console.error(`poll 失败`); break; }
    lastJobs = result.json.jobs;
    const done = lastJobs.filter((j: any) => j.status === 'success' || j.status === 'failed').length;
    const ok = lastJobs.filter((j: any) => j.status === 'success').length;
    const fail = lastJobs.filter((j: any) => j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    const running = lastJobs.find((j: any) => j.status === 'running');
    console.log(`poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} ✅${ok} ❌${fail} running=${running?.reference_card_id || '-'}`);
    if (result.json.batch.status === 'done') break;
    if (pollCount > 120) break;
    await sleep(10000);
  }

  console.log('\n========== 2 STILL FAILING REPORT ==========\n');
  for (const job of lastJobs) {
    const card = CARDS.find(c => c.id === job.reference_card_id);
    const renderer = card?.renderer || job.reference_card_id;
    const tag = job.status === 'success' ? '✅' : '❌';
    const stage = job.status === 'success' ? '' : ` stage=${job.failure?.stage}`;
    console.log(`${tag} ${job.id} ${job.reference_card_id} (${renderer})${stage} tokens=${job.usage?.total_tokens || 0}`);
    if (job.status !== 'success') console.log(`     msg: ${job.failure?.message?.slice(0, 240)}`);
  }

  const fs = await import('node:fs/promises');
  await fs.writeFile(`2-still-result-${Date.now()}.json`, JSON.stringify({ batch, jobs: lastJobs }, null, 2));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => { console.error('crashed:', error); process.exit(1); });
