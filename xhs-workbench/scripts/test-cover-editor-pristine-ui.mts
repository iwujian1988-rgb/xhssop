import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const batchId = 'batch_1788907160212';
const fixturePath = `data/batches/${batchId}/jobs/job_001.json`;
const job = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
job.draft.coverEditStates = undefined;
job.draft.cover_edit_meta = undefined;
const output = path.resolve('data/cover-editor-pristine-ui');
await fs.mkdir(output, { recursive: true });

const browser = await chromium.launch({ headless: true });
let saveCalls = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/api/batch**', async route => {
    if (route.request().method() === 'POST') {
      saveCalls++;
      await route.fulfill({ json: { job } });
      return;
    }
    await route.fulfill({ json: {
      batch: { id: batchId, product_id: job.product_id, content_mode: 'standard', status: 'done', created_at: job.created_at, jobs: [job.id] },
      jobs: [job], active_runner: null,
    } });
  });
  await page.goto(`http://localhost:3000/batch?batch_id=${batchId}`);
  const editButton = page.getByRole('button', { name: '修改当前封面文字', exact: true });
  if (!await editButton.count()) await page.getByRole('button', { name: /成品池/ }).click();
  const cover = page.locator('[data-cover-visual]').first();
  await cover.waitFor();
  assert.equal(await cover.locator('[data-cover-block-id]').count(), 0, 'pristine final preview must use the original renderer');
  await cover.screenshot({ path: path.join(output, '01-pristine-final.png') });

  await editButton.click();
  await page.waitForTimeout(250);
  const editor = page.locator('.cover-editor-canvas').first();
  assert.equal(await editor.locator('[data-cover-source-hidden]').count(), 0, 'opening edit mode must not hide or redraw unchanged source text');
  const overlays = editor.locator('[data-cover-block-id]');
  assert.ok(await overlays.count() >= 2);
  const visibleOverlayCount = await overlays.evaluateAll(nodes => nodes.filter(node => getComputedStyle(node).opacity !== '0').length);
  assert.equal(visibleOverlayCount, 0, 'unchanged editor hitboxes must be transparent');
  assert.equal(saveCalls, 0, 'opening the editor must not persist a synthetic edit');
  await editor.screenshot({ path: path.join(output, '02-editor-open-pristine.png') });

  const sourceTitle = editor.locator('[data-cover-source-block-id="coverTitle"]');
  const originalStyle = await sourceTitle.evaluate(node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { fontFamily: style.fontFamily, fontSize: Number.parseFloat(style.fontSize), fontWeight: style.fontWeight, lineHeight: Number.parseFloat(style.lineHeight), left: rect.left, top: rect.top };
  });
  await page.getByRole('button', { name: /^title\s/ }).first().click();
  await page.getByRole('textbox', { name: '文字', exact: true }).fill('B2议论文骨架速查');
  await page.waitForTimeout(80);
  const editedTitle = editor.locator('[data-cover-block-id="coverTitle"]');
  const editedStyle = await editedTitle.evaluate(node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { opacity: style.opacity, fontFamily: style.fontFamily, fontSize: Number.parseFloat(style.fontSize), fontWeight: style.fontWeight, lineHeight: Number.parseFloat(style.lineHeight), left: rect.left, top: rect.top };
  });
  assert.equal(editedStyle.opacity, '1');
  assert.equal(editedStyle.fontFamily, originalStyle.fontFamily);
  assert.ok(Math.abs(editedStyle.fontSize - originalStyle.fontSize) <= 1);
  assert.equal(editedStyle.fontWeight, originalStyle.fontWeight);
  assert.ok(Math.abs(editedStyle.lineHeight - originalStyle.lineHeight) <= 1);
  assert.ok(Math.abs(editedStyle.left - originalStyle.left) <= 1);
  assert.ok(Math.abs(editedStyle.top - originalStyle.top) <= 1);
  await editor.screenshot({ path: path.join(output, '03-title-edited-style-preserved.png') });
  console.log('PASS: original renderer remains visually authoritative until a real edit occurs; opening editor performs no write.');
} finally {
  await browser.close();
}
