import type { TopicOption } from './contracts';

// 母题范围，不是公开标题模板。每项列出可独立成立的中型内容域。
export const LARGE_TOPIC_DOMAINS = [
  ['subject','写作科目','DELF B2写作要学的各部分','理解写作需要准备哪些内容','题型/文体','论据/观点','语法/句型','结构/段落'],
  ['genres','题型','DELF B2主要写作题型','分清不同类型文章各自怎样写','正式信/书信','议论文/议论','论坛/公开表达','语气/语域'],
  ['language','语言','DELF B2写作语言内容','掌握写作需要的不同语言能力','语法/句法','词汇/用词','句型/句式','衔接/连接','语域/语气'],
  ['arguments','议题','DELF B2社会话题与论据准备','为不同社会领域准备可展开的观点','社会/领域/议题','观点/立场','理由/论据','例证/例子','反驳/反方'],
  ['requirements','科目要求','DELF B2写作核心要求','认识一篇作文在各方面应达到什么要求','任务/审题','内容/论据','组织/结构','语言/词汇','语域/语气'],
  ['preparation','备考','DELF B2从开始准备到考场实战','安排从入门到独立完成考试的学习','入门/诊断','积累/素材','训练/专项','模考/模拟','复盘/修改'],
  ['revision','复习','DELF B2写作考前总复习','在考前梳理各部分学习内容','题型/文体','表达/句型','论据/观点','问题/错误','时间/检查'],
  ['difficulties','短板','DELF B2写作各类常见困难','处理写不出、写不顺和写不合适等不同短板','审题/任务','内容/观点','结构/逻辑','表达/语言','语域/语气'],
  ['training','练习','DELF B2写作的不同训练内容','把学习材料转化为独立写作能力','输入/阅读','范文/仿写','独立/成文','批改/反馈','复盘/改写'],
  ['materials','积累','DELF B2写作可积累的不同材料','决定平时要积累和复习哪些东西','论据/观点','表达/词汇','句型/句式','连接/衔接','范文/检查'],
  ['beginner','入门','初次接触DELF B2写作所需的知识','从不了解考试到知道怎样开始准备','题型/文体','任务/要求','结构/段落','语言/表达','练习/训练'],
  ['transition','进阶学习','从已有法语基础过渡到B2写作的学习内容','补齐语言基础与考试写作之间的差距','句法/语法','词汇/表达','论证/论据','文体/语域','独立/练习'],
  ['grammar','语法领域','DELF B2写作所用的语法知识','认识不同语法领域怎样服务写作','时态/时体','语气/条件','从句/复合句','指代/代词','一致/配合'],
  ['lexicon','词汇领域','DELF B2写作的词汇学习内容','准备不同话题、功能与语域的用词','话题/主题','搭配/词组','同义/词义','语域/正式','功能/表达'],
  ['independent','自主备考','独立准备DELF B2写作所需的学习安排','没有固定课程时完成各方面的写作准备','材料/输入','语言/词汇','题型/文体','训练/练习','反馈/复盘'],
  ['resources','学习资源','DELF B2写作不同学习材料的选择与使用','组合教材、范文和练习资源来准备写作','教材/知识','范文/阅读','词汇/语法','论据/话题','练习/模考'],
  ['practice_cycle','学习过程','DELF B2写作从学习到反复实践的各个环节','让知识积累、尝试写作和反馈形成连续学习','知识/学习','积累/素材','仿写/范文','独立/成文','反馈/修改'],
  ['retake','重新备考','再次准备DELF B2写作时各部分的调整','重新安排已有基础上的写作准备','诊断/短板','题型/任务','语言/表达','论据/内容','模考/复盘'],
  ['application','综合应用','DELF B2不同题目中的知识综合运用','把文体、内容和语言知识用于不同写作任务','正式信/书信','议论/论坛','论据/观点','语域/语气','语言/表达'],
  ['learning_priorities','学习取舍','DELF B2写作备考各部分的学习重点','分清写作学习中不同内容的先后与投入','题型/任务','语法/语言','论据/内容','练习/训练','复习/模考'],
] as const;

