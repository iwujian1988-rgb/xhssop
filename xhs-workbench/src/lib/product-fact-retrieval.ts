import type { EvidenceSnippet, MigratedTopic } from '@/types/reference-workflow';
import type { FactCategory, ProductFactItem, ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';
import { listVerifiedExamFacts, retrieveVerifiedExamFacts } from '@/lib/v2/verified-exam-facts';

const categoryWeight: Partial<Record<FactCategory, number>> = {
  knowledge_assets: 5,
  displayable_assets: 5,
  content_modules: 4,
  raw_selling_points: 3,
  raw_pain_points: 2,
  audiences: 1,
  use_cases: 1,
};

export function compactProductContext(facts: ProductFacts) {
  return Object.fromEntries(
    Object.entries(facts).map(([category, items]) => [
      category,
      (items as ProductFactItem[]).slice(0, 8).map(item => ({
        id: item.id,
        text: item.text,
        evidence: item.evidence,
        keywords: item.raw_keywords,
      })),
    ]),
  );
}

export function retrieveProductFacts(facts: ProductFacts, topic: MigratedTopic, limit = 14): EvidenceSnippet[] {
  const terms = uniqueTerms([
    ...topic.search_terms,
    topic.topic,
    topic.audience,
    topic.pain,
    topic.content_promise,
    topic.product_bridge,
  ]);

  return Object.entries(facts)
    .flatMap(([category, items]) => (items as ProductFactItem[]).map(item => ({
      item,
      category: category as FactCategory,
      score: scoreFact(item, terms) + (categoryWeight[category as FactCategory] || 0),
    })))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ item, category, score }) => ({
      id: item.id,
      category,
      text: item.text,
      evidence: item.evidence,
      source_file: item.source_file,
      source_section: item.source_section,
      score,
    }));
}

