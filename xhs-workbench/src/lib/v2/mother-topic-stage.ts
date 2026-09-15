import { callOpenAICompatibleJsonWithUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import type { ProductId } from '@/types/data';
import type { TopicCoordinate } from './topic-coordinate-taxonomy';
import { isTopicValueType, type TopicDemandType, type TopicValueType } from './topic-value';

export interface MotherTopicInput {
  taskId: string;
  domainId: TopicCoordinate['domainId'];
  demandType: TopicDemandType;
}

export interface MotherTopic {
  taskId: string;
  topic: string;
  motherTopicRationale: string;
  proposedSubtopics: string[];
  motherTopicScore: number;
  valueType: TopicValueType;
  topicScope: 'mother' | 'subtopic' | 'micro';
  xhsMotherTopicFit: 'strong' | 'acceptable' | 'course_like' | 'micro';
  xhsEditorialFit: 'strong' | 'acceptable' | 'course_like' | 'weak';
  courseLanguageRisk: 'low' | 'medium' | 'high';
  demandValueMismatch: boolean;
  existingBelief: string;
  counterBelief: string;
  subpointRisk: 'low' | 'medium' | 'high';
}

type RawResponse = { motherTopics?: Array<Record<string, unknown>> };

export const MOTHER_PROBLEM_FAMILY_LABELS: Record<TopicCoordinate['domainId'], string> = {
  task_decoding: '任务理解与审题能力',
  idea_generation: '观点生成与选题储备',
  argument_development: '论证展开与观点深度',
  evidence_examples: '例子、证据与具体化',
  structure_cohesion: '文章结构与整体衔接',
  register_genre: '文体、语域与任务类型',
  grammar_accuracy: '语法能力与表达调用',
  lexical_precision: '词汇选择与表达精度',
  revision_feedback: '全文修改与自我诊断',
  exam_execution: '考场执行与时间管理',
  study_strategy: '备考路径与训练安排',
  material_transfer: '范文、资料与表达迁移',
  confidence_rebuild: '写作信心与稳定输出',
};

export async function generateMotherTopics(
  productId: ProductId,
  inputs: MotherTopicInput[],
  options: { acceptBelowThreshold?: boolean } = {},
): Promise<{ topics: MotherTopic[]; usage: AiUsageSummary; warnings: string[]; failedTopics: Array<{ taskId: string; reason: string }> }> {
  if (productId !== 'delf_b2_writing') throw new Error('Mother Topic 当前只用于 DELF B2 写作');
  // Model-facing IDs are deliberately opaque. Card/resource/renderer names stay
  // inside the orchestrator and cannot bias the topic selected by the model.
  const aliasedInputs = inputs.map((input, index) => ({ input, modelTaskId: `task_${String(index + 1).padStart(3, '0')}` }));
  const macroInputs = aliasedInputs.map(({ input, modelTaskId }) => ({
    taskId: modelTaskId,
    product: 'DELF B2 writing',
    domain: input.domainId,
    problemFamily: MOTHER_PROBLEM_FAMILY_LABELS[input.domainId],
    demandType: input.demandType,
    targetGranularity: 'mother_topic',
  }));
  const system = [
    '你是 DELF B2 写作账号的小红书总编辑。当前只生成值得单独发布、用户刷到会想点开和收藏的一级 XHS Mother Topic，不是课程章节名、教研专题名、公众号长文标题或知识体系目录。',
    '本阶段是母题决策阶段，禁止接收、猜测或补写 mechanism、object、scene、sceneId、connector、revision action、specificAsset、expandContents、示例和任何句子级技巧。',
    '只根据 product、domain、problemFamily、demandType、valueType 生成选题。标准生产只生成两档：约60%是面对上层用户问题的总问题型母题，约40%是宽而完整、可反复使用的常规大资产。不要生成微型长尾题。',
    '总问题型优先处理考生反复遇到、会影响整篇写作或一段完整备考流程的问题，例如怎么准备、不会展开怎么办、从审题到交卷怎么做、考前复习什么；常规大资产应覆盖一项完整任务，例如论据素材、正式信语气与表达、审题定位、论证展开、结构、失分自查或时间管理。',
    '单个连接词、单个词、单个句型、单个敬语、单个格式点、单个段落或单一题目只能成为内页内容，不能成为公开选题；也不能靠增加条数或套上“大全/素材库/高分”包装成大题。',
    '优先写用户视角的大选题：宝藏资料/大整理、反常识纠偏、高分关键、全流程一次搞懂、考前决策。大不是泛：它必须能自然撑起3到6个彼此有新增价值的页面，并且所有页面仍在解决同一个核心问题。要让人一眼知道“我能拿到一整套什么”或“我是不是一直做错了”。',
    '每个公开 topic 至少要有一个小红书点击理由：明确的整理获得感（汇总/整理/清单/一次讲清/值得背）或真实认知冲突（真的不要再/不是越多越好/为什么总像B1/到底看什么）。只写“X的机制/体系/策略/路径/方法”而没有用户动作或获得感，视为不合格。',
    'ONE HOOK RULE：如果标题前半句单独已经让人想点，就立即停止，不要为了显得完整再加课程式尾巴。尤其不要把“真的不要再背整篇模板了”“B2写作不是词越高级越好”“为什么你的B2作文总像B1？”改成带“方法/策略/自然之道/关键跃迁/正确姿势”的两段式标题；答案放进 proposedSubtopics。',
    '资料整理型在内容确实足够丰富时，可以自然使用万能、高频、大全、合集、速查、清单、模板库、论据库、资料包、通关包、一图看懂、一次整理、直接拿走、考前整理等资产感表达；它们不是天然低质量词，也不能代替真实内容。不要把所有题都机械写成“XX大全/XX通关包”。',
    'proposedSubtopics 允许使用本篇会实际交付的内部结构数字，例如3个常见误区、5项交卷自查、4类功能表达、6组改写对照；数字必须对应本篇真实规划的项目，后续 Page Plan 和 Final Content 应尽量完整兑现，不能只把数字当点击装饰。',
    '允许假设性案例、模拟情境和为教学设计的具体例子；但输入没有来源时，不要把“72%的考生、某研究显示”等纯虚构统计包装成已经发生的真实调查或研究事实。Mother Topic 阶段不把“X%考生、阅卷人最看重X类、会被扣X分、前X分钟必须、官方要求、高频出现率、某表达用了就会扣分”等营销或考试表述设为禁止项或失败条件；这些表达暂时允许生成，后续再结合最终成品判断。',
    '生成每条后再问一次：即使 topic 本身不写“清单/大全/资料库”，它做成笔记后是否天然能在封面和内容页展示多个具体内容块，让用户产生“里面东西很多，值得收藏”的感觉？优先保留这种可资产化潜力高的主题。例如“考前最后一周到底看什么”可以自然展开审题、结构、表达、主题素材和自查，本身不必改名为通关包。',
    '纠偏/洞察型优先用不要、真的不是、为什么、很多人一直；考前决策型优先用到底、最后一周、该看什么。明显课程型的“从零基础到高分训练路径、阶段规划、训练体系”应降级，不要仅因范围很大就当作优质小红书母题。',
    'existingBelief/counterBelief 只有 misconception_correction 或 insight 才必须填写；comparison_seeking、mistake_avoidance 按真实语义填写；asset_seeking、collection、exam_preparation、shortcut_seeking、improvement_need 默认可为空，禁止为了完整虚构用户原本的信念。',
    'demandType 和 valueType 必须描述这句话真正的点击理由，不能为了批次配额互相覆盖：例如“不是词越高级越好”优先是 misconception_correction/insight；“不要再背整篇模板”也是 misconception_correction 或 insight，不要因为它提供捷径就改成 shortcut_seeking。',
    '优先参考这些公开表达：DELF B2高频主题万能观点素材汇总；DELF B2正式信开头、称呼、结尾一次整理；B2写作高频连接词按功能整理；DELF B2真的不要再背整篇模板了；B2写作不是词越高级越好；DELF B2写作考前最后一周到底看什么；为什么你的B2作文总像B1？',
    '优先使用考生会搜索和理解的自然说法，例如“高频观点素材汇总”“正式信开头、称呼、结尾一次整理”“考前最后一周到底看什么”“真的不要再背整篇模板了”。',
    '不要把“诊断学、博弈论、植入艺术、思维跃迁、转化机制、社交策略、生成引擎、危机应对、优先级体系、表达调用、深度解析、进阶、训练节奏、实战技巧、底层逻辑、正确姿势、内化、打造、全景图”等教研/AI命名放在公开母题里；这些只能留在内部解释。',
    '主体大题必须自然拆出3到5个彼此不同的二级内容模块，而且模块要横跨不同内容维度；不能只是同一技巧的第一步、第二步、第三步，也不能只是3个例句、3个词或3种错误。少量长尾题是例外：它可以围绕一个明确单点展开适用场景、判断标准、对比和实际例子，但该单点必须独立值得搜索和收藏。',
    '资料型母题可以凭“真实而高密度的资产”本身成立，不要求删掉清单、论据库或速查表后仍按认知题成立；但必须实际能交付多类条目、对照、例子或检查动作。不要用没有具体内容支撑的“完整攻略/技巧大全/如何提升写作”伪装宏观。',
    '理想方向包括：整篇模板是否值得背、B2感到底差在哪里、哪些写作内容值得准备、观点素材如何搭建、正式信需要掌握哪些模块、论证为什么写不深、范文如何迁移、考前一周如何安排。',
    '反常识/insight题必须同时返回真实的 existingBelief 与 counterBelief；其他类型按需填写，可以为空。',
    'valueType 不在输入中预分配。先独立生成 Mother Topic，再根据这个母题和 proposedSubtopics 的真实内容结构，选择一个最自然的 valueType。它是内容交付形式，不是批次配额。',
    'valueType 只能从 usable_list、collection、shortcut、mistake、comparison、before_after、self_test、example、exam_rescue、insight 中选择；例如“高频观点素材汇总”通常是 collection，“真的不要再背整篇模板了”通常是 insight，但不要机械套例子。',
    '每项只返回 topic、motherTopicRationale、proposedSubtopics、existingBelief、counterBelief、valueType。proposedSubtopics 必须是3到5条独立内容模块，不写步骤编号。',
    '只返回 JSON：{"motherTopics":[{"taskId":"","topic":"","motherTopicRationale":"","proposedSubtopics":[""],"existingBelief":"","counterBelief":"","valueType":"collection"}]}，数量、taskId、顺序必须与输入一致。',
  ].join('\n');
  const payload = JSON.stringify({ productId, inputs: macroInputs });
  let usage = emptyUsage();
  const result = await callOpenAICompatibleJsonWithUsage<RawResponse>([
    { role: 'system', content: system },
    { role: 'user', content: payload },
  ], { maxTokens: Math.max(2600, Math.min(7600, inputs.length * 360)), temperature: 0.8, retries: 2 });
  usage = mergeAiUsage(usage, result.usage);
  const rawById = rawMotherTopicMap(result.data?.motherTopics);
  const topics: MotherTopic[] = [];
  const failedTopics: Array<{ taskId: string; reason: string }> = [];
  const warnings: string[] = [];

  for (const { input, modelTaskId } of aliasedInputs) {
    let checked = normalizeMotherTopic(rawById.get(modelTaskId), input, modelTaskId, options.acceptBelowThreshold === true);
    if (!checked.ok) {
      const repairPayload = JSON.stringify({ productId, inputs: macroInputs.filter(item => item.taskId === modelTaskId) });
      try {
        const repair = await callOpenAICompatibleJsonWithUsage<RawResponse>([
          { role: 'system', content: system },
          { role: 'user', content: `${repairPayload}\n上一次该母题不合格：${checked.issue}。只重做这个 task，不要输出执行字段。` },
        ], { maxTokens: 2600, temperature: 0.8, retries: 2 });
        usage = mergeAiUsage(usage, repair.usage);
        checked = normalizeMotherTopic(rawMotherTopicMap(repair.data?.motherTopics).get(modelTaskId), input, modelTaskId, options.acceptBelowThreshold === true);
        warnings.push(`${input.taskId}：Mother Topic 已进行一次局部重生成`);
      } catch (cause) {
        checked = { ok: false, issue: cause instanceof Error ? cause.message : 'Mother Topic 局部重生成异常' };
      }
    }
    if (checked.ok) topics.push({ ...checked.topic, taskId: input.taskId });
    else {
      failedTopics.push({ taskId: input.taskId, reason: checked.issue });
      warnings.push(`${input.taskId}：MOTHER_TOPIC_UNRECOVERABLE，已跳过当前候选`);
    }
  }
  return { topics, usage, warnings, failedTopics };
}

function rawMotherTopicMap(raw: unknown): Map<string, Record<string, unknown>> {
  if (!Array.isArray(raw)) return new Map();
  return new Map(raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object').map(item => [clean(item.taskId), item]));
}

function normalizeMotherTopic(item: Record<string, unknown> | undefined, input: MotherTopicInput, modelTaskId: string, _acceptBelowThreshold: boolean): { ok: true; topic: MotherTopic } | { ok: false; issue: string } {
    if (!item) return { ok: false, issue: `缺少 ${modelTaskId}` };
    const topic = clean(item.topic);
    const rationale = clean(item.motherTopicRationale);
    const proposedSubtopics = Array.isArray(item.proposedSubtopics) ? item.proposedSubtopics.map(clean).filter(Boolean).slice(0, 5) : [];
    const rawValueType = item.valueType ?? item.value_type;
    const candidateValueType = isTopicValueType(rawValueType) ? rawValueType as TopicValueType : undefined;
    const valueType = candidateValueType && !isDemandValueMismatch(topic, proposedSubtopics, candidateValueType)
      ? candidateValueType
      : classifyValueType(topic, proposedSubtopics);
    const requiresBeliefPair = input.demandType === 'misconception_correction' || valueType === 'insight';
    const allowsBeliefPair = requiresBeliefPair || input.demandType === 'comparison_seeking' || input.demandType === 'mistake_avoidance';
    const existingBelief = allowsBeliefPair ? clean(item.existingBelief ?? item.existing_belief) : '';
    const counterBelief = allowsBeliefPair ? clean(item.counterBelief ?? item.counter_belief) : '';
    const judged = judgeMotherTopic(topic, proposedSubtopics, { demandType: input.demandType, valueType, existingBelief, counterBelief });
    if (!topic || !rationale || !valueType) return { ok: false, issue: `${input.taskId} 母题结构不完整` };
    if (/雅思|托福|IELTS|TOEFL|考研英语|英语作文/i.test(topic)) return { ok: false, issue: `${input.taskId} 母题完全跑题` };
    return { ok: true, topic: { taskId: input.taskId, topic, motherTopicRationale: rationale, proposedSubtopics, existingBelief, counterBelief, valueType, ...judged } };
}

export function judgeMotherTopic(topic: string, subtopics: string[], context: { demandType?: TopicDemandType; valueType?: TopicValueType; existingBelief?: string; counterBelief?: string } = {}): Pick<MotherTopic, 'motherTopicScore' | 'topicScope' | 'xhsMotherTopicFit' | 'xhsEditorialFit' | 'courseLanguageRisk' | 'demandValueMismatch' | 'subpointRisk'> {
  const distinct = new Set(subtopics.map(item => item.replace(/[\s\d.、:：-]/g, '').slice(0, 18)));
  const stepLike = subtopics.length > 0 && subtopics.every(item => /^(先|再|然后|最后|第一|第二|第三|步骤|检查|修改|确认)/.test(item));
  const microLike = /^(donc|pourtant|par conséquent|连接词|疑问词|某个|一个|三个|三步|句型|单句|某几个)/i.test(topic)
    || /怎么用|如何区分|怎么改|正确使用/.test(topic);
  const qualifiedAssetObject = /观点|论据|正式信|审题|语法|自查|考前|范文|句型|表达|连接词|题型|流程|时间|例子|证据|素材/;
  const generic = /如何提升.*写作|怎样学好|写作总结/.test(topic)
    || (/(?:技巧大全|备考攻略|满分技巧)/.test(topic) && !qualifiedAssetObject.test(topic));
  const courseCore = /诊断学|博弈论|植入艺术|思维跃迁|转化机制|社交策略|生成引擎|危机应对|优先级体系|表达调用|底层逻辑|训练节奏|深度解析|全景图|机制|阶梯|模型|框架|方法论|体系/.test(topic);
  const courseTail = /[:：].*(方法|策略|技巧|指南|攻略|正确姿势|自然之道|关键跃迁|优先级|训练节奏|内化|底层逻辑)/.test(topic);
  const courseLike = courseCore || courseTail;
  const clickHook = /真的|不要再|为什么|到底|哪些|高频|万能|一次整理|一次讲清|最后一周|考前|差距|不是.*而是|值得背|汇总|整理|清单/.test(topic);
  const gainSignal = /汇总|整理|清单|合集|对照|流程|一次|素材|模板|开头|结尾|观点|句型|自查|看什么|补什么|背/.test(topic);
  const humanSignal = /[？?！!：:]/.test(topic) || /真的|不要|为什么|到底|哪些|怎么/.test(topic);
  const crossModule = new Set(subtopics.map(item => {
    if (/模板|范文|迁移|背/.test(item)) return 'material';
    if (/观点|论证|理由|例子|证据/.test(item)) return 'argument';
    if (/结构|段落|衔接/.test(item)) return 'structure';
    if (/语体|文体|正式|非正式/.test(item)) return 'register';
    if (/搭配|同义词|词汇|用词/.test(item)) return 'lexical_choice';
    if (/语法|句型|主谓|时态|虚拟/.test(item)) return 'grammar';
    if (/自然|地道|翻译腔|准确/.test(item)) return 'naturalness';
    if (/考场|复习|时间|训练|陌生题/.test(item)) return 'execution';
    return item.slice(0, 4);
  }));
  const topicScope: MotherTopic['topicScope'] = microLike || crossModule.size <= 1 ? 'micro'
    : crossModule.size === 2 || distinct.size < 3 ? 'subtopic' : 'mother';
  const scopeScore = topicScope === 'mother' ? 20 : topicScope === 'subtopic' ? 10 : 0;
  const delfScore = /DELF|B2|法语|正式信|作文|写作/.test(topic) ? 15 : 0;
  const naturalScore = humanSignal ? 10 : 5;
  const demand = context.demandType;
  const value = context.valueType;
  const isAsset = demand === 'asset_seeking' || ['collection', 'usable_list', 'self_test', 'example'].includes(value || '');
  const isMisconception = demand === 'misconception_correction' || value === 'insight';
  const isDecision = demand === 'exam_preparation';
  const isRescue = demand === 'shortcut_seeking' || value === 'exam_rescue' || value === 'shortcut';
  const clickScore = isMisconception
    ? (/真的|不是|不等于|误区|为什么|别再|总像B1/.test(topic) ? 30 : 14)
    : isAsset
      ? (/汇总|整理|清单|合集|素材|资料|一次/.test(topic) ? 27 : clickHook ? 18 : 10)
      : isDecision
        ? (/考前|最后一周|到底|优先|看什么|补什么/.test(topic) ? 30 : 14)
        : isRescue
          ? (/考场|突然|来不及|怎么办|卡住|没观点|急/.test(topic) ? 26 : 14)
          : (/为什么|总是|不会|写不出|像B1|差距/.test(topic) ? 27 : clickHook ? 18 : 10);
  const gainScore = isAsset
    ? (/汇总|整理|清单|合集|素材|资料|一次/.test(topic) ? 25 : 14)
    : isMisconception
      ? (/真的|不是|为什么|别再/.test(topic) ? 20 : 12)
      : (/看什么|补什么|清单|流程|对照|方法|模板|观点|素材/.test(topic) ? 20 : 12);
  const demandValueMismatch = isDemandValueMismatch(topic, subtopics, value);
  let score = clickScore + gainScore + scopeScore + delfScore + naturalScore;
  if (generic) score -= 15;
  if (courseLike) score -= courseTail ? 12 : 15;
  if (stepLike) score -= 12;
  if (microLike) score -= 10;
  if (demandValueMismatch) score -= 8;
  const bounded = Math.max(0, Math.min(100, score));
  const courseLanguageRisk: MotherTopic['courseLanguageRisk'] = courseCore && courseTail ? 'high' : courseCore || courseTail ? 'medium' : 'low';
  const xhsEditorialFit = courseLanguageRisk === 'high' || (courseLanguageRisk === 'medium' && !clickHook) ? 'course_like' : bounded >= 82 ? 'strong' : bounded >= 60 ? 'acceptable' : 'weak';
  const xhsMotherTopicFit = topicScope === 'micro' ? 'micro' : courseLike ? 'course_like' : bounded >= 80 ? 'strong' : 'acceptable';
  return { motherTopicScore: bounded, topicScope, xhsMotherTopicFit, xhsEditorialFit, courseLanguageRisk, demandValueMismatch, subpointRisk: topicScope === 'mother' ? 'low' : topicScope === 'subtopic' ? 'medium' : 'high' };
}

function isDemandValueMismatch(topic: string, subtopics: string[], value?: TopicValueType): boolean {
  if (!value) return true;
  const text = `${topic} ${subtopics.join(' ')}`;
  const signals: Record<TopicValueType, RegExp> = {
    usable_list: /清单|要点|表达|观点|句型|整理|如何|怎么/,
    collection: /汇总|整理|合集|速查|词库|素材库|资料库|清单|大全|一次/,
    shortcut: /捷径|省时|快速|3秒|五分钟|顺序|技巧|方法/,
    mistake: /误区|错误|避坑|别让|不该|错用|雷区|毁了/,
    comparison: /对比|比较|vs|普通|正确|错误|前后|B1.*B2|B2.*B1|不是.*而是/,
    before_after: /改写|升级|前后|从.*到|替换|变成/,
    self_test: /自测|自查|检查|测试|评估|核对|诊断/,
    example: /案例|例子|范文|示例|引用|数据/,
    exam_rescue: /考前|考场|急救|来不及|时间不够|卡住|救命/,
    insight: /真的|不是|不要再|别再|为什么|误区|真相|揭秘|总像/,
  };
  return !signals[value].test(text);
}

/** 模型漏填分类时只做字段级恢复，不重新生成或改写 Mother Topic。 */
function classifyValueType(topic: string, subtopics: string[]): TopicValueType {
  const text = `${topic} ${subtopics.join(' ')}`;
  if (/自测|自查|检查|测试|核对/.test(text)) return 'self_test';
  if (/误区|错误|避坑|别让|错用|雷区/.test(text)) return 'mistake';
  if (/对比|比较|vs|前后|普通|正确|错误|B1.*B2|B2.*B1|不是.*而是/.test(text)) return 'comparison';
  if (/汇总|合集|速查|词库|素材库|资料库|例子库|大全/.test(text)) return 'collection';
  if (/考前|考场|急救|来不及|时间不够|卡住/.test(text)) return 'exam_rescue';
  if (/真的|不是|不要再|别再|为什么|真相|揭秘|总像/.test(text)) return 'insight';
  if (/案例|例子|范文|示例|引用|数据/.test(text)) return 'example';
  if (/捷径|省时|快速|3秒|五分钟|顺序|技巧|方法|公式|工具箱/.test(text)) return 'shortcut';
  return /表达|观点|句型|如何|怎么|清单|整理/.test(text) ? 'usable_list' : 'example';
}

function emptyUsage(): AiUsageSummary { return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] }; }
function clean(value: unknown) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }
