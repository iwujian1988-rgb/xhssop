import fs from 'node:fs/promises';

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4000';
const cases = [
  { cardId: 'resource_01_grammar_parchment_red', seedId: 'delf_argument_bank' },
  { cardId: 'resource_04_chalkboard_phrase_list', seedId: 'delf_formal_opening_closing' },
  { cardId: 'resource_11_delf_doc_analysis', seedId: 'delf_final_check' },
].slice(0, Math.max(1, Number(process.env.E2E_CASE_LIMIT || 3)));

const results: unknown[] = [];
for (const testCase of cases) {
  const topicsResponse = await post({
    action: 'topics',
    product_id: 'delf_b2_writing',
    reference_card_id: testCase.cardId,
    direction: '',
  });
  const topics = Array.isArray(topicsResponse.topics) ? topicsResponse.topics : [];
  const topic = topics.find((item: any) => item.seed_id === testCase.seedId) || topics[0];
  if (!topic) throw new Error(`${testCase.cardId}: no seeded topic`);

  const composeResponse = await post({
    action: 'compose',
    product_id: 'delf_b2_writing',
    reference_card_id: testCase.cardId,
    topic,
    max_attempts: 1,
  });
  const draft = composeResponse.draft;
  const result = {
    card_id: testCase.cardId,
    seed_id: topic.seed_id,
    topic: topic.topic,
    selected_title: draft?.selected_title,
    title_candidates: draft?.title_candidates?.map((item: any) => ({ title: item.title, formula_id: item.formula_id, trigger_type: item.trigger_type })),
    cover_title: draft?.cover?.title,
    cover_subtitle: draft?.cover?.subtitle,
    cover_items: draft?.cover?.sections?.reduce((sum: number, section: any) => sum + (section.items?.length || 0), 0),
    pages: draft?.inner_pages?.map((page: any) => page.page_title),
    caption_length: draft?.caption?.length,
    tags: draft?.tags,
    evidence_ids: draft?.evidence?.map((item: any) => item.id),
    hydrated_evidence_count: draft?.evidence?.filter((item: any) => item.source_excerpt)?.length,
    checks: draft?.checks,
    accuracy_audit: draft?.accuracy_audit,
    usage: composeResponse.usage,
  };
  results.push(result);
  console.log(JSON.stringify(result, null, 2));
}

const output = `seeded-e2e-result-${Date.now()}.json`;
await fs.writeFile(output, JSON.stringify(results, null, 2), 'utf8');
console.log(`saved ${output}`);

async function post(body: unknown): Promise<any> {
  const response = await fetch(`${baseUrl}/api/reference-studio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12 * 60 * 1000),
  });
  const text = await response.text();
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`invalid JSON: ${text.slice(0, 500)}`); }
  if (!response.ok) throw new Error(`${response.status}: ${json.error || text.slice(0, 500)}`);
  return json;
}
