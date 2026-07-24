const baseUrl = process.env.BASE_URL || 'http://localhost:4000';
const rounds = Number(process.env.ROUNDS || 3);

for (let round = 1; round <= rounds; round += 1) {
  const topicsResult = await post({
    action: 'topics',
    product_id: 'delf_b2_writing',
    reference_card_id: 'resource_01_grammar_parchment_red',
    direction: round === 1 ? '' : round === 2 ? '偏实用干货，不做商品总目录' : '偏考前使用场景，避免与前两轮同题',
  });
  const topic = topicsResult.topics?.[(round - 1) % 3];
  if (!topic) throw new Error(`round ${round}: no topic`);
  const composeResult = await post({
    action: 'compose',
    product_id: 'delf_b2_writing',
    reference_card_id: 'resource_01_grammar_parchment_red',
    topic,
  });
  const draft = composeResult.draft;
  console.log(JSON.stringify({
    round,
    proposed_topics: topicsResult.topics.map(item => item.topic),
    chosen_topic: topic.topic,
    selected_title: draft.selected_title,
    title_candidates: draft.title_candidates.map(item => `${item.formula_id}:${item.title}`),
    cover_title: draft.cover.title,
    cover_sections: draft.cover.sections.map(section => ({
      heading: section.heading,
      count: section.items.length,
      sample: section.items.slice(0, 2).map(item => `${item.primary}${item.secondary ? ` / ${item.secondary}` : ''}`),
    })),
    inner_pages: draft.inner_pages.map(page => page.page_title),
    caption_excerpt: draft.caption.slice(0, 180),
    caption_length: draft.caption.length,
    seo_keywords: draft.seo_keywords,
    tags: draft.tags,
    accuracy_audit: draft.accuracy_audit,
    usage: composeResult.usage,
    checks: draft.checks,
  }, null, 2));
}

async function post(body) {
  const response = await fetch(`${baseUrl}/api/reference-studio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${result.error || JSON.stringify(result)}`);
  return result;
}
