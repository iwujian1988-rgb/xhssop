import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export type ReviewStatus = 'pending' | 'kept' | 'rejected';
export interface ProductAsset {
  assetId: string;
  productId: 'delf_b2_writing';
  pdfHash: string;
  sourcePage: number;
  selectedPath: string;
  moduleTag: string;
  buyerNeedTags: string[];
  sellingAngleTags: string[];
  supportedClaims: { claim: string; sourceFactIds: string[] }[];
  proofStrength: 'strong' | 'medium' | 'weak';
  coverReady: boolean;
  reviewStatus: ReviewStatus;
  notes: string;
  /** Phase 1A curation label; absent in legacy manifests. */
  curationTier?: 'A' | 'B';
}
export interface ProductAssetManifest {
  schemaVersion: 1;
  productId: 'delf_b2_writing';
  pdfHash: string;
  visualRoute: 'pdf_screenshot';
  assets: ProductAsset[];
}
export class AssetLibraryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const ROOT = path.join(process.cwd(), 'data', 'product-assets', 'delf_b2_writing');
const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');

export async function readProductAssetLibrary(root = ROOT) {
  let hash: string;
  try {
    hash = JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8')).pdfHash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new AssetLibraryError('素材版本无效');
  const directory = path.join(root, hash);
  const raw = await readFile(path.join(directory, 'asset-manifest.json'), 'utf8');
  const manifest = JSON.parse(raw) as ProductAssetManifest;
  if (manifest.productId !== 'delf_b2_writing' || manifest.pdfHash !== hash || manifest.visualRoute !== 'pdf_screenshot' || !Array.isArray(manifest.assets)) {
    throw new AssetLibraryError('素材库身份或结构不匹配');
  }
  const ids = new Set<string>();
  for (const asset of manifest.assets) {
    if (asset.pdfHash !== hash || asset.productId !== manifest.productId || ids.has(asset.assetId)
      || !Number.isInteger(asset.sourcePage) || asset.sourcePage < 1
      || asset.selectedPath !== `selected/page-${String(asset.sourcePage).padStart(4, '0')}.png`
      || !['pending', 'kept', 'rejected'].includes(asset.reviewStatus)) {
      throw new AssetLibraryError('素材条目与PDF版本不匹配');
    }
    ids.add(asset.assetId);
  }
  const source = JSON.parse(await readFile(path.join(directory, 'source.json'), 'utf8'));
  return { manifest, revision: hashOf(raw), directory, sourceName: String(source.sourceName), pageCount: Number(source.pageCount) };
}

// Phase 1A consumer interface only. No existing note generation imports it.
export async function loadConfirmedProductAssets() {
  return (await readProductAssetLibrary())?.manifest.assets.filter(asset => asset.reviewStatus === 'kept') || [];
}

export interface AssetReviewPatch {
  pdfHash: string;
  revision: string;
  assetId: string;
  reviewStatus: ReviewStatus;
  coverReady?: boolean;
  moduleTag?: string;
  buyerNeedTags?: string[];
  sellingAngleTags?: string[];
  claims?: string[];
}

function strings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(s => typeof s !== 'string' || !s.trim() || s.length > 500)) {
    throw new AssetLibraryError('标签或卖点格式无效');
  }
  return [...new Set(value.map(s => s.trim()))];
}

export async function saveProductAssetReview(patch: AssetReviewPatch, root = ROOT) {
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, '.review.lock');
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new AssetLibraryError('另一项修改正在保存，请稍后重试', 409);
    throw error;
  }
  try {
    const library = await readProductAssetLibrary(root);
    if (!library) throw new AssetLibraryError('素材库尚未初始化', 404);
    if (patch.pdfHash !== library.manifest.pdfHash || patch.revision !== library.revision) {
      throw new AssetLibraryError('素材已在另一页面更新，请刷新后再保存', 409);
    }
    if (!['pending', 'kept', 'rejected'].includes(patch.reviewStatus)) throw new AssetLibraryError('确认状态无效');
    const asset = library.manifest.assets.find(item => item.assetId === patch.assetId);
    if (!asset) throw new AssetLibraryError('找不到素材', 404);
    if (patch.coverReady !== undefined && typeof patch.coverReady !== 'boolean') throw new AssetLibraryError('封面选项无效');
    if (patch.moduleTag !== undefined) {
      if (typeof patch.moduleTag !== 'string' || !patch.moduleTag.trim() || patch.moduleTag.length > 100) throw new AssetLibraryError('模块标签无效');
      asset.moduleTag = patch.moduleTag.trim();
    }
    if (patch.buyerNeedTags !== undefined) asset.buyerNeedTags = strings(patch.buyerNeedTags, 12);
    if (patch.sellingAngleTags !== undefined) asset.sellingAngleTags = strings(patch.sellingAngleTags, 12);
    if (patch.claims !== undefined) {
      const claims = strings(patch.claims, 12);
      if (!claims.length) throw new AssetLibraryError('至少保留一个图片能证明的卖点');
      // Edited meanings must not inherit an old fact ID association.
      asset.supportedClaims = claims.map(claim => ({ claim, sourceFactIds: asset.supportedClaims.find(old => old.claim === claim)?.sourceFactIds || [] }));
    }
    asset.reviewStatus = patch.reviewStatus;
    if (patch.coverReady !== undefined) asset.coverReady = patch.coverReady;
    const raw = JSON.stringify(library.manifest, null, 2) + '\n';
    const target = path.join(library.directory, 'asset-manifest.json');
    const temp = `${target}.${randomUUID()}.tmp`;
    await open(temp, 'wx').then(async file => { try { await file.writeFile(raw); } finally { await file.close(); } });
    await rename(temp, target);
    return { manifest: library.manifest, revision: hashOf(raw), sourceName: library.sourceName, pageCount: library.pageCount };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