export const LARGE_MINIMUM_COVERAGE = '大型选题必须天然包含多个彼此独立的中型母题。同一能力的不同层级、同一任务的不同步骤、同一痛点的多个表现不算多个母题。单一文体、论证展开、审题、时间管理、自查、逻辑连贯、交际语境、范文迁移、语气、开头结尾、单项语言技巧，即使讲完整也属于中型。';
export const MEDIUM_MINIMUM_COVERAGE = '中型是一个明确能力块、大痛点或完整任务，如正式信、论证展开、审题、自查；不能缩成单词或单句技巧。';

export function buildProductionTopicScopePlan(scope: 'large' | 'medium', count: number, recentDomains: string[] = []) {
  const ranked = LARGE_TOPIC_DOMAINS.map((domain,index)=>({domain,index,uses:recentDomains.filter(id=>id===domain[0]).length}))
    .sort((a,b)=>a.uses-b.uses || a.index-b.index);
  if(scope==='large' && count>ranked.length) throw new Error('TOPIC_DOMAIN_CAPACITY_EXCEEDED');
  // 整批只分配一次，不在第11项重新开始。每个domain和coreProblem在本批唯一。
  return Array.from({length:count},(_,index)=>{
    const domain=scope==='large'?ranked[index].domain:undefined;
    return {slot:index+1,scope:scope==='large'?'level_1_asset' as const:'level_2_strategy' as const,
      intent:scope==='large'?'mega_asset' as const:'broad_asset' as const,
      domainId:domain?.[0]||'',domainFamily:domain?.[1]||'open_planning',
      coverageDomain:domain?.[2]||'',coreProblem:domain?.[3]||'',
      requiredMotherTopics:domain?.slice(4)||[],
      minimumCoverage:scope==='large'?LARGE_MINIMUM_COVERAGE:MEDIUM_MINIMUM_COVERAGE};
  });
}