export async function resolveProductEvidence(
  productId: ProductId,
  facts: ProductFacts,
  topic: MigratedTopic,
  limit = 10,
): Promise<EvidenceSnippet[]> {
  const flatFacts = Object.entries(facts).flatMap(([category, items]) =>
    (items as ProductFactItem[]).map(item => ({ item, category: category as FactCategory })),
  );
  const byId = new Map(flatFacts.map(entry => [entry.item.id, entry]));
  const anchorIds = topic.anchor_fact_ids || [];
  const missing = anchorIds.filter(id => !byId.has(id));
  if (missing.length) {
    throw new Error(`种子知识锚点不存在：${missing.join('、')}`);
  }

  const anchors: EvidenceSnippet[] = anchorIds.map(id => {
    const entry = byId.get(id)!;
    return toSnippet(entry.item, entry.category, 100, 'anchor');
  });
  const explicitQuery = normalize([
    topic.topic,
    topic.content_promise,
    topic.product_bridge,
    ...(topic.dynamic_fact_terms || []),
  ].join(' '));
  const explicitMatches = flatFacts
    .map(entry => ({ ...entry, score: explicitEvidenceScore(entry.item, explicitQuery) }))
    .filter(entry => entry.score > 0 && !anchorIds.includes(entry.item.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(entry => toSnippet(entry.item, entry.category, 90 + entry.score, 'dynamic'));
  const explicitIds = new Set(explicitMatches.map(item => item.id));
  const dynamicTopic: MigratedTopic = {
    ...topic,
    search_terms: Array.from(new Set([...(topic.dynamic_fact_terms || []), ...topic.search_terms])),
  };
  const dynamic = retrieveProductFacts(facts, dynamicTopic, limit)
    .filter(item => !anchorIds.includes(item.id) && !explicitIds.has(item.id))
    .map(item => ({ ...item, source_role: 'dynamic' as const }));
  const usageCaution = productId === 'delf_b2_writing'
    ? '本条是知识素材，不自动等于官方硬规则。已核验官方要求：DELF B2写作至少250词。其余时间分配、论据数量、句法数量和连接词数量只能作为练习建议，不得写成“必须/至少/挽回多少分”。'
    : '本条是知识素材，不自动等于官方硬规则；学习建议不得改写成官方数量要求或提分承诺。';
  const officialFacts = retrieveVerifiedExamFacts(productId, topic, 6)
    .filter(item => !anchorIds.includes(item.id));
  // Always reserve one slot for a real product asset. Topic similarity alone can
  // fill the context with exam facts and pain points, leaving the writer nothing
  // concrete to sell even though the educational content is correct.
  const conversionCategories = new Set<FactCategory>([
    'raw_selling_points',
    'knowledge_assets',
    'displayable_assets',
    'content_modules',
  ]);
  const conversionAsset = flatFacts
    .filter(entry => conversionCategories.has(entry.category))
    .map(entry => ({
      ...entry,
      score: scoreFact(entry.item, uniqueTerms([explicitQuery])) + (categoryWeight[entry.category] || 0),
    }))
    .sort((a, b) => b.score - a.score)
    .map(entry => toSnippet(entry.item, entry.category, 80 + entry.score, 'dynamic'))[0];
  const prioritized = dedupeSnippets([
    ...anchors,
    ...officialFacts,
    ...(conversionAsset ? [conversionAsset] : []),
    ...explicitMatches,
    ...dynamic,
  ]);
  const combined = prioritized
    .slice(0, Math.max(limit, anchors.length + officialFacts.length + (conversionAsset ? 1 : 0)))
    .map(item => ({ ...item, usage_caution: item.usage_caution || usageCaution }));
  // The structured fact index is enough for topic/content grounding. Raw Markdown
  // is intentionally not attached to every generation call: French examples and
  // translations are verified by the final language audit instead.
  return combined;
}

export function resolveProductEvidenceByIds(
  productId: ProductId,
  facts: ProductFacts,
  ids: string[],
): EvidenceSnippet[] {
  const wanted = new Set(ids);
  const product = Object.entries(facts).flatMap(([category, items]) =>
    (items as ProductFactItem[])
      .filter(item => wanted.has(item.id))
      .map(item => toSnippet(item, category as FactCategory, 100, 'anchor')),
  );
  const official = listVerifiedExamFacts(productId).filter(item => wanted.has(item.id));
  return dedupeSnippets([...product, ...official]);
}

function dedupeSnippets(items: EvidenceSnippet[]) {
  return Array.from(new Map(items.map(item => [item.id, item])).values());
}

function explicitEvidenceScore(item: ProductFactItem, query: string) {
  const source = normalize(`${item.text} ${item.evidence} ${item.source_section} ${item.raw_keywords.join(' ')}`);
  const quantityPhrases = Array.from(new Set(query.match(/\d+(?:\.\d+)?(?:份|个|条|篇|套|题|词|分钟|小时|部分|科|项|天|分|大主题)/g) || []));
  const numericScore = quantityPhrases.filter(token => source.includes(token)).length * 100;
  const keywordScore = item.raw_keywords.reduce((sum, keyword) => {
    const normalized = normalize(keyword);
    if (normalized.length < 3 || !query.includes(normalized)) return sum;
    return sum + 10 + normalized.length;
  }, 0);
  return numericScore + keywordScore;
}

function scoreFact(item: ProductFactItem, terms: string[]) {
  const text = normalize(`${item.text} ${item.evidence} ${item.source_section} ${item.raw_keywords.join(' ')}`);
  const query = normalize(terms.join(' '));
  const directScore = terms.reduce((sum, term) => {
    const normalized = normalize(term);
    if (!normalized || normalized.length < 2) return sum;
    if (text.includes(normalized)) return sum + Math.min(10, 2 + normalized.length);
    return sum;
  }, 0);
  const keywordScore = item.raw_keywords.reduce((sum, keyword) => {
    const normalized = normalize(keyword);
    if (!normalized || normalized.length < 2 || !query.includes(normalized)) return sum;
    return sum + Math.min(12, 4 + normalized.length);
  }, 0);
  return directScore + keywordScore;
}

function toSnippet(
  item: ProductFactItem,
  category: FactCategory,
  score: number,
  sourceRole: EvidenceSnippet['source_role'],
): EvidenceSnippet {
  return {
    id: item.id,
    category,
    text: item.text,
    evidence: item.evidence,
    source_file: item.source_file,
    source_section: item.source_section,
    score,
    source_role: sourceRole,
  };
}

function uniqueTerms(values: string[]) {
  const parts = values.flatMap(value => value.split(/[\s,，、/｜|：:；;（）()]+/));
  return Array.from(new Set(parts.map(part => part.trim()).filter(part => part.length >= 2)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}
