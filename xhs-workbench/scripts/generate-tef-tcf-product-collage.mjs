import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const sourceDir = path.resolve('data/product-showcase/tef-tcf-ca-clb');
const sourceNames = [
  '01-product-overview.png',
  '02-clb7-diagnosis.png',
  '03-writing-phrases.png',
  '04-writing-conclusion.png',
  '05-vocabulary.png',
  '06-listening.png',
  '07-speaking.png',
  '08-writing-samples.png',
];
const destination = path.resolve('public/generated-cover-backgrounds/tef-tcf-product-library-collage.png');
const previewDestination = path.resolve('public/generated-cover-backgrounds/tef-tcf-product-bridge-preview.png');

const images = await Promise.all(sourceNames.map(async (name) => {
  const data = await fs.readFile(path.join(sourceDir, name));
  return `data:image/png;base64,${data.toString('base64')}`;
}));

const thumbSlots = [
  [24, 24, 250, 300], [310, 24, 250, 300], [596, 24, 250, 300],
  [882, 24, 250, 300], [1168, 24, 250, 300],
  [24, 352, 250, 300], [310, 352, 250, 300], [596, 352, 250, 300],
];

const html = `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1454px; height: 1792px; overflow: hidden; }
  body { background: #e9ebea; font-family: Arial, sans-serif; }
  .canvas { position: relative; width: 1454px; height: 1792px; background: #e9ebea; }
  .tile { position: absolute; padding: 8px; background: #fff; box-shadow: 0 10px 24px rgba(40,48,48,.12); overflow: hidden; }
  .tile img { display: block; width: 100%; height: 100%; object-fit: contain; background: #fff; }
  .large { position: absolute; left: 24px; top: 690px; width: 640px; height: 1040px; padding: 12px; background: #fff; box-shadow: 0 14px 28px rgba(40,48,48,.14); overflow: hidden; }
  .large img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style></head><body><div class="canvas">
${thumbSlots.map(([x, y, w, h], index) => `<div class="tile" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><img src="${images[index]}" /></div>`).join('')}
<div class="large"><img src="${images[0]}" /></div>
</div></body></html>`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1454, height: 1792 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: destination, type: 'png' });
const collageData = await fs.readFile(destination);
const collageImage = `data:image/png;base64,${collageData.toString('base64')}`;
const previewHtml = `<!doctype html><html><head><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1080px; height: 1440px; overflow: hidden; }
  body { background: #ececeb; color: #2f2f2f; font-family: "PingFang SC", "Microsoft YaHei", Arial, sans-serif; }
  .canvas { position: relative; width: 1080px; height: 1440px; overflow: hidden; border: 1px solid #dedbd3; }
  .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; object-position: center; }
  .copy { position: absolute; right: 3.5%; top: 47%; width: 43%; text-align: left; }
  .identity { color: #b93535; font-size: 19px; font-weight: 700; letter-spacing: .12em; }
  h1 { margin: 4% 0 0; color: #171717; font-size: 50px; line-height: 1.16; font-weight: 900; text-shadow: 0 1px 0 rgba(255,255,255,.9); }
  .lead { margin: 5% 0 0; color: #d94716; font-size: 28px; line-height: 1.5; font-weight: 700; text-shadow: 0 1px 0 rgba(255,255,255,.95); }
  .body-copy { margin: 5% 0 0; color: #262626; font-size: 23px; line-height: 1.55; font-weight: 650; text-shadow: 0 1px 0 rgba(255,255,255,.95); }
  footer { display: inline; background: #ffe06a; color: #111; padding: 1% 2%; font-size: 25px; line-height: 1.65; font-weight: 900; }
</style></head><body><div class="canvas"><img class="bg" src="${collageImage}" /><section class="copy">
  <div class="identity">TEF / TCF CA · CLB 冲刺</div>
  <h1>TEF/TCF CA CLB冲刺实战笔记</h1>
  <p class="lead">从选考判断到四科训练，12份资料按备考阶段整理。</p>
  <p class="body-copy">先确认更适合 TEF 还是 TCF，再按听、读、说、写找到对应方法、题型、表达和练习计划。不用再四处拼资料，也不会把两场考试混成一场。</p>
  <footer>完整资料请点击下方链接查看 ⬇️⬇️⬇️⬇️⬇️</footer>
</section></div></body></html>`;
await page.setContent(previewHtml);
await page.setViewportSize({ width: 1080, height: 1440 });
await page.screenshot({ path: previewDestination, type: 'png' });
await browser.close();
console.log(destination);
console.log(previewDestination);
