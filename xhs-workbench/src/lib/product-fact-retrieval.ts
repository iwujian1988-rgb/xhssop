import type { EvidenceSnippet, MigratedTopic } from '@/types/reference-workflow';
import type { FactCategory, ProductFactItem, ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';

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
  const dynamicTopic: MigratedTopic = {
    ...topic,
    search_terms: Array.from(new Set([...(topic.dynamic_fact_terms || []), ...topic.search_terms])),
  };
  const dynamic = retrieveProductFacts(facts, dynamicTopic, limit)
    .filter(item => !anchorIds.includes(item.id))
    .map(item => ({ ...item, source_role: 'dynamic' as const }));
  const usageCaution = productId === 'delf_b2_writing'
    ? '本条是知识素材，不自动等于官方硬规则。已核验官方要求：DELF B2写作至少250词。其余时间分配、论据数量、句法数量和连接词数量只能作为练习建议，不得写成“必须/至少/挽回多少分”。'
    : '本条是知识素材，不自动等于官方硬规则；学习建议不得改写成官方数量要求或提分承诺。';
  const combined = [...anchors, ...dynamic]
    .slice(0, Math.max(limit, anchors.length))
    .map(item => ({ ...item, usage_caution: usageCaution }));
  // The structured fact index is enough for topic/content grounding. Raw Markdown
  // is intentionally not attached to every generation call: French examples and
  // translations are verified by the final language audit instead.
  return combined;
}

function scoreFact(item: ProductFactItem, terms: string[]) {
  const text = normalize(`${item.text} ${item.evidence} ${item.source_section} ${item.raw_keywords.join(' ')}`);
  return terms.reduce((sum, term) => {
    const normalized = normalize(term);
    if (!normalized || normalized.length < 2) return sum;
    if (text.includes(normalized)) return sum + Math.min(10, 2 + normalized.length);
    return sum;
  }, 0);
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
