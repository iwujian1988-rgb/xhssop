import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { planSeededTopics } from '../src/lib/editorial-seed-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';

const productId = 'tef_tcf_canada' as const;
const facts = await loadProductFacts(productId);
const supportedCards = competitorCreativeCards.filter(item => item.supported);

for (const card of supportedCards) {
  const spec = getCoverTemplateSpec(card.renderer_id);
  if (!spec) {
    console.log(`${card.id}: NO SPEC`);
    continue;
  }
  const topics = planSeededTopics({
    productId,
    card,
    facts,
    direction: '',
    limit: 4,
    date: new Date('2026-07-26T00:00:00Z'),
  });
  console.log(`${card.id} (${spec.family}): ${topics.length} topics`);
  if (topics.length < 4) {
    for (const t of topics) {
      console.log(`  - [${t.topic_type}] ${t.seed_id}`);
    }
  }
}
