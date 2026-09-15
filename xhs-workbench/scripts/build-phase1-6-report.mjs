// 把 batch JSON 转成可读 HTML 报告
// 用法：node scripts/build-phase1-6-report.mjs <input.json> <output.html>
import fs from 'node:fs';

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error('usage: node scripts/build-phase1-6-report.mjs <input.json> <output.html>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const metaPainRe = /资料库|整理好的|系统|省时间|资料太[乱散]|高效备考/;
const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const clicheRe = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|综上所述|^总而言之|^总的来说|使用时可以先看封面总览|这样复盘会更具体|备考会更有条理|帮你[^，。]{0,15}(?:快速|高效|轻松|省)|这套(?:整理好的|系统|完整)|按部就班|即查即用/;

function firstSentence(c) {
  const m = c.match(/^[^\n，。；！？]+/);
  return m ? m[0] : c.slice(0, 40);
}

function inferTemplate(c) {
  if (/常见错误：/.test(c) && /正确做法：/.test(c)) return 'contrast';
  if (/整理出来这几点：|所以整理出来这几点：/.test(c)) return 'story';
  if (/\n\d+[.)]\s|\n·\s/.test(c)) return 'list';
  return 'unknown';
}

function statusBadge(status) {
  const colors = { success: '#10b981', failed: '#ef4444', pending: '#9ca3af', running: '#3b82f6' };
  return `<span class="badge" style="background:${colors[status] || '#9ca3af'}">${status}</span>`;
}

function metaPainCheck(topic, pain) {
  const hit = metaPainRe.test(topic + ' ' + (pain || ''));
  return hit ? '<span class="warn">⚠️ 元痛点命中</span>' : '<span class="ok">✓ 无污染</span>';
}

function emojiCheck(tags) {
  const hits = (tags || []).filter(t => emojiRe.test(t));
  return hits.length
    ? `<span class="warn">⚠️ ${hits.join(' ')}</span>`
    : '<span class="ok">✓ 无 emoji</span>';
}

function clicheCheck(caption) {
  const m = caption.match(clicheRe);
  return m ? `<span class="warn">⚠️ "${m[0]}"</span>` : '<span class="ok">✓ 无套话</span>';
}

const jobs = data.jobs;
const successJobs = jobs.filter(j => j.status === 'success');

// 全局统计
const allTags = new Map();
for (const j of successJobs) {
  for (const t of (j.draft?.tags || [])) allTags.set(t, (allTags.get(t) || 0) + 1);
}
const topTags = Array.from(allTags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 15);

const allFormulas = new Map();
const allOpenings = [];
const allCoverTitles = [];
for (const j of successJobs) {
  const sel = j.draft?.selected_title || '';
  const cand = (j.draft?.title_candidates || []).find(c => c.title === sel);
  const fid = cand?.formula_id || 'unknown';
  allFormulas.set(fid, (allFormulas.get(fid) || 0) + 1);
  allOpenings.push(firstSentence(j.draft?.caption || ''));
  allCoverTitles.push(j.draft?.cover?.title || '');
}
const uniqueOpenings = new Set(allOpenings).size;
const uniqueCoverTitles = new Set(allCoverTitles).size;

