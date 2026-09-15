import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Browser fixture only; never submits review decisions to the real library.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.ASSET_UI_BASE || 'http://localhost:3000';
  const response = await page.goto(`${base}/product-assets`);
  assert.equal(response?.status(), 200);
  await page.getByRole('heading', { name: '挑出值得展示的真实内容' }).waitFor();
  let revision = 1;
  const asset = { assetId: 'fixture', productId: 'delf_b2_writing', pdfHash: 'a'.repeat(64), sourcePage: 12, selectedPath: 'selected/page-0012.png', moduleTag: '测试模块', buyerNeedTags: ['写完不知道怎么检查'], sellingAngleTags: ['真实内容展示'], supportedClaims: [{ claim: '测试页面包含检查提示', sourceFactIds: [] as string[] }], proofStrength: 'strong', coverReady: false, reviewStatus: 'pending', notes: '浏览器测试夹具，不是真实AI判断' };
  await page.route('**/api/product-assets**', async route => {
    if (route.request().url().includes('assetId=')) {
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><rect width="500" height="700" fill="#f9f7ed"/><text x="40" y="80" font-size="24">OFFLINE FIXTURE / PAGE 12</text></svg>' });
    }
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      assert.equal(patch.assetId, asset.assetId);
      asset.reviewStatus = patch.reviewStatus;
      if (patch.coverReady !== undefined) asset.coverReady = patch.coverReady;
      if (patch.claims) asset.supportedClaims = patch.claims.map((claim: string) => ({ claim, sourceFactIds: [] }));
      revision++;
    }
    return route.fulfill({ json: { initialized: true, revision: String(revision), sourceName: 'OFFLINE FIXTURE.pdf', pageCount: 12, manifest: { schemaVersion: 1, productId: 'delf_b2_writing', pdfHash: asset.pdfHash, visualRoute: 'pdf_screenshot', assets: [asset] } } });
  });
  await page.reload();
  await page.getByRole('button', { name: '保留', exact: true }).click();
  await page.getByRole('button', { name: '已保留 1', exact: true }).click();
  await page.getByRole('checkbox', { name: '适合做封面' }).click();
  await page.waitForFunction(() => (document.querySelector('input[type=checkbox]') as HTMLInputElement)?.checked && !document.querySelector('input[type=checkbox]')?.hasAttribute('disabled'));
  await page.getByRole('button', { name: '修改标签 / 卖点' }).click();
  await page.getByRole('textbox', { name: '图能证明的卖点（每行一条）' }).fill('人工修改后的测试卖点');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await page.getByText('人工修改后的测试卖点', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '已保留 1', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: '适合做封面' }).isChecked(), true);
  await page.getByText('人工修改后的测试卖点', { exact: true }).waitFor();
  await page.getByRole('button', { name: '不要', exact: true }).click();
  await page.getByRole('button', { name: '不要 1', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: actual route loads; mocked UI keep/reject, cover switch, claim edit, refresh, mobile width, no runtime errors; real manifest untouched');
} finally { await browser.close(); }
