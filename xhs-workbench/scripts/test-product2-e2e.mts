import fs from 'node:fs/promises';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4000';
const productId = 'tef_tcf_canada';

// Three render modes (handoff section 5): code/hybrid/image_to_image.
const cases = [
  { mode: 'code', cardId: 'resource_01_grammar_parchment_red', family: 'directory' },
  { mode: 'hybrid', cardId: 'resource_04_chalkboard_phrase_list', family: 'phrase' },
  { mode: 'image_to_image', cardId: 'resource_13_course_roadmap_blue', family: 'roadmap' },
];

const summary: any[] = [];
const full: any[] = [];

for (const testCase of cases) {
  console.log(`\n=== ${testCase.mode} / ${testCase.cardId} ===`);

  let topics: any[] = [];
  try {
    const topicsResponse: any = await post({
      action: 'topics',
      product_id: productId,
      reference_card_id: testCase.cardId,
      direction: '',
    });
    topics = Array.isArray(topicsResponse.topics) ? topicsResponse.topics : [];
    console.log(`topics: ${topics.length}, usage: ${JSON.stringify(topicsResponse.usage)}`);
    for (const topic of topics) {
      console.log(`  [${topic.topic_type}] ${topic.seed_id} → ${topic.topic}`);
    }
  } catch (error: any) {
    console.error(`topics failed: ${error.message}`);
    summary.push({ ...testCase, stage: 'topics', error: error.message });
    continue;
  }

  // Pick the most "mainstream" topic: search_pain > selling_point > other.
  const priority = ['search_pain', 'selling_point', 'narrow_knowledge', 'product_showcase'];
  const topic = topics.slice().sort((a, b) => priority.indexOf(a.topic_type) - priority.indexOf(b.topic_type))[0];
  if (!topic) {
    console.error('no topic to compose');
    summary.push({ ...testCase, stage: 'topic-empty' });
    continue;
  }
  console.log(`picked: [${topic.topic_type}] ${topic.seed_id}`);

  try {
    const composeResponse: any = await post({
      action: 'compose',
      product_id: productId,
      reference_card_id: testCase.cardId,
      topic,
      max_attempts: 1,
    });
    const draft = composeResponse.draft;
    const result = {
      mode: testCase.mode,
      card_id: testCase.cardId,
      seed_id: topic.seed_id,
      topic: topic.topic,
      selected_title: draft?.selected_title,
      title_candidates: draft?.title_candidates?.map((item: any) => ({ title: item.title, formula_id: item.formula_id, trigger_type: item.trigger_type })),
      cover_title: draft?.cover?.title,
      cover_subtitle: draft?.cover?.subtitle,
      cover_item_count: draft?.cover?.sections?.reduce((sum: number, section: any) => sum + (section.items?.length || 0), 0),
      pages: draft?.inner_pages?.map((page: any) => ({ title: page.page_title, bullets: page.bullets?.length })),
      caption_length: draft?.caption?.length,
      tags: draft?.tags,
      checks: draft?.checks,
      accuracy_audit: draft?.accuracy_audit,
      usage: composeResponse.usage,
    };
    summary.push(result);
    full.push({ ...result, cover: draft?.cover, inner_pages: draft?.inner_pages, caption: draft?.caption, evidence: draft?.evidence });
    console.log(JSON.stringify({ ...result, pages: result.pages?.map((p: any) => p.title), title_candidates: result.title_candidates?.map((t: any) => t.title) }, null, 2));
  } catch (error: any) {
    console.error(`compose failed: ${error.message}`);
    summary.push({ ...testCase, stage: 'compose', seed_id: topic.seed_id, error: error.message });
  }
}

const stamp = Date.now();
await fs.writeFile(`product2-e2e-summary-${stamp}.json`, JSON.stringify(summary, null, 2), 'utf8');
await fs.writeFile(`product2-e2e-full-${stamp}.json`, JSON.stringify(full, null, 2), 'utf8');
console.log(`\nsaved product2-e2e-summary-${stamp}.json and product2-e2e-full-${stamp}.json`);

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
