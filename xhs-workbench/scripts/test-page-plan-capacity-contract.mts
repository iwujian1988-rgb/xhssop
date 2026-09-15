import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const temp = await fs.mkdtemp(path.join(root, '.tmp-page-plan-capacity-'));
process.env.OPENAI_API_KEY = 'OFFLINE_TEST_NOT_A_KEY';
process.env.OPENAI_BASE_URL = 'https://offline-test.invalid/v1';
delete process.env.AI_BRIDGE_DIR;

const require = createRequire(import.meta.url);
const dictionaryPath = require.resolve('dictionary-fr');
require.cache[dictionaryPath] = { id: dictionaryPath, filename: dictionaryPath, loaded: true, exports: {} } as NodeModule;
const { generateStandardKnowledgePagePlan } = require('../src/lib/v2/content-stage');
const { buildLockedProductionBrief } = require('../src/lib/v2/content-brief');
const { getCompetitorCreativeCard } = require('../src/lib/creative-card-library');
const { getCapabilityFallback } = require('../src/lib/v2/topic-stage');

const card = getCompetitorCreativeCard('resource_01_grammar_parchment_red');
assert.ok(card);
const capability = getCapabilityFallback(card);
const topic: any = {
  id: 'capacity-test', productId: 'delf_b2_writing', templateId: 'parchment_dense_directory',
  primaryGoal: 'save', topicLane: 'broad_pain', topicGranularity: 'level_1_asset',
  topic: 'DELF B2写作完整论证资料', audienceState: '', painOrDesire: '',
  promise: '交付四类论证模块和一份代表性完整应用', scene: '', contentAngle: '', productBridge: '',
  seo: { primary: 'DELF B2写作', related: [] }, knowledgeMode: 'educational_original',
  factTerms: [], seedSignals: [], noveltyFingerprint: 'capacity-test',
};
topic.productionBrief = buildLockedProductionBrief(topic);

let call = 0;
globalThis.fetch = async (_url, init) => {
  call += 1;
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, 'qwen3.8-max-0902');
  const system = body.messages[0].content as string;
  assert.match(system, /1至5个内页/);
  assert.match(system, /不得输出第6页/);
  assert.match(system, /pageContentPlan必须是string/);
  assert.doesNotMatch(system, /无固定页数/);
  assert.deepEqual(JSON.parse(body.messages[1].content), {
    finalPublicTopic: topic.topic,
    promise: topic.promise,
  });
  if (call === 1) {
    return response({ pages: Array.from({ length: 7 }, (_, index) => ({
      pageId: `p${index + 1}`,
      pageGoal: `目标${index + 1}`,
      userGets: `资产${index + 1}`,
      pageContentPlan: index === 0 ? ['完整材料', '', '简短中文说明'] : `安排${index + 1}`,
    })) }, 'capacity-seven');
  }
  return response({ pages: [{
    pageId: 'p1', pageGoal: '目标', userGets: '资产',
    pageContentPlan: [{ type: 'list', components: ['内容'] }],
  }] }, 'capacity-invalid');
};

function response(data: unknown, id: string) {
  return new Response(JSON.stringify({
    id,
    choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': id } });
}

process.chdir(temp);
try {
  const plan = await generateStandardKnowledgePagePlan({ topic, capability, evidence: [] });
  assert.equal(plan.data.length, 7);
  assert.equal(plan.data[0].pageContentPlan, '完整材料；简短中文说明');
  assert.deepEqual(plan.warnings, ['PAGE_PLAN_OVER_FIVE_NON_BLOCKING:7']);
  assert.match(plan.prompt_version, /page-plan-2-capacity/);

  await assert.rejects(
    generateStandardKnowledgePagePlan({ topic, capability, evidence: [] }),
    /PAGE_PLAN_SCHEMA_INVALID/,
  );
  assert.equal(call, 2);
  console.log('PASS: Page Plan capacity contract, legacy string[] normalization, >5 non-blocking continuation, and schema diagnostics. REAL_AI_CALLS=0');
} finally {
  process.chdir(root);
}
