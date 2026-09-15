const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4100';
const cardId = process.env.TEST_CARD_ID || 'production_user_practice_sheet';

async function post(body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/reference-studio`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const json = await response.json() as Record<string, any>;
  if (!response.ok) throw new Error(`${response.status}: ${json.error || JSON.stringify(json).slice(0, 500)}`);
  return json;
}

const topicResult = await post({
  action: 'topics',
  product_id: 'delf_b2_writing',
  reference_card_id: cardId,
  content_mode: 'standard',
  knowledge_mode: 'educational_original',
  direction: '围绕DELF B2写作，生成适合“一主项＋四个并列支项”版式的实用选题；不要介绍商品。',
});

const topic = topicResult.topics?.[0];
if (!topic) throw new Error('DeepSeek没有返回可用选题');
if (topic.v2_topic?.knowledgeMode !== 'educational_original') throw new Error('选题未进入AI自由创作模式');

const composeResult = await post({
  action: 'compose',
  product_id: 'delf_b2_writing',
  reference_card_id: cardId,
  content_mode: 'standard',
  knowledge_mode: 'educational_original',
  topic,
});

const draft = composeResult.draft;
if (!draft?.cover?.sections?.length) throw new Error('没有编译出封面分组');
if (draft.brief?.knowledge_base_plan !== '不检索本地知识库') throw new Error('brief仍要求本地知识库');
if (draft.brief?.selling_point) throw new Error('AI自由创作仍生成商品卖点');
if ((draft.caption || '').match(/知识库|资料包|商品|购买|小黄车/)) throw new Error('AI自由创作正文仍出现商品承接');
for (const section of draft.cover.sections) {
  for (const item of section.items) {
    const parts = String(item.note || item.secondary || '').split(/[·｜|]/).map((value: string) => value.trim()).filter(Boolean);
    if (parts.length !== 4) throw new Error(`四项拆解条目没有正好4项：${item.primary}`);
  }
}
if ((draft.inner_pages || []).some((page: any) => page.page_type === 'product_bridge')) throw new Error('AI自由创作仍追加商品尾页');

console.log(JSON.stringify({
  ok: true,
  card_id: cardId,
  topic: topic.topic,
  knowledge_mode: topic.v2_topic.knowledgeMode,
  cover_sections: draft.cover.sections.length,
  cover_items: draft.cover.sections.reduce((sum: number, section: any) => sum + section.items.length, 0),
  product_bridge: draft.brief?.selling_point || '',
  inner_page_types: draft.inner_pages.map((page: any) => page.page_type),
  usage: composeResult.usage,
}, null, 2));
