import { callOpenAICompatibleJsonWithUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { writeFile } from 'node:fs/promises';
import { getProductPromptProfile } from '@/lib/product-prompt-profiles';
import type { ProductId } from '@/types/data';
import type { TemplateCapability } from './contracts';
import type { CompetitorCreativeCard } from '@/types/reference-workflow';
import type { ConsensusTopicDirection, TopicOption } from './contracts';
import type { TopicCoordinate } from './topic-coordinate-taxonomy';
import { TOPIC_DEMAND_LABELS, TOPIC_VALUE_TYPE_LABELS, demandTypeForBatchIndex, granularityForBatchIndex, isAbstractUserFacingValue, isTopicDemandType, isTopicGranularity, isTopicValueType, type CrossExamGenericRisk, type DelfSpecificity, type SubpointRisk, type TopicDemandType, type TopicGranularity, type TopicValueType } from './topic-value';
import { generateMotherTopics, type MotherTopic } from './mother-topic-stage';

/**
 * AI1 的批次级编辑任务单。它先一次看完全部名额，再给每个后续选题调用一个
 * 不可互换的任务；AI2/AI3 不再从同一份泛泛 DELF 提示词各自猜题。
 */
export interface BatchEditorialTask {
  taskId: string;
  cardId: string;
  topicIndex: number;
  direction: ConsensusTopicDirection;
  topic: string;
  /** Mother Topic 的程序锁定快照，供执行层一致性检查使用。 */
  lockedMotherTopic: string;
  audienceState: string;
  promise: string;
  contentAngle: string;
  expandContents: string[];
  expandContentPlans: ExpandContentPlan[];
  coreProblem: string;
  contentObject: string;
  solutionMechanism: string;
  userScene: string;
  emotionalAngle: string;
  coverExecution: string;
  valueType: TopicValueType;
  specificAsset: string;
  userGain: string;
  clickReason: string;
  saveReason: string;
  delfSpecificity: DelfSpecificity;
  threeSecondValueCheck: boolean;
  crossExamGenericRisk: CrossExamGenericRisk;
  demandType: TopicDemandType;
  topicGranularity: TopicGranularity;
  subpointRisk: SubpointRisk;
  existingBelief: string;
  counterBelief: string;
  publicTopicNaturalness: boolean;
  motherTopicRationale: string;
  proposedSubtopics: string[];
  motherTopicScore: number;
  xhsMotherTopicFit: 'strong' | 'acceptable' | 'course_like' | 'micro';
  xhsEditorialFit: 'strong' | 'acceptable' | 'course_like' | 'weak';
  topicScope: 'mother' | 'subtopic' | 'micro';
  forbiddenOverlaps: string[];
  coordinate: TopicCoordinate;
  coordinateHash: string;
}

export type ExpandAssetType = 'list' | 'table' | 'comparison' | 'before_after' | 'checklist' | 'framework' | 'example_breakdown' | 'expression_bank' | 'argument_bank' | 'timeline' | 'decision_tree' | 'step_by_step';

export interface ExpandContentPlan {
  title: string;
  contentGoal: string;
  assetType: ExpandAssetType;
  concreteDeliverable: string;
  mustContain: string[];
  exampleRequirement: string;
  languageMaterialRequirement: string;
  cardStructure: string;
  genericAdviceRisk: 'low' | 'medium' | 'high';
  modelReportedGenericAdviceRisk?: 'low' | 'medium' | 'high';
}

export interface ContentRepairTrace {
  jobId: string;
  blockIndex: number;
  initial: { rawModelResponse: unknown; normalizedBlock: ExpandContentPlan; validation: ContentBlockValidationResult };
  repairAttempts: Array<{
    attempt: number;
    repairPromptInput: unknown;
    rawModelResponse: unknown;
    normalizedBlock: ExpandContentPlan | null;
    validation: ContentBlockValidationResult;
  }>;
  finalStatus: 'PASS' | 'FAIL';
}

export interface MetadataRepairTrace {
  jobId: string;
  initial: { input: unknown; normalized: { existingBelief: string; counterBelief: string }; validation: { valid: boolean; reason: string } };
  repairAttempts: Array<{ attempt: number; input: unknown; rawModelResponse: unknown; normalized: { existingBelief: string; counterBelief: string }; validation: { valid: boolean; reason: string } }>;
  finalStatus: 'PASS' | 'FAIL';
}

export interface BatchEditorialPlanInput {
  productId: ProductId;
  direction?: string;
  entries: Array<{ coordinate: TopicCoordinate; cardId: string; cardName: string; capability: TemplateCapability; topicIndex: number; topicExpression: BatchTopicExpression; valueType: TopicValueType; demandType: TopicDemandType; topicGranularity: TopicGranularity }>;
  priorTaskSummaries?: Array<{ topic: string; problem: string; mechanism: string; emotion: string }>;
  /** 回归测试可传入已锁定母题；生产默认不传，保持现有 Mother 生成流程。 */
  lockedMotherTopics?: MotherTopic[];
}

type ExecutionPlanInput = BatchEditorialPlanInput & { publicTopicOverrides?: Map<string, string> };

export const BATCH_TOPIC_EXPRESSIONS = [
  '真实困境句：像备考者自己说遇到了什么，不加“指南/清单/方法”后缀',
  '反常识判断句：指出一个具体误区，不写空泛口号',
  '结果愿望句：说清想获得的具体变化，不许强承诺',
  '具体动作句：突出一个可执行动作，允许自然使用一次“法/技巧”',
  '资料主题句：像值得收藏的资料名，允许自然使用一次“表/清单/汇总”',
  '自然问句：用备考者真的会问的问题，不用“为什么你总是”模板',
] as const;
export type BatchTopicExpression = typeof BATCH_TOPIC_EXPRESSIONS[number];

export interface BatchEditorialPlanResult {
  tasks: BatchEditorialTask[];
  usage: AiUsageSummary;
  warnings: string[];
  diagnostics?: Record<string, number>;
  failedJobs?: BatchEditorialJobFailure[];
  repairTraces?: ContentRepairTrace[];
  metadataRepairTraces?: MetadataRepairTrace[];
}

export interface BatchEditorialJobFailure {
  jobId: string;
  status: 'MOTHER_TOPIC_UNRECOVERABLE' | 'METADATA_UNRECOVERABLE' | 'CONTENT_BLOCK_UNRECOVERABLE' | 'PUBLIC_TOPIC_DUPLICATE' | 'OTHER_ERROR';
  result: null;
  failureStage: 'mother_topic' | 'derived_metadata' | 'expand_content_validation' | 'public_topic_dedup' | 'execution_plan';
  failureReason: string;
  repairStats: Record<string, unknown>;
}

type RawResponse = { tasks?: Array<Record<string, unknown>> };

export async function planBatchEditorialTasks(input: BatchEditorialPlanInput): Promise<BatchEditorialPlanResult> {
  if (input.productId !== 'delf_b2_writing') throw new Error('批次编辑任务单当前只用于 DELF B2 写作');
  const motherInputs = input.entries.map(entry => ({
    taskId: `batch_${entry.cardId}_${entry.topicIndex + 1}`,
    domainId: entry.coordinate.domainId,
    demandType: entry.demandType,
  }));
  const motherPlan = input.lockedMotherTopics
    ? { topics: input.lockedMotherTopics, usage: emptyUsage(), warnings: [] as string[], failedTopics: [] as Array<{ taskId: string; reason: string }> }
    : await generateMotherTopics(input.productId, motherInputs);
  const motherFailures: BatchEditorialJobFailure[] = motherPlan.failedTopics.map(item => ({
    jobId: item.taskId, status: 'MOTHER_TOPIC_UNRECOVERABLE', result: null, failureStage: 'mother_topic',
    failureReason: item.reason, repairStats: { motherRepairAttempts: 1 },
  }));
  const metadata = await completeDerivedMetadata(new Map(motherPlan.topics.map(item => [item.taskId, item])), input.entries);
  const publicTopics = await preflightPublicTopics(metadata.mothers);
  const executableEntries = input.entries.filter(entry => {
    const taskId = `batch_${entry.cardId}_${entry.topicIndex + 1}`;
    return metadata.mothers.has(taskId) && !metadata.unrecoverableTaskIds.has(taskId);
  });
  const metadataFailures: BatchEditorialJobFailure[] = [...metadata.unrecoverableTaskIds].map(jobId => ({
    jobId, status: 'METADATA_UNRECOVERABLE', result: null, failureStage: 'derived_metadata',
    failureReason: 'existingBelief/counterBelief 在限定次数内未能补全或通过语义校验',
    repairStats: { metadataRepairAttempts: 2 },
  }));
  if (!executableEntries.length) {
    return {
      tasks: [], usage: motherPlan.usage, warnings: [...motherPlan.warnings, ...metadata.warnings],
      diagnostics: metadata.diagnostics, failedJobs: [...motherFailures, ...metadataFailures], metadataRepairTraces: metadata.traces,
    };
  }
  const execution = await planExecutionTasks({ ...input, entries: executableEntries, publicTopicOverrides: publicTopics.overrides }, metadata.mothers);
  return { tasks: execution.tasks, usage: mergeAiUsage(motherPlan.usage, metadata.usage, publicTopics.usage, execution.usage), warnings: [...motherPlan.warnings, ...metadata.warnings, ...publicTopics.warnings, ...execution.warnings], diagnostics: { ...metadata.diagnostics, ...execution.diagnostics }, failedJobs: [...motherFailures, ...metadataFailures, ...(execution.failedJobs || [])], repairTraces: execution.repairTraces || [], metadataRepairTraces: metadata.traces };
}

async function preflightPublicTopics(mothers: Map<string, MotherTopic>): Promise<{ overrides: Map<string, string>; usage: AiUsageSummary; warnings: string[] }> {
  const overrides = new Map<string, string>();
  let usage = emptyUsage();
  const warnings: string[] = [];
  for (const mother of mothers.values()) {
    if (isNaturalPublicTopic(mother.topic)) continue;
    const response = await callOpenAICompatibleJsonWithUsage<{ topic?: unknown; publicTopicNaturalness?: unknown }>([
      { role: 'system', content: '你是小红书公开选题表层表达修复器。只改 finalPublicTopic 的措辞，不改变 Mother Topic 的语义、粒度、domain、demandType、valueType 或内容方向。去掉课程味、AI味和冗余尾巴，不得下钻。只返回 JSON：{"topic":"","publicTopicNaturalness":true}。' },
      { role: 'user', content: JSON.stringify({ motherTopic: mother.topic, proposedSubtopics: mother.proposedSubtopics, reason: '母题公开表达含课程化或不自然表述' }) },
    ], { maxTokens: 500, temperature: 0.25, retries: 1 });
    usage = mergeAiUsage(usage, response.usage);
    const candidate = clean(response.data?.topic);
    if (candidate && response.data?.publicTopicNaturalness === true && isNaturalPublicTopic(candidate)) overrides.set(mother.taskId, candidate);
    else warnings.push(`${mother.taskId}：PUBLIC_TOPIC_REPAIR未通过，保留原Mother表达并在执行层继续校验`);
  }
  return { overrides, usage, warnings };
}

function isNaturalPublicTopic(topic: string): boolean {
  return topic.length >= 6 && topic.length <= 80 && !/诊断学|博弈论|植入艺术|思维跃迁|转化机制|生成引擎|优先级体系|表达调用|底层逻辑|训练节奏|深度解析|正确姿势|全景图/.test(topic);
}

async function completeDerivedMetadata(
  mothers: Map<string, MotherTopic>,
  entries: BatchEditorialPlanInput['entries'],
): Promise<{ mothers: Map<string, MotherTopic>; unrecoverableTaskIds: Set<string>; usage: AiUsageSummary; warnings: string[]; diagnostics: Record<string, number>; traces: MetadataRepairTrace[] }> {
  const unrecoverableTaskIds = new Set<string>();
  const warnings: string[] = [];
  let usage = emptyUsage();
  const diagnostics = { metadataRepairJobs: 0, metadataRepairCalls: 0, metadataRepairOnceSuccess: 0, metadataRepairTwiceSuccess: 0, metadataUnrecoverable: 0 };
  const traces: MetadataRepairTrace[] = [];
  for (const entry of entries) {
    const taskId = `batch_${entry.cardId}_${entry.topicIndex + 1}`;
    const mother = mothers.get(taskId);
    if (!mother || (mother.valueType !== 'insight' && entry.demandType !== 'misconception_correction')) continue;
    if (validBeliefPair(mother.existingBelief, mother.counterBelief, mother.topic)) continue;
    diagnostics.metadataRepairJobs += 1;
    let repaired = false;
    let lastProblem = '';
    const trace: MetadataRepairTrace = { jobId: taskId, initial: { input: { motherTopic: mother.topic, demandType: entry.demandType, valueType: mother.valueType }, normalized: { existingBelief: mother.existingBelief, counterBelief: mother.counterBelief }, validation: { valid: false, reason: 'initial belief pair missing or invalid' } }, repairAttempts: [], finalStatus: 'FAIL' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await callOpenAICompatibleJsonWithUsage<{ existingBelief?: unknown; counterBelief?: unknown }>([
        { role: 'system', content: '你是派生语义元数据修复器。只补两个字段：existingBelief 和 counterBelief。不得修改母题、理由、二级模块、demandType、valueType、specificAsset 或正文方向。existingBelief必须是考生可能采用的具体认知/做法；counterBelief必须针对它形成具体纠偏。只返回JSON对象。' },
        { role: 'user', content: JSON.stringify({ MotherTopic: mother.topic, motherTopicRationale: mother.motherTopicRationale, proposedSubtopics: mother.proposedSubtopics, demandType: entry.demandType, valueType: mother.valueType, currentMissing: ['existingBelief', 'counterBelief'], previousProblem: lastProblem }) },
      ], { maxTokens: 500, temperature: 0.25, retries: 1 });
      usage = mergeAiUsage(usage, result.usage);
      diagnostics.metadataRepairCalls += 1;
      const existing = clean(result.data?.existingBelief);
      const counter = clean(result.data?.counterBelief);
      const valid = validBeliefPair(existing, counter, mother.topic);
      trace.repairAttempts.push({ attempt: attempt + 1, input: { motherTopic: mother.topic, demandType: entry.demandType, valueType: mother.valueType, previousProblem: lastProblem }, rawModelResponse: result.data, normalized: { existingBelief: existing, counterBelief: counter }, validation: { valid, reason: valid ? '' : 'belief 为空、过于泛化，或未与母题形成具体纠偏关系' } });
      if (valid) {
        mothers.set(taskId, { ...mother, existingBelief: existing, counterBelief: counter });
        repaired = true;
        trace.finalStatus = 'PASS';
        if (attempt === 0) diagnostics.metadataRepairOnceSuccess += 1;
        else diagnostics.metadataRepairTwiceSuccess += 1;
        break;
      }
      lastProblem = '返回的 belief 为空、过于泛化，或没有与母题形成具体纠偏关系';
    }
    if (!repaired) {
      unrecoverableTaskIds.add(taskId);
      diagnostics.metadataUnrecoverable += 1;
      warnings.push(`${taskId}：DERIVED_METADATA_UNRECOVERABLE（existingBelief/counterBelief）`);
    }
    traces.push(trace);
  }
  return { mothers, unrecoverableTaskIds, usage, warnings, diagnostics, traces };
}

function validBeliefPair(existing: string, counter: string, topic: string): boolean {
  if (existing.trim().length < 8 || counter.trim().length < 8) return false;
  if (existing === counter || /不了解|有问题|提高能力|更加灵活|注意语境/.test(`${existing}${counter}`)) return false;
  return /认为|以为|背|套|只要|越|直接|习惯|做法|觉得/.test(existing) && /应该|更适合|而不是|反而|需要|关键|不能|容易/.test(counter)
    && (topic.length < 4 || `${existing}${counter}`.includes(topic.slice(0, 4)) || /模板|词|连接|作文|写作|范文|表达|论证/.test(`${existing}${counter}`));
}

async function planExecutionTasks(input: ExecutionPlanInput, mothers: Map<string, MotherTopic>): Promise<BatchEditorialPlanResult> {
  // 全批内容坐标已经由 batch-topic-map 一次锁定。这里只按 5 个分段补充公开选题、
  // 情绪和封面执行细节，模型无权重新选择领域、问题、对象、机制或场景。
  if (input.entries.length > 5) {
    const allTasks: BatchEditorialTask[] = [];
    const allFailedJobs: BatchEditorialJobFailure[] = [];
    const allRepairTraces: ContentRepairTrace[] = [];
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] } as AiUsageSummary;
    const diagnostics: Record<string, number> = { initialPassedBlocks: 0, repairBlocks: 0, repairOnceSuccess: 0, repairTwiceSuccess: 0, contentBlockUnrecoverable: 0, normalizationFailures: 0, semanticContentFailures: 0, repairTokens: 0 };
    const warnings: string[] = ['锁定坐标后的详细任务单按5个名额分段展开；内容坐标未分段重选'];
    let priorTaskSummaries = [...(input.priorTaskSummaries || [])];
    for (let start = 0; start < input.entries.length; start += 5) {
      const segmentEntries = input.entries.slice(start, start + 5);
      let segment: BatchEditorialPlanResult;
      try {
        segment = await planExecutionTasks({
          ...input,
          entries: segmentEntries,
          priorTaskSummaries,
        }, mothers);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : 'Execution segment 生成异常';
        allFailedJobs.push(...segmentEntries.map(entry => ({
          jobId: `batch_${entry.cardId}_${entry.topicIndex + 1}`,
          status: 'OTHER_ERROR' as const,
          result: null,
          failureStage: 'execution_plan' as const,
          failureReason: reason,
          repairStats: { segmentStart: start },
        })));
        warnings.push(`Execution segment ${start / 5 + 1} 失败，已隔离并继续后续 segment：${reason}`);
        continue;
      }
      allTasks.push(...segment.tasks);
      allFailedJobs.push(...(segment.failedJobs || []));
      allRepairTraces.push(...(segment.repairTraces || []));
      priorTaskSummaries = [
        ...priorTaskSummaries,
        ...segment.tasks.map(task => ({
          topic: task.topic,
          problem: task.coreProblem,
          mechanism: task.solutionMechanism,
          emotion: task.emotionalAngle,
        })),
      ];
      usage = mergeAiUsage(usage, segment.usage);
      for (const [key, value] of Object.entries(segment.diagnostics || {})) diagnostics[key] = (diagnostics[key] || 0) + value;
      warnings.push(...segment.warnings);
    }
    const deduped = isolateDuplicatePublicTopics(allTasks);
    allFailedJobs.push(...deduped.failures);
    warnings.push(...deduped.failures.map(item => `${item.jobId}：PUBLIC_TOPIC_DUPLICATE，已跳过，其余任务继续`));
    warnings.push(...valueMixWarnings(deduped.tasks));
    return { tasks: deduped.tasks, usage, warnings, diagnostics, failedJobs: allFailedJobs, repairTraces: allRepairTraces };
  }
  const expected = input.entries.map(entry => ({
    taskId: `batch_${entry.cardId}_${entry.topicIndex + 1}`,
    cardId: entry.cardId,
    topicIndex: entry.topicIndex,
    cardName: entry.cardName,
    coverFamily: entry.capability.family,
    coverBlocks: entry.capability.acceptedBlockKinds,
    lockedCoordinate: entry.coordinate,
    topicExpression: entry.topicExpression,
    valueType: mothers.get(`batch_${entry.cardId}_${entry.topicIndex + 1}`)?.valueType || entry.valueType,
    demandType: entry.demandType,
    topicGranularity: entry.topicGranularity,
    motherTopic: mothers.get(`batch_${entry.cardId}_${entry.topicIndex + 1}`),
    publicTopicOverride: input.publicTopicOverrides?.get(`batch_${entry.cardId}_${entry.topicIndex + 1}`),
  }));
  const profile = getProductPromptProfile(input.productId);
  const system = [
    '你是 DELF B2 写作账号的执行编辑。上游总编辑已经锁定每个名额的内容坐标，你只把坐标展开为可生产任务单。',
    '这是法语 DELF B2 写作。所有场景都必须明确属于法语学习与法语写作，严禁出现英语、英文、中式英语、雅思、托福、SAT等错产品词。',
    'lockedCoordinate 的 domainId、problemId、objectId、mechanismId、sceneId、scale、contentType 均不可修改、替换或重新解释成其他常见痛点。',
    '公开选题已经由上游 Mother Topic 锁定；若存在 publicTopicOverride，只允许使用该表层人话表达，不得缩小、改写或另起一个更细的公开 Topic。只负责根据母题和 coordinate 生成 specificAsset、expandContents、scene化执行、audienceState、promise、emotionalAngle。',
    '公开选题、承诺和展开内容必须服务于已锁定 Mother Topic；如果 mechanism/object/scene 与母题不完全一致，调整执行资产和展开方式，不得把母题缩小回局部技巧。',
    'topic 必须逐字复制该名额的 locked Mother Topic；topicExpression 只影响后续表达检查，不得重写母题。',
    'valueType 是本名额优先交付的“小红书内容消费价值”，用于拉开整批选题的结构差异；它是编辑方向，不是把合法选题硬拦掉的标签。具体载体由 specificAsset 和执行内容兑现；不得为了让 topic 字面出现某个载体而改写或缩小已锁定 Mother Topic。',
    ...Object.entries(TOPIC_VALUE_TYPE_LABELS).map(([id, description]) => `${id}：${description}`),
    'demandType 是用户来找什么，不是用户哪里痛：' + Object.entries(TOPIC_DEMAND_LABELS).map(([id, label]) => `${id}=${label}`).join('；'),
    'topicGranularity 是下游执行标记，不得用它把 locked Mother Topic 改写成小题。Level 1 是总问题型，依据是公开 Topic 本身面对一个上层用户问题并能自然拆出3到5个主要模块；Level 2 是一项宽而完整、可反复使用的写作任务或资料。两者都不能靠一张表或堆数量冒充大题。',
    '若 locked Mother Topic 是大痛点或高密度资产题，Execution 应让具体机制、对象和场景分别服务其多个二级模块；单个连接词、代词、句型、敬语或格式点只能成为内页例子，不得反向成为整篇公开选题。',
    'asset_seeking、misconception_correction、exam_preparation、comparison_seeking 可以不填痛点，不得为了完整而编造痛点；improvement_need 才需要具体痛点。',
    '只有真正能补全“很多人以为A，但实际上B”的认知纠偏才能使用misconception_correction或insight；existingBelief和counterBelief必须同时填写。普通技巧不得冒充反常识。',
    'subpointRisk 判断这是不是另一篇笔记里的一个bullet，而不是一篇能单独发布的一级主题；局部换词、单个句子、单个小动作通常为high。',
    'specificAsset 必须明确回答“点进去能看到什么”，必须是清单、表、对比、改写、例子、检查顺序等具体载体，不能写“提升能力/建立体系/稳定节奏”。',
    'expandContents 只是旧版兼容摘要；真正交给下游的是 expandContentPlans。每个 plan 必须说明这一页要交付什么，而不是只说方向。',
    '三个 expandContentPlans 是对同一大题的执行内容簇，不是三个互不相关的新选题；它们可以共同支持下游规划3到6页。不得让 assetType、specificAsset、contentAngle 或 concreteDeliverable 把大母题碎成一个微型知识点。',
    '每个 expandContentPlan 必须包含 title、contentGoal、assetType、concreteDeliverable、mustContain、exampleRequirement、languageMaterialRequirement、cardStructure、genericAdviceRisk。concreteDeliverable 必须是实际资料，禁止只写“提升逻辑/迁移技巧/深度分析”。mustContain至少2个具体交付项。',
    '按 valueType 规划不同载荷：collection=分类+具体条目+组织方式；insight=旧认知→为什么不成立→案例→新判断；comparison=明确A与B；mistake=错误→原因→修正→正确例子；self_test=检查项→标准→修正；exam_rescue=触发场景→立即动作→兜底。不要把所有页面都写成三步法。',
    '如果 Mother 或 specificAsset 承诺素材、汇总、合集、观点库、表达库、清单或速查，plan 必须写出每类实际交付的条目，不得只列类别名。不要虚构官方评分、官方高频题、扣分分值或统计数字。',
    'userGain 写用户看完能直接拿走的东西；clickReason 写用户为什么会点具体内容，不得只写焦虑、迷茫；saveReason 写为什么以后还会回来查。',
    'delfSpecificity 必须判断该选题是否离开DELF B2写作就失去意义；crossExamGenericRisk 必须做IELTS/考研英语替换测试。优先 high/low，medium 只能少量出现。',
    'threeSecondValueCheck 必须为 true；如果2到3秒说不清用户会拿到什么具体东西，就不要提交该选题。',
    'priorConfirmedTasks 是前面分组已经锁定的公开表达。本组不得复用其中的选题句式、情绪处境或同一解释角度。',
    'audienceState 必须是6到22个汉字的完整真实场景，例如“换一道题就不知道从哪下笔”；严禁只写“慌、卡、练了没底”等单个情绪标签。',
    'emotionalAngle 要写触发情绪的具体处境，可以出现焦虑、崩溃、破防，但不能只列情绪名词。',
    'coverExecution 只描述这张封面的信息组织和排版方式；公开 topic、coreProblem、contentObject、solutionMechanism 中严禁出现模板名、颜色、材质或视觉词（例如“羊皮纸”“白底绿字”“黑板”）。',
    '这是生产工单，不是策划说明书：摘要字符串字段最多 32 个汉字；expandContents必须恰好3条、每条最多16个汉字；expandContentPlans必须恰好3项；forbiddenOverlaps最多2条。plan是内容合同，不写完整正文。',
    '不要写正文、标题、封面文案或商品承诺；只输出任务单。',
    '只返回 JSON 对象，顶层 tasks。每项字段必须为 taskId,cardId,topicIndex,topic,audienceState,promise,contentAngle,expandContents,expandContentPlans,emotionalAngle,coverExecution,valueType,specificAsset,userGain,clickReason,saveReason,delfSpecificity,threeSecondValueCheck,crossExamGenericRisk,demandType,topicGranularity,subpointRisk,existingBelief,counterBelief,publicTopicNaturalness。topic必须与locked Mother Topic完全一致。',
  ].join('\n');
  const user = JSON.stringify({
    productScope: profile.topicScopePrompt,
    userDirection: input.direction || '',
    priorConfirmedTasks: input.priorTaskSummaries || [],
    requiredTasks: expected,
  });

  const result = await callOpenAICompatibleJsonWithUsage<RawResponse>([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], { maxTokens: Math.min(14000, Math.max(7000, expected.length * 1800)), temperature: 0.8, retries: 2 });
  const publicTopic = await repairPublicTopics(result.data?.tasks, expected, input.publicTopicOverrides);
  const repaired = await repairExpandContentBlocks(publicTopic.tasks, expected);
  const combined = mergeAiUsage(result.usage, publicTopic.usage, repaired.usage);
  const validated = validateTasksPerJob(repaired.tasks, expected);
  await writeFile('.tmp-last-editorial-validation.json', JSON.stringify({ tasks: repaired.tasks, failures: validated.failures }, null, 2), 'utf8').catch(() => undefined);
  const deduped = isolateDuplicatePublicTopics(validated.tasks);
  return {
    tasks: deduped.tasks,
    usage: combined,
    warnings: [
      ...repaired.unrecoverableTaskIds.map(taskId => `${taskId}：CONTENT_BLOCK_UNRECOVERABLE，其他任务继续生产`),
      ...validated.failures.map(failure => `${failure.jobId}：${failure.status}，其他任务继续生产`),
      ...deduped.failures.map(failure => `${failure.jobId}：PUBLIC_TOPIC_DUPLICATE，已跳过，其余任务继续`),
    ],
    diagnostics: repaired.diagnostics,
    failedJobs: [...validated.failures, ...deduped.failures],
    repairTraces: repaired.traces,
  };
}

