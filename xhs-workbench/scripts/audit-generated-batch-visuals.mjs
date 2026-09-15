/* eslint-disable no-console */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4100';
const batchIds = (process.env.BATCH_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
if (!batchIds.length) throw new Error('BATCH_IDS is required');
const outDir = process.env.VISUAL_AUDIT_DIR || path.join(os.tmpdir(), `xhs-generated-visuals-${Date.now()}`);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, deviceScaleFactor: 1 });
const report = [];

for (const batchId of batchIds) {
  await page.goto(`${baseUrl}/batch?batch_id=${encodeURIComponent(batchId)}`, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.evaluate(() => document.fonts?.ready);
  const count = await page.getByRole('button', { name: '展开预览' }).count();
  for (let index = 0; index < count; index += 1) {
    // 点击后按钮会变成“收起”，所以每次取剩余集合里的第一项。
    const button = page.getByRole('button', { name: '展开预览' }).first();
    const card = button.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," ")," p-4 ") and contains(concat(" ",normalize-space(@class)," ")," bg-white ")][1]');
    const name = (await card.locator('div.mt-1.font-bold').first().textContent())?.trim() || `${batchId}-${index + 1}`;
    const articleCountBefore = await page.locator('article').count();
    await button.click();
    await page.waitForTimeout(250);
    const articles = page.locator('article');
    if (await articles.count() <= articleCountBefore) {
      report.push({ batchId, name, hasCover: false });
      continue;
    }
    const cover = articles.nth(articleCountBefore);
    const metrics = await cover.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollWidth: node.scrollWidth,
        scrollHeight: node.scrollHeight,
      };
    });
    const safe = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 70);
    const file = path.join(outDir, `${batchId}-${String(index + 1).padStart(2, '0')}-${safe}.png`);
    await cover.screenshot({ path: file });
    report.push({ batchId, name, hasCover: true, file, ...metrics });
  }
}

await browser.close();
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ outDir, report }, null, 2));
