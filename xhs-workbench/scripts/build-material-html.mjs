import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inputs = [
  'material-batch-full-1785306459517.json',
  'material-batch-full-1785307686698.json',
];

const productNames = {
  delf_b2_writing: '商品1：DELF B2 写作知识库',
  tef_tcf_canada: '商品2：TEF/TCF Canada 备考知识库',
};

const jobs = inputs.flatMap(file => {
  const data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  return data.jobs.map(job => ({ ...job, source_file: file }));
});

const summary = {
  total: jobs.length,
  success: jobs.filter(job => job.status === 'success').length,
  failed: jobs.filter(job => job.status === 'failed').length,
  tokens: jobs.reduce((sum, job) => sum + (job.usage?.total_tokens || 0), 0),
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nl2br(value = '') {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function badgeClass(job) {
  if (job.status === 'failed') return 'bad';
  if (job.draft?.checks?.issues?.length) return 'danger';
  if ((job.draft?.checks?.warnings || []).length >= 3) return 'warn';
  return 'good';
}

function verdict(job) {
  if (job.status === 'failed') return '失败，不要用';
  if (job.draft?.checks?.issues?.length) return '暂不建议发';
  if ((job.draft?.checks?.warnings || []).length >= 3) return '小改后再发';
  return '可挑选发布';
}

function titleCandidates(draft) {
  const candidates = draft?.title_candidates || [];
  if (!candidates.length) return '<p class="muted">无</p>';
  return `<div class="candidate-list">${candidates.map(item => `
    <div class="candidate">
      <span>${escapeHtml(item.title_type || item.trigger_type || '标题')}</span>
      <strong>${escapeHtml(item.title || '')}</strong>
    </div>
  `).join('')}</div>`;
}

function innerPages(draft) {
  const pages = draft?.inner_pages || [];
  if (!pages.length) return '<p class="muted">无内页数据</p>';
  return `<div class="pages">${pages.map((page, index) => `
    <details>
      <summary>P${index + 1} ${escapeHtml(page.title || page.page_title || '')}</summary>
      <pre>${escapeHtml(JSON.stringify(page, null, 2))}</pre>
    </details>
  `).join('')}</div>`;
}

function jobCard(job) {
  const draft = job.draft || {};
  const checks = draft.checks || {};
  const issues = checks.issues || [];
  const warnings = checks.warnings || [];
  return `
    <article class="job ${badgeClass(job)}" data-product="${escapeHtml(job.product_id)}" data-status="${escapeHtml(job.status)}">
      <div class="job-head">
        <div>
          <p class="meta">${escapeHtml(productNames[job.product_id] || job.product_id)} · ${escapeHtml(job.reference_card_id)} · ${escapeHtml(job.id)}</p>
          <h2>${escapeHtml(draft.selected_title || job.topic?.topic || job.reference_card_id)}</h2>
        </div>
        <span class="badge ${badgeClass(job)}">${verdict(job)}</span>
      </div>

      <div class="grid">
        <section>
          <h3>选题</h3>
          <p>${escapeHtml(job.topic?.topic || '-')}</p>
          <p class="small"><b>人群：</b>${escapeHtml(job.topic?.audience || '-')}</p>
          <p class="small"><b>痛点：</b>${escapeHtml(job.topic?.pain || '-')}</p>
        </section>

        <section>
          <h3>封面</h3>
          <p class="cover-title">${escapeHtml(draft.cover?.title || '-')}</p>
          <p class="small">${escapeHtml(draft.cover?.subtitle || '')}</p>
          ${job.cover_image_url ? `<p><a href="${escapeHtml(job.cover_image_url)}" target="_blank">打开生成封面图</a></p>` : ''}
        </section>
      </div>

      <section>
        <h3>三档标题</h3>
        ${titleCandidates(draft)}
      </section>

      <section>
        <h3>正文</h3>
        <div class="caption">${nl2br(draft.caption || job.failure?.message || '-')}</div>
      </section>

      <section>
        <h3>标签</h3>
        <p class="tags">${(draft.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('') || '<span>无</span>'}</p>
      </section>

      <section>
        <h3>检查</h3>
        <p class="small"><b>硬问题：</b>${escapeHtml(issues.join('，') || '无')}</p>
        <p class="small"><b>提醒：</b>${escapeHtml(warnings.join('，') || '无')}</p>
        ${job.status === 'failed' ? `<p class="small"><b>失败阶段：</b>${escapeHtml(job.failure?.stage || '-')}；${escapeHtml(job.failure?.message || '-')}</p>` : ''}
        <p class="small"><b>token：</b>${Number(job.usage?.total_tokens || 0).toLocaleString()}；<b>calls：</b>${job.usage?.calls || 0}</p>
      </section>

      <section>
        <h3>内页结构</h3>
        ${innerPages(draft)}
      </section>
    </article>
  `;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>小红书素材临时验收页</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f4ef;
      --panel: #fffdf8;
      --ink: #222;
      --muted: #716b62;
      --line: #ddd3c2;
      --red: #a5332b;
      --green: #28764f;
      --yellow: #9b6a0f;
      --blue: #245f95;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: var(--ink);
      background: var(--bg);
      line-height: 1.65;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      border-bottom: 1px solid var(--line);
      background: rgba(246, 244, 239, .94);
      backdrop-filter: blur(12px);
    }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0 0 8px; font-size: 30px; }
    .stats { display: flex; flex-wrap: wrap; gap: 10px; color: var(--muted); }
    .stats span, button {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 14px;
    }
    .toolbar { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    button { cursor: pointer; color: var(--ink); }
    button.active { background: #222; color: white; border-color: #222; }
    main { max-width: 1180px; margin: 0 auto; padding: 18px 22px 40px; }
    .job {
      background: var(--panel);
      border: 1px solid var(--line);
      border-left-width: 7px;
      border-radius: 10px;
      padding: 20px;
      margin: 18px 0;
      box-shadow: 0 8px 28px rgba(70, 49, 24, .06);
    }
    .job.good { border-left-color: var(--green); }
    .job.warn { border-left-color: var(--yellow); }
    .job.danger, .job.bad { border-left-color: var(--red); }
    .job-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .meta, .small, .muted { color: var(--muted); font-size: 14px; margin: 0 0 6px; }
    h2 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; }
    h3 { margin: 18px 0 8px; font-size: 16px; color: #4a3427; }
    .badge { white-space: nowrap; border-radius: 999px; padding: 6px 10px; font-size: 13px; color: white; }
    .badge.good { background: var(--green); }
    .badge.warn { background: var(--yellow); }
    .badge.danger, .badge.bad { background: var(--red); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    section { border-top: 1px solid #eee4d6; }
    .cover-title { font-size: 22px; font-weight: 800; margin: 4px 0; color: #6f211b; }
    .candidate-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
    .candidate { border: 1px solid #eadfce; border-radius: 8px; padding: 9px 10px; background: #fffaf0; }
    .candidate span { display: block; color: var(--muted); font-size: 12px; }
    .candidate strong { display: block; line-height: 1.35; }
    .caption { padding: 12px 14px; background: #fffaf0; border: 1px solid #eadfce; border-radius: 8px; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .tags span { background: #f0eadf; border-radius: 999px; padding: 4px 9px; font-size: 13px; }
    details { margin: 8px 0; }
    summary { cursor: pointer; color: var(--blue); }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #1f1f1f;
      color: #f5f5f5;
      padding: 12px;
      border-radius: 8px;
      max-height: 360px;
      overflow: auto;
      font-size: 12px;
    }
    a { color: var(--blue); }
    @media (max-width: 760px) {
      .grid, .job-head { display: block; }
      h1 { font-size: 24px; }
      h2 { font-size: 20px; }
      .badge { display: inline-block; margin-bottom: 10px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="wrap">
      <h1>小红书素材临时验收页</h1>
      <div class="stats">
        <span>总数 ${summary.total}</span>
        <span>成功 ${summary.success}</span>
        <span>失败 ${summary.failed}</span>
        <span>token ${summary.tokens.toLocaleString()}</span>
      </div>
      <div class="toolbar">
        <button class="active" data-filter="all">全部</button>
        <button data-filter="delf_b2_writing">商品1 DELF</button>
        <button data-filter="tef_tcf_canada">商品2 TEF/TCF</button>
        <button data-filter="usable">只看可用</button>
        <button data-filter="problem">只看问题</button>
      </div>
    </div>
  </header>
  <main>
    ${jobs.map(jobCard).join('\n')}
  </main>
  <script>
    const buttons = [...document.querySelectorAll('button[data-filter]')];
    const cards = [...document.querySelectorAll('.job')];
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        buttons.forEach(item => item.classList.remove('active'));
        button.classList.add('active');
        const filter = button.dataset.filter;
        cards.forEach(card => {
          const productMatch = filter === card.dataset.product;
          const usableMatch = filter === 'usable' && card.dataset.status === 'success' && !card.classList.contains('danger');
          const problemMatch = filter === 'problem' && (card.dataset.status === 'failed' || card.classList.contains('danger') || card.classList.contains('bad'));
          card.style.display = filter === 'all' || productMatch || usableMatch || problemMatch ? '' : 'none';
        });
      });
    });
  </script>
</body>
</html>`;

const out = path.join(root, 'public', 'material-results-temp.html');
fs.writeFileSync(out, html, 'utf8');
console.log(out);
