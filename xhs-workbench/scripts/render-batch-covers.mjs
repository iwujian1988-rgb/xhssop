/* eslint-disable no-console */
/**
 * 把 batch JSON 里所有 job 的 cover 数据，按各自模板的真实 CSS 渲染成 HTML。
 * CSS 抠自 src/components/templates/*ReferenceCoverRenderer.tsx
 *
 * 用法：
 *   node scripts/render-batch-covers.mjs [BATCH_JSON] [IMAGE_BATCH_JSON] [OUT_HTML]
 *
 * 默认（无参数）：商品1 全量 batch + 商品1 image_to_image batch → tmp-preview-rendered.html
 * 商品2 用法：
 *   node scripts/render-batch-covers.mjs \
 *     product2-text-batch.json \
 *     image-batch-product2-result-*.json \
 *     tmp-preview-product2.html
 *
 * 若只传 1 个 JSON（image batch），传空字符串跳过 BATCH_JSON：
 *   node scripts/render-batch-covers.mjs "" image-batch-product2-result-*.json tmp-preview-product2.html
 */
import fs from 'node:fs';

const BATCH_JSON = process.argv[2] !== undefined ? process.argv[2] : 'full-batch-result-1784961102704.json';
const P01_JSON = process.argv[3] !== undefined ? process.argv[3] : 'image-batch-result-1784958297303.json';
const OUT_HTML = process.argv[4] !== undefined ? process.argv[4] : 'tmp-preview-rendered.html';

const RENDERER_BY_CARD = {
  resource_01_grammar_parchment_red: 'parchment_dense_directory',
  resource_02_grammar_white_green: 'white_green_directory',
  resource_03_chalkboard_course: 'blackboard_offer',
  resource_04_chalkboard_phrase_list: 'blackboard_phrase',
  resource_05_grammar_clean_purple: 'clean_purple_directory',
  resource_06_notes_course_offer: 'memo_offer',
  resource_07_question_words_parchment: 'word_flashcard',
  resource_08_book_cover_fle: 'book_cover',
  resource_09_notebook_warning: 'notebook_big_words',
  resource_10_plain_text_experience: 'plain_experience',
  resource_11_delf_doc_analysis: 'document_analysis',
  resource_12_delf_vocab_table_overlay: 'vocab_table',
  resource_13_course_roadmap_blue: 'course_roadmap',
  resource_14_collocation_dense_green: 'collocation_dense',
  resource_15_grammar_grid_purple: 'grid_purple_directory',
};

const IMAGE_RENDERERS = new Set(['book_cover', 'vocab_table', 'course_roadmap', 'collocation_dense']);

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function visualLength(value) {
  return Array.from(value).reduce((sum, ch) => sum + (/[^\x00-\xff]/.test(ch) ? 2 : 1), 0);
}

function splitLabel(value) {
  if (/[\/｜|\n]/.test(value)) return value.split(/[\/｜|\n]/).map(s => s.trim()).filter(Boolean);
  if (value.length <= 2) return [value];
  const m = Math.ceil(value.length / 2);
  return [value.slice(0, m), value.slice(m)];
}

function chineseIndex(i) {
  return ['一', '二', '三', '四', '五', '六', '七'][i - 1] || String(i);
}

