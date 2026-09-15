import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const sourceDir = path.resolve('data/product-showcase/tcf-writing-7day');
const sourceNames = [
  '01-product-overview.png',
  '02-day1-training.png',
  '03-candidate-answer.png',
  '04-task-breakdown.png',
  '05-t3-example.png',
  '06-candidate-answer-2.png',
  '07-90-second-check.png',
  '08-day3-training.png',
];
const destination = path.resolve('public/generated-cover-backgrounds/tcf-writing-7day-product-library-collage.png');
const previewDestination = path.resolve('public/generated-cover-backgrounds/tcf-writing-7day-product-bridge-preview.png');

const images = await Promise.all(sourceNames.map(async (name) => {
  const data = await fs.readFile(path.join(sourceDir, name));
  return `data:image/png;base64,${data.toString('base64')}`;
}));

const thumbSlots = [
  [24, 24, 250, 300], [310, 24, 250, 300], [596, 24, 250, 300],
  [882, 24, 250, 300], [1168, 24, 250, 300],
  [24, 352, 250, 300], [310, 352, 250, 300], [596, 352, 250, 300],
];

const collageHtml = `<!doctype html><html><head><style>
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
await page.setContent(collageHtml);
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
  <div class="identity">TCF CANADA · 写作7天冲刺</div>
  <h1>TCF Canada写作7天急救锦囊</h1>
  <p class="lead">7天、7套原创训练，把T1/T2/T3最容易丢分的动作逐个纠正。</p>
  <p class="body-copy">从任务拆解、考生作答页到T3示范和90秒检查，每天只集中改一个关键动作。不是背模板，而是用改前改后对照，看清自己到底错在哪。</p>
  <footer>完整资料请点击下方链接查看 ⬇️⬇️⬇️⬇️⬇️</footer>
</section></div></body></html>`;

await page.setContent(previewHtml);
await page.setViewportSize({ width: 1080, height: 1440 });
await page.screenshot({ path: previewDestination, type: 'png' });
await browser.close();

console.log(destination);
console.log(previewDestination);
