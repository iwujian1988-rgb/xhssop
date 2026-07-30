/* eslint-disable no-console */
/**
 * 一次性测试：resource_14 改成 image_to_image 后的实际效果。
 * 跑 3 张图，肉眼看文字准确率/版式。
 *
 * 用法：npx tsx scripts/test-collocation-image.mts
 * 前置：dev server 在 :4000 上跑。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';
const CARD_ID = 'resource_14_collocation_dense_green';
const SAMPLES = 3;

interface BatchSummary {
  id: string;
  status: string;
  jobs: Array<{ id: string; reference_card_id: string; topic: { topic: string }; status: string }>;
}

interface BatchJob {
  id: string;
  reference_card_id: string;
  status: string;
  attempts: number;
  topic: { topic: string };
  draft?: { selected_title?: string };
  cover_image_url?: string;
  failure?: { stage: string; message: string };
  usage?: { total_tokens: number; calls: number };
}

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
  console.log(`[collocation-test] base=${BASE_URL} card=${CARD_ID} samples=${SAMPLES}`);

  // 1. Plan
  console.log('[collocation-test] === plan ===');
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: [CARD_ID],
    topics_per_card: SAMPLES,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`[collocation-test] plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch as BatchSummary;
  console.log(`[collocation-test] batch=${batch.id} jobs=${batch.jobs.length}`);

  // 2. Run
  console.log('[collocation-test] === run ===');
  const runResult = await postJson({ action: 'run', batch_id: batch.id });
  if (!runResult.ok && runResult.status !== 409) {
    console.error(`[collocation-test] run 失败：${runResult.json?.error || runResult.status}`);
    process.exit(1);
  }
  console.log(`[collocation-test] runner started`);

  // 3. Poll
  let pollCount = 0;
  const startedAt = Date.now();
  let lastJobs: BatchJob[] = [];
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) {
      console.error(`[collocation-test] poll 失败`);
      break;
    }
    const summary = result.json.batch as BatchSummary;
    lastJobs = result.json.jobs as BatchJob[];
    const done = lastJobs.filter(j => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`[collocation-test] poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} status=${summary.status}`);
    if (summary.status === 'done') break;
    if (pollCount > 90) {
      console.error('[collocation-test] 超时（>15分钟）');
      break;
    }
    await sleep(10000);
  }

  // 4. Report
  console.log('\n========== resource_14 image_to_image 测试报告 ==========\n');
  let successCount = 0;
  for (const job of lastJobs) {
    if (job.status === 'success') {
      successCount += 1;
      console.log(`✅ ${job.id}`);
      console.log(`   title: ${job.draft?.selected_title || '(?)'}`);
      console.log(`   url: ${job.cover_image_url || '(missing)'}`);
      console.log(`   tokens: ${job.usage?.total_tokens || 0} · attempts: ${job.attempts}`);
    } else {
      console.log(`❌ ${job.id}`);
      console.log(`   stage: ${job.failure?.stage || '?'}`);
      console.log(`   msg: ${job.failure?.message?.slice(0, 200) || '(?)'}`);
    }
  }
  console.log(`\n成功: ${successCount}/${lastJobs.length}`);

  // Save JSON
  const fs = await import('node:fs/promises');
  const outPath = `collocation-image-result-${Date.now()}.json`;
  await fs.writeFile(outPath, JSON.stringify({ jobs: lastJobs }, null, 2));
  console.log(`详细数据写入 ${outPath}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('collocation-test crashed:', error);
  process.exit(1);
});
