/* eslint-disable no-console */
// 阶段 B1 离线测试：商品1共识选题分支（consensus-topic-stage.ts）。
// 全程离线：AI 调用注入 stub，不碰真实 LLM。
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { getXhsSearchKeywords } from '../src/lib/xhs-search-keywords';
import { emptyAiUsage } from '../src/lib/ai-client';
import { getCapabilityFallback, generateTopicOptions, TOPIC_PROMPT_VERSION } from '../src/lib/v2/topic-stage';
import {
  CONSENSUS_CANDIDATE_POOL_SIZE,
  buildConsensusTopicPrompt,
  buildConservativeTopicFallback,
  classifyTopicFailure,
  diagnoseConsensusTopicCandidate,
  generateTopicOptionsConsensus,
  getConsensusPromptBudget,
  selectTopicRelevantExamFacts,
  wrapConsensusTopicArtifact,
  type ConsensusTopicDirection,
  type ConsensusTopicOption,
  type ConsensusTopicStageInput,
} from '../src/lib/v2/consensus-topic-stage';
import { selectTopicsForCard } from '../src/lib/v2/batch-topic-selection';
import { listVerifiedExamFacts } from '../src/lib/v2/verified-exam-facts';
import { getProductEditorialMap } from '../src/lib/v2/product-editorial-map';
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

const card: CompetitorCreativeCard = {
  id: 'card_test_directory',
  name: '羊皮纸高密度资料目录',
  renderer_id: 'parchment_dense_directory',
  content_mechanism: '多分组知识体系',
  click_mechanism: '资料整理完整感',
} as CompetitorCreativeCard;
const capability = getCapabilityFallback(card);

const baseInput: ConsensusTopicStageInput = {
  productId: 'delf_b2_writing',
  card,
  capability,
  mode: 'single',
  userDirection: '',
  history: {
    recentTopics: ['历史选题：DELF B2写作范文怎么用'],
    recentTitles: ['历史标题：DELF B2写作自查顺序'],
    recentExpressions: [],
  },
};

// ---------------------------------------------------------------------------
// 1. legacy 选题 prompt 字符测量（只读统计，做 130% 预算基线）
// ---------------------------------------------------------------------------
function measureLegacyTopicPromptChars(): number {
  // 系统提示词：从 topic-stage.ts 源码只读提取 system 块里的字符串字面量长度
  //（不执行、不修改那个文件；漂移时测量值跟随源码自动变化）。
  const source = readFileSync('src/lib/v2/topic-stage.ts', 'utf8');
  const start = source.indexOf("role: 'system',");
  const end = source.indexOf("].join('\\n')", start);
  const block = source.slice(start, end);
  const literals = block.match(/'([^']*)'/g) || [];
  const systemChars = literals.reduce((sum, literal) => sum + literal.length - 2, 0) + Math.max(0, literals.length - 1);
  // 用户提示词：按 topic-stage promptInput 的真实结构重建（同数据源同截面）
  const facts = JSON.parse(readFileSync('data/product_facts_delf_b2.json', 'utf8'));
  const profile = { noteIdentity: 'DELF B2写作' };
  const keywords = getXhsSearchKeywords('delf_b2_writing');
  const recentTopics = Array.from({ length: 20 }, (_, i) => `历史选题示例第${i}条：DELF B2写作练习相关`);
  const promptInput = {
    product: {
      id: 'delf_b2_writing',
      identity: profile.noteIdentity,
      scope: '当前是商品1。选题只围绕DELF B2写作。',
      product_facts: Object.fromEntries(Object.entries(facts).map(([category, items]) => [category, (items as unknown[]).slice(0, 4)])),
      verified_exam_facts: listVerifiedExamFacts('delf_b2_writing').map(item => ({ id: item.id, text: item.text })),
    },
    cover: { id: card.id, name: card.name, family: capability.family, compiler: capability.compiler },
    search_signals: [...keywords.primary, ...keywords.secondary].slice(0, 12),
    recent_topics_to_avoid: recentTopics,
    current_batch_topics_to_avoid: recentTopics,
    direction: '',
    requested_content_mode: 'standard',
    count: 1,
  };
  return systemChars + JSON.stringify(promptInput).length;
}

