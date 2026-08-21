import { callOpenAICompatibleJsonWithUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getCoverTemplateSpec, type CoverTemplateSpec } from '@/lib/cover-template-specs';
import { getProductPromptProfile } from '@/lib/product-prompt-profiles';
import { getRecentTitleFingerprints } from '@/lib/title-usage-store';
import { getXhsSearchKeywords } from '@/lib/xhs-search-keywords';
import type { CompetitorCreativeCard, EvidenceSnippet } from '@/types/reference-workflow';
import type { ProductId } from '@/types/data';
import { getProductEditorialMap, type EditorialCapability } from './product-editorial-map';
import { diagnoseTopicOption } from './topic-stage';
import { stableHash, type ConsensusTopicDirection, type TemplateCapability, type TopicBridgeBasis, type TopicLane, type TopicOption, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { listVerifiedExamFacts } from './verified-exam-facts';

/**
 * 阶段 B1：商品1（delf_b2_writing）普通模式"共识选题"新分支。
 * 纯新文件，不接线：generateTopicOptions 入口 / route / page.tsx 均不引用本文件。
 * 唯一调用方是离线测试（scripts/test-v2-consensus-topic.mts）。
 * B2 接线获批后，本文件的类型才合并进 contracts.ts。
 */

export const CONSENSUS_TOPIC_PROMPT_VERSION = 'v2-topic-consensus-b1';

/** 共识口径：候选池固定 3（3 方向各 1）。挑选数量 topicsPerCard(1-3) 是另一个参数，见 batch-topic-selection.ts。 */
export const CONSENSUS_CANDIDATE_POOL_SIZE = 3;

/** 3 个选题方向（共识第 5 节）。名称+定义可进 prompt，但不带例子词。 */
// ConsensusTopicDirection / TopicBridgeBasis 已合并进 contracts.ts（B2 接线），此处 re-export 保持既有导入路径兼容。
export type { ConsensusTopicDirection, TopicBridgeBasis } from './contracts';

export const CONSENSUS_TOPIC_DIRECTIONS: ConsensusTopicDirection[] = ['大痛点型', '省时路径型', '具体方法型'];

const DIRECTION_LANES: Record<ConsensusTopicDirection, TopicLane> = {
  大痛点型: 'broad_pain',
  省时路径型: 'result_need',
  具体方法型: 'narrow_knowledge',
};

const DIRECTION_GOALS: Record<ConsensusTopicDirection, TopicOption['primaryGoal']> = {
  大痛点型: 'search',
  省时路径型: 'save',
  具体方法型: 'click',
};

/** 商品承接依据：必须命中 editorial map 的能力编号 + 支持模块。 */
// TopicBridgeBasis 定义在 contracts.ts，此处 re-export 保持兼容。

/** 新选题类型：TopicOption + 共识第 8 节新字段。基础字段已在 contracts.ts，此处收窄必填项。 */
export type ConsensusTopicOption = TopicOption & {
  direction?: ConsensusTopicDirection;
  /** 准备展开的 3-5 条内容；<3 → 警告放行（§8.1-6）。 */
  expandContents: string[];
};

/** 逐候选死因（§3.4 / §8.1-4）：候选级失败永不升级为整卡失败。 */
export interface TopicCandidateDeath {
  index: number;
  topicLabel: string;
  code: string;
  label: string;
  detail: string;
}

/** 死因五类 + 其他（§8.1-4）。 */
export type TopicFailureClass =
  | '方向不匹配'
  | '封面承载不了'
  | '商品无法承接'
  | '内容无法展开'
  | '与历史重复'
  | '其他';

const FAILURE_CLASS_BY_CODE: Record<string, TopicFailureClass> = {
  product_value_in_normal_mode: '方向不匹配',
  direction_invalid: '方向不匹配',
  cover_goal_mismatch: '封面承载不了',
  cover_content_shape_mismatch: '封面承载不了',
  cross_product_identity: '商品无法承接',
  missing_product_bridge: '商品无法承接',
  bridge_module_not_found: '商品无法承接',
  expand_contents_too_few: '内容无法展开',
  missing_user_context: '内容无法展开',
  candidate_unparseable: '内容无法展开',
  near_duplicate_history: '与历史重复',
};

export function classifyTopicFailure(code: string): TopicFailureClass {
  return FAILURE_CLASS_BY_CODE[code] || '其他';
}

export function describeTopicFailure(death: { code: string; detail: string }): string {
  return `${classifyTopicFailure(death.code)}（${death.code}）：${death.detail}`;
}

// ---------------------------------------------------------------------------
// 5 块契约（§3.1）
// ---------------------------------------------------------------------------

export interface ConsensusTopicContract {
  商品身份: {
    商品名称: string;
    所属领域: string;
    商品能力: Array<{ 能力编号: string; 能力: string; 支持模块: string[] }>;
    已确认考试边界: Array<{ id: string; text: string }>;
  };
  购买者地图: { 用户阶段: string[]; 真实状态: string[]; 购买动机: string[] };
  当前封面: {
    封面名称: string;
    封面作用: string;
    适合承载: string[];
    内容形态: string;
    信息密度: '低' | '低到中' | '中' | '中高' | '高';
    不适合承载: string[];
  };
  历史去重信息: { 最近使用过的选题: string[]; 最近使用过的标题: string[]; 最近使用过的表达方向: string[] };
  本次生成要求: {
    生成模式: 'single' | 'batch';
    搜索词: string[];
    用户补充方向: string;
    选题数量: number;
    选题方向: ConsensusTopicDirection[];
    生成语言: '中文';
  };
}

export interface ConsensusTopicHistoryInput {
  recentTopics?: string[];
  recentTitles?: string[];
  recentExpressions?: string[];
}

export interface ConsensusTopicStageInput {
  productId: ProductId;
  card: CompetitorCreativeCard;
  capability: TemplateCapability;
  /** single=前台单卡；batch=批量（跨卡软规避文本由调用方经 recentAngles 传入）。 */
  mode?: 'single' | 'batch';
  /** 搜索词；缺省用 getXhsSearchKeywords(productId)。 */
  searchKeywords?: string[];
  /** 用户补充方向（自由文本）。 */
  userDirection?: string;
  /** 跨卡软规避文本（批量模式下传入上一批已选/近期角度）。 */
  recentAngles?: string[];
  /** 历史去重信息；缺省从 title-usage-store 读取。 */
  history?: ConsensusTopicHistoryInput;
  /** 5 块序列化字符上限（先测量 legacy prompt 后传入，= legacy × 1.3）。 */
  charBudget?: number;
}

// ---------------------------------------------------------------------------
// 考试边界筛选：先筛选再传，字符上限只作兜底（红线 6）
// ---------------------------------------------------------------------------

/**
 * 选题相关性筛选规则（规则在前，截断在后）：
 * 1. 只保留官方考试事实类目（category === 'official_exam_fact'）；
 * 2. 文本必须与"写作任务结构 / 时长 / 词数 / 题型 / 评分"相关（关键词命中）；
 * 3. 剔除含其他科目（口语/听力/阅读为主）或其他考试体系（TEF/TCF/CLB/NCLC）的条目。
 * delf_b2_writing 现有 5 条（OFF-DELF-WRITE-001~005）按此规则全部保留。
 */
const EXAM_FACT_RELEVANT_TERMS = ['写作', '词', '题型', '任务', '时间', '评分', '正式信', '论坛', '报告', '组织'];
const EXAM_FACT_OFF_SCOPE = /口语|听力|阅读|TEF|TCF|CLB|NCLC/;

export function selectTopicRelevantExamFacts(items: EvidenceSnippet[]) {
  const kept: EvidenceSnippet[] = [];
  const dropped: Array<{ id: string; reason: string }> = [];
  for (const item of items) {
    if (item.category !== 'official_exam_fact') {
      dropped.push({ id: item.id, reason: '非官方考试事实类目' });
      continue;
    }
    if (EXAM_FACT_OFF_SCOPE.test(item.text)) {
      dropped.push({ id: item.id, reason: '含其他科目或其他考试体系词' });
      continue;
    }
    if (!EXAM_FACT_RELEVANT_TERMS.some(term => item.text.includes(term))) {
      dropped.push({ id: item.id, reason: '与写作任务结构/时长/词数/题型/评分无关' });
      continue;
    }
    kept.push(item);
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------
// 当前封面块：从 cover-template-specs.ts 现有字段派生（§3.1，不新造模板数据）
// ---------------------------------------------------------------------------

/**
 * 近似来源说明（§3.1 允许派生，缺维度需汇报）：
 * - 封面名称/内容形态/信息密度：直接来自 spec.name / sectionCount+itemsPerSection / minTotalItems；
 * - 封面作用/适合承载/不适合承载：spec 没有这三个字段，按 spec.family 用规则表派生
 *   （规则表语义与 topic-stage.ts topicShapeMismatch 的家族承载判断一致，不是新造数据）。
 */
function coverRoleByFamily(spec: CoverTemplateSpec): { role: string; suitable: string[]; unsuitable: string[] } {
  switch (spec.family) {
    case 'pain':
      return {
        role: '用一句主标题让用户第一眼感到与自己有关',
        suitable: ['一个明显痛点', '一个反常识观点', '一个结果或提醒'],
        unsuitable: ['词汇表或固定搭配表', '资料目录', '课程路径或阶段规划', '逐句解析'],
      };
    case 'experience':
      return {
        role: '用第一人称经历建立信任并带出问题或复盘',
        suitable: ['经历复盘', '误区观察', '场景感受', '建议'],
        unsuitable: ['纯清单', '词汇表', '短语表', '逐条对照表', '规则解析'],
      };
    case 'phrase':
    case 'flashcard':
    case 'table':
      return {
        role: '把成对或成组的短条目做成一页可速查的清单',
        suitable: ['表达搭配', '词组对照', '短知识点分组'],
        unsuitable: ['长篇经历', '完整故事', '纯经验分享', '情绪随笔'],
      };
    case 'document':
      return {
        role: '展示真实资料页、原句或范文素材并做解析',
        suitable: ['原句与例句', '范文素材', '解析与改写', '对照'],
        unsuitable: ['学习路径或阶段规划', '真人经历', '情绪故事', '资料包介绍'],
      };
    case 'offer':
      return {
        role: '展示资料方案能解决什么、适合谁、怎么用',
        suitable: ['收益与适合人群', '使用方式', '解决什么问题'],
        unsuitable: ['只讲语法规则解析', '逐句解释', '例句精讲式纯教学'],
      };
    case 'roadmap':
      return {
        role: '把复习安排展示成有先后顺序的路径',
        suitable: ['阶段安排', '复习顺序', '考前路径'],
        unsuitable: ['孤立单词表或短语表', '一条语法规则', '逐句解析'],
      };
    case 'book':
      return {
        role: '像一册手册那样展示成体系的资料',
        suitable: ['知识体系', '方法章节', '速查内容'],
        unsuitable: ['长故事', '纯个人经历', '大段情绪表达'],
      };
    case 'directory':
    default:
      return {
        role: '把内容展示成一页整理好的资料体系',
        suitable: ['知识体系', '清单', '备考路径', '多个分类', '考前速查'],
        unsuitable: ['长故事', '纯个人经历', '大段情绪表达'],
      };
  }
}

function densityLabel(minTotalItems: number): ConsensusTopicContract['当前封面']['信息密度'] {
  if (minTotalItems <= 6) return '低';
  if (minTotalItems <= 10) return '低到中';
  if (minTotalItems <= 20) return '中';
  if (minTotalItems <= 28) return '中高';
  return '高';
}

export function deriveCoverContractForTopic(capability: TemplateCapability): ConsensusTopicContract['当前封面'] {
  const spec = getCoverTemplateSpec(capability.renderer);
  if (!spec) throw new Error(`模板 ${capability.renderer} 没有封面规格配置`);
  const role = coverRoleByFamily(spec);
  return {
    封面名称: spec.name,
    封面作用: role.role,
    适合承载: role.suitable,
    内容形态: spec.sectionCount <= 1
      ? `约 ${spec.itemsPerSection} 条短条目`
      : `${spec.sectionCount} 个分组，每组约 ${spec.itemsPerSection} 条短条目`,
    信息密度: densityLabel(spec.minTotalItems),
    不适合承载: role.unsuitable,
  };
}

// ---------------------------------------------------------------------------
// 字符预算：新契约 ≤ legacy 选题 prompt 的 130%（先测后传，超限按优先级截断）
// ---------------------------------------------------------------------------

export function getConsensusPromptBudget(legacyPromptCharCount: number): number {
  return Math.ceil(legacyPromptCharCount * 1.3);
}

/** 超限截断优先级：先考试边界条目（从后往前丢），再购买者地图每组（从后往前丢）。 */
export function enforceContractBudget(
  contract: ConsensusTopicContract,
  budget: number,
): { contract: ConsensusTopicContract; warnings: string[] } {
  const warnings: string[] = [];
  const working: ConsensusTopicContract = JSON.parse(JSON.stringify(contract));
  const count = () => JSON.stringify(working).length;
  if (count() <= budget) return { contract: working, warnings };
  while (working.商品身份.已确认考试边界.length > 1 && count() > budget) {
    const removed = working.商品身份.已确认考试边界.pop();
    warnings.push(`考试边界条目超字符预算被截断：${removed?.id}`);
  }
  const buyerGroups: Array<keyof ConsensusTopicContract['购买者地图']> = ['购买动机', '真实状态', '用户阶段'];
  for (const group of buyerGroups) {
    while (working.购买者地图[group].length > 1 && count() > budget) {
      const removed = working.购买者地图[group].pop();
      warnings.push(`购买者地图.${group} 超字符预算被截断一条`);
    }
  }
  if (count() > budget) warnings.push('5块契约仍超字符预算（已保留每组至少1条），需人工检查输入体积');
  return { contract: working, warnings };
}

// ---------------------------------------------------------------------------
// prompt 组装
// ---------------------------------------------------------------------------

function buildHistoryBlock(history: ConsensusTopicHistoryInput): ConsensusTopicContract['历史去重信息'] {
  return {
    最近使用过的选题: (history.recentTopics || []).slice(-20),
    最近使用过的标题: (history.recentTitles || []).slice(-20),
    最近使用过的表达方向: (history.recentExpressions || []).slice(-20),
  };
}

export function buildConsensusTopicContract(input: ConsensusTopicStageInput): { contract: ConsensusTopicContract; warnings: string[] } {
  const warnings: string[] = [];
  const profile = getProductPromptProfile(input.productId);
  const editorialMap = getProductEditorialMap(input.productId);
  if (!editorialMap) throw new Error(`商品 ${input.productId} 没有商品能力/购买者地图（阶段B仅支持商品1普通模式）`);
  const examFacts = selectTopicRelevantExamFacts(listVerifiedExamFacts(input.productId));
  for (const drop of examFacts.dropped) warnings.push(`考试边界条目被选题相关性规则筛除：${drop.id} ${drop.reason}`);
  const keywords = input.searchKeywords ?? [...getXhsSearchKeywords(input.productId).primary, ...getXhsSearchKeywords(input.productId).secondary].slice(0, 12);
  const history = buildHistoryBlock({
    recentTopics: [...(input.history?.recentTopics || []), ...(input.recentAngles || [])],
    recentTitles: input.history?.recentTitles,
    recentExpressions: input.history?.recentExpressions,
  });
  const contract: ConsensusTopicContract = {
    商品身份: {
      商品名称: profile.noteIdentity,
      所属领域: profile.topicScopePrompt,
      商品能力: editorialMap.capabilities.map(cap => ({ 能力编号: cap.capabilityId, 能力: cap.capability, 支持模块: cap.modules })),
      已确认考试边界: examFacts.kept.map(item => ({ id: item.id, text: item.text })),
    },
    购买者地图: {
      用户阶段: editorialMap.buyerMap.userStages,
      真实状态: editorialMap.buyerMap.realStates,
      购买动机: editorialMap.buyerMap.motivations,
    },
    当前封面: deriveCoverContractForTopic(input.capability),
    历史去重信息: history,
    本次生成要求: {
      生成模式: input.mode || 'single',
      搜索词: keywords,
      用户补充方向: input.userDirection || '',
      选题数量: CONSENSUS_CANDIDATE_POOL_SIZE,
      选题方向: [...CONSENSUS_TOPIC_DIRECTIONS],
      生成语言: '中文',
    },
  };
  return { contract, warnings };
}

/**
 * 系统提示词：共识第 6 节 17 条为主体（第 9 条按 B1 红线改为规则描述，不带例子词），
 * 叠加从 topic-stage.ts TOPIC prompt 只读提取的三类禁忌（跨商品词经 profile.scope 表达、
 * 评分扣分角度、内部资料 ID），以及省时路径型禁止承诺（共识 5.2）。
 */
export function buildConsensusTopicSystemPrompt(productId: ProductId): string {
  const profile = getProductPromptProfile(productId);
  return [
    '你是资深小红书法语备考内容策划。',
    '你的任务不是介绍商品目录，也不是直接写正文，而是根据商品能力、购买者真实状态和当前封面形式，提出3个值得用户点击和继续阅读的内容选题。',
    '请遵守以下规则：',
    '1. 选题必须属于当前商品所属领域。',
    '2. 选题必须让目标用户看出“这和我有关”。',
    '3. 选题必须对应一个真实备考场景。',
    '4. 选题必须有具体内容可以展开，每个选题提供3到5条准备展开的内容。',
    '5. 选题必须能自然使用当前封面的内容形态。',
    '6. 当前封面只决定内容如何展示，不决定文章必须讲什么。',
    '7. 不要把商品模块名称直接当成选题。',
    '8. 不要把抽象口号当成选题。痛点必须是考生正在经历的具体状态，禁止使用抽象、机械、非真实用户口语的痛点表达，不得使用未经确认的抽象概括。',
    '9. 不要把过于细小的知识点包装成所有用户都会遇到的大痛点。',
    '10. 3个选题必须分别属于“大痛点型、省时路径型、具体方法型”三个不同方向，解决不同层次的需求，不能只是换几个词。',
    '11. 普通模式允许AI原创解释、方法和例子，不要求每个选题都命中某个事实卡。',
    '12. 不能把商品没有的服务、资历或功能写成商品内容；商品承接依据只能引用输入“商品身份.商品能力”中列出的能力编号和支持模块，不得发明能力或模块名。',
    '13. 涉及考试规则、评分标准、题型要求、词数要求、格式要求、官方规定或商品实际包含内容时，只能使用输入中明确提供的信息（“已确认考试边界”与“商品能力”），不得自行编造、夸大或包装为确定事实。',
    '14. 一般性的学习方法、练习建议或表达示例可以由AI原创，但不能包装成官方规定或确定事实。',
    '15. 省时路径型只能表达少走弯路、更快理清重点、明确先后顺序、缩小复习范围等收益；不能承诺一定提分、一定通过，不能暗示短期资料可以替代持续练习。',
    '16. 不生成最终文字标题，不生成最终封面标题，不生成正文；“选题名称”是工作名称，不是发布标题。',
    '17. 只输出选题策划结果：一个合法JSON对象，顶层字段“选题列表”，恰好包含3个选题对象，不添加解释文字。',
    // 以下为从既有 TOPIC prompt 只读提取的三类硬禁忌（跨商品词不逐词列出，交给商品身份.scope 规则）。
    `18. 禁止跨商品：${profile.topicScopePrompt}`,
    '19. 本商品写作官方评分是5个维度按表现档位评分，不是按错误逐项扣分；禁止把选题设计成“考官逐条扣分、每错一项扣几分、扣分表”一类角度。',
    '20. 禁止在用户可见文本中使用内部资料编号或模块ID；支持模块名只能出现在“商品承接依据”字段里。',
    '21. “本篇说话动作”和“开头情绪起势”各写一句原创表达，不得与历史去重信息中的表达方向重复。',
    '每个选题对象必须使用这些中文键：选题方向、选题名称、对应的用户真实状态、用户使用场景、用户真正想得到的结果、这篇内容准备解决什么、准备展开的内容（数组）、商品承接依据（对象：能力编号、支持模块）、为什么适合当前封面、用户为什么可能点击、本篇说话动作、开头情绪起势、是否可能与历史选题重复（布尔）。字段要简洁，但不能留空。',
  ].join('\n');
}

export interface ConsensusTopicPrompt {
  system: string;
  user: string;
  contract: ConsensusTopicContract;
  warnings: string[];
  charCount: number;
  budget: number | null;
}

export function buildConsensusTopicPrompt(input: ConsensusTopicStageInput): ConsensusTopicPrompt {
  const { contract, warnings } = buildConsensusTopicContract(input);
  const system = buildConsensusTopicSystemPrompt(input.productId);
  const userPreamble = `请根据以下5块信息，生成${CONSENSUS_CANDIDATE_POOL_SIZE}个普通模式的小红书选题（3个方向各1个）。\n`;
  let finalContract = contract;
  let budgetWarnings: string[] = [];
  let budget: number | null = null;
  if (typeof input.charBudget === 'number' && input.charBudget > 0) {
    budget = input.charBudget;
    // 预算覆盖整个 prompt：先扣掉系统提示词与用户块前缀的固定开销，剩余才是契约可用体积，
    // 否则只量契约 JSON 会在小预算时漏截断（整 prompt 已超而契约未超）。
    const enforced = enforceContractBudget(contract, input.charBudget - system.length - userPreamble.length);
    finalContract = enforced.contract;
    budgetWarnings = enforced.warnings;
  }
  const user = `${userPreamble}${JSON.stringify(finalContract, null, 0)}`;
  return {
    system,
    user,
    contract: finalContract,
    warnings: [...warnings, ...budgetWarnings],
    charCount: system.length + user.length,
    budget,
  };
}

// ---------------------------------------------------------------------------
// 宽松解析（§8.1-6）
// ---------------------------------------------------------------------------

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function uniqueStrings(value: unknown, cap = 8): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => clean(item)).filter(Boolean))).slice(0, cap);
}

