/* eslint-disable no-console */
import fs from 'node:fs/promises';

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4011';

const CARDS = [
  { id: 'resource_01_grammar_parchment_red', renderer: 'parchment_dense_directory' },
  { id: 'resource_02_grammar_white_green', renderer: 'white_green_directory' },
  { id: 'resource_05_grammar_clean_purple', renderer: 'clean_purple_directory' },
  { id: 'resource_15_grammar_grid_purple', renderer: 'grid_purple_directory' },
  { id: 'resource_06_notes_course_offer', renderer: 'memo_offer' },
  { id: 'resource_10_plain_text_experience', renderer: 'plain_experience' },
  { id: 'resource_04_chalkboard_phrase_list', renderer: 'blackboard_phrase' },
  { id: 'resource_03_chalkboard_course', renderer: 'blackboard_offer' },
  { id: 'resource_07_question_words_parchment', renderer: 'word_flashcard' },
  { id: 'resource_09_notebook_warning', renderer: 'notebook_big_words' },
  { id: 'resource_11_delf_doc_analysis', renderer: 'document_analysis' },
];

async function postJson(body) {
  const response = await fetch(`${BASE_URL}/api/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

async function getBatch(batchId) {
  const response = await fetch(`${BASE_URL}/api/batch?batch_id=${encodeURIComponent(batchId)}`);
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json };
}

async function main() {
  const productId = process.env.PRODUCT_ID || 'delf_b2_writing';
  console.log(`[bridge-nonimage] base=${BASE_URL} product=${productId} cards=${CARDS.length}`);
  const plan = await postJson({
    action: 'plan',
    product_id: productId,
    card_ids: CARDS.map(card => card.id),
    topics_per_card: 1,
    direction: '走完整前台链路；本次只验证非图生图模板；每个模板生成不同选题和标题。',
  });
  if (!plan.ok) {
    console.error(plan.json);
    process.exit(1);
  }
  const batchId = plan.json.batch?.id;
  console.log(`[bridge-nonimage] plan ok batch=${batchId} jobs=${plan.json.batch?.jobs?.length}`);
  const run = await postJson({ action: 'run', batch_id: batchId });
  console.log(`[bridge-nonimage] run ${JSON.stringify(run.json)}`);

  let last = null;
  for (let i = 1; i <= 180; i += 1) {
    await sleep(5000);
    const result = await getBatch(batchId);
    if (!result.ok) continue;
    last = result.json;
    const jobs = last.jobs || [];
    const done = jobs.filter(job => job.status === 'success' || job.status === 'failed').length;
    const ok = jobs.filter(job => job.status === 'success').length;
    const fail = jobs.filter(job => job.status === 'failed').length;
    const running = jobs.find(job => job.status === 'running');
    console.log(`[bridge-nonimage] poll#${i} done=${done}/${jobs.length} ok=${ok} fail=${fail} running=${running?.reference_card_id || '-'}`);
    if (last.batch?.status === 'done') break;
  }

  if (!last) {
    console.error('[bridge-nonimage] no final batch state');
    process.exit(1);
  }
  const resultPath = `bridge-nonimage-result-${Date.now()}.json`;
  await fs.writeFile(resultPath, JSON.stringify(last, null, 2), 'utf8');
  const htmlPath = `bridge-nonimage-preview-${Date.now()}.html`;
  await fs.writeFile(htmlPath, buildHtml(last), 'utf8');
  console.log(`[bridge-nonimage] result=${resultPath}`);
  console.log(`[bridge-nonimage] html=${htmlPath}`);
}

function buildHtml(data) {
  const jobs = data.jobs || [];
  const cardsById = Object.fromEntries(CARDS.map(card => [card.id, card]));
  const rows = jobs.map((job, index) => {
    const result = job.result || {};
    const note = result.note || result.draft || result;
    const cover = note.cover || result.cover || {};
    const title = note.selected_title || note.title || result.selected_title || job.topic?.topic || '';
    const caption = note.caption || result.caption || '';
    const pages = note.inner_pages || result.inner_pages || [];
    const img = job.cover_image_url
      ? `<img src="${escapeHtml(job.cover_image_url)}" />`
      : `<div class="noimg">no image</div>`;
    return `<section class="job ${job.status}">
      <div class="meta">#${index + 1} · ${escapeHtml(job.product_id || '')} · ${escapeHtml(job.reference_card_id)} · ${escapeHtml(cardsById[job.reference_card_id]?.renderer || '')} · ${escapeHtml(job.status)}</div>
      <div class="grid">
        <div>${img}</div>
        <div>
          <h2>${escapeHtml(cover.title || title)}</h2>
          <p class="subtitle">${escapeHtml(cover.subtitle || '')}</p>
          <h3>文字标题</h3>
          <p class="title">${escapeHtml(title)}</p>
          <h3>正文</h3>
          <p>${escapeHtml(caption)}</p>
          <h3>内页</h3>
          ${(pages || []).map(page => `<div class="page"><b>P${page.page_no || ''} ${escapeHtml(page.page_title || '')}</b><br>${escapeHtml((page.bullets || []).join(' / '))}</div>`).join('')}
          ${job.failure ? `<h3 class="bad">失败</h3><pre>${escapeHtml(JSON.stringify(job.failure, null, 2))}</pre>` : ''}
        </div>
      </div>
    </section>`;
  }).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>Bridge Non-image Acceptance</title>
  <style>
    body { margin: 0; font-family: Arial, "Microsoft YaHei", sans-serif; background: #f4f4f4; color: #1f2933; }
    header { position: sticky; top: 0; z-index: 2; padding: 16px 24px; background: #111827; color: white; }
    .job { margin: 18px auto; max-width: 1180px; background: white; border: 1px solid #ddd; border-radius: 10px; overflow: hidden; }
    .job.failed { border-color: #ef4444; }
    .meta { padding: 10px 14px; background: #f8fafc; color: #475569; font-size: 13px; border-bottom: 1px solid #e5e7eb; }
    .grid { display: grid; grid-template-columns: 390px 1fr; gap: 20px; padding: 18px; }
    img { width: 390px; max-height: 560px; object-fit: contain; background: #eee; border: 1px solid #ddd; }
    .noimg { width: 390px; height: 520px; display: grid; place-items: center; background: #eee; color: #777; }
    h2 { margin: 0 0 8px; font-size: 28px; }
    h3 { margin: 16px 0 6px; font-size: 15px; color: #475569; }
    p { line-height: 1.65; margin: 0; }
    .subtitle { color: #7c2d12; font-weight: 700; }
    .title { font-size: 20px; font-weight: 800; color: #111827; }
    .page { padding: 8px 0; border-top: 1px dashed #ddd; line-height: 1.6; }
    pre { white-space: pre-wrap; color: #b91c1c; }
  </style>
</head>
<body>
<header>
  <b>非图生图模板完整链路验收</b>
  <span>总数 ${jobs.length}，成功 ${jobs.filter(job => job.status === 'success').length}，失败 ${jobs.filter(job => job.status === 'failed').length}</span>
</header>
${rows}
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