function isolateDuplicatePublicTopics(tasks: BatchEditorialTask[]): { tasks: BatchEditorialTask[]; failures: BatchEditorialJobFailure[] } {
  const seen = new Set<string>();
  const kept: BatchEditorialTask[] = [];
  const failures: BatchEditorialJobFailure[] = [];
  for (const task of tasks) {
    const key = task.topic.toLocaleLowerCase().replace(/[\s，。！？、：；,.!?:;]/g, '');
    if (!seen.has(key)) {
      seen.add(key);
      kept.push(task);
      continue;
    }
    failures.push({
      jobId: task.taskId,
      status: 'PUBLIC_TOPIC_DUPLICATE',
      result: null,
      failureStage: 'public_topic_dedup',
      failureReason: `公开选题与先出现任务完全重复：${task.topic}`,
      repairStats: { attempts: 0 },
    });
  }
  return { tasks: kept, failures };
}

async function repairPublicTopics(
  raw: unknown,
  expected: Array<{ taskId: string; motherTopic?: MotherTopic }>,
  overrides?: Map<string, string>,
): Promise<{ tasks: unknown[]; usage: AiUsageSummary }> {
  const tasks = Array.isArray(raw) ? raw.map(item => item && typeof item === 'object' ? { ...(item as Record<string, unknown>) } : item) : [];
  let usage = emptyUsage();
  for (const item of expected) {
    const source = tasks.find(task => task && typeof task === 'object' && clean((task as Record<string, unknown>).taskId) === item.taskId) as Record<string, unknown> | undefined;
    if (!source) continue;
    const override = overrides?.get(item.taskId);
    if (override) {
      source.topic = override;
      source.publicTopicNaturalness = true;
      continue;
    }
    if (source.publicTopicNaturalness === true || source.public_topic_naturalness === true) continue;
    let lastProblem = '公开选题不够自然，或带有课程目录/AI命名感';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await callOpenAICompatibleJsonWithUsage<{ topic?: unknown; publicTopicNaturalness?: unknown }>([
        { role: 'system', content: '你是小红书公开选题表层表达修复器。只改 finalPublicTopic 的措辞，不改变 Mother Topic 的语义、粒度、domain、demandType、valueType 或资料型/纠偏型内容方向。去掉课程味、AI味和冗余尾巴，保留原主题。只返回 JSON：{"topic":"","publicTopicNaturalness":true}。不得下钻成单个句子、连接词或局部技巧。' },
        { role: 'user', content: JSON.stringify({ motherTopic: item.motherTopic?.topic || '', currentTopic: source.topic, proposedSubtopics: item.motherTopic?.proposedSubtopics || [], previousProblem: lastProblem }) },
      ], { maxTokens: 500, temperature: 0.25, retries: 1 });
      usage = mergeAiUsage(usage, response.usage);
      const candidate = clean(response.data?.topic);
      if (candidate && response.data?.publicTopicNaturalness === true && candidate.length >= 6) {
        source.topic = candidate;
        source.publicTopicNaturalness = true;
        break;
      }
      lastProblem = '修复结果为空、未标记自然，或没有保留母题范围';
    }
  }
  return { tasks, usage };
}

