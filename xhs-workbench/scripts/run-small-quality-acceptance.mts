/* eslint-disable no-console */
import fs from 'node:fs/promises';

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:3000';

const suites = [
  {
    product_id: 'delf_b2_writing',
    label: '商品1 DELF B2 写作',
    cards: [
      'resource_01_grammar_parchment_red',
      'resource_02_grammar_white_green',
      'resource_06_notes_course_offer',
    ],
  },
  {
    product_id: 'tef_tcf_canada',
    label: '商品2 TEF/TCF Canada',
    cards: [
      'resource_01_grammar_parchment_red',
      'resource_04_chalkboard_phrase_list',
      'resource_10_plain_text_experience',
    ],
  },
] as const;

type BatchState = {
  batch?: { id: string; status: string };
  jobs?: Array<{
    id: string;
    seq: number;
    product_id: string;
    reference_card_id: string;
    status: string;
    topic?: { topic?: string; topic_type?: string; pain?: string; content_promise?: string };
    draft?: {
      selected_title?: string;
      cover?: { title?: string; subtitle?: string; sections?: Array<{ heading?: string; items?: Array<{ primary?: string; secondary?: string; note?: string }> }> };
      caption?: string;
      tags?: string[];
      inner_pages?: Array<{ page_no?: number; page_title?: string; lead?: string; bullets?: string[] }>;
      checks?: Array<{ level?: string; code?: string; message?: string }>;
    };
    failure?: { stage?: string; message?: string };
    cover_image_url?: string;
    usage?: { total_tokens?: number; calls?: number };
  }>;
};
type BatchJob = NonNullable<BatchState['jobs']>[number];

async function postJson(body: unknown) {
  const response = await fetch(`${BASE_URL}/api/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(json)}`);
  return json as any;
}

async function getBatch(batchId: string): Promise<BatchState> {
  const response = await fetch(`${BASE_URL}/api/batch?batch_id=${encodeURIComponent(batchId)}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(json)}`);
  return json as BatchState;
}

async function runSuite(suite: typeof suites[number]) {
  console.log(`[quality] plan ${suite.label}`);
  const planned = await postJson({
    action: 'plan',
    product_id: suite.product_id,
    card_ids: suite.cards,
    topics_per_card: 1,
    direction: '小红书运营质量验收：标题要人话、有点击欲；封面标题要让用户一眼知道和自己有关；正文要有干货和带货承接；避免重复标题。',
  });
  const batchId = planned.batch?.id;
  console.log(`[quality] ${suite.label} batch=${batchId} jobs=${planned.batch?.jobs?.length}`);
  await postJson({ action: 'run', batch_id: batchId });
  let state: BatchState = {};
  for (let i = 1; i <= 180; i += 1) {
    await sleep(5000);
    state = await getBatch(batchId);
    const jobs = state.jobs || [];
    const done = jobs.filter(job => job.status === 'success' || job.status === 'failed').length;
    const ok = jobs.filter(job => job.status === 'success').length;
    const fail = jobs.filter(job => job.status === 'failed').length;
    const running = jobs.find(job => job.status === 'running');
    console.log(`[quality] ${suite.label} poll#${i} done=${done}/${jobs.length} ok=${ok} fail=${fail} running=${running?.reference_card_id || '-'}`);
    if (state.batch?.status === 'done') break;
  }
  return { suite, state };
}

const results = [];
for (const suite of suites) {
  results.push(await runSuite(suite));
}

const stamp = Date.now();
const jsonPath = `quality-acceptance-${stamp}.json`;
const htmlPath = `quality-acceptance-${stamp}.html`;
await fs.writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');
await fs.writeFile(htmlPath, renderHtml(results), 'utf8');
console.log(`[quality] JSON=${jsonPath}`);
console.log(`[quality] HTML=${htmlPath}`);

