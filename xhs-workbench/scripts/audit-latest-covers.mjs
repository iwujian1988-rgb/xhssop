import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const batchId = process.argv[2];
const outputDir = path.resolve(process.cwd(), 'audit-current');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.goto(`http://localhost:4100/batch?batch_id=${batchId}`, { waitUntil: 'networkidle', timeout: 60_000 });

const rows = [];
for (let seq = 1; seq <= 26; seq += 1) {
  if (seq === 13) continue;
  const id = `job_${String(seq).padStart(3, '0')}`;
  const card = page.locator('div.border.border-neutral-200.bg-white.p-4').filter({ hasText: id }).first();
  await card.getByRole('button', { name: '展开预览' }).click();
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(outputDir, `${id}.png`);
  await card.locator('article').first().screenshot({ path: file });
  rows.push({ id, file });
  await card.getByRole('button', { name: '收起' }).click();
}

const sheet = await browser.newPage({ viewport: { width: 1500, height: 1900 } });
const cards = rows.map(({ id, file }) => {
  const data = fs.readFileSync(file).toString('base64');
  return `<figure><img src="data:image/png;base64,${data}"><figcaption>${id}</figcaption></figure>`;
}).join('');
await sheet.setContent(`<style>
  body { margin: 20px; background: #d9d9d9; font-family: Arial, sans-serif; }
  main { display: grid; grid-template-columns: repeat(5, 1fr); gap: 18px; }
  figure { margin: 0; background: white; padding: 8px; box-shadow: 0 2px 8px #999; }
  img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: contain; }
  figcaption { text-align: center; font-weight: 700; margin-top: 6px; }
</style><main>${cards}</main>`);
await sheet.screenshot({ path: path.join(outputDir, 'contact-sheet.png'), fullPage: true });
await browser.close();