export async function repairExpandContentBlocks(
  raw: unknown,
  expected: Array<{ taskId: string; cardId: string; topicIndex: number; lockedCoordinate: TopicCoordinate; valueType: TopicValueType; motherTopic?: MotherTopic }>,
): Promise<{ tasks: unknown[]; usage: AiUsageSummary; diagnostics: Record<string, number>; unrecoverableTaskIds: string[]; traces: ContentRepairTrace[] }> {
  const tasks = Array.isArray(raw) ? raw.map(item => item && typeof item === 'object' ? { ...(item as Record<string, unknown>) } : item) : [];
  let usage = emptyUsage();
  const diagnostics = { initialPassedBlocks: 0, repairBlocks: 0, repairOnceSuccess: 0, repairTwiceSuccess: 0, contentBlockUnrecoverable: 0, normalizationFailures: 0, semanticContentFailures: 0, repairTokens: 0 };
  const unrecoverableTaskIds: string[] = [];
  const traces: ContentRepairTrace[] = [];
  for (const item of expected) {
    const source = tasks.find(task => task && typeof task === 'object' && clean((task as Record<string, unknown>).taskId) === item.taskId) as Record<string, unknown> | undefined;
    if (!source) continue;
    const plans = parseExpandContentPlans(source.expandContentPlans);
    for (let index = 0; index < plans.length; index += 1) {
      const blockValidation = validateExpandContentPlan(plans[index]!, item.valueType, item.motherTopic?.topic || '', clean(source.specificAsset ?? source.specific_asset));
      if (blockValidation.valid) { diagnostics.initialPassedBlocks += 1; continue; }
      diagnostics.repairBlocks += 1;
      diagnostics.semanticContentFailures += 1;
      let current = plans[index]!;
      const trace: ContentRepairTrace = { jobId: item.taskId, blockIndex: index, initial: { rawModelResponse: source, normalizedBlock: current, validation: blockValidation }, repairAttempts: [], finalStatus: 'FAIL' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const repairInput = { motherTopic: item.motherTopic?.topic || '', valueType: item.valueType, blockIndex: index, currentBlock: current, missingRequirements: blockValidation.missingRequirements, problems: blockValidation.problems };
        const repair = await callOpenAICompatibleJsonWithUsage<{ plan?: Record<string, unknown> }>([
          { role: 'system', content: repairInstructionFor(item.valueType) },
          { role: 'user', content: JSON.stringify(repairInput) },
        ], { maxTokens: 1800, temperature: 0.35, retries: 1 });
        usage = mergeAiUsage(usage, repair.usage);
        diagnostics.repairTokens += repair.usage.total_tokens;
        const candidate = repair.data?.plan;
        if (!candidate) { trace.repairAttempts.push({ attempt: attempt + 1, repairPromptInput: repairInput, rawModelResponse: repair.data, normalizedBlock: null, validation: { valid: false, missingRequirements: blockValidation.missingRequirements, problems: ['模型未返回plan'] } }); break; }
        const patch = normalizeRepairPatch(candidate);
        const merged = mergeContentPlanPatch(current, patch, blockValidation.missingRequirements);
        const parsed = parseExpandContentPlans([merged])[0];
        if (!parsed) { trace.repairAttempts.push({ attempt: attempt + 1, repairPromptInput: repairInput, rawModelResponse: repair.data, normalizedBlock: null, validation: { valid: false, missingRequirements: blockValidation.missingRequirements, problems: ['Parser未能归一化plan'] } }); break; }
        current = parsed;
        const next = validateExpandContentPlan(current, item.valueType, item.motherTopic?.topic || '', clean(source.specificAsset ?? source.specific_asset));
        trace.repairAttempts.push({ attempt: attempt + 1, repairPromptInput: repairInput, rawModelResponse: repair.data, normalizedBlock: current, validation: next });
        if (next.valid) {
          if (attempt === 0) diagnostics.repairOnceSuccess += 1;
          else diagnostics.repairTwiceSuccess += 1;
          trace.finalStatus = 'PASS';
          break;
        }
        if (attempt === 1) break;
      }
      traces.push(trace);
      plans[index] = current;
      if (!validateExpandContentPlan(current, item.valueType, item.motherTopic?.topic || '', clean(source.specificAsset ?? source.specific_asset)).valid) {
        diagnostics.contentBlockUnrecoverable += 1;
        if (!unrecoverableTaskIds.includes(item.taskId)) unrecoverableTaskIds.push(item.taskId);
      }
    }
    source.expandContentPlans = plans;
  }
  return { tasks, usage, diagnostics, unrecoverableTaskIds, traces };
}

