import type { ContentPackage } from './contracts';
import type { GeneratedInnerPage } from '@/types/reference-workflow';
export type ConversionMode = NonNullable<ContentPackage['conversionMode']>;
export const CAPTION_LINK_CTA = '完整资料可以看下方链接 ⬇️';
export const CONVERSION_ENDINGS: Record<ConversionMode, string> = {
  image_product_page: CAPTION_LINK_CTA,
  comment_link: CAPTION_LINK_CTA,
  product_card: CAPTION_LINK_CTA,
  product_detail: CAPTION_LINK_CTA,
};
export const FIXED_PRODUCT_TRANSITION = '这篇先整理到这里，完整资料的目录和内容在下一页。';
export function resolveConversionMode(value: unknown): ConversionMode {
  if (value === undefined) return 'image_product_page';
  if (typeof value !== 'string' || !Object.hasOwn(CONVERSION_ENDINGS, value)) throw new Error('INVALID_CONVERSION_MODE');
  return value as ConversionMode;
}
/** Keep the sole destination instruction in cta; preserve non-commercial use guidance. */
export function singleCaptionCta(parts: ContentPackage['captionParts'], _legacyMode?: ConversionMode): ContentPackage['captionParts'] {
  const clean = (text: string) => text.split(/\n+/u).map(paragraph => (paragraph.match(/[^。！？!?]+[。！？!?]?/gu) || [])
    .filter(sentence => !/评论区|商品卡|商品详情|商品页|详情页|链接|https?:|点击|点此|翻页|(?:往后|继续|向后|再|往下)翻|(?:下一|最后一)页|(?:私信|下单|购买|领取)/u.test(sentence))
    .join('').trim()).filter(Boolean).join('\n\n');
  return { opening: clean(parts.opening), value: parts.value.map(clean).filter(Boolean), productBridge: clean(parts.productBridge), cta: CAPTION_LINK_CTA };
}
/** Presentation-only page; never insert it into the canonical teaching Inner. */
export function appendConversionTransition(pages: GeneratedInnerPage[], content: Pick<ContentPackage, 'conversionMode' | 'transitionText'>): GeneratedInnerPage[] {
  // Compatibility with saved Jobs: modes are retired and never add a transition.
  return pages.filter(page => page.pageId !== 'conversion_transition');
}

export function assembleFinalCaption(parts: ContentPackage['captionParts'], tags: string[]): string {
  const note = singleCaptionCta({...parts, productBridge:'',cta:''});
  return [note.opening,...note.value,tags.join(' '),parts.productBridge,CAPTION_LINK_CTA].filter(Boolean).join('\n\n');
}

export function ensureCaptionSeo(parts: ContentPackage['captionParts'], keywords: string[]) {
  const normalize = (text: string) => text.replace(/\s+/gu,'').toLowerCase();
  const body = normalize([parts.opening,...parts.value].join(' '));
  if (keywords.some(keyword => body.includes(normalize(keyword)))) return false;
  const keyword = keywords.find(word => word === '法语写作') || keywords[0];
  if (!keyword) return false;
  parts.opening = `准备${keyword}时，这篇可以作为查阅参考。${parts.opening}`;
  return true;
}
