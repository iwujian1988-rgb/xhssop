/* eslint-disable no-console */
/**
 * 自测脚本：聚焦验证修复后的失败模式（cover_item_too_long, product_identity_mismatch,
 * cover_section_count_invalid）。只跑 4 张卡 × 1 topic = 4 jobs，省 token。
 *
 * 用法：npx tsx scripts/test-selftest-batch.mts
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

// 选最容易暴露问题的 4 张卡：3 个 code 模板 + 1 个 hybrid
const FOCUS_CARDS = [
  'resource_01_grammar_parchment_red',   // code: parchment_dense_directory（job_001 失败）
  'resource_10_plain_text_experience',    // code: plain_experience（job_007 失败）
  'resource_05_grammar_clean_purple',     // code: clean_purple_directory
  'resource_04_chalkboard_phrase_list',   // hybrid: blackboard_phrase
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
  console.log(`[self-test] base=${BASE_URL} cards=${FOCUS_CARDS.length}`);

  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: FOCUS_CARDS,
    topics_per_card: 1,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`[self-test] plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch;
  const planElapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[self-test] plan: batch=${batch.id} jobs=${batch.jobs.length} 耗时=${planElapsed}s`);

  const runResult = await postJson({ action: 'run', batch_id: batch.id });
  console.log(`[self-test] runner: ${JSON.stringify(runResult.json)}`);

  const runStartedAt = Date.now();
  let lastSummary: any = null;
  let lastJobs: any[] = [];
  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) {
      console.error(`[self-test] poll 失败`);
      break;
    }
    lastSummary = result.json.batch;
    lastJobs = result.json.jobs;
    const done = lastJobs.filter((j: any) => j.status === 'success' || j.status === 'failed').length;
    const ok = lastJobs.filter((j: any) => j.status === 'success').length;
    const fail = lastJobs.filter((j: any) => j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    console.log(`[self-test] poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} ✅${ok} ❌${fail}`);
    if (lastSummary.status === 'done') break;
    if (pollCount > 90) break;
    await sleep(10000);
  }

  console.log('\n========== SELF-TEST REPORT ==========\n');
  let ok = 0, fail = 0;
  let totalTokens = 0;
  for (const job of lastJobs) {
    const tag = job.status === 'success' ? '✅' : '❌';
    const stage = job.status === 'success' ? '' : ` stage=${job.failure?.stage}`;
    console.log(`${tag} ${job.id} ${job.reference_card_id}${stage} tokens=${job.usage?.total_tokens || 0}`);
    if (job.status === 'success') ok += 1;
    else {
      fail += 1;
      console.log(`     msg: ${job.failure?.message?.slice(0, 200)}`);
    }
    totalTokens += job.usage?.total_tokens || 0;
  }
  console.log(`\n通过率：${ok}/${lastJobs.length} = ${((ok / lastJobs.length) * 100).toFixed(0)}%`);
  console.log(`累计 token：${totalTokens.toLocaleString()}`);

  // 输出每条 success job 的 selected_title 和 cover.title，方便人工检查重复
  if (ok > 0) {
    console.log('\n--- 标题对照 ---');
    for (const job of lastJobs.filter((j: any) => j.status === 'success')) {
      const d = job.draft;
      console.log(`[${job.reference_card_id}]`);
      console.log(`  selected: ${d?.selected_title}`);
      console.log(`  cover:    ${d?.cover?.title} | ${d?.cover?.subtitle || ''}`);
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('self-test crashed:', error);
  process.exit(1);
});