function repairInstructionFor(valueType: TopicValueType): string {
  const contract = valueType === 'comparison'
    ? '必须补齐至少一个真实 A、一个真实 B、明确比较维度、核心差异和一个实际示例。'
    : valueType === 'self_test'
      ? '必须补齐检查项、PASS/FAIL 判断标准、FAIL 条件和发现 FAIL 后的具体修正动作。'
      : valueType === 'mistake'
        ? '必须补齐一个具体错误、错误原因、修正原则、正确法语示例。'
        : '必须把方向词变成可展示的具体交付物：至少3个真实内容对象、具体分类或对照结构、至少一组法语材料或实际示例，并明确最终是一张什么表/清单/对照页。';
  return `你是内容合同修复器。只修复一个已经通过主题审核的 DELF B2 内容块。禁止改变 title、contentGoal、assetType、Mother Topic 和核心方向；只补齐当前缺失合同，不写完整正文。${contract} concreteDeliverable 不能只写提升、深化、建立视角、灵活迁移、加强训练、优化结构等方向词；mustContain 必须写真实内容对象。返回 JSON：{"plan":{title,contentGoal,assetType,concreteDeliverable,mustContain,exampleRequirement,languageMaterialRequirement,cardStructure,genericAdviceRisk}}。`;
}

export function normalizeRepairPatch(candidate: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of ['title', 'contentGoal', 'assetType', 'concreteDeliverable', 'mustContain', 'exampleRequirement', 'languageMaterialRequirement', 'cardStructure']) {
    if (candidate[key] !== undefined) patch[key] = candidate[key];
  }
  if (candidate.missing_error_example !== undefined) patch.mustContain = [...(Array.isArray(patch.mustContain) ? patch.mustContain : []), `错误示例：${clean(candidate.missing_error_example)}`];
  if (candidate.missing_error_reason !== undefined) patch.mustContain = [...(Array.isArray(patch.mustContain) ? patch.mustContain : []), `错误原因：${clean(candidate.missing_error_reason)}`];
  if (candidate.missing_correction !== undefined) patch.mustContain = [...(Array.isArray(patch.mustContain) ? patch.mustContain : []), `修正原则：${clean(candidate.missing_correction)}`];
  if (candidate.missing_correct_example !== undefined) patch.exampleRequirement = clean(candidate.missing_correct_example);
  return patch;
}

