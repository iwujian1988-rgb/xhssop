import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readProductAssetLibrary, saveProductAssetReview } from '../src/lib/product-asset-manifest';

const root = await mkdtemp(path.join(tmpdir(), 'asset-review-test-'));
try {
  const hash = 'a'.repeat(64);
  await mkdir(path.join(root, hash));
  await writeFile(path.join(root, 'current.json'), JSON.stringify({ pdfHash: hash }));
  await writeFile(path.join(root, hash, 'source.json'), JSON.stringify({ sourceName: 'OFFLINE FIXTURE.pdf', pageCount: 1 }));
  await writeFile(path.join(root, hash, 'asset-manifest.json'), JSON.stringify({ schemaVersion: 1, productId: 'delf_b2_writing', pdfHash: hash, visualRoute: 'pdf_screenshot', assets: [{ assetId: 'fixture-1', productId: 'delf_b2_writing', pdfHash: hash, sourcePage: 1, selectedPath: 'selected/page-0001.png', moduleTag: '例子', buyerNeedTags: ['不会展开'], sellingAngleTags: ['内容证明'], supportedClaims: [{ claim: '原卖点', sourceFactIds: ['REAL-ID'] }], proofStrength: 'strong', coverReady: false, reviewStatus: 'pending', notes: 'fixture' }] }));
  const first = (await readProductAssetLibrary(root))!;
  const kept = await saveProductAssetReview({ pdfHash: hash, revision: first.revision, assetId: 'fixture-1', reviewStatus: 'kept' }, root);
  assert.equal((await readProductAssetLibrary(root))!.manifest.assets[0].reviewStatus, 'kept');
  await assert.rejects(saveProductAssetReview({ pdfHash: hash, revision: first.revision, assetId: 'fixture-1', reviewStatus: 'rejected' }, root), /另一页面/);
  const edited = await saveProductAssetReview({ pdfHash: hash, revision: kept.revision, assetId: 'fixture-1', reviewStatus: 'kept', claims: ['修改后的卖点'], coverReady: true }, root);
  assert.deepEqual(edited.manifest.assets[0].supportedClaims[0].sourceFactIds, []);
  await assert.rejects(saveProductAssetReview({ pdfHash: 'b'.repeat(64), revision: edited.revision, assetId: 'fixture-1', reviewStatus: 'kept' }, root), /另一页面/);
  const rejected = await saveProductAssetReview({ pdfHash: hash, revision: edited.revision, assetId: 'fixture-1', reviewStatus: 'rejected' }, root);
  assert.equal(rejected.manifest.assets[0].reviewStatus, 'rejected');
  assert.equal(rejected.manifest.assets[0].coverReady, true);
  console.log('PASS: reload persistence, keep/reject, edit claim clears old fact link, concurrent/stale revisions rejected');
} finally { await rm(root, { recursive: true, force: true }); }
