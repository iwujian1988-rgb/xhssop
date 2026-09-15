import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = JSON.parse(fs.readFileSync(path.join(root, 'v2-real-acceptance-composed.json'), 'utf8'));

const productNames = {
  delf_b2_writing: '商品1：DELF B2 写作知识库',
  tef_tcf_canada: '商品2：TEF/TCF Canada 资料包',
};

const cardNames = {
  resource_01_grammar_parchment_red: '羊皮纸语法体系大目录',
  resource_04_chalkboard_phrase_list: '黑板短语密集表',
  resource_06_notes_course_offer: '备忘录课程说明页',
  resource_10_plain_text_experience: '极简真人经验正文',
  resource_11_delf_doc_analysis: 'DELF 素材文档解析',
};

const evaluations = {
  'delf_b2_writing|resource_01_grammar_parchment_red': {
    status: '不可发', scores: [6, 7, 8, 5, 5, 5],
    issues: ['封面标题右侧被裁切，小图无法完整阅读', '商品原始目录为20篇范文，成品写成22篇，商品事实冲突', '“一段多写30-50词”等数字缺少可靠依据', '正文只有60字左右，无法承接封面的大信息量'],
  },
  'tef_tcf_canada|resource_01_grammar_parchment_red': {
    status: '不可发', scores: [7, 7, 8, 2, 7, 5],
    issues: ['TEF/TCF题型、出分和移民认可等多处说法可疑或错误', '出现“TEF图表分析”等不符合TEF Canada写作题型的内容', '资料承接建立在错误考试信息上，容易误导购买'],
  },
  'delf_b2_writing|resource_04_chalkboard_phrase_list': {
    status: '小改可发', scores: [7, 8, 8, 8, 8, 5],
    issues: ['封面可读性和模板匹配最好', '正文仍明显过短，需补充用法边界和购买承接', '发布前复核法语搭配及例句即可'],
  },
  'tef_tcf_canada|resource_04_chalkboard_phrase_list': {
    status: '不可发', scores: [5, 6, 6, 4, 4, 4],
    issues: ['黑板“短语表”模板里放的是考试说明，不是可直接学习的短语', '底部文字被截断', '考试认可和题型描述仍需事实复核'],
  },
  'delf_b2_writing|resource_06_notes_course_offer': {
    status: '不可发', scores: [6, 7, 8, 5, 6, 4],
    issues: ['封面标题以省略号收尾，像未生成完', '再次出现22篇范文的商品数量错误', '正文过短，资料展示和购买理由不足'],
  },
  'tef_tcf_canada|resource_06_notes_course_offer': {
    status: '不可发', scores: [7, 7, 8, 3, 8, 7],
    issues: ['视觉与标题相对完整', '考试事实仍有明显风险', '“私信领取12份资料”与付费商品定位冲突，可能造成免费预期'],
  },
  'delf_b2_writing|resource_10_plain_text_experience': {
    status: '不可发', scores: [6, 6, 8, 4, 6, 4],
    issues: ['页面留白过多，信息价值感不足', '出现双标点和不自然句式', '把官方评分简化为“5个维度”等说法不严谨', '真人经验口吻不够真实'],
  },
  'tef_tcf_canada|resource_10_plain_text_experience': {
    status: '不可发', scores: [7, 7, 8, 3, 7, 6],
    issues: ['视觉干净但内容太稀', '使用体验口吻包装了未经核实的考试结论', '正文没有提供足够决策依据'],
  },
  'delf_b2_writing|resource_11_delf_doc_analysis': {
    status: '不可发', scores: [6, 7, 7, 3, 6, 4],
    issues: ['封面主标题缺少DELF B2身份，搜索识别弱', '存在双标点', '建议使用个人例子或统计数据，但没有提醒不得编造数据', '正文仅41字，无法称为素材解析'],
  },
  'tef_tcf_canada|resource_11_delf_doc_analysis': {
    status: '不可发', scores: [7, 7, 8, 2, 6, 6],
    issues: ['TCF口试形式、出分速度、口音等关键事实存在明显错误或误导', '内容很密但错误信息越多风险越高', '封面和标题看似专业，反而会放大误导'],
  },
};

