/* eslint-disable no-console */
/**
 * P0-2 验证脚本：跑完整 20-job 混合 batch（code/hybrid/image 模板），
 * 验证批量管线端到端：plan → run → poll → 完成 → 删除 → 重试。
 *
 * 断点续跑（kill dev server 重启）需手动验证，脚本只做完整端到端。
 *
 * 用法：npx tsx scripts/test-full-batch.mts
 * 前置：dev server 在 :4000 上跑。
 *
 * 注：默认 topics_per_card=2，选 10 张卡 → 20 job。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

// 10 张卡覆盖所有渲染模式：5 code + 3 hybrid + 2 image_to_image
const MIXED_CARDS = [
  'resource_01_grammar_parchment_red',        // code
  'resource_05_grammar_clean_purple',         // code
  'resource_06_notes_course_offer',           // code
  'resource_10_plain_text_experience',        // code (BUG-2 已修)
  'resource_14_collocation_dense_green',      // code
  'resource_04_chalkboard_phrase_list',       // hybrid
  'resource_07_question_words_parchment',     // hybrid
  'resource_11_delf_doc_analysis',            // hybrid
  'resource_08_book_cover_fle',               // image_to_image
  'resource_13_course_roadmap_blue',          // image_to_image
];

interface BatchJob {
  id: string;
  seq: number;
  reference_card_id: string;
  status: string;
  attempts: number;
  topic: { topic: string };
  draft?: unknown;
  cover_image_url?: string;
  failure?: { stage: string; message: string };
  usage?: { total_tokens: number; calls: number; autofix_count?: number };
}

interface BatchSummary {
  id: string;
  status: string;
  jobs: Array<{ id: string; reference_card_id: string; topic: { topic: string }; status: string }>;
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
  console.log(`[full-test] base=${BASE_URL} cards=${MIXED_CARDS.length}`);

  // 1. Plan: 10 cards × 2 topics = 20 jobs
  console.log('[full-test] === plan (10 cards × 2 topics = 20 jobs) ===');
  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: MIXED_CARDS,
    topics_per_card: 2,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`[full-test] plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch as BatchSummary;
  const planElapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[full-test] plan 完成：batch=${batch.id} jobs=${batch.jobs.length} 耗时=${planElapsed}s`);

  // 2. Run
  console.log('[full-test] === run ===');
  const runResult = await postJson({ action: 'run', batch_id: batch.id });
  if (!runResult.ok && runResult.status !== 409) {
    console.error(`[full-test] run 失败：${runResult.json?.error || runResult.status}`);
    process.exit(1);
  }
  console.log(`[full-test] runner: ${JSON.stringify(runResult.json)}`);

  // 3. Poll until done
  const runStartedAt = Date.now();
  let lastSummary: BatchSummary | null = null;
  let lastJobs: BatchJob[] = [];
  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) {
      console.error(`[full-test] poll 失败：${result.json?.error}`);
      break;
    }
    lastSummary = result.json.batch as BatchSummary;
    lastJobs = result.json.jobs as BatchJob[];
    const done = lastJobs.filter(j => j.status === 'success' || j.status === 'failed').length;
    const successSoFar = lastJobs.filter(j => j.status === 'success').length;
    const failedSoFar = lastJobs.filter(j => j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    const running = lastJobs.find(j => j.status === 'running');
    console.log(`[full-test] poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} ✅${successSoFar} ❌${failedSoFar} running=${running?.reference_card_id || '-'}`);
    if (lastSummary.status === 'done') break;
    if (pollCount > 240) { // 40 min cap
      console.error('[full-test] 超过 40 分钟仍未完成，退出');
      break;
    }
    await sleep(10000);
  }

  // 4. Report
  console.log('\n========== FULL BATCH REPORT ==========\n');
  let successCount = 0;
  let failedCount = 0;
  const stageBreakdown: Record<string, number> = {};
  let totalTokens = 0;
  let totalAutofix = 0;
  for (const job of lastJobs) {
    const tag = job.status === 'success' ? '✅' : '❌';
    const stage = job.status === 'success' ? '' : ` stage=${job.failure?.stage || '?'}`;
    const img = job.cover_image_url ? ' [image]' : '';
    console.log(`${tag} ${job.id} ${job.reference_card_id}${img}${stage} attempts=${job.attempts} tokens=${job.usage?.total_tokens || 0} autofix=${job.usage?.autofix_count || 0}`);
    if (job.status === 'success') successCount += 1;
    else {
      failedCount += 1;
      const stageKey = job.failure?.stage || 'unknown';
      stageBreakdown[stageKey] = (stageBreakdown[stageKey] || 0) + 1;
    }
    totalTokens += job.usage?.total_tokens || 0;
    totalAutofix += job.usage?.autofix_count || 0;
  }

  console.log('\n--- 汇总 ---');
  console.log(`总计: ${lastJobs.length}`);
  console.log(`成功: ${successCount}`);
  console.log(`失败: ${failedCount} 阶段分布: ${JSON.stringify(stageBreakdown)}`);
  console.log(`累计 token: ${totalTokens.toLocaleString()}`);
  console.log(`累计 autofix: ${totalAutofix}`);

  // 5. Delete test
  const firstSuccess = lastJobs.find(j => j.status === 'success');
  if (firstSuccess) {
    console.log(`\n[full-test] === 删除测试：移除 ${firstSuccess.id} ===`);
    const delResult = await postJson({ action: 'delete_job', batch_id: batch.id, job_id: firstSuccess.id });
    console.log(`删除结果: ${delResult.ok ? '✅' : '❌'} ${JSON.stringify(delResult.json).slice(0, 120)}`);
    const afterResult = await getBatch(batch.id);
    const afterJobs = (afterResult.json.jobs as BatchJob[]) || [];
    console.log(`删除后 job 总数：${afterJobs.length}（应为 ${lastJobs.length - 1}）`);
    const stillThere = afterJobs.find(j => j.id === firstSuccess.id);
    if (stillThere) console.log(`❌ ${firstSuccess.id} 仍在列表中`);
    else console.log(`✅ ${firstSuccess.id} 已正确移除`);
  }

  // Save detailed JSON
  const fs = await import('node:fs/promises');
  const outPath = `full-batch-result-${Date.now()}.json`;
  await fs.writeFile(outPath, JSON.stringify({ batch: lastSummary, jobs: lastJobs }, null, 2));
  console.log(`\n详细数据写入 ${outPath}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('full-test crashed:', error);
  process.exit(1);
});