export function mergeContentPlanPatch(current: ExpandContentPlan, patch: Record<string, unknown>, missing: string[]): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  const replacingConcrete = missing.includes('generic_advice_risk_high') || missing.includes('direction_only_deliverable');
  for (const key of ['title', 'contentGoal', 'assetType', 'cardStructure', 'languageMaterialRequirement']) {
    if (patch[key] && !merged[key]) merged[key] = patch[key];
  }
  if (patch.concreteDeliverable && (replacingConcrete || !merged.concreteDeliverable)) merged.concreteDeliverable = patch.concreteDeliverable;
  if (Array.isArray(patch.mustContain) && patch.mustContain.length) merged.mustContain = [...(Array.isArray(merged.mustContain) ? merged.mustContain : []), ...patch.mustContain];
  if (patch.exampleRequirement && (missing.some(item => item.includes('example')) || !merged.exampleRequirement)) merged.exampleRequirement = patch.exampleRequirement;
  return merged;
}

export function buildEditorialTaskDirection(task: BatchEditorialTask, userDirection = '') {
  return [
    userDirection.trim(),
    '【总编辑锁定任务单】',
    `核心问题：${task.coreProblem}`,
    `内容对象：${task.contentObject}`,
    `解决机制：${task.solutionMechanism}`,
    `用户场景：${task.userScene}`,
    `情绪起势：${task.emotionalAngle}`,
    `封面执行：${task.coverExecution}`,
    `不要撞题：${task.forbiddenOverlaps.join('；')}`,
    '只能执行这一张任务单，不得自行换成其他常见 DELF B2 痛点。',
  ].filter(Boolean).join('\n');
}

