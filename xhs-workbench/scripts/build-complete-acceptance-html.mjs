import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inputs = [
  'material-batch-full-1785306459517.json',
  'material-batch-full-1785307686698.json',
];
const screenshotsDir = path.join(root, 'tmp-cover-screenshots');
const remoteCoverDir = path.join(root, 'tmp-remote-covers');

const productNames = {
  delf_b2_writing: '商品1 DELF B2 写作知识库',
  tef_tcf_canada: '商品2 TEF/TCF Canada 备考资料包',
};

const screenshotFiles = fs.existsSync(screenshotsDir)
  ? fs.readdirSync(screenshotsDir).filter(name => name.endsWith('.png')).sort()
  : [];
const screenshotQueue = new Map();
for (const name of screenshotFiles) {
  const match = name.match(/^\d+__([^_].*?)__(resource_.+)__(job_\d+)\.png$/);
  if (!match) continue;
  const key = `${match[1]}|${match[2]}|${match[3]}`;
  if (!screenshotQueue.has(key)) screenshotQueue.set(key, []);
  screenshotQueue.get(key).push(name);
}

const jobs = [];
for (const file of inputs) {
  const data = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  for (const job of data.jobs) {
    const key = `${job.product_id}|${job.reference_card_id}|${job.id}`;
    const list = screenshotQueue.get(key) || [];
    jobs.push({ ...job, source_file: file, local_cover_png: list.shift() || '' });
  }
}

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

