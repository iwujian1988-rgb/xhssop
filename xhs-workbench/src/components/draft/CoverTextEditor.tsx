'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { growCoverTextBoxes, measureCoverTextHeight } from '@/lib/cover-text-measurement';
import type { CreativeCardRenderer, DenseDirectoryCoverPayload } from '@/types/reference-workflow';
import { coverEditorStorageKey, createDefaultCoverBlocks, normalizeCoverBlock, type CoverEditableBlock, type CoverEditSnapshot, type CoverFontWeight, type CoverTextAlign, type PersistedCoverEditState } from '@/lib/cover-editor';

type Props = {
  draftId: string;
  bundleId: string;
  renderer: CreativeCardRenderer;
  payload: DenseDirectoryCoverPayload;
  kicker?: string;
  referenceImage?: string;
  skinId?: string | null;
  initialBlocks?: CoverEditableBlock[];
  legacyBundleIndex?: number;
  registerCanvas: (node: HTMLDivElement | null) => void;
  onStateChange: (blocks: CoverEditableBlock[]) => void;
  readOnly?: boolean;
};

const SAFE = { x: 48, y: 48, width: 984, height: 1344 };

function normalizedText(value?: string | null) {
  return (value || '').replace(/\s+/gu, '').replace(/[“”‘’'"「」『』]/gu, '');
}

function isLeafTextMatch(node: HTMLElement, target: string) {
  if (normalizedText(node.textContent) !== target) return false;
  return !Array.from(node.children).some(child => normalizedText(child.textContent) === target);
}

function findSourceTextNode(root: HTMLElement | null, text: string, preferredSelectors: string) {
  const target = normalizedText(text);
  if (!root || !target) return null;
  const preferred = Array.from(root.querySelectorAll<HTMLElement>(preferredSelectors));
  const exactPreferred = preferred.find(node => normalizedText(node.textContent) === target);
  if (exactPreferred) return exactPreferred;

  const candidates = Array.from(root.querySelectorAll<HTMLElement>('h1,h2,p,b,strong,span,em,small,div'))
    .filter(node => isLeafTextMatch(node, target));
  return candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
  })[0] || null;
}

function blockDiffersFromSource(block: CoverEditableBlock, source?: CoverEditableBlock) {
  if (!source) return block.visible || !!block.text;
  const near = (left: number, right: number) => Math.abs(left - right) <= 1;
  return block.text !== source.text
    || block.visible !== source.visible
    || !near(block.x, source.x)
    || !near(block.y, source.y)
    || !near(block.width, source.width)
    || !near(block.height, source.height)
    || !near(block.fontSize, source.fontSize)
    || block.fontWeight !== source.fontWeight
    || Math.abs(block.lineHeight - source.lineHeight) > 0.01
    || Math.abs(block.letterSpacing - source.letterSpacing) > 0.1
    || block.align !== source.align;
}