function adaptiveColumns(section, max = 2) {
  const longestLatinToken = Math.max(0, ...section.items.flatMap(item =>
    (`${item.primary} ${item.secondary || ''}`.match(/[A-Za-zÀ-ÿ'-]+/g) || []).map(t => t.length)));
  const longestItem = Math.max(...section.items.map(item => `${item.primary}${item.secondary || ''}`.length));
  if (longestLatinToken > 9 || longestItem > 22) return 2;
  return Math.min(section.columns, max);
}

function renderCover(job) {
  const card = job.reference_card_id;
  const renderer = RENDERER_BY_CARD[card];
  const cover = job.draft?.cover;
  if (!cover) return `<div class="no-cover">无 cover 数据</div>`;

  // image_to_image 模板：直接显示 PNG
  if (IMAGE_RENDERERS.has(renderer) && job.cover_image_url) {
    const cachedImage = `tmp-remote-covers/${job.product_id}__${job.reference_card_id}__${job.id}.png`;
    const imageSrc = fs.existsSync(cachedImage) ? cachedImage : job.cover_image_url;
    return `<div class="img-cover"><img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(job.id)}"></div>`;
  }

  const title = cover.title || '';
  const subtitle = cover.subtitle || '';
  const sections = cover.sections || [];

  switch (renderer) {
    case 'parchment_dense_directory': {
      const titleLen = visualLength(title);
      const titleScale = titleLen > 28 ? '4.05cqw' : titleLen > 22 ? '4.48cqw' : titleLen > 17 ? '4.92cqw' : '5.55cqw';
      const sectionCount = Math.max(1, sections.length);
      const sectionsHtml = sections.map((s, i) => `
        <section class="parchment-dense-section">
          <div class="parchment-dense-label">${splitLabel(s.side_label || '').map(l => `<span>${escapeHtml(l)}</span>`).join('')}</div>
          <div class="parchment-dense-body">
            <h2>${chineseIndex(i + 1)}、${escapeHtml(s.heading || '')}</h2>
            <div class="parchment-dense-grid" style="--columns:${adaptiveColumns(s, 2)}">
              ${s.items.map(item => `<div class="parchment-dense-item"><span class="parchment-dense-dot"></span><span class="parchment-dense-copy"><span class="parchment-dense-primary">${escapeHtml(item.primary)}</span>${item.secondary ? `<span class="parchment-dense-secondary">${escapeHtml(item.secondary)}</span>` : ''}</span></div>`).join('')}
            </div>
          </div>
        </section>`).join('');
      return `<article class="parchment-dense-cover" style="--section-count:${sectionCount};--title-scale:${titleScale}">
        <img class="parchment-dense-texture" src="public/generated/parchment_master_clean_01.png" alt="">
        <header class="parchment-dense-header"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</header>
        <div class="parchment-dense-sections">${sectionsHtml}</div>
      </article>`;
    }

    case 'white_green_directory': {
      const titleScale = title.length > 18 ? '6.6cqw' : title.length > 14 ? '7.5cqw' : '8.3cqw';
      const sectionsHtml = sections.map((s, i) => `
        <section class="white-green-section">
          <div class="white-green-label">${splitLabel(s.side_label || '').map(l => `<span>${escapeHtml(l)}</span>`).join('')}</div>
          <div class="white-green-body">
            <h2>${chineseIndex(i + 1)}、${escapeHtml(s.heading || '')}</h2>
            <div class="white-green-grid" style="--columns:${adaptiveColumns(s, 3)}">
              ${s.items.map(item => `<div class="white-green-item"><span class="white-green-dot"></span><span class="white-green-copy"><strong>${escapeHtml(item.primary)}</strong>${item.secondary ? `<span>${escapeHtml(item.secondary)}</span>` : ''}</span></div>`).join('')}
            </div>
          </div>
        </section>`).join('');
      return `<article class="white-green-directory" style="--section-count:${Math.max(1, sections.length)};--title-scale:${titleScale}">
        <header class="white-green-header"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</header>
        <div class="white-green-sections">${sectionsHtml}</div>
      </article>`;
    }

    case 'clean_purple_directory': {
      const sectionsHtml = sections.map(s => `
        <section>
          <h2>${escapeHtml(s.heading || '')}</h2>
          <div class="clean-purple-bracket"><div class="clean-purple-grid" style="--columns:${adaptiveColumns(s, 3)}">
            ${s.items.map(item => `<div class="clean-purple-item"><i></i><span><strong>${escapeHtml(item.primary)}</strong>${item.secondary ? `<em>${escapeHtml(item.secondary)}</em>` : ''}</span></div>`).join('')}
          </div></div>
        </section>`).join('');
      return `<article class="clean-purple-directory" style="--section-count:${Math.max(1, sections.length)}">
        <header><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</header>
        <div class="clean-purple-sections">${sectionsHtml}</div>
        <div class="clean-purple-page">1/5</div>
      </article>`;
    }

    case 'grid_purple_directory': {
      const top4 = sections.slice(0, 4);
      const sectionsHtml = top4.map((s, i) => `
        <section>
          <h2>${chineseIndex(i + 1)}、${escapeHtml(s.heading || '')}</h2>
          <div class="grid-purple-table">
            ${s.items.map(item => `<div><strong>${escapeHtml(item.primary)}</strong>${item.secondary ? `<span>${escapeHtml(item.secondary)}</span>` : ''}</div>`).join('')}
          </div>
        </section>`).join('');
      return `<article class="grid-purple-sheet">
        <div class="grid-purple-tools"><b>╱</b><b>▣</b><b>✎</b><b>⌁</b><i></i><i></i><i></i><i></i><i></i></div>
        <header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></header>
        <div class="grid-purple-sections">${sectionsHtml}</div>
      </article>`;
    }

    case 'blackboard_phrase': {
      const itemCount = sections.reduce((sum, s) => sum + s.items.length, 0);
      const avgLen = sections.flatMap(s => s.items).reduce((sum, item, _, arr) => sum + `${item.primary}${item.secondary || ''}`.length / Math.max(arr.length, 1), 0);
      const bodySize = itemCount > 18 || avgLen > 22 ? '2.75cqw' : itemCount > 15 ? '3.05cqw' : '3.38cqw';
      const titleSize = title.length > 16 ? '7.05cqw' : '7.9cqw';
      const groupsHtml = sections.map(s => `<section><h2>${escapeHtml(s.heading || '')}</h2><div>${s.items.map(x => `<p><b>${escapeHtml(x.primary)}</b><span>${escapeHtml(x.secondary || '')}</span></p>`).join('')}</div></section>`).join('');
      return `<article class="rc-blackboard" style="--chalk-body:${bodySize};--chalk-title:${titleSize}">
        <img src="public/generated/chalkboard_phrase_master_clean_01.png" alt="">
        <header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></header>
        <div class="rc-chalk-groups">${groupsHtml}</div>
      </article>`;
    }

    case 'blackboard_offer': {
      const titleSize = title.length > 18 ? '6.85cqw' : title.length > 13 ? '7.45cqw' : '8.25cqw';
      const groupsHtml = sections.map(s => `<section><h2>${escapeHtml(s.heading || '')}</h2>${s.items.map(x => `<p><b>${escapeHtml(x.primary)}</b>${x.secondary ? `：${escapeHtml(x.secondary)}` : ''}</p>`).join('')}</section>`).join('');
      return `<article class="rc-blackboard rc-offer" style="--offer-title:${titleSize}">
        <img src="public/generated/chalkboard_phrase_master_clean_01.png" alt="">
        <header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></header>
        <div class="rc-offer-groups">${groupsHtml}</div>
      </article>`;
    }

    case 'memo_offer': {
      const sectionsHtml = sections.map(s => `<section><h2>${escapeHtml(s.heading || '')}</h2>${s.items.map(x => `<p><b>${escapeHtml(x.primary)}</b>${x.secondary ? `：${escapeHtml(x.secondary)}` : ''}</p>`).join('')}</section>`).join('');
      return `<article class="rc-memo">
        <div class="rc-memo-status"><b>9:41</b><span>● ◒ ▰</span></div>
        <div class="rc-memo-bar"><span>‹　备忘录</span><span class="rc-memo-actions">⌕　＋　☷</span></div>
        <h1>${escapeHtml(title)}</h1>
        <p class="rc-subtitle">${escapeHtml(subtitle)}</p>
        <div class="rc-memo-sections">${sectionsHtml}</div>
      </article>`;
    }

    case 'word_flashcard': {
      const items = sections.flatMap(s => s.items).slice(0, 9);
      return `<article class="rc-flashcard">
        <img src="public/generated/parchment_master_clean_01.png" alt="">
        <h1>${escapeHtml(title)}</h1>
        <div class="rc-word-grid">${items.map((x, i) => `<div class="${i === 0 ? 'featured' : ''}"><strong>${escapeHtml(x.primary)}</strong><span>${escapeHtml(x.secondary || '')}</span><em>${escapeHtml(x.note || '')}</em></div>`).join('')}</div>
      </article>`;
    }

    case 'notebook_big_words': {
      const lines = [subtitle, title, ...sections.map(s => s.items[0]?.primary || s.heading)].filter(Boolean).slice(0, 5);
      return `<article class="rc-notebook">
        <img src="public/generated/notebook_paper_master_clean_02.png" alt="">
        <div class="rc-notebook-lines">${lines.map((line, i) => `<div class="${i === 1 ? 'big' : ''}"><span>${escapeHtml(line)}</span></div>`).join('')}</div>
      </article>`;
    }

    case 'plain_experience': {
      const paragraphs = sections.slice(0, 2).map(s => s.items.map(item => `${item.primary}${item.secondary ? `，${item.secondary}` : ''}`).join('。'));
      const titleSize = title.length > 16 ? '6.4cqw' : '8.2cqw';
      return `<article class="rc-experience" style="--exp-title:${titleSize}">
        <div class="rc-rule"></div>
        <h1>${escapeHtml(title)}</h1>
        <p class="rc-experience-lead">${escapeHtml(subtitle)}</p>
        <div class="rc-experience-body">${paragraphs.map(p => `<p class="rc-experience-paragraph">${escapeHtml(p)}。</p>`).join('')}</div>
      </article>`;
    }

    case 'document_analysis': {
      const sectionsHtml = sections.map((s, i) => `<section><h2>${i === 0 ? '题目' : escapeHtml(s.heading || '')}</h2><p>${s.items.map((x, j) => `<span class="${/[A-Za-zÀ-ÿ]{8}/.test(x.primary) ? 'fr' : ''}">${escapeHtml(x.primary)}${x.secondary ? `　${escapeHtml(x.secondary)}` : ''}${j < s.items.length - 1 ? '。' : ''}</span>`).join('')}</p></section>`).join('');
      return `<article class="rc-document">
        <div class="rc-doc-frame">
          <h1>${escapeHtml(title)}</h1>
          <div class="rc-doc-subject">${escapeHtml(subtitle)}</div>
          <div class="rc-doc-meta"><span>≡　编号</span><b>范例 01</b></div>
          <div class="rc-doc-content">${sectionsHtml}</div>
          <footer>${escapeHtml(subtitle)} · DELF B2 写作素材页 <span>1</span></footer>
        </div>
      </article>`;
    }

    case 'collocation_dense': {
      const cols = [sections.slice(0, 2), sections.slice(2, 4), sections.slice(4, 6)];
      const colsHtml = cols.map(group => `<div>${group.map(s => `<section><h2>${escapeHtml(s.heading || '')}</h2>${s.items.map(x => `<p><b>${escapeHtml(x.primary)}</b><span>${escapeHtml(x.secondary || '')}</span></p>`).join('')}</section>`).join('')}</div>`).join('');
      return `<article class="rc-collocation">
        <h1>${escapeHtml(title)}</h1>
        <p class="rc-collocation-sub">${escapeHtml(subtitle)}</p>
        <div class="rc-collocation-cols">${colsHtml}</div>
      </article>`;
    }

    default:
      return `<div class="no-cover">未实现的 renderer: ${escapeHtml(renderer)}</div>`;
  }
}

// 加载 batch JSON（任一缺失时跳过，便于纯 image-batch 渲染）
const allJobs = [];
const seen = new Set();

if (P01_JSON && fs.existsSync(P01_JSON)) {
  const p01 = JSON.parse(fs.readFileSync(P01_JSON, 'utf8'));
  for (const j of p01.jobs || []) {
    const key = `${j.reference_card_id}|${j.topic?.topic}`;
    if (!seen.has(key)) {
      seen.add(key);
      allJobs.push({ ...j, _source: 'P0-1' });
    }
  }
}
if (BATCH_JSON && fs.existsSync(BATCH_JSON)) {
  const batch = JSON.parse(fs.readFileSync(BATCH_JSON, 'utf8'));
  for (const j of batch.jobs || []) {
    const key = `${j.reference_card_id}|${j.topic?.topic}`;
    if (!seen.has(key)) {
      seen.add(key);
      allJobs.push({ ...j, _source: 'P0-2' });
    }
  }
}

if (allJobs.length === 0) {
  console.error(`没有读到任何 job。BATCH_JSON=${BATCH_JSON} P01_JSON=${P01_JSON}`);
  process.exit(1);
}


// 按 card 分组，方便用户对比同模板不同选题
const byCard = new Map();
for (const j of allJobs) {
  if (!byCard.has(j.reference_card_id)) byCard.set(j.reference_card_id, []);
  byCard.get(j.reference_card_id).push(j);
}

// 模板显示顺序：按 card id 排
const cardOrder = [...byCard.keys()].sort();

const cardsHtml = cardOrder.map(cardId => {
  const jobs = byCard.get(cardId);
  const cards = jobs.map(job => {
    const status = job.status === 'success'
      ? `<span class="badge ok">✓ 成功</span>`
      : `<span class="badge fail">✗ ${escapeHtml(job.failure?.stage || 'failed')}</span>`;
    const err = job.failure?.message ? `<div class="err">${escapeHtml(job.failure.message).slice(0, 200)}</div>` : '';
    return `
      <div class="cell" data-product="${escapeHtml(job.product_id || '')}" data-card="${escapeHtml(cardId)}" data-job="${escapeHtml(job.id)}">
        <div class="cover-wrap">${renderCover(job)}</div>
        <div class="info">
          <div class="job">${escapeHtml(job.id)} <span class="src">${escapeHtml(job._source)}</span> ${status}</div>
          <div class="title">${escapeHtml(job.draft?.selected_title || '(无标题)')}</div>
          <div class="meta">${escapeHtml(job.product_id || '?')} · ${escapeHtml(cardId)} · ${escapeHtml(RENDERER_BY_CARD[cardId] || '?')}</div>
          ${err}
        </div>
      </div>`;
  }).join('');

  return `
    <section class="card-group">
      <h2>${escapeHtml(cardId)} <span class="count">${jobs.length} 个成品</span></h2>
      <div class="row">${cards}</div>
    </section>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>12 种模板的成品渲染</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
    background: #0f1115; color: #e6e6e6; padding: 24px;
  }
  h1 { font-size: 18px; color: #fff; margin-bottom: 4px; }
  .lead { font-size: 12px; color: #888; margin-bottom: 24px; line-height: 1.6; }

  .card-group { margin-bottom: 40px; }
  .card-group h2 {
    font-size: 14px; color: #9bb2ff; margin-bottom: 12px;
    padding-bottom: 6px; border-bottom: 1px solid #2a2d33;
  }
  .count { color: #666; font-weight: normal; font-size: 11px; margin-left: 8px; }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
  }
  .cell {
    background: #1a1d23; border: 1px solid #262a31;
    border-radius: 8px; overflow: hidden;
    display: flex; flex-direction: column;
  }
  .cover-wrap {
    width: 100%; background: #fff; position: relative;
    /* 给个固定宽度让 container query 生效 */
  }
  .img-cover img { width: 100%; display: block; }
  .no-cover { padding: 40px 14px; text-align: center; color: #666; font-size: 12px; }
  .info { padding: 12px 14px; font-size: 13px; line-height: 1.5; }
  .job {
    font-family: ui-monospace, Consolas, monospace;
    color: #9bb2ff; font-size: 11px; margin-bottom: 6px;
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  }
  .src {
    background: #262a31; color: #aaa; padding: 1px 5px;
    border-radius: 2px; font-size: 10px;
  }
  .badge { font-size: 10px; padding: 2px 6px; border-radius: 3px; }
  .badge.ok { background: #1e3a23; color: #6ee78a; }
  .badge.fail { background: #3a1e1e; color: #ff7b72; }
  .title { color: #fff; font-weight: 500; margin-bottom: 4px; }
  .meta { color: #888; font-size: 11px; font-family: ui-monospace, Consolas, monospace; }
  .err { margin-top: 6px; font-size: 11px; color: #ff7b72; }

  /* ===== 模板 CSS（抠自 src/components/templates/）===== */

  /* ParchmentDenseCover */
  .parchment-dense-cover {
    position: relative; isolation: isolate; width: 100%;
    aspect-ratio: 3 / 4; overflow: hidden;
    border: 1px solid #b68f63; border-radius: 8px;
    background: #e9d1a6;
    box-shadow: 0 24px 55px rgba(74, 43, 22, .26);
    color: #54251e; container-type: inline-size;
    font-family: "Noto Serif SC", "STSong", serif;
  }
  .parchment-dense-cover::after {
    content: ""; position: absolute; inset: 0; z-index: -1;
    pointer-events: none;
    background:
      radial-gradient(circle at 76% 9%, rgba(255,247,216,.32), transparent 31%),
      linear-gradient(103deg, rgba(69,29,15,.07), transparent 18%, transparent 73%, rgba(93,48,25,.08));
    mix-blend-mode: multiply;
  }
  .parchment-dense-texture {
    position: absolute; inset: 0; z-index: -2;
    width: 100%; height: 100%; object-fit: cover;
  }
  .parchment-dense-header {
    position: relative; height: 14.2%;
    padding: 2.7cqw 4.8cqw 1cqw; text-align: center;
  }
  .parchment-dense-header h1 {
    margin: 0; color: #76241c;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: clamp(30px, var(--title-scale), 58px);
    font-weight: 900; line-height: 1.02;
    white-space: nowrap;
    text-shadow: 0 1px 0 rgba(255,239,204,.45);
  }
  .parchment-dense-header p {
    margin: 1.05cqw 0 0; color: #8e5d43;
    font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: clamp(12px, 1.95cqw, 18px); font-weight: 700; line-height: 1.12;
  }
  .parchment-dense-sections {
    position: relative; display: flex; flex-direction: column;
    justify-content: space-between; height: 85.8%;
    padding: 0 4.8cqw 2.7cqw; overflow: hidden;
  }
  .parchment-dense-section {
    display: grid; flex-shrink: 0;
    grid-template-columns: 10.8cqw minmax(0, 1fr);
  }
  .parchment-dense-label {
    display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: .25cqw;
    border-right: .18cqw solid rgba(105,36,28,.7);
    color: #3e3028;
    font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: clamp(15px, 2.5cqw, 23px);
    font-weight: 800; line-height: 1.08; text-align: center;
  }
  .parchment-dense-body {
    display: flex; min-width: 0; min-height: 0; flex-direction: column;
    justify-content: flex-start;
    padding: .28cqw 0 .28cqw 2.35cqw;
  }
  .parchment-dense-body h2 {
    margin: 0 0 .55cqw; overflow: hidden; color: #9b3328;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: clamp(15px, 2.7cqw, 26px);
    font-weight: 800; line-height: 1.08; text-align: center;
    text-overflow: ellipsis; white-space: nowrap;
  }
  .parchment-dense-grid {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    column-gap: 1.75cqw; row-gap: .28cqw; min-width: 0;
  }
  .parchment-dense-item {
    display: grid; grid-template-columns: .88cqw minmax(0, 1fr);
    align-items: start; min-width: 0; overflow: hidden;
    color: #2f2925;
    font-family: "Noto Serif SC", "STSong", serif;
    font-size: clamp(12px, 2.42cqw, 22px);
    font-weight: 800; line-height: 1.06; white-space: normal;
  }
  .parchment-dense-dot {
    width: .54cqw; height: .54cqw; border-radius: 50%;
    background: #78271e; margin-top: .5cqw;
  }
  .parchment-dense-copy {
    display: flex; min-width: 0; flex-direction: column; gap: .1cqw;
  }
  .parchment-dense-primary {
    overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    color: #302824; font-weight: 800;
  }
  .parchment-dense-secondary {
    overflow: hidden; display: -webkit-box;
    -webkit-line-clamp: 1; -webkit-box-orient: vertical;
    color: #a33d30; font-family: Georgia, "Noto Serif SC", serif;
    font-size: .9em; font-weight: 700;
  }

  /* WhiteGreenDirectoryCover */
  .white-green-directory {
    position: relative; width: 100%; aspect-ratio: 3 / 4; overflow: hidden;
    border: 1px solid #dfe8df; border-radius: 2px;
    background:
      radial-gradient(circle at 24% 18%, rgba(255,255,255,.9), transparent 28%),
      repeating-radial-gradient(circle at 30% 20%, rgba(20,90,45,.045) 0 1px, transparent 1px 4px),
      linear-gradient(180deg, #fafcf9 0%, #edf3ee 48%, #f7faf6 100%);
    box-shadow: 0 22px 50px rgba(20,32,22,.22);
    color: #087a2d; container-type: inline-size;
    font-family: "Noto Serif SC", "STSong", serif;
  }
  .white-green-directory::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background:
      linear-gradient(90deg, rgba(255,255,255,.38), transparent 15%, transparent 84%, rgba(0,0,0,.035)),
      repeating-linear-gradient(115deg, rgba(14,93,43,.026) 0 1px, transparent 1px 5px);
    mix-blend-mode: multiply;
  }
  .white-green-header { position: relative; z-index: 1; padding: 3.2cqw 4.5cqw 1.35cqw; text-align: center; }
  .white-green-header h1 {
    margin: 0; color: #07852e;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: clamp(30px, var(--title-scale), 68px);
    font-weight: 900; line-height: 1.02;
    text-shadow: 0 1px 0 rgba(255,255,255,.75), 0 .16cqw .12cqw rgba(9,89,37,.1);
  }
  .white-green-header p {
    margin: .9cqw 0 0; color: #47975d;
    font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: clamp(13px, 2.15cqw, 19px); font-weight: 800; line-height: 1.15;
  }
  .white-green-sections {
    position: relative; z-index: 1;
    display: flex; flex-direction: column; justify-content: space-between;
    height: 87.6%; padding: 0 4.5cqw 3cqw 2.3cqw; overflow: hidden;
  }
  .white-green-section {
    display: grid; flex-shrink: 0;
    grid-template-columns: 10.7cqw minmax(0, 1fr);
  }
  .white-green-label {
    position: relative; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    color: #315e3f; font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: clamp(13px, 2.4cqw, 21px); font-weight: 800; line-height: 1.08; text-align: center;
  }
  .white-green-label::after {
    content: ""; position: absolute; top: 14%; right: .6cqw;
    width: 1.15cqw; height: 72%;
    border-top: .25cqw solid #07852e; border-right: .25cqw solid #07852e; border-bottom: .25cqw solid #07852e;
  }
  .white-green-body {
    display: flex; min-width: 0; min-height: 0; flex-direction: column;
    justify-content: flex-start; padding: .25cqw 0 .35cqw 1.8cqw;
  }
  .white-green-body h2 {
    margin: 0 0 .65cqw; overflow: hidden; color: #0b7731;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: clamp(14px, 3.1cqw, 27px); font-weight: 900; line-height: 1.05;
    text-align: center; text-overflow: ellipsis; white-space: nowrap;
  }
  .white-green-grid {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    column-gap: 1.65cqw; row-gap: .35cqw; min-width: 0;
  }
  .white-green-item {
    display: grid; grid-template-columns: .85cqw minmax(0, 1fr);
    align-items: start; min-width: 0; overflow: hidden;
    font-size: clamp(10.5px, 2.15cqw, 19px); font-weight: 700; line-height: 1.08;
  }
  .white-green-dot { width: .52cqw; height: .52cqw; margin-top: .48cqw; border-radius: 50%; background: #07852e; }
  .white-green-copy { display: flex; min-width: 0; flex-direction: column; gap: .08cqw; }
  .white-green-copy strong {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    color: #174b29; font-family: Georgia, "Noto Serif SC", serif; font-weight: 800;
  }
  .white-green-copy span {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
    color: #4f8d60; font-size: .9em; font-weight: 700;
  }

  /* PurpleDirectoryCover - clean */
  .clean-purple-directory {
    position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden;
    border: 1px solid #e5dfeb; background: #fff;
    box-shadow: 0 22px 50px rgba(45,25,55,.18);
    color: #673287; container-type: inline-size;
    font-family: "Noto Serif SC", "STSong", serif;
  }
  .clean-purple-directory * { box-sizing: border-box; min-width: 0; }
  .clean-purple-directory header { padding: 3.2cqw 5.2cqw 1.2cqw; text-align: center; }
  .clean-purple-directory h1 {
    margin: 0; color: #68308a;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: 6.6cqw; font-weight: 900; line-height: 1; white-space: nowrap;
  }
  .clean-purple-directory header p {
    margin: .75cqw 0 0; color: #9d426c;
    font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: 2.05cqw; font-weight: 800;
  }
  .clean-purple-sections {
    display: flex; flex-direction: column; justify-content: space-between;
    height: 88%; padding: 0 5.6cqw 3.6cqw; overflow: hidden;
  }
  .clean-purple-sections section { display: flex; flex-shrink: 0; flex-direction: column; justify-content: flex-start; }
  .clean-purple-sections h2 {
    margin: 0 0 .85cqw; color: #71318d;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: clamp(13px, 3.3cqw, 26px); font-weight: 900; line-height: 1.05;
  }
  .clean-purple-bracket {
    position: relative; margin-left: 6.1cqw; padding: 1.15cqw 0 1.15cqw 3cqw;
  }
  .clean-purple-bracket:before {
    content: ""; position: absolute; top: .4cqw; bottom: .4cqw; left: 0; width: 1.35cqw;
    border-top: .32cqw solid #73318f; border-bottom: .32cqw solid #73318f; border-left: .32cqw solid #73318f;
  }
  .clean-purple-grid {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    column-gap: 2cqw; row-gap: .82cqw;
  }
  .clean-purple-item {
    display: grid; grid-template-columns: 1.3cqw minmax(0,1fr);
    align-items: start; overflow: hidden;
    font-size: clamp(11px, 3cqw, 24px); font-weight: 700; line-height: 1.12;
  }
  .clean-purple-item i {
    width: .78cqw; height: .78cqw; margin-top: .48cqw;
    border-radius: 50%; background: #77318f;
  }
  .clean-purple-item span { display: flex; overflow: hidden; flex-direction: column; gap: .1cqw; min-width: 0; }
  .clean-purple-item strong {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    color: #9f426c; font-family: Georgia, "Noto Serif SC", serif; font-weight: 700;
  }
  .clean-purple-item em {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
    margin-left: 0; color: #673287;
    font-family: "Noto Serif SC", "STSong", serif;
    font-size: .88em; font-style: normal; font-weight: 800;
  }
  .clean-purple-page {
    position: absolute; top: -1.1cqw; right: -1.1cqw;
    display: grid; width: 6.3cqw; height: 6.3cqw; place-items: center;
    border-radius: 50%; background: rgba(105,105,105,.72);
    color: #fff; font: 800 2.1cqw Arial, sans-serif;
  }

  /* PurpleDirectoryCover - grid */
  .grid-purple-sheet {
    position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden;
    border: 1px solid #d9d2e0; background-color: #fbfaf0;
    background-image:
      linear-gradient(rgba(117,80,145,.12) 1px, transparent 1px),
      linear-gradient(90deg, rgba(117,80,145,.12) 1px, transparent 1px);
    background-size: 3.8cqw 3.8cqw;
    box-shadow: 0 22px 50px rgba(50,30,70,.2);
    color: #3e2d49; container-type: inline-size;
    font-family: "Noto Serif SC", "STSong", serif;
  }
  .grid-purple-sheet * { box-sizing: border-box; min-width: 0; }
  .grid-purple-sheet header {
    padding: 3.2cqw 3.5cqw 1.2cqw 8.5cqw; text-align: center;
  }
  .grid-purple-sheet h1 {
    margin: 0; color: #5d2a86;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    font-size: 7.5cqw; font-weight: 900; line-height: 1;
  }
  .grid-purple-sheet header p {
    margin: .8cqw 0 0; color: #a34b76;
    font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
    font-size: 2.45cqw; font-weight: 800;
  }
  .grid-purple-sections {
    display: flex; flex-direction: column; justify-content: space-between;
    height: 84.5%; padding: 0 3.5cqw 2.5cqw 8.5cqw; overflow: hidden;
  }
  .grid-purple-sections section {
    display: flex; flex-shrink: 0; flex-direction: column; justify-content: flex-start;
  }
  .grid-purple-sections h2 {
    margin: 0 0 .65cqw; color: #713184;
    font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
    text-align: left; font-size: clamp(13px, 3.1cqw, 25px); line-height: 1.05;
  }
  .grid-purple-table {
    display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
    border-top: .18cqw solid #70458e; border-left: .18cqw solid #70458e;
    background: rgba(255,255,255,.66);
  }
  .grid-purple-sections section:nth-child(n+3) .grid-purple-table {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid-purple-table > div {
    display: flex; min-height: 4.2cqw; align-items: center; gap: .4cqw;
    padding: .35cqw .7cqw; border-right: .18cqw solid #70458e;
    border-bottom: .18cqw solid #70458e; overflow: hidden; flex-wrap: wrap;
    color: #3e2949; font-size: clamp(10px, 2.15cqw, 17px); line-height: 1.12;
  }
  .grid-purple-table strong {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    color: #3e2949; font-weight: 850;
  }
  .grid-purple-table span {
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
    color: #a84572; font-size: .85em; font-weight: 800;
  }
  .grid-purple-tools {
    position: absolute; top: 0; bottom: 0; left: 0; display: flex;
    width: 6.4cqw; flex-direction: column; align-items: center; gap: 3.2cqw;
    padding-top: 5cqw; border-right: .12cqw solid rgba(105,65,139,.16);
    background: rgba(255,255,255,.52); color: #5b5261; font-family: Arial, sans-serif;
  }
  .grid-purple-tools b { font-size: 2.4cqw; font-weight: 500; }
  .grid-purple-tools i { width: 2.25cqw; height: 2.25cqw; border-radius: 50%; background: #62c5d8; }
  .grid-purple-tools i:nth-of-type(2) { background: #1fa9dc; }
  .grid-purple-tools i:nth-of-type(3) { background: #ffd94c; }
  .grid-purple-tools i:nth-of-type(4) { background: #e8ad62; }
  .grid-purple-tools i:nth-of-type(5) { background: #222; }

  /* BlackboardPhrase / BlackboardOffer / MemoOffer / WordFlashcard / Notebook / Plain / Document / Vocab / Roadmap / Collocation */
  .rc-blackboard { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; color: #fff; font-family: "Noto Sans SC","Microsoft YaHei",sans-serif; }
  .rc-blackboard img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .rc-blackboard:after { content: ""; position: absolute; inset: 0; background: rgba(0,35,20,.12); }
  .rc-blackboard header, .rc-chalk-groups, .rc-offer-groups { position: relative; z-index: 1; }
  .rc-blackboard header { padding: 4.1cqw 4.8cqw 1.15cqw; text-align: center; }
  .rc-blackboard header h1 { font-family: "STXinwei","FZShuTi",serif; font-size: var(--chalk-title); font-weight: 500; line-height: 1.03; }
  .rc-blackboard header p { margin-top: 1cqw; color: #ffd84a; font-size: 3.25cqw; font-weight: 850; }
  .rc-chalk-groups { display: grid; grid-template-columns: repeat(2,1fr); gap: 3.4cqw; height: 78.5%; padding: 1.45cqw 4.9cqw 2.7cqw; }
  .rc-chalk-groups section { display: flex; min-height: 0; flex-direction: column; }
  .rc-chalk-groups h2 { display: inline-block; align-self: flex-start; margin-bottom: .85cqw; border-bottom: .45cqw solid #f7c52e; font-family: "Source Han Serif SC Heavy","Noto Serif SC",serif; font-size: 3.85cqw; line-height: 1.03; }
  .rc-chalk-groups section>div { display: flex; min-height: 0; flex: 1; flex-direction: column; justify-content: space-evenly; }
  .rc-chalk-groups p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; padding: .32cqw 0; border-bottom: .12cqw dashed rgba(255,255,255,.3); font-size: var(--chalk-body); line-height: 1.08; white-space: normal; }
  .rc-chalk-groups b { font-family: Georgia,"Noto Serif SC",serif; }
  .rc-chalk-groups span { margin-left: .5cqw; color: #f4e8bc; font-size: .88em; }
  .rc-offer header { padding-bottom: .6cqw; }
  .rc-offer header h1 { font-size: var(--offer-title); }
  .rc-offer-groups { display: flex; flex-direction: column; justify-content: space-between; height: 72.5%; padding: .55cqw 6.4cqw 2.7cqw; overflow: hidden; }
  .rc-offer-groups section { display: flex; flex-shrink: 0; flex-direction: column; justify-content: flex-start; padding-bottom: .35cqw; border-bottom: .16cqw dashed rgba(255,255,255,.34); }
  .rc-offer-groups h2 { align-self: flex-start; padding: .45cqw 1.15cqw; background: #f1c735; color: #173c2c; font-family: "Source Han Serif SC Heavy","Noto Serif SC",serif; font-size: clamp(15px, 3.75cqw, 31px); line-height: 1.08; }
  .rc-offer-groups p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; margin-top: .75cqw; font-size: clamp(13px, 3.48cqw, 29px); font-weight: 650; line-height: 1.18; white-space: normal; }
  .rc-offer-groups p b { color: #fff; font-weight: 900; }

  .rc-memo { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; display: flex; flex-direction: column; height: 100%; padding: 1.8% 4.2% 4%; background: #fff; color: #171717; font-family: "Noto Sans SC","Microsoft YaHei",sans-serif; }
  .rc-memo-status { flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 .4cqw; color: #111; font-size: 2.75cqw; font-weight: 800; }
  .rc-memo-bar { flex: none; display: flex; align-items: center; justify-content: space-between; margin-top: 1.9cqw; color: #c4a800; font-size: 4.65cqw; font-weight: 650; line-height: 1; }
  .rc-memo-actions { font-family: Arial,"Noto Sans SC",sans-serif; font-size: 4.35cqw; letter-spacing: .08em; }
  .rc-memo>h1 { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: none; margin-top: 3.8cqw; color: #181818; text-align: center; font-size: clamp(54px, 11.5cqw, 96px); font-weight: 950; line-height: 1.02; white-space: normal; overflow-wrap: anywhere; }
  .rc-subtitle { flex: none; margin-top: 1.2cqw; text-align: center; color: #6b6b6b; font-size: 3.35cqw; font-weight: 600; }
  .rc-memo-sections { flex: 1 1 auto; min-height: 0; overflow: hidden; margin-top: 3.1cqw; }
  .rc-memo-sections section { margin-bottom: 4.1cqw; }
  .rc-memo-sections h2 { display: inline-block; padding: .35cqw .85cqw; background: #ffdc62; font-size: clamp(14px, 4.55cqw, 34px); font-weight: 900; line-height: 1.12; }
  .rc-memo-sections p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-top: 1.15cqw; font-size: clamp(11px, 3.95cqw, 30px); font-weight: 500; line-height: 1.42; white-space: normal; }
  .rc-memo-sections b { font-weight: 850; }

  .rc-flashcard { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; background: #d9bd8e; }
  .rc-flashcard img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .rc-flashcard:after { content: ""; position: absolute; z-index: 1; top: 14.2%; right: 4%; left: 4%; height: .22cqw; background: #55483d; }
  .rc-flashcard>h1 { position: absolute; z-index: 2; top: 4.8%; left: 4%; right: 4%; color: #18130e; text-align: center; font-family: "Source Han Serif SC Heavy","Noto Serif SC",serif; font-size: 5.65cqw; line-height: 1.1; }
  .rc-word-grid { position: absolute; z-index: 2; top: 18%; right: 5%; bottom: 5%; left: 5%; display: grid; grid-template-columns: repeat(3,1fr); grid-template-rows: repeat(3,1fr); column-gap: 2cqw; overflow: hidden; }
  .rc-word-grid div { display: flex; position: relative; overflow: hidden; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  .rc-word-grid div.featured:before { content: ""; position: absolute; inset: 11% 4%; border: .32cqw dashed #d33124; border-radius: 1.2cqw; }
  .rc-word-grid strong { display: block; position: relative; max-width: 100%; overflow: hidden; font-family: Georgia,"Noto Serif SC",serif; font-size: clamp(14px, 6.25cqw, 50px); font-weight: 500; line-height: 1.05; text-overflow: ellipsis; white-space: nowrap; }
  .rc-word-grid span { display: block; position: relative; margin-top: 1.05cqw; color: #a32019; font-family: "Source Han Serif SC Heavy","Noto Serif SC",serif; font-size: clamp(9px, 3.05cqw, 24px); font-weight: 900; }
  .rc-word-grid em { position: relative; margin-top: .65cqw; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; color: #211a15; font-family: "Noto Serif SC","STSong",serif; font-size: clamp(8px, 2.55cqw, 20px); font-style: normal; }

  .rc-notebook { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; background: #d5cdb7; }
  .rc-notebook img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .rc-notebook-lines { position: absolute; left: 24%; right: 0; top: 14.7%; bottom: 6%; display: grid; grid-template-rows: .85fr 1.7fr .85fr .85fr .85fr; overflow: hidden; font-family: "LXGW WenKai","KaiTi",cursive; }
  .rc-notebook-lines>div { display: flex; overflow: hidden; min-width: 0; align-items: flex-end; border-bottom: .24cqw solid #29231d; padding: 0 2.2cqw 1.18cqw; transform-origin: left bottom; }
  .rc-notebook-lines>div:nth-child(2) { transform: rotate(-.35deg); }
  .rc-notebook-lines>div:nth-child(3) { transform: rotate(.22deg); }
  .rc-notebook-lines>div:nth-child(4) { transform: rotate(-.18deg); }
  .rc-notebook-lines>div:nth-child(5) { transform: rotate(.28deg); }
  .rc-notebook-lines span { display: block; max-width: 100%; overflow: hidden; color: #17130f; font-size: clamp(12px, 4.65cqw, 37px); font-weight: 500; line-height: 1.02; letter-spacing: .035em; text-overflow: ellipsis; text-shadow: .02em .02em 0 rgba(20,15,10,.14); white-space: nowrap; }
  .rc-notebook-lines .big { align-items: center; }
  .rc-notebook-lines .big span { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: clamp(16px, 6.4cqw, 51px); font-weight: 500; line-height: 1.14; white-space: normal; }

  .rc-experience { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; display: flex; overflow: hidden; height: 100%; flex-direction: column; padding: 6.2cqw 6.4cqw; background: #fff; color: #161616; font-family: "PingFang SC","Microsoft YaHei",sans-serif; }
  .rc-rule { flex: 0 0 auto; height: .18cqw; margin-top: 8cqw; background: #aaa; }
  .rc-experience h1 { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 0 0 auto; margin-top: 5.4cqw; color: #161616; font-size: var(--exp-title, 8.2cqw); font-weight: 950; line-height: 1.22; text-decoration: underline; text-decoration-thickness: .35cqw; text-underline-offset: 1.1cqw; }
  .rc-experience-lead { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 0 0 auto; margin-top: 8.5cqw; color: #242424; font-size: 4.25cqw; font-weight: 500; line-height: 1.6; }
  .rc-experience-body { display: flex; overflow: hidden; flex: 1 1 auto; flex-direction: column; justify-content: space-between; min-height: 0; color: #171717; }
  .rc-experience-paragraph { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 6; -webkit-box-orient: vertical; flex-shrink: 0; margin-top: 5cqw; color: #171717; font-size: clamp(12px, 4.5cqw, 36px); line-height: 1.68; }

  .rc-document { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; padding: 6.5% 7% 4.5%; background: #fff; color: #111; font-family: Arial,"Noto Sans SC","Microsoft YaHei",sans-serif; }
  .rc-doc-frame { position: relative; overflow: hidden; display: flex; height: 100%; flex-direction: column; padding: 0 7cqw 5.5cqw; border: .35cqw solid #111; }
  .rc-doc-frame:before, .rc-doc-frame:after { content: ""; position: absolute; top: -.35cqw; width: 5.5cqw; height: 3.2cqw; border-top: .9cqw solid #111; }
  .rc-doc-frame:before { left: -.35cqw; border-left: .9cqw solid #111; }
  .rc-doc-frame:after { right: -.35cqw; border-right: .9cqw solid #111; }
  .rc-doc-frame h1 { overflow: visible; margin-top: -1.1cqw; padding: .4cqw 1.7cqw 0; background: #fff; color: #cf2137; text-align: center; font-family: "Source Han Serif SC Heavy","Noto Sans SC",sans-serif; font-size: 5.65cqw; font-weight: 900; line-height: 1.08; text-overflow: ellipsis; white-space: nowrap; }
  .rc-doc-subject { margin-top: 5.4cqw; font-size: 4.2cqw; font-weight: 900; line-height: 1.12; text-transform: uppercase; }
  .rc-doc-meta { display: flex; width: max-content; margin-top: 3.6cqw; border: 1px solid #e5e5e5; color: #777; font-size: 1.85cqw; }
  .rc-doc-meta span, .rc-doc-meta b { padding: .55cqw .8cqw; }
  .rc-doc-meta b { border-left: 1px solid #e5e5e5; color: #333; }
  .rc-doc-content { display: flex; overflow: hidden; flex: 1 1 auto; flex-direction: column; justify-content: space-between; min-height: 0; margin-top: 2.4cqw; }
  .rc-doc-content section { overflow: hidden; flex-shrink: 0; margin-top: 1.4cqw; }
  .rc-doc-content h2 { overflow: hidden; font-size: clamp(9px, 2.5cqw, 20px); font-weight: 900; white-space: nowrap; }
  .rc-doc-content p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; margin-top: .5cqw; font-family: "Noto Sans SC","Microsoft YaHei",sans-serif; font-size: clamp(9px, 3.1cqw, 25px); font-weight: 450; line-height: 1.34; }
  .rc-doc-content p span { display: inline; }
  .rc-doc-content .fr { font-family: Arial,Georgia,sans-serif; }
  .rc-doc-frame footer { position: relative; flex: 0 0 auto; display: flex; justify-content: space-between; margin-top: .9cqw; border-top: .12cqw solid #ddd; padding-top: .9cqw; color: #777; font-size: 1.35cqw; }

  .rc-roadmap { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; padding: 4cqw; background: #eaf4ff; color: #174e87; font-family: "Microsoft YaHei",sans-serif; }
  .rc-roadmap header { text-align: center; }
  .rc-roadmap header h1 { overflow: hidden; font-size: 6.2cqw; white-space: nowrap; }
  .rc-roadmap header p { overflow: hidden; font-size: 2.5cqw; white-space: nowrap; }
  .rc-roadmap-grid { display: grid; grid-template-columns: repeat(2,1fr); grid-template-rows: repeat(2,1fr); gap: 2.5cqw; height: 78%; margin-top: 4cqw; }
  .rc-roadmap-grid section { position: relative; display: flex; overflow: hidden; flex-direction: column; min-height: 0; padding: 5cqw 2.5cqw 2cqw; border: .3cqw solid #2668a6; border-radius: 1.3cqw; background: #fff; }
  .rc-roadmap-grid strong { position: absolute; top: -2.3cqw; right: 2cqw; color: #9bc5e8; font-size: 6cqw; }
  .rc-roadmap-grid h2 { overflow: hidden; flex: 0 0 auto; font-size: 3.2cqw; white-space: nowrap; text-overflow: ellipsis; }
  .rc-roadmap-grid p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 0 0 auto; margin-top: 2cqw; font-size: var(--roadmap-body, 2.45cqw); line-height: 1.3; white-space: normal; }

  .rc-collocation { position: relative; width: 100%; aspect-ratio: 3/4; overflow: hidden; container-type: inline-size; padding: 4cqw 2.2cqw 2.5cqw; background: #fff; color: #203220; }
  .rc-collocation>h1 { text-align: center; color: #2e5a2e; font-size: 6.4cqw; }
  .rc-collocation-sub { text-align: center; color: #5c963e; font-size: 2.65cqw; }
  .rc-collocation-cols { display: grid; grid-template-columns: repeat(3,1fr); align-items: stretch; gap: 2cqw; height: 84%; margin-top: 2cqw; overflow: hidden; }
  .rc-collocation-cols>div { display: flex; flex-direction: column; justify-content: space-between; gap: 1.5cqw; min-height: 0; }
  .rc-collocation section { display: flex; flex-shrink: 0; flex-direction: column; justify-content: flex-start; }
  .rc-collocation h2 { overflow: hidden; flex: 0 0 auto; padding: .6cqw; background: #57933d; color: #fff; text-align: center; font-size: clamp(9px, 2.7cqw, 21px); white-space: nowrap; text-overflow: ellipsis; }
  .rc-collocation section p { overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; flex: 0 0 auto; border-bottom: .1cqw solid #d9e6d1; font-family: "FangSong",serif; font-size: clamp(8.5px, 2.3cqw, 18px); line-height: 1.14; white-space: normal; }
  .rc-collocation section b { font-weight: 700; }
  .rc-collocation section span { margin-left: .4cqw; color: #4a684a; }
</style>
</head>
<body>

<h1>12 种模板的成品渲染</h1>
<div class="lead">
  共 ${allJobs.length} 个 job，覆盖 ${cardOrder.length} 种模板。<br>
  image_to_image 模板（08/12/13）显示实际生成的 PNG；code/hybrid 模板用组件真实 CSS 渲染。
  字号/间距按 cqw（容器宽度百分比）自适应，但动态 fit-scale 未启用，少数内容可能溢出。
</div>

${cardsHtml}

</body>
</html>`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log(`written: ${OUT_HTML} (${(html.length / 1024).toFixed(1)} KB)`);
console.log(`jobs: ${allJobs.length}, cards: ${cardOrder.length}`);
