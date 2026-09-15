import type { ProductId } from '@/types/data';
import type { EvidenceSnippet } from '@/types/reference-workflow';
import type { UserVisiblePagePlan } from './contracts';
import { matchDelfB2InnerEvidenceCards, type EvidenceCardMatch } from './evidence-card-matcher';

/**
 * One production evidence contract for every product. Product 1 keeps its
 * frozen card library; product 2/3 temporarily expose their verified facts as
 * small cards. The matcher and page-scoping contract stay identical.
 */
export function matchProductInnerEvidenceCards(
  productId: ProductId,
  pages: UserVisiblePagePlan[],
  available: EvidenceSnippet[],
  options: { maxPerPage?: number; maxTotal?: number } = {},
): EvidenceCardMatch[] {
  const cardMatches = productId === 'delf_b2_writing'
    ? matchDelfB2InnerEvidenceCards(pages, options)
    : [];
  const already = new Set(cardMatches.map(item => item.id));
  const maxTotal = Math.max(0, options.maxTotal ?? 10);
  const fallbackMatches = available
    .filter(item => item.category === 'official_exam_fact' && !already.has(item.id))
    .map(item => matchOfficialFact(item, pages))
    .filter((item): item is EvidenceCardMatch => Boolean(item));
  return [...cardMatches, ...fallbackMatches].slice(0, maxTotal);
}

function matchOfficialFact(item: EvidenceSnippet, pages: UserVisiblePagePlan[]): EvidenceCardMatch | null {
  const terms = keywords(`${item.text} ${item.evidence || ''}`);
  if (!terms.length) return null;
  const applicablePageIds = pages
    .filter(page => {
      const text = `${page.pageGoal} ${page.userGets} ${page.pageContentPlan}`.toLowerCase();
      return terms.some(term => text.includes(term));
    })
    .map(page => page.pageId);
  // Official exam facts are still useful as a boundary even when the page plan
  // does not repeat the exact wording; attach them to the first relevant page.
  const scoped = applicablePageIds.length ? applicablePageIds : pages.slice(0, 1).map(page => page.pageId);
  if (!scoped.length) return null;
  return {
    ...item,
    applicablePageIds: scoped,
    matchedTriggers: terms.slice(0, 4),
    matchLevel: applicablePageIds.length ? 'combination' : 'exact',
    source_role: 'dynamic',
    usage_caution: item.usage_caution || '仅作为考试事实边界；未覆盖的数量、得分或训练建议不得写成官方规则。',
  };
}

function keywords(value: string) {
  return Array.from(new Set(value.toLowerCase().match(/[a-zà-ÿ]{3,}|tâche\s*[123]|tef|tcf|clb|nclc|写作|口语|听力|阅读|题型|任务|评分|字数/giu) || []))
    .map(term => term.replace(/\s+/g, ''));
}