const legacyChars = measureLegacyTopicPromptChars();
const budget = getConsensusPromptBudget(legacyChars);
console.log(`\n== 1. legacy prompt 字符测量 ==`);
console.log(`  legacy 选题 prompt ≈ ${legacyChars} 字符；新契约预算（130%）= ${budget}`);

const prompt = buildConsensusTopicPrompt({ ...baseInput, charBudget: budget });
console.log(`  新共识 prompt 总字符 = ${prompt.charCount}`);
assert(prompt.charCount <= budget, `新 prompt（${prompt.charCount}）不超过 legacy×1.3（${budget}）`);
assert(prompt.contract.本次生成要求.选题数量 === 3, `候选池数量恒为 3（实际 ${prompt.contract.本次生成要求.选题数量}）`);
assert(prompt.user.includes('"选题数量":3'), 'prompt 用户块出现的是候选池=3');
assert(!prompt.user.includes('topicsPerCard') && !prompt.system.includes('topicsPerCard'), 'prompt 中不出现挑选参数 topicsPerCard（数量与挑选分离）');
assert(prompt.contract.商品身份.商品能力.length === getProductEditorialMap('delf_b2_writing')!.capabilities.length, '商品能力来自 editorial map');

// ---------------------------------------------------------------------------
// 2. 考试边界筛选规则
// ---------------------------------------------------------------------------
console.log(`\n== 2. 考试边界筛选 ==`);
const realFacts = listVerifiedExamFacts('delf_b2_writing');
const realFiltered = selectTopicRelevantExamFacts(realFacts);
console.log(`  delf_b2_writing 全量 ${realFacts.length} 条 → 筛后 ${realFiltered.kept.length} 条，筛除 ${realFiltered.dropped.length} 条`);
assert(realFiltered.kept.length === 5, 'DELF 5 条官方写作事实按规则全部保留');
const synthetic = [
  ...realFacts,
  { id: 'X-1', category: 'official_exam_fact', text: '口语考试与考官面对面进行。' },
  { id: 'X-2', category: 'study_tip', text: '写作建议每天练一篇。' },
  { id: 'X-3', category: 'official_exam_fact', text: 'TCF Canada 写作共3道题。' },
] as typeof realFacts;
const syntheticFiltered = selectTopicRelevantExamFacts(synthetic);
assert(syntheticFiltered.kept.length === 5, `构造大列表（8条）筛后仍为 5（实际 ${syntheticFiltered.kept.length}）`);
assert(syntheticFiltered.dropped.length === 3, `筛除 3 条（实际 ${syntheticFiltered.dropped.length}）`);
assert(syntheticFiltered.dropped.every(d => d.reason.length > 0), '每条筛除都带原因');

// ---------------------------------------------------------------------------
// 3. 字符上限兜底（超限截断+警告）
// ---------------------------------------------------------------------------
console.log(`\n== 3. 字符预算兜底 ==`);
const tiny = buildConsensusTopicPrompt({ ...baseInput, charBudget: 3000 });
assert(tiny.charCount > 0 && tiny.warnings.some(w => w.includes('截断')), '极小预算触发截断警告');
assert(tiny.contract.商品身份.已确认考试边界.length <= 5, '截断后边界条目不增加');

