import type { ProductId } from '@/types/data';
import type { ContentPackage, TopicOption } from './contracts';
import { examScopeContext } from '@/lib/product-exam-context';
import { getProductPromptProfile } from '@/lib/product-prompt-profiles';
import { getXhsSearchKeywords } from '@/lib/xhs-search-keywords';
import { selectReviewedDelfTags } from './delf-search-signals';

export type ProductTagSource = NonNullable<ContentPackage['finalTagSources']>[number];

/** One whole-note-first selector. Only the library quality differs per product. */
export function selectProductTags(productId: ProductId, topic: TopicOption, content: ContentPackage, recent = new Map<string, number>()): ProductTagSource[] {
  if (productId === 'delf_b2_writing') return selectReviewedDelfTags(topic.topic, content, recent);
  const exam = examScopeContext(productId, topic.examScope);
  const keywords = getXhsSearchKeywords(productId);
  const whole = [content.wholeNoteCore, topic.topic, topic.promise, ...content.tagMaterial, ...content.innerPages.flatMap(p => [p.page_title, p.lead, ...p.bullets])]
    .filter(Boolean).join(' ').toLowerCase();
  const allowed = [...keywords.primary, ...keywords.secondary]
    .filter(tag => examAllows(tag, exam?.scope));
  const ranked = allowed.map((tag, index) => ({
    tag: `#${tag.replace(/^#+/, '').replace(/\s+/g, '')}`,
    source: index < keywords.primary.length ? 'product_keyword_primary' : 'product_keyword_secondary',
    sourceQuery: tag,
    rank: index + 1,
    views: 0,
    tag_id: `${productId}:${tag}`,
    score: score(tag, whole) - (recent.get(tag.replace(/^#+/, '')) || 0) * 2,
  })).sort((a, b) => b.score - a.score || a.rank - b.rank);
  const identity = exam?.displayIdentity || getProductPromptProfile(productId).tagIdentity;
  const identityTag = `#${identity.replace(/[\s/]+/g, '')}`;
  const result = [
    { tag: identityTag, source: 'product_identity', sourceQuery: identity, rank: 0, views: 0, tag_id: `${productId}:identity`, score: 999 },
    ...ranked,
  ];
  return unique(result).slice(0, 7).map(({ score: _score, ...item }) => item);
}

function score(tag: string, whole: string) {
  const compact = tag.toLowerCase().replace(/\s+/g, '');
  return whole.includes(compact) ? 20 + compact.length : 0;
}
function examAllows(tag: string, scope?: string) {
  if (scope === 'tef_canada') return !/tcf/i.test(tag);
  if (scope === 'tcf_canada') return !/tef/i.test(tag);
  return true;
}
function unique(items: Array<ProductTagSource & { score: number }>) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
