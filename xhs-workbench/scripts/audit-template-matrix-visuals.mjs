/* eslint-disable no-console */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4100';
const outDir = process.env.VISUAL_AUDIT_DIR || path.join(os.tmpdir(), `xhs-template-visuals-${Date.now()}`);
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
await page.goto(`${baseUrl}/template-matrix`, { waitUntil: 'networkidle', timeout: 120_000 });
await page.evaluate(() => document.fonts?.ready);
await page.waitForTimeout(800);

const cards = page.locator('main .grid.gap-7 > section');
const count = await cards.count();
const report = [];
for (let index = 0; index < count; index += 1) {
  const card = cards.nth(index);
  const meta = await card.evaluate((node) => {
    const title = node.querySelector(':scope > div h2')?.textContent?.trim() || `card-${Date.now()}`;
    const cover = node.querySelector('article');
    if (!cover) return { title, hasCover: false };
    const rect = cover.getBoundingClientRect();
    const descendants = Array.from(cover.querySelectorAll('*'));
    const outside = descendants.filter((child) => {
      const style = getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const childRect = child.getBoundingClientRect();
      return childRect.left < rect.left - 2 || childRect.right > rect.right + 2
        || childRect.top < rect.top - 2 || childRect.bottom > rect.bottom + 2;
    });
    const textNodes = descendants.filter((child) => child.textContent?.trim() && child.children.length === 0);
    const fontSizes = textNodes.map((child) => Number.parseFloat(getComputedStyle(child).fontSize)).filter(Number.isFinite);
    return {
      title,
      hasCover: true,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      scrollWidth: cover.scrollWidth,
      scrollHeight: cover.scrollHeight,
      outsideCount: outside.length,
      outsideSamples: outside.slice(0, 5).map((child) => `${child.tagName}.${child.className}`),
      minimumTextPx: fontSizes.length ? Math.min(...fontSizes) : null,
    };
  });
  const safeName = `${String(index + 1).padStart(2, '0')}-${meta.title}`.replace(/[\\/:*?"<>|]/g, '-');
  await card.screenshot({ path: path.join(outDir, `${safeName}.png`) });
  report.push(meta);
}
await browser.close();
const summary = {
  total: report.length,
  missingCover: report.filter(item => !item.hasCover).length,
  scrollOverflow: report.filter(item => item.hasCover && (item.scrollWidth > item.width + 2 || item.scrollHeight > item.height + 2)).length,
  outsideOverflow: report.filter(item => item.outsideCount > 0).length,
  tinyText: report.filter(item => item.minimumTextPx !== null && item.minimumTextPx < 10).length,
};
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify({ summary, cards: report }, null, 2), 'utf8');
console.log(JSON.stringify({ outDir, summary, problems: report.filter(item => !item.hasCover || item.outsideCount || item.minimumTextPx < 10) }, null, 2));
