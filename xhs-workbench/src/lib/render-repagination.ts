import type { GeneratedInnerPage, ReferenceDrivenDraft, StructuredRenderPayload } from '@/types/reference-workflow';

function splitArray<T>(items: T[]): [T[], T[]] | null {
  if (items.length < 2) return null;
  const at = Math.ceil(items.length / 2);
  return [items.slice(0, at), items.slice(at)];
}

function splitPayload(payload: StructuredRenderPayload | undefined): [StructuredRenderPayload, StructuredRenderPayload] | null {
  if (!payload) return null;
  const checklist = splitArray(payload.items || []);
  if (checklist) return [{ ...payload, items: checklist[0] }, { ...payload, items: checklist[1] }];

  const groups = payload.groups || [];
  const groupPair = splitArray(groups);
  if (groupPair) return [{ ...payload, groups: groupPair[0] }, { ...payload, groups: groupPair[1] }];
  if (groups.length === 1) {
    const itemPair = splitArray(groups[0].items || []);
    if (itemPair) return [
      { ...payload, groups: [{ ...groups[0], items: itemPair[0] }] },
      { ...payload, groups: [{ ...groups[0], items: itemPair[1] }] },
    ];
  }

  if (payload.left && payload.right) {
    const rowCount = Math.max(payload.left.items.length, payload.right.items.length);
    if (rowCount >= 2) {
      const at = Math.ceil(rowCount / 2);
      return [
        { ...payload, left: { ...payload.left, items: payload.left.items.slice(0, at) }, right: { ...payload.right, items: payload.right.items.slice(0, at) } },
        { ...payload, left: { ...payload.left, items: payload.left.items.slice(at) }, right: { ...payload.right, items: payload.right.items.slice(at) } },
      ];
    }
  }
  return null;
}

function splitPage(page: GeneratedInnerPage): [GeneratedInnerPage, GeneratedInnerPage] | null {
  let bulletPair = splitArray(page.bullets || []);
  if (!bulletPair && page.bullets.length === 1) {
    const lines = page.bullets[0].split(/\n+/u).map(item => item.trim()).filter(Boolean);
    bulletPair = splitArray(lines);
  }
  const payloadPair = splitPayload(page.renderPayload);
  if (!bulletPair && !payloadPair) return null;
  const baseId = (page.pageId || `page_${page.page_no}`).replace(/__render_part_\d+$/u, '');
  const make = (part: 0 | 1): GeneratedInnerPage => ({
    ...page,
    pageId: `${baseId}__render_part_${part + 1}`,
    page_title: page.page_title,
    lead: part === 0 ? page.lead : '',
    bullets: bulletPair?.[part] || [],
    renderPayload: payloadPair?.[part] || page.renderPayload,
  });
  return [make(0), make(1)];
}

/** Deterministic render repair: regroup existing copy only; never invent text. */
export function repaginateDraftForOverflow(draft: ReferenceDrivenDraft, pageNo: number): ReferenceDrivenDraft | null {
  const index = draft.inner_pages.findIndex(page => page.page_no === pageNo);
  if (index < 0) return null;
  // Human-reviewed copy may split complete bullets, never trim/split inside a field.
  if (draft.manualInnerReview && draft.inner_pages[index].bullets.length < 2) return null;
  const pair = splitPage(draft.inner_pages[index]);
  if (!pair) return null;
  const pages = [...draft.inner_pages.slice(0, index), ...pair, ...draft.inner_pages.slice(index + 1)]
    .map((page, pageIndex) => ({ ...page, page_no: pageIndex + 2 }));
  return { ...draft, inner_pages: pages };
}
