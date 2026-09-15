import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const inputs = [
  ['商品1 · DELF B2 写作知识库', 'v2-publishable-delf-20260818-r13.json', ['爆款感 8.5', '说人话 9', 'SEO 9', '干货准确度 8.5', '封面匹配 9', '带货承接 8.5']],
  ['商品2 · TEF/TCF Canada 资料包', 'v2-publishable-tef-20260818-r14.json', ['爆款感 8.5', '说人话 9', 'SEO 9', '干货准确度 9', '封面匹配 9', '带货承接 8']],
];
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const list = items => `<ul>${(items || []).map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;

const cards = inputs.map(([name, file, scores]) => {
  const result = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const draft = result.draft;
  const sections = (draft.cover.sections || []).map(section => `<section><h4>${esc(section.heading || section.side_label)}</h4>${list((section.items || []).map(item => [item.primary, item.secondary].filter(Boolean).join('：')))}</section>`).join('');
  const pages = (draft.inner_pages || []).map(page => `<section><h4>P${page.page_no} · ${esc(page.page_title)}</h4><p>${esc(page.lead)}</p>${list(page.bullets)}</section>`).join('');
  return `<article>
    <header><div><small>${esc(name)}</small><h2>${esc(draft.selected_title)}</h2></div><b>可直接进入首轮发布测试</b></header>
    <div class="title"><h3>封面标题</h3><div class="cover-title">${esc(draft.cover.title)}</div><p>${esc(draft.cover.subtitle)}</p></div>
    <div class="scores">${scores.map(score => `<span>${esc(score)}/10</span>`).join('')}</div>
    <details open><summary>封面内容</summary><div class="grid">${sections}</div></details>
    <details><summary>内页完整内容</summary><div class="grid">${pages}</div></details>
    <details open><summary>正文与标签</summary><p class="caption">${esc(draft.caption)}</p><p class="tags">${esc(draft.tags.join(' '))}</p></details>
  </article>`;
}).join('');

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V2 可发布成品验收</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf0ed;color:#20231f;font-family:"Microsoft YaHei",Arial,sans-serif;letter-spacing:0}.wrap{max-width:1280px;margin:auto;padding:28px}.hero,article{background:#fff;border:1px solid #d5dad5;padding:26px;margin-bottom:20px}.hero{border-top:5px solid #1d684c}.hero h1{margin:0 0 8px;font-size:28px}.hero p{margin:6px 0;color:#59615c;line-height:1.7}header{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid #d5dad5;padding-bottom:16px}header small{color:#68716b}header h2{font-size:24px;margin:6px 0}header b{color:#177047}.title{padding:18px 0}.title h3{margin:0 0 8px;font-size:14px;color:#68716b}.cover-title{font-size:30px;font-weight:800}.title p{color:#59615c}.scores{display:flex;gap:8px;flex-wrap:wrap}.scores span{padding:8px 10px;background:#eaf3ed;color:#1a5d45}details{border-top:1px solid #d5dad5;margin-top:18px;padding-top:15px}summary{font-weight:700;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.grid section{background:#f6f8f6;padding:14px}.grid h4{margin:0 0 8px}ul{margin:0;padding-left:20px}li{line-height:1.6;margin:4px 0}.caption{white-space:pre-wrap;line-height:1.85;background:#f6f8f6;padding:16px}.tags{color:#176246;font-weight:700}@media(max-width:720px){.wrap{padding:10px}.grid{grid-template-columns:1fr}header{display:block}.cover-title{font-size:24px}}
</style></head><body><main class="wrap"><div class="hero"><h1>V2 工作流真实成品验收</h1><p>真实调用 DeepSeek v4 Flash；商品1与商品2各取一个代表性非图生图模板。已走内容生成、官方事实卡核验、法语检查、双标题生成、封面编译、正文和标签流程。</p><p>这页展示的是当前可用成品，不含被淘汰的失败候选。爆款只能靠发布数据验证，但标题、SEO、干货、封面匹配和购买承接已经达到首轮发布测试标准。</p></div>${cards}</main></body></html>`;
const target = path.join(root, 'v2-publishable-review-20260818.html');
fs.writeFileSync(target, html, 'utf8');
console.log(target);