// ---------------------------------------------------------------------------
// 4. mock AI 响应：3 方向各 1（走真实解析+闸门）
// ---------------------------------------------------------------------------
console.log(`\n== 4. 3 方向真实样例（mock AI 响应 → 真实解析+闸门） ==`);
const mockNormal = {
  选题列表: [
    {
      选题方向: '大痛点型',
      选题名称: 'DELF B2作文写完却不知道自己哪里不达标',
      对应的用户真实状态: '文章能写完，但不知道是否达到B2要求',
      用户使用场景: '考前练完一篇作文，改了几遍还是不放心',
      用户真正想得到的结果: '有一套明确的检查顺序',
      这篇内容准备解决什么: '告诉用户先检查任务和结构，再检查语言和格式',
      准备展开的内容: ['检查是否完成题目要求', '检查文章结构是否完整', '检查观点和例子是否对应', '检查连接表达和句法', '检查称呼格式和词数'],
      商品承接依据: { 能力编号: 'cap-score-selfcheck', 支持模块: ['02_DELF_B2评分对照', '08_写作检查清单_36项'] },
      为什么适合当前封面: '内容可以拆成多个检查分组和短条目',
      用户为什么可能点击: '用户能直接对应自己写完作文后的不确定感',
      本篇说话动作: '带考生把一篇写完的作文按顺序过一遍',
      开头情绪起势: '写完了却更慌，是很多考生熟悉的感觉',
      是否可能与历史选题重复: false,
    },
    {
      选题方向: '省时路径型',
      选题名称: '考前一个月的B2写作复习顺序怎么排',
      对应的用户真实状态: '距离考试约一个月，写作部分还没系统练过',
      用户使用场景: '制定最后一个月复习计划时',
      用户真正想得到的结果: '知道先练什么后练什么，不浪费剩下的时间',
      这篇内容准备解决什么: '给一个从题型熟悉到成文自查的先后顺序',
      准备展开的内容: ['先过一遍题型和评分维度', '按题型各练一篇完整作文', '用检查清单复盘每篇', '对照错题定位薄弱模块', '考前速查最后过一遍'],
      商品承接依据: { 能力编号: 'cap-path-and-review', 支持模块: ['00_使用说明与学习路径', '09_考前冲刺速查'] },
      为什么适合当前封面: '顺序类内容天然适合分组成路径展示',
      用户为什么可能点击: '临考考生都想尽快理清复习重点',
      本篇说话动作: '按周拆解写作复习的推进顺序',
      开头情绪起势: '只剩一个月，写作还没底，先别急着背范文',
      是否可能与历史选题重复: false,
    },
    {
      选题方向: '具体方法型',
      选题名称: '正式信里一个观点怎么展开成完整论证',
      对应的用户真实状态: '有观点但写出来像简单罗列，词数常常不够',
      用户使用场景: '练习正式信论证段时',
      用户真正想得到的结果: '能把一个观点写成观点加解释加例子的完整段落',
      这篇内容准备解决什么: '演示从观点到解释、例子和让步的展开步骤',
      准备展开的内容: ['先写明确观点句', '接一句解释为什么', '补一个具体例子', '加一层让步再收回', '收尾呼应任务要求'],
      商品承接依据: { 能力编号: 'cap-combination-examples', 支持模块: ['06_组合示例库_20条'] },
      为什么适合当前封面: '展开步骤可以做成分组短条目',
      用户为什么可能点击: '论证展开不足是写不够词数的直接原因',
      本篇说话动作: '拆解一个论证段的五步写法',
      开头情绪起势: '观点有了，一动笔就只剩两句话',
      是否可能与历史选题重复: false,
    },
  ],
};
const stubAi = (data: unknown) => async () => data;
const normalResult = await generateTopicOptionsConsensus({ ...baseInput, charBudget: budget }, stubAi(mockNormal));
console.log('  3 方向解析结果（warnings 数量：%d）：', normalResult.warnings.length);
assert(normalResult.data.length === 3, `3 方向各 1（实际 ${normalResult.data.length}）`);
assert(new Set(normalResult.data.map(t => t.direction)).size === 3, '3 个方向互不相同');
assert(normalResult.usedFallback === false, '未触发兜底');
console.log('  —— 正常候选完整 ConsensusTopicOption 样例 ——');
console.log(JSON.stringify(normalResult.data[0], null, 2));
for (const topic of normalResult.data) {
  console.log(`  [${topic.direction}] ${topic.topic}（expandContents=${topic.expandContents.length}，bridge=${topic.bridgeBasis?.capabilityId}）`);
}

// ---------------------------------------------------------------------------
// 5. product_value 剔除不失败
// ---------------------------------------------------------------------------
console.log(`\n== 5. product_value 剔除 ==`);
const mixedResult = await generateTopicOptionsConsensus(baseInput, stubAi({
  选题列表: [
    mockNormal.选题列表[0],
    mockNormal.选题列表[1],
    { ...mockNormal.选题列表[2], 选题方向: 'product_value', 选题名称: '这套B2写作知识库里都有什么' },
  ],
}));
assert(mixedResult.data.length === 2, `product_value 候选被剔除后降级继续（实际 ${mixedResult.data.length}）`);
assert(mixedResult.deaths.some(d => d.code === 'product_value_in_normal_mode'), '剔除带 death 记录');
assert(classifyTopicFailure('product_value_in_normal_mode') === '方向不匹配', 'product_value 死因归类为方向不匹配');
assert(mixedResult.warnings.some(w => w.includes('降级')), '<3 降级警告存在');