function compact(value = '', max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function hasRiskyRuleText(job) {
  const text = JSON.stringify(job.draft || {});
  return /(至少\d+词|官方|评分标准|必须|保证|一定|少于\d+词|三大评分维度)/.test(text);
}

function verdict(job) {
  if (job.status === 'failed') return { label: '失败，不验收', cls: 'bad', reason: job.failure?.message || '生成失败' };
  const issues = job.draft?.checks?.issues || [];
  const warnings = job.draft?.checks?.warnings || [];
  if (issues.length) return { label: '暂不建议发', cls: 'bad', reason: `硬问题：${issues.join('，')}` };
  if (hasRiskyRuleText(job)) return { label: '小改可发', cls: 'warn', reason: '有规则/数量口径，需要人工改得更稳。' };
  if (warnings.length >= 3) return { label: '小改可发', cls: 'warn', reason: `提醒偏多：${warnings.join('，')}` };
  return { label: '可进入发布前精修', cls: 'good', reason: warnings.length ? `有提醒：${warnings.join('，')}` : '结构基本完整。' };
}

function titleCandidates(draft) {
  const items = draft?.title_candidates || [];
  return items.map(item => `<span><b>${escapeHtml(item.title_type || item.trigger_type || '标题')}</b>${escapeHtml(item.title || '')}</span>`).join('');
}

function coverTitleCandidates(draft) {
  const items = draft?.cover_title_candidates || [];
  return items.map(item => `<span><b>${escapeHtml(item.template_id || 'cover')} · ${escapeHtml(item.title_type || '封面')}</b>${escapeHtml(item.title || '')}${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ''}</span>`).join('');
}

function pageCard(page, index) {
  const bullets = page.bullets || [];
  return `<div class="page-card">
    <div class="page-no">P${index + 2}</div>
    <h4>${escapeHtml(page.page_title || page.title || '')}</h4>
    <p>${escapeHtml(page.lead || '')}</p>
    <ul>${bullets.slice(0, 5).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
    <small>source: ${escapeHtml((page.source_ids || []).join(', ') || '-')}</small>
  </div>`;
}

function jobHtml(job, index) {
  const draft = job.draft || {};
  const v = verdict(job);
  const issues = draft.checks?.issues || [];
  const warnings = draft.checks?.warnings || [];
  const cachedRemoteName = `${job.product_id}__${job.reference_card_id}__${job.id}.png`;
  const cachedRemotePath = path.join(remoteCoverDir, cachedRemoteName);
  const imgSrc = job.local_cover_png
    ? `tmp-cover-screenshots/${job.local_cover_png}`
    : fs.existsSync(cachedRemotePath)
      ? `tmp-remote-covers/${cachedRemoteName}`
      : '';
  return `<article class="note ${v.cls}">
    <div class="note-head">
      <div>
        <div class="meta">#${index + 1} · ${escapeHtml(productNames[job.product_id] || job.product_id)} · ${escapeHtml(job.reference_card_id)} · ${escapeHtml(job.id)}</div>
        <h2>${escapeHtml(draft.selected_title || job.topic?.topic || job.reference_card_id)}</h2>
      </div>
      <div class="verdict ${v.cls}">${escapeHtml(v.label)}</div>
    </div>
    <div class="two-col">
      <section class="cover-panel">
        <h3>封面成图</h3>
        ${imgSrc ? `<img src="${escapeHtml(imgSrc)}" alt="cover">` : '<div class="missing">没有封面截图</div>'}
        ${job.cover_image_url ? `<a href="${escapeHtml(job.cover_image_url)}" target="_blank">远程图生图原图</a>` : ''}
      </section>
      <section>
        <h3>选题与封面文案</h3>
        <p><b>选题：</b>${escapeHtml(job.topic?.topic || '-')}</p>
        <p><b>封面标题：</b>${escapeHtml(draft.cover?.title || '-')}</p>
        <p><b>封面副标题：</b>${escapeHtml(draft.cover?.subtitle || '-')}</p>
        <p><b>验收判断：</b>${escapeHtml(v.reason)}</p>
        <p><b>硬问题：</b>${escapeHtml(issues.join('，') || '无')}</p>
        <p><b>提醒：</b>${escapeHtml(warnings.join('，') || '无')}</p>
        <p><b>token：</b>${Number(job.usage?.total_tokens || 0).toLocaleString()}；<b>calls：</b>${job.usage?.calls || 0}</p>
      </section>
    </div>
    <section>
      <h3>三档标题</h3>
      <div class="titles">${titleCandidates(draft) || '<span>无</span>'}</div>
    </section>
    <section>
      <h3>备用封面标题</h3>
      <div class="titles">${coverTitleCandidates(draft) || '<span>无</span>'}</div>
    </section>
    <section>
      <h3>内页验收卡</h3>
      <div class="pages">${(draft.inner_pages || []).map(pageCard).join('') || '<p class="muted">无内页</p>'}</div>
    </section>
    <section>
      <h3>正文与标签</h3>
      <div class="caption">${nl2br(draft.caption || job.failure?.message || '-')}</div>
      <div class="tags">${(draft.tags || []).map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
    </section>
  </article>`;
}

const summary = {
  total: jobs.length,
  success: jobs.filter(job => job.status === 'success').length,
  failed: jobs.filter(job => job.status === 'failed').length,
  good: jobs.filter(job => verdict(job).cls === 'good').length,
  warn: jobs.filter(job => verdict(job).cls === 'warn').length,
  bad: jobs.filter(job => verdict(job).cls === 'bad').length,
  tokens: jobs.reduce((sum, job) => sum + (job.usage?.total_tokens || 0), 0),
};

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>完整图文验收包</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f4f1ea; color: #1f1d1a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; line-height: 1.65; }
  header { position: sticky; top: 0; z-index: 9; background: rgba(244,241,234,.94); border-bottom: 1px solid #ddd2bf; backdrop-filter: blur(12px); }
  .wrap, main { max-width: 1440px; margin: 0 auto; padding: 20px 24px; }
  h1 { margin: 0 0 8px; font-size: 30px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; }
  .stats span, button { border: 1px solid #d8cbb8; background: #fffdf8; border-radius: 8px; padding: 6px 10px; font-size: 14px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  button { cursor: pointer; }
  button.active { background: #1f1d1a; color: #fff; border-color: #1f1d1a; }
  .note { background: #fffdf8; border: 1px solid #d8cbb8; border-left: 8px solid #888; border-radius: 12px; padding: 20px; margin: 22px 0; box-shadow: 0 10px 28px rgba(79,54,29,.07); }
  .note.good { border-left-color: #22724d; }
  .note.warn { border-left-color: #b27313; }
  .note.bad { border-left-color: #a4312d; }
  .note-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .meta, .muted, small { color: #756d63; font-size: 13px; }
  h2 { margin: 3px 0 12px; font-size: 26px; line-height: 1.25; }
  h3 { margin: 18px 0 8px; font-size: 17px; color: #503326; }
  h4 { margin: 0 0 6px; font-size: 16px; }
  .verdict { white-space: nowrap; color: #fff; border-radius: 999px; padding: 7px 11px; font-weight: 800; font-size: 13px; }
  .verdict.good { background: #22724d; }
  .verdict.warn { background: #b27313; }
  .verdict.bad { background: #a4312d; }
  .two-col { display: grid; grid-template-columns: minmax(280px, 520px) 1fr; gap: 22px; align-items: start; }
  .cover-panel img { width: 100%; border: 1px solid #d6c7b2; border-radius: 8px; display: block; background: white; }
  .cover-panel a { display: inline-block; margin-top: 8px; }
  .missing { aspect-ratio: 3/4; background: #eee5d8; border: 1px dashed #bca98f; display: grid; place-items: center; color: #8b7661; }
  section { border-top: 1px solid #eadfce; padding-top: 6px; }
  .titles { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
  .titles span { background: #fff5e6; border: 1px solid #ead8bd; border-radius: 8px; padding: 9px 10px; }
  .titles b { display: block; color: #7c6250; font-size: 12px; margin-bottom: 2px; }
  .titles small { display: block; color: #8d7868; font-size: 12px; margin-top: 2px; }
  .pages { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .page-card { min-height: 340px; background: #fbf7ef; border: 1px solid #e2d4bf; border-radius: 10px; padding: 14px; position: relative; overflow: hidden; }
  .page-no { position: absolute; right: 12px; top: 10px; color: #a28b72; font-weight: 900; }
  .page-card p { margin: 0 0 8px; color: #5c5148; }
  .page-card ul { margin: 0; padding-left: 18px; }
  .page-card li { margin: 4px 0; font-size: 14px; }
  .caption { background: #fff6e8; border: 1px solid #ead8bd; border-radius: 9px; padding: 13px 15px; }
  .tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .tags span { background: #ece3d6; border-radius: 999px; padding: 4px 9px; font-size: 13px; }
  a { color: #205f99; }
  @media (max-width: 860px) {
    .two-col, .note-head { display: block; }
    h1 { font-size: 24px; }
    h2 { font-size: 21px; }
    .verdict { display: inline-block; margin: 6px 0; }
  }
</style>
</head>
<body>
<header>
  <div class="wrap">
    <h1>完整图文验收包</h1>
    <div class="stats">
      <span>总素材 ${summary.total}</span>
      <span>成功 ${summary.success}</span>
      <span>失败 ${summary.failed}</span>
      <span>可精修 ${summary.good}</span>
      <span>小改 ${summary.warn}</span>
      <span>不建议 ${summary.bad}</span>
      <span>token ${summary.tokens.toLocaleString()}</span>
    </div>
    <div class="toolbar">
      <button class="active" data-filter="all">全部</button>
      <button data-filter="delf_b2_writing">商品1</button>
      <button data-filter="tef_tcf_canada">商品2</button>
      <button data-filter="good">可精修</button>
      <button data-filter="warn">小改</button>
      <button data-filter="bad">问题</button>
    </div>
  </div>
</header>
<main>
  ${jobs.map(jobHtml).join('\n')}
</main>
<script>
  const buttons = [...document.querySelectorAll('button[data-filter]')];
  const notes = [...document.querySelectorAll('.note')];
  buttons.forEach(button => button.addEventListener('click', () => {
    buttons.forEach(item => item.classList.remove('active'));
    button.classList.add('active');
    const filter = button.dataset.filter;
    notes.forEach(note => {
      const product = note.querySelector('.meta')?.textContent || '';
      const show = filter === 'all'
        || (filter === 'delf_b2_writing' && product.includes('商品1'))
        || (filter === 'tef_tcf_canada' && product.includes('商品2'))
        || note.classList.contains(filter);
      note.style.display = show ? '' : 'none';
    });
  }));
</script>
</body>
</html>`;

const out = path.join(root, 'complete-acceptance-open.html');
fs.writeFileSync(out, html, 'utf8');
console.log(out);
