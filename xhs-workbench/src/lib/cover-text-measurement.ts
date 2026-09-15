import { normalizeCoverBlock, type CoverEditSnapshot } from './cover-editor';

/** Measure intrinsic text, not the live fixed-height box or its resize handle. */
export function measureCoverTextHeight(node: HTMLElement): number {
  const probe = node.cloneNode(true) as HTMLElement;
  probe.removeAttribute('data-cover-block-id');
  probe.removeAttribute('contenteditable');
  probe.querySelectorAll('[data-editor-only]').forEach(child => child.remove());
  Object.assign(probe.style, {
    height: 'auto', minHeight: '0', maxHeight: 'none', display: 'block',
    boxSizing: 'border-box', visibility: 'hidden', pointerEvents: 'none',
    top: '0', left: '0', overflow: 'visible',
  });
  node.parentElement!.appendChild(probe);
  try { return Math.ceil(probe.offsetHeight); }
  finally { probe.remove(); }
}

export function growCoverTextBoxes(current: CoverEditSnapshot, heights: Map<string, number>): CoverEditSnapshot {
  let changed = false;
  const blocks = current.blocks.map(block => {
    const height = heights.get(block.id);
    if (!Number.isFinite(height) || height! <= block.height + 1) return block;
    const next = normalizeCoverBlock({ ...block, height: height! });
    if (next.height === block.height) return block;
    changed = true;
    return next;
  });
  return changed ? { ...current, blocks } : current;
}