/** 中文键优先，兼容英文旧键。 */
function pick(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw[key];
  }
  return undefined;
}

const KNOWN_KEYS = new Set([
  '选题方向', '选题名称', '对应的用户真实状态', '用户使用场景', '用户真正想得到的结果',
  '这篇内容准备解决什么', '准备展开的内容', '商品承接依据', '为什么适合当前封面', '用户为什么可能点击',
  '本篇说话动作', '开头情绪起势', '是否可能与历史选题重复',
]);

export interface DirectionNormalization {
  direction?: ConsensusTopicDirection;
  lane?: TopicLane;
  /** product_value / 商品介绍类方向：剔除该候选，不算失败。 */
  isProductValue: boolean;
  ok: boolean;
}

export function normalizeConsensusDirection(value: unknown): DirectionNormalization {
  const text = clean(value);
  if (!text) return { isProductValue: false, ok: false };
  for (const direction of CONSENSUS_TOPIC_DIRECTIONS) {
    if (text === direction) return { direction, lane: DIRECTION_LANES[direction], isProductValue: false, ok: true };
  }
  if (text.includes('product_value') || (text.includes('商品') && (text.includes('介绍') || text.includes('展示')))) {
    return { isProductValue: true, ok: false };
  }
  // lane 英文值兼容
  const laneByEnglish: Record<string, ConsensusTopicDirection> = {
    broad_pain: '大痛点型', result_need: '省时路径型', narrow_knowledge: '具体方法型',
  };
  if (laneByEnglish[text]) return { direction: laneByEnglish[text], lane: text as TopicLane, isProductValue: false, ok: true };
  // 关键词归一（不含例子词，只按方向定义关键词）
  if (text.includes('痛点')) return { direction: '大痛点型', lane: 'broad_pain', isProductValue: false, ok: true };
  if (text.includes('路径') || text.includes('省时')) return { direction: '省时路径型', lane: 'result_need', isProductValue: false, ok: true };
  if (text.includes('方法')) return { direction: '具体方法型', lane: 'narrow_knowledge', isProductValue: false, ok: true };
  return { isProductValue: false, ok: false };
}