const screenshots = new Map([
  ['delf_b2_writing|resource_01_grammar_parchment_red', '01__delf_b2_writing__resource_01_grammar_parchment_red__job_001.png'],
  ['tef_tcf_canada|resource_01_grammar_parchment_red', '02__tef_tcf_canada__resource_01_grammar_parchment_red__job_001.png'],
  ['delf_b2_writing|resource_04_chalkboard_phrase_list', '03__delf_b2_writing__resource_04_chalkboard_phrase_list__job_001.png'],
  ['tef_tcf_canada|resource_04_chalkboard_phrase_list', '04__tef_tcf_canada__resource_04_chalkboard_phrase_list__job_001.png'],
  ['delf_b2_writing|resource_06_notes_course_offer', '05__delf_b2_writing__resource_06_notes_course_offer__job_001.png'],
  ['tef_tcf_canada|resource_06_notes_course_offer', '06__tef_tcf_canada__resource_06_notes_course_offer__job_001.png'],
  ['delf_b2_writing|resource_10_plain_text_experience', '07__delf_b2_writing__resource_10_plain_text_experience__job_001.png'],
  ['tef_tcf_canada|resource_10_plain_text_experience', '08__tef_tcf_canada__resource_10_plain_text_experience__job_001.png'],
  ['delf_b2_writing|resource_11_delf_doc_analysis', '09__delf_b2_writing__resource_11_delf_doc_analysis__job_001.png'],
  ['tef_tcf_canada|resource_11_delf_doc_analysis', '10__tef_tcf_canada__resource_11_delf_doc_analysis__job_001.png'],
]);

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const msBetween = (a, b) => a && b ? Math.max(0, new Date(b) - new Date(a)) : 0;
const fmtSeconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const list = (items) => `<ul>${(items || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
const statusClass = (status) => status === '可直接发' ? 'good' : status === '小改可发' ? 'warn' : 'bad';

const cards = source.jobs.map((job, index) => {
  const key = `${job.product_id}|${job.reference_card_id}`;
  const evaluation = evaluations[key];
  const draft = job.draft || {};
  const cover = draft.cover || {};
  const artifacts = job.artifacts || {};
  const contentAt = artifacts.content?.created_at;
  const topicAt = artifacts.selectedTopic?.created_at;
  const titleAt = artifacts.titles?.created_at;
  const compiledAt = artifacts.compiledDraft?.created_at;
  const warnings = [...new Set([
    ...(job.warnings || []),
    ...(artifacts.content?.warnings || []),
    ...(artifacts.titles?.warnings || []),
    ...(draft.checks?.warnings || []),
  ])];
  const scoreNames = ['爆款感', '说人话', 'SEO', '干货准确度', '封面匹配', '带货承接'];
  const scoreRows = scoreNames.map((name, i) => `<span><b>${name}</b> ${evaluation.scores[i]}/10</span>`).join('');
  const sections = (cover.sections || []).map((section) => `
    <div class="section-block"><h5>${esc(section.heading || section.side_label)}</h5>
    ${list((section.items || []).map((item) => [item.primary, item.secondary, item.note].filter(Boolean).join('：')))}</div>`).join('');
  const pages = (draft.inner_pages || []).map((page) => `
    <div class="page-block"><h5>P${esc(page.page_no)} · ${esc(page.page_title)}</h5>
    <p>${esc(page.lead)}</p>${list(page.bullets)}</div>`).join('');
  const screenshot = screenshots.get(key);

  return `<article class="job">
    <header><div><div class="eyebrow">#${index + 1} · ${esc(productNames[job.product_id])}</div><h2>${esc(cardNames[job.reference_card_id])}</h2></div>
    <strong class="status ${statusClass(evaluation.status)}">${evaluation.status}</strong></header>
    <div class="grid">
      <div><img class="cover" src="v2-real-screenshots/${esc(screenshot)}" alt="封面截图"></div>
      <div class="meta">
        <h3>任务单</h3>
        <p><b>选题：</b>${esc(job.topic?.topic)}</p>
        <p><b>人群：</b>${esc(job.topic?.audience)}</p>
        <p><b>痛点：</b>${esc(job.topic?.pain)}</p>
        <p><b>内容承诺：</b>${esc(job.topic?.content_promise)}</p>
        <p><b>商品承接：</b>${esc(job.topic?.product_bridge)}</p>
        <p><b>SEO：</b>${esc((job.topic?.search_terms || []).join(' / '))}</p>
        <h3>标题</h3>
        <p><b>文字标题：</b>${esc(draft.selected_title)}</p>
        <p><b>封面标题：</b>${esc(cover.title)}</p>
        <p><b>封面副标题：</b>${esc(cover.subtitle)}</p>
        <div class="scores">${scoreRows}</div>
        <h3>三视角验收</h3>${list(evaluation.issues)}
      </div>
    </div>
    <details><summary>展开完整成品内容</summary>
      <div class="detail-grid"><section><h4>封面数据</h4>${sections || '<p>无</p>'}</section>
      <section><h4>内页</h4>${pages || '<p>无</p>'}</section></div>
      <h4>正文（${[...String(draft.caption || '')].length}字）</h4><p class="caption">${esc(draft.caption)}</p>
      <h4>标签</h4><p>${esc((draft.tags || []).join(' '))}</p>
    </details>
    <footer>
      <span>内容+审核 ${fmtSeconds(msBetween(topicAt, contentAt))}</span>
      <span>标题 ${fmtSeconds(msBetween(contentAt, titleAt))}</span>
      <span>编译 ${fmtSeconds(msBetween(titleAt, compiledAt))}</span>
      <span>调用 ${job.usage?.calls || 0} 次</span>
      <span>Token ${Number(job.usage?.total_tokens || 0).toLocaleString()}</span>
      <span>提醒 ${warnings.length} 条</span>
    </footer>
    ${warnings.length ? `<div class="warnings"><b>系统提醒：</b>${warnings.map(esc).join('；')}</div>` : ''}
  </article>`;
}).join('');

const acceptedComposeTokens = source.jobs.reduce((sum, job) => sum + Number(job.usage?.total_tokens || 0), 0);
const acceptedComposeCalls = source.jobs.reduce((sum, job) => sum + Number(job.usage?.calls || 0), 0);
const planTokens = 36166;
const planCalls = 10;
const totals = { tokens: planTokens + acceptedComposeTokens, calls: planCalls + acceptedComposeCalls };
const statuses = source.jobs.reduce((acc, job) => {
  const status = evaluations[`${job.product_id}|${job.reference_card_id}`].status;
  acc[status] = (acc[status] || 0) + 1;
  return acc;
}, {});

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>V2 DeepSeek 真实链路验收</title><style>
:root{color-scheme:light;--ink:#202322;--muted:#666d69;--line:#d7dcd9;--paper:#f5f7f5;--accent:#145a43;--bad:#a82e2e;--warn:#9a6100;--good:#167443}*{box-sizing:border-box}body{margin:0;background:#e9eeeb;color:var(--ink);font-family:"Microsoft YaHei",Arial,sans-serif;letter-spacing:0}.wrap{max-width:1500px;margin:auto;padding:28px}.hero{background:#fff;border-bottom:4px solid var(--accent);padding:28px 32px;margin-bottom:22px}.hero h1{margin:0 0 8px;font-size:30px}.hero p{margin:7px 0;color:var(--muted)}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}.stat{background:#eef4f0;border:1px solid #cddbd3;padding:12px 16px}.blockers{background:#fff4eb;border:1px solid #e7b98e;padding:18px 22px;margin-top:18px}.job{background:white;border:1px solid var(--line);margin:20px 0;padding:24px}.job>header{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:1px solid var(--line);padding-bottom:16px}.job h2{margin:5px 0 0;font-size:24px}.eyebrow{font-size:13px;color:var(--muted)}.status{padding:7px 12px;border:1px solid currentColor}.status.bad{color:var(--bad)}.status.warn{color:var(--warn)}.status.good{color:var(--good)}.grid{display:grid;grid-template-columns:minmax(300px,440px) 1fr;gap:28px;padding-top:20px}.cover{display:block;width:100%;max-height:680px;object-fit:contain;background:#f2f2f2;border:1px solid var(--line)}h3{font-size:16px;margin:14px 0 6px;color:var(--accent)}.meta p{margin:7px 0;line-height:1.65}.scores{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr));gap:8px;margin:14px 0}.scores span{background:var(--paper);padding:9px}ul{margin:7px 0;padding-left:22px}li{margin:5px 0;line-height:1.55}details{border-top:1px solid var(--line);margin-top:20px;padding-top:16px}summary{cursor:pointer;font-weight:700;color:var(--accent)}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.section-block,.page-block{border-bottom:1px solid var(--line);padding:7px 0}.section-block h5,.page-block h5{margin:5px 0;font-size:15px}.caption{white-space:pre-wrap;line-height:1.75;background:var(--paper);padding:14px}footer{display:flex;gap:14px;flex-wrap:wrap;border-top:1px solid var(--line);margin-top:16px;padding-top:12px;color:var(--muted);font-size:13px}.warnings{margin-top:10px;padding:10px;background:#fff7df;color:#705000}@media(max-width:800px){.wrap{padding:10px}.grid,.detail-grid{grid-template-columns:1fr}.scores{grid-template-columns:1fr 1fr}.job{padding:16px}}
</style></head><body><main class="wrap"><section class="hero"><h1>V2 DeepSeek 真实前台链路验收</h1>
<p>模型：${esc(source.model || 'deepseek-v4-flash')} · 2 个商品 × 5 个非图生图模板 · 每篇均走选题→内容/审核→标题→编译，与前台 V2 API 同链路。</p>
<div class="stats"><div class="stat"><b>10/10</b><br>技术生成成功</div><div class="stat"><b>${statuses['可直接发'] || 0}</b><br>可直接发</div><div class="stat"><b>${statuses['小改可发'] || 0}</b><br>小改可发</div><div class="stat"><b>${statuses['不可发'] || 0}</b><br>不可发</div><div class="stat"><b>${totals.calls}</b><br>有效调用</div><div class="stat"><b>${totals.tokens.toLocaleString()}</b><br>有效 Token</div></div>
<p>选题阶段 ${planCalls} 次 / ${planTokens.toLocaleString()} token；10篇成品阶段 ${acceptedComposeCalls} 次 / ${acceptedComposeTokens.toLocaleString()} token。调试期间失败调用因旧持久化缺陷无法完整追溯，未计入上述有效成本；现已补上失败阶段 usage 记录。</p>
<div class="blockers"><b>发布阻断结论：</b>当前 V2 是“能生成”，还不是“能稳定发布”。主要根因：考试事实审核只覆盖法语片段，没有可靠核验中文考试规则；商品事实存在20/22篇冲突；正文长度要求未成为硬门槛；内容提醒没有完整透传到最终成品；渲染器实际宽度未进入标题容量判断；同商品跨模板选题缺少全局去重，导致TEF/TCF五篇高度集中在“选哪个考试”。</div></section>${cards}</main></body></html>`;

const target = path.join(root, 'v2-real-acceptance.html');
fs.writeFileSync(target, html, 'utf8');
console.log(target);
console.log(JSON.stringify({ jobs: source.jobs.length, statuses, planTokens, acceptedComposeTokens, totalTokens: totals.tokens, totalCalls: totals.calls }, null, 2));
