/* eslint-disable no-console */
/**
 * 三阶段统一验收：跑 15-job batch（5 cards × 3 topics，覆盖 code/hybrid/image 渲染），
 * 验证：
 *   - Phase 1：tag 多样性（用 seo_tags 数据池子）
 *   - Phase 2：caption 3 模板（list/story/contrast）均匀分布
 *   - Phase 3：内页 7 种 style_variant 全覆盖
 *   - 整体：通过率、AI 套话命中率
 *
 * 用法：npx tsx scripts/verify-15job-all-phases.mts
 * 前置：dev server 在 :4000 上跑。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

// 5 cards 覆盖 3 种渲染模式
const CARDS = [
  'resource_02_grammar_white_green',     // code
  'resource_05_grammar_clean_purple',    // code
  'resource_07_question_words_parchment',// hybrid
  'resource_11_delf_doc_analysis',       // hybrid
  'resource_08_book_cover_fle',          // image
];

const ALL_STYLES = new Set(['lined-notebook', 'grid-notebook', 'dot-notebook', 'sticky-note', 'draft-paper', 'loose-leaf', 'kraft-paper']);

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

function inferTemplate(caption: string): 'list' | 'story' | 'contrast' | 'unknown' {
  if (/常见错误：/.test(caption) && /正确做法：/.test(caption)) return 'contrast';
  if (/整理出来这几点：|所以整理出来这几点：/.test(caption)) return 'story';
  if (/\n\d+[.)]\s|\n·\s/.test(caption)) return 'list';
  return 'unknown';
}

async function main() {
  console.log(`[verify-15job] base=${BASE_URL} cards=${CARDS.length} topics_per_card=3`);
  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: CARDS,
    topics_per_card: 3,
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
    if (pollCount > 90) break;
    await sleep(15000);
  }

  // ===== 分析 =====
  const clicheRe = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|综上所述|^总而言之|^总的来说|使用时可以先看封面总览|这样复盘会更具体|备考会更有条理|帮你[^，。]{0,15}(?:快速|高效|轻松|省)|这套(?:整理好的|系统|完整)|按部就班|即查即用/;

  let success = 0;
  let failed = 0;
  let clicheHit = 0;
  let totalTokens = 0;
  const templateCount = { list: 0, story: 0, contrast: 0, unknown: 0 };
  const styleUsage = new Map<string, number>();
  const allTags: string[] = [];
  const tagsPerJob: string[][] = [];

  console.log('\n========== Job 详情 ==========');
  for (const job of lastJobs) {
    const tag = job.status === 'success' ? '✅' : '❌';
    const token = job.usage?.total_tokens || 0;
    console.log(`${tag} ${job.id} card=${job.reference_card_id} tokens=${token}`);
    if (job.status === 'success') {
      success += 1;
      totalTokens += token;
      const c = job.draft?.caption || '';
      const hitsCliche = clicheRe.test(c);
      if (hitsCliche) {
        clicheHit += 1;
        console.log(`  ⚠️ AI 套话命中：${c.match(clicheRe)?.[0]}`);
      }
      const tpl = inferTemplate(c);
      templateCount[tpl] += 1;
      console.log(`  template: ${tpl}`);

      const styles = (job.draft?.inner_pages || []).map((p: any) => p.style_variant).filter(Boolean) as string[];
      console.log(`  inner_styles: ${styles.join(', ')}`);
      for (const s of styles) styleUsage.set(s, (styleUsage.get(s) || 0) + 1);

      const tags = (job.draft?.tags || []) as string[];
      tagsPerJob.push(tags);
      allTags.push(...tags);
    } else {
      failed += 1;
      console.log(`  msg: ${job.failure?.message?.slice(0, 240)}`);
    }
  }

  // Phase 2: template 分布
  console.log('\n========== Phase 2: Caption 模板分布 ==========');
  for (const [k, v] of Object.entries(templateCount)) {
    console.log(`  ${k}: ${v} (${Math.round(v / Math.max(success, 1) * 100)}%)`);
  }

  // Phase 3: style 覆盖
  console.log('\n========== Phase 3: 内页样式覆盖 ==========');
  for (const s of Array.from(ALL_STYLES)) {
    console.log(`  ${s}: ${styleUsage.get(s) || 0}`);
  }
  const missingStyles = Array.from(ALL_STYLES).filter(s => !styleUsage.has(s));
  console.log(`  缺失样式（${missingStyles.length}）：${missingStyles.join(', ') || '无'}`);

  // Phase 1: tag 多样性
  console.log('\n========== Phase 1: Tag 多样性 ==========');
  const tagCounts = new Map<string, number>();
  for (const t of allTags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const uniqueTags = tagCounts.size;
  const maxRepeat = Math.max(...Array.from(tagCounts.values()));
  const avgPerJob = allTags.length / Math.max(success, 1);
  console.log(`  总 tag 数：${allTags.length}`);
  console.log(`  unique tag 数：${uniqueTags}`);
  console.log(`  平均每篇 tag：${avgPerJob.toFixed(1)}`);
  console.log(`  最高重复次数：${maxRepeat}（理想 < ${Math.ceil(success * 0.6)}）`);

  // 汇总
  console.log('\n========== 整体汇总 ==========');
  console.log(`通过率：${success}/${lastJobs.length}（${Math.round(success / lastJobs.length * 100)}%）`);
  console.log(`AI 套话命中：${clicheHit}/${success}（${Math.round(clicheHit / Math.max(success, 1) * 100)}%）`);
  console.log(`平均 token：${Math.round(totalTokens / Math.max(success, 1))}`);

  // 写详细 json
  const out = {
    generated_at: new Date().toISOString(),
    batch_id: batch.id,
    jobs: lastJobs.map((j: any) => ({
      id: j.id, card: j.reference_card_id, status: j.status,
      tokens: j.usage?.total_tokens || 0,
      template: j.status === 'success' ? inferTemplate(j.draft?.caption || '') : null,
      tags: j.draft?.tags || [],
      inner_styles: (j.draft?.inner_pages || []).map((p: any) => p.style_variant).filter(Boolean),
      failure: j.failure?.message,
    })),
    summary: {
      success, failed, clicheHit,
      template_distribution: templateCount,
      style_coverage: Object.fromEntries(styleUsage),
      unique_tags: uniqueTags,
      max_tag_repeat: maxRepeat,
      avg_tags_per_job: avgPerJob,
      total_tokens: totalTokens,
    },
  };
  const outPath = `verify-15job-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n详细 JSON：${outPath}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => { console.error('crashed:', error); process.exit(1); });
