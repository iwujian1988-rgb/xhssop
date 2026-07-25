/* eslint-disable no-console */
/**
 * P0-1 验证脚本：跑含 08/12/13 三个 image_to_image 模板的 batch，
 * 验证服务端出图链路（compose → generateCoverImageWithRetry → 落盘 cover_image_url）。
 *
 * 用法：npx tsx scripts/test-image-batch.mts
 * 前置：dev server 在 :4000 上跑。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';
const IMAGE_CARDS = [
  'resource_08_book_cover_fle',
  'resource_12_delf_vocab_table_overlay',
  'resource_13_course_roadmap_blue',
];

interface BatchSummary {
  id: string;
  status: string;
  jobs: Array<{
    id: string;
    seq: number;
    reference_card_id: string;
    topic: { topic: string };
    status: string;
  }>;
}

interface BatchJob {
  id: string;
  seq: number;
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
  console.log(`[image-test] base=${BASE_URL} cards=${IMAGE_CARDS.join(',')}`);

  // 1. Plan
  console.log('[image-test] === plan ===');
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: IMAGE_CARDS,
    topics_per_card: 1,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`[image-test] plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch as BatchSummary;
  console.log(`[image-test] batch=${batch.id} jobs=${batch.jobs.length}`);
  for (const job of batch.jobs) {
    console.log(`  ${job.id} ${job.reference_card_id} → ${job.topic.topic}`);
  }

  // 2. Run
  console.log('[image-test] === run ===');
  const runResult = await postJson({ action: 'run', batch_id: batch.id });
  if (!runResult.ok && runResult.status !== 409) {
    console.error(`[image-test] run 失败：${runResult.json?.error || runResult.status}`);
    process.exit(1);
  }
  console.log(`[image-test] runner started: ${JSON.stringify(runResult.json)}`);

  // 3. Poll until done
  let pollCount = 0;
  let lastBatch: BatchSummary | null = null;
  const startedAt = Date.now();
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) {
      console.error(`[image-test] poll 失败：${result.json?.error}`);
      process.exit(1);
    }
    lastBatch = result.json.batch as BatchSummary;
    const jobs = result.json.jobs as BatchJob[];
    const done = jobs.filter(j => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    const running = jobs.find(j => j.status === 'running');
    console.log(`[image-test] poll #${pollCount} elapsed=${elapsed}s done=${done}/${jobs.length} status=${lastBatch.status} running=${running?.reference_card_id || '-'}`);
    if (lastBatch.status === 'done') break;
    if (pollCount > 90) {
      console.error(`[image-test] 轮询超时（>15分钟）`);
      break;
    }
    await sleep(10000);
  }

  // 4. Report
  console.log('\n========== IMAGE BATCH REPORT ==========\n');
  const finalResult = await getBatch(batch.id);
  const finalJobs = finalResult.json.jobs as BatchJob[];
  let successCount = 0;
  let imageFailedCount = 0;
  let composeFailedCount = 0;
  for (const job of finalJobs) {
    const cardName = job.reference_card_id;
    if (job.status === 'success') {
      successCount += 1;
      const url = job.cover_image_url || '(missing)';
      console.log(`✅ ${job.id} ${cardName}`);
      console.log(`   title: ${job.draft?.selected_title || '(?)'}`);
      console.log(`   url: ${url.slice(0, 100)}${url.length > 100 ? '...' : ''}`);
      console.log(`   tokens: ${job.usage?.total_tokens || 0} · attempts: ${job.attempts}`);
      // Verify URL is fetchable
      if (job.cover_image_url) {
        try {
          const imgRes = await fetch(job.cover_image_url, { method: 'HEAD' });
          console.log(`   HEAD: ${imgRes.status} ${imgRes.headers.get('content-type')}`);
        } catch (cause) {
          console.log(`   HEAD failed: ${cause instanceof Error ? cause.message : 'unknown'}`);
        }
      }
    } else {
      console.log(`❌ ${job.id} ${cardName}`);
      console.log(`   stage: ${job.failure?.stage || 'unknown'}`);
      console.log(`   msg: ${job.failure?.message?.slice(0, 200) || '(?)'}`);
      console.log(`   tokens: ${job.usage?.total_tokens || 0}`);
      if (job.failure?.stage === 'image') imageFailedCount += 1;
      else composeFailedCount += 1;
    }
  }

  console.log('\n--- 汇总 ---');
  console.log(`成功: ${successCount}/${finalJobs.length} (设计目标 ≥80% = ≥2.4/3)`);
  console.log(`  其中 image 失败: ${imageFailedCount}`);
  console.log(`  其中 compose 失败: ${composeFailedCount}`);

  // Save detailed JSON
  const fs = await import('node:fs/promises');
  const outPath = `image-batch-result-${Date.now()}.json`;
  await fs.writeFile(outPath, JSON.stringify({ batch: lastBatch, jobs: finalJobs }, null, 2));
  console.log(`\n详细数据写入 ${outPath}`);

  const successRate = successCount / finalJobs.length;
  if (successRate >= 0.8) {
    console.log(`\n✅ 通过：成功率 ${(successRate * 100).toFixed(0)}% ≥ 80%`);
    process.exit(0);
  } else {
    console.log(`\n⚠️ 未达标：成功率 ${(successRate * 100).toFixed(0)}% < 80%`);
    process.exit(2);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('image-test crashed:', error);
  process.exit(1);
});