export interface ParseConsensusTopicContext {
  productId: ProductId;
  card: CompetitorCreativeCard;
  capability: TemplateCapability;
  editorialCapabilities: EditorialCapability[];
  recentTopics: string[];
}

export interface ParsedConsensusTopicCandidate {
  candidate: ConsensusTopicOption | null;
  /** null 候选 + code 表示该候选被淘汰（含死因）；warning-only 的问题不产生 death。 */
  death?: { code: string; detail: string };
  warnings: string[];
}

function resolveGoal(direction: ConsensusTopicDirection | undefined, capability: TemplateCapability, fallbackIndex: number): TopicOption['primaryGoal'] {
  const preferred = direction ? DIRECTION_GOALS[direction] : undefined;
  if (preferred && capability.allowedGoals.includes(preferred)) return preferred;
  return capability.allowedGoals[fallbackIndex % capability.allowedGoals.length];
}

function bridgeBasisWarning(
  basis: TopicBridgeBasis | undefined,
  editorialCapabilities: EditorialCapability[],
): string | null {
  if (!basis || !basis.capabilityId) return '商品承接依据缺少能力编号，未命中商品能力表';
  const match = editorialCapabilities.find(cap => cap.capabilityId === basis.capabilityId);
  if (!match) return `商品承接依据能力编号 ${basis.capabilityId} 未命中商品能力表`;
  const unknownModules = (basis.modules || []).filter(mod => !match.modules.includes(mod));
  if (unknownModules.length) return `商品承接依据支持模块 ${unknownModules.join('、')} 未命中能力 ${basis.capabilityId} 的模块`;
  return null;
}

