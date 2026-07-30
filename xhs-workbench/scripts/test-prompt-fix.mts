/* eslint-disable no-console */
/**
 * 验证 memo_offer 爆款 title + plain_experience 反例 两处 prompt 改动。
 * 用法：npx tsx scripts/test-prompt-fix.mts
 * 前置：dev server 在 :4000 上跑。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

const CARDS = [
  'resource_06_notes_course_offer',   // memo_offer
  'resource_10_plain_text_experience', // plain_experience
];

interface BatchJob {
  id: string;
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
  console.log(`[prompt-fix] base=${BASE_URL} cards=${CARDS.length}`);

  console.log('[prompt-fix] === plan (2 cards × 1 topic = 2 jobs) ===');
  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: CARDS,
    topics_per_card: 1,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`[prompt-fix] plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch as BatchSummary;
  console.log(`[prompt-fix] plan 完成：batch=${batch.id} jobs=${batch.jobs.length} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`);

  console.log('[prompt-fix] === run ===');
  const runResult = await postJson({ action: 'run', batch_id: batch.id });
  if (!runResult.ok && runResult.status !== 409) {
    console.error(`[prompt-fix] run 失败：${runResult.json?.error || runResult.status}`);
    process.exit(1);
  }
  console.log(`[prompt-fix] runner: ${JSON.stringify(runResult.json)}`);

  const runStartedAt = Date.now();
  let lastSummary: BatchSummary | null = null;
  let lastJobs: BatchJob[] = [];
  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) {
      console.error(`[prompt-fix] poll 失败：${result.json?.error}`);
      break;
    }
    lastSummary = result.json.batch as BatchSummary;
    lastJobs = result.json.jobs as BatchJob[];
    const done = lastJobs.filter(j => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    const running = lastJobs.find(j => j.status === 'running');
    console.log(`[prompt-fix] poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} running=${running?.reference_card_id || '-'}`);
    if (lastSummary.status === 'done') break;
    if (pollCount > 60) { // 10 min cap
      console.error('[prompt-fix] 超过 10 分钟仍未完成，退出');
      break;
    }
    await sleep(10000);
  }

  console.log('\n========== PROMPT-FIX REPORT ==========\n');
  for (const job of lastJobs) {
    const tag = job.status === 'success' ? '✅' : '❌';
    console.log(`${tag} ${job.reference_card_id} attempts=${job.attempts} tokens=${job.usage?.total_tokens || 0}`);
    if (job.status === 'failed') {
      console.log(`  stage=${job.failure?.stage} msg=${job.failure?.message}`);
    }
  }

  const fs = await import('node:fs/promises');
  const outPath = `prompt-fix-result-${Date.now()}.json`;
  await fs.writeFile(outPath, JSON.stringify({ batch: lastSummary, jobs: lastJobs }, null, 2));
  console.log(`\n详细数据写入 ${outPath}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('prompt-fix crashed:', error);
  process.exit(1);
});
