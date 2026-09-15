import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AssetLibraryError, readProductAssetLibrary, saveProductAssetReview } from '@/lib/product-asset-manifest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const library = await readProductAssetLibrary();
    if (!library) return Response.json({ initialized: false }, { headers: { 'Cache-Control': 'no-store' } });
    const url = new URL(request.url);
    const assetId = url.searchParams.get('assetId');
    if (assetId) {
      if (url.searchParams.get('pdfHash') !== library.manifest.pdfHash) throw new AssetLibraryError('素材版本已变化', 409);
      const asset = library.manifest.assets.find(item => item.assetId === assetId);
      if (!asset) throw new AssetLibraryError('找不到素材', 404);
      const full = url.searchParams.get('size') === 'full';
      const relative = full ? asset.selectedPath : `thumbnails/page-${String(asset.sourcePage).padStart(4, '0')}.jpg`;
      const data = await readFile(path.join(library.directory, relative));
      return new Response(data, { headers: { 'Content-Type': full ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
    }
    return Response.json({ initialized: true, manifest: library.manifest, revision: library.revision, sourceName: library.sourceName, pageCount: library.pageCount }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new AssetLibraryError('不允许跨站修改素材', 403);
    const patch = await request.json();
    if (!patch || typeof patch !== 'object') throw new AssetLibraryError('保存内容无效');
    return Response.json({ initialized: true, ...await saveProductAssetReview(patch) });
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  if (error instanceof AssetLibraryError) return Response.json({ error: error.message }, { status: error.status });
  console.error('[product-assets]', error instanceof Error ? error.message : 'unknown error');
  return Response.json({ error: '素材读取或保存失败，请检查初始化结果。' }, { status: 500 });
}
