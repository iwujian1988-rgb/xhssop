/* eslint-disable no-console */
/**
 * 把 batch 目录里所有 success job 的完整产物（标题/封面/内页/正文/标签）
 * dump 成单文件 HTML，方便人工审 + 复制到三方平台。
 *
 * 用法：node scripts/build-selftest-preview.mjs [BATCH_DIR] [OUT_HTML]
 * 默认：取最新 batch → selftest-preview.html
 */
import fs from 'node:fs';
import path from 'node:path';

async function resolveBatchDir(arg) {
  if (arg) return path.resolve(arg);
  const root = path.resolve('data/batches');
  const entries = await fs.promises.readdir(root);
  const sorted = (await Promise.all(
    entries.map(async name => {
      const stat = await fs.promises.stat(path.join(root, name));
      return { name, mtime: stat.mtimeMs };
    }),
  )).sort((a, b) => b.mtime - a.mtime);
  if (!sorted[0]) throw new Error('未找到任何 batch 目录');
  return path.join(root, sorted[0].name);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function nl2br(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function renderJob(job) {
  const d = job.draft || {};
  const cover = d.cover || {};
  const innerPages = d.inner_pages || [];
  const caption = d.caption || '';
  const tags = d.tags || [];
  const titleCandidates = d.title_candidates || [];

  const coverHtml = `
    <section class="block cover">
      <h3>封面</h3>
      <div class="cover-box">
        <div class="cover-title">${escapeHtml(cover.title || '')}</div>
        ${cover.subtitle ? `<div class="cover-subtitle">${escapeHtml(cover.subtitle)}</div>` : ''}
      </div>
      ${(cover.sections || []).map((section, i) => `
        <details class="cover-section" ${i === 0 ? 'open' : ''}>
          <summary>分组 ${i + 1}：${escapeHtml(section.heading || '')} ${section.side_label ? `<span class="side">${escapeHtml(section.side_label)}</span>` : ''}</summary>
          <table>
            <thead><tr><th>主条目</th><th>释义</th><th>note</th></tr></thead>
            <tbody>
              ${(section.items || []).map(item => `
                <tr>
                  <td class="primary">${escapeHtml(item.primary || '')}</td>
                  <td>${escapeHtml(item.secondary || '')}</td>
                  <td class="note">${escapeHtml(item.note || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </details>
      `).join('')}
      ${job.cover_image_url ? `<div class="cover-image"><img src="${escapeHtml(job.cover_image_url)}" alt="cover"></div>` : ''}
    </section>
  `;

  const innerPagesHtml = innerPages.map((page, i) => `
    <details class="inner-page" ${i === 0 ? 'open' : ''}>
      <summary>P${page.page_no || i + 2}：${escapeHtml(page.page_title || '')} <span class="page-type">${escapeHtml(page.page_type || '')}</span></summary>
      ${page.lead ? `<p class="lead">${escapeHtml(page.lead)}</p>` : ''}
      <ul>
        ${(page.bullets || []).map(b => `<li>${escapeHtml(typeof b === 'string' ? b : b.text || '')}</li>`).join('')}
      </ul>
    </details>
  `).join('');

  const candidatesHtml = titleCandidates.length ? `
    <details class="candidates">
      <summary>文字标题候选池（${titleCandidates.length}）</summary>
      <ol>
        ${titleCandidates.map(c => `<li>${escapeHtml(c.title || '')} <span class="formula">${escapeHtml(c.formula_id || '')}</span></li>`).join('')}
      </ol>
    </details>
  ` : '';

  return `
    <article class="job ${job.status}">
      <header>
        <h2>${job.status === 'success' ? '✅' : '❌'} ${escapeHtml(job.id)} · ${escapeHtml(job.reference_card_id)}</h2>
        <div class="meta">
          seed: ${escapeHtml(job.topic?.seed_id || '')} ·
          attempts: ${job.attempts || 0} ·
          tokens: ${(job.usage?.total_tokens || 0).toLocaleString()} ·
          autofix: ${job.usage?.autofix_count || 0}
        </div>
        <div class="topic">选题：${escapeHtml(job.topic?.topic || '')}</div>
        ${job.failure ? `<div class="failure">失败原因：${escapeHtml(job.failure.message || '')}</div>` : ''}
      </header>

      ${job.status === 'success' ? `
        <section class="block selected">
          <h3>文字标题（selected_title）</h3>
          <div class="selected-title">${escapeHtml(d.selected_title || '')}</div>
        </section>
        ${coverHtml}
        <section class="block inner-pages">
          <h3>内页（${innerPages.length}）</h3>
          ${innerPagesHtml}
        </section>
        <section class="block caption">
          <h3>正文 caption <span class="count">${caption.length} 字</span></h3>
          <div class="caption-text">${nl2br(caption)}</div>
        </section>
        <section class="block tags">
          <h3>标签（${tags.length}）</h3>
          <div class="tag-list">${tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>
        </section>
        ${candidatesHtml}
      ` : ''}
    </article>
  `;
}

async function main() {
  const batchDir = await resolveBatchDir(process.argv[2]);
  const outPath = process.argv[3] || 'selftest-preview.html';
  const jobsDir = path.join(batchDir, 'jobs');
  const files = (await fs.promises.readdir(jobsDir)).filter(f => f.endsWith('.json'));
  const jobs = await Promise.all(files.map(async f => JSON.parse(await fs.promises.readFile(path.join(jobsDir, f), 'utf8'))));
  jobs.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  const success = jobs.filter(j => j.status === 'success');
  const failed = jobs.filter(j => j.status === 'failed');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>batch 预览 - ${path.basename(batchDir)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #222; }
    h1 { color: #c3272b; border-bottom: 2px solid #c3272b; padding-bottom: 8px; }
    .summary { background: #fff; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; }
    .summary b { color: #c3272b; }
    .job { background: #fff; margin: 16px 0; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .job.failed { border-left: 4px solid #c3272b; }
    .job.success { border-left: 4px solid #4caf50; }
    .job h2 { margin: 0 0 8px; font-size: 16px; }
    .meta { color: #888; font-size: 12px; margin-bottom: 4px; }
    .topic { color: #555; font-size: 13px; margin-bottom: 4px; }
    .failure { background: #ffebee; padding: 6px 10px; border-radius: 4px; font-size: 13px; color: #c3272b; }
    .block { margin-top: 16px; padding-top: 12px; border-top: 1px dashed #ddd; }
    .block h3 { margin: 0 0 8px; font-size: 14px; color: #555; }
    .selected-title { font-size: 18px; font-weight: bold; padding: 8px 12px; background: #fff3e0; border-radius: 4px; }
    .cover-box { background: linear-gradient(135deg, #fff8e1, #ffe0b2); padding: 16px; border-radius: 6px; text-align: center; margin-bottom: 8px; }
    .cover-title { font-size: 22px; font-weight: bold; color: #c3272b; }
    .cover-subtitle { font-size: 14px; color: #666; margin-top: 4px; }
    .cover-image img { max-width: 100%; max-height: 400px; border-radius: 6px; }
    details { margin: 8px 0; padding: 8px 12px; background: #fafafa; border-radius: 4px; }
    summary { cursor: pointer; font-weight: bold; color: #444; }
    .side { color: #888; font-size: 12px; margin-left: 8px; }
    .page-type { color: #1976d2; font-size: 11px; margin-left: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th { background: #f0f0f0; padding: 6px; text-align: left; }
    td { padding: 6px; border-bottom: 1px solid #eee; vertical-align: top; }
    .primary { font-weight: bold; color: #c3272b; }
    .note { color: #888; font-size: 12px; }
    .lead { color: #555; font-style: italic; margin: 4px 0; }
    ul { padding-left: 20px; }
    li { margin: 4px 0; line-height: 1.6; }
    .caption-text { white-space: pre-wrap; line-height: 1.8; font-size: 14px; padding: 12px; background: #f9f9f9; border-radius: 4px; }
    .count { color: #888; font-weight: normal; font-size: 12px; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .tag { background: #e3f2fd; color: #1976d2; padding: 3px 8px; border-radius: 12px; font-size: 12px; }
    .formula { color: #888; font-size: 11px; }
    ol { padding-left: 20px; }
    .copy-btn { background: #c3272b; color: white; border: 0; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .copy-btn:hover { background: #a31e22; }
  </style>
</head>
<body>
  <h1>batch 预览：${path.basename(batchDir)}</h1>
  <div class="summary">
    总计：<b>${jobs.length}</b> jobs ·
    成功：<b>${success.length}</b> ·
    失败：<b>${failed.length}</b>
  </div>
  ${jobs.map(renderJob).join('')}
</body>
</html>`;

  await fs.promises.writeFile(outPath, html, 'utf8');
  console.log(`写入 ${outPath}`);
  console.log(`总计 ${jobs.length} jobs（${success.length} 成功 / ${failed.length} 失败）`);
  if (success.length) {
    console.log('\n成功 job 标题：');
    for (const j of success) console.log(`  ${j.id} ${j.reference_card_id}: ${j.draft?.selected_title}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