export function checkAssignedLargeScope(topic: string, promise: string, motherTopics: readonly string[]) {
  // 只识别整句明确收窄的小题，不用“包含某词”推断整篇范围。
  const subject=topic.normalize('NFKC').trim()
    .replace(/^(?:DELF\s*)?B2\s*(?:法语)?(?:写作|作文)?\s*[:：·—-]?\s*/iu,'')
    .replace(/[？?！!。]+$/u,'');
  const explicitMicro = /^(?:作文|文章|正式信)?(?:开头|结尾|第一段|最后一段)(?:到底)?(?:怎么写|如何写|的写法)$/u.test(subject)
    || /^(?:[a-zàâçéèêëîïôùûüÿœæ’'-]+\s*){1,5}(?:怎么用|如何使用|是什么意思|的用法|后面怎么接例子)$/iu.test(subject)
    || /^(?:只讲|只学|只练|只讨论)?(?:一个|单个|这一|这个|单一)(?:连接词|法语词|句型|语法点|收尾语|段落|具体题目)(?:的)?(?:用法|写法|怎么用|怎么写|解析|练习)$/u.test(subject);
  // 以下信息只提示人工查看；关键词出现可能只是大型题中的一个子模块。
  const narrowFocus=/(自查|自我诊断|交卷前.*检查|时间管理|时间分配|逻辑连贯|交际语境|范文迁移|论证展开|正式信.*语气|从审题到交卷)/u.test(topic);
  const hit=motherTopics.filter(group=>group.split('/').some(word=>promise.includes(word)));
  return {passed:!explicitMicro,
    reasons:explicitMicro?['EXPLICIT_MICRO_TOPIC']:[],
    warnings:[...(narrowFocus?['POSSIBLE_MEDIUM_FOCUS']:[]),...(hit.length<Math.min(4,motherTopics.length)?['MOTHER_TOPIC_LEXICAL_COVERAGE_UNCERTAIN']:[])],
    matchedMotherTopics:hit};
}

/** 小红书内容消费价值，不替代已有的“大痛点/省时路径/具体方法”方向。 */
export type TopicValueType =
  | 'usable_list'
  | 'shortcut'
  | 'collection'
  | 'mistake'
  | 'comparison'
  | 'before_after'
  | 'self_test'
  | 'example'
  | 'exam_rescue'
  | 'insight';

export type DelfSpecificity = 'high' | 'medium' | 'low';
export type CrossExamGenericRisk = 'low' | 'medium' | 'high';
export type TopicDemandType =
  | 'asset_seeking'
  | 'shortcut_seeking'
  | 'misconception_correction'
  | 'mistake_avoidance'
  | 'improvement_need'
  | 'exam_preparation'
  | 'comparison_seeking';
export type TopicGranularity = 'level_1_asset' | 'level_2_strategy' | 'level_3_micro';
/** 仅用于 Topic AI 的批次发牌；可作为可选追溯元数据随 Topic 保存。 */
export type TopicScopeIntent = 'mega_asset' | 'broad_problem' | 'broad_asset';

interface TopicDomainCard {
  coverageDomain: string;
  family: string;
  coreProblem: string;
  minimumCoverage: string;
}

// Mega只放“完整体系/完整任务链/跨模块总资产”。审题、时间管理、
// 范文迁移等单项完整任务属于 broad asset，不能再借槽位冒充Mega。
const MEGA_TOPIC_DOMAIN_CARDS: readonly TopicDomainCard[] = [
  {coverageDomain:'从审题、构思、起草到检查交卷的完整写作流程',family:'workflow',coreProblem:'不知道一篇B2作文从拿题到交卷完整怎么做',minimumCoverage:'至少覆盖审题、构思或提纲、正文展开、检查交卷中的3个独立阶段'},
  {coverageDomain:'贯穿句子、段落与全文的B2写作语法体系',family:'grammar',coreProblem:'语法知识零散，不知道整篇写作真正需要哪些语法能力',minimumCoverage:'至少覆盖句子结构、时态语气、复杂句、衔接一致性中的3个独立模块'},
  {coverageDomain:'按写作功能和交际目的组织的完整表达与句型体系',family:'expression',coreProblem:'背了零散表达却不知道在整篇写作中何时使用',minimumCoverage:'至少覆盖表达观点、说明理由、举例论证、转折让步、收尾中的3类功能'},
  {coverageDomain:'跨常见社会议题反复使用的观点、理由、例证与反驳素材总库',family:'argument',coreProblem:'面对不同社会议题时缺少可展开的观点和论据',minimumCoverage:'至少覆盖多个议题方向，并同时包含观点、理由、例证或反驳中的3类资产'},
  {coverageDomain:'DELF B2常见写作任务、文体、对象、语域与格式的完整地图',family:'genre',coreProblem:'不同题目里分不清要写什么文体、写给谁以及使用什么语气格式',minimumCoverage:'至少覆盖任务识别、主要文体、读者对象、语域格式中的3个独立模块'},
  {coverageDomain:'从日常训练、能力补缺到考前冲刺的完整备考路线',family:'preparation',coreProblem:'不知道B2写作从平时到考前应该按什么主线准备',minimumCoverage:'至少覆盖能力诊断、日常训练、材料积累、模拟复盘或考前安排中的3个阶段'},
  {coverageDomain:'覆盖任务完成、结构论证、语域和语言准确性的完整失分修正体系',family:'quality',coreProblem:'作文问题分散，不知道哪些错误影响整篇质量以及如何系统修正',minimumCoverage:'至少覆盖任务回应、结构论证、语域、语法词汇中的3个质量层面'},
  {coverageDomain:'从初稿到可交卷成文的全文检查、修改与复盘体系',family:'revision',coreProblem:'写完后只会查拼写，不知道如何把整篇文章检查和修改完整',minimumCoverage:'至少覆盖任务、结构、段落衔接、语言准确性中的3层检查与修改'},
  {coverageDomain:'从句子、段落到整篇达到B2要求的完整能力差距地图',family:'b2_level',coreProblem:'能写出来但不知道整篇为什么仍不像B2水平',minimumCoverage:'至少覆盖句子质量、段落展开、全文组织、语域准确中的3个层面'},
  {coverageDomain:'把题目转成观点、结构、表达并完成成文的整套输出系统',family:'output',coreProblem:'知识学过不少，但拿到新题仍不能组织成完整文章',minimumCoverage:'至少覆盖任务判断、观点生成、结构安排、语言实现中的3个环节'},
  {coverageDomain:'覆盖立场、理由、例子、反驳与结论的完整论证体系',family:'reasoning',coreProblem:'文章有观点但整套论证不完整，容易变成观点堆叠',minimumCoverage:'至少覆盖立场、理由、例证、反驳、结论中的3个不同论证功能'},
  {coverageDomain:'覆盖学习、积累、练习、模拟与复盘的B2写作资料使用体系',family:'learning',coreProblem:'资料很多却不知道如何组合使用并转化为写作能力',minimumCoverage:'至少覆盖资料选择、内容积累、针对性练习、模拟复盘中的3个模块'},
] as const;

const BROAD_PROBLEM_DOMAIN_CARDS: readonly TopicDomainCard[] = [
  {coverageDomain:'B2写作到底应该准备什么',family:'preparation',coreProblem:'资料很多但不知道备考重点',minimumCoverage:'围绕同一个备考问题覆盖至少3个能力或准备维度'},
  {coverageDomain:'有观点却不会把文章完整展开',family:'argument',coreProblem:'想法只能写一两句，无法持续展开',minimumCoverage:'覆盖从观点到理由、例子和段落推进的完整问题，不缩成单个句型'},
  {coverageDomain:'能写完但整体不像B2水平',family:'quality',coreProblem:'文章完成了但结构、语域和语言仍显得基础',minimumCoverage:'覆盖至少3个造成整体水平不足的不同层面'},
  {coverageDomain:'每段都写了但全文仍然散乱',family:'coherence',coreProblem:'段落之间重复、跳跃或缺少整体主线',minimumCoverage:'覆盖段内组织、段间衔接和全文主线，不缩成单个连接词'},
  {coverageDomain:'不同写作任务之间总是切换错语气和格式',family:'genre',coreProblem:'面对不同对象和文体时容易混用表达方式',minimumCoverage:'覆盖任务、对象、语域和格式中的至少3个判断维度'},
  {coverageDomain:'背了范文和模板，换题仍然不会写',family:'transfer',coreProblem:'记住材料却不能迁移到新题',minimumCoverage:'覆盖识别结构、提取功能、换题应用等完整迁移问题'},
  {coverageDomain:'考场时间一紧就写不完或草草收尾',family:'time',coreProblem:'限时环境下无法完成整篇写作',minimumCoverage:'覆盖时间取舍、卡壳应对和完成交卷，不缩成一个分钟数字'},
  {coverageDomain:'写完后不知道从哪里检查和修改',family:'revision',coreProblem:'能发现不踏实，却不知道修改顺序',minimumCoverage:'覆盖至少3个不同层面的检查判断，不缩成拼写检查'},
] as const;

const BROAD_ASSET_DOMAIN_CARDS: readonly TopicDomainCard[] = [
  {coverageDomain:'不同目的正式信的语气、结构与表达',family:'formal_letter',coreProblem:'正式信面对不同目的和对象时不会选择写法',minimumCoverage:'完整交付正式信任务判断、语气、结构和代表性表达中的至少3部分'},
  {coverageDomain:'题目要求、读者对象与写作任务的审题定位',family:'task_analysis',coreProblem:'动笔前不能准确判断题目要求',minimumCoverage:'完整交付指令、对象、文体或范围中的至少3类审题信息'},
  {coverageDomain:'把观点扩展成完整主体段的论证方法',family:'argument',coreProblem:'单个观点无法形成完整主体段',minimumCoverage:'完整交付中心句、解释、例证或收束中的至少3个功能位'},
  {coverageDomain:'考场时间分配、取舍与卡壳应对',family:'time',coreProblem:'60分钟内不能稳定完成各阶段',minimumCoverage:'完整交付阶段分配、产出目标和超时应对'},
  {coverageDomain:'交卷前按优先级执行的全文自查清单',family:'revision',coreProblem:'检查没有顺序，只盯局部错误',minimumCoverage:'完整交付任务、逻辑、语言等至少3层检查动作'},
  {coverageDomain:'范文拆解、仿写与迁移到新题目的练习',family:'transfer',coreProblem:'范文只能背，不能迁移使用',minimumCoverage:'完整交付拆解、提取、仿写和换题迁移中的至少3步'},
  {coverageDomain:'连接词按逻辑功能分类、选择与替换',family:'expression',coreProblem:'连接词会背但使用重复或逻辑不匹配',minimumCoverage:'覆盖至少3类逻辑功能并包含选择或替换应用'},
  {coverageDomain:'让句子从简单表达变成完整说明的扩写方法',family:'sentence',coreProblem:'句子信息单薄，无法补充原因条件或结果',minimumCoverage:'覆盖至少3种不同扩写关系并给出完整应用'},
  {coverageDomain:'常见写作文体的任务、语气和格式对照',family:'genre',coreProblem:'不同文体的要求容易混淆',minimumCoverage:'至少对照3个独立维度，而不是只比较一个开头'},
  {coverageDomain:'开头、主体与结尾之间的结构衔接',family:'structure',coreProblem:'文章各部分都有内容但连接不顺',minimumCoverage:'完整覆盖开头、主体、结尾及其衔接关系'},
  {coverageDomain:'例子、证据和说明材料的选择与嵌入',family:'argument',coreProblem:'论据存在但不能有效服务观点',minimumCoverage:'完整交付材料选择、放置和与中心句连接的方法'},
  {coverageDomain:'提出异议、回应反方与收束立场的反驳结构',family:'argument',coreProblem:'议论文只会单向陈述，不能处理反方观点',minimumCoverage:'完整交付引入异议、回应、让步或回扣立场中的至少3部分'},
] as const;

export const MEGA_TOPIC_COVERAGE_DOMAINS = MEGA_TOPIC_DOMAIN_CARDS.map(card=>card.coverageDomain);
export const BROAD_PROBLEM_COVERAGE_DOMAINS = BROAD_PROBLEM_DOMAIN_CARDS.map(card=>card.coverageDomain);
export const BROAD_ASSET_COVERAGE_DOMAINS = BROAD_ASSET_DOMAIN_CARDS.map(card=>card.coverageDomain);

export interface TopicScopeAssignment {
  slot: number;
  scope: TopicGranularity;
  intent: TopicScopeIntent;
  coverageDomain: string;
  domainFamily: string;
  coreProblem: string;
  minimumCoverage: string;
  userAngle: string;
  deliveryAngle: string;
}

const USER_ANGLE_CYCLE = [
  '第一次系统准备B2写作，需要先看清全貌',
  '学过不少知识，但真正动笔时仍会卡住',
  '时间有限，希望快速抓住最值得做的动作',
  '能写完文章，但不知道怎样把整体质量再提高',
  '考前需要把零散材料整理成可执行的准备方案',
] as const;

const DELIVERY_ANGLE_CYCLE = [
  '用总览地图加代表性应用交付',
  '用完整操作顺序加关键判断点交付',
  '用分类资产加使用场景交付',
  '用对照框架加一份完整示例交付',
  '用自查路线加可直接执行的清单交付',
] as const;
export type SubpointRisk = 'low' | 'medium' | 'high';

export const TOPIC_VALUE_TYPES: TopicValueType[] = [
  'usable_list', 'shortcut', 'collection', 'mistake', 'comparison',
  'before_after', 'self_test', 'example', 'exam_rescue', 'insight',
];

export const TOPIC_DEMAND_TYPES: TopicDemandType[] = [
  'asset_seeking', 'shortcut_seeking', 'misconception_correction', 'mistake_avoidance',
  'improvement_need', 'exam_preparation', 'comparison_seeking',
];

export const TOPIC_GRANULARITIES: TopicGranularity[] = ['level_1_asset', 'level_2_strategy', 'level_3_micro'];

export const TOPIC_DEMAND_LABELS: Record<TopicDemandType, string> = {
  asset_seeking: '找整理好的资料、合集、速查表或表达库',
  shortcut_seeking: '找更快、更省力的处理办法',
  misconception_correction: '纠正备考者原本相信的做法',
  mistake_avoidance: '避开常见错误和容易扣分的地方',
  improvement_need: '解决具体写作问题',
  exam_preparation: '判断备考阶段真正该关注什么',
  comparison_seeking: '寻找两种写法、方法或结果的差异',
};

export const TOPIC_VALUE_TYPE_LABELS: Record<TopicValueType, string> = {
  usable_list: '干货清单型：点开就能拿到表达、角度、句型或步骤清单',
  shortcut: '捷径省时型：少走弯路、快速判断、固定顺序',
  collection: '宝藏整理型：汇总、速查表、分类表、观点库或句型库',
  mistake: '避坑型：指出常见错误、误用和高频误区',
  comparison: '对比型：普通与B2、错误与正确、修改前后对照',
  before_after: '改写升级型：展示原句如何改成更适合B2写作的表达',
  self_test: '自测检查型：清单、判断题、评分维度或交卷前检查',
  example: '案例拆解型：用一条例子或范文展示如何展开',
  exam_rescue: '考场急救型：陌生题、没观点、时间不够等现场处理',
  insight: '反常识纠偏型：指出一个备考者常做但方向不对的动作',
};

/** 批次配额：列表/整理约30%，捷径/急救约20%，避坑/对比/改写约20%，自测/案例约15%，其余为纠偏。 */
const BATCH_VALUE_CYCLE: TopicValueType[] = [
  'usable_list', 'collection', 'usable_list', 'collection', 'shortcut',
  'exam_rescue', 'shortcut', 'exam_rescue', 'mistake', 'comparison',
  'before_after', 'mistake', 'self_test', 'example', 'self_test', 'insight',
  'collection', 'usable_list', 'comparison', 'insight',
];

export function valueTypeForBatchIndex(index: number, userDirection = ''): TopicValueType {
  const text = userDirection.toLocaleLowerCase();
  const preferred = /汇总|清单|速查|资料/.test(text)
    ? ['collection', 'usable_list', 'comparison', 'self_test'] as TopicValueType[]
    : /攻略|步骤|路径|邪修|技巧/.test(text)
      ? ['shortcut', 'exam_rescue', 'mistake', 'usable_list'] as TopicValueType[]
      : BATCH_VALUE_CYCLE;
  return preferred[index % preferred.length]!;
}

// DELF B2 标准生产批次只发“大题”：Level1 总问题型 60%，Level2 常规大资产 40%。
// Level3 继续保留用于读取历史数据和其他兼容路径，但不再由标准批次自动分配。
const BATCH_GRANULARITY_CYCLE: TopicGranularity[] = [
  'level_1_asset', 'level_1_asset', 'level_2_strategy', 'level_1_asset',
  'level_2_strategy', 'level_1_asset', 'level_1_asset', 'level_2_strategy',
  'level_1_asset', 'level_2_strategy', 'level_1_asset', 'level_1_asset',
  'level_2_strategy', 'level_1_asset', 'level_2_strategy', 'level_1_asset',
  'level_1_asset', 'level_2_strategy', 'level_1_asset', 'level_2_strategy',
];

const BATCH_DEMAND_CYCLE: TopicDemandType[] = [
  'asset_seeking', 'asset_seeking', 'misconception_correction', 'exam_preparation',
  'shortcut_seeking', 'asset_seeking', 'comparison_seeking', 'mistake_avoidance',
  'asset_seeking', 'misconception_correction', 'exam_preparation', 'improvement_need',
  'asset_seeking', 'shortcut_seeking', 'comparison_seeking', 'misconception_correction',
  'asset_seeking', 'mistake_avoidance', 'exam_preparation', 'asset_seeking',
];

export function demandTypeForBatchIndex(index: number): TopicDemandType { return BATCH_DEMAND_CYCLE[index % BATCH_DEMAND_CYCLE.length]!; }
export function granularityForBatchIndex(index: number): TopicGranularity { return BATCH_GRANULARITY_CYCLE[index % BATCH_GRANULARITY_CYCLE.length]!; }
export function scopeIntentForBatchIndex(index: number): TopicScopeIntent {
  if (granularityForBatchIndex(index) === 'level_2_strategy') return 'broad_asset';
  // 每10篇的6个Level 1中，4个给“整套体系/大体量获得物”，2个给上层用户问题。
  return [0, 1, 3, 5].includes(index % 10) ? 'mega_asset' : 'broad_problem';
}

function cardsForIntent(intent: TopicScopeIntent): readonly TopicDomainCard[] {
  if (intent === 'mega_asset') return MEGA_TOPIC_DOMAIN_CARDS;
  if (intent === 'broad_problem') return BROAD_PROBLEM_DOMAIN_CARDS;
  return BROAD_ASSET_DOMAIN_CARDS;
}

/**
 * 给一批 Topic 先分配互相错开的内容领域，再交给模型写公开选题。
 * 比例仍按每10个名额的4个Mega、2个大问题、4个大资产循环；
 * 但去重历史覆盖本次请求的全部名额，20篇不会在第11篇清空重来。
 * rotationIndex只改变从领域池哪里开始，不把具体题目永久写死。
 */
export function buildTopicScopeAssignments(count: number, rotationIndex = 0): TopicScopeAssignment[] {
  const safeCount = Math.max(1, Math.min(20, Math.trunc(count)));
  const assignments: TopicScopeAssignment[] = [];
  const rotation = Math.abs(Math.trunc(rotationIndex));
  const usedFamilies = new Set<string>();
  const usedProblems = new Set<string>();
  const ordinals: Record<TopicScopeIntent, number> = { mega_asset: 0, broad_problem: 0, broad_asset: 0 };

  for (let blockStart = 0; blockStart < safeCount; blockStart += 10) {
    const blockLength = Math.min(10, safeCount - blockStart);
    const blockRotation = rotation * 2 + Math.floor(blockStart / 10);

    for (let localIndex = 0; localIndex < blockLength; localIndex += 1) {
      const absoluteIndex = blockStart + localIndex;
      const intent = scopeIntentForBatchIndex(absoluteIndex);
      const pool = cardsForIntent(intent);
      const ordinal = ordinals[intent]++;
      const quota = intent === 'mega_asset' ? 4 : intent === 'broad_problem' ? 2 : 4;
      const start = (blockRotation * quota + ordinal) % pool.length;
      let selected = pool[start]!;

      const ordered = Array.from({length:pool.length},(_,step)=>pool[(start+step)%pool.length]!);
      // 核心问题全批次优先不重复；内容家族只做优先错开。同一Family确有必要
      // 可以再次使用，但必须换成另一个真实问题，不能把20篇当两套10篇重发。
      selected = ordered.find(candidate=>!usedProblems.has(candidate.coreProblem)&&!usedFamilies.has(candidate.family))
        || ordered.find(candidate=>!usedProblems.has(candidate.coreProblem))
        || selected;

      usedFamilies.add(selected.family);
      usedProblems.add(selected.coreProblem);
      assignments.push({
        slot: absoluteIndex + 1,
        scope: granularityForBatchIndex(absoluteIndex),
        intent,
        coverageDomain: selected.coverageDomain,
        domainFamily: selected.family,
        coreProblem: selected.coreProblem,
        minimumCoverage: selected.minimumCoverage,
        userAngle: USER_ANGLE_CYCLE[(blockRotation + localIndex) % USER_ANGLE_CYCLE.length]!,
        deliveryAngle: DELIVERY_ANGLE_CYCLE[(blockRotation * 2 + localIndex) % DELIVERY_ANGLE_CYCLE.length]!,
      });
    }
  }

  return assignments;
}

export function megaCoverageDomainForOrdinal(megaOrdinal: number, rotationIndex = 0, batchSize = 10): string {
  const step = batchSize > 10 ? 8 : 4;
  const offset = Math.abs(rotationIndex) * step;
  return MEGA_TOPIC_COVERAGE_DOMAINS[(offset + megaOrdinal) % MEGA_TOPIC_COVERAGE_DOMAINS.length]!;
}

export function isTopicValueType(value: unknown): value is TopicValueType {
  return typeof value === 'string' && TOPIC_VALUE_TYPES.includes(value as TopicValueType);
}

export function isTopicDemandType(value: unknown): value is TopicDemandType {
  return typeof value === 'string' && TOPIC_DEMAND_TYPES.includes(value as TopicDemandType);
}

export function isTopicGranularity(value: unknown): value is TopicGranularity {
  return value === 'level_1_asset' || value === 'level_2_strategy' || value === 'level_3_micro';
}

export function isAbstractUserFacingValue(value: string): boolean {
  return /提升能力|深化理解|优化逻辑|建立体系|稳定节奏|改善思维|提升水平|强化训练|聚焦核心|诊断误区|重构思维|稳定考感|多维视角|循环检测|优先级策略/.test(value);
}

export function valueTypeIsCompatibleWithAsset(valueType: TopicValueType, asset: string): boolean {
  const text = asset.trim();
  if (!text) return false;
  const expected = {
    usable_list: /个|组|表达|句型|角度|清单|表|速查|搭配|步骤/,
    shortcut: /步|分钟|顺序|判断|方法|技巧|攻略|急救/,
    collection: /表|清单|汇总|速查|词库|句型库|观点库|整理/,
    mistake: /避坑|误区|错误|误用|对照|扣分|慎用/,
    comparison: /对比|比较|正误|错误|正确|修改前|修改后|B1|B2/,
    before_after: /改写|升级|修改前|修改后|普通|B2/,
    self_test: /自查|检查|清单|判断|评分|测试|核对/,
    example: /例子|案例|范文|原句|段落|示例|拆解/,
    exam_rescue: /考场|陌生题|时间|没观点|跑题|急救|忘词/,
    insight: /反常识|误区|真正|背范文|模板|纠偏/,
  } as const;
  return expected[valueType].test(text);
}

export function inferTopicValueDefaults(topic: Pick<TopicOption, 'topic' | 'promise' | 'contentAngle'>): {
  valueType: TopicValueType;
  specificAsset: string;
  threeSecondValueCheck: boolean;
} {
  const text = `${topic.topic} ${topic.promise} ${topic.contentAngle}`;
  const valueType: TopicValueType = /自查|检查|清单/.test(text) ? 'self_test'
    : /对比|正误|修改前|修改后/.test(text) ? 'comparison'
      : /避坑|误区|别再|慎用/.test(text) ? 'mistake'
        : /考场|陌生题|没观点|时间不够/.test(text) ? 'exam_rescue'
          : /汇总|整理|速查|词库|句型库/.test(text) ? 'collection'
            : /[0-9一二三四五六七八九十]+个|表达|句型|搭配/.test(text) ? 'usable_list'
              : 'example';
  const specificAsset = valueType === 'self_test' ? '一张可逐项核对的自查清单'
    : valueType === 'comparison' ? '一组普通写法与B2写法对照'
      : valueType === 'mistake' ? '一组常见错误与改法对照'
        : valueType === 'exam_rescue' ? '一套考场现场处理顺序'
          : valueType === 'collection' ? '一张分类速查表'
            : valueType === 'usable_list' ? '一组可以直接使用的法语表达或写作角度'
              : '一个完整例子及其拆解过程';
  return { valueType, specificAsset, threeSecondValueCheck: true };
}
