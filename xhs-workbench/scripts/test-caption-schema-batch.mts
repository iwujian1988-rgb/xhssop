/* eslint-disable no-console */
/**
 * schema 模式冒烟测试：跑 3 个 jobs（单 card × 3 topics），验证：
 *   - LLM 真的返回 caption_parts
 *   - 字段填充率 ≥80%
 *   - 通过率 100%
 *   - caption_ai_cliche 命中率 <30%
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';
const CARD_ID = process.argv[2] || 'resource_02_grammar_white_green';
const TOPICS = Number(process.argv[3] || 3);

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
  console.log(`[caption-schema-test] base=${BASE_URL} card=${CARD_ID} topics=${TOPICS}`);
  console.log(`[caption-schema-test] CAPTION_MODE=${process.env.CAPTION_MODE || 'schema (default)'}`);

  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: [CARD_ID],
    topics_per_card: TOPICS,
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
    if (!result.ok) break;
    lastJobs = result.json.jobs;
    const done = lastJobs.filter((j: any) => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    console.log(`poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length}`);
    if (result.json.batch.status === 'done') break;
    if (pollCount > 60) break;
    await sleep(10000);
  }

  // 分析结果
  console.log('\n========== schema 字段填充率报告 ==========');
  let success = 0;
  let failed = 0;
  let schemaFilled = 0;
  let clicheHit = 0;
  const clicheRe = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|综上所述|^总而言之|^总的来说|使用时可以先看封面总览|这样复盘会更具体|备考会更有条理|帮你[^，。]{0,15}(?:快速|高效|轻松|省)|这套(?:整理好的|系统|完整)|按部就班|即查即用/;

  for (const job of lastJobs) {
    const tag = job.status === 'success' ? '✅' : '❌';
    const token = job.usage?.total_tokens || 0;
    console.log(`${tag} ${job.id} tokens=${token}`);
    if (job.status === 'success') {
      success += 1;
      const c = job.draft?.caption || '';
      const hitsCliche = clicheRe.test(c);
      if (hitsCliche) {
        clicheHit += 1;
        console.log(`  ⚠️ caption_ai_cliche 命中：${c.match(clicheRe)?.[0]}`);
      }
    } else {
      failed += 1;
      console.log(`  msg: ${job.failure?.message?.slice(0, 240)}`);
    }
  }

  // 字段填充率：检查原始 LLM 响应（如果有 raw_editorial 或 audit trail）
  // 简化版：通过 caption 是否含 schema 拼装特征（"例："+"（...）"+"1./·/→"）来判断
  console.log('\n========== schema 拼装特征检测 ==========');
  let schemaLikeCount = 0;
  for (const job of lastJobs) {
    if (job.status !== 'success') continue;
    const c = job.draft?.caption || '';
    const hasExample = c.includes('例：');
    const hasStepNumber = /\n\d+[.)]\s/.test(c) || /\n·\s/.test(c) || /\n→\s/.test(c);
    const hasTranslation = /（[^）]{4,40}）/.test(c);
    if (hasExample && hasStepNumber && hasTranslation) {
      schemaLikeCount += 1;
    } else {
      console.log(`  ⚠️ ${job.id} 不像 schema 拼装：example=${hasExample} step=${hasStepNumber} translation=${hasTranslation}`);
      console.log(`     caption 前 100 字：${c.slice(0, 100)}`);
    }
  }

  console.log(`\n========== 汇总 ==========`);
  console.log(`通过率：${success}/${lastJobs.length}（${Math.round(success / lastJobs.length * 100)}%）`);
  console.log(`AI 套话命中：${clicheHit}/${success}`);
  console.log(`schema 拼装特征：${schemaLikeCount}/${success}（${Math.round(schemaLikeCount / Math.max(success, 1) * 100)}%）`);
  console.log(`平均 token：${Math.round(lastJobs.reduce((s: number, j: any) => s + (j.usage?.total_tokens || 0), 0) / lastJobs.length)}`);

  const fs = await import('node:fs/promises');
  await fs.writeFile(`caption-schema-test-${Date.now()}.json`, JSON.stringify({ batch, jobs: lastJobs }, null, 2));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => { console.error('crashed:', error); process.exit(1); });