function validateTasksPerJob(
  raw: unknown,
  expected: Array<{ taskId: string; cardId: string; topicIndex: number; lockedCoordinate: TopicCoordinate; valueType: TopicValueType; motherTopic?: MotherTopic }>,
): { tasks: BatchEditorialTask[]; failures: BatchEditorialJobFailure[] } {
  const sourceById = new Map(
    Array.isArray(raw)
      ? raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map(item => [clean(item.taskId), item] as const)
      : [],
  );
  const tasks: BatchEditorialTask[] = [];
  const failures: BatchEditorialJobFailure[] = [];
  for (const item of expected) {
    const source = sourceById.get(item.taskId);
    if (!source) {
      failures.push({
        jobId: item.taskId, status: 'OTHER_ERROR', result: null, failureStage: 'execution_plan',
        failureReason: `模型结果缺少任务 ${item.taskId}`,
        repairStats: {},
      });
      continue;
    }
    const validated = validateTasks([source], [item]);
    if (validated.ok) {
      tasks.push(validated.tasks[0]!);
      continue;
    }
    const contentFailure = /expandContentPlans|内容块|self_test|检查标准|修正动作|具体交付|mustContain|assetType/.test(validated.issue);
    failures.push({
      jobId: item.taskId,
      status: contentFailure ? 'CONTENT_BLOCK_UNRECOVERABLE' : 'OTHER_ERROR',
      result: null,
      failureStage: contentFailure ? 'expand_content_validation' : 'execution_plan',
      failureReason: validated.issue,
      repairStats: { contentContractValidated: false },
    });
  }
  return { tasks, failures };
}

function validateTasks(raw: unknown, expected: Array<{ taskId: string; cardId: string; topicIndex: number; lockedCoordinate: TopicCoordinate; valueType: TopicValueType; motherTopic?: MotherTopic }>) {
  if (!Array.isArray(raw)) return { ok: false as const, issue: '没有 tasks 数组', tasks: [] as BatchEditorialTask[] };
  const byId = new Map(raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map(item => [clean(item.taskId), item]));
  const tasks: BatchEditorialTask[] = [];
  for (const item of expected) {
    const source = byId.get(item.taskId);
    if (!source) return { ok: false as const, issue: `缺少任务 ${item.taskId}`, tasks: [] as BatchEditorialTask[] };
    const task: BatchEditorialTask = {
      taskId: item.taskId,
      cardId: clean(source.cardId),
      topicIndex: Number(source.topicIndex),
      direction: directionForCoordinate(item.lockedCoordinate),
      topic: clean(source.topic), lockedMotherTopic: item.motherTopic?.topic || '', audienceState: clean(source.audienceState), promise: clean(source.promise), contentAngle: item.lockedCoordinate.outcomeNote,
      expandContents: Array.isArray(source.expandContents) ? source.expandContents.map(clean).filter(Boolean).slice(0, 5) : [],
      expandContentPlans: parseExpandContentPlans(source.expandContentPlans),
      coreProblem: item.lockedCoordinate.problemNote,
      contentObject: item.lockedCoordinate.objectId,
      solutionMechanism: item.lockedCoordinate.mechanismId,
      userScene: item.lockedCoordinate.sceneId,
      emotionalAngle: clean(source.emotionalAngle), coverExecution: clean(source.coverExecution),
      valueType: isTopicValueType(source.valueType ?? source.value_type) ? (source.valueType ?? source.value_type) as TopicValueType : '' as TopicValueType,
      specificAsset: clean(source.specificAsset ?? source.specific_asset), userGain: clean(source.userGain ?? source.user_gain),
      clickReason: clean(source.clickReason ?? source.click_reason), saveReason: clean(source.saveReason ?? source.save_reason),
      delfSpecificity: ['high', 'medium', 'low'].includes(String(source.delfSpecificity ?? source.delf_specificity)) ? (source.delfSpecificity ?? source.delf_specificity) as DelfSpecificity : '' as DelfSpecificity,
      threeSecondValueCheck: source.threeSecondValueCheck === true || source.three_second_value_check === true,
      crossExamGenericRisk: ['low', 'medium', 'high'].includes(String(source.crossExamGenericRisk ?? source.cross_exam_generic_risk)) ? (source.crossExamGenericRisk ?? source.cross_exam_generic_risk) as CrossExamGenericRisk : '' as CrossExamGenericRisk,
      demandType: isTopicDemandType(source.demandType ?? source.demand_type) ? (source.demandType ?? source.demand_type) as TopicDemandType : '' as TopicDemandType,
      topicGranularity: isTopicGranularity(source.topicGranularity ?? source.topic_granularity) ? (source.topicGranularity ?? source.topic_granularity) as TopicGranularity : '' as TopicGranularity,
      subpointRisk: ['low', 'medium', 'high'].includes(String(source.subpointRisk ?? source.subpoint_risk)) ? (source.subpointRisk ?? source.subpoint_risk) as SubpointRisk : '' as SubpointRisk,
      existingBelief: item.motherTopic?.existingBelief || clean(source.existingBelief ?? source.existing_belief),
      counterBelief: item.motherTopic?.counterBelief || clean(source.counterBelief ?? source.counter_belief),
      publicTopicNaturalness: source.publicTopicNaturalness === true || source.public_topic_naturalness === true,
      motherTopicRationale: item.motherTopic?.motherTopicRationale || '',
      proposedSubtopics: item.motherTopic?.proposedSubtopics || [],
      motherTopicScore: item.motherTopic?.motherTopicScore || 0,
      xhsMotherTopicFit: item.motherTopic?.xhsMotherTopicFit || 'micro',
      xhsEditorialFit: item.motherTopic?.xhsEditorialFit || 'weak',
      topicScope: item.motherTopic?.topicScope || 'micro',
      forbiddenOverlaps: [], coordinate: item.lockedCoordinate, coordinateHash: item.lockedCoordinate.coordinateHash,
    };
    const taskText = [task.topic, task.audienceState, task.promise, task.contentAngle, task.emotionalAngle, ...task.expandContents].join(' ');
    if (/英语|英文|中式英语|雅思|托福|SAT/i.test(taskText)) {
      return { ok: false as const, issue: `任务 ${item.taskId} 混入了非DELFB2产品词`, tasks: [] as BatchEditorialTask[] };
    }
    const taskIssues = [
      task.cardId !== item.cardId ? 'cardId不匹配' : '',
      task.topicIndex !== item.topicIndex ? 'topicIndex不匹配' : '',
      !task.topic ? '缺topic' : '', task.audienceState.length < 6 ? 'audienceState过短' : '',
      !task.promise ? '缺promise' : '', !task.contentAngle ? '缺contentAngle' : '',
      task.expandContents.length < 3 ? 'expandContents不足3条' : '', task.expandContentPlans.length !== 3 ? 'expandContentPlans必须3项' : '', task.emotionalAngle.length < 8 ? 'emotionalAngle过短' : '',
      !task.coverExecution ? '缺coverExecution' : '', !isTopicValueType(task.valueType) ? 'valueType非法' : '',
      !task.specificAsset ? '缺specificAsset' : '', !task.userGain ? '缺userGain' : '',
      !task.clickReason ? '缺clickReason' : '', !task.saveReason ? '缺saveReason' : '',
      !['high', 'medium', 'low'].includes(task.delfSpecificity) ? 'delfSpecificity非法' : '',
      !task.threeSecondValueCheck ? 'threeSecondValueCheck不是true' : '',
      !['low', 'medium', 'high'].includes(task.crossExamGenericRisk) ? 'crossExamGenericRisk非法' : '',
      isAbstractUserFacingValue(task.specificAsset) ? 'specificAsset抽象' : '',
      !isTopicDemandType(task.demandType) ? 'demandType非法' : '',
      !isTopicGranularity(task.topicGranularity) ? 'topicGranularity非法' : '',
      !['low', 'medium', 'high'].includes(task.subpointRisk) ? 'subpointRisk非法' : '',
      (task.valueType === 'insight' || task.demandType === 'misconception_correction') && (!task.existingBelief || !task.counterBelief) ? '反常识缺existingBelief/counterBelief' : '',
      !task.publicTopicNaturalness ? 'publicTopicNaturalness不是true' : '',
      ...auditExpandContentPlans(task.expandContentPlans, task.valueType, task.topic, task.specificAsset),
    ].filter(Boolean);
    if (taskIssues.length) {
      return { ok: false as const, issue: `任务 ${item.taskId}：${taskIssues.join('、')}`, tasks: [] as BatchEditorialTask[] };
    }
    tasks.push(task);
  }
  return { ok: true as const, issue: '', tasks };
}

