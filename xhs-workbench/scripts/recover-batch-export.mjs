import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const batchId = process.argv[2];
if (!batchId) throw new Error('usage: node scripts/recover-batch-export.mjs <batch_id>');

const outputDir = path.resolve(process.cwd(), 'recovered-exports', batchId, 'job-zips');
await fs.mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
page.setDefaultTimeout(180_000);

try {
  await page.goto(`http://localhost:4100/batch?batch_id=${encodeURIComponent(batchId)}`, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });

  const successCards = page.locator('div.border.border-neutral-200.bg-white.p-4').filter({
    has: page.getByRole('button', { name: '展开预览' }),
  });
  const total = await successCards.count();
  console.log(`RECOVERY_START ${batchId} ${total}`);

  for (let index = 0; index < total; index += 1) {
    // Cards reflow after expanding/collapsing, so resolve by the stable job id each time.
    const initialText = await successCards.nth(index).innerText();
    const jobId = initialText.match(/job_\d{3}/)?.[0];
    if (!jobId) throw new Error(`cannot resolve job id at index ${index}`);

    const target = path.join(outputDir, `${jobId}.zip`);
    try {
      await fs.access(target);
      console.log(`RECOVERY_SKIP ${index + 1}/${total} ${jobId}`);
      continue;
    } catch {
      // Missing file is the normal path.
    }

    const card = page.locator('div.border.border-neutral-200.bg-white.p-4').filter({ hasText: jobId }).first();
    await card.getByRole('button', { name: '展开预览' }).click();
    await page.evaluate(() => document.fonts.ready);

    const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
    await card.getByRole('button', { name: '打包下载全部（封面+内页）' }).click();
    const download = await downloadPromise;
    await download.saveAs(target);

    const collapse = card.getByRole('button', { name: '收起' });
    if (await collapse.count()) await collapse.click();
    console.log(`RECOVERY_DONE ${index + 1}/${total} ${jobId}`);
  }

  console.log(`RECOVERY_COMPLETE ${outputDir}`);
} finally {
  await browser.close();
}