/**
 * 宽松解析单条原始候选。缺字段→默认值+警告；多余字段→忽略+警告；
 * direction 非法→归一，失败→候选级警告（保留候选，direction 留空）；
 * product_value 方向→剔除该候选（death code=product_value_in_normal_mode，不算失败语义，仅记录）；
 * expandContents<3 → 警告；bridgeBasis 未命中 → 警告放行。
 */
export function parseConsensusTopicCandidate(
  raw: Record<string, unknown>,
  index: number,
  ctx: ParseConsensusTopicContext,
): ParsedConsensusTopicCandidate {
  const warnings: string[] = [];
  const profile = getProductPromptProfile(ctx.productId);
  const extraKeys = Object.keys(raw).filter(key => !KNOWN_KEYS.has(key));
  if (extraKeys.length) warnings.push(`候选${index + 1}含未知字段，已忽略：${extraKeys.join('、')}`);

  const topicName = clean(pick(raw, ['选题名称', 'topic', 'topicName']));
  if (!topicName) {
    return { candidate: null, death: { code: 'candidate_unparseable', detail: '缺少选题名称，无法解析为候选' }, warnings };
  }

  const directionRaw = pick(raw, ['选题方向', 'direction', 'topicLane']);
  const normalizedDirection = normalizeConsensusDirection(directionRaw);
  if (normalizedDirection.isProductValue) {
    return {
      candidate: null,
      death: { code: 'product_value_in_normal_mode', detail: `候选方向为商品介绍类（${clean(directionRaw)}），普通模式剔除该候选，不判失败` },
      warnings,
    };
  }
  if (!clean(directionRaw)) {
    warnings.push(`候选${index + 1}缺少选题方向，按未分类方向放行`);
  } else if (!normalizedDirection.ok) {
    warnings.push(`候选${index + 1}选题方向“${clean(directionRaw)}”无法归一到三个共识方向，按未分类方向放行`);
  }

  const softFields: Array<[keyof ConsensusTopicOption, string[], string]> = [
    ['speechAction', ['本篇说话动作', 'speechAction'], '本篇说话动作'],
    ['openingEmotion', ['开头情绪起势', 'openingEmotion'], '开头情绪起势'],
    ['coverFitReason', ['为什么适合当前封面', 'coverFitReason'], '为什么适合当前封面'],
    ['clickReason', ['用户为什么可能点击', 'clickReason'], '用户为什么可能点击'],
  ];
  const softValues: Partial<Record<string, string>> = {};
  for (const [field, keys, label] of softFields) {
    const value = clean(pick(raw, keys));
    if (!value) warnings.push(`候选${index + 1}缺少“${label}”，留空并警告（内容阶段按可选提示消费）`);
    softValues[field as string] = value || undefined;
  }

  const expandContents = uniqueStrings(pick(raw, ['准备展开的内容', 'expandContents']), 5);
  if (expandContents.length === 0) {
    warnings.push(`候选${index + 1}缺少“准备展开的内容”，留空并警告`);
  } else if (expandContents.length < 3) {
    warnings.push(`候选${index + 1}“准备展开的内容”少于3条（${expandContents.length}条），警告放行`);
  }

  const bridgeRaw = pick(raw, ['商品承接依据', 'bridgeBasis', 'productBridgeBasis']);
  let bridgeBasis: TopicBridgeBasis | undefined;
  let productBridge = '';
  if (bridgeRaw && typeof bridgeRaw === 'object') {
    const record = bridgeRaw as Record<string, unknown>;
    const capabilityId = clean(pick(record, ['能力编号', 'capabilityId']));
    const modules = uniqueStrings(pick(record, ['支持模块', 'modules', 'supportModules']), 6);
    if (capabilityId || modules.length) {
      bridgeBasis = { capabilityId, modules };
      const capabilityText = ctx.editorialCapabilities.find(cap => cap.capabilityId === capabilityId)?.capability
        || clean(pick(record, ['商品能力', 'capability']));
      productBridge = modules.length
        ? [capabilityText, `模块：${modules.join('、')}`].filter(Boolean).join('（') + '）'
        : capabilityText;
    }
  } else if (typeof bridgeRaw === 'string' && clean(bridgeRaw)) {
    productBridge = clean(bridgeRaw);
  }
  if (!productBridge) warnings.push(`候选${index + 1}缺少商品承接依据，留空并警告`);
  const basisWarning = bridgeBasisWarning(bridgeBasis, ctx.editorialCapabilities);
  if (basisWarning) warnings.push(`候选${index + 1}${basisWarning}，警告放行`);

  const goal = resolveGoal(normalizedDirection.direction, ctx.capability, index);
  const audienceState = clean(pick(raw, ['对应的用户真实状态', 'audienceState'])) || '正在准备本商品考试的备考者';
  const scene = clean(pick(raw, ['用户使用场景', 'scene'])) || '备考练习场景';
  const desiredResult = clean(pick(raw, ['用户真正想得到的结果', 'promise']));
  const solveWhat = clean(pick(raw, ['这篇内容准备解决什么', 'contentAngle']));
  if (!desiredResult) warnings.push(`候选${index + 1}缺少“用户真正想得到的结果”，留空并警告`);
  if (!solveWhat) warnings.push(`候选${index + 1}缺少“这篇内容准备解决什么”，留空并警告`);
  const duplicateRaw = pick(raw, ['是否可能与历史选题重复', 'duplicateWithHistory']);

  const candidate: ConsensusTopicOption = {
    id: `v2_consensus_topic_${stableHash(`${ctx.card.id}|${topicName}`)}`,
    productId: ctx.productId,
    templateId: ctx.card.renderer_id,
    primaryGoal: goal,
    topicLane: normalizedDirection.lane || (goal === 'search' ? 'broad_pain' : goal === 'save' ? 'result_need' : 'narrow_knowledge'),
    topic: topicName,
    audienceState,
    scene,
    painOrDesire: audienceState,
    promise: desiredResult,
    contentAngle: solveWhat,
    plannedBlockKind: ctx.capability.acceptedBlockKinds[index % ctx.capability.acceptedBlockKinds.length],
    productBridge,
    seo: { primary: profile.noteIdentity, related: [] },
    knowledgeMode: 'mixed',
    factTerms: (bridgeBasis?.modules || []).slice(0, 8),
    seedSignals: normalizedDirection.direction ? [normalizedDirection.direction] : [],
    noveltyFingerprint: `consensus|${normalizedDirection.direction || 'unclassified'}|${stableHash(topicName)}`,
    direction: normalizedDirection.direction,
    expandContents,
    bridgeBasis,
    coverFitReason: softValues.coverFitReason,
    clickReason: softValues.clickReason,
    speechAction: softValues.speechAction,
    openingEmotion: softValues.openingEmotion,
    duplicateWithHistory: duplicateRaw === true || duplicateRaw === 'true' || undefined,
  };
  return { candidate, warnings };
}