/** AI1 已决定选题本身；AI2 应直接根据任务单写内容，不再重新发起一次自由选题调用。 */
export function editorialTaskToTopicOption(
  task: BatchEditorialTask,
  card: CompetitorCreativeCard,
  capability: TemplateCapability,
  knowledgeMode: 'educational_original' | 'product_grounded' = 'educational_original',
): TopicOption & { expandContents: string[] } {
  const goalByDirection: Record<ConsensusTopicDirection, TopicOption['primaryGoal']> = {
    大痛点型: 'search', 省时路径型: 'save', 具体方法型: 'click',
  };
  const primaryGoal = capability.allowedGoals.includes(goalByDirection[task.direction])
    ? goalByDirection[task.direction]
    : capability.allowedGoals[0]!;
  const topicLane = task.direction === '大痛点型' ? 'broad_pain' : task.direction === '省时路径型' ? 'result_need' : 'narrow_knowledge';
  return {
    id: `v2_editorial_task_${task.taskId}`,
    productId: 'delf_b2_writing', templateId: card.renderer_id, primaryGoal, topicLane,
    topic: task.topic, audienceState: task.audienceState, scene: task.userScene,
    painOrDesire: task.coreProblem, promise: task.promise, contentAngle: task.contentAngle,
    plannedBlockKind: capability.acceptedBlockKinds[0], productBridge: '',
    seo: { primary: 'DELF B2写作', related: [] }, knowledgeMode,
    factTerms: [], seedSignals: [task.direction], noveltyFingerprint: `editorial-task|${task.coordinateHash}`,
    direction: task.direction, expandContents: task.expandContents, expandContentPlans: task.expandContentPlans,
    coverFitReason: task.coverExecution,
    batchTopicSlotId: task.taskId, batchEditorialTask: task,
    valueType: task.valueType, specificAsset: task.specificAsset, userGain: task.userGain,
    clickReason: task.clickReason, saveReason: task.saveReason,
    delfSpecificity: task.delfSpecificity, threeSecondValueCheck: task.threeSecondValueCheck,
    crossExamGenericRisk: task.crossExamGenericRisk,
    demandType: task.demandType, topicGranularity: task.topicGranularity, subpointRisk: task.subpointRisk,
    existingBelief: task.existingBelief, counterBelief: task.counterBelief,
    publicTopicNaturalness: task.publicTopicNaturalness,
    motherTopicRationale: task.motherTopicRationale, proposedSubtopics: task.proposedSubtopics, motherTopicScore: task.motherTopicScore,
    xhsMotherTopicFit: task.xhsMotherTopicFit,
    xhsEditorialFit: task.xhsEditorialFit, topicScope: task.topicScope,
  };
}

function clean(value: unknown) { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''; }
function emptyUsage(): AiUsageSummary { return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] }; }

const EXPAND_ASSET_TYPES: ExpandAssetType[] = ['list', 'table', 'comparison', 'before_after', 'checklist', 'framework', 'example_breakdown', 'expression_bank', 'argument_bank', 'timeline', 'decision_tree', 'step_by_step'];

function normalizeExpandAssetType(value: unknown): ExpandAssetType | '' {
  const raw = clean(value).toLowerCase();
  if (EXPAND_ASSET_TYPES.includes(raw as ExpandAssetType)) return raw as ExpandAssetType;
  if (!raw) return '';
  if (raw === 'collection' || raw === 'usable_list' || raw === 'list') return 'list';
  if (raw === 'matrix') return 'table';
  if (raw === 'comparison_table') return 'comparison';
  if (raw === 'template_list' || raw === 'collection_list') return 'list';
  if (raw === 'shortcut' || raw === 'exam_rescue') return 'step_by_step';
  if (raw === 'example' || raw === 'example_breakdown') return 'example_breakdown';
  if (raw === 'mistake') return 'before_after';
  if (raw === 'insight') return 'framework';
  if (/对比|对照|比较|a.?b/.test(raw)) return 'comparison';
  if (/前后|改写|修改|错误.*正确|纠错/.test(raw)) return 'before_after';
  if (/句型|表达|搭配|短语/.test(raw)) return 'expression_bank';
  if (/观点|理由|论据|素材/.test(raw)) return 'argument_bank';
  if (/事实库|案例库|资料库/.test(raw)) return 'example_breakdown';
  if (/清单|速查|检查/.test(raw)) return 'checklist';
  if (/表格|表单|矩阵|分类表/.test(raw)) return 'table';
  if (/例子|示例|案例|范文|拆解/.test(raw)) return 'example_breakdown';
  if (/时间|日期|倒计时|阶段/.test(raw)) return 'timeline';
  if (/决策|选择|判断树/.test(raw)) return 'decision_tree';
  if (/步骤|流程|操作/.test(raw)) return 'step_by_step';
  if (/指南|策略|方法|行动/.test(raw)) return 'framework';
  if (/框架|体系|结构/.test(raw)) return 'framework';
  if (/思维导图|关键词/.test(raw)) return 'framework';
  if (/模板|场景/.test(raw)) return 'list';
  if (/清单|合集|汇总|列表/.test(raw)) return 'list';
  // assetType is a presentation classification; the content contract below is
  // authoritative. Keep a non-empty model label executable without weakening
  // the concrete-deliverable checks.
  return 'list';
}

function normalizeGenericAdviceRisk(value: unknown): ExpandContentPlan['genericAdviceRisk'] {
  if (value === false) return 'low';
  if (value === true) return 'high';
  const raw = clean(value).toLowerCase();
  if (raw === 'low' || /无|低|低风险/.test(raw)) return 'low';
  if (raw === 'medium' || /中|中等/.test(raw)) return 'medium';
  return 'high';
}

function deriveGenericAdviceRisk(plan: Pick<ExpandContentPlan, 'concreteDeliverable' | 'mustContain' | 'exampleRequirement' | 'languageMaterialRequirement'>): ExpandContentPlan['genericAdviceRisk'] {
  const payload = `${plan.concreteDeliverable} ${plan.mustContain.join(' ')} ${plan.exampleRequirement} ${plan.languageMaterialRequirement}`;
  const directionOnly = /提升|优化|深化|加强|培养|建立|灵活运用|深度剖析|视角转换|精准表达|逻辑升级|有效复盘|迁移训练/.test(plan.concreteDeliverable)
    && !/表|清单|例子|示例|句|规则|步骤|对照|观点|主体|对象|场景|模板|连接词|法语/.test(plan.concreteDeliverable);
  if (!plan.concreteDeliverable || plan.mustContain.length < 2 || directionOnly) return 'high';
  const concreteSignals = /表|清单|例子|示例|句|规则|步骤|对照|观点|主体|对象|场景|模板|连接词|法语|词汇|短语|分类|错误|改法/.test(payload);
  if (concreteSignals && (plan.exampleRequirement.length > 0 || plan.languageMaterialRequirement.length > 0)) return 'low';
  return 'medium';
}

