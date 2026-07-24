import type { EvidenceSnippet, MigratedTopic } from '@/types/reference-workflow';
import type { FactCategory, ProductFactItem, ProductFacts } from '@/types/content-planning';

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

function scoreFact(item: ProductFactItem, terms: string[]) {
  const text = normalize(`${item.text} ${item.evidence} ${item.source_section} ${item.raw_keywords.join(' ')}`);
  return terms.reduce((sum, term) => {
    const normalized = normalize(term);
    if (!normalized || normalized.length < 2) return sum;
    if (text.includes(normalized)) return sum + Math.min(10, 2 + normalized.length);
    return sum;
  }, 0);
}

function uniqueTerms(values: string[]) {
  const parts = values.flatMap(value => value.split(/[\s,，、/｜|：:；;（）()]+/));
  return Array.from(new Set(parts.map(part => part.trim()).filter(part => part.length >= 2)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}