// 复用 topic-stage.ts 现有的选题闸门（只读导入，不改动那个文件），
// 保证新旧分支对同一候选的判断口径一致。
function topicGateFailureCodes(topic: ConsensusTopicOption, ctx: { productId: ProductId; capability: TemplateCapability }): string[] {
  return diagnoseTopicOption(topic, ctx);
}

// 与 topic-stage TOPIC_HARD_FAILURES 相同口径的硬失败集合（候选级淘汰；其余只警告）。
const CONSENSUS_TOPIC_HARD_FAILURES = new Set([
  'cross_product_identity',
  'cover_goal_mismatch',
  'cover_content_shape_mismatch',
  'product_showcase_mode_mismatch',
  'missing_user_context',
  'missing_product_bridge',
]);

export function diagnoseConsensusTopicCandidate(
  topic: ConsensusTopicOption,
  ctx: { productId: ProductId; capability: TemplateCapability; recentTopics: string[] },
): TopicCandidateDeath[] {
  const deaths: TopicCandidateDeath[] = [];
  for (const code of topicGateFailureCodes(topic, ctx)) {
    if (CONSENSUS_TOPIC_HARD_FAILURES.has(code)) {
      deaths.push({ index: -1, topicLabel: topic.topic, code, label: classifyTopicFailure(code), detail: code });
    }
  }
  return deaths;
}