export function parseExpandContentPlans(value: unknown): ExpandContentPlan[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).map(item => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const modelReportedGenericAdviceRisk = normalizeGenericAdviceRisk(raw.genericAdviceRisk ?? raw.generic_advice_risk);
    const normalized = {
      title: pickText(raw, 'title'), contentGoal: pickText(raw, 'contentGoal', 'content_goal'),
      assetType: normalizeExpandAssetType(pickText(raw, 'assetType', 'asset_type')) as ExpandAssetType,
      concreteDeliverable: pickText(raw, 'concreteDeliverable', 'concrete_deliverable'),
      mustContain: pickArray(raw, 'mustContain', 'must_contain'),
      exampleRequirement: pickText(raw, 'exampleRequirement', 'example_requirement'),
      languageMaterialRequirement: pickText(raw, 'languageMaterialRequirement', 'language_material_requirement'),
      cardStructure: pickText(raw, 'cardStructure', 'card_structure'),
      genericAdviceRisk: 'medium' as ExpandContentPlan['genericAdviceRisk'],
      modelReportedGenericAdviceRisk,
    };
    normalized.genericAdviceRisk = deriveGenericAdviceRisk(normalized);
    return normalized;
  });
}

function pickText(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const candidate = raw[key];
    const value = Array.isArray(candidate) ? candidate.map(clean).filter(Boolean).join('；') : clean(candidate);
    if (value) return value;
  }
  return '';
}

function pickArray(raw: Record<string, unknown>, ...keys: string[]): string[] {
  for (const key of keys) if (Array.isArray(raw[key])) return raw[key].map(clean).filter(Boolean).slice(0, 8);
  return [];
}

interface ContentBlockValidationResult { valid: boolean; missingRequirements: string[]; problems: string[] }

export function validateExpandContentPlan(plan: ExpandContentPlan, valueType: TopicValueType, topic: string, specificAsset: string): ContentBlockValidationResult {
  const text = `${plan.concreteDeliverable} ${plan.mustContain.join(' ')} ${plan.exampleRequirement} ${plan.languageMaterialRequirement}`;
  const missing: string[] = [];
  const problems: string[] = [];
  if (!plan.title) missing.push('missing_title');
  if (!plan.assetType) missing.push('missing_asset_type');
  if (!plan.concreteDeliverable) missing.push('missing_concrete_deliverable');
  if (plan.mustContain.length < 2) missing.push('missing_must_contain');
  if (!plan.exampleRequirement) missing.push('missing_example_requirement');
  if (!plan.languageMaterialRequirement) missing.push('missing_language_material');
  if (!plan.cardStructure) missing.push('missing_card_structure');
  if (plan.genericAdviceRisk === 'high') missing.push('generic_advice_risk_high');
  if (/提升|优化|深化|加强|培养|建立|灵活运用|深度剖析|视角转换|精准表达|逻辑升级|有效复盘|迁移训练/.test(plan.concreteDeliverable)
    && !/表|清单|例子|示例|句|规则|步骤|对照|观点|主体|对象|场景|模板|连接词|法语/.test(plan.concreteDeliverable)) missing.push('direction_only_deliverable');
  if (valueType === 'mistake') {
    if (!/错误|错|不当|不自然|误用/.test(text)) missing.push('missing_error_example');
    if (!/原因|为什么|风险|问题/.test(text)) missing.push('missing_error_reason');
    if (!/修正|改法|正确|替换/.test(text)) missing.push('missing_correction');
    if (!/示例|例子|案例|法语|句子|表达/.test(text)) missing.push('missing_correct_example');
  }
  if (valueType === 'comparison' && !/对比|比较|A|B|前后|差异|普通|正确|错误/.test(text)) missing.push('missing_a_b_difference');
  if (valueType === 'before_after' && !/修改前|修改后|原句|改写|修正|正确/.test(text)) missing.push('missing_before_after_action');
  if (valueType === 'self_test' && !/检查|核对|判断|标准|符合|发现|修正|改/.test(text)) missing.push('missing_check_standard_and_fix');
  if ((topic + specificAsset).match(/素材|汇总|合集|观点库|表达库|清单|速查/) && plan.concreteDeliverable.length < 16 && plan.mustContain.length < 2) missing.push('missing_actual_items');
  if (missing.length) problems.push(`当前内容块缺少：${missing.join('、')}`);
  return { valid: missing.length === 0, missingRequirements: missing, problems };
}

function auditExpandContentPlans(plans: ExpandContentPlan[], valueType: TopicValueType, topic: string, specificAsset: string): string[] {
  const issues: string[] = [];
  for (const [index, plan] of plans.entries()) {
    const result = validateExpandContentPlan(plan, valueType, topic, specificAsset);
    if (!result.valid) issues.push(`expandContentPlans[${index + 1}]${result.missingRequirements.join('、')}`);
  }
  if (plans.length === 3 && /素材|汇总|合集|观点库|表达库|清单|速查/.test(`${topic} ${specificAsset}`)) {
    const concreteCount = plans.filter(plan => {
      const payload = `${plan.concreteDeliverable} ${plan.mustContain.join(' ')}`;
      return /观点|表达|句|句式|短语|连接词|词组|模板|例|案例|表|清单|规则|对照|主体|场景|错误|改法|称呼|结尾|步骤|流程|时间|分钟|优先|动作|检查|标准|层级|套话|功能|介词|职位|性别/.test(payload)
        || (plan.concreteDeliverable.length >= 24 && plan.mustContain.length >= 2);
    }).length;
    if (concreteCount < 3) issues.push('ASSET_PROMISE_CONSISTENCY不成立');
  }
  return issues;
}

function valueMixWarnings(tasks: BatchEditorialTask[]): string[] {
  if (tasks.length < 10) return [];
  const count = (types: TopicValueType[]) => tasks.filter(task => types.includes(task.valueType)).length;
  const warnings: string[] = [];
  const checks: Array<[string, number, number]> = [
    ['干货清单/整理', count(['usable_list', 'collection']), Math.ceil(tasks.length * 0.30)],
    ['捷径/考场急救', count(['shortcut', 'exam_rescue']), Math.ceil(tasks.length * 0.20)],
    ['避坑/对比/改写', count(['mistake', 'comparison', 'before_after']), Math.ceil(tasks.length * 0.20)],
    ['自测/案例', count(['self_test', 'example']), Math.ceil(tasks.length * 0.15)],
    ['反常识纠偏', count(['insight']), Math.max(1, Math.floor(tasks.length * 0.05))],
  ];
  for (const [label, actual, minimum] of checks) {
    if (actual < minimum) warnings.push(`批次${label}价值类型占比偏低：${actual}/${tasks.length}，建议下一批提高该类名额`);
  }
  const level3Count = tasks.filter(task => task.topicGranularity === 'level_3_micro').length;
  if (level3Count > Math.ceil(tasks.length * 0.40)) {
    warnings.push(`批次微技巧型选题占比过高：${level3Count}/${tasks.length}，建议只重生成微技巧名额，不影响其余选题`);
  }
  const highSubpointCount = tasks.filter(task => task.subpointRisk === 'high').length;
  if (highSubpointCount > Math.ceil(tasks.length * 0.20)) {
    warnings.push(`批次疑似正文小节型选题偏多：${highSubpointCount}/${tasks.length}，建议只复核高风险名额`);
  }
  return warnings;
}

function directionForCoordinate(coordinate: TopicCoordinate): ConsensusTopicDirection {
  if (coordinate.scale === 'broad' || coordinate.contentType === 'pain') return '大痛点型';
  if (coordinate.scale === 'strategy' || coordinate.contentType === 'hack' || coordinate.contentType === 'guide') return '省时路径型';
  return '具体方法型';
}