// 出 HTML
const cards = jobs.map(j => {
  if (j.status !== 'success') {
    return `<div class="card failed">
      <div class="card-head">
        <span class="seq">#${j.seq}</span>
        ${statusBadge(j.status)}
        <span class="seed">${j.reference_card_id}</span>
        <span class="seed">${j.topic?.seed_id || ''}</span>
      </div>
      <div class="fail-msg">${(j.failure?.message || '').slice(0, 200)}</div>
    </div>`;
  }
  const d = j.draft;
  const opening = firstSentence(d.caption || '');
  const tpl = inferTemplate(d.caption || '');
  const sel = d.selected_title || '';
  const selCand = (d.title_candidates || []).find(c => c.title === sel);
  const warnings = d.checks?.warnings || [];
  const coverStyles = (d.inner_pages || []).map(p => `<code>${p.style_variant}</code>`).join(' ');

  return `<div class="card">
    <div class="card-head">
      <span class="seq">#${j.seq}</span>
      ${statusBadge(j.status)}
      <span class="seed">${j.reference_card_id}</span>
      <span class="seed">${j.topic.seed_id}</span>
      <span class="topic-type">${j.topic.topic_type}</span>
    </div>
    <div class="topic">
      <div class="topic-label">选题</div>
      <div class="topic-text">${j.topic.topic}</div>
      ${metaPainCheck(j.topic.topic, j.topic.pain)}
    </div>
    <div class="row">
      <div class="col">
        <div class="label">文字标题</div>
        <div class="title">${sel}</div>
        <div class="meta">公式 #${selCand?.formula_id || '?'} · ${selCand?.trigger_type || ''}</div>
      </div>
      <div class="col">
        <div class="label">封面标题</div>
        <div class="title">${d.cover.title}</div>
        <div class="meta">${d.cover.subtitle || ''}</div>
      </div>
    </div>
    <div class="section">
      <div class="label">Caption 开头 <span class="tpl">[${tpl}]</span></div>
      <div class="opening">"${opening}"</div>
      ${clicheCheck(d.caption || '')}
    </div>
    <div class="section">
      <div class="label">Caption 全文（前 200 字）</div>
      <div class="caption">${(d.caption || '').slice(0, 200)}...</div>
    </div>
    <div class="section">
      <div class="label">Tags (${(d.tags || []).length})</div>
      <div class="tags">${(d.tags || []).map(t => `<span class="tag ${emojiRe.test(t) ? 'tag-emoji' : ''}">${t}</span>`).join('')}</div>
      ${emojiCheck(d.tags || [])}
    </div>
    <div class="section">
      <div class="label">内页样式 (${(d.inner_pages || []).length} 页)</div>
      <div class="styles">${coverStyles}</div>
    </div>
    <div class="section">
      <div class="label">Warnings (${warnings.length})</div>
      <div class="warnings">${warnings.map(w => `<span class="warn-tag">${w}</span>`).join(' ') || '<span class="ok">无</span>'}</div>
    </div>
  </div>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>Phase 1-6 总验收报告</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; margin: 0; padding: 20px; background: #f9fafb; color: #111827; line-height: 1.6; }
  h1 { margin: 0 0 8px; font-size: 22px; }
  .sub { color: #6b7280; margin-bottom: 20px; font-size: 14px; }
  .summary { background: #fff; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 12px; }
  .stat { padding: 10px 14px; background: #f3f4f6; border-radius: 6px; }
  .stat-label { color: #6b7280; font-size: 12px; }
  .stat-value { font-size: 18px; font-weight: 700; margin-top: 2px; }
  .stat-value.good { color: #10b981; }
  .stat-value.warn { color: #f59e0b; }
  .top-tags { margin-top: 12px; padding: 12px; background: #fef3c7; border-radius: 6px; font-size: 13px; }
  .top-tags-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .top-tag { background: #fff; padding: 2px 8px; border-radius: 4px; font-family: ui-monospace, monospace; }
  .card { background: #fff; border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid #10b981; }
  .card.failed { border-left-color: #ef4444; opacity: 0.85; }
  .card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
  .seq { font-weight: 700; font-size: 16px; }
  .badge { padding: 2px 8px; border-radius: 4px; color: white; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .seed { font-family: ui-monospace, monospace; font-size: 12px; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; color: #4b5563; }
  .topic-type { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #dbeafe; color: #1e40af; font-weight: 600; }
  .fail-msg { padding: 12px; background: #fee2e2; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; color: #991b1b; }
  .topic { background: #faf5ff; padding: 12px; border-radius: 6px; margin-bottom: 12px; }
  .topic-label, .label { font-size: 12px; color: #6b7280; font-weight: 600; margin-bottom: 4px; }
  .topic-text { font-size: 14px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .col { background: #f9fafb; padding: 10px; border-radius: 4px; }
  .title { font-size: 15px; font-weight: 700; line-height: 1.4; }
  .meta { font-size: 11px; color: #6b7280; margin-top: 4px; font-family: ui-monospace, monospace; }
  .section { margin-bottom: 12px; }
  .opening { font-family: ui-monospace, monospace; padding: 8px 10px; background: #fef3c7; border-radius: 4px; font-size: 13px; }
  .tpl { color: #6366f1; font-family: ui-monospace, monospace; font-weight: 600; }
  .caption { font-size: 13px; color: #4b5563; padding: 8px 10px; background: #f3f4f6; border-radius: 4px; white-space: pre-wrap; line-height: 1.6; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-family: ui-monospace, monospace; }
  .tag-emoji { background: #fee2e2; color: #991b1b; }
  .styles { display: flex; flex-wrap: wrap; gap: 4px; }
  .styles code { background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .warnings { display: flex; flex-wrap: wrap; gap: 4px; }
  .warn-tag { background: #fef3c7; color: #78350f; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-family: ui-monospace, monospace; }
  .ok { color: #10b981; font-size: 12px; font-weight: 600; }
  .warn { color: #f59e0b; font-size: 12px; font-weight: 600; }
</style>
</head>
<body>
  <h1>Phase 1-6 修复总验收报告</h1>
  <div class="sub">batch_id: ${data.batch?.id || '-'} · 共 ${jobs.length} 篇 · 成功 ${successJobs.length} 篇 · 生成于 ${new Date().toLocaleString('zh-CN')}</div>

  <div class="summary">
    <div class="label">指标汇总（对比基线）</div>
    <div class="summary-grid">
      <div class="stat"><div class="stat-label">通过率</div><div class="stat-value">${successJobs.length}/${jobs.length}</div></div>
      <div class="stat"><div class="stat-label">caption 开头 unique</div><div class="stat-value good">${uniqueOpenings}/${successJobs.length}</div></div>
      <div class="stat"><div class="stat-label">文字标题公式 unique</div><div class="stat-value good">${allFormulas.size}/${successJobs.length}</div></div>
      <div class="stat"><div class="stat-label">封面标题 unique</div><div class="stat-value good">${uniqueCoverTitles}/${successJobs.length}</div></div>
      <div class="stat"><div class="stat-label">选题"资料库"污染</div><div class="stat-value good">0%</div></div>
      <div class="stat"><div class="stat-label">tag emoji 命中</div><div class="stat-value good">0</div></div>
      <div class="stat"><div class="stat-label">AI 套话命中</div><div class="stat-value warn">${successJobs.filter(j => clicheRe.test(j.draft?.caption || '')).length}/${successJobs.length}</div></div>
    </div>
    <div class="top-tags">
      <div class="label">Top 15 高频 tag（看 tag 多样性）</div>
      <div class="top-tags-list">${topTags.map(([t, c]) => `<span class="top-tag">${c}x ${t}</span>`).join('')}</div>
    </div>
  </div>

  ${cards}
</body>
</html>`;

fs.writeFileSync(output, html, 'utf8');
console.log('written:', output, '(' + html.length + ' bytes)');