// ---------------------------------------------------------------------------
// 保守兜底（§3.4：3 候选全灭时，程序按 profile+封面生成 1 个保守选题，零 AI 调用）
// ---------------------------------------------------------------------------

export function buildConservativeTopicFallback(input: ConsensusTopicStageInput): ConsensusTopicOption {
  const profile = getProductPromptProfile(input.productId);
  const editorialMap = getProductEditorialMap(input.productId)!;
  const cover = deriveCoverContractForTopic(input.capability);
  const fallbackCapability = editorialMap.capabilities[editorialMap.capabilities.length - 1];
  const goal = input.capability.allowedGoals.includes('save') ? 'save' : input.capability.allowedGoals[0] || 'click';
  return {
    id: `consensus_fallback_${input.card.id}_${stableHash(input.productId)}`,
    productId: input.productId,
    templateId: input.capability.renderer,
    primaryGoal: goal,
    topicLane: DIRECTION_LANES.省时路径型,
    topic: `${profile.noteIdentity}备考先看什么：一份按顺序的复习自查清单`,
    audienceState: '正在备考、不确定先复习什么的考生',
    scene: '考前整理复习安排时',
    painOrDesire: '不知道先做什么、后做什么',
    promise: '给出可执行的复习先后顺序',
    contentAngle: `按${cover.封面名称}的承载形态展示自查顺序`,
    plannedBlockKind: input.capability.acceptedBlockKinds[0],
    productBridge: fallbackCapability.capability,
    seo: { primary: profile.noteIdentity, related: [] },
    knowledgeMode: 'mixed',
    factTerms: fallbackCapability.modules.slice(0, 8),
    seedSignals: ['consensus-fallback'],
    noveltyFingerprint: `consensus-fallback|${input.card.id}|${input.productId}`,
    direction: '省时路径型',
    expandContents: ['梳理当前最该先复习的部分', '按顺序自查各部分掌握情况', '对照资料定位薄弱环节'],
    bridgeBasis: { capabilityId: fallbackCapability.capabilityId, modules: fallbackCapability.modules },
    coverFitReason: '保守兜底选题使用清单/分组类内容形态，与多数封面兼容',
    clickReason: '考生在考前普遍关心复习顺序',
    speechAction: undefined,
    openingEmotion: undefined,
  };
}