// ---------------------------------------------------------------------------
// 6. 缺字段轻修复只警告
// ---------------------------------------------------------------------------
console.log(`\n== 6. 缺字段宽松解析 ==`);
const sparseResult = await generateTopicOptionsConsensus(baseInput, stubAi({
  选题列表: [
    { 选题方向: '大痛点型', 选题名称: '写完的B2作文不知道先查什么' },
  ],
}));
assert(sparseResult.data.length >= 1, '缺大量字段的候选仍保留（宽松解析）');
assert(sparseResult.warnings.some(w => w.includes('本篇说话动作')), '缺 speechAction 只警告');
assert(sparseResult.warnings.some(w => w.includes('开头情绪起势')), '缺 openingEmotion 只警告');
assert(sparseResult.warnings.some(w => w.includes('准备展开的内容')), '缺 expandContents 只警告');

// 多余字段忽略+警告
const extraResult = await generateTopicOptionsConsensus(baseInput, stubAi({
  选题列表: [{ ...mockNormal.选题列表[0], 旧字段遗留: 'x' }],
}));
assert(extraResult.warnings.some(w => w.includes('未知字段')), '多余字段忽略并警告');
// direction 非法值归一
const dirtyDirection = await generateTopicOptionsConsensus(baseInput, stubAi({
  选题列表: [{ ...mockNormal.选题列表[0], 选题方向: '痛点方向（写歪了）' }],
}));
assert(dirtyDirection.data[0]?.direction === '大痛点型', `非法 direction 归一（实际 ${dirtyDirection.data[0]?.direction}）`);
// bridgeBasis 未命中只警告
const missBridge = await generateTopicOptionsConsensus(baseInput, stubAi({
  选题列表: [{ ...mockNormal.选题列表[0], 商品承接依据: { 能力编号: 'cap-not-exist', 支持模块: ['不存在模块'] } }],
}));
assert(missBridge.data.length === 1, 'bridgeBasis 未命中候选仍放行');
assert(missBridge.warnings.some(w => w.includes('未命中')), 'bridgeBasis 未命中有警告');
// expandContents<3 警告
const shortExpand = await generateTopicOptionsConsensus(baseInput, stubAi({
  选题列表: [{ ...mockNormal.选题列表[0], 准备展开的内容: ['只有一条'] }],
}));
assert(shortExpand.warnings.some(w => w.includes('少于3条')), 'expandContents<3 警告放行');

// ---------------------------------------------------------------------------
// 7. 3 全灭 → 保守兜底（零 AI）且兜底过闸
// ---------------------------------------------------------------------------
console.log(`\n== 7. 保守兜底 ==`);
const crossProductMock = {
  选题列表: [1, 2, 3].map(i => ({ ...mockNormal.选题列表[0], 选题名称: `TEF Canada备考写作怎么练${i}` })),
};
let aiCalls = 0;
const countingStub = async () => { aiCalls += 1; return crossProductMock; };
const fallbackResult = await generateTopicOptionsConsensus(baseInput, countingStub);
assert(aiCalls === 1, `兜底零额外 AI 调用（实际调用 ${aiCalls} 次）`);
assert(fallbackResult.usedFallback === true, '3 全灭触发保守兜底');
assert(fallbackResult.data.length === 1, '兜底产 1 个选题');
assert(fallbackResult.warnings.some(w => w.includes('保守兜底')), '兜底带警告');
assert(fallbackResult.warnings.some(w => w.includes('需人工复核')), '兜底警告含人工复核提示文案（§8.1-10）');
assert(fallbackResult.needsManualReview === true, '兜底结果带 needsManualReview 机器可读标记');
assert(normalResult.needsManualReview === false, '正常结果 needsManualReview=false');
const fallbackArtifact = wrapConsensusArtifactForTest();
function wrapConsensusArtifactForTest() {
  return wrapConsensusTopicArtifact(fallbackResult, 'hash-x', emptyAiUsage(), 'req-x');
}
assert(fallbackArtifact.needsManualReview === true, '兜底 artifact 带 needsManualReview');
assert(wrapConsensusTopicArtifact(normalResult, 'hash-y', emptyAiUsage(), 'req-y').needsManualReview === undefined, '正常 artifact 不带 needsManualReview');
assert(fallbackArtifact.warnings.some(w => w.includes('商品无法承接')), '逐候选死因可读文案进 artifact warnings（供前台展示）');
const fallbackGateDeaths = diagnoseConsensusTopicCandidate(fallbackResult.data[0], {
  productId: 'delf_b2_writing',
  capability,
  recentTopics: [],
});
assert(fallbackGateDeaths.length === 0, '兜底选题过闸（无硬失败）');
assert(fallbackResult.deaths.length === 3, '3 个死候选都带死因');
assert(fallbackResult.deaths.every(d => classifyTopicFailure(d.code) === '商品无法承接'), '跨商品死因归类为商品无法承接');

