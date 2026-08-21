/* eslint-disable no-console */
// 阶段 D 验收：标题共识方向池（设计 §4，仅商品1普通模式灰度）。
// 全程离线：打桩 globalThis.fetch，捕获真实发送的 prompt，返回 canned JSON；
// 不碰真实 LLM。打桩模式照抄 test-v2-content-brief.mts。
import { createHash } from 'node:crypto';
import { generateTitlePackage, passesTitleHardGatesForTest } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { clampTitleCandidateCount, resolveTitleConsensusActive, sampleDirectionsForNote } from '../src/lib/v2/title-consensus';
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
interface CapturedAiRequest { system: string; user: string; maxTokens?: number; }
const captured: CapturedAiRequest[] = [];
// canned 队列：每次 AI 调用弹出一个响应；队列空时复用最后一个。
const cannedQueue: Array<{ candidates: unknown }> = [];
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

function lastRequest(): CapturedAiRequest {
  return captured[captured.length - 1]!;
}
function firstRequest(): CapturedAiRequest {
  return captured[0]!;
}

async function runGeneration(topic: TopicOption, candidateCount?: number) {
  try {
    return { ok: true as const, artifact: await generateTitlePackage({ topic, capability, content, ...(candidateCount !== undefined ? { candidateCount } : {}) }) };
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
  assert(sampleDirectionsForNote(fpA, 1).length === 1, 'count=1 边界');
  assert(sampleDirectionsForNote(fpA, 8).length === 6, 'count=8 超过池子大小时封顶取全 6 池');
  const subsetB = sampleDirectionsForNote(fpB, 4);
  assert(JSON.stringify(subsetA) !== JSON.stringify(subsetB), `异指纹子集不同（A=${subsetA.join('/')} B=${subsetB.join('/')}）`);
  assert(clampTitleCandidateCount(undefined) === 4 && clampTitleCandidateCount(0) === 1 && clampTitleCandidateCount(99) === 8 && clampTitleCandidateCount(6) === 6, 'candidateCount clamp 1-8 默认 4');

  // -------------------------------------------------------------------------
  console.log(`\n== 2. 门控开的 payload：方向子集/能力列表/buyerMap/内页摘要/承诺范围 ==`);
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: goodCandidates() });
  const art1 = await runGeneration(consensusTopic());
  assert(art1.ok && art1.artifact.data.candidates.length === 4, '商品1普通模式正常产出 4 组候选');
  const req1 = lastRequest();
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

  // candidateCount clamp 透传
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: goodCandidates() });
  await runGeneration(consensusTopic(), 0);
  const userCount1 = JSON.parse(firstRequest().user) as Record<string, any>;
  assert(Object.keys(userCount1.required_candidate_mix).length === 1, 'candidateCount=0 clamp 到 1，方向子集 1 个');
  assert(firstRequest().system.includes('只返回1组成对候选'), 'system 写明 1 组');
  captured.length = 0;
  await runGeneration(consensusTopic(), 99);
  const userCount8 = JSON.parse(firstRequest().user) as Record<string, any>;
  assert(Object.keys(userCount8.required_candidate_mix).length === 6, 'candidateCount=99 clamp 到 8、方向封顶 6');
  assert(firstRequest().system.includes('每方向至少1组'), '组数>方向数时 system 说明每方向至少1组');

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
  const legacyRuns: Array<[string, TopicOption]> = [
    ['p2', legacyTopic('tef_tcf_canada')],
    ['p3', legacyTopic('tcf_canada_writing_7day')],
    ['p1_showcase', consensusTopic({ primaryGoal: capability.allowedGoals.includes('conversion') ? 'conversion' : safeGoal, topicLane: 'product_value' })],
  ];
  for (const [key, topic] of legacyRuns) {
    captured.length = 0;
    cannedQueue.length = 0;
    cannedQueue.push({ candidates: goodCandidates() });
    await runGeneration(topic);
    const req = firstRequest();
    const user = JSON.parse(req.user) as Record<string, any>;
    assert(!('product_capabilities' in user) && !('buyer_map' in user) && !('title_promise_range' in user), `${key}: user JSON 无新增键`);
    assert(!Array.isArray(user.actual_content.inner_pages), `${key}: actual_content 无 inner_pages`);
    assert(!req.system.includes('每方向恰好1组'), `${key}: system 无方向子集说明`);
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
  const repairedArt = await runGeneration(consensusTopic());
  assert(captured.length === 2, `超长候选先触发返修（共 ${captured.length} 次 AI 调用）`);
  const repairUser = JSON.parse(captured[1]!.user) as Record<string, any>;
  const overlongEntry = (repairUser.candidates as Array<{ coverTitle: string; failures: string[] }>).find(item => item.coverTitle.includes('按时写完正文'));
  assert(Boolean(overlongEntry) && overlongEntry!.failures.some(f => f.includes('封面标题') && f.includes('不在8-18字')), `返修请求携带超长 failures：${overlongEntry?.failures.find(f => f.includes('封面标题'))}`);
  assert(Array.isArray(repairUser.context.required_directions) && JSON.stringify(repairUser.context.required_directions) === JSON.stringify(expectedMix), '返修 context 带 required_directions（方向补齐依据）');
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
  assert(truncatedArt.ok && truncatedArt.artifact.data.candidates.length >= 4, `截断兜底后候选补齐到 ${truncatedArt.ok ? truncatedArt.artifact.data.candidates.length : 0} 组`);
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
  // 零候选（AI 返回空）仍按设计 §1 现状抛错。
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push({ candidates: [] });
  const emptyArt = await runGeneration(consensusTopic());
  assert(!emptyArt.ok, '零候选仍抛错（现状语义保留）');

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
