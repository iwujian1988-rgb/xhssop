import assert from 'node:assert/strict';

import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { planSeededTopics } from '../src/lib/editorial-seed-library';
import { getRoutedTitleFormulas } from '../src/lib/full-title-formula-catalog';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { resolveProductEvidence } from '../src/lib/product-fact-retrieval';
import { hasForbiddenProductIdentity } from '../src/lib/product-prompt-profiles';
import type { ProductId } from '../src/types/data';

const productIds: ProductId[] = ['delf_b2_writing', 'tef_tcf_canada'];
let topicCount = 0;
let rawExcerptCount = 0;
const perProduct: Record<ProductId, { cards: number; topics: number }> = {
  delf_b2_writing: { cards: 0, topics: 0 },
  tef_tcf_canada: { cards: 0, topics: 0 },
};

for (const productId of productIds) {
  const facts = await loadProductFacts(productId);
  const supportedCards = competitorCreativeCards.filter(item => item.supported);
  perProduct[productId].cards = supportedCards.length;

  for (const card of supportedCards) {
    const spec = getCoverTemplateSpec(card.renderer_id);
    assert(spec, `missing template spec: ${card.renderer_id}`);
    const topics = planSeededTopics({
      productId,
      card,
      facts,
      direction: '',
      limit: 4,
      date: new Date('2026-07-26T00:00:00Z'),
    });
    assert.ok(topics.length >= 1, `${productId}/${card.id} should yield at least 1 compatible seed topic`);

    for (const topic of topics) {
      assert(topic.seed_id, `${productId}/${card.id} topic must carry seed_id`);
      assert.equal(topic.content_shape, spec.family, `${productId}/${card.id} content shape mismatch`);

      const topicText = `${topic.topic} ${topic.audience} ${topic.scene} ${topic.pain} ${topic.content_promise} ${topic.product_bridge} ${topic.search_terms.join(' ')}`;
      assert.equal(
        hasForbiddenProductIdentity(productId, topicText),
        false,
        `${productId}/${topic.seed_id} topic leaked forbidden identity: ${topicText}`,
      );

      const evidence = await resolveProductEvidence(productId, facts, topic);
      if (productId === 'delf_b2_writing') {
        assert(evidence.every(item => item.usage_caution?.includes('至少250词')), `${topic.seed_id} lost evidence usage caution`);
      }
      assert(evidence.every(item => !/230\s*[-~至]\s*280\s*词/.test(item.source_excerpt || '')), `${topic.seed_id} leaked obsolete word-count range`);
      assert(evidence.every(item => !/挽回至少?\s*5\s*[-~至]\s*10\s*分/.test(item.source_excerpt || '')), `${topic.seed_id} leaked unsupported score claim`);
      const anchorIds = new Set(topic.anchor_fact_ids || []);
      assert(anchorIds.size > 0, `${productId}/${topic.seed_id} has no anchors`);
      assert([...anchorIds].every(id => evidence.some(item => item.id === id && item.source_role === 'anchor')), `${productId}/${topic.seed_id} lost anchor evidence`);
      const formulas = getRoutedTitleFormulas(topic, spec.family);
      assert(formulas.length >= 5, `${productId}/${topic.seed_id}/${spec.family} title routing too narrow`);
      assert(formulas.length <= 8, `${productId}/${topic.seed_id}/${spec.family} title routing too broad`);
      topicCount += 1;
      perProduct[productId].topics += 1;
      rawExcerptCount += evidence.filter(item => item.source_excerpt).length;
    }
  }
}

assert.equal(rawExcerptCount, 0, 'raw Markdown should not be repeated in generation prompts');
console.log(JSON.stringify({
  per_product: perProduct,
  topics: topicCount,
  raw_markdown_excerpts: rawExcerptCount,
}, null, 2));