// ---------------------------------------------------------------------------
// 8. 兜底也不成立 → 错误信息逐候选列死因
// ---------------------------------------------------------------------------
console.log(`\n== 8. 兜底不成立的失败信息 ==`);
const brokenCapability = { ...capability, allowedGoals: [] as typeof capability.allowedGoals };
let threw: Error | null = null;
try {
  await generateTopicOptionsConsensus({ ...baseInput, capability: brokenCapability }, stubAi(crossProductMock));
} catch (error) {
  threw = error as Error;
}
assert(threw !== null, '兜底不成立时抛错');
assert(threw?.message.includes('候选1') && threw?.message.includes('候选2') && threw?.message.includes('候选3'), '错误信息逐候选列死因');
assert(threw?.message.includes('商品无法承接'), '错误信息带死因分类标签');

// 五类标签覆盖抽查
assert(classifyTopicFailure('cover_goal_mismatch') === '封面承载不了', '标签：封面承载不了');
assert(classifyTopicFailure('cover_content_shape_mismatch') === '封面承载不了', '标签：封面承载不了(形态)');
assert(classifyTopicFailure('expand_contents_too_few') === '内容无法展开', '标签：内容无法展开');
assert(classifyTopicFailure('near_duplicate_history') === '与历史重复', '标签：与历史重复');
assert(classifyTopicFailure('who_knows') === '其他', '标签：其他兜底');
assert(CONSENSUS_CANDIDATE_POOL_SIZE === 3, '候选池常量 = 3');

// ---------------------------------------------------------------------------
// 9. 批量挑选纯函数（接口：selected / unselected[{topic,reason}] / warnings 统一收敛）
// ---------------------------------------------------------------------------
console.log(`\n== 9. 批量挑选 ==`);
const fallbackOption = buildConservativeTopicFallback(baseInput);
function poolCandidate(id: string, direction: ConsensusTopicDirection, topic: string): ConsensusTopicOption {
  return {
    ...fallbackOption,
    id,
    topic,
    direction,
    expandContents: ['展开点一', '展开点二', '展开点三'],
  };
}
const pool = [
  poolCandidate('c1', '大痛点型', 'DELF B2写作总写不够250词怎么办'),
  poolCandidate('c2', '省时路径型', 'DELF B2写作备考重点先看这一篇'),
  poolCandidate('c3', '具体方法型', 'DELF B2写作自查三步法'),
];

// N=2：必不同方向、同候选至多一次
const two = selectTopicsForCard({ candidates: pool, topicsPerCard: 2, cardUsedTopicTexts: [], batchUsedTopicTexts: [] });
assert(two.selected.length === 2, `N=2 选出 2 个（实际 ${two.selected.length}）`);
assert(new Set(two.selected.map(t => t.direction)).size === 2, 'N=2 两个 job 方向必不同');
assert(two.selected.length === new Set(two.selected.map(t => t.id)).size, '同候选至多选中一次');
assert(two.unselected.length === 1 && two.unselected[0].topic.id !== two.selected[0].id, '未选中候选带完整对象');
assert(two.unselected.every(u => typeof u.reason === 'string' && u.reason.length > 0), '未选中候选带原因');

// N=1 / N=3
const one = selectTopicsForCard({ candidates: pool, topicsPerCard: 1, cardUsedTopicTexts: [], batchUsedTopicTexts: [] });
assert(one.selected.length === 1 && one.unselected.length === 2, 'N=1 选 1 落 2');
const three = selectTopicsForCard({ candidates: pool, topicsPerCard: 3, cardUsedTopicTexts: [], batchUsedTopicTexts: [] });
assert(three.selected.length === 3 && three.unselected.length === 0, 'N=3 全选无落选');
assert(three.selected.map(t => t.direction).sort().join(',') === ['具体方法型', '大痛点型', '省时路径型'].sort().join(','), 'N=3 覆盖全部 3 方向');

