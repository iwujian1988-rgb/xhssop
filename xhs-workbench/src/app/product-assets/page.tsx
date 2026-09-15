'use client';

import { useEffect, useState } from 'react';
import type { ProductAsset, ProductAssetManifest, ReviewStatus } from '@/lib/product-asset-manifest';

type Library = { initialized: boolean; manifest?: ProductAssetManifest; revision?: string; sourceName?: string; pageCount?: number };
const imageUrl = (a: ProductAsset, full = false) => `/api/product-assets?assetId=${encodeURIComponent(a.assetId)}&pdfHash=${a.pdfHash}&size=${full ? 'full' : 'thumb'}`;

export default function ProductAssetsPage() {
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState<'all' | ReviewStatus>('pending');
  useEffect(() => { fetch('/api/product-assets', { cache: 'no-store' }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setLibrary(data);
  }).catch(cause => setError(cause.message)); }, []);

  async function review(asset: ProductAsset, status: ReviewStatus, edits?: object) {
    if (busy) return false;
    setBusy(asset.assetId); setError('');
    try {
      const response = await fetch('/api/product-assets', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfHash: library?.manifest?.pdfHash, revision: library?.revision, assetId: asset.assetId, reviewStatus: status, ...edits }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setLibrary(data); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败'); return false; }
    finally { setBusy(''); }
  }
  const assets = library?.manifest?.assets || [];
  const kept = assets.filter(a => a.reviewStatus === 'kept').length;
  const pending = assets.filter(a => a.reviewStatus === 'pending').length;
  return <main className="mx-auto max-w-7xl p-5 md:p-8 text-slate-900">
    <a href="/batch" className="text-sm text-slate-500 underline">← 返回批量任务</a>
    <header className="my-6"><p className="text-sm text-amber-700">商品1 · PDF截图 · 素材确认</p><h1 className="mt-2 text-3xl font-bold">挑出值得展示的真实内容</h1><p className="mt-3 text-slate-600">看图片是否值得展示、购买理由是否贴切、卖点是否有图为证。保留或不要后立即保存；这里不会生成笔记。</p></header>
    {error && <div role="alert" className="my-4 border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>}
    {!library && !error && <p>正在读取素材库…</p>}
    {library && !library.initialized && <section className="rounded-xl border border-dashed p-10"><h2 className="text-xl font-semibold">商品1素材尚未初始化</h2><p className="mt-3">确认当前销售版本PDF后，完成缩略图、AI分类和候选截图处理，就会在这里显示。旧批次和旧截图未被替换。</p></section>}
    {library?.initialized && <>
      <div className="sticky top-0 z-10 mb-6 rounded-xl border bg-white/95 p-4 shadow-sm">
        <p className="text-sm text-slate-600">{library.sourceName} · PDF共{library.pageCount}页 · 当前候选{assets.length}张</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">{([['pending', `待确认 ${pending}`], ['kept', `已保留 ${kept}`], ['rejected', `不要 ${assets.length - pending - kept}`], ['all', '全部']] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-4 py-2 text-sm ${filter === value ? 'bg-slate-900 text-white' : 'bg-slate-100'}`}>{label}</button>)}<span aria-live="polite" className="ml-auto text-sm text-slate-500">{busy ? '正在保存…' : '选择后自动保存'}</span></div>
      </div>
      <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">{assets.filter(a => filter === 'all' || a.reviewStatus === filter).map(asset => <AssetCard key={asset.assetId} asset={asset} disabled={!!busy} onReview={(status, edits) => review(asset, status, edits)} />)}</div>
      {!assets.some(a => filter === 'all' || a.reviewStatus === filter) && <p className="py-12 text-center text-slate-500">{filter === 'pending' ? '当前候选已确认完。可切换到“已保留”或“不要”检查、修改。' : '这里还没有素材。'}</p>}
      <p className="mt-8 text-sm text-slate-500">已保留表示你的素材选择；Phase 1B 尚未开始，不会自动生成笔记。</p>
    </>}
  </main>;
}

function AssetCard({ asset, disabled, onReview }: { asset: ProductAsset; disabled: boolean; onReview: (status: ReviewStatus, edits?: object) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [moduleTag, setModuleTag] = useState(asset.moduleTag);
  const [buyer, setBuyer] = useState(asset.buyerNeedTags.join('、'));
  const [angles, setAngles] = useState(asset.sellingAngleTags.join('、'));
  const [claims, setClaims] = useState(asset.supportedClaims.map(c => c.claim).join('\n'));
  const split = (value: string) => value.split(/[、，,\n]/).map(s => s.trim()).filter(Boolean);
  return <article className="overflow-hidden rounded-xl border bg-white shadow-sm">
    <a href={imageUrl(asset, true)} target="_blank" rel="noreferrer" className="block bg-stone-100 p-3" aria-label={`放大第${asset.sourcePage}页`}><img loading="lazy" src={imageUrl(asset)} alt={`第${asset.sourcePage}页：${asset.moduleTag}`} className="h-72 w-full object-contain" /><span className="block text-center text-xs text-slate-500">点击查看清晰原图</span></a>
    <div className="p-5"><div className="flex items-center justify-between"><h2 className="font-bold">PDF第 {asset.sourcePage} 页 · {asset.moduleTag}</h2><span className="text-xs text-slate-500">{{ pending: '待确认', kept: '已保留', rejected: '不要' }[asset.reviewStatus]}</span></div>
      <p className="mt-3 text-sm text-slate-600">购买理由：{asset.buyerNeedTags.join(' / ') || '未标注'}</p><p className="mt-1 text-sm text-slate-500">展示角度：{asset.sellingAngleTags.join(' / ')}</p>
      <h3 className="mt-4 text-sm font-semibold">这张图能证明</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{asset.supportedClaims.map((claim, i) => <li key={i}>{claim.claim}</li>)}</ul>
      <p className="mt-3 text-xs text-slate-500">AI判断：证明力度{{ strong: '强', medium: '中', weak: '弱' }[asset.proofStrength]} · {asset.notes}</p>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={asset.coverReady} disabled={disabled} onChange={e => void onReview(asset.reviewStatus, { coverReady: e.target.checked })} />适合做封面</label>
      <div className="mt-4 flex gap-3"><button disabled={disabled} onClick={() => void onReview('kept')} className="flex-1 rounded-lg bg-emerald-700 py-2.5 text-white disabled:opacity-40">保留</button><button disabled={disabled} onClick={() => void onReview('rejected')} className="flex-1 rounded-lg border py-2.5 disabled:opacity-40">不要</button></div>
      <button onClick={() => setEditing(!editing)} className="mt-3 text-xs text-slate-500 underline">{editing ? '收起修改' : '修改标签 / 卖点'}</button>
      {editing && <div className="mt-3 space-y-3 text-sm"><label className="block">模块<input className="mt-1 w-full rounded border p-2" value={moduleTag} onChange={e => setModuleTag(e.target.value)} /></label><label className="block">购买理由（顿号分隔）<input className="mt-1 w-full rounded border p-2" value={buyer} onChange={e => setBuyer(e.target.value)} /></label><label className="block">展示角度（顿号分隔）<input className="mt-1 w-full rounded border p-2" value={angles} onChange={e => setAngles(e.target.value)} /></label><label className="block">图能证明的卖点（每行一条）<textarea rows={4} className="mt-1 w-full rounded border p-2" value={claims} onChange={e => setClaims(e.target.value)} /></label><button disabled={disabled} className="rounded bg-slate-900 px-4 py-2 text-white disabled:opacity-40" onClick={async () => { if (await onReview(asset.reviewStatus, { moduleTag, buyerNeedTags: split(buyer), sellingAngleTags: split(angles), claims: claims.split('\n').map(s => s.trim()).filter(Boolean) })) setEditing(false); }}>保存修改</button></div>}
    </div>
  </article>;
}
