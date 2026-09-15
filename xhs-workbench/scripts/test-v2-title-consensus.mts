/* eslint-disable no-console */
// 阶段 D 验收：标题共识方向池（设计 §4，仅商品1普通模式灰度）。
// 全程离线：打桩 globalThis.fetch，捕获真实发送的 prompt，返回 canned JSON；
// 不碰真实 LLM。打桩模式照抄 test-v2-content-brief.mts。
import { createHash } from 'node:crypto';
import { generateTitlePackage, passesTitleHardGatesForTest } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { buildLockedProductionBrief } from '../src/lib/v2/content-brief';
import { clampTitleCandidateCount, resolveTitleConsensusActive, sampleDirectionsForNote, shouldPreferGroundedEmotionDefault } from '../src/lib/v2/title-consensus';
import { setTitleHumanizerPairsForTest } from '../src/lib/v2/title-humanizer-library';
import type { ContentPackage, TitlePair, TopicOption } from '../src/lib/v2/contracts';
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

// legacy title system prompt 字节锁定基线（在 4fdb786 现状、阶段 D 改动前实测抓取）。
// standard = 商品2/3（tef_tcf_canada、tcf_canada_writing_7day）普通模式同一数组的 system prompt；
// showcase = 商品1（delf_b2_writing）知识库介绍模式（product_showcase）的 system prompt，
//            按现状含商品介绍条件行，与 standard 不同属预期，单独锁基线。
// 改动 legacy title system 需更新对应基线并在提交说明里给理由。
const PINNED_LEGACY_TITLE_SYSTEM_SHA = {
  standard: '523d9fee6108296fa72a9fcf2fe5d1133ac7078b2f7c008195a4cd7e317093c0',
  showcase: '602ccc87f800296ba52780b68a72d48da7a89005f83541c3a389a274357ac9c8',
};

// ---------------------------------------------------------------------------
// fetch 打桩（照抄 test-v2-content-brief.mts）
// ---------------------------------------------------------------------------
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
delete process.env.AI_BRIDGE_DIR;
const realFetch = globalThis.fetch;
// 本套件锁定 v7 共识调用次数；Humanizer 的接线由专项套件覆盖。
setTitleHumanizerPairsForTest([]);
interface CapturedAiRequest { system: string; user: string; maxTokens?: number; }
const captured: CapturedAiRequest[] = [];
// canned 队列：每次 AI 调用弹出一个响应；队列空时复用最后一个。
const cannedQueue: unknown[] = [];
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body || '{}') as { messages: Array<{ role: string; content: string }>; max_tokens?: number };
  captured.push({
    system: body.messages.find(m => m.role === 'system')?.content || '',
    user: body.messages.find(m => m.role === 'user')?.content || '',
    maxTokens: body.max_tokens,
  });
  const canned = cannedQueue.length > 1 ? cannedQueue.shift() : cannedQueue[0];
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(canned ?? { candidates: [] }) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    id: 'test-title-consensus',
  }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-title-consensus' } });
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
    id: 't-title-1',
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
    noveltyFingerprint: 'title-consensus-fp-1',
    expandContents: ['先抄题目要求关键词', '列每段观点和例子提示', '标出要用的连接表达'],
    ...overrides,
  } as TopicOption;
}

const content: ContentPackage = {
  coverBlocks: [
    { id: 'b1', kind: capability.acceptedBlockKinds[0], heading: '草稿第一组', items: [{ primary: '草稿只写提示词，不抄全文' }, { primary: '列出每段观点词和例子词' }, { primary: '标记段落之间的连接表达' }], priority: 1, sourceMode: 'general_advice', sourceIds: [] },
    { id: 'b2', kind: capability.acceptedBlockKinds[0], heading: '草稿第二组', items: [{ primary: '留出词数检查位' }, { primary: '考前计时练一遍提纲模板' }, { primary: '超时就转正式书写' }], priority: 2, sourceMode: 'general_advice', sourceIds: [] },
  ],
  innerPages: Array.from({ length: 5 }, (_, index) => ({
    page_type: 'knowledge_list',
    page_title: `草稿要点${index + 1}`,
    lead: '把这一页和自己的草稿习惯对照一遍再继续。',
    bullets: ['先看题目要求', '再列观点提示', '最后留检查位'],
  })),
  captionParts: {
    opening: '考场上一打草稿就停不下来，这篇给你一个五分钟以内的提纲写法。',
    value: [
      '草稿只写提示词，不写完整句，把时间留给正文。',
      '把题目要求里的关键词原样抄在草稿顶端，写正文时随时回看。',
      '连接表达提前标在段落之间，正文阶段直接照着串句子。',
    ],
    productBridge: '整理好的资料可以按问题直接查。',
    cta: '需要的话点小黄车看详情。',
  },
  tagMaterial: ['法语写作'],
  factualClaims: [],
  frenchSegments: [],
} as unknown as ContentPackage;