// N 越界 clamp
const clamped = selectTopicsForCard({ candidates: pool, topicsPerCard: 9, cardUsedTopicTexts: [], batchUsedTopicTexts: [] });
assert(clamped.selected.length === 3, 'topicsPerCard=9 clamp 到候选池 3');

// 卡内硬去重：命中即落选，死因带"与历史重复"
const hardDedup = selectTopicsForCard({ candidates: pool, topicsPerCard: 2, cardUsedTopicTexts: [pool[0].topic], batchUsedTopicTexts: [] });
assert(!hardDedup.selected.some(t => t.id === 'c1'), '卡内重复候选被硬去重落选');
assert(hardDedup.unselected.some(u => u.topic.id === 'c1' && u.reason.includes('与历史重复')), '落选原因归类为与历史重复');

// §8.1-9 候选间相似度互查：方向不同但文本雷同 → 后者落选且只记一次死因，名额由其余候选补
const similarPool = [
  poolCandidate('s1', '大痛点型', 'DELF B2写作总写不够250词怎么办'),
  poolCandidate('s2', '省时路径型', 'DELF B2写作总写不够250词怎么破'),
  poolCandidate('s3', '具体方法型', 'DELF B2写作自查三步法'),
];
const interCandidate = selectTopicsForCard({ candidates: similarPool, topicsPerCard: 2, cardUsedTopicTexts: [], batchUsedTopicTexts: [] });
assert(interCandidate.selected.length === 2, `雷同候选剔除后仍凑满2个（实际 ${interCandidate.selected.length}）`);
assert(!interCandidate.selected.some(t => t.id === 's2'), '与已选候选雷同者（方向不同）不选中');
assert(interCandidate.selected.some(t => t.id === 's1') && interCandidate.selected.some(t => t.id === 's3'), '名额由不雷同候选补齐');
assert(interCandidate.unselected.filter(u => u.topic.id === 's2').length === 1, '雷同落选只记一次死因');
assert(interCandidate.unselected.some(u => u.topic.id === 's2' && u.reason.includes('与其他候选内容重复')), '落选原因归类为与其他候选内容重复');

// 跨卡撞题：只进统一 warnings（前缀"跨卡撞题"），照常选中，不吞（N=3 保证撞题候选真的被选中）
const collision = selectTopicsForCard({ candidates: pool, topicsPerCard: 3, cardUsedTopicTexts: [], batchUsedTopicTexts: [pool[2].topic] });
assert(collision.selected.some(t => t.id === 'c3'), '跨卡撞题候选照常选中（只警告不吞）');
assert(collision.warnings.some(w => w.startsWith('跨卡撞题') && w.includes(pool[2].topic.slice(0, 8))), '撞题警告进统一 warnings 且带前缀和原题信息');
assert(!('collisionWarnings' in collision), '结果契约不再有独立 collisionWarnings 字段');

// 候选池为空
const emptyPool = selectTopicsForCard({ candidates: [], topicsPerCard: 2, cardUsedTopicTexts: [], batchUsedTopicTexts: [] });
assert(emptyPool.selected.length === 0 && emptyPool.warnings.some(w => w.includes('候选池为空')), '空池返回警告不抛错');

// ---------------------------------------------------------------------------
// 10. 接线改动范围（报告项，B2 起不再断言零改动）
// B1 的"零旧文件改动"保证已完成使命；B2 合法修改接线文件，
// 这里只打印当前改动清单供验收记录。商品2/3 与 showcase 不受影响由
// test-v2-b2-isolation.mts 用 fetch 打桩端到端锁定。
// ---------------------------------------------------------------------------
console.log(`\n== 10. 接线改动范围（报告） ==`);
const diff = execSync('git diff HEAD --name-only', { cwd: '../', encoding: 'utf8' }).trim();
const inRepo = diff.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('.claude/'));
console.log(`  当前已跟踪文件改动（排除 .claude/）：${inRepo.length ? inRepo.join('、') : '(无)'}`);

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
