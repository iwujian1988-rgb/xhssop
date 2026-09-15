import assert from 'node:assert/strict';

import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { generateContentPackage } from '../src/lib/v2/content-stage';
import { inspectForPublish } from '../src/lib/v2/publish-guard';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentPackage, TopicOption } from '../src/lib/v2/contracts';

process.env.OPENAI_API_KEY = 'test-key';
delete process.env.AI_BRIDGE_DIR;

const calls: string[] = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body || '{}') as { messages?: Array<{ role: string; content: string }> };
  calls.push(body.messages?.find(message => message.role === 'system')?.content || '');
  const capability = currentCapability!;
  const bodyJson = {
    coverBlocks: [{
      id: 'family-block',
      kind: capability.acceptedBlockKinds[0],
      heading: '本篇要点',
      items: [{ primary: '先看一个具体动作' }, { primary: '再做一次练习' }],
      priority: 1,
      sourceMode: 'general_advice',
      sourceIds: [],
    }],
    innerPages: Array.from({ length: 5 }, (_, index) => ({
      page_type: 'knowledge_list',
      page_title: `第${index + 1}页`,
      lead: '把这一页和自己的情况对照一遍。',
      bullets: ['先看动作', '再做练习', '最后复盘'],
    })),
    captionParts: {
      opening: 'DELF B2写作遇到这个卡点时，先别急着把整篇重写。',
      value: [
        '先把题目要求拆成一个可以马上执行的动作，再决定正文里先写什么。',
        '练习时只改这一处，读完后对照结果，确认自己真的知道下一步怎么做。',
      ],
      productBridge: '这套DELF B2写作知识库里有对应的范文和自查项，可以按问题继续查。',
      cta: '如果你现在卡在开头，可以先看商品详情里的正式信范文目录。',
    },
    tagMaterial: ['DELF B2写作模板', '冷门自造词'],
    factualClaims: [],
    frenchSegments: [],
  };
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(bodyJson) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    id: 'test-content-family',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

const topic: TopicOption = {
  id: 'family-topic',
  productId: 'delf_b2_writing',
  templateId: 'plain_experience',
  primaryGoal: 'search',
  topicLane: 'broad_pain',
  topic: 'DELF B2写作一个具体卡点怎么处理',
  audienceState: '正在准备DELF B2写作的人',
  scene: '练习时遇到卡点',
  painOrDesire: '知道问题却不知道先改哪一步',
  promise: '给一个马上能执行的处理顺序',
  contentAngle: '具体方法',
  productBridge: '对应范文和自查项',
  seo: { primary: 'DELF B2写作', related: [] },
  knowledgeMode: 'educational_original',
  factTerms: [],
  seedSignals: [],
  noveltyFingerprint: 'family-test',
  speechAction: '带读者做一个判断',
  openingEmotion: '先别急',
};

let currentCapability: ReturnType<typeof getCapabilityFallback> | undefined;
const familyRenderers = ['plain_experience', 'notebook_big_words', 'blackboard_phrase', 'word_flashcard', 'vocab_table', 'course_roadmap', 'document_analysis', 'parchment_dense_directory'] as const;
const expectedShape: Record<string, RegExp> = {
  experience: /2到4段自然短段/,
  pain: /2到4段完成/,
  phrase: /2到4段短段或短组/,
  flashcard: /2到4段短段或短组/,
  table: /2到4段短段或短组/,
  roadmap: /2到4段完成/,
  document: /3到5段完成/,
  directory: /3到5段完成/,
};

for (const renderer of familyRenderers) {
  const card = competitorCreativeCards.find(item => item.renderer_id === renderer);
  assert.ok(card, `fixture card exists for ${renderer}`);
  currentCapability = getCapabilityFallback(card!);
  await generateContentPackage({ topic: { ...topic, templateId: renderer }, capability: currentCapability, evidence: [] });
  const prompt = calls.at(-1)!;
  assert.match(prompt, new RegExp(`family=${currentCapability.family}`), `${renderer}: prompt names family`);
  assert.match(prompt, expectedShape[currentCapability.family], `${renderer}: prompt uses family caption shape`);
  assert.doesNotMatch(prompt, /value数组固定4个非空字符串|captionParts\.value必须恰好写4段/, `${renderer}: no universal four-paragraph rule`);
}

const specificCta = '如果你现在卡在开头，可以先看商品详情里的正式信范文目录。';
const content: ContentPackage = {
  topicSnapshotHash: 'test',
  coverBlocks: [{ id: 'b', kind: 'paragraph', heading: '要点', items: [{ primary: '动作一' }, { primary: '动作二' }], priority: 1, sourceMode: 'general_advice', sourceIds: [] }],
  innerPages: Array.from({ length: 5 }, (_, index) => ({ page_no: index + 2, page_type: 'knowledge_list', page_title: `页${index}`, lead: '说明', bullets: ['动作一', '动作二', '动作三'], source_ids: [] })),
  captionParts: { opening: 'DELF B2写作先处理这个卡点。', value: ['这是第一段具体说明，给出一个完整动作和判断。', '这是第二段具体说明，给出一个完整练习和对照。', '这是第三段具体说明，给出一个完整提醒和复盘。'], productBridge: '这套DELF B2写作知识库里有正式信范文目录。', cta: specificCta },
  tagMaterial: [], factualClaims: [], frenchSegments: [],
};
const inspected = inspectForPublish(content, { productId: 'delf_b2_writing', topic, capability: getCapabilityFallback(competitorCreativeCards.find(item => item.renderer_id === 'plain_experience')!), evidence: [] });
assert.equal(inspected.content.captionParts.cta, specificCta, 'specific CTA remains intact');

console.log('ALL PASS');