function renderHtml(results: Array<{ suite: typeof suites[number]; state: BatchState }>) {
  const jobs = results.flatMap(result => (result.state.jobs || []).map(job => ({ suite: result.suite, job })));
  const rows = jobs.map(({ suite, job }, index) => {
    const draft = job.draft || {};
    const cover = draft.cover || {};
    const title = draft.selected_title || '';
    const caption = draft.caption || '';
    const tags = draft.tags || [];
    const pages = draft.inner_pages || [];
    const issues = qualityIssues(job);
    const img = job.cover_image_url
      ? `<img src="${escapeHtml(job.cover_image_url)}" />`
      : `<div class="noimg">no image</div>`;
    return `<section class="job ${job.status} ${issues.length ? 'warn' : 'ok'}">
      <div class="meta">#${index + 1} · ${escapeHtml(suite.label)} · ${escapeHtml(job.reference_card_id)} · ${escapeHtml(job.status)}</div>
      <div class="grid">
        <div>${img}</div>
        <div>
          <h2>${escapeHtml(cover.title || title || '(无标题)')}</h2>
          <p class="subtitle">${escapeHtml(cover.subtitle || '')}</p>
          <h3>质量提醒</h3>
          <ul>${issues.length ? issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join('') : '<li>初筛未发现明显问题</li>'}</ul>
          <h3>任务单</h3>
          <p>${escapeHtml(job.topic?.topic || '')}</p>
          <p class="muted">${escapeHtml(job.topic?.topic_type || '')} · ${escapeHtml(job.topic?.pain || '')}</p>
          <h3>文字标题</h3>
          <p class="title">${escapeHtml(title)}</p>
          <h3>正文</h3>
          <p>${escapeHtml(caption)}</p>
          <h3>标签</h3>
          <p>${escapeHtml(tags.join(' '))}</p>
          <h3>内页</h3>
          ${pages.map(page => `<div class="page"><b>P${page.page_no || ''} ${escapeHtml(page.page_title || '')}</b><br>${escapeHtml(page.lead || '')}<br>${escapeHtml((page.bullets || []).join(' / '))}</div>`).join('')}
          ${job.failure ? `<h3 class="bad">失败</h3><pre>${escapeHtml(JSON.stringify(job.failure, null, 2))}</pre>` : ''}
        </div>
      </div>
    </section>`;
  }).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" />
<title>小批量质量验收</title>
<style>
body{margin:0;background:#f5f5f4;color:#1f2937;font-family:Arial,"Microsoft YaHei",sans-serif}
header{position:sticky;top:0;z-index:2;background:#111827;color:#fff;padding:16px 24px}
.job{max-width:1180px;margin:18px auto;background:#fff;border:1px solid #d1d5db;border-radius:10px;overflow:hidden}
.job.warn{border-color:#f59e0b}.job.failed{border-color:#ef4444}
.meta{padding:10px 14px;background:#f8fafc;color:#475569;border-bottom:1px solid #e5e7eb;font-size:13px}
.grid{display:grid;grid-template-columns:390px 1fr;gap:20px;padding:18px}
img{width:390px;max-height:560px;object-fit:contain;background:#eee;border:1px solid #ddd}
.noimg{width:390px;height:520px;display:grid;place-items:center;background:#eee;color:#777}
h2{margin:0 0 8px;font-size:30px}h3{margin:16px 0 6px;font-size:15px;color:#475569}
p{line-height:1.65;margin:0}.subtitle{color:#7c2d12;font-weight:700}.title{font-size:20px;font-weight:800}.muted{color:#64748b}
.page{padding:8px 0;border-top:1px dashed #ddd;line-height:1.6}li{line-height:1.55}pre{white-space:pre-wrap;color:#b91c1c}
</style></head><body>
<header><b>小批量质量验收</b> <span>总数 ${jobs.length}，成功 ${jobs.filter(x => x.job.status === 'success').length}，失败 ${jobs.filter(x => x.job.status === 'failed').length}</span></header>
${rows}
</body></html>`;
}

function qualityIssues(job: BatchJob) {
  const draft = job.draft || {};
  const coverTitle = draft.cover?.title || '';
  const textTitle = draft.selected_title || '';
  const caption = draft.caption || '';
  const issues: string[] = [];
  if (job.status !== 'success') issues.push(`生成失败：${job.failure?.stage || ''} ${job.failure?.message || ''}`);
  if (!coverTitle) issues.push('封面标题为空');
  if (!textTitle) issues.push('文字标题为空');
  if (/资料太散|拖后腿|白背|写作任务|长啥样|卡住/.test(`${coverTitle} ${textTitle}`)) issues.push('标题仍有不人话/AI腔');
  if (!/法语|DELF|B2|TEF|TCF|CLB|Canada|加拿大/i.test(`${coverTitle} ${textTitle}`)) issues.push('标题缺少法语/考试身份');
  if (Array.from(textTitle).length > 20) issues.push(`文字标题超过20字：${Array.from(textTitle).length}`);
  if (caption && (caption.length < 180 || caption.length > 460)) issues.push(`正文字数可能不适合：${caption.length}`);
  if ((draft.tags || []).length < 6) issues.push(`标签少于6个：${(draft.tags || []).length}`);
  if ((draft.inner_pages || []).some(page => (page.bullets || []).length < 3)) issues.push('存在内页内容少于3条');
  return issues;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