export function CoverTextEditor({ draftId, bundleId, renderer, payload, kicker, referenceImage, skinId, initialBlocks, legacyBundleIndex, registerCanvas, onStateChange, readOnly=false }: Props) {
  const defaults = useMemo(() => createDefaultCoverBlocks({ renderer, kicker, title: payload.title, subtitle: payload.subtitle }), [renderer, kicker, payload.title, payload.subtitle]);
  const storageKey = coverEditorStorageKey(draftId, bundleId);
  const [measuredDefaults, setMeasuredDefaults] = useState(defaults);
  const [sourceMeasured, setSourceMeasured] = useState(false);
  const [snapshot, setSnapshot] = useState<CoverEditSnapshot>({ blocks: defaults, selectedIds: ['coverTitle'] });
  const [past, setPast] = useState<CoverEditSnapshot[]>([]);
  const [future, setFuture] = useState<CoverEditSnapshot[]>([]);
  const [guides, setGuides] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const gestureStart = useRef<CoverEditSnapshot | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const hydratedStorageKeyRef = useRef('');
  const editChangesEnabledRef = useRef(false);
  const lastPublishedBlocksRef = useRef('');

  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    const updateScale = () => setPreviewScale(Math.min(1, preview.clientWidth / 1080));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(preview);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const source = canvas.querySelector<HTMLElement>('.cover-editor-source');
    source?.querySelectorAll<HTMLElement>('[data-cover-source-hidden]').forEach(node => node.removeAttribute('data-cover-source-hidden'));
    source?.querySelectorAll<HTMLElement>('[data-cover-source-block-id]').forEach(node => node.removeAttribute('data-cover-source-block-id'));
    const titleNode = findSourceTextNode(source || null, payload.title, 'h1,.rc-notebook-lines .big span,.rc-vocab-hook>b');
    const subtitleNode = findSourceTextNode(source || null, payload.subtitle || '', 'header>p,.rc-subtitle,.rc-collocation-sub,.rc-experience-lead,.rc-notice-sub,.rc-book-main>p,.rc-notebook-lines>div:first-child span,.rc-vocab-hook>span,.showcase-screenshot-cover__copy>p');
    const kickerNode = findSourceTextNode(source || null, kicker || '', '.rc-experience-kicker,.rc-pain-quote-kicker,.rc-notice-label');
    titleNode?.setAttribute('data-cover-source-block-id', 'coverTitle');
    subtitleNode?.setAttribute('data-cover-source-block-id', 'coverSubtitle');
    kickerNode?.setAttribute('data-cover-source-block-id', 'coverKicker');
    const canvasRect = canvas.getBoundingClientRect();
    if (!titleNode || !canvasRect.width) return;
    const ratio = 1080 / canvasRect.width;
    function measured(block: CoverEditableBlock, node?: HTMLElement | null): CoverEditableBlock {
      if (!node) return block;
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
      const lineHeightPx = Number.parseFloat(style.lineHeight);
      const fontSizePx = Number.parseFloat(style.fontSize);
      return normalizeCoverBlock({ ...block, x: (rect.left - canvasRect.left) * ratio, y: (rect.top - canvasRect.top) * ratio, width: rect.width * ratio, height: Math.max(rect.height * ratio, 28), fontSize: fontSizePx, fontWeight: Math.min(700, Math.max(400, Math.round(Number(style.fontWeight) / 100) * 100)) as CoverFontWeight, lineHeight: Number.isFinite(lineHeightPx / fontSizePx) ? lineHeightPx / fontSizePx : block.lineHeight, align: (['left','center','right'].includes(style.textAlign) ? style.textAlign : block.align) as CoverTextAlign, color: style.color || block.color, fontFamily: style.fontFamily || block.fontFamily, fontStyle: style.fontStyle, textShadow: style.textShadow, webkitTextStroke: style.webkitTextStroke, textDecoration: style.textDecoration, background: style.background, borderRadius: style.borderRadius, padding: style.padding });
    }
    const next = defaults.map(block => {
      if (block.id === 'coverTitle') return measured(block, titleNode);
      if (block.id === 'coverSubtitle') return subtitleNode ? measured(block, subtitleNode) : { ...block, visible: false };
      if (block.id === 'coverKicker') return kickerNode ? measured(block, kickerNode) : { ...block, visible: false };
      return block;
    });
    setMeasuredDefaults(next);
    setSourceMeasured(true);
  }, [defaults, kicker, payload.subtitle, payload.title]);

  useLayoutEffect(() => {
    const source = canvasRef.current?.querySelector<HTMLElement>('.cover-editor-source');
    if (!source || !hydrated) return;
    const sourceById = new Map(measuredDefaults.map(block => [block.id, block]));
    const editedIds = new Set(snapshot.blocks.filter(block => blockDiffersFromSource(block, sourceById.get(block.id))).map(block => block.id));
    source.querySelectorAll<HTMLElement>('[data-cover-source-block-id]').forEach(node => {
      const id = node.dataset.coverSourceBlockId || '';
      if (editedIds.has(id)) node.setAttribute('data-cover-source-hidden', id);
      else node.removeAttribute('data-cover-source-hidden');
    });
  }, [hydrated, measuredDefaults, snapshot.blocks]);

  useEffect(() => {
    // Hydrate once per draft+bundle identity. Saving an edit updates the parent
    // draft (and therefore payload/default measurements); that is not a reason
    // to reinitialize this live editor with the original text.
    if (hydratedStorageKeyRef.current === storageKey) return;
    if (!sourceMeasured) return;
    hydratedStorageKeyRef.current = storageKey;
    const sourceById = new Map(measuredDefaults.map(block => [block.id, block]));
    const hydrateBlocks = (blocks: CoverEditableBlock[]) => blocks.map(block => {
      const source = sourceById.get(block.id);
      if (!source) return normalizeCoverBlock(block);
      // Typography decoration is owned by the selected template, not by the
      // generic editor preset. The UI does not expose these fields, so merging
      // them cannot overwrite an intentional user operation. This also repairs
      // old v5 edit states that were saved before source measurement completed.
      return normalizeCoverBlock({
        ...block,
        color: source.color,
        fontFamily: source.fontFamily,
        fontStyle: source.fontStyle,
        textShadow: source.textShadow,
        webkitTextStroke: source.webkitTextStroke,
        textDecoration: source.textDecoration,
        background: source.background,
        borderRadius: source.borderRadius,
        padding: source.padding,
      });
    });
    if (initialBlocks?.length) {
      setSnapshot({ blocks: hydrateBlocks(initialBlocks), selectedIds: [] });
      setHydrated(true);
      return;
    }
    try {
      const legacyKey = typeof legacyBundleIndex === 'number' ? coverEditorStorageKey(draftId, `index_${legacyBundleIndex}`) : '';
      const raw = localStorage.getItem(storageKey) || (legacyKey ? localStorage.getItem(legacyKey) : null);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedCoverEditState;
        if (saved.version === 5 && Array.isArray(saved.blocks)) {
          setSnapshot({ blocks: hydrateBlocks(saved.blocks), selectedIds: saved.selectedIds || [] });
          setHydrated(true);
          return;
        }
      }
    } catch { /* a damaged local draft must not block the editor */ }
    setSnapshot({ blocks: measuredDefaults, selectedIds: ['coverTitle'] });
    setPast([]); setFuture([]);
    setHydrated(true);
  }, [draftId, initialBlocks, legacyBundleIndex, storageKey, measuredDefaults, sourceMeasured]);

  useEffect(() => {
    if (hydrated && !readOnly) setSnapshot(current => current.selectedIds.length ? current : { ...current, selectedIds: ['coverTitle'] });
  }, [hydrated, readOnly]);

  useEffect(() => {
    const blocksSignature = JSON.stringify(snapshot.blocks);
    if (!hydrated || readOnly) { editChangesEnabledRef.current = false; lastPublishedBlocksRef.current = blocksSignature; return; }
    // Entering edit mode is not itself a modification. Only persist after the
    // user changes the hydrated snapshot.
    if (!editChangesEnabledRef.current) { editChangesEnabledRef.current = true; lastPublishedBlocksRef.current = blocksSignature; return; }
    if (blocksSignature === lastPublishedBlocksRef.current) return;
    lastPublishedBlocksRef.current = blocksSignature;
    const value: PersistedCoverEditState = { version: 5, ...snapshot, updatedAt: new Date().toISOString() };
    localStorage.setItem(storageKey, JSON.stringify(value));
    onStateChange(snapshot.blocks);
  }, [snapshot, storageKey, onStateChange, hydrated, readOnly]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hydrated) return;
    const requiredHeights = new Map<string, number>();
    snapshot.blocks.forEach(block => {
      if (!block.visible || !block.text) return;
      const node = canvas.querySelector<HTMLElement>(`[data-cover-block-id="${block.id}"]`);
      if (!node) return;
      const requiredHeight = measureCoverTextHeight(node);
      if (requiredHeight > block.height + 1) requiredHeights.set(block.id, requiredHeight);
    });
    if (!requiredHeights.size) return;
    setSnapshot(current => growCoverTextBoxes(current, requiredHeights));
  }, [hydrated, snapshot.blocks]);

  function commit(blocks: CoverEditableBlock[], selectedIds = snapshot.selectedIds) {
    setPast(items => [...items.slice(-49), snapshot]);
    setFuture([]);
    setSnapshot({ blocks: blocks.map(normalizeCoverBlock), selectedIds });
  }
  function updateSelected(patch: Partial<CoverEditableBlock>, record = true) {
    const blocks = snapshot.blocks.map(block => snapshot.selectedIds.includes(block.id) && !block.locked ? { ...block, ...patch } : block);
    if (record) commit(blocks); else setSnapshot(current => ({ ...current, blocks: blocks.map(normalizeCoverBlock) }));
  }
  function select(id: string, additive: boolean) {
    setSnapshot(current => ({ ...current, selectedIds: additive ? (current.selectedIds.includes(id) ? current.selectedIds.filter(item => item !== id) : [...current.selectedIds, id]) : [id] }));
  }
  function undo() { const previous = past.at(-1); if (!previous) return; setFuture(items => [snapshot, ...items]); setPast(items => items.slice(0, -1)); setSnapshot(previous); }
  function redo() { const next = future[0]; if (!next) return; setPast(items => [...items, snapshot]); setFuture(items => items.slice(1)); setSnapshot(next); }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches('input,textarea,[contenteditable="true"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !editing) { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && !editing) { event.preventDefault(); setSnapshot(current => ({ ...current, selectedIds: current.blocks.map(block => block.id) })); return; }
      if (editing || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      const blocks = snapshot.blocks.map(block => snapshot.selectedIds.includes(block.id) && !block.locked ? { ...block, x: block.x + dx, y: block.y + dy } : block);
      commit(blocks);
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  function startPointer(event: ReactPointerEvent, id: string, resize = false) {
    event.preventDefault(); event.stopPropagation();
    select(id, event.shiftKey || event.ctrlKey || event.metaKey);
    const activeIds = (event.shiftKey || event.ctrlKey || event.metaKey) ? Array.from(new Set([...snapshot.selectedIds, id])) : [id];
    const origin = snapshot;
    gestureStart.current = origin;
    const startX = event.clientX; const startY = event.clientY;
    const rect = canvasRef.current?.getBoundingClientRect();
    const scale = (rect?.width || 1080) / 1080;
    function move(pointer: PointerEvent) {
      const dx = (pointer.clientX - startX) / scale; const dy = (pointer.clientY - startY) / scale;
      const blocks = origin.blocks.map(block => {
        if (!activeIds.includes(block.id) || block.locked) return block;
        return resize ? { ...block, width: block.width + dx, height: block.height + dy } : { ...block, x: block.x + dx, y: block.y + dy };
      });
      const nextGuides: string[] = [];
      blocks.filter(block => activeIds.includes(block.id)).forEach(block => { if (Math.abs(block.x + block.width / 2 - 540) < 7) nextGuides.push('center-x'); if (Math.abs(block.y + block.height / 2 - 720) < 7) nextGuides.push('center-y'); });
      setGuides(nextGuides); setSnapshot({ blocks: blocks.map(normalizeCoverBlock), selectedIds: activeIds });
    }
    function up() {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setGuides([]);
      if (gestureStart.current) { setPast(items => [...items.slice(-49), gestureStart.current!]); setFuture([]); gestureStart.current = null; }
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }

  const selected = snapshot.blocks.filter(block => snapshot.selectedIds.includes(block.id));
  const primary = selected[0];
  const basePayload = { ...payload };

  function resetCurrent() { commit(measuredDefaults, ['coverTitle']); }
  function resetAll() {
    if (!window.confirm('确定恢复这个草稿全部四组封面的默认文字与位置吗？')) return;
    const prefix = `xhs-cover-edit:v5:${draftId}:`;
    Object.keys(localStorage).filter(key => key.startsWith(prefix)).forEach(key => localStorage.removeItem(key));
    resetCurrent();
  }

  return <div className={readOnly ? '' : 'grid gap-4 lg:grid-cols-[minmax(0,680px)_minmax(300px,360px)] lg:items-start lg:justify-center'}>
    <div>
      <div ref={previewRef} className="relative aspect-[3/4] w-full overflow-hidden bg-white">
        <div className="absolute left-0 top-0 h-[1440px] w-[1080px] origin-top-left" style={{ transform: `scale(${previewScale})` }}>
        <div ref={node => { canvasRef.current = node; registerCanvas(node); }} className="cover-editor-canvas relative h-[1440px] w-[1080px] overflow-hidden bg-white" onPointerDown={readOnly ? undefined : () => setSnapshot(current => ({ ...current, selectedIds: [] }))}>
          <div className="cover-editor-source absolute inset-0"><ReferenceCoverRenderer renderer={renderer} payload={basePayload} referenceImage={referenceImage} skinId={skinId} previewMode="code" /></div>
          {!readOnly && <div data-editor-only className="pointer-events-none absolute border border-dashed border-cyan-500/40" style={{ left: `${SAFE.x / 10.8}%`, top: `${SAFE.y / 14.4}%`, width: `${SAFE.width / 10.8}%`, height: `${SAFE.height / 14.4}%` }} />}
          {!readOnly && guides.includes('center-x') ? <div data-editor-only className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-fuchsia-500" /> : null}
          {!readOnly && guides.includes('center-y') ? <div data-editor-only className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-fuchsia-500" /> : null}
          {snapshot.blocks.map(block => {
            const sourceBlock = measuredDefaults.find(item => item.id === block.id);
            const edited = blockDiffersFromSource(block, sourceBlock);
            const active = !readOnly && snapshot.selectedIds.includes(block.id); const outside = block.x < 0 || block.y < 0 || block.x + block.width > 1080 || block.y + block.height > 1440;
            if (readOnly && !edited) return null;
            return <div key={block.id} data-cover-block-id={block.id} className={`absolute whitespace-pre-wrap ${readOnly ? '' : block.locked ? 'cursor-not-allowed' : 'cursor-move'} ${active ? 'ring-2 ring-cyan-500' : readOnly ? '' : 'hover:ring-1 hover:ring-cyan-400/70'} ${!readOnly && outside ? 'bg-red-500/10' : ''}`} style={{ left: `${block.x / 10.8}%`, top: `${block.y / 14.4}%`, width: `${block.width / 10.8}%`, height: `${block.height / 14.4}%`, display: block.visible ? 'flex' : 'none', alignItems: 'center', justifyContent: block.align === 'left' ? 'flex-start' : block.align === 'right' ? 'flex-end' : 'center', color: block.color, fontFamily: block.fontFamily, fontStyle: block.fontStyle, fontSize: `${block.fontSize / 10.8}cqw`, fontWeight: block.fontWeight, lineHeight: block.lineHeight, letterSpacing: `${block.letterSpacing / 10.8}cqw`, textAlign: block.align, textShadow: block.textShadow, WebkitTextStroke: block.webkitTextStroke, textDecoration: block.textDecoration, background: block.background, borderRadius: block.borderRadius, padding: block.padding, zIndex: 20, overflow: 'hidden', overflowWrap: 'anywhere', opacity: edited ? 1 : 0 }} onPointerDown={readOnly ? undefined : event => startPointer(event, block.id)} onDoubleClick={readOnly ? undefined : event => { event.stopPropagation(); (event.currentTarget as HTMLElement).focus(); }} contentEditable={!readOnly && !block.locked} suppressContentEditableWarning onBlur={readOnly ? undefined : event => { const text = event.currentTarget.innerText.replace(/\n$/, ''); const blocks = snapshot.blocks.map(item => item.id === block.id ? { ...item, text } : item); commit(blocks); }}>
              {block.text || (active ? '输入文字' : '')}
              {active && !block.locked ? <span data-editor-only className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize border-b-2 border-r-2 border-cyan-600 bg-white/80" contentEditable={false} onPointerDown={event => startPointer(event, block.id, true)} /> : null}
            </div>;
          })}
          <style>{`.cover-editor-canvas{container-type:inline-size}.cover-editor-source [data-cover-source-hidden]{visibility:hidden!important}.cover-editor-canvas [contenteditable=true]:focus{outline:none}.cover-editor-canvas[data-exporting=true] [data-editor-only]{display:none!important}.cover-editor-canvas[data-exporting=true] [data-cover-block-id]{outline:none!important;box-shadow:none!important}`}</style>
        </div>
        </div>
      </div>
      {!readOnly && <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500"><span>设计坐标 1080 × 1440 · 方向键 1px · Shift 10px</span><span>{selected.length ? `已选 ${selected.length} 个文字块` : '未选择'}</span></div>}
    </div>
    {!readOnly && <aside aria-label="封面文字编辑工具" className="border border-neutral-200 bg-[#f8f8f6] p-3 text-xs lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
      <div className="flex gap-2"><button className="border bg-white px-2 py-1 font-bold disabled:opacity-30" disabled={!past.length} onClick={undo}>撤销</button><button className="border bg-white px-2 py-1 font-bold disabled:opacity-30" disabled={!future.length} onClick={redo}>重做</button><button className="ml-auto border bg-white px-2 py-1 font-bold" onClick={() => setSnapshot(current => ({ ...current, selectedIds: current.blocks.map(block => block.id) }))}>全选</button></div>
      <div className="mt-3 space-y-1">{snapshot.blocks.map(block => <button key={block.id} className={`flex w-full items-center justify-between border px-2 py-2 text-left ${snapshot.selectedIds.includes(block.id) ? 'border-cyan-500 bg-cyan-50' : 'border-neutral-200 bg-white'}`} onClick={event => select(block.id, event.shiftKey || event.ctrlKey || event.metaKey)}><span className="font-bold">{block.type}</span><span className="max-w-[190px] truncate text-neutral-500">{block.text || '（空）'}</span></button>)}</div>
      {primary ? <div className="mt-4 space-y-3 border-t pt-3">
        <label className="block font-bold">文字<textarea className="mt-1 w-full resize-y border bg-white p-2 font-normal" rows={3} value={primary.text} onChange={event => updateSelected({ text: event.target.value }, false)} onBlur={() => commit(snapshot.blocks)} /></label>
        <Control label="字号"><button onClick={() => updateSelected({ fontSize: Math.max(primary.minFontSize, primary.fontSize - 2) })}>−</button><input className="w-16 border px-1 py-1 text-center" type="number" min={primary.minFontSize} max={primary.maxFontSize} value={primary.fontSize} onChange={event => updateSelected({ fontSize: Number(event.target.value) }, false)} onBlur={() => commit(snapshot.blocks)} /><button onClick={() => updateSelected({ fontSize: Math.min(primary.maxFontSize, primary.fontSize + 2) })}>＋</button></Control>
        <Control label="宽高"><input className="w-20 border px-1 py-1" type="number" value={primary.width} onChange={event => updateSelected({ width: Number(event.target.value) }, false)} onBlur={() => commit(snapshot.blocks)} /><span>×</span><input className="w-20 border px-1 py-1" type="number" value={primary.height} onChange={event => updateSelected({ height: Number(event.target.value) }, false)} onBlur={() => commit(snapshot.blocks)} /></Control>
        <Control label="对齐">{(['left','center','right'] as CoverTextAlign[]).map(value => <button className={primary.align === value ? 'bg-neutral-900 text-white' : ''} key={value} onClick={() => updateSelected({ align: value })}>{value === 'left' ? '左' : value === 'center' ? '中' : '右'}</button>)}</Control>
        <Control label="字重">{([400,500,600,700] as CoverFontWeight[]).map(value => <button className={primary.fontWeight === value ? 'bg-neutral-900 text-white' : ''} key={value} onClick={() => updateSelected({ fontWeight: value })}>{value}</button>)}</Control>
        <Control label="行距">{([{n:'紧',v:1.05},{n:'标准',v:1.22},{n:'松',v:1.45}]).map(item => <button className={primary.lineHeight === item.v ? 'bg-neutral-900 text-white' : ''} key={item.n} onClick={() => updateSelected({ lineHeight: item.v })}>{item.n}</button>)}</Control>
        <Control label="字距 / 最大行数"><input className="w-20 border px-1 py-1" type="number" step="0.5" value={primary.letterSpacing} onChange={event => updateSelected({ letterSpacing: Number(event.target.value) }, false)} onBlur={() => commit(snapshot.blocks)} /><span>px</span><input className="ml-2 w-16 border px-1 py-1" type="number" min="1" max="8" value={primary.maxLines} onChange={event => updateSelected({ maxLines: Number(event.target.value) }, false)} onBlur={() => commit(snapshot.blocks)} /><span>行</span></Control>
        <div className="flex gap-2"><button className="flex-1 border bg-white px-2 py-1.5 font-bold" onClick={() => updateSelected({ visible: !primary.visible })}>{primary.visible ? '隐藏' : '显示'}</button><button className="flex-1 border bg-white px-2 py-1.5 font-bold" onClick={() => { const blocks = snapshot.blocks.map(block => snapshot.selectedIds.includes(block.id) ? { ...block, locked: !primary.locked } : block); commit(blocks); }}>{primary.locked ? '解锁' : '锁定'}</button></div>
        {primary.x < SAFE.x || primary.y < SAFE.y || primary.x + primary.width > SAFE.x + SAFE.width || primary.y + primary.height > SAFE.y + SAFE.height ? <p className="border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-900">提醒：文字块超出安全区，导出前建议移回虚线框内。</p> : null}
        {Math.ceil(primary.text.length * primary.fontSize / Math.max(primary.width, 1)) > primary.maxLines ? <p className="border border-amber-300 bg-amber-50 p-2 font-semibold text-amber-900">提醒：当前文字可能超过 {primary.maxLines} 行，请增大宽高、减小字号或手动换行。</p> : null}
      </div> : null}
      <div className="mt-4 grid grid-cols-1 gap-2 border-t pt-3"><button className="border bg-white px-2 py-2 font-bold" onClick={() => { const block = snapshot.blocks.find(item => item.id === snapshot.selectedIds[0]); if (!block) return; const defaultsById = new Map(measuredDefaults.map(item => [item.id,item])); commit(snapshot.blocks.map(item => snapshot.selectedIds.includes(item.id) ? defaultsById.get(item.id) || item : item)); }}>恢复所选默认值</button><button className="border bg-white px-2 py-2 font-bold" onClick={resetCurrent}>恢复当前 Bundle</button><button className="border border-red-200 bg-red-50 px-2 py-2 font-bold text-red-700" onClick={resetAll}>恢复全部 Bundle</button></div>
    </aside>}
  </div>;
}

function Control({ label, children }: { label: string; children: ReactNode }) { return <div><div className="mb-1 font-bold text-neutral-500">{label}</div><div className="flex flex-wrap items-center gap-1 [&>button]:border [&>button]:bg-white [&>button]:px-2 [&>button]:py-1">{children}</div></div>; }
