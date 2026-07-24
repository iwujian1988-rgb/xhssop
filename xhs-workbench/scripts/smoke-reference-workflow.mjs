const cards = process.argv.slice(2);
const selectedCards = cards.length ? cards : [
  'resource_04_chalkboard_phrase_list',
  'resource_06_notes_course_offer',
  'resource_14_collocation_dense_green',
];

async function post(body) {
  const response = await fetch('http://localhost:4000/api/reference-studio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || String(response.status));
  return json;
}

for (const card of selectedCards) {
  console.log(`\nCARD ${card}`);
  const topicsResult = await post({
    action: 'topics',
    product_id: 'delf_b2_writing',
    reference_card_id: card,
    direction: '商品1 DELF B2 写作，优先做能传播或能带货的资料型内容',
  });
  console.log('topics:', topicsResult.topics.map(item => item.topic).join(' | '));
  console.log('topics_usage:', topicsResult.usage.total_tokens, topicsResult.usage.calls);

  const draftResult = await post({
    action: 'compose',
    product_id: 'delf_b2_writing',
    reference_card_id: card,
    topic: topicsResult.topics[0],
  });
  const draft = draftResult.draft;
  console.log('title:', draft.selected_title);
  console.log('cover:', draft.cover.title);
  console.log('cover_items:', draft.cover.sections.length, draft.cover.sections.reduce((sum, section) => sum + section.items.length, 0));
  console.log('pages_caption_tags:', draft.inner_pages.length, draft.caption.length, draft.tags.join(' '));
  console.log('audit:', draft.accuracy_audit.approved, draft.accuracy_audit.corrected_count, draft.accuracy_audit.issues.join('|'));
  console.log('checks:', JSON.stringify(draft.checks));
  console.log('draft_usage:', draftResult.usage.total_tokens, draftResult.usage.calls);
}
