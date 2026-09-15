import type { GeneratedInnerPage, StructuredRenderPayload } from '@/types/reference-workflow';
import { semanticLayoutTypeFromAssetType } from './semantic-layout';

export type CompositionFit = 'PASS' | 'FAIL';
export type PageContentSufficiency = 'enough' | 'borderline' | 'insufficient';

export interface ComposedPage {
  page: GeneratedInnerPage;
  originalAssetType: string;
  finalSemanticLayoutType: GeneratedInnerPage['semanticLayoutType'];
  layoutPayloadFit: CompositionFit;
  pageContentSufficiency: PageContentSufficiency;
  verticalOccupancy: number | null;
  structuredRenderPayload?: StructuredRenderPayload;
  failureReason?: string;
}

function hasRenderablePayload(page: GeneratedInnerPage, expected: GeneratedInnerPage['semanticLayoutType']): boolean {
  return page.renderPayload?.semanticLayoutType === expected;
}

/**
 * Composition is deliberately conservative. It consumes an upstream payload
 * only when the payload already has the required semantic shape. It never
 * derives A/B columns, checklist fields, or French pairs by guessing from copy.
 */
export function composePage(page: GeneratedInnerPage, assetType: string): ComposedPage {
  const layout = page.semanticLayoutType || semanticLayoutTypeFromAssetType(assetType);
  const payload = hasRenderablePayload(page, layout) ? page.renderPayload : undefined;
  const chars = page.lead.length + page.bullets.join('').length;
  const pageContentSufficiency: PageContentSufficiency = chars >= 520 ? 'enough' : chars >= 120 ? 'borderline' : 'insufficient';
  const fit = payload ? 'PASS' : 'FAIL';
  return {
    page: payload ? page : { ...page, semanticLayoutType: layout },
    originalAssetType: assetType,
    finalSemanticLayoutType: layout,
    layoutPayloadFit: fit,
    pageContentSufficiency,
    verticalOccupancy: null,
    structuredRenderPayload: payload,
    failureReason: payload ? undefined : 'INSUFFICIENT_STRUCTURED_CONTENT: FINAL_FRENCH_QA 页面没有对应的结构化 renderPayload；禁止由 Renderer 或文本正则猜测版式。',
  };
}

export function composeRepresentativePage(page: GeneratedInnerPage, assetType: string): ComposedPage {
  return composePage(page, assetType);
}
