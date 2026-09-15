import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const inputPath = path.join(root, '.tmp-inner-page-minimal-fix-regression.json');
const outputDir = path.join(root, 'data', 'inner-page-minimal-fix-regression');
const data = JSON.parse(await fs.readFile(inputPath, 'utf8'));

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const labels = {
  A_argument_bank: 'A｜高频社会议题论据库',
  B_b1_vs_b2: 'B｜为什么 B2 作文总像 B1',
  C_register_switch: 'C｜正式信 / 议论文语域切换',
};

await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(inputPath, path.join(outputDir, 'regression-result.json'));

const browser = await chromium.launch({ headless: true });
for (const testCase of data.cases) {
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
  const cards = testCase.finalInnerPages.map((item, index) => `
    <article class="card">
      <div class="page-id">P${index + 2} · ${esc(item.pageId)}</div>
      <h2>${esc(item.page_title)}</h2>
      <p class="lead">${esc(item.lead)}</p>
      <ol>${(item.bullets ?? []).map((bullet) => `<li>${esc(bullet)}</li>`).join('')}</ol>
    </article>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{margin:0;background:#ece9e2;color:#17221a;font-family:"Microsoft YaHei","Noto Sans SC",Arial,sans-serif}
    main{width:1240px;padding:42px} header{background:#173d2a;color:white;padding:28px 34px;border-radius:20px;margin-bottom:28px}
    h1{font-size:34px;margin:0 0 10px;line-height:1.25}.meta{font-size:17px;opacity:.9}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start}
    .card{background:#fffdf8;border:1px solid #c9c1b3;border-radius:18px;padding:28px;min-height:680px;box-shadow:0 6px 20px rgba(30,35,28,.08)}
    .page-id{color:#8b3a2f;font-weight:800;font-size:15px;letter-spacing:.04em}h2{font-size:28px;line-height:1.25;margin:12px 0 14px;color:#173d2a}
    .lead{font-size:18px;line-height:1.55;margin:0 0 20px;padding-bottom:16px;border-bottom:2px solid #d8d0c3}
    ol{margin:0;padding-left:25px}li{font-size:16px;line-height:1.55;margin:0 0 14px;white-space:pre-wrap;overflow-wrap:anywhere}
    .qa{font-weight:800;color:${testCase.finalTeachingQa.status === 'PASS' ? '#1c7047' : '#b02a2a'}}
  </style></head><body><main><header><h1>${esc(labels[testCase.id] ?? testCase.id)}</h1><div class="meta">${esc(testCase.finalPublicTopic)}</div><div class="meta qa">Final Teaching QA: ${esc(testCase.finalTeachingQa.status)}</div></header><section class="grid">${cards}</section></main></body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: path.join(outputDir, `${testCase.id}-contact-sheet.png`), fullPage: true });
  await page.close();
}
await browser.close();

const md = [];
md.push('# INNER PAGE CONTENT MINIMAL FIX — REAL REGRESSION');
md.push('');
md.push(`- Generated at: ${data.generatedAt}`);
md.push(`- Model: ${data.model}`);
md.push('- Scope: Page Plan → Final Page Content → Final Teaching QA only');
for (const testCase of data.cases) {
  md.push('', `## ${labels[testCase.id] ?? testCase.id}`, '', `- Final Public Topic: ${testCase.finalPublicTopic}`, `- Final Teaching QA: ${testCase.finalTeachingQa.status}`, '');
  md.push('### canonical_page_plan', '');
  for (const plan of testCase.canonicalPagePlan) {
    md.push(`#### ${plan.pageId}`, '', `- pageGoal: ${plan.pageGoal}`, `- userGets: ${plan.userGets}`, `- pageContentPlan: ${plan.pageContentPlan}`, '');
  }
  md.push('### 最终内页文字', '');
  for (const item of testCase.finalInnerPages) {
    md.push(`#### P${item.page_no}｜${item.page_title}`, '', `Lead：${item.lead}`, '');
    (item.bullets ?? []).forEach((bullet, index) => md.push(`${index + 1}. ${bullet}`));
    md.push('');
  }
  md.push('### Final Teaching QA', '', '```json', JSON.stringify(testCase.finalTeachingQa, null, 2), '```', '');
}
await fs.writeFile(path.join(outputDir, 'regression-report.md'), md.join('\n'), 'utf8');
console.log(outputDir);
