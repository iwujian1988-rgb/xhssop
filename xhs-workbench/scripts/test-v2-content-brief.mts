/* eslint-disable no-console */
// 阶段 C 验收：内容任务单增补（设计 §5 改动 E，仅商品1普通模式灰度）。
// 全程离线：打桩 globalThis.fetch，捕获真实发送的 prompt，返回 canned JSON；
// 不碰真实 LLM。照抄 test-v2-b2-isolation.mts 的打桩模式。
import { createHash } from 'node:crypto';
import { generateContentPackage } from '../src/lib/v2/content-stage';
import { inspectForPublish } from '../src/lib/v2/publish-guard';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { buildConsensusBriefBlock, deriveTitlePromiseRange, resolveContentBriefActive } from '../src/lib/v2/content-brief';
import type { BridgePlan, TopicOption } from '../src/lib/v2/contracts';
import type { CompetitorCreativeCard } from '../src/types/reference-workflow';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) {
    console.log(`  ok: ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// legacy content system prompt 字节锁定基线（相对 d9063ea 现状，机械 diff 已证明
// 基础数组 31 行字面量逐字一致、新行只经门控 spread 追加）。
// standard = 商品2/3（tef_tcf_canada、tcf_canada_writing_7day）普通模式的 system prompt；
// showcase = 商品1（delf_b2_writing）知识库介绍模式（product_showcase）的 system prompt，
//            按现状含两行商品介绍条件行，与 standard 不同属预期，单独锁基线。
// 改动 legacy content system 需更新对应基线并在提交说明里给理由。
const PINNED_LEGACY_CONTENT_SYSTEM_SHA = {
  standard: 'ebf9198e6dd7d2934d2a2530ca37ed239f855d075ec7b5c2a71eb168b7fe82d6',
  showcase: '019abd5c02da58964f5d27f79b7035005a5c99adeb1dbf3bad744fc00e299aec',
};

// ---------------------------------------------------------------------------
// fetch 打桩（照抄 test-v2-b2-isolation.mts）
// ---------------------------------------------------------------------------
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
delete process.env.AI_BRIDGE_DIR;
const realFetch = globalThis.fetch;
interface CapturedAiRequest { system: string; user: string; }
const captured: CapturedAiRequest[] = [];
let cannedContent: unknown = null;
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body || '{}') as { messages: Array<{ role: string; content: string }> };
  captured.push({
    system: body.messages.find(m => m.role === 'system')?.content || '',
    user: body.messages.find(m => m.role === 'user')?.content || '',
  });
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(cannedContent) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    id: 'test-content-brief',
  }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-content-brief' } });
}) as typeof fetch;

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------
const card: CompetitorCreativeCard = {
  id: 'card_test_directory',
  name: '羊皮纸高密度资料目录',
  renderer_id: 'parchment_dense_directory',
  content_mechanism: '多分组知识体系',
  click_mechanism: '资料整理完整感',
} as CompetitorCreativeCard;
const capability = getCapabilityFallback(card);
const safeGoal = capability.allowedGoals.includes('search') ? 'search' : capability.allowedGoals[0];

function consensusTopic(overrides: Partial<TopicOption> = {}): TopicOption {
  return {
    id: 't-brief-1',
    productId: 'delf_b2_writing',
    templateId: card.renderer_id,
    primaryGoal: safeGoal,
    topicLane: 'broad_pain',
    topic: 'DELF B2写作考场草稿怎么打才不浪费时间',
    audienceState: '正在准备DELF B2写作、考场时间紧的人',
    scene: '模拟考和真考动笔前',
    painOrDesire: '怕打草稿来不及写正文',
    promise: '有一套不打满全文的提纲写法',
    contentAngle: '多分组知识体系',
    plannedBlockKind: capability.acceptedBlockKinds[0],
    productBridge: '对应资料包中的对照整理模块',
    seo: { primary: 'DELF B2写作', related: ['DELF B2写作'] },
    knowledgeMode: 'educational_original',
    factTerms: ['DELF B2'],
    seedSignals: [],
    noveltyFingerprint: 'brief-test-1',
    direction: '具体方法型',
    expandContents: ['先抄题目要求关键词', '列每段观点和例子提示', '标出要用的连接表达'],
    bridgeBasis: { capabilityId: 'cap-score-selfcheck', modules: ['02_DELF_B2评分对照', '08_写作检查清单_36项'] },
    coverFitReason: '内容可拆成多个检查分组',
    clickReason: '考场时间分配是普遍焦虑',
    speechAction: '带考生把草稿控制在五分钟内',
    openingEmotion: '一打草稿就停不下来，是很多考生的坑',
    ...overrides,
  } as TopicOption;
}

function fullBridgePlan(): BridgePlan {
  return {
    freeSolves: '这篇先解决草稿写到什么颗粒度的判断标准',
    userStillNeeds: '写完之后怎么按评分维度自查还缺一套清单',
    whyProduct: '资料里的评分对照和检查清单正好接上自查这一步',
    naturalCta: '需要完整清单的话可以看整理好的资料',
  };
}

function cannedBody(label: string, overrides: Record<string, unknown> = {}) {
  return {
    coverBlocks: [
      { id: 'b1', kind: capability.acceptedBlockKinds[0], heading: '草稿第一组', items: [{ primary: '抄下题目要求词' }, { primary: '列出每段观点词' }, { primary: '标记连接表达' }], priority: 1, sourceMode: 'general_advice', sourceIds: [] },
      { id: 'b2', kind: capability.acceptedBlockKinds[0], heading: '草稿第二组', items: [{ primary: '留出词数检查位' }, { primary: '超时转正式书写' }, { primary: '草稿只写提示词' }], priority: 2, sourceMode: 'general_advice', sourceIds: [] },
    ],
    innerPages: Array.from({ length: 5 }, (_, index) => ({
      page_type: 'knowledge_list',
      page_title: `草稿要点${index + 1}`,
      lead: '把这一页和自己的草稿习惯对照一遍再继续。',
      bullets: ['先看题目要求', '再列观点提示', '最后留检查位'],
    })),
    captionParts: {
      opening: `${label}考场上一打草稿就停不下来，这篇给你一个五分钟以内的提纲写法。`,
      value: [
        '草稿只写提示词，不写完整句，把时间留给正文；每段先落一个观点词和一个例子词。',
        '把题目要求里的关键词原样抄在草稿顶端，写正文时随时回看，避免跑题。',
        '连接表达提前标在段落之间，正文阶段直接照着串句子，不再现场想词。',
        '最后留出两分钟做词数和拼写检查，草稿上画一个检查位即可。',
      ],
      productBridge: `我把写作里反复要查的范文、词汇句型、观点和自查项整理成了一套 ${label} 知识库，练习时可以按自己的问题直接查。`,
      cta: '完整内容已经放在商品里，需要的话可以点小黄车看详情。',
    },
    tagMaterial: [label, '法语写作'],
    factualClaims: [],
    frenchSegments: [],
    ...overrides,
  };
}

function lastRequest(): CapturedAiRequest {
  return captured[captured.length - 1]!;
}

// canned 内容里的商品词必须跟 topic 商品一致，否则被商品身份串线闸门拦截（该闸门本身在正常干活）。
const P1_LABEL = 'DELF B2写作';
const PRODUCT_LABELS: Record<string, string> = { p2: 'TEF Canada', p3: 'TCF Canada写作', p1_showcase: 'DELF B2写作' };

async function main() {
  // -------------------------------------------------------------------------
  console.log(`\n== 0. 门控函数 ==`);
  assert(resolveContentBriefActive('delf_b2_writing', false) === true, '商品1普通模式开启');
  assert(resolveContentBriefActive('delf_b2_writing', true) === false, '商品1 showcase 关闭');
  assert(resolveContentBriefActive('tef_tcf_canada', false) === false, '商品2 关闭');
  assert(resolveContentBriefActive('tcf_canada_writing_7day', false) === false, '商品3 关闭');

  // -------------------------------------------------------------------------
  console.log(`\n== 1. 商品1 standard：promptInput 含 consensus_brief，system 含新说明 ==`);
  cannedContent = cannedBody(P1_LABEL, { bridgePlan: fullBridgePlan() });
  const art1 = await generateContentPackage({ topic: consensusTopic(), capability, evidence: [] });
  const req1 = lastRequest();
  const user1 = JSON.parse(req1.user) as Record<string, unknown>;
  assert('consensus_brief' in user1, 'user JSON 新增 consensus_brief 键');
  assert(req1.system.includes('consensus_brief 是本篇内容任务单的增补'), 'system 含说话动作/情绪起势落地说明');
  assert(req1.system.includes('bridgePlan'), 'system 含 bridgePlan 四拍说明');
  assert(req1.system.includes('不得超出 consensus_brief.标题可承诺范围'), 'system 含标题承诺范围说明');
  assert(art1.data.bridgePlan?.freeSolves === '这篇先解决草稿写到什么颗粒度的判断标准', '完整四拍解析进 ContentPackage.bridgePlan');
  assert(!art1.warnings.some(w => w.includes('缺失')), `完整输入不产缺失警告（实际 warnings: ${JSON.stringify(art1.warnings)}）`);

  // -------------------------------------------------------------------------
  console.log(`\n== 2. 商品2/3 + showcase：无新键，system 与现状字节一致（sha256 锁定） ==`);
  function legacyTopic(productId: 'tef_tcf_canada' | 'tcf_canada_writing_7day', goal = safeGoal): TopicOption {
    return consensusTopic({ productId, primaryGoal: goal, topicLane: goal === 'conversion' ? 'product_value' : 'broad_pain' }) as TopicOption;
  }
  const hashes: Record<string, string> = {};
  for (const [key, topic] of [
    ['p2', legacyTopic('tef_tcf_canada')],
    ['p3', legacyTopic('tcf_canada_writing_7day')],
    ['p1_showcase', consensusTopic({ primaryGoal: capability.allowedGoals.includes('conversion') ? 'conversion' : safeGoal, topicLane: 'product_value' })],
  ] as Array<[string, TopicOption]>) {
    cannedContent = cannedBody(PRODUCT_LABELS[key]);
    const art = await generateContentPackage({ topic, capability, evidence: [] });
    const req = lastRequest();
    const user = JSON.parse(req.user) as Record<string, unknown>;
    assert(!('consensus_brief' in user), `${key}: user JSON 无 consensus_brief 键`);
    assert(!req.system.includes('consensus_brief') && !req.system.includes('bridgePlan'), `${key}: system 无新说明行`);
    assert(art.data.bridgePlan === undefined, `${key}: ContentPackage 不带 bridgePlan`);
    assert(!art.warnings.some(w => w.includes('共识内容任务单') || w.includes('带货承接计划')), `${key}: 无共识任务单警告`);
    hashes[key] = sha256(req.system);
    console.log(`  content system sha256(${key}) = ${hashes[key]}`);
  }
  assert(hashes.p2 === hashes.p3, '商品2/3 system 逐字节一致（同一 legacy 数组）');
  assert(hashes.p2 === PINNED_LEGACY_CONTENT_SYSTEM_SHA.standard, '商品2/3（standard）legacy content system prompt 字节锁定（相对 d9063ea 现状）');
  // 商品1 showcase（知识库介绍模式）按现状含两行商品介绍条件行，与 standard 不同属预期，单独锁基线。
  assert(hashes.p1_showcase === PINNED_LEGACY_CONTENT_SYSTEM_SHA.showcase, '商品1 showcase（product_showcase）legacy content system prompt 字节锁定（相对 d9063ea 现状）');

  // -------------------------------------------------------------------------
  console.log(`\n== 3. 软约束：缺 speechAction/openingEmotion/expandContents 不失败、只警告 ==`);
  cannedContent = cannedBody(P1_LABEL);
  const sparseTopic = consensusTopic({ speechAction: undefined, openingEmotion: undefined, expandContents: undefined });
  let sparseOk = true;
  let sparseArt: Awaited<ReturnType<typeof generateContentPackage>> | undefined;
  try {
    sparseArt = await generateContentPackage({ topic: sparseTopic, capability, evidence: [] });
  } catch (error) {
    sparseOk = false;
    console.error('  异常：', error);
  }
  assert(sparseOk && Boolean(sparseArt), '缺字段不抛错、任务不失败');
  const brief = buildConsensusBriefBlock(sparseTopic);
  assert(brief.block['本篇说话动作'] === '' && brief.block['开头情绪起势'] === '', '块内缺失值留空');
  assert(sparseArt!.warnings.some(w => w.includes('本篇说话动作')), 'warnings 含「本篇说话动作」字段名');
  assert(sparseArt!.warnings.some(w => w.includes('开头情绪起势')), 'warnings 含「开头情绪起势」字段名');
  assert(sparseArt!.warnings.some(w => w.includes('准备展开的内容')), 'warnings 含「准备展开的内容」字段名');
  const sparseUser = JSON.parse(lastRequest().user) as Record<string, unknown>;
  assert((sparseUser.consensus_brief as Record<string, string>)['本篇说话动作'] === '', 'prompt 里对应值留空');

  // -------------------------------------------------------------------------
  console.log(`\n== 4. 标题可承诺范围派生 ==`);
  const range1 = deriveTitlePromiseRange(consensusTopic());
  assert(range1.includes('有一套不打满全文的提纲写法'), '派生文本包含 promise');
  assert(range1.includes('先抄题目要求关键词') && range1.includes('标出要用的连接表达'), '派生文本包含 expandContents');
  assert(range1.includes('DELF B2'), '派生文本包含事实锚词');
  assert(deriveTitlePromiseRange(consensusTopic({ promise: '', expandContents: undefined, factTerms: [] })) === '', '全部缺失时派生为空串且不抛错');

  // -------------------------------------------------------------------------
  console.log(`\n== 5. bridgePlan 软约束与 bridgeBasis 锚定 ==`);
  cannedContent = cannedBody(P1_LABEL, { bridgePlan: { freeSolves: '只写了这句', userStillNeeds: '', whyProduct: '', naturalCta: '' } });
  const partialArt = await generateContentPackage({ topic: consensusTopic(), capability, evidence: [] });
  assert(partialArt.data.bridgePlan === undefined, '部分缺失时 ContentPackage 不存半成品');
  assert(partialArt.warnings.some(w => w.startsWith('带货承接计划缺失：')), '部分缺失产生「带货承接计划缺失：」警告且不失败');
  cannedContent = cannedBody(P1_LABEL);
  const noPlanArt = await generateContentPackage({ topic: consensusTopic(), capability, evidence: [] });
  assert(noPlanArt.warnings.some(w => w.includes('带货承接计划缺失') && w.includes('bridgePlan')), '完全缺失产生警告且不失败');
  assert(req1.user.includes('cap-score-selfcheck') || req1.user.includes('02_DELF_B2评分对照'), 'prompt（user JSON）锚定 bridgeBasis 能力编号/模块名');

  // -------------------------------------------------------------------------
  console.log(`\n== 6. 商品1 standard 的 content prompt 字符增量（门控开 vs 关） ==`);
  const legacyTail = '禁止使用旧字段title/content/examples/claim/original。';
  const onSystem = req1.system;
  const tailIndex = onSystem.indexOf(legacyTail);
  assert(tailIndex >= 0, '现有末行原样保留（追加行在其后）');
  const offSystem = onSystem.slice(0, tailIndex + legacyTail.length);
  const user1Record = JSON.parse(req1.user) as Record<string, unknown>;
  delete user1Record.consensus_brief;
  const offUser = JSON.stringify(user1Record);
  const delta = (onSystem.length + req1.user.length) - (offSystem.length + offUser.length);
  console.log(`  门控开：system ${onSystem.length} 字 + user ${req1.user.length} 字`);
  console.log(`  门控关（机械剥离新键/新行）：system ${offSystem.length} 字 + user ${offUser.length} 字`);
  console.log(`  字符增量 = ${delta}`);
  assert(delta > 0, `字符增量为正（实际 ${delta}）`);

  // -------------------------------------------------------------------------
  console.log(`\n== 7. 补页警告链路（内容警告 → publish-guard → composeV2 result.warnings 的通路） ==`);
  cannedContent = cannedBody(P1_LABEL, { innerPages: cannedBody(P1_LABEL).innerPages.slice(0, 3) });
  const fewPagesArt = await generateContentPackage({ topic: consensusTopic(), capability, evidence: [] });
  assert(fewPagesArt.data.innerPages.length === 5, '内页已补齐到 5 页');
  assert(fewPagesArt.warnings.some(w => w.includes('补齐到 5 页') && w.includes('固定模板页')), 'generateContentPackage 的 artifact.warnings 含补页警告');
  const threePageContent = { ...fewPagesArt.data, innerPages: fewPagesArt.data.innerPages.slice(0, 3) };
  const inspection = inspectForPublish(threePageContent, { productId: 'delf_b2_writing', topic: consensusTopic(), capability, evidence: [] });
  assert(inspection.warnings.some(w => w.includes('补齐到 5 页') && w.includes('建议人工复核')), 'inspectForPublish.warnings 复述补页警告（pipeline.ts prepareContentForTitles 用 inspection.warnings 组装，最终进 composeV2 result.warnings）');

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
}

main()
  .catch(error => {
    console.error('测试执行异常：', error);
    failures += 1;
    console.log(`\n${failures} FAILURES`);
  })
  .finally(() => {
    globalThis.fetch = realFetch;
    process.exit(failures === 0 ? 0 : 1);
  });
