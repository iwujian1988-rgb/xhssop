/* eslint-disable no-console */
// 阶段 B2 验收：商品1共识新流程 与 商品2/3 + showcase legacy 旧流程互不影响。
// 全程离线：打桩 globalThis.fetch，捕获真实发送的 prompt，返回 canned JSON；
// 不碰真实 LLM；title-usage-store 只读（真实历史参与去重，验证的是真实路径）。
// API 路由层的 useConsensusPlan 用同一个 resolvePipelineFeatures 判定，这里在
// 选题阶段入口（generateTopicOptions）锁定分流，等价覆盖路由判定。
import { createHash } from 'node:crypto';
import { generateTopicOptions, getCapabilityFallback, TOPIC_PROMPT_VERSION } from '../src/lib/v2/topic-stage';
import { resolvePipelineFeatures } from '../src/lib/v2/pipeline-features';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { CONSENSUS_TOPIC_PROMPT_VERSION } from '../src/lib/v2/consensus-topic-stage';
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

// B2 提取等价基线：buildLegacyTopicPrompt 的 system 是从原内联数组逐字提出的
//（已对 b7f9eee 机械 diff 验证 17 行字面量去缩进后逐字一致），此处用哈希锁死
// 字节不变（改动 legacy system 需更新基线并在提交说明里给理由）。
const PINNED_LEGACY_SYSTEM_SHA = {
  standard: '632db0f79efb8c713c81ffd0bb205172ca999919aa0cd242130fb7964ee4cba0',
  showcase: '0e4df8ff47ef75e733764c60a7923cfc5de292b767e8a184106685ac2b429b21',
};

// ---------------------------------------------------------------------------
// fetch 打桩：捕获 messages，返回 canned content
// ---------------------------------------------------------------------------
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
delete process.env.AI_BRIDGE_DIR; // 桥接模式不走 fetch；本测试必须走 fetch 路径才能捕获
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
    id: 'test-b2-isolation',
  }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-b2-isolation' } });
}) as typeof fetch;

