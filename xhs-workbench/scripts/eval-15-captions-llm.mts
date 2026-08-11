/* eslint-disable no-console */
/**
 * 用更强的 LLM 给 15 篇 caption 打分（额外烧 token）。
 * 评分维度：naturalness（人味/anti-AI-flavor）、xhs_engagement（小红书爆款度）、
 *           topic_match（紧扣 DELF B2 写作主题）、clarity（信息清晰度）
 * 每条 caption 给出 1-5 分 + 具体问题列表 + 改写建议。
 *
 * 用法：OPENAI_MODEL=deepseek-v4-pro node scripts/eval-15-captions-llm.mts
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import fs from 'node:fs';
import path from 'node:path';

const SUCCESS_MAP = {
  resource_01_grammar_parchment_red: { batch: 'batch_1785854296934', job: 'job_001.json' },
  resource_02_grammar_white_green: { batch: 'batch_1785854296934', job: 'job_002.json' },
  resource_03_chalkboard_course: { batch: 'batch_1785854296934', job: 'job_008.json' },
  resource_04_chalkboard_phrase_list: { batch: 'batch_1785854296934', job: 'job_007.json' },
  resource_05_grammar_clean_purple: { batch: 'batch_1786418252988', job: 'job_001.json' },
  resource_06_notes_course_offer: { batch: 'batch_1786418252988', job: 'job_003.json' },
  resource_07_question_words_parchment: { batch: 'batch_1785854296934', job: 'job_009.json' },
  resource_08_book_cover_fle: { batch: 'batch_1785854296934', job: 'job_012.json' },
  resource_09_notebook_warning: { batch: 'batch_1785854296934', job: 'job_010.json' },
  resource_10_plain_text_experience: { batch: 'batch_1785854296934', job: 'job_006.json' },
  resource_11_delf_doc_analysis: { batch: 'batch_1786418252988', job: 'job_004.json' },
  resource_12_delf_vocab_table_overlay: { batch: 'batch_1785854296934', job: 'job_013.json' },
  resource_13_course_roadmap_blue: { batch: 'batch_1785854296934', job: 'job_014.json' },
  resource_14_collocation_dense_green: { batch: 'batch_1786422031290', job: 'job_001.json' },
  resource_15_grammar_grid_purple: { batch: 'batch_1786421005085', job: 'job_001.json' },
};

const SYSTEM_PROMPT = `你是一位小红书爆款文案评审专家，专门评估法语 DELF B2 写作备考类笔记的文案质量。
你的目标是判断这些文案能否通过小红书算法初筛、能否让真实用户（中国法语学习者）觉得"这是真人写的、对我有用"。

打分维度（每项 1-5 分，5 分最好）：
- naturalness：人味。是否存在 AI 套话（"不是…而是"、"问题出在"、"让 X 更 Y"、"通过…才能"、"综上所述"、"总而言之"等）、机械排比、空话。
- xhs_engagement：小红书爆款度。是否有钩子（数字、痛点、反差）、是否有"看完就能用"的实用感、是否让人想点收藏。
- topic_match：紧扣主题。是否真的围绕 DELF B2 写作（正式信、议论文、论坛投稿、字数、评分等），而不是泛泛"学法语"。
- clarity：信息清晰度。句子是否短、是否能一眼读懂、是否有冗余。

输出 JSON 格式（严格）：
{
  "scores": {
    "naturalness": 1-5,
    "xhs_engagement": 1-5,
    "topic_match": 1-5,
    "clarity": 1-5
  },
  "overall_score": 1-5,  // 加权综合，2位小数
  "issues": ["具体问题1", "具体问题2"],  // 列出最严重的 1-3 个
  "rewrite_suggestion": "改写后的 caption（150-300 字，必须去除所有 AI 套话）"
}

注意：
- 不要给满分。整体 5 分严格保留给"完全可以直接发布且会爆"的文案。
- naturalness ≤ 2 时必须给出具体 AI 套话原文。
- rewrite_suggestion 必须比原文更自然、更口语、更"小红书味"。`;

function buildUserPrompt(items: { card: string; title: string; caption: string }[]) {
  const blocks = items.map((it, i) =>
    `【篇 ${i + 1}】card=${it.card}\n标题：${it.title}\n正文：${it.caption}`
  ).join('\n\n---\n\n');
  return `请评估以下 ${items.length} 篇 DELF B2 写作小红书文案。\n\n输出 JSON：{ "results": [{ card, scores, overall_score, issues, rewrite_suggestion }, ...] }\n\n${blocks}`;
}

async function callLLM(messages: { role: 'system' | 'user'; content: string }[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'deepseek-v4-pro';
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  if (!apiKey) throw new Error('缺 OPENAI_API_KEY');

  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.3,
      max_tokens: 8000,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM 请求失败：${res.status} ${body.slice(0, 400)}`);
  }
  const json = await res.json();
  const usage = json?.usage;
  const content = json?.choices?.[0]?.message?.content;
  console.info(`[LLM] model=${model} elapsed=${elapsed}s tokens=${usage?.total_tokens || '?'}`);
  if (!content) throw new Error('LLM 没返回内容');
  const unwrapped = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  return { parsed: JSON.parse(unwrapped), usage };
}

function discoverLatestSuccessJobs(): { card: string; title: string; caption: string }[] {
  // 扫所有 batch（除当前正在跑的 done!=true 的），每个 card_id 取最近一次 success job
  const batchesDir = 'data/batches';
  const batches = fs.readdirSync(batchesDir).filter(d => d.startsWith('batch_')).sort();
  const byCard = new Map<string, { batch: string; jobFile: string; mtime: number }>();
  for (const b of batches) {
    const jobsDir = path.join(batchesDir, b, 'jobs');
    if (!fs.existsSync(jobsDir)) continue;
    for (const f of fs.readdirSync(jobsDir).filter(f => f.endsWith('.json'))) {
      const full = path.join(jobsDir, f);
      let j: any;
      try { j = JSON.parse(fs.readFileSync(full, 'utf8')); } catch { continue; }
      if (j.status !== 'success' || !j.draft?.caption) continue;
      const st = fs.statSync(full).mtimeMs;
      const prev = byCard.get(j.reference_card_id);
      if (!prev || st > prev.mtime) byCard.set(j.reference_card_id, { batch: b, jobFile: f, mtime: st });
    }
  }
  const items: { card: string; title: string; caption: string }[] = [];
  for (const [card, info] of byCard.entries()) {
    const full = path.join(batchesDir, info.batch, 'jobs', info.jobFile);
    const job = JSON.parse(fs.readFileSync(full, 'utf8'));
    items.push({ card, title: job.draft.selected_title, caption: job.draft.caption });
  }
  return items.sort((a, b) => a.card.localeCompare(b.card));
}

async function main() {
  console.log(`[eval-15] model=${process.env.OPENAI_MODEL || 'deepseek-v4-pro (default)'}`);
  console.log(`[eval-15] source=${process.env.EVAL_SOURCE || 'auto-discover latest success jobs'}`);

  const items = process.env.EVAL_SOURCE === 'legacy-map'
    ? Object.entries(SUCCESS_MAP).map(([card, info]) => {
        const full = path.join('data/batches', info.batch, 'jobs', info.job);
        const job = JSON.parse(fs.readFileSync(full, 'utf8'));
        return { card, title: job.draft.selected_title, caption: job.draft.caption };
      })
    : discoverLatestSuccessJobs();
  console.log(`加载 ${items.length} 篇 caption`);

  // 分 2 批跑，每批 7-8 篇，避免单次 prompt 过大或返回截断
  const batch1 = items.slice(0, 8);
  const batch2 = items.slice(8);

  console.log(`\n--- Batch 1 (8 篇) ---`);
  const r1 = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(batch1) },
  ]);

  console.log(`\n--- Batch 2 (7 篇) ---`);
  const r2 = await callLLM([
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(batch2) },
  ]);

  const results1 = Array.isArray(r1.parsed.results) ? r1.parsed.results : [];
  const results2 = Array.isArray(r2.parsed.results) ? r2.parsed.results : [];
  const allResults = [...results1, ...results2];

  // 写详细 json
  const out = {
    generated_at: new Date().toISOString(),
    model: process.env.OPENAI_MODEL || 'deepseek-v4-pro',
    items: items.map((it, i) => ({ ...it, ...allResults[i] })),
    usage_total: {
      batch1: r1.usage,
      batch2: r2.usage,
      total_tokens: (r1.usage?.total_tokens || 0) + (r2.usage?.total_tokens || 0),
    },
  };
  const outPath = `caption-llm-eval-${Date.now()}.json`;
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n详细 JSON：${outPath}`);

  // 控制台汇总
  console.log('\n========== Caption LLM Eval Summary ==========');
  console.log('card'.padEnd(40) + 'overall'.padStart(8) + 'nat'.padStart(5) + 'xhs'.padStart(5) + 'top'.padStart(5) + 'cla'.padStart(5));
  for (const item of out.items) {
    const s = item.scores || {};
    console.log(
      item.card.slice(0, 40).padEnd(40) +
      String(item.overall_score ?? '-').padStart(8) +
      String(s.naturalness ?? '-').padStart(5) +
      String(s.xhs_engagement ?? '-').padStart(5) +
      String(s.topic_match ?? '-').padStart(5) +
      String(s.clarity ?? '-').padStart(5)
    );
  }

  // 平均分
  const valid = out.items.filter(i => typeof i.overall_score === 'number');
  if (valid.length) {
    const avg = valid.reduce((s, i) => s + i.overall_score, 0) / valid.length;
    const avgNat = valid.reduce((s, i) => s + (i.scores?.naturalness || 0), 0) / valid.length;
    const avgXhs = valid.reduce((s, i) => s + (i.scores?.xhs_engagement || 0), 0) / valid.length;
    const avgTop = valid.reduce((s, i) => s + (i.scores?.topic_match || 0), 0) / valid.length;
    const avgCla = valid.reduce((s, i) => s + (i.scores?.clarity || 0), 0) / valid.length;
    console.log('\n平均分（' + valid.length + ' 篇）：');
    console.log(`  overall=${avg.toFixed(2)}  naturalness=${avgNat.toFixed(2)}  xhs=${avgXhs.toFixed(2)}  topic=${avgTop.toFixed(2)}  clarity=${avgCla.toFixed(2)}`);
  }

  // 问题汇总
  const flagged = out.items.filter(i => (i.issues?.length || 0) > 0);
  if (flagged.length) {
    console.log(`\n需改进的篇目（${flagged.length}/${out.items.length}）：`);
    for (const item of flagged) {
      console.log(`  ${item.card}: ${(item.issues || []).join(' | ')}`);
    }
  }
}

main().catch(e => { console.error('crashed:', e); process.exit(1); });