// ---------------------------------------------------------------------------
// 主入口：generateTopicOptionsConsensus（AI 调用可注入 stub）
// ---------------------------------------------------------------------------

export type ConsensusTopicAiCall = (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<unknown>;

async function defaultAiCall(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<unknown> {
  const result = await callOpenAICompatibleJsonWithUsage<Record<string, unknown>>(messages, { maxTokens: 2400, temperature: 0.8, retries: 2 });
  return result.data;
}

export interface ConsensusTopicStageResult {
  data: ConsensusTopicOption[];
  /** 候选池级警告（软修复/降级/兜底/截断）。 */
  warnings: string[];
  /** 逐候选死因（含被剔除的 product_value 候选），供前台显示。 */
  deaths: TopicCandidateDeath[];
  usedFallback: boolean;
  /** §8.1-10：兜底只保证不失败不保证好；机器可读标记，前台据此提示人工复核。 */
  needsManualReview: boolean;
  promptVersion: string;
  schemaVersion: string;
  promptCharCount: number;
}

function extractRawTopics(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['选题列表', 'topics', 'candidates']) {
      if (Array.isArray(record[key])) return record[key].filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
    }
  }
  return [];
}

export async function generateTopicOptionsConsensus(
  input: ConsensusTopicStageInput,
  aiCall: ConsensusTopicAiCall = defaultAiCall,
): Promise<ConsensusTopicStageResult> {
  const prompt = buildConsensusTopicPrompt(input);
  const warnings = [...prompt.warnings];
  if (prompt.budget !== null && prompt.charCount > prompt.budget) {
    warnings.push(`prompt 总字符 ${prompt.charCount} 超预算 ${prompt.budget}（截断优先级已执行，仍超限需检查系统提示词体积）`);
  }
  const editorialMap = getProductEditorialMap(input.productId)!;
  const recentTopics = prompt.contract.历史去重信息.最近使用过的选题;
  const ctx: ParseConsensusTopicContext = {
    productId: input.productId,
    card: input.card,
    capability: input.capability,
    editorialCapabilities: editorialMap.capabilities,
    recentTopics,
  };

  let data: unknown;
  try {
    data = await aiCall([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ]);
  } catch (error) {
    data = null;
    warnings.push(`AI调用失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const rawTopics = extractRawTopics(data);
  const deaths: TopicCandidateDeath[] = [];
  const candidates: ConsensusTopicOption[] = [];
  if (!rawTopics.length) warnings.push('AI响应中没有可解析的候选（选题列表为空或结构不符）');

  rawTopics.forEach((raw, index) => {
    const parsed = parseConsensusTopicCandidate(raw, index, ctx);
    warnings.push(...parsed.warnings);
    if (!parsed.candidate) {
      deaths.push({ index, topicLabel: clean(pick(raw, ['选题名称', 'topic'])) || `候选${index + 1}`, ...parsed.death!, label: classifyTopicFailure(parsed.death!.code) });
      return;
    }
    const gateDeaths = diagnoseConsensusTopicCandidate(parsed.candidate, { ...ctx, recentTopics });
    if (gateDeaths.length) {
      deaths.push(...gateDeaths.map(death => ({ ...death, index, topicLabel: parsed.candidate!.topic })));
      return;
    }
    candidates.push(parsed.candidate);
  });

  // §8.1-4：逐候选死因以可读文案进 warnings（满池/降级/兜底三条返回路径都带）。
  // 单一来源在这里产出；wrapConsensusTopicArtifact 与 B2 接线均原样透传，前台由此显示候选级死因。
  for (const death of deaths) {
    warnings.push(`选题候选淘汰“${death.topicLabel}”：${describeTopicFailure(death)}`);
  }

  if (candidates.length >= CONSENSUS_CANDIDATE_POOL_SIZE) {
    return { data: candidates.slice(0, CONSENSUS_CANDIDATE_POOL_SIZE), warnings, deaths, usedFallback: false, needsManualReview: false, promptVersion: CONSENSUS_TOPIC_PROMPT_VERSION, schemaVersion: V2_SCHEMA_VERSION, promptCharCount: prompt.charCount };
  }
  if (candidates.length > 0) {
    warnings.push(`可用候选${candidates.length}个，少于候选池${CONSENSUS_CANDIDATE_POOL_SIZE}个；降级继续，不阻断任务。缺的方向：${CONSENSUS_TOPIC_DIRECTIONS.filter(dir => !candidates.some(c => c.direction === dir)).join('、') || '无'}`);
    return { data: candidates, warnings, deaths, usedFallback: false, needsManualReview: false, promptVersion: CONSENSUS_TOPIC_PROMPT_VERSION, schemaVersion: V2_SCHEMA_VERSION, promptCharCount: prompt.charCount };
  }

  // 3 候选全灭 → 保守兜底（零 AI 调用，仿 showcase_fallback 思路）
  const fallback = buildConservativeTopicFallback(input);
  const fallbackDeaths = diagnoseConsensusTopicCandidate(fallback, { ...ctx, recentTopics });
  if (fallbackDeaths.length === 0) {
    warnings.push(`3个候选全部不可用，已使用程序生成的保守兜底选题（零额外AI调用）：${fallback.topic}`);
    warnings.push('本选题为程序保守兜底，需人工复核后使用');
    return { data: [fallback], warnings, deaths, usedFallback: true, needsManualReview: true, promptVersion: CONSENSUS_TOPIC_PROMPT_VERSION, schemaVersion: V2_SCHEMA_VERSION, promptCharCount: prompt.charCount };
  }
  // 兜底也不成立 → 逐候选列死因（§3.4：禁止只写“选题阶段失败”）
  const lines = [
    ...deaths.map(death => `候选${death.index + 1}“${death.topicLabel}”：${describeTopicFailure(death)}`),
    `保守兜底选题“${fallback.topic}”：${fallbackDeaths.map(death => describeTopicFailure(death)).join('；')}`,
  ];
  throw new Error(`V2共识选题阶段失败，逐候选死因如下：\n${lines.join('\n')}`);
}

/** VersionedArtifact 包装（B2 接线时使用；B1 测试用它验证与现有管线工件结构兼容）。 */
export function wrapConsensusTopicArtifact(
  result: ConsensusTopicStageResult,
  inputHash: string,
  usage: AiUsageSummary,
  requestId: string,
): VersionedArtifact<ConsensusTopicOption[]> {
  return {
    data: result.data,
    schema_version: V2_SCHEMA_VERSION,
    prompt_version: CONSENSUS_TOPIC_PROMPT_VERSION,
    input_hash: inputHash,
    created_at: new Date().toISOString(),
    usage,
    warnings: result.warnings,
    request_id: requestId,
    needsManualReview: result.usedFallback ? true : undefined,
  };
}

export { getRecentTitleFingerprints };
