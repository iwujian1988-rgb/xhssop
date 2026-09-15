/* eslint-disable no-console */
/**
 * 只重跑 collocation_dense_green，验证 final-fallback 兜底是否生效。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

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
  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: ['resource_14_collocation_dense_green'],
    topics_per_card: 1,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch;
  console.log(`plan: batch=${batch.id} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`);

  await postJson({ action: 'run', batch_id: batch.id });

  const runStartedAt = Date.now();
  let pollCount = 0;
  let lastJobs: any[] = [];
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) break;
    lastJobs = result.json.jobs;
    const done = lastJobs.filter((j: any) => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    const running = lastJobs.find((j: any) => j.status === 'running');
    console.log(`poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} running=${running?.reference_card_id || '-'}`);
    if (result.json.batch.status === 'done') break;
    if (pollCount > 90) break;
    await sleep(10000);
  }

  for (const job of lastJobs) {
    const tag = job.status === 'success' ? '✅' : '❌';
    console.log(`${tag} ${job.id} ${job.reference_card_id} stage=${job.failure?.stage || ''} tokens=${job.usage?.total_tokens || 0}`);
    if (job.status !== 'success') console.log(`  msg: ${job.failure?.message?.slice(0, 240)}`);
  }

  const fs = await import('node:fs/promises');
  await fs.writeFile(`collocation-result-${Date.now()}.json`, JSON.stringify({ batch, jobs: lastJobs }, null, 2));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => { console.error('crashed:', error); process.exit(1); });