// 4 组能过全部硬门槛的商品1候选（方向各不相同）。
function goodCandidates(): TitlePair[] {
  return [
    { textTitle: 'DELF B2写作草稿只写提示词不写整句', coverTitle: 'DELF B2考场草稿打法', coverSubtitle: '提示词代替完整句', mechanism: 'fast_path', userRelation: '考场时间紧的考生', seoKeyword: 'DELF B2写作草稿', noveltyFingerprint: 'n1' },
    { textTitle: 'DELF B2写作打草稿总怕来不及写完', coverTitle: 'DELF B2草稿来不及怎么办', coverSubtitle: '草稿瘦身留时间', mechanism: 'pain', userRelation: '怕来不及写完的考生', seoKeyword: 'DELF B2草稿', noveltyFingerprint: 'n2' },
    { textTitle: 'DELF B2写作提纲模板考前直接套用', coverTitle: 'DELF B2写作提纲速查', coverSubtitle: '提纲模板照关键词列', mechanism: 'material', userRelation: '考前想直接练提纲的考生', seoKeyword: 'DELF B2提纲', noveltyFingerprint: 'n3' },
    { textTitle: 'DELF B2写作别再打满全文草稿', coverTitle: 'DELF B2草稿不用写全文', coverSubtitle: '提示词足够撑起正文', mechanism: 'counter', userRelation: '习惯打满全文草稿的考生', seoKeyword: 'DELF B2写作草稿', noveltyFingerprint: 'n4' },
  ];
}

function finalEditResponse() {
  return {
    candidates: [
      { clickReasonType: '错误做法', clickReason: '把草稿写成完整句会挤占正式正文时间', textTitle: '拜托🙏 B2写作草稿别再抄整句了', coverTitle: 'DELF B2考场草稿打法', coverSubtitle: '提示词就能撑起正文' },
      { clickReasonType: '结果焦虑', clickReason: '草稿阶段没有停止点会导致正文时间被耗光', textTitle: '你的B2写作草稿总把正文时间耗光', coverTitle: 'DELF B2草稿瘦身法', coverSubtitle: '只留观点词和例子词' },
      { clickReasonType: '被说中场景', clickReason: '一开始打草稿就不断补句子而停不下来', textTitle: 'B2写作一打草稿就停不下来的人', coverTitle: 'DELF B2草稿怎么打', coverSubtitle: '超时就转正式书写' },
      { clickReasonType: '考场失控', clickReason: '草稿写得越满会让正式正文越赶', textTitle: '考场草稿写得越满，B2正文越赶', coverTitle: 'DELF B2草稿别写全文', coverSubtitle: '最后还要留检查位' },
    ],
  };
}

// 商品2（需 TEF/TCF 组合身份）与商品3（需 TCF 系身份、禁 TEF）的合法候选：
// 让 legacy 路径 4 组全过、不触发返修，才能断言「全程只有 1 次 AI 调用」。
function legacyCandidates(kind: 'tef' | 'tcf'): TitlePair[] {
  const id = kind === 'tef' ? 'TEF/TCF' : 'TCF写作';
  return [
    { textTitle: `${id}草稿只写提示词不写整句`, coverTitle: `${id === 'TEF/TCF' ? 'TEF/TCF' : 'TCF写作'}考场草稿打法`, coverSubtitle: '提示词代替完整句', mechanism: 'fast_path', userRelation: '考场时间紧的考生', seoKeyword: 'TEF/TCF草稿', noveltyFingerprint: 'l1' },
    { textTitle: `${id}打草稿总怕来不及写完`, coverTitle: `${id === 'TEF/TCF' ? 'TEF/TCF' : 'TCF写作'}草稿来不及怎么办`, coverSubtitle: '草稿瘦身留时间', mechanism: 'pain', userRelation: '怕来不及写完的考生', seoKeyword: 'TEF/TCF草稿', noveltyFingerprint: 'l2' },
    { textTitle: `${id}提纲模板考前直接套用`, coverTitle: `${id === 'TEF/TCF' ? 'TEF/TCF' : 'TCF写作'}提纲速查`, coverSubtitle: '提纲模板照关键词列', mechanism: 'material', userRelation: '考前想直接练提纲的考生', seoKeyword: 'TEF/TCF提纲', noveltyFingerprint: 'l3' },
    { textTitle: `${id}别再打满全文草稿`, coverTitle: `${id === 'TEF/TCF' ? 'TEF/TCF' : 'TCF写作'}草稿不用写全文`, coverSubtitle: '提示词足够撑起正文', mechanism: 'counter', userRelation: '习惯打满全文草稿的考生', seoKeyword: 'TEF/TCF草稿', noveltyFingerprint: 'l4' },
  ];
}

