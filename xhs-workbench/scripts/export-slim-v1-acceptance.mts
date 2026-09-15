import { chromium } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const [batchId, directory] = process.argv.slice(2);
if (!batchId || !directory) throw new Error('Usage: export-slim-v1-acceptance.mts batch_id output_directory');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(`http://localhost:4180/batch?batch_id=${encodeURIComponent(batchId)}`);
  const button = page.getByRole('button', { name: '一键导出全部（zip）', exact: true });
  await button.waitFor({ timeout: 30000 });
  const downloadPromise = page.waitForEvent('download', { timeout: 180000 });
  await button.click();
  const download = await downloadPromise;
  const archive = path.join(directory, 'actual-ui-export.zip');
  await download.saveAs(archive);
  const zip = await JSZip.loadAsync(await readFile(archive));
  const manifest: Array<{ name: string; bytes: number; width?: number; height?: number; path: string }> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const root = path.resolve(directory, 'actual-ui-export');
    const file = path.resolve(root, entry.name);
    if (!file.startsWith(root + path.sep)) throw new Error('Unsafe ZIP entry');
    const bytes = await entry.async('nodebuffer');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    manifest.push({ name: entry.name, bytes: bytes.length, path: file,
      ...(entry.name.endsWith('.png') ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : {}) });
  }
  await writeFile(path.join(directory, 'export-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ archive, manifest }));
} catch (error) {
  await writeFile(path.join(directory, 'export-error.txt'), String(error) + '\n' + await page.locator('body').innerText());
  throw error;
} finally {
  await browser.close();
}
