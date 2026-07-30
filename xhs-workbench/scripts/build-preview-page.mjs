/* eslint-disable no-console */
/**
 * 读取 P0-2 batch JSON，把全部 20 个 job 的 cover 数据渲染成可视化 HTML。
 * image_to_image job 直接嵌入远程 PNG；code/hybrid job 用 CSS 模拟封面布局。
 *
 * 用法：node scripts/build-preview-page.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BATCH_JSON = 'full-batch-result-1784961102704.json';
const IMAGE_BATCH_JSON = 'image-batch-result-1784958297303.json';
const OUT_HTML = 'tmp-preview-all.html';

const raw = JSON.parse(fs.readFileSync(BATCH_JSON, 'utf8'));
const jobs = raw.jobs;

// 把 image_to_image 模板的 PNG URL 整理一下，P0-1 单独的 batch 也合进来
const imageBatchRaw = JSON.parse(fs.readFileSync(IMAGE_BATCH_JSON, 'utf8'));
const p01Map = new Map(imageBatchRaw.jobs.map(j => [j.reference_card_id, j.cover_image_url]));

const IMAGE_RENDERERS = new Set(['resource_08_book_cover_fle', 'resource_12_delf_vocab_table_overlay', 'resource_13_course_roadmap_blue']);

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function coverToHtml(job) {
  const cover = job.draft?.cover;
  if (!cover) {
    return `<div class="no-cover">（无 cover 数据）</div>`;
  }

  // image_to_image: 直接嵌图
  if (IMAGE_RENDERERS.has(job.reference_card_id) && job.cover_image_url) {
    return `
      <div class="image-cover">
        <img src="${escapeHtml(job.cover_image_url)}" alt="${escapeHtml(job.id)}" loading="lazy">
      </div>`;
  }

  // code / hybrid: 用 CSS 模拟一张封面卡
  const sectionsHtml = (cover.sections || []).map((sec, i) => {
    const itemsHtml = (sec.items || []).map(item => {
      const note = item.note ? ` <span class="note">（${escapeHtml(item.note)}）</span>` : '';
      const sec2 = item.secondary ? ` <span class="sec2">${escapeHtml(item.secondary)}</span>` : '';
      return `<li><span class="primary">${escapeHtml(item.primary)}</span>${sec2}${note}</li>`;
    }).join('');
    return `
      <div class="section">
        <div class="side-label">${escapeHtml(sec.side_label || '')}</div>
        <div class="heading">${escapeHtml(sec.heading || '')}</div>
        <ul class="items">${itemsHtml}</ul>
      </div>`;
  }).join('');

  return `
    <div class="fake-cover">
      <div class="fc-title">${escapeHtml(cover.title || '')}</div>
      ${cover.subtitle ? `<div class="fc-subtitle">${escapeHtml(cover.subtitle)}</div>` : ''}
      <div class="fc-sections">${sectionsHtml}</div>
    </div>`;
}

function statusBadge(job) {
  if (job.status === 'success') return `<span class="badge ok">✓ 成功</span>`;
  return `<span class="badge fail">✗ ${escapeHtml(job.failure?.stage || 'failed')}</span>`;
}

const cardsHtml = jobs.map(job => {
  const card = job.reference_card_id;
  const title = job.draft?.selected_title || '(无标题)';
  const renderer = job.draft?.brief?.content_shape || '(?)';
  const tokens = job.usage?.total_tokens || 0;
  const calls = job.usage?.calls || 0;
  const autofix = job.usage?.autofix_count || 0;
  const attempts = job.attempts || 0;
  const err = job.failure?.message ? `<div class="err">错误：${escapeHtml(job.failure.message).slice(0, 200)}</div>` : '';

  return `
    <div class="card card-${card.includes('image') ? 'image' : 'code'}">
      ${coverToHtml(job)}
      <div class="info">
        <div class="job">${escapeHtml(job.id)} ${statusBadge(job)}</div>
        <div class="title">${escapeHtml(title)}</div>
        <div class="tmpl">${escapeHtml(card)} · ${escapeHtml(renderer)} · attempts=${attempts} · tokens=${tokens} · calls=${calls} · autofix=${autofix}</div>
        ${err}
      </div>
    </div>`;
}).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>P0-2 全部 20 job 预览</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    background: #0f1115; color: #e6e6e6; padding: 24px;
  }
  h1 { font-size: 18px; color: #fff; margin-bottom: 4px; }
  .meta { font-size: 12px; color: #888; margin-bottom: 24px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 20px;
  }
  .card {
    background: #1a1d23; border: 1px solid #262a31;
    border-radius: 8px; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .card img { width: 100%; display: block; background: #fff; }
  .info { padding: 12px 14px; font-size: 13px; line-height: 1.5; }
  .job {
    font-family: ui-monospace, Consolas, monospace;
    color: #9bb2ff; font-size: 11px; margin-bottom: 6px;
    display: flex; align-items: center; gap: 8px;
  }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; }
  .badge.ok { background: #1e3a23; color: #6ee78a; }
  .badge.fail { background: #3a1e1e; color: #ff7b72; }
  .title { color: #fff; font-weight: 500; margin-bottom: 6px; }
  .tmpl { color: #888; font-size: 11px; font-family: ui-monospace, Consolas, monospace; }
  .err { margin-top: 8px; font-size: 11px; color: #ff7b72; }
  .no-cover { padding: 40px 14px; text-align: center; color: #666; font-size: 12px; }

  /* 伪封面：用 CSS 模拟 code/hybrid 模板 */
  .fake-cover {
    background: #fff; color: #222; padding: 16px;
    aspect-ratio: 3 / 4; overflow: hidden;
    display: flex; flex-direction: column; gap: 10px;
    border-bottom: 1px solid #262a31;
  }
  .fc-title {
    font-size: 18px; font-weight: 800; color: #2B547E;
    text-align: center; line-height: 1.3;
  }
  .fc-subtitle {
    font-size: 12px; color: #3F8880; text-align: center;
  }
  .fc-sections {
    display: flex; flex-direction: column; gap: 8px;
    flex: 1; overflow: hidden;
  }
  .section {
    border-left: 3px solid #C1272D; padding: 4px 8px;
    background: #f7f7f7;
  }
  .side-label {
    font-size: 9px; color: #999; letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .heading {
    font-size: 13px; font-weight: 600; color: #2B547E;
    margin: 2px 0 4px;
  }
  .items {
    list-style: none; padding: 0; margin: 0;
    font-size: 11px; line-height: 1.4;
  }
  .items li { color: #333; padding: 1px 0; }
  .primary { font-weight: 600; color: #222; }
  .sec2 { color: #666; margin-left: 4px; }
  .note { color: #888; font-size: 10px; }

  .image-cover { background: #fff; }
</style>
</head>
<body>

<h1>P0-2 全部 20 个 job 预览</h1>
<div class="meta">
  batch ${escapeHtml(raw.batch?.id || '')} · ${jobs.length} 个 job ·
  成功 ${jobs.filter(j => j.status === 'success').length} ·
  失败 ${jobs.filter(j => j.status !== 'success').length} ·
  image_to_image 模板直接显示 PNG；code/hybrid 模板用 CSS 模拟封面布局（仅展示数据结构，实际样式由前端组件决定）
</div>

<div class="grid">
${cardsHtml}
</div>

</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(`written: ${OUT_HTML} (${(html.length / 1024).toFixed(1)} KB)`);