function lastRequest(): CapturedAiRequest {
  return captured[captured.length - 1]!;
}
function firstRequest(): CapturedAiRequest {
  return captured[0]!;
}

async function runGeneration(topic: TopicOption, candidateCount?: number) {
  try {
    const productionBrief = buildLockedProductionBrief(topic);
    const lockedTopic = { ...topic, productionBrief };
    const lockedContent = { ...content, productionBriefHash: productionBrief.briefHash };
    return { ok: true as const, artifact: await generateTitlePackage({ topic: lockedTopic, capability, content: lockedContent, ...(candidateCount !== undefined ? { candidateCount } : {}) }) };
  } catch (error) {
    return { ok: false as const, error };
  }
}

async function main() {
  // -------------------------------------------------------------------------
  console.log(`\n== 0. 门控矩阵 ==`);
  assert(resolveTitleConsensusActive('delf_b2_writing', false) === true, '商品1普通模式开启');
  assert(resolveTitleConsensusActive('delf_b2_writing', true) === false, '商品1 showcase 关闭');
  assert(resolveTitleConsensusActive('tef_tcf_canada', false) === false, '商品2 关闭');
  assert(resolveTitleConsensusActive('tcf_canada_writing_7day', false) === false, '商品3 关闭');

  // -------------------------------------------------------------------------
  console.log(`\n== 1. 方向采样稳定性（stableHash 洗牌） ==`);
  const fpA = 'title-consensus-fp-1';
  const fpB = 'title-consensus-fp-2';
  const subsetA = sampleDirectionsForNote(fpA, 4);
  assert(JSON.stringify(sampleDirectionsForNote(fpA, 4)) === JSON.stringify(subsetA), '同指纹两次采样结果一致（含顺序）');
  assert(subsetA.length === 4 && new Set(subsetA).size === 4, 'count=4 取 4 个不重复方向');
  assert(subsetA.includes('emotion'), '正常候选池固定保留1个情绪方向');
  assert(sampleDirectionsForNote(fpA, 1).length === 1, 'count=1 边界');
  assert(sampleDirectionsForNote(fpA, 8).length === 6, 'count=8 超过池子大小时封顶取全 6 池');
  const subsetB = sampleDirectionsForNote(fpB, 4);
  assert(JSON.stringify(subsetA) !== JSON.stringify(subsetB), `异指纹子集不同（A=${subsetA.join('/')} B=${subsetB.join('/')}）`);
  assert(clampTitleCandidateCount(undefined) === 4 && clampTitleCandidateCount(0) === 1 && clampTitleCandidateCount(99) === 8 && clampTitleCandidateCount(6) === 6, 'candidateCount clamp 1-8 默认 4');
  assert(sampleDirectionsForNote(fpA, 1)[0] === 'emotion', '只生成1组时保留情绪方向');
  assert(shouldPreferGroundedEmotionDefault(fpA) === shouldPreferGroundedEmotionDefault(fpA), '情绪首位轮换对同一指纹稳定');

  // -------------------------------------------------------------------------
  console.log(`\n== 2. 门控开的 payload：方向子集/能力列表/buyerMap/内页摘要/承诺范围 ==`);
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: goodCandidates() }, finalEditResponse());
  const art1 = await runGeneration(consensusTopic());
  assert(art1.ok && art1.artifact.data.candidates.length === 4, '商品1普通模式由最终创作节点返回4组可选终稿');
  // 首个生成请求的断言全部保留（最终终审追加后 captured[0] 仍是生成请求）。
  const req1 = firstRequest();
  const user1 = JSON.parse(req1.user) as Record<string, any>;
  const expectedMix = sampleDirectionsForNote(fpA, 4);
  assert(JSON.stringify(Object.keys(user1.required_candidate_mix)) === JSON.stringify(expectedMix) && Object.keys(user1.required_candidate_mix).length === 4, 'required_candidate_mix 键序与采样方向一致');
  assert(expectedMix.every(dir => user1.required_candidate_mix[dir] === 1), `方向子集进 prompt：${expectedMix.join('/')}`);
  assert(req1.system.includes('每方向恰好1组') && req1.system.includes(expectedMix.join('/')), 'system 含方向子集说明与英文方向值');
  assert(!req1.system.includes('四种机制各1组'), 'system 不再含 legacy「四种机制各1组」行');
  assert(Array.isArray(user1.product_capabilities) && user1.product_capabilities.length >= 8 && user1.product_capabilities[0].capability_id === 'cap-sample-library', '商品能力列表进 user JSON');
  assert(user1.buyer_map && Array.isArray(user1.buyer_map.userStages) && user1.buyer_map.realStates.length >= 5 && user1.buyer_map.motivations.length >= 5, 'buyerMap 三块全量进 user JSON');
  assert(Array.isArray(user1.actual_content.inner_pages) && user1.actual_content.inner_pages.length === 5, '内页摘要 5 页进 actual_content.inner_pages');
  assert((user1.actual_content.inner_pages || []).every((page: any) => page.page_title && page.lead && Array.isArray(page.bullets) && page.bullets.length <= 3), '每页摘要含 page_title/lead/bullets前3');
  assert(typeof user1.title_promise_range === 'string' && user1.title_promise_range.includes('不打满全文的提纲写法'), '标题可承诺范围进 user JSON（含 promise）');
  assert(Array.isArray(user1.approved_title_style_examples) && user1.approved_title_style_examples.length === 12, '首轮生成也收到12条用户认可风格样本');
  assert(req1.system.includes('目标用户正在经历的问题') && req1.system.includes('不要把资料目录当成标题'), '首轮 system 从用户问题出发而非资料目录');
  // 最终创作请求（第 2 次调用）：不读取 shortlist，只凭事实、当前模板与样本独立写多组终稿。
  assert(captured.length === 2, `首轮 4 组全过后只有生成+最终终审两次调用（实际 ${captured.length}）`);
  const finalReq = captured[1]!;
  const finalUser = JSON.parse(finalReq.user) as Record<string, any>;
  assert(finalReq.system.includes('可以独立创作的小红书标题编辑') && finalReq.system.includes('程序不会替你补语感、截字、改词或排序'), '终审 system 明确是最后独立创作节点');
  assert(Array.isArray(finalUser.style_references) && finalUser.style_references.length === 6, '6 条用户认可语感样本进最终终审 prompt');
  assert(finalUser.style_references.every((ref: string) => ref.startsWith('「') && ref.includes('（')), '终审样本渲染为「标题（风格标签）」');
  assert(!('candidates' in finalUser) && !finalReq.user.includes(goodCandidates()[0]!.textTitle), '最终终审不接收旧候选，不承担润色包袱');
  assert(finalReq.maxTokens === 1700, '默认4组最终终审 maxTokens=1700');
  assert(finalReq.system.includes('clickReasonType只是表达角度') && finalReq.system.includes('具体、完整、可由正文支持的因果或需求命题'), '终审区分角度标签与具体点击命题');
  assert(finalReq.system.includes('语义上不同') && finalReq.system.includes('cover_asset_contract'), '终审带语义理由多样性与资产契约规则');
  assert(JSON.stringify(finalUser.cover_asset_contract).includes('草稿只写提示词') && JSON.stringify(finalUser.click_reason_evidence).includes('怕打草稿来不及写正文'), '终审 payload 含具体资产与点击理由证据');
  assert(!('required_candidate_mix' in finalUser), '最终终审不带方向混合（区别于生成请求）');
  assert((finalUser.emotion_policy as Record<string, unknown>).required_candidate && finalReq.system.includes('有具体原因的情绪标题'), '终审明确要求至少1组有事实支撑的情绪候选');
  assert(finalReq.system.includes('焦虑、破防、崩溃、慌') && finalReq.system.includes('不要自动替换成更安全的干货词'), '允许直接使用情绪词，不再默认安全化');
  assert(art1.ok && art1.artifact.data.candidates.some(pair => pair.mechanism === 'emotion'), '终审保留情绪候选的真实方向，不再统一覆盖成final_editor');
  assert(art1.ok && art1.artifact.data.selected.textTitle === finalEditResponse().candidates[0]!.textTitle, '最终终审首条按原序成为UI默认 selected');
  assert(art1.ok && art1.artifact.warnings.some(w => w.includes('标题终审') && w.includes('程序未改字')), 'warnings 如实记录终审通过且程序未改字');

  // candidateCount clamp 透传
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: goodCandidates() });
  await runGeneration(consensusTopic(), 0);
  const userCount1 = JSON.parse(firstRequest().user) as Record<string, any>;
  assert(Object.keys(userCount1.required_candidate_mix).length === 1, 'candidateCount=0 clamp 到 1，方向子集 1 个');
  assert(firstRequest().system.includes('只返回1组成对候选'), 'system 写明 1 组');
  assert(firstRequest().system.includes('完整词、完整短语或完整句子收尾') && firstRequest().system.includes('主动改写成更短的完整表达'), '共识 system 含完整收尾+近限改短两条 prompt 约束（截断残尾 prompt 轮）');
  captured.length = 0;
  await runGeneration(consensusTopic(), 99);
  const userCount8 = JSON.parse(firstRequest().user) as Record<string, any>;
  assert(Object.keys(userCount8.required_candidate_mix).length === 6, 'candidateCount=99 clamp 到 8、方向封顶 6');
  assert(firstRequest().system.includes('每方向至少1组'), '组数>方向数时 system 说明每方向至少1组');
  const finalCount6 = JSON.parse(lastRequest().user) as Record<string, any>;
  assert(finalCount6.candidate_count_max === 6 && lastRequest().maxTokens === 2300, '最终创作节点独立封顶最多6组，不跟随上游8组硬凑');

  // -------------------------------------------------------------------------
  console.log(`\n== 3. 商品2/3 + 商品1 showcase：system 与 4fdb786 现状逐字节一致（sha256 锁定） ==`);
  function legacyTopic(productId: 'tef_tcf_canada' | 'tcf_canada_writing_7day'): TopicOption {
    return consensusTopic({
      productId,
      topic: 'TEF Canada写作考场草稿怎么打才不浪费时间',
      seo: { primary: 'TEF Canada写作', related: ['TEF Canada写作'] },
      factTerms: ['TEF Canada'],
    }) as TopicOption;
  }
  const hashes: Record<string, string> = {};
  const legacyRuns: Array<[string, TopicOption, TitlePair[]]> = [
    ['p2', legacyTopic('tef_tcf_canada'), legacyCandidates('tef')],
    ['p3', legacyTopic('tcf_canada_writing_7day'), legacyCandidates('tcf')],
    ['p1_showcase', consensusTopic({ primaryGoal: capability.allowedGoals.includes('conversion') ? 'conversion' : safeGoal, topicLane: 'product_value' }), goodCandidates()],
  ];
  for (const [key, topic, candidates] of legacyRuns) {
    captured.length = 0;
    cannedQueue.length = 0;
    cannedQueue.push({ candidates });
    await runGeneration(topic);
    assert(captured.length === 1, `${key}: legacy 全程只有 1 次 AI 调用`);
    assert(captured.filter(req => req.system.includes('最后一位小红书标题终审编辑')).length === 0, `${key}: 最终终审调用次数为 0`);
    const req = firstRequest();
    const user = JSON.parse(req.user) as Record<string, any>;
    assert(!('product_capabilities' in user) && !('buyer_map' in user) && !('title_promise_range' in user), `${key}: user JSON 无新增键`);
    assert(!Array.isArray(user.actual_content.inner_pages), `${key}: actual_content 无 inner_pages`);
    assert(!req.system.includes('每方向恰好1组'), `${key}: system 无方向子集说明`);
    assert(!req.system.includes('完整词、完整短语或完整句子收尾'), `${key}: system 无完整收尾 prompt 约束（截断残尾约束仅共识路径）`);
    assert(req.system.includes('四种机制各1组'), `${key}: system 保留 legacy 四机制行`);
    hashes[key] = sha256(req.system);
    console.log(`  title system sha256(${key}) = ${hashes[key]}`);
  }
  assert(hashes.p2 === hashes.p3, '商品2/3 system 逐字节一致（同一 legacy 数组）');
  assert(hashes.p2 === PINNED_LEGACY_TITLE_SYSTEM_SHA.standard, '商品2/3（standard）legacy title system prompt 字节锁定（相对 4fdb786 现状）');
  // 商品1 showcase（知识库介绍模式）按现状含商品介绍条件行，与 standard 不同属预期，单独锁基线。
  assert(hashes.p1_showcase === PINNED_LEGACY_TITLE_SYSTEM_SHA.showcase, '商品1 showcase（product_showcase）legacy title system prompt 字节锁定（相对 4fdb786 现状）');

  // -------------------------------------------------------------------------
  console.log(`\n== 4. 11 字文字标题：门控开不被淘汰、只出警告；门控关维持判死 ==`);
  const shortPair: TitlePair = {
    textTitle: 'DELF B2草稿这样打',
    coverTitle: 'DELF B2考场草稿打法',
    coverSubtitle: '提示词代替完整句',
    mechanism: 'fast_path',
    userRelation: '考场时间紧的考生',
    seoKeyword: 'DELF B2草稿',
    noveltyFingerprint: 'short-1',
  };
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: [...goodCandidates().slice(0, 3), shortPair] });
  const shortArt = await runGeneration(consensusTopic());
  assert(shortArt.ok, '11 字候选在门控开路径不导致失败');
  assert(shortArt.ok && shortArt.artifact.data.candidates.some(pair => pair.textTitle === 'DELF B2草稿这样打'), '11 字候选存活在最终候选里');
  assert(shortArt.ok && shortArt.artifact.warnings.some(w => w.includes('文字标题仅11字，低于推荐下限12字')), 'warnings 记「文字标题仅11字，低于推荐下限12字」');
  assert(shortArt.ok && !shortArt.artifact.warnings.some(w => w.includes('请人工复核标题新鲜度')), '11 字候选不触发 salvage 降级');
  // legacy 语义：<12 仍在硬门槛判死（passesTitleHardGatesForTest 走 legacy 默认参数）。
  assert(passesTitleHardGatesForTest(shortPair, { topic: consensusTopic(), capability, content }) === false, '门控关（legacy）11 字标题仍被硬门槛淘汰');

  // -------------------------------------------------------------------------
  console.log(`\n== 5. 封面标题超长：先返修（带 failures），返修补齐后不截断 ==`);
  const overlongCover: TitlePair = {
    textTitle: 'DELF B2写作草稿只写提示词不抄整段',
    coverTitle: 'DELF B2考场草稿只写提示词不抄完整句子也能按时写完正文',
    coverSubtitle: '提示词代替完整句',
    mechanism: 'fast_path',
    userRelation: '考场时间紧的考生',
    seoKeyword: 'DELF B2写作草稿',
    noveltyFingerprint: 'overlong-1',
  };
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: [...goodCandidates().slice(1), overlongCover] });
  cannedQueue.push({ candidates: goodCandidates() });
  cannedQueue.push(finalEditResponse());
  const repairedArt = await runGeneration(consensusTopic());
  assert(captured.length === 3, `超长候选先触发返修，再进入最终终审（共 ${captured.length} 次 AI 调用）`);
  const repairUser = JSON.parse(captured[1]!.user) as Record<string, any>;
  const overlongEntry = (repairUser.candidates as Array<{ coverTitle: string; failures: string[] }>).find(item => item.coverTitle.includes('按时写完正文'));
  assert(Boolean(overlongEntry) && overlongEntry!.failures.some(f => f.includes('封面标题') && f.includes('不在8-18字')), `返修请求携带超长 failures：${overlongEntry?.failures.find(f => f.includes('封面标题'))}`);
  assert(Array.isArray(repairUser.context.required_directions) && JSON.stringify(repairUser.context.required_directions) === JSON.stringify(expectedMix), '返修 context 带 required_directions（方向补齐依据）');
  assert(repairUser.context.require_complete_phrase === true, '返修 context 带 require_complete_phrase（完整收尾约束开）');
  assert(captured[1]!.system.includes('修复后的标题必须以完整词、完整短语或完整句子收尾'), '共识返修 system 含完整收尾约束行');
  assert(captured[2]!.system.includes('可以独立创作的小红书标题编辑'), '返修补齐后第 3 次调用进入多候选最终终审');
  assert(!('candidates' in JSON.parse(captured[2]!.user)), '返修后的旧候选仍不进入最终终审 prompt');
  assert(repairedArt.ok && repairedArt.artifact.data.candidates.every(pair => pair.coverTitle.length <= 20), '返修补齐后全部候选封面在区间内');
  assert(repairedArt.ok && !repairedArt.artifact.warnings.some(w => w.includes('截断兜底')), '返修补齐成功时不出现截断兜底警告');

  // -------------------------------------------------------------------------
  console.log(`\n== 6. 返修仍超长：才截断兜底 + 警告 ==`);
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: [...goodCandidates().slice(1), overlongCover] });
  cannedQueue.push({ candidates: [...goodCandidates().slice(1), overlongCover] });
  const truncatedArt = await runGeneration(consensusTopic());
  assert(truncatedArt.ok, '返修仍超长也不让整篇 job 失败');
  assert(truncatedArt.ok && truncatedArt.artifact.data.candidates.length >= 3, `最终创作保留 ${truncatedArt.ok ? truncatedArt.artifact.data.candidates.length : 0} 组可用候选（不为凑4组保留坏项）`);
  assert(truncatedArt.ok && truncatedArt.artifact.warnings.some(w => w.includes('封面标题超长') && w.includes('截断兜底')), 'warnings 记封面超长截断兜底');

  // -------------------------------------------------------------------------
  console.log(`\n== 7. maxTokens（§4.4） ==`);
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: goodCandidates() });
  await runGeneration(consensusTopic(), 6);
  assert(firstRequest().maxTokens === 900 + 320 * 6, `candidateCount=6 首轮 maxTokens=${firstRequest().maxTokens}（期望 2820）`);
  captured.length = 0;
  cannedQueue.push({ candidates: goodCandidates() });
  await runGeneration(consensusTopic());
  assert(firstRequest().maxTokens === 1800, '默认 4 维持 1800');

  // -------------------------------------------------------------------------
  console.log(`\n== 8. salvage 保命链路：候选全灭也不让 job 失败（零候选抛错除外） ==`);
  // 构造：封面超长且身份词在尾部——normalizePairForInput（门控开不预先截断）放行超长、
  // 截断兜底又会切掉尾部身份词，rescue/top-up 都救不回；salvage（忽略长度）保留原始候选 + 降级警告。
  const unrescuable = (index: number): TitlePair => index === 1
    ? {
      textTitle: 'DELF B2写作草稿只写提示词不写整句',
      coverTitle: '考场草稿只写提示词不抄完整句子也能按时写完正文DELF B2',
      coverSubtitle: '提示词代替完整句',
      mechanism: 'fast_path',
      userRelation: '考场时间紧的考生',
      seoKeyword: 'DELF B2写作草稿',
      noveltyFingerprint: 'salvage-1',
    }
    : {
      textTitle: 'DELF B2写作打草稿总怕来不及写完',
      coverTitle: '打草稿总怕来不及写完正文才想起来查连接表达DELF B2',
      coverSubtitle: '草稿瘦身留时间',
      mechanism: 'pain',
      userRelation: '怕来不及写完的考生',
      seoKeyword: 'DELF B2草稿',
      noveltyFingerprint: 'salvage-2',
    };
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: [unrescuable(1), unrescuable(2)] });
  cannedQueue.push({ candidates: [unrescuable(1), unrescuable(2)] });
  const salvageArt = await runGeneration(consensusTopic());
  assert(salvageArt.ok, '全组长度不合格时 salvage 保命不抛错');
  assert(salvageArt.ok && salvageArt.artifact.data.candidates.length >= 1, 'salvage 至少保住 1 组候选');
  assert(salvageArt.ok && salvageArt.artifact.warnings.some(w => w.includes('已保留当前内容最匹配的候选')), 'salvage 警告「已保留当前内容最匹配的候选，请人工复核标题新鲜度」');
  // 零候选也必须走保守工单兜底，不能因为标题失败阻断整篇 job。
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: [] });
  const emptyArt = await runGeneration(consensusTopic());
  assert(emptyArt.ok && emptyArt.artifact.data.candidates.length === 1, '零候选使用工单保守标题继续生产');
  assert(emptyArt.ok && emptyArt.artifact.warnings.some(w => w.includes('保守标题')), '零候选兜底明确记录人工复核警告');

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
    setTitleHumanizerPairsForTest(null);
    process.exit(failures === 0 ? 0 : 1);
  });
