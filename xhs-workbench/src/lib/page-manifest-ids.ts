export const COVER_MANIFEST_PAGE_ID = 'P1';

/** Canonical manifest ID for a zero-based inner-page ordinal. */
export function manifestPageIdForInnerOrdinal(index: number) {
  if (!Number.isInteger(index) || index < 0) throw new Error(`非法内页序号：${index}`);
  return `P${index + 2}`;
}