async function main() {
  // -------------------------------------------------------------------------
  // 1. 特性门控：商品1 共识 / 商品2、3 legacy / 未知商品抛错
  // -------------------------------------------------------------------------
  console.log(`\n== 1. 特性门控 ==`);
  const p1 = resolvePipelineFeatures('delf_b2_writing');
  const p2 = resolvePipelineFeatures('tef_tcf_canada');
  const p3 = resolvePipelineFeatures('tcf_canada_writing_7day');
  assert(p1.pipelineVersion === 'consensus-v1' && p1.consensusTopicStage === true, '商品1 = consensus-v1 且共识选题开启');
  assert(p2.pipelineVersion === 'legacy-v2' && !p2.consensusTopicStage && !p2.consensusContentBrief && !p2.consensusTitleStage, '商品2 = legacy-v2 三旗全关');
  assert(p3.pipelineVersion === 'legacy-v2' && !p3.consensusTopicStage && !p3.consensusContentBrief && !p3.consensusTitleStage, '商品3 = legacy-v2 三旗全关');
  let unknownThrew = false;
  try { resolvePipelineFeatures('no_such_product' as never); } catch { unknownThrew = true; }
  assert(unknownThrew, '未知商品直接抛错（不允许静默降级）');

  // -------------------------------------------------------------------------
  // 公共 fixture
  // -------------------------------------------------------------------------
  const card: CompetitorCreativeCard = {
    id: 'card_test_directory',
    name: '羊皮纸高密度资料目录',
    renderer_id: 'parchment_dense_directory',
    content_mechanism: '多分组知识体系',
    click_mechanism: '资料整理完整感',
  } as CompetitorCreativeCard;
  const capability = getCapabilityFallback(card);
  const safeGoal = capability.allowedGoals.includes('search') ? 'search' : capability.allowedGoals[0];
  function legacyTopic(topicText: string, lane: 'broad_pain' | 'product_value', seoPrimary: string, goal = safeGoal) {
    return {
      id: 't-isolation-1',
      primaryGoal: goal,
      topicLane: lane,
      topic: topicText,
      audienceState: '正在准备法语考试、想先弄清考试要求的人',
      scene: '报名前后查考试信息时',
      painOrDesire: '信息散，不知道重点在哪',
      promise: '一屏看清关键信息',
      contentAngle: '多分组知识体系',
      plannedBlockKind: capability.acceptedBlockKinds[0],
      productBridge: '对应资料包中的对照整理模块',
      seo: { primary: seoPrimary, related: [seoPrimary] },
      knowledgeMode: 'educational_original',
      factTerms: [],
      seedSignals: [],
      noveltyFingerprint: 'isolation-test-1',
    };
  }
  function lastRequest(): CapturedAiRequest {
    return captured[captured.length - 1]!;
  }
  const LEGACY_USER_KEYS = ['cover', 'count', 'current_batch_topics_to_avoid', 'direction', 'product', 'recent_topics_to_avoid', 'requested_content_mode', 'search_signals'];

  // -------------------------------------------------------------------------
  // 2. 商品2（tef_tcf_canada）标准模式 → legacy 全链路
  // -------------------------------------------------------------------------
  console.log(`\n== 2. 商品2 标准模式走 legacy ==`);
  const facts2 = await loadProductFacts('tef_tcf_canada');
  cannedContent = { topics: [legacyTopic('TEF Canada和TCF Canada怎么选：一次看懂两个考试', 'broad_pain', 'TEF Canada')] };
  const callsBefore2 = captured.length;
  const art2 = await generateTopicOptions({ productId: 'tef_tcf_canada', card, capability, facts: facts2, limit: 1, contentMode: 'standard', topicMode: 'single' });
  assert(captured.length === callsBefore2 + 1, `商品2 单次 AI 调用（实际新增 ${captured.length - callsBefore2} 次）`);
  const req2 = lastRequest();
  assert(req2.system.startsWith('你是资深小红书法语教育编辑'), '商品2 system 仍是 legacy 法语教育编辑角色');
  assert(!req2.system.includes('大痛点型') && !req2.system.includes('省时路径型') && !req2.system.includes('具体方法型'), '商品2 system 无共识三方向内容');
  assert(req2.system.includes('顶层字段topics'), '商品2 system 仍是 legacy 字段契约');
  const user2 = JSON.parse(req2.user) as Record<string, unknown>;
  assert(Object.keys(user2).sort().join(',') === [...LEGACY_USER_KEYS].sort().join(','), `商品2 user JSON 顶层键与 legacy 结构一致（实际 ${Object.keys(user2).sort().join(',')}）`);
  assert(!req2.user.includes('已确认考试边界') && !req2.user.includes('购买者地图') && !req2.user.includes('当前封面'), '商品2 user JSON 无共识 5 块契约');
  assert(art2.prompt_version === TOPIC_PROMPT_VERSION, `商品2 artifact prompt_version 仍为 ${TOPIC_PROMPT_VERSION}`);
  assert(art2.data.length === 1, `商品2 产出 1 个选题（实际 ${art2.data.length}）`);
  assert(art2.data[0].direction === undefined && art2.data[0].expandContents === undefined && art2.data[0].bridgeBasis === undefined, '商品2 选题不带共识扩展字段');
  assert(art2.needsManualReview === undefined, '商品2 artifact 不带 needsManualReview');
  console.log(`  legacy system sha256(standard) = ${sha256(req2.system)}`);
  if (PINNED_LEGACY_SYSTEM_SHA.standard) {
    assert(sha256(req2.system) === PINNED_LEGACY_SYSTEM_SHA.standard, '商品2 legacy system prompt 字节锁定（B2 提取等价基线）');
  }

  // -------------------------------------------------------------------------
  // 3. 商品3（tcf_canada_writing_7day）标准模式 → legacy 全链路
  // -------------------------------------------------------------------------
  console.log(`\n== 3. 商品3 标准模式走 legacy ==`);
  const facts3 = await loadProductFacts('tcf_canada_writing_7day');
  cannedContent = { topics: [legacyTopic('TCF Canada写作七天冲刺每天练什么', 'broad_pain', 'TCF Canada写作')] };
  const art3 = await generateTopicOptions({ productId: 'tcf_canada_writing_7day', card, capability, facts: facts3, limit: 1, contentMode: 'standard', topicMode: 'single' });
  const req3 = lastRequest();
  assert(req3.system.startsWith('你是资深小红书法语教育编辑') && req3.system.includes('顶层字段topics'), '商品3 system 仍是 legacy 编辑角色与字段契约');
  const user3 = JSON.parse(req3.user) as Record<string, unknown>;
  assert(Object.keys(user3).sort().join(',') === [...LEGACY_USER_KEYS].sort().join(','), '商品3 user JSON 顶层键与 legacy 结构一致');
  assert(art3.prompt_version === TOPIC_PROMPT_VERSION && art3.needsManualReview === undefined, '商品3 prompt_version=legacy 且不带 needsManualReview');
  assert(art3.data[0].direction === undefined && art3.data[0].expandContents === undefined, '商品3 选题不带共识扩展字段');
  if (PINNED_LEGACY_SYSTEM_SHA.standard) {
    assert(sha256(req3.system) === PINNED_LEGACY_SYSTEM_SHA.standard, '商品3 与商品2 legacy system 字节一致');
  }

  // -------------------------------------------------------------------------
  // 4. 商品1 showcase 模式 → 仍走 legacy（showcase 不进共识分支）
  // -------------------------------------------------------------------------
  console.log(`\n== 4. 商品1 showcase 走 legacy ==`);
  const facts1 = await loadProductFacts('delf_b2_writing');
  const showcaseGoal = capability.allowedGoals.includes('conversion') ? 'conversion' : capability.allowedGoals[0];
  cannedContent = { topics: [legacyTopic('DELF B2写作资料包里都有什么：从目录看内容', 'product_value', 'DELF B2写作资料', showcaseGoal)] };
  const art1s = await generateTopicOptions({ productId: 'delf_b2_writing', card, capability, facts: facts1, limit: 1, contentMode: 'product_showcase', topicMode: 'single' });
  const req1s = lastRequest();
  assert(req1s.system.includes('介绍知识库'), 'showcase system 走 legacy 商品介绍分支');
  assert(!req1s.system.includes('大痛点型'), 'showcase system 无共识方向内容');
  assert(art1s.prompt_version === TOPIC_PROMPT_VERSION, `showcase artifact prompt_version 仍为 ${TOPIC_PROMPT_VERSION}`);
  assert(art1s.data[0].direction === undefined, 'showcase 选题不带 direction');
  assert(art1s.needsManualReview === undefined, 'showcase artifact 不带 needsManualReview');
  console.log(`  legacy system sha256(showcase) = ${sha256(req1s.system)}`);
  if (PINNED_LEGACY_SYSTEM_SHA.showcase) {
    assert(sha256(req1s.system) === PINNED_LEGACY_SYSTEM_SHA.showcase, 'showcase legacy system prompt 字节锁定');
  }

  // -------------------------------------------------------------------------
  // 5. 商品1 标准模式 → 共识分支（5 块契约 + 方向 + 新版本号）
  // -------------------------------------------------------------------------
  console.log(`\n== 5. 商品1 标准模式走共识 ==`);
  cannedContent = {
    选题列表: [{
      选题方向: '大痛点型',
      选题名称: 'DELF B2写作考场草稿怎么打才不浪费时间',
      对应的用户真实状态: '考场时间紧，怕打草稿来不及写正文',
      用户使用场景: '模拟考和真考动笔前',
      用户真正想得到的结果: '有一套不打满全文的提纲写法',
      这篇内容准备解决什么: '给出草稿要写到什么颗粒度的判断标准',
      准备展开的内容: ['先抄题目要求关键词', '列每段观点和例子提示', '标出要用的连接表达', '留出词数检查位', '超时立刻转正式书写'],
      商品承接依据: { 能力编号: 'cap-score-selfcheck', 支持模块: ['02_DELF_B2评分对照', '08_写作检查清单_36项'] },
      为什么适合当前封面: '内容可以拆成多个检查分组和短条目',
      用户为什么可能点击: '考场时间分配是普遍焦虑',
      本篇说话动作: '带考生把草稿控制在五分钟内',
      开头情绪起势: '一打草稿就停不下来，是很多考生的坑',
      是否可能与历史选题重复: false,
    }],
  };
  const callsBefore1 = captured.length;
  const art1 = await generateTopicOptions({ productId: 'delf_b2_writing', card, capability, facts: facts1, limit: 1, contentMode: 'standard', topicMode: 'single' });
  assert(captured.length === callsBefore1 + 1, `共识分支单候选响应只调 1 次 AI（实际新增 ${captured.length - callsBefore1} 次）`);
  const req1 = lastRequest();
  assert(req1.system.includes('大痛点型') && req1.system.includes('省时路径型') && req1.system.includes('具体方法型'), '商品1 system 含共识三方向');
  assert(req1.user.includes('商品身份') && req1.user.includes('已确认考试边界') && req1.user.includes('购买者地图') && req1.user.includes('当前封面'), '商品1 user 为共识 5 块契约');
  assert(art1.prompt_version === CONSENSUS_TOPIC_PROMPT_VERSION, `商品1 artifact prompt_version = ${CONSENSUS_TOPIC_PROMPT_VERSION}`);
  assert(art1.data.length === 1 && art1.data[0].direction === '大痛点型', '商品1 选题带 direction');
  assert(art1.needsManualReview === undefined, '非兜底结果不带 needsManualReview');

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
