import fs from 'node:fs/promises';
import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { hasForbiddenProductIdentity, hasRequiredProductIdentity } from '../src/lib/product-prompt-profiles';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4000';
const productId = 'tef_tcf_canada';

const supportedCards = competitorCreativeCards.filter(card => card.supported);

const results: any[] = [];
let cleanCount = 0;
let pollutedCount = 0;

for (const card of supportedCards) {
  console.log(`\n=== ${card.id} (${card.renderer_id}) ===`);

  let topics: any[] = [];
  try {
    const topicsResponse: any = await post({
      action: 'topics',
      product_id: productId,
      reference_card_id: card.id,
      direction: '',
    });
    topics = Array.isArray(topicsResponse.topics) ? topicsResponse.topics : [];
    console.log(`  topics: ${topics.length}`);
  } catch (error: any) {
    console.error(`  topics failed: ${error.message}`);
    results.push({ card_id: card.id, stage: 'topics', error: error.message });
    pollutedCount += 1;
    continue;
  }

  const priority = ['search_pain', 'selling_point', 'narrow_knowledge', 'product_showcase'];
  const topic = topics.slice().sort((a, b) => priority.indexOf(a.topic_type) - priority.indexOf(b.topic_type))[0];
  if (!topic) {
    console.error('  no topic');
    results.push({ card_id: card.id, stage: 'topic-empty' });
    pollutedCount += 1;
    continue;
  }

  try {
    const composeResponse: any = await post({
      action: 'compose',
      product_id: productId,
      reference_card_id: card.id,
      topic,
      max_attempts: 1,
    });
    const draft = composeResponse.draft;

    const coverText = JSON.stringify(draft?.cover || {});
    const pagesText = JSON.stringify(draft?.inner_pages || []);
    const captionText = draft?.caption || '';
    const tagsText = JSON.stringify(draft?.tags || []);
    const allText = `${coverText} ${pagesText} ${captionText} ${tagsText}`;

    const hasForbidden = hasForbiddenProductIdentity(productId, allText);
    const hasRequired = hasRequiredProductIdentity(productId, allText);
    const checkIssues = Array.isArray(draft?.checks?.issues) ? (draft!.checks!.issues as string[]) : [];
    const checkWarnings = Array.isArray(draft?.checks?.warnings) ? (draft!.checks!.warnings as string[]) : [];

    const clean = !hasForbidden && hasRequired && checkIssues.length === 0;

    if (clean) {
      cleanCount += 1;
      console.log(`  OK  cover_title="${draft?.cover?.title}"  tags=${JSON.stringify(draft?.tags?.slice(0, 3))}`);
    } else {
      pollutedCount += 1;
      console.log(`  FAIL  forbidden=${hasForbidden} required=${hasRequired} blocks=${checkIssues.length} warnings=${checkWarnings.length}`);
      if (hasForbidden) console.log(`    forbidden pattern hit in: ${allText.slice(0, 300)}`);
      if (checkIssues.length) console.log(`    blocks: ${JSON.stringify(checkIssues)}`);
    }

    results.push({
      card_id: card.id,
      renderer_id: card.renderer_id,
      seed_id: topic.seed_id,
      topic: topic.topic,
      selected_title: draft?.selected_title,
      cover_title: draft?.cover?.title,
      tags: draft?.tags,
      has_forbidden: hasForbidden,
      has_required: hasRequired,
      blocks: checkIssues,
      warnings: checkWarnings,
      accuracy_audit: draft?.accuracy_audit,
      clean,
    });
  } catch (error: any) {
    console.error(`  compose failed: ${error.message}`);
    results.push({ card_id: card.id, stage: 'compose', error: error.message });
    pollutedCount += 1;
  }
}

const stamp = Date.now();
await fs.writeFile(`product2-all-cards-${stamp}.json`, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n=== SUMMARY ===`);
console.log(`clean: ${cleanCount}/${supportedCards.length}, polluted: ${pollutedCount}/${supportedCards.length}`);
console.log(`saved product2-all-cards-${stamp}.json`);

async function post(body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}/api/reference-studio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const text = await response.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`invalid JSON: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`${response.status}: ${json.error || text.slice(0, 500)}`);
  return json;
}
