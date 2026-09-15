/* eslint-disable no-console */
/**
 * 汇总 15 模板最新成功 jobs，做：
 *   1. 自动质检（cover 截断/AI 套话/身份词错/数字承诺/占位符等）
 *   2. 生成 all-15-preview.html（所有 15 篇预览，可截图）
 *   3. 生成 all-15-xhs-ready.txt（小红书发布文案）
 *
 * 用法：node scripts/build-all-15-deliverables.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

// 15 个 card → 最新成功 batch/job 映射（由 build-success-map.mjs 自动生成或手填）
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

const RENDERER_LABELS = {
  parchment_dense_directory: '羊皮纸高密度资料目录',
  white_green_directory: '白底绿字知识清单',
  clean_purple_directory: '白底紫色知识资料',
  grid_purple_directory: '网格纸紫色知识体系',
  memo_offer: '备忘录资料说明',
  plain_experience: '极简经验长图',
  blackboard_phrase: '黑板短语密集表',
  blackboard_offer: '黑板大字方案说明',
  word_flashcard: '印刷式词卡',
  notebook_big_words: '手写本痛点大字',
  document_analysis: '文档素材解析',
  book_cover: '法语教材封面风',
  vocab_table: '词汇表',
  course_roadmap: '学习路线图',
  collocation_dense: '三列固定搭配密表',
};

// 卡片 → renderer 映射（与 test-all-15-templates.mts 对齐）
const CARD_RENDERER = {
  resource_01_grammar_parchment_red: 'parchment_dense_directory',
  resource_02_grammar_white_green: 'white_green_directory',
  resource_05_grammar_clean_purple: 'clean_purple_directory',
  resource_15_grammar_grid_purple: 'grid_purple_directory',
  resource_06_notes_course_offer: 'memo_offer',
  resource_10_plain_text_experience: 'plain_experience',
  resource_04_chalkboard_phrase_list: 'blackboard_phrase',
  resource_03_chalkboard_course: 'blackboard_offer',
  resource_07_question_words_parchment: 'word_flashcard',
  resource_09_notebook_warning: 'notebook_big_words',
  resource_11_delf_doc_analysis: 'document_analysis',
  resource_08_book_cover_fle: 'book_cover',
  resource_12_delf_vocab_table_overlay: 'vocab_table',
  resource_13_course_roadmap_blue: 'course_roadmap',
  resource_14_collocation_dense_green: 'collocation_dense',
};

const AI_CLICHE_RE = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|不仅仅是.{1,18}.{0,4}更是|在.{1,18}的过程中|才是.{1,12}(?:关键|核心|根本)|通过.{1,18}，.{1,12}才能|让.{1,12}不再|重要性不言而喻|是一个需要.{1,18}的过程|综上所述|^总而言之|^总的来说|首先[，,][^。]{0,80}其次[，,][^。]{0,80}最后[，,]/;
const FORBIDDEN_IDENTITY_RE = /\b(?:TEF|TCF|CLB|NCLC)\b/;
const TRUNCATION_RE = /[→，,、；;：]$/;
const PLACEHOLDER_RE = /[\{<][^>}]{2,30}[\}>]/;

function loadJob(cardId) {
  const info = SUCCESS_MAP[cardId];
  const full = path.join('data/batches', info.batch, 'jobs', info.job);
  return JSON.parse(fs.readFileSync(full, 'utf8'));
}

function auditJob(job) {
  const issues = [];
  const d = job.draft;
  if (!d) return ['NO_DRAFT'];
  const title = d.selected_title || '';
  const cover = d.cover || {};
  const caption = d.caption || '';

  if (AI_CLICHE_RE.test(caption)) issues.push('caption_ai_cliche');
  const allText = `${title}\n${cover.title || ''}\n${cover.subtitle || ''}\n${caption}`;
  if (FORBIDDEN_IDENTITY_RE.test(allText)) issues.push('forbidden_identity');
  for (const section of (cover.sections || [])) {
    for (const item of (section.items || [])) {
      if (TRUNCATION_RE.test(item.primary || '') || TRUNCATION_RE.test(item.secondary || '')) {
        issues.push('cover_truncated');
        break;
      }
    }
  }
  if (PLACEHOLDER_RE.test(allText)) issues.push('placeholder_unfilled');
  if (caption.length < 120) issues.push(`caption_short:${caption.length}`);
  if (caption.length > 440) issues.push(`caption_long:${caption.length}`);
  return issues;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildPreviewHTML(jobs) {
  const blocks = [];
  for (const [idx, { card, renderer, job }] of jobs.entries()) {
    const d = job.draft;
    const issues = auditJob(job);
    const issueBanner = issues.length === 0
      ? '<div style="background:#dcfce7;color:#166534;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">✅ 质检通过</div>'
      : `<div style="background:#fee2e2;color:#991b1b;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;">⚠️ ${issues.join(' / ')}</div>`;
    const cover = d.cover || {};
    const sectionsHTML = (cover.sections || []).map(section => `
      <div style="margin-bottom:14px;">
        <div style="font-weight:600;color:#1e3a8a;margin-bottom:6px;border-bottom:1px solid #e5e7eb;padding-bottom:3px;">${escapeHtml(section.heading)}</div>
        ${(section.items || []).map(item => `
          <div style="display:flex;gap:8px;margin-bottom:4px;font-size:13px;">
            <div style="flex:0 0 40%;color:#0f172a;">${escapeHtml(item.primary || '')}</div>
            <div style="flex:1;color:#475569;">${escapeHtml(item.secondary || '')}</div>
            ${item.note ? `<div style="flex:0 0 25%;color:#64748b;font-size:12px;">${escapeHtml(item.note)}</div>` : ''}
          </div>`).join('')}
      </div>`).join('');

    const innerPagesHTML = (d.inner_pages || []).map((p, i) => `
      <div style="margin-bottom:14px;padding:10px;background:#f8fafc;border-radius:6px;">
        <div style="font-weight:600;color:#0f172a;margin-bottom:4px;">P${i + 1} ${escapeHtml(p.page_title || '')}</div>
        ${p.lead ? `<div style="font-size:13px;color:#334155;margin-bottom:6px;">${escapeHtml(p.lead)}</div>` : ''}
        <ul style="margin:0;padding-left:18px;font-size:13px;color:#475569;">
          ${(p.bullets || []).map(b => `<li>${escapeHtml(typeof b === 'string' ? b : (b.text || ''))}</li>`).join('')}
        </ul>
      </div>`).join('');

    blocks.push(`
      <section style="background:white;max-width:800px;margin:0 auto 32px;padding:24px;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
          <h2 style="margin:0;font-size:18px;color:#0f172a;">${idx + 1}. ${escapeHtml(card)} <span style="font-weight:400;color:#64748b;font-size:13px;">/ ${escapeHtml(RENDERER_LABELS[renderer] || renderer)}</span></h2>
        </div>
        ${issueBanner}
        <div style="background:#fef3c7;padding:14px;border-radius:8px;margin-bottom:14px;">
          <div style="font-size:11px;color:#92400e;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">封面标题</div>
          <div style="font-size:22px;font-weight:700;color:#78350f;line-height:1.3;">${escapeHtml(cover.title || '')}</div>
          ${cover.subtitle ? `<div style="font-size:14px;color:#92400e;margin-top:4px;">${escapeHtml(cover.subtitle)}</div>` : ''}
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">封面分组</div>
          ${sectionsHTML || '<div style="color:#94a3b8;font-size:13px;">（无分组数据）</div>'}
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">小红书文字标题（已选）</div>
          <div style="font-size:16px;font-weight:600;color:#0f172a;background:#f1f5f9;padding:8px 12px;border-radius:6px;">${escapeHtml(d.selected_title || '')}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">正文 <span style="color:#94a3b8;">(${(d.caption || '').length}字)</span></div>
          <div style="font-size:14px;color:#1f2937;line-height:1.7;background:#fafaf9;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(d.caption || '')}</div>
        </div>
        <div style="margin-bottom:16px;">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">标签</div>
          <div style="font-size:13px;color:#3b82f6;">${(d.tags || []).map(t => '#' + escapeHtml(t)).join(' ')}</div>
        </div>
        <div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">内页 (${(d.inner_pages || []).length}页)</div>
          ${innerPagesHTML}
        </div>
      </section>`);
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>15 模板验收预览 · DELF B2 写作</title>
  <style>
    body { background:#f3f4f6; margin:0; padding:24px; font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif; color:#0f172a; }
    h1 { text-align:center; max-width:800px; margin:0 auto 8px; font-size:24px; }
    .summary { text-align:center; max-width:800px; margin:0 auto 24px; font-size:13px; color:#64748b; }
  </style>
</head>
<body>
  <h1>15 模板验收预览 · DELF B2 写作</h1>
  <div class="summary">全部 15 张 cover template × 1 篇 = 15 篇可发布文案。每篇含封面、文字标题、正文（260-340字）、标签、内页（4-6张）。</div>
  ${blocks.join('')}
</body>
</html>`;
}

function buildXhsText(jobs) {
  const lines = [];
  lines.push('=== 小红书可发布文案（15 模板验收）===');
  lines.push(`生成时间: ${new Date().toISOString()}`);
  lines.push(`可发布篇数: ${jobs.length}`);
  lines.push('');
  lines.push('说明：');
  lines.push('- 每篇含【标题】【正文】【标签】三段，直接复制粘贴到小红书发布框');
  lines.push('- 封面图需要另外渲染：双击 all-15-preview.html 查看，截图保存');
  lines.push('- 内页图同上，逐页截图作为后续图片');
  lines.push('');
  lines.push('═'.repeat(60));

  for (const [i, { card, renderer, job }] of jobs.entries()) {
    const d = job.draft;
    lines.push('');
    lines.push(`【篇 ${i + 1}】 ${card} (${RENDERER_LABELS[renderer]})`);
    lines.push('─'.repeat(60));
    lines.push('');
    lines.push('▼ 标题（复制到小红书标题框，≤20字）');
    lines.push(d.selected_title);
    lines.push('');
    lines.push('▼ 正文（复制到小红书正文框）');
    lines.push(d.caption);
    lines.push('');
    lines.push('▼ 标签（复制到正文末尾或标签框）');
    lines.push((d.tags || []).join(' '));
    lines.push('');
    lines.push('▼ 封面信息（仅供参考）');
    lines.push(`主标题: ${d.cover.title}`);
    if (d.cover.subtitle) lines.push(`副标题: ${d.cover.subtitle}`);
    lines.push(`内页数: ${d.inner_pages.length} 张`);
    lines.push('');
    lines.push('─'.repeat(60));
  }

  return lines.join('\n');
}

async function main() {
  const cards = Object.keys(SUCCESS_MAP);
  const jobsData = [];
  console.log(`加载 ${cards.length} 个 success jobs...`);

  for (const card of cards) {
    const job = loadJob(card);
    const renderer = CARD_RENDERER[card];
    const issues = auditJob(job);
    jobsData.push({ card, renderer, job, issues });
    const tag = issues.length === 0 ? '✅' : '⚠️';
    console.log(`${tag} ${card} (${renderer}) title="${job.draft.selected_title}" issues=${issues.length === 0 ? 'none' : issues.join(',')}`);
  }

  // 写 HTML 预览
  const html = buildPreviewHTML(jobsData);
  const htmlPath = 'all-15-preview.html';
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log(`\n预览写入 ${htmlPath}`);

  // 写 XHS 文案
  const xhsText = buildXhsText(jobsData);
  const xhsPath = 'all-15-xhs-ready.txt';
  fs.writeFileSync(xhsPath, xhsText, 'utf8');
  console.log(`文案写入 ${xhsPath}`);

  // 写 audit json
  const auditReport = jobsData.map(({ card, renderer, job, issues }) => ({
    card, renderer, issues,
    title: job.draft.selected_title,
    cover_title: job.draft.cover.title,
    cover_subtitle: job.draft.cover.subtitle,
    caption_len: job.draft.caption.length,
    inner_pages: job.draft.inner_pages.length,
  }));
  fs.writeFileSync(`all-15-audit-${Date.now()}.json`, JSON.stringify(auditReport, null, 2));

  // 统计
  const ok = jobsData.filter(j => j.issues.length === 0).length;
  const warn = jobsData.length - ok;
  console.log(`\n========== 验收汇总 ==========`);
  console.log(`总篇数: ${jobsData.length}`);
  console.log(`✅ 无问题: ${ok}`);
  console.log(`⚠️ 有问题待 patch: ${warn}`);
  if (warn > 0) {
    console.log(`\n需 patch 的篇目：`);
    for (const { card, issues } of jobsData.filter(j => j.issues.length > 0)) {
      console.log(`  ${card}: ${issues.join(', ')}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
