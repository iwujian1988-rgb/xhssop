import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const batchId = 'batch_1788907160212';
const fixturePath = `data/batches/${batchId}/jobs/job_001.json`;
const original = await fs.readFile(fixturePath, 'utf8');
const job = JSON.parse(original);
const output = path.resolve('data/cover-editor-live-save-ui');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let saveCalls = 0;

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/api/batch**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      assert.equal(body.action, 'update_draft_state');
      assert.ok(body.cover_edit_state?.bundleId);
      saveCalls++;
      const blocks = body.cover_edit_state.blocks;
      const bundleId = body.cover_edit_state.bundleId;
      const title = blocks.find((block: any) => block.id === 'coverTitle')?.text;
      job.draft.cover.title = title;
      job.draft.coverEditStates = { ...(job.draft.coverEditStates || {}), [bundleId]: { edited: true, blocks } };
      await new Promise(resolve => setTimeout(resolve, 650));
      await route.fulfill({ json: { job } });
      return;
    }
    await route.fulfill({ json: {
      batch: { id: batchId, product_id: job.product_id, content_mode: 'standard', status: 'done', created_at: job.created_at, jobs: [job.id] },
      jobs: [job], active_runner: null,
    } });
  });

  await page.goto(`http://localhost:4100/batch?batch_id=${batchId}`);
  const editButton = page.getByRole('button', { name: '修改当前封面文字', exact: true });
  if (!await editButton.count()) {
    await page.getByRole('button', { name: /成品池/ }).click();
  }
  await editButton.click();
  await page.getByRole('button', { name: /^title\s/ }).click();
  const textarea = page.getByRole('textbox', { name: '文字', exact: true });
  const edited = '保存回来也不会恢复原文';
  await textarea.fill(edited);
  await page.waitForTimeout(1800);
  assert.equal(await textarea.inputValue(), edited, '异步保存响应不得把编辑中的文字恢复为旧值');
  assert.ok(saveCalls >= 1, '测试必须经过真实的延迟保存响应');
  await page.screenshot({ path: path.join(output, 'desktop-editor-right-panel.png'), fullPage: false });
  console.log('PASS: delayed server save response does not reset edited cover text; right-side editor remains active. PRODUCTION_WRITES=0');
} finally {
  await browser.close();
  assert.equal(await fs.readFile(fixturePath, 'utf8'), original);
}
