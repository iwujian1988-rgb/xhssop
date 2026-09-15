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
import type { BatchEditorialTask } from './batch-editorial-plan';
import { TOPIC_DEMAND_LABELS, inferTopicValueDefaults, isAbstractUserFacingValue, isTopicDemandType, isTopicGranularity, isTopicValueType, valueTypeIsCompatibleWithAsset, TOPIC_VALUE_TYPE_LABELS, type CrossExamGenericRisk, type DelfSpecificity, type SubpointRisk, type TopicDemandType, type TopicGranularity, type TopicValueType } from './topic-value';
import type { MarketTopicReference } from './market-topic-pool';

/**
 * 阶段 B1：商品1（delf_b2_writing）普通模式"共识选题"新分支。
 * 纯新文件，不接线：generateTopicOptions 入口 / route / page.tsx 均不引用本文件。
 * 唯一调用方是离线测试（scripts/test-v2-consensus-topic.mts）。
 * B2 接线获批后，本文件的类型才合并进 contracts.ts。
 */

export const CONSENSUS_TOPIC_PROMPT_VERSION = 'v2-topic-consensus-big-pain-asset-1';

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
    批量内容母题ID?: string;
    批量编辑任务单?: BatchEditorialTask;
    选题数量: number;
    选题方向: ConsensusTopicDirection[];
    选题来源?: 'market' | 'long_tail' | 'mixed';
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
  batchTopicSlotId?: string;
  batchEditorialTask?: BatchEditorialTask;
  /** 跨卡软规避文本（批量模式下传入上一批已选/近期角度）。 */
  recentAngles?: string[];
  /** 历史去重信息；缺省从 title-usage-store 读取。 */
  history?: ConsensusTopicHistoryInput;
  /** 5 块序列化字符上限（先测量 legacy prompt 后传入，= legacy × 1.3）。 */
  charBudget?: number;
  marketReferences?: MarketTopicReference[];
  topicSourceMode?: 'market' | 'long_tail' | 'mixed';
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
        role: '用两条简短的经验判断带出问题和下一步；只有输入有真实个人经历时才用第一人称',
        suitable: ['一个具体困境', '一个误区观察', '一组问题与建议'],
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
  const sectionRange = spec.sectionRange || [spec.sectionCount, spec.sectionCount];
  const itemRange = spec.itemRange || [spec.itemsPerSection, spec.itemsPerSection];
  const sectionText = sectionRange[0] === sectionRange[1] ? `${sectionRange[0]} 个分组` : `${sectionRange[0]} 到 ${sectionRange[1]} 个分组`;
  const itemText = itemRange[0] === itemRange[1] ? `每组 ${itemRange[0]} 条` : `每组 ${itemRange[0]} 到 ${itemRange[1]} 条`;
  return {
    封面名称: spec.name,
    封面作用: role.role,
    适合承载: role.suitable,
    内容形态: spec.family === 'experience'
      ? `正好 ${spec.itemsPerSection} 条完整的简短经验判断`
      : sectionRange[1] <= 1
      ? `${itemText}短条目`
      : `${sectionText}，${itemText}短条目，各组不必等量`,
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
  const marketOnly = input.topicSourceMode === 'market';
  const contract: ConsensusTopicContract = {
    商品身份: {
      商品名称: profile.noteIdentity,
      所属领域: profile.topicScopePrompt,
      商品能力: marketOnly ? [] : editorialMap.capabilities.map(cap => ({ 能力编号: cap.capabilityId, 能力: cap.capability, 支持模块: cap.modules })),
      已确认考试边界: marketOnly ? [] : examFacts.kept.map(item => ({ id: item.id, text: item.text })),
    },
    购买者地图: {
      用户阶段: marketOnly ? [] : editorialMap.buyerMap.userStages,
      真实状态: marketOnly ? [] : editorialMap.buyerMap.realStates,
      购买动机: marketOnly ? [] : editorialMap.buyerMap.motivations,
    },
    当前封面: marketOnly ? { 封面名称: '', 封面作用: '', 适合承载: [], 内容形态: '', 信息密度: '中', 不适合承载: [] } : deriveCoverContractForTopic(input.capability),
    历史去重信息: history,
    本次生成要求: {
      生成模式: input.mode || 'single',
      搜索词: keywords,
      用户补充方向: input.userDirection || '',
      ...(input.batchTopicSlotId ? { 批量内容母题ID: input.batchTopicSlotId } : {}),
      ...(input.batchEditorialTask ? { 批量编辑任务单: input.batchEditorialTask } : {}),
      选题数量: CONSENSUS_CANDIDATE_POOL_SIZE,
      选题方向: [...CONSENSUS_TOPIC_DIRECTIONS],
      选题来源: marketOnly ? 'market' : 'mixed',
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
    '真实市场参考优先：普通批次大致以市场题为主、长尾题为辅（约7:3，但不为凑比例生成垃圾）。Market Topic的生成顺序必须是“真实高表现Market Reference先决定用户为什么想点、内容入口和阅读形态 → 做直接邻近扩展或结构迁移 → 再与当前知识资产取交集检查能否真实写出”。知识库/商品能力只负责限制能不能写，不能从章节、模块、知识点、资料数量或课程能力表反推Market Topic。Market Reference不能只是挂在结果上的来源标签：公开Topic必须仍能看出它借用的市场母题（周期/路线、避坑、短期冲刺、在职、强度、资料选择、范文使用、评分理解、考前复习或现实预期等）。不能邻近时才借结构。输出topicSource=market或long_tail，并在marketReference中回填所借sourceTitle。没有真实作者经历时，只借结构，不得生成第一人称上岸结果。',
    '请遵守以下规则：',
    '1. 选题必须属于当前商品所属领域，但Market不能从知识库章节反推；先保留真实市场母题的阅读欲望与内容入口，再把落点限制在商品可支撑范围。',
    '2. 选题必须让目标用户看出“这和我有关”。',
    '3. 选题必须对应一个真实备考场景。',
    '4. 选题必须有具体内容可以展开，每个选题提供3到5条准备展开的内容。',
    '5. 选题必须能自然使用当前封面的内容形态。',
    '6. 封面不限制具体选题，但选题必须真正能产出当前封面要求的内容形态；不得把时间规划硬塞进短语表，也不得把泛建议冒充文档解析。',
    '7. 不要把商品模块名称直接当成选题。',
    '8. 不要把抽象口号当成选题。痛点必须是考生正在经历的具体状态，禁止使用抽象、机械、非真实用户口语的痛点表达，不得使用未经确认的抽象概括。',
    '9. 不要把过于细小的知识点包装成所有用户都会遇到的大痛点。一个批次可以有少量具体方法题，但不能成为三类方向反复换皮的中心。每个Market候选生成前先自问：它更像“A. 小红书用户会点进去看的整篇笔记主题”，还是“B. 课程目录里的一节课标题”？更像B就禁止作为Market，改用另一个市场母题或结构。DELF B2的Market Topic尤其必须保持写作备考的大入口，不能生成练习本每篇复盘、某一段展开、某一句替换、单个语法问题或单个检查动作；这些细颗粒度题目属于long_tail。',
    '10. 3个选题必须分别属于“大痛点型、省时路径型、具体方法型”三个不同方向，解决不同层次的需求，不能只是换几个词。大痛点型必须处理一整段备考链路的问题：练了却不知道有没有进步、资料很多但无法形成输出、考场从审题到交卷失控、复读后仍不知道短板、写完没有判断依据等；不能只拿一个词数或一个语法点充当大痛点。若某候选是market，先检查它是否保留了市场Reference的“大入口”；若只是“某知识点怎么整理/某资料有多少条/某类句法如何分类/某个动作怎么做”，即使知识库能写，也不能标记为market，应改为long_tail或换Reference。',
    '10a. 省时路径型优先做考场攻略、冲刺排雷、反常规但可解释的“邪修”技巧：明确指出该停掉什么低效动作、改用什么动作、适用于什么阶段。它可以有强反差和情绪，但不能靠玄学、虚构捷径或脱离写作能力的承诺吸引点击。',
    '10b. 具体方法型不要只盯一个极小知识点；优先做可交付的攻略、汇总、速查、题型总整理、错误类型对照、表达/观点/范文的使用地图。只有当前封面确实适合承载时，才回到单个细节；且本次三题中最多一题以词数、一个连接词或一个语法点为主。',
    '10c. 标准生产只做总问题型和常规大资产，不自动生产微型局部选题。总问题型必须能围绕同一个上层用户问题自然展开3到5个主要模块；资料型内容真实足够丰富时，可自然使用高频、万能、合集、速查、清单、论据库、模板库、考前整理等说法，但不得机械套“大全”、虚构数量或用资料名掩盖空内容。Market参考决定先写“备考周期/路线、避坑/无用功、短期冲刺、在职备考、学习强度、资料选择、范文使用、评分理解、考前复习、现实预期”等大入口，再把内容落点收束到当前商品范围；不得把“词汇句法分类、某文体流程、某段技巧、某个批改动作、几十/几百条资料或表达的分类清单”当作Market主选题。',
    '11. 普通模式允许AI原创解释、方法和例子，不要求每个选题都命中某个事实卡。',
    '12. 不能把商品没有的服务、资历或功能写成商品内容；商品承接依据只能引用输入“商品身份.商品能力”中列出的能力编号和支持模块，不得发明能力或模块名。',
    '13. 涉及考试规则、评分标准、题型要求、词数要求、格式要求、官方规定或商品实际包含内容时，只能使用输入中明确提供的信息（“已确认考试边界”与“商品能力”），不得自行编造、夸大或包装为确定事实。',
    '14. 一般性的学习方法、练习建议或表达示例可以由AI原创，但不能包装成官方规定或确定事实。',
    '15. 省时路径型只能表达少走弯路、更快理清重点、明确先后顺序、缩小复习范围等收益；不能承诺一定提分、一定通过，不能暗示短期资料可以替代持续练习。',
    '16. 不生成最终文字标题，不生成最终封面标题，不生成正文；“选题名称”是工作名称，不是发布标题。',
    '17. 只输出选题策划结果：一个合法JSON对象，顶层字段“选题列表”，恰好包含3个选题对象，不添加解释文字。',
    // 以下为从既有 TOPIC prompt 只读提取的三类硬禁忌（跨商品词不逐词列出，交给商品身份.scope 规则）。
    `18. 禁止跨商品：${profile.topicScopePrompt}`,
    productId === 'delf_b2_writing'
      ? '18a. DELF B2的Market范围只在写作知识库可支撑的内容内：写作整体备考、周期/路线、短期冲刺、资料/范文、评分标准、训练方式、避坑、在职时间安排、观点论据、模板/句法/词汇/自查等大入口。市场参考若主体是听力、阅读或口语，只有在自然迁移为写作且当前资产能支撑时借结构，否则跳过；不要把它们直接写成Topic。'
      : '18a. TCF Market保持多模块范围，继续允许整体备考、听力、阅读、写作、口语、工具/题库、刷题、报名、考场、真题、复盘和时间规划等真实市场入口。',
    '18b. Market参考不是装饰，也不是从商品能力表挑一个能写的知识点后再包装；每个Market候选都必须能指出它借用了哪条真实参考的用户点击动机或内容形态。具体T1/T2/T3、Part1/Part2、单个语法或单个评分维度可以作为Inner内页展开，但默认不是Market Topic本身。',
    '19. 本商品写作官方评分是5个维度按表现档位评分，不是按错误逐项扣分；禁止把选题设计成“考官逐条扣分、每错一项扣几分、扣分表”一类角度。',
    '20. 禁止在用户可见文本中使用内部资料编号或模块ID；支持模块名只能出现在“商品承接依据”字段里。',
    '21. “本篇说话动作”和“开头情绪起势”各写一句原创表达，不得与历史去重信息中的表达方向重复。',
    '22. 历史去重信息中的最近选题是硬排除项：不能只换标题措辞。若新候选与历史使用同一个用户痛点和同一种解决机制，必须改换痛点、内容对象或解决机制，形成新的因果组合。三个候选彼此也不得使用同一痛点和同一解决机制。',
    '23. 本次生成要求若含“批量编辑任务单”，它是总编辑给本卡的上游硬路由：3个候选都必须执行其中的核心问题、内容对象和解决机制，不能回到其他常见热点；任务单无需在输出中复述。旧路径若含【本批唯一内容母题】才按该母题生成。',
    '24. 每个选题必须增加一个小红书内容价值类型 valueType：' + Object.entries(TOPIC_VALUE_TYPE_LABELS).map(([id, label]) => `${id}=${label}`).join('；'),
    '25. specificAsset 必须回答用户点开后具体看到什么；userGain、clickReason、saveReason 必须写具体获得感，不能只写提升能力、稳定节奏、焦虑迷茫等抽象话。valueType 与 specificAsset 必须匹配。',
    '26. 做DELF B2专属性判断：delfSpecificity=high/medium/low；crossExamGenericRisk=low/medium/high。threeSecondValueCheck 只有在2到3秒能说清具体载体时才能为true。',
    '27. demandType 判断用户是在找资料、找捷径、纠偏、避坑、解决问题、备考重点还是找对比，不要默认所有选题都从pain出发。可选值：' + Object.entries(TOPIC_DEMAND_LABELS).map(([id, label]) => `${id}=${label}`).join('；'),
    '28. topicGranularity 必须为level_1_asset（总问题型：一个上层用户问题，可自然拆为3到5个主要模块）、level_2_strategy（常规大资产：一项宽而完整、可反复使用的写作任务或资料）或level_3_micro（仅兼容历史局部技巧）。标准生产优先且只自动分配前两类；subpointRisk 判断是否只是正文bullet。',
    '29. 只有真正存在“很多人以为A，但实际上B”的认知纠偏才填existingBelief/counterBelief；普通技巧不得标记insight。资料型、纠偏型、备考型和对比型不必虚构pain。',
    '每个选题对象必须使用这些中文键：选题方向、选题名称、对应的用户真实状态、用户使用场景、用户真正想得到的结果、这篇内容准备解决什么、准备展开的内容（数组）、商品承接依据（对象：能力编号、支持模块；能力编号只填一个，逐字复制商品能力表中的编号，不要合并多个编号）、为什么适合当前封面、用户为什么可能点击、本篇说话动作、开头情绪起势、是否可能与历史选题重复、valueType、specificAsset、userGain、clickReason、saveReason、delfSpecificity、threeSecondValueCheck、crossExamGenericRisk、demandType、topicGranularity、subpointRisk、existingBelief、counterBelief、publicTopicNaturalness。字段要简洁，但不能留空；痛点字段在非improvement_need需求中可以为空。',
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
  const slotPreamble = input.batchEditorialTask
    ? '最高优先级：下面的“批量编辑任务单”由总编辑锁定。只执行它的核心问题、内容对象和解决机制；不要自行换成其他常见 DELF 痛点。任务单由程序绑定，禁止为了格式复述或编造任务 ID。\n'
    : input.batchTopicSlotId
      ? `最高优先级：本卡只允许生成母题ID=${input.batchTopicSlotId} 的内容。\n`
      : '';
  const userPreamble = `${slotPreamble}${input.topicSourceMode === 'market' ? '本次只生成Market Topic：每条必须先对应一条真实Market Reference，再做直接邻近或结构迁移；知识资产仅用于最后的写作范围检查。若不能生成合格Market Topic，宁可少返回，不得改成long_tail或课程章节题。\n' : ''}请根据以下5块信息，生成${CONSENSUS_CANDIDATE_POOL_SIZE}个普通模式的小红书选题（3个方向各1个）。\n`;
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
  const marketBlock = input.marketReferences?.length
    ? `\n真实市场参考（只借选题母题；不得伪造其中的第一人称经历）：${JSON.stringify(input.marketReferences.slice(0, 20))}`
    : '';
  // 先给真实市场母题，再给商品能力/知识资产：前者决定用户为什么想点，后者只做可写性边界检查。
  const user = `${userPreamble}${marketBlock}\n${JSON.stringify(finalContract, null, 0)}`;
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
  '本篇说话动作', '开头情绪起势', '是否可能与历史选题重复', 'topicSource', 'marketReference',
  'valueType', 'value_type', '具体内容载体', 'specificAsset', 'specific_asset', '用户看完能拿走什么', 'userGain', '点击理由', 'clickReason', '收藏理由', 'saveReason', 'delfSpecificity', 'delf_specificity', 'threeSecondValueCheck', 'three_second_value_check', 'crossExamGenericRisk', 'cross_exam_generic_risk',
  'demandType', 'demand_type', 'topicGranularity', 'topic_granularity', 'subpointRisk', 'subpoint_risk', 'existingBelief', 'existing_belief', 'counterBelief', 'counter_belief', 'publicTopicNaturalness', 'public_topic_naturalness',
  '批次内容母题ID',
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
  batchTopicSlotId?: string;
  batchEditorialTask?: BatchEditorialTask;
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
  const returnedSlotId = clean(pick(raw, ['批次内容母题ID', 'batchTopicSlotId']));
  // 新的总编辑任务单由程序按“卡片 × 名额”直接绑定；不能让模型是否抄对一个
  // 内部 ID 决定整条内容能否生产。旧 slot 路径没有任务单时才保留回传 ID。
  if (!ctx.batchEditorialTask && ctx.batchTopicSlotId && returnedSlotId !== ctx.batchTopicSlotId) {
    return { candidate: null, death: { code: 'batch_slot_mismatch', detail: `要求母题 ${ctx.batchTopicSlotId}，AI回传 ${returnedSlotId || '空'}` }, warnings };
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
    // 实测（batch_1787325885084 / job_003）：AI 会把多个真实能力编号写进一个字段
    // （「cap-topic-ideas, cap-syntax-library」），整串等值匹配必然失配，拼出的
    // productBridge 为空再被 missing_product_bridge 硬杀，3 候选全灭走兜底。
    // 这里按分隔符拆 token 逐个对表匹配，任一命中即取第一个命中项做 canonical
    // 编号并回填真实能力描述；全部不命中时不回填——空承接照旧被硬拦，
    // 防编造商品能力的闸门不能为了降低失败率而放松。
    const rawCapabilityValue = pick(record, ['能力编号', 'capabilityId']);
    const rawCapabilityId = Array.isArray(rawCapabilityValue)
      ? rawCapabilityValue.map(item => clean(item)).filter(Boolean).join(', ')
      : clean(rawCapabilityValue);
    const matchedCapability = rawCapabilityId
      .split(/[,，、;；/\/\s]+/)
      .map(token => ctx.editorialCapabilities.find(cap => cap.capabilityId === token))
      .find((cap): cap is EditorialCapability => Boolean(cap));
    const capabilityId = matchedCapability ? matchedCapability.capabilityId : rawCapabilityId;
    const modules = uniqueStrings(pick(record, ['支持模块', 'modules', 'supportModules']), 6);
    if (capabilityId || modules.length) {
      bridgeBasis = { capabilityId, modules };
      const capabilityText = matchedCapability?.capability
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
  const defaults = inferTopicValueDefaults({ topic: topicName, promise: desiredResult, contentAngle: solveWhat });
  const valueTypeRaw = pick(raw, ['valueType', 'value_type', '内容价值类型']);
  const valueType = isTopicValueType(valueTypeRaw) ? valueTypeRaw : defaults.valueType;
  const specificAsset = clean(pick(raw, ['specificAsset', 'specific_asset', '具体内容载体'])) || defaults.specificAsset;
  const userGain = clean(pick(raw, ['userGain', '用户看完能拿走什么'])) || desiredResult;
  const clickReason = clean(pick(raw, ['clickReason', '点击理由'])) || clean(softValues.clickReason);
  const saveReason = clean(pick(raw, ['saveReason', '收藏理由'])) || `内容包含${specificAsset}，方便下次写作前查用`;
  const delfSpecificity = ['high', 'medium', 'low'].includes(String(pick(raw, ['delfSpecificity', 'delf_specificity'])))
    ? pick(raw, ['delfSpecificity', 'delf_specificity']) as DelfSpecificity : /DELF|法语|B2|正式信|论坛|essai|连接词|法语表达/i.test(`${topicName} ${solveWhat}`) ? 'high' : 'medium';
  const crossExamGenericRisk = ['low', 'medium', 'high'].includes(String(pick(raw, ['crossExamGenericRisk', 'cross_exam_generic_risk'])))
    ? pick(raw, ['crossExamGenericRisk', 'cross_exam_generic_risk']) as CrossExamGenericRisk : delfSpecificity === 'high' ? 'low' : 'medium';
  const threeSecondValueCheck = pick(raw, ['threeSecondValueCheck', 'three_second_value_check']) === true || defaults.threeSecondValueCheck;
  if (!isTopicValueType(valueTypeRaw)) warnings.push(`候选${index + 1}缺少合法valueType，按内容推断为${valueType}`);
  if (isAbstractUserFacingValue(specificAsset) || !valueTypeIsCompatibleWithAsset(valueType, specificAsset)) warnings.push(`候选${index + 1}的具体内容载体与价值类型不够匹配，已记录提醒`);
  const demandTypeRaw = pick(raw, ['demandType', 'demand_type']);
  const demandType = isTopicDemandType(demandTypeRaw) ? demandTypeRaw : 'improvement_need' as TopicDemandType;
  const topicGranularityRaw = pick(raw, ['topicGranularity', 'topic_granularity']);
  const topicGranularity = isTopicGranularity(topicGranularityRaw) ? topicGranularityRaw : 'level_2_strategy' as TopicGranularity;
  const subpointRisk = ['low', 'medium', 'high'].includes(String(pick(raw, ['subpointRisk', 'subpoint_risk'])))
    ? pick(raw, ['subpointRisk', 'subpoint_risk']) as SubpointRisk : 'medium';
  const existingBelief = clean(pick(raw, ['existingBelief', 'existing_belief']));
  const counterBelief = clean(pick(raw, ['counterBelief', 'counter_belief']));
  const publicTopicNaturalness = pick(raw, ['publicTopicNaturalness', 'public_topic_naturalness']) !== false;
  const topicSource = pick(raw, ['topicSource', 'topic_source']) === 'market' ? 'market' as const : 'long_tail' as const;
  const marketReferenceRaw = pick(raw, ['marketReference', 'market_reference']);
  const marketReference = marketReferenceRaw && typeof marketReferenceRaw === 'object'
    ? { ...(marketReferenceRaw as MarketTopicReference), sourceTitle: clean((marketReferenceRaw as Record<string, unknown>).sourceTitle) }
    : undefined;
  if ((valueType === 'insight' || demandType === 'misconception_correction') && (!existingBelief || !counterBelief)) warnings.push(`候选${index + 1}反常识依据不完整，缺existingBelief或counterBelief`);

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
    clickReason,
    speechAction: softValues.speechAction,
    openingEmotion: softValues.openingEmotion,
    duplicateWithHistory: duplicateRaw === true || duplicateRaw === 'true' || undefined,
    valueType, specificAsset, userGain, saveReason, delfSpecificity, threeSecondValueCheck, crossExamGenericRisk,
    demandType, topicGranularity, subpointRisk, existingBelief, counterBelief, publicTopicNaturalness, topicSource,
    ...(topicSource === 'market' && marketReference?.sourceTitle ? { marketReference } : {}),
    batchTopicSlotId: ctx.batchEditorialTask?.taskId || returnedSlotId || undefined,
    batchEditorialTask: ctx.batchEditorialTask,
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
  'product_showcase_mode_mismatch',
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
  const fallbackCapability = editorialMap.capabilities[editorialMap.capabilities.length - 1];
  const goal = input.capability.allowedGoals.includes('save') ? 'save' : input.capability.allowedGoals[0] || 'click';
  const fallbackByFamily: Record<TemplateCapability['family'], {
    topic: string;
    audienceState: string;
    scene: string;
    painOrDesire: string;
    promise: string;
    contentAngle: string;
    expandContents: string[];
    clickReason: string;
    speechAction: string;
    openingEmotion: string;
    coverFitReason: string;
  }> = {
    experience: {
      topic: `${profile.noteIdentity}练了不少，换题还是不会写？`,
      audienceState: '正在练习但每次写完都不知道该改哪一处的考生',
      scene: '写完一篇练习作文、准备回看问题时',
      painOrDesire: '练了不少，却找不到最常犯的问题，下一次还是从头乱改',
      promise: '用两个具体判断帮考生看清练习卡在哪里，以及下一次先改什么',
      contentAngle: '用具体困境和对应判断，解释练习为什么没有转化成写作能力',
      expandContents: ['写完后先记下最卡的一处', '下一次只改一个具体问题', '连续复盘同一类错误，观察是否真的减少'],
      clickReason: '用户练了不少却不知道问题在哪，想知道下一次落笔前该先看什么',
      speechAction: '把“我怎么又卡了”拆成一个下次能检查的具体动作',
      openingEmotion: '每次都觉得自己练过了，真正落笔还是不知道从哪开始。',
      coverFitReason: '两条具体经验判断直接落在极简经验长图的承载范围内，不伪装成资料目录。',
    },
    phrase: {
      topic: `${profile.noteIdentity}正式写作总在重复同一批表达？先分清使用场景`,
      audienceState: '知道一些法语表达但写作时总想不起该用哪一个的考生',
      scene: '写正式信或观点段落、需要快速替换表达时',
      painOrDesire: '表达记住了却不会按语境调用，写出来重复又生硬',
      promise: '按表达功能和使用场景整理可直接替换的短语',
      contentAngle: '把相近表达按功能分组，并用短例子说明什么时候用',
      expandContents: ['按观点、原因、转折等功能分组', '给出相近表达的使用区别', '用短例句展示替换后的语气'],
      clickReason: '用户不是没有背表达，而是不知道写到某个场景时该选哪一个',
      speechAction: '把“这个词到底怎么用”变成一张能直接对照的表达表',
      openingEmotion: '背过的表达一到作文里就混在一起，写完还是那几句。',
      coverFitReason: '内容是可分组的短语和搭配，适合短语密表或词卡类封面。',
    },
    flashcard: {
      topic: `${profile.noteIdentity}写作常用表达，按场景分组更好记`,
      audienceState: '想记住一组能直接用于写作的同类法语表达的考生',
      scene: '复习词汇、准备把表达放进作文时',
      painOrDesire: '零散记词容易混，到了作文里又想不起怎么用',
      promise: '把同类表达按场景分成小组，复习时可以直接对照',
      contentAngle: '用同类词卡展示表达、中文含义和最短用法提示',
      expandContents: ['按同一场景挑选同类表达', '补上最短中文含义', '标出适合写作的使用提醒'],
      clickReason: '用户需要的是能在写作现场想起来的成组表达，而不是继续背散词',
      speechAction: '把容易混的表达放在一起，复习时直接对照',
      openingEmotion: '单词背过一遍，真正写作文时还是想不起怎么放进去。',
      coverFitReason: '内容天然是同类词卡和极短用法提示，适合词卡封面。',
    },
    table: {
      topic: `${profile.noteIdentity}常用词总是选不准？按主题对照更快`,
      audienceState: '想把法语写作词汇按主题整理、写作时快速查找的考生',
      scene: '复习主题词汇、写作文前查找替换表达时',
      painOrDesire: '词汇零散、近义表达容易混，写作时查不到合适的词',
      promise: '按主题和使用场景整理一张可直接查阅的词汇对照表',
      contentAngle: '用主题分组、法语词和短中文解释组成可查的资料页',
      expandContents: ['按写作场景分主题', '列出完整法语词或短搭配', '补上短中文解释和使用提醒'],
      clickReason: '用户在写作时需要的是快速找到合适表达，而不是一份泛泛词汇资料',
      speechAction: '把容易混的词放到同一张表里，写作前一眼对照',
      openingEmotion: '想换个词写得更自然，结果翻了半天还是不知道选哪个。',
      coverFitReason: '主题词、短搭配和中文解释可以组成高密度对照表。',
    },
    roadmap: {
      topic: `${profile.noteIdentity}复习顺序怎么排？从会写到会检查`,
      audienceState: '时间有限、想知道写作复习先后顺序的考生',
      scene: '安排一轮备考计划、准备从练习进入限时写作时',
      painOrDesire: '每个环节都想练，结果没有清晰顺序，时间被反复试错耗掉',
      promise: '按阶段说明先练什么、再练什么，以及每一步如何检查',
      contentAngle: '把写作练习拆成连续阶段，每阶段给目标、动作和可检查结果',
      expandContents: ['先确定题型和任务要求', '再练结构和表达调用', '最后做限时写作与复盘'],
      clickReason: '用户缺的不是更多资料，而是一条知道下一步做什么的复习路径',
      speechAction: '把“我该先练什么”排成一条能照着走的路径',
      openingEmotion: '资料越攒越多，真正开始复习时反而不知道先做哪一步。',
      coverFitReason: '连续阶段、任务和检查结果正好适合流程图或学习路径封面。',
    },
    document: {
      topic: `${profile.noteIdentity}正式信开头总卡？用原句对照不同写法`,
      audienceState: '看得懂范文但不会把句式迁移到新题的考生',
      scene: '练习正式信、需要根据题目快速写出开头和过渡时',
      painOrDesire: '记住了句子，却不知道换一个写信目的后怎么改',
      promise: '用原句、中文解释和可迁移场景对照说明写法差异',
      contentAngle: '展示素材原句并拆解它在不同写作任务中的功能',
      expandContents: ['标出原句承担的写作功能', '对照不同场景下的替换表达', '说明哪些部分可以迁移、哪些必须改'],
      clickReason: '用户卡在的不是看不懂范文，而是不会把范文里的功能迁移到新题',
      speechAction: '把一句范文拆开，看清它到底在完成什么任务',
      openingEmotion: '范文每句都看得懂，换到自己的题目里还是不知道怎么写。',
      coverFitReason: '原句、解释和迁移对照适合文档素材解析类封面。',
    },
    book: {
      topic: `${profile.noteIdentity}写作从审题到交卷，整理一份实用手册`,
      audienceState: '想把零散写作知识串成完整方法的备考考生',
      scene: '整理一轮复习资料、需要从审题练到交卷检查时',
      painOrDesire: '资料看了很多，但每次写作仍然要重新摸索流程',
      promise: '把审题、结构、表达和交卷自查串成一套可复习的手册',
      contentAngle: '以专题小册子的结构概括核心主题和使用步骤',
      expandContents: ['先看任务和题型要求', '再搭段落和表达', '最后按检查项复盘'],
      clickReason: '用户需要把零散知识串起来，形成写作时能调用的完整方法',
      speechAction: '把散落在各处的写作要点收成一条能翻回去看的路径',
      openingEmotion: '资料存了一堆，真正写的时候还是每一步都要重新想。',
      coverFitReason: '专题手册可以承载完整主题、章节和使用路径。',
    },
    pain: {
      topic: `${profile.noteIdentity}练了很久，为什么写出来还是不自然？`,
      audienceState: '已经练过一段时间、但写完仍觉得句子别扭的考生',
      scene: '写完作文回看、发现语法没大错却读起来不顺时',
      painOrDesire: '花了时间练习，却不知道不自然到底出在词、句子还是组织方式',
      promise: '指出最容易让表达变生硬的具体做法，并给出替换方向',
      contentAngle: '用三条短判断呈现现状、反差和解决方向',
      expandContents: ['先指出最常见的生硬表现', '解释它为什么会让句子不自然', '给出下一次改写时先看的一处'],
      clickReason: '用户已经练了却看不出问题在哪，想知道那种“不自然感”从哪里来',
      speechAction: '把“读起来怪”落到一个具体可改的动作上',
      openingEmotion: '语法看着没错，整篇读下来就是有点不像自己会说的话。',
      coverFitReason: '一个具体痛点、反差判断和解决方向适合痛点大字封面。',
    },
    offer: {
      topic: `${profile.noteIdentity}资料怎么用？先按问题找到对应模块`,
      audienceState: '资料已经到手但不知道从哪个模块开始用的考生',
      scene: '准备复习或写完作文、想针对薄弱环节查资料时',
      painOrDesire: '资料很多，遇到具体问题时仍然要到处翻找',
      promise: '按常见问题说明该看哪一类内容、怎么开始使用',
      contentAngle: '用适合人群、使用场景和资料模块说明实际用法',
      expandContents: ['先判断自己卡在什么问题', '找到对应的资料模块', '用一个小任务开始复习'],
      clickReason: '用户买到资料后最怕不会用，想知道遇到问题该从哪里翻起',
      speechAction: '把“资料很多但不会用”变成清楚的查找路径',
      openingEmotion: '资料拿到了，真正开始用时还是不知道先翻哪一页。',
      coverFitReason: '适合谁、解决什么和怎么用正是方案说明类封面的三块内容。',
    },
    directory: {
      topic: `${profile.noteIdentity}写作常见问题，按题型和检查顺序整理`,
      audienceState: '写完作文后想系统检查、又不知道从哪里开始的考生',
      scene: '复盘练习作文、准备考前集中查漏补缺时',
      painOrDesire: '问题很多但没有分类，检查时容易漏掉同一类错误',
      promise: '按题型、问题类型和检查顺序整理成一页可反复对照的资料',
      contentAngle: '把知识点分组并做成高密度目录，让用户能按问题查找',
      expandContents: ['按题型分组常见问题', '按错误类型放入短知识点', '最后给出交卷前检查顺序'],
      clickReason: '用户需要的是按问题快速查找的资料体系，而不是又一篇泛泛讲解',
      speechAction: '把散落的问题分好类，写完后按顺序查一遍',
      openingEmotion: '作文写完总觉得漏了什么，真正检查时又不知道先看哪一项。',
      coverFitReason: '多组知识点、题型分类和检查顺序适合高密度目录封面。',
    },
  };
  const familyBase = fallbackByFamily[input.capability.family] || fallbackByFamily.directory;
  const rendererFallbacks: Partial<Record<TemplateCapability['renderer'], Partial<typeof familyBase>>> = {
    criminal_law_formula: {
      topic: `${profile.noteIdentity}论证段怎么写？10条结构公式直接自查`,
      contentAngle: '把审题、立场、理由、例子、让步、衔接和结尾整理成写作结构公式与检查动作',
      expandContents: ['按段落功能列结构公式', '每条公式补一个执行动作', '最后按任务完成度和语言检查'],
      coverFitReason: '内容是10条写作结构公式，符合红黑编号公式清单的承载方式。',
    },
    english_grammar_grid: {
      topic: `${profile.noteIdentity}语法总出错？12格整理时态、语式和代词`,
      contentAngle: '把时态、语式、代词、关系词、连接与语域规则拆成12个互不重复的语法速记模块',
      expandContents: ['按时态与语式分格', '补充代词和关系词规则', '加入连接与正式语域提醒'],
      coverFitReason: '12个语法规则模块与三列语法格一一对应。',
    },
    english_grammar_notebook: {
      topic: `${profile.noteIdentity}语法易错点，按规则和短例句做成手账口诀`,
      contentAngle: '整理时态、语式、代词、关系词、连接和一致配合等语法易错规则与短例句',
      expandContents: ['每条写一个语法点', '补充准确规则和短例句', '按写作自查顺序排列'],
      coverFitReason: '语法点、规则和短例句适合手账式语法口诀封面。',
    },
    mao_article_notes: {
      topic: `${profile.noteIdentity}主题素材怎么迁移？用原句做一页范文精读`,
      contentAngle: '选择完整法语原句，逐条解析观点、段落功能和可迁移写法',
      expandContents: ['保留完整法语原句', '解释原句承担的论证功能', '给出更换主题后的迁移方向'],
      coverFitReason: '原句、解析与迁移提示符合手写素材精读的组织方式。',
    },
    french_oral_question_bank: {
      topic: `${profile.noteIdentity}同主题追问题库：从立场问到解决方案`,
      contentAngle: '围绕一个DELF写作或法语口语主题生成完整问题、追问与准确中文翻译',
      expandContents: ['先问个人立场', '再追问原因和影响', '最后追问解决方案与限制'],
      coverFitReason: '完整法语问题和中文翻译可以组成双语题库长清单。',
    },
    french_a1_practice_sheet: {
      topic: `${profile.noteIdentity}一个观点如何展开？用四个维度拆成资料页`,
      contentAngle: '把每个核心观点拆成原因、影响、例子和限制四个并列佐证或检查维度',
      expandContents: ['每个主项只写一个观点', '为观点补四个并列维度', '维度保持短而具体'],
      coverFitReason: '一个主项加四个并列支项符合四项拆解资料页的承载方式。',
    },
  };
  const family = { ...familyBase, ...(rendererFallbacks[input.capability.renderer] || {}) };
  return {
    id: `consensus_fallback_${input.card.id}_${stableHash(input.productId)}`,
    productId: input.productId,
    templateId: input.capability.renderer,
    primaryGoal: goal,
    topicLane: DIRECTION_LANES.省时路径型,
    topic: family.topic,
    audienceState: family.audienceState,
    scene: family.scene,
    painOrDesire: family.painOrDesire,
    promise: family.promise,
    contentAngle: family.contentAngle,
    plannedBlockKind: input.capability.acceptedBlockKinds[0],
    productBridge: fallbackCapability.capability,
    seo: { primary: profile.noteIdentity, related: [] },
    knowledgeMode: 'mixed',
    factTerms: fallbackCapability.modules.slice(0, 8),
    seedSignals: ['consensus-fallback'],
    noveltyFingerprint: `consensus-fallback|${input.card.id}|${input.productId}`,
    direction: '省时路径型',
    expandContents: family.expandContents,
    bridgeBasis: { capabilityId: fallbackCapability.capabilityId, modules: fallbackCapability.modules },
    coverFitReason: family.coverFitReason,
    clickReason: family.clickReason,
    speechAction: family.speechAction,
    openingEmotion: family.openingEmotion,
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
    batchTopicSlotId: input.batchTopicSlotId,
    batchEditorialTask: input.batchEditorialTask,
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

  if (input.batchTopicSlotId) {
    warnings.push(`母题 ${input.batchTopicSlotId} 的候选均未按要求回传，跳过本卡，未使用兜底题污染批量主题`);
    return { data: [], warnings, deaths, usedFallback: false, needsManualReview: true, promptVersion: CONSENSUS_TOPIC_PROMPT_VERSION, schemaVersion: V2_SCHEMA_VERSION, promptCharCount: prompt.charCount };
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
