import type { ExamScope, ProductId } from '@/types/data';
import { buildProductionTopicScopePlan, LARGE_MINIMUM_COVERAGE, MEDIUM_MINIMUM_COVERAGE } from './topic-value';

/**
 * Topic 的“发牌”是内部编辑任务，不是公开标题库。
 * 三个商品走同一条 Topic 节点；不同的只有考试身份、可讲的母题和真实用户处境。
 */
export type DemandArchetype =
  | 'OUTPUT_BLOCKED'
  | 'PRACTICE_NO_PROGRESS'
  | 'EXAM_FIRST_TIME'
  | 'DIAGNOSIS_UNKNOWN'
  | 'TIME_PRESSURE'
  | 'MATERIAL_OVERLOAD'
  | 'KNOWLEDGE_NOT_RETRIEVABLE'
  | 'PERFORMANCE_ANXIETY'
  | 'TASK_CONFUSION'
  | 'READING_LISTENING_STUCK';

export interface DemandCard {
  id: string;
  situation: string;
  trigger: string;
  frustration: string;
  desiredOutcome: string;
  lossIfIgnored: string;
  searchLanguage: string[];
  examScope: ExamScope | undefined;
  motherDomain: string;
  demandArchetype: DemandArchetype;
}

export interface ProductTopicScopeCard {
  id: string;
  family: string;
  coverageDomain: string;
  coreProblem: string;
  motherTopics: string[];
  /**
   * Demand comes first.  A content domain may constrain what we can deliver,
   * but it must not be the reason a note is published.
   */
  demand: Omit<DemandCard, 'id' | 'examScope' | 'motherDomain' | 'demandArchetype'> & {
    demandArchetype: DemandArchetype;
  };
}

export interface AssignedProductTopicScope {
  slot: number;
  scope: 'level_1_asset' | 'level_2_strategy';
  intent: 'mega_asset' | 'broad_asset';
  domainId: string;
  domainFamily: string;
  coverageDomain: string;
  coreProblem: string;
  requiredMotherTopics: string[];
  minimumCoverage: string;
  demand: DemandCard;
}

type DemandOverride = Partial<ProductTopicScopeCard['demand']>;

const DEFAULT_DEMAND_ARCHETYPE: DemandArchetype = 'OUTPUT_BLOCKED';
const DEMAND_ARCHETYPE_BY_CARD_ID: Record<string, DemandArchetype> = {
  tef_full_prep: 'MATERIAL_OVERLOAD', tef_writing: 'TASK_CONFUSION', tef_speaking: 'TASK_CONFUSION',
  tef_clb_goal: 'TIME_PRESSURE', tef_writing_ideas: 'OUTPUT_BLOCKED', tef_schedule: 'TIME_PRESSURE',
  tef_listening: 'READING_LISTENING_STUCK', tef_reading: 'READING_LISTENING_STUCK', tef_expression: 'KNOWLEDGE_NOT_RETRIEVABLE',
  tef_vocab: 'KNOWLEDGE_NOT_RETRIEVABLE', tef_process: 'EXAM_FIRST_TIME', tef_mock: 'DIAGNOSIS_UNKNOWN',
  tcf_full_prep: 'MATERIAL_OVERLOAD', tcf_writing: 'TASK_CONFUSION', tcf_speaking: 'TASK_CONFUSION',
  tcf_goal: 'TIME_PRESSURE', tcf_writing_ideas: 'OUTPUT_BLOCKED', tcf_schedule: 'PERFORMANCE_ANXIETY',
  tcf_listening: 'READING_LISTENING_STUCK', tcf_reading: 'READING_LISTENING_STUCK', tcf_expression: 'KNOWLEDGE_NOT_RETRIEVABLE',
  tcf_vocab: 'KNOWLEDGE_NOT_RETRIEVABLE', tcf_process: 'EXAM_FIRST_TIME', tcf_mock: 'DIAGNOSIS_UNKNOWN',
  exam_choice: 'DIAGNOSIS_UNKNOWN', common_immigration_prep: 'MATERIAL_OVERLOAD', common_four_skills: 'PRACTICE_NO_PROGRESS',
  common_mock: 'DIAGNOSIS_UNKNOWN', common_target: 'TIME_PRESSURE', common_schedule: 'TIME_PRESSURE',
  common_output: 'OUTPUT_BLOCKED', common_vocabulary: 'KNOWLEDGE_NOT_RETRIEVABLE', common_exam_day: 'PERFORMANCE_ANXIETY', common_materials: 'MATERIAL_OVERLOAD',
  tcf7_full_writing: 'PERFORMANCE_ANXIETY', tcf7_task1: 'TASK_CONFUSION', tcf7_task2: 'OUTPUT_BLOCKED',
  tcf7_task3: 'TASK_CONFUSION', tcf7_correction: 'DIAGNOSIS_UNKNOWN', tcf7_training: 'TIME_PRESSURE',
  tcf7_task_format: 'TASK_CONFUSION', tcf7_language: 'TASK_CONFUSION', tcf7_ideas: 'OUTPUT_BLOCKED',
  tcf7_coherence: 'OUTPUT_BLOCKED', tcf7_timing: 'TIME_PRESSURE', tcf7_examples: 'PRACTICE_NO_PROGRESS',
};

// 经过本轮审计，TCF 卡不再用“科目/课程模块”冒充用户需求。尤其整体
// 备考、短板诊断、训练计划三张卡必须分别对应三个不能互换的真实处境。
const DEMAND_OVERRIDES: Record<string, DemandOverride> = {
  tcf_full_prep: {
    situation: '刚开始准备TCF Canada，发现除了听说读写，还有写作和口语各三项任务。',
    trigger: '资料越存越多，每份都只讲其中一科，越看越怕自己漏掉关键任务。',
    frustration: '已经收藏了不少资料，却无法判断哪些现在必须留、哪些可以先停掉。',
    desiredOutcome: '先看懂整场考试和各任务的关系，知道手上的资料该保留什么、暂停什么。',
    lossIfIgnored: '会持续在新资料之间切换，时间被收藏和比较消耗，真正需要准备的输出任务反而被拖后。',
    searchLanguage: ['TCF Canada资料太多怎么选', 'TCF Canada先学什么', 'TCF Canada写作口语三题怎么准备'],
  },
  tcf_writing: {
    situation: '正在练TCF Canada写作，但一直把三道题当成同一种作文来写。',
    trigger: '第一次限时练完后，发现有的题没回应任务，有的题字数和内容都失控。',
    frustration: '背过通用模板，换到不同任务仍不知道每一题到底要完成什么。',
    desiredOutcome: '分清三项任务各自的目标、下笔动作和练习方式。',
    lossIfIgnored: '会继续用同一套模板硬套三道题，练得多也无法解决任务完成问题。',
    searchLanguage: ['TCF Canada写作三题怎么练', 'TCF Canada Tache 1 2 3区别', 'TCF Canada写作任务要求'],
  },
  tcf_speaking: {
    situation: '准备TCF Canada口语，基础表达会一些，但一进互动题就接不住。',
    trigger: '模拟时发现不同口语任务的第一句、追问和表达观点完全不是一回事。',
    frustration: '背过句子，临场还是不知道该先问、先回应还是先表态。',
    desiredOutcome: '按三项任务建立可反复练的口语动作，不再把所有题当背稿。',
    lossIfIgnored: '会继续只练独白，真实互动一变化就卡住。',
    searchLanguage: ['TCF Canada口语三题怎么准备', 'TCF Canada口语互动题怎么练', 'TCF Canada口语任务区别'],
  },
  tcf_goal: {
    situation: '已经有目标分数或考试日期，刚做完第一套题，却不知道短板该怎么排序。',
    trigger: '分数出来后发现每科都有问题，担心时间不够又不敢放掉任何一科。',
    frustration: '试过平均刷四科，投入不少，但下一次模拟依旧看不出最该优先解决什么。',
    desiredOutcome: '根据目标、当前表现和考试时间排出明确的补弱优先级。',
    lossIfIgnored: '会把有限时间平均摊薄，焦虑增加但关键短板没有被真正处理。',
    searchLanguage: ['TCF Canada先补哪一科', 'TCF Canada目标分数怎么规划', 'TCF Canada模考后怎么安排'],
  },
  tcf_writing_ideas: {
    situation: '写TCF Canada T2/T3时能看懂材料，也有态度，却写不出能展开的内容。',
    trigger: '限时写作一过开头就只剩重复观点，材料之间也不知道怎么比较。',
    frustration: '试过背万能论据，换一个社会话题还是从零构思。',
    desiredOutcome: '把题目材料、个人立场和理由例子组织成能完成的段落。',
    lossIfIgnored: '会持续把时间耗在临场想内容，文章容易空泛或只复述材料。',
    searchLanguage: ['TCF Canada写作没思路怎么办', 'TCF Canada T2 T3观点怎么展开', 'TCF Canada写作材料比较'],
  },
  tcf_schedule: {
    situation: '距离TCF Canada还有几周，已经在练，但每天做什么不断变化，训练无法连续。',
    trigger: '计划执行两三天就被工作、弱项或新资料打断，回头看没有整体进度。',
    frustration: '试过照搬别人计划，也试过每天随便刷题，都没形成能复盘的节奏。',
    desiredOutcome: '把已确定的训练重点排成一段可执行、可复盘的周期。',
    lossIfIgnored: '会在不同资料和科目之间来回切换，临近考试仍没有完成一轮有效训练。',
    searchLanguage: ['TCF Canada备考计划', 'TCF Canada考前几周怎么练', 'TCF Canada每天练什么'],
  },
  tcf_listening: {
    situation: '刷TCF Canada听力时常常跟丢，做完只知道错了几题。',
    trigger: '下一套题又在相似位置跟不上，开始怀疑是词汇、语速还是做题动作的问题。',
    frustration: '反复听原文或只看错题答案，却没有找到下一次具体怎么练。',
    desiredOutcome: '能把一次跟丢归因并转成下一轮听辨、复盘和限时练习。',
    lossIfIgnored: '会持续重复同一种听力错误，刷题数量增加但得分不稳定。',
    searchLanguage: ['TCF Canada听力跟不上怎么办', 'TCF Canada听力怎么复盘', 'TCF Canada听力练习方法'],
  },
  tcf_reading: {
    situation: 'TCF Canada阅读常来不及，或在细节题上反复犹豫。',
    trigger: '限时练习中总有后半部分没做完，明明读过却还是不敢选。',
    frustration: '试过逐句翻译和反复精读，时间反而被一两题拖住。',
    desiredOutcome: '形成能在套题里执行的定位、取舍和复盘顺序。',
    lossIfIgnored: '会继续把阅读当翻译练习，限时分数始终起不来。',
    searchLanguage: ['TCF Canada阅读做不完', 'TCF Canada阅读时间不够', 'TCF Canada阅读怎么定位'],
  },
  tcf_expression: {
    situation: '写作和口语都有基础句，但真正要表达观点或回应对方时还是断掉。',
    trigger: '发现背过的表达脱离真实任务，换一个话题就无法调出来。',
    frustration: '不断收集句型，却没练过这些句子应该在什么任务动作里使用。',
    desiredOutcome: '把表达按“说明、回应、表态、推进互动”等真实动作组织起来。',
    lossIfIgnored: '笔记会越来越多，实际输出仍然停留在简单句和沉默。',
    searchLanguage: ['TCF Canada写作口语表达', 'TCF Canada观点怎么表达', 'TCF Canada口语互动表达'],
  },
  tcf_vocab: {
    situation: '单词本越记越多，但写TCF Canada写作和口语时还是觉得没有内容可说。',
    trigger: '遇到社会话题时想不起已背词，也无法把单词串成理由和例子。',
    frustration: '试过按字母或词表背词，记住后没有进入任何实际输出。',
    desiredOutcome: '按主题、搭配和输出场景把词汇变成可调用的材料。',
    lossIfIgnored: '会继续增加孤立词汇，真实任务中依旧空泛、重复。',
    searchLanguage: ['TCF Canada主题词汇', 'TCF Canada写作口语词汇', '法语背词用不出来怎么办'],
  },
  tcf_process: {
    situation: '第一次准备TCF Canada，备考和报名流程同时压过来。',
    trigger: '考试日期临近，才发现不确定哪些事项要提前确认、当天要准备什么。',
    frustration: '信息零散地存在不同页面，越查越怕遗漏。',
    desiredOutcome: '按时间线理清报名、备考、考试当天和考后记录的必要动作。',
    lossIfIgnored: '流程焦虑会打断复习，甚至临近考试才补救本可提前处理的事项。',
    searchLanguage: ['TCF Canada报名流程', 'TCF Canada考试当天准备', 'TCF Canada考前清单'],
  },
  tcf_mock: {
    situation: '已经开始做TCF Canada套题，但每次只留下一个总分。',
    trigger: '连续几周模考后，分数波动却看不出下一轮到底该改哪里。',
    frustration: '试过逐题订正，下一次仍会犯同类错误，训练没有反馈闭环。',
    desiredOutcome: '把模考结果转成按影响程度排序的下一轮训练决定。',
    lossIfIgnored: '会陷入“做题—对答案—再做题”，时间消耗很大却无法稳定提升。',
    searchLanguage: ['TCF Canada模考后怎么复盘', 'TCF Canada错题怎么分析', 'TCF Canada模拟题怎么用'],
  },
};

const TEF_CARDS: ProductTopicScopeCard[] = [
  card('tef_full_prep', 'TEF Canada整体备考', 'TEF Canada四科与备考主线', '准备TEF Canada时不知道四科该怎样一起安排', ['阅读', '听力', '写作', '口语', '模考复盘'], '准备TEF Canada、目标与加拿大移民语言成绩相关的学习者', '已经开始刷题，却发现四科各练各的、没有优先级', '先看清整场考试与自己的训练顺序，避免只猛练一科'),
  card('tef_writing', 'TEF Canada写作完整任务', 'TEF Canada写作两项任务的准备', '知道要练写作，却分不清两项任务分别该练什么', ['A部分新闻续写', 'B部分观点论证', '字数与时间', '素材与检查'], '准备TEF Canada写作的学习者', '写作一上来就套通用作文模板，不知道两项任务差别', '把两项任务拆开练，知道每一种要产出什么'),
  card('tef_speaking', 'TEF Canada口语完整任务', 'TEF Canada口语两项任务的准备', '口语练习零散，不知道获取信息和说服对方要分别怎么练', ['获取信息', '说服论证', '互动推进', '限时模拟'], '准备TEF Canada口语的学习者', '背了表达但一进入互动就卡住', '按两项任务建立可以重复练的口语动作'),
  card('tef_clb_goal', 'TEF Canada目标与诊断', 'TEF Canada备考前的目标与短板诊断', '不知道当前成绩、目标和练习优先级怎样对应', ['目标确认', '四科诊断', '短板排序', '训练周期'], '准备以法语成绩支持加拿大移民规划的TEF Canada考生', '看了很多CLB/NCLC信息，却不知道自己下一步先补哪科', '先形成个人训练优先级，再开始刷题'),
  card('tef_writing_ideas', 'TEF Canada写作内容准备', 'TEF Canada写作的素材、观点与展开', '写B部分时有立场却没有理由、例子和段落推进', ['常见社会议题', '观点', '理由例子', '段落组织'], '准备TEF Canada写作B部分的学习者', '每次遇到社会题都从零想内容，时间耗在构思', '积累能迁移到不同题目的观点和展开方式'),
  card('tef_schedule', 'TEF Canada训练计划', 'TEF Canada从诊断到模考的训练安排', '备考时间有限，不知道每天练什么才不会失衡', ['诊断', '专项训练', '限时输出', '模考复盘'], '距离TEF Canada考试还有数周、想稳定推进的学习者', '计划总是变成只刷自己擅长的科目', '把训练安排成可执行的阶段计划'),
  card('tef_listening', 'TEF Canada听力训练', 'TEF Canada听力从听懂到限时做题的训练', '总被语速和连续语流带跑，练完也不知道错在听不懂还是做题节奏', ['听辨问题', '材料复盘', '题目动作', '限时训练'], '准备TEF Canada听力的学习者', '刷完题只记分数，下一次仍在同一处跟丢', '找到可复用的听力复盘顺序'),
  card('tef_reading', 'TEF Canada阅读训练', 'TEF Canada阅读题的定位与时间分配', '阅读做不完或总在细节题反复犹豫', ['题干定位', '信息筛选', '时间取舍', '错因复盘'], '准备TEF Canada阅读的学习者', '做题时逐句翻译，时间被一两题拖住', '建立更适合限时阅读的动作顺序'),
  card('tef_expression', 'TEF Canada输出表达', 'TEF Canada写作和口语可迁移的表达准备', '背过句型但到写作或口语时调不出来', ['表达功能', '个人观点', '互动推进', '替换练习'], '写作和口语输出较弱的TEF Canada学习者', '笔记很多但真正开口/下笔仍只会基础句', '把表达按实际输出动作组织起来'),
  card('tef_vocab', 'TEF Canada主题词汇', 'TEF Canada备考的主题词汇与调用方法', '背词没有主题和输出场景，记住后还是用不上', ['高频主题', '词组搭配', '输出场景', '复习循环'], '需要补词汇但不想再无目的背词的TEF Canada学习者', '词表越存越多，写作和口语却没有素材', '把词汇转成能调用的输出材料'),
  card('tef_process', 'TEF Canada考试流程', 'TEF Canada报考到考试当天的准备流程', '临近考试才发现流程信息没理清，担心遗漏准备', ['报名准备', '四科安排', '考试当天', '结果后复盘'], '首次准备TEF Canada、需要把考试流程理顺的学习者', '备考和流程并行推进，却不知道哪些事情要提前确认', '按时间线完成必要准备，不把流程焦虑混进刷题'),
  card('tef_mock', 'TEF Canada模考复盘', 'TEF Canada模考后怎样确定下一轮训练', '模考后只知道总感觉不好，不知道具体该先改什么', ['结果记录', '四科错因', '优先级', '下一轮计划'], '已开始做TEF Canada模考或套题的学习者', '练得很多但没有把错误转成下一周行动', '把模考结果变成有顺序的训练调整'),
];

const TCF_CARDS: ProductTopicScopeCard[] = [
  card('tcf_full_prep', 'TCF Canada整体备考', 'TCF Canada四科与备考主线', '准备TCF Canada时不知道四科和三项写作/口语任务如何统筹', ['阅读', '听力', '写作三题', '口语三题', '模考复盘'], '准备TCF Canada、关注加拿大移民法语成绩的学习者', '资料很多但不知道考试结构和练习优先级', '先看清全场任务，再决定每周怎样练'),
  card('tcf_writing', 'TCF Canada写作完整任务', 'TCF Canada写作三项任务的准备', '把TCF Canada写作三道题混成一种作文练法', ['Tâche 1', 'Tâche 2', 'Tâche 3', '时间与检查'], '准备TCF Canada写作的学习者', '只会背通用模板，不清楚三项任务各自要完成什么', '把三项任务拆开，建立明确的练习与检查动作'),
  card('tcf_speaking', 'TCF Canada口语完整任务', 'TCF Canada口语三项任务的准备', '不知道三项口语任务的互动和观点表达怎样分别训练', ['引导式面谈', '互动任务', '表达观点', '限时模拟'], '准备TCF Canada口语的学习者', '临场容易卡住，不知道每题应先做什么', '按题型把口语动作练成固定流程'),
  card('tcf_goal', 'TCF Canada目标与诊断', 'TCF Canada备考前的目标与短板诊断', '不知道应该先补哪一科，也不知道如何安排复测前训练', ['目标确认', '四科诊断', '短板排序', '训练节奏'], '正在安排TCF Canada考试和复习节奏的学习者', '分数焦虑下盲目刷题，练习没有优先级', '先确定训练重点，避免把时间平均摊薄'),
  card('tcf_writing_ideas', 'TCF Canada写作内容准备', 'TCF Canada写作的信息、观点与材料比较', '写作遇到评论或材料比较时不知道怎么把信息组织成答案', ['任务信息', '观点展开', '材料比较', '收束检查'], '准备TCF Canada写作T2/T3的学习者', '能看懂题目但无法把材料变成完整表达', '把信息、立场和比较关系连成可写出的段落'),
  card('tcf_schedule', 'TCF Canada训练计划', 'TCF Canada从诊断到模考的训练安排', '训练总是零散，四科和输出任务难以兼顾', ['诊断', '专项训练', '限时输出', '模考复盘'], '距离TCF Canada考试还有数周的学习者', '每天做题很多，却看不到整体进度', '把练习排成可复盘的周期'),
  card('tcf_listening', 'TCF Canada听力训练', 'TCF Canada听力从跟上材料到限时答题的训练', '听力总被语速带跑，做完不知道应该改听辨还是做题习惯', ['听辨问题', '材料复盘', '题目动作', '限时训练'], '准备TCF Canada听力的学习者', '刷题只看错题数，下一套还是同样跟丢', '建立听力错因到下一步练习的路径'),
  card('tcf_reading', 'TCF Canada阅读训练', 'TCF Canada阅读定位、取舍与复盘', '阅读总是做不完，或在某类题上反复犹豫', ['题干定位', '信息筛选', '时间取舍', '错因复盘'], '准备TCF Canada阅读的学习者', '每段都想精读，限时里很快失去节奏', '形成可以在套题中执行的阅读顺序'),
  card('tcf_expression', 'TCF Canada输出表达', 'TCF Canada写作和口语的表达准备', '会基础句但无法把观点和互动自然说/写下去', ['表达功能', '观点展开', '互动回应', '替换练习'], '写作和口语输出不稳定的TCF Canada学习者', '背的句子和实际任务脱节', '把表达放回不同输出任务中练'),
  card('tcf_vocab', 'TCF Canada主题词汇', 'TCF Canada备考的主题词汇与输出调用', '背了单词却很难在写作口语里组织成内容', ['高频主题', '词组搭配', '输出场景', '复习循环'], '需要提升输出词汇的TCF Canada学习者', '词表很多但表达仍旧空泛', '把词汇转成可调用的主题材料'),
  card('tcf_process', 'TCF Canada考试流程', 'TCF Canada报考、考试与结果后的准备流程', '考试临近才开始补流程信息，担心遗漏关键安排', ['报名准备', '四科安排', '考试当天', '结果后复盘'], '首次准备TCF Canada的学习者', '流程和备考混在一起，越临近越慌', '按时间线把准备事项理清'),
  card('tcf_mock', 'TCF Canada模考复盘', 'TCF Canada模考后怎样确定训练重点', '做完套题只知道分数，不知道下一轮最该先补哪一块', ['结果记录', '四科错因', '优先级', '下一轮计划'], '已经开始TCF Canada模考的学习者', '每周都练但没有建立反馈循环', '把模考结果变成明确的训练决定'),
];

const COMMON_CARDS: ProductTopicScopeCard[] = [
  card('exam_choice', 'TEF与TCF选择', 'TEF Canada与TCF Canada的选择和准备判断', '还没选定考试，不知道该比较什么而不是听别人说哪场简单', ['考试结构', '任务差异', '个人基础', '准备条件'], '正在加拿大移民法语考试之间做选择的中文学习者', '搜索结果互相矛盾，担心一开始就选错方向', '建立可自己判断的选择维度，不替别人下结论'),
  card('common_immigration_prep', '加拿大法语考试整体准备', '加拿大移民法语考试从目标到训练的准备主线', '知道需要语言成绩，却不知道备考应从目标、诊断还是刷题开始', ['目标确认', '考试选择', '四科诊断', '训练计划'], '为加拿大移民规划准备法语考试的学习者', '信息很多、时间有限，无法形成一条准备主线', '先做出考试与训练的个人决策'),
  card('common_four_skills', '四科能力训练', '加拿大法语考试四科训练如何不失衡', '听说读写各有问题，却总把时间耗在最熟悉的一科', ['输入能力', '输出能力', '薄弱科识别', '限时复盘'], '同时准备TEF Canada或TCF Canada四科的学习者', '刷题很勤但能力结构越来越不平衡', '建立四科训练分配原则'),
  card('common_mock', '模考与复盘', '加拿大法语考试模考、错因与下一轮训练', '做完模考只看对错，不知道如何把结果变成下一周计划', ['模拟', '错因分类', '优先级', '下一轮训练'], '已经开始做TEF或TCF练习的学习者', '题做完就过去，重复犯同类问题', '把模考结果转成清晰的修正动作'),
  card('common_target', '目标与诊断', '加拿大法语考试目标、现状与训练优先级', '目标很明确但不知道自己现在最缺什么', ['目标', '现状', '短板', '训练顺序'], '为加拿大移民规划法语成绩的学习者', '一开始就平均刷四科，投入很大却没有方向', '先确认应该优先解决哪种能力问题'),
  card('common_schedule', '有限时间备考', '加拿大法语考试有限时间内的训练安排', '工作和备考并行，计划总是执行两天就散掉', ['时间盘点', '训练组合', '每周复盘', '调整原则'], '每天只能留出有限学习时间的备考者', '收藏了很多计划，却不知道自己的时间该怎么用', '建立可持续而不是理想化的训练节奏'),
  card('common_output', '写作口语输出', '加拿大法语考试写作和口语的共同输出训练', '输入练了很多，真正表达时仍然卡住', ['任务理解', '观点组织', '表达调用', '限时输出'], '需要同时补写作和口语输出的学习者', '背表达却无法在实际任务中取用', '把积累转成可写、可说的动作'),
  card('common_vocabulary', '主题词汇与表达', '加拿大法语考试的词汇积累怎样服务输出', '背词后没有进入听说读写任何一科', ['主题', '搭配', '输入识别', '输出调用'], '觉得词汇量不够又不想盲背的学习者', '单词本越记越厚，遇到任务仍找不到词', '用主题和使用场景组织词汇'),
  card('common_exam_day', '考前与考试当天', '加拿大法语考试考前准备与当天状态管理', '越靠近考试越被流程和状态焦虑打断训练', ['考前清单', '模拟节奏', '当天准备', '考后记录'], '临近TEF或TCF考试的学习者', '最后几天不知道该继续猛练还是先把流程理清', '用一套清单区分训练、流程与状态准备'),
  card('common_materials', '资料使用与训练', '加拿大法语考试资料怎样变成实际训练', '资料存了很多，却一直停在看和收藏', ['选择资料', '安排练习', '输出验证', '复盘沉淀'], '使用多个备考资料来源的学习者', '总在找新资料，旧资料没有真正练完', '建立从资料到练习的使用路径'),
];

const PRODUCT3_CARDS: ProductTopicScopeCard[] = [
  card('tcf7_full_writing', 'TCF Canada写作整体', 'TCF Canada写作三项任务的考前总整理', '考前才发现三项任务各自的格式、内容和时间安排都不稳', ['Tâche 1', 'Tâche 2', 'Tâche 3', '时间检查'], '考前7天准备TCF Canada写作的学习者', '时间很紧，不能再把三类任务混着练', '一轮理清三项任务和考场动作'),
  card('tcf7_task1', 'TCF Canada写作T1', 'TCF Canada写作Tâche 1的信息组织与完成', 'T1看似简单，却常漏信息、格式不完整或写不出连贯内容', ['信息提取', '格式组织', '句子连接', '自查'], 'TCF Canada写作考前冲刺的学习者', '拿到信息型任务就急着写，写完才发现漏点', '把T1做成可复查的完成流程'),
  card('tcf7_task2', 'TCF Canada写作T2', 'TCF Canada写作Tâche 2的评论与观点展开', '评论题有态度但内容太短，理由和例子撑不起来', ['立场', '理由', '例子', '段落收束'], '准备TCF Canada写作T2的学习者', '每次只能写出一两句观点，后面开始重复', '把观点扩成完整评论段'),
  card('tcf7_task3', 'TCF Canada写作T3', 'TCF Canada写作Tâche 3的材料比较与观点表达', '面对两份材料不知道先比较什么、后表达什么立场', ['材料信息', '比较关系', '个人立场', '结论检查'], '准备TCF Canada写作T3的学习者', '看懂材料却无法组织成有主线的回答', '形成材料比较到观点表达的写作顺序'),
  card('tcf7_correction', 'TCF Canada写作纠错', 'TCF Canada写作从初稿到改稿的考前纠错', '写完只改拼写，不知道哪类问题最影响整篇完成度', ['任务完成', '信息与逻辑', '语体语言', '重写复盘'], '考前反复改稿却没有明确改法的学习者', '每次都改得很累，下一篇还是犯类似错误', '按优先级完成一轮真正有用的改稿'),
  card('tcf7_training', 'TCF Canada写作7天训练', 'TCF Canada写作考前7天如何安排练习', '最后一周想冲刺，但不知道每天该练哪项任务、怎么复盘', ['诊断', '三题专项', '限时模拟', '最后检查'], '离TCF Canada写作考试不到一周的学习者', '怕练太散，也怕只刷模板没有输出', '把最后一周安排成连续的写作训练'),
  card('tcf7_task_format', 'TCF Canada写作任务格式', 'TCF Canada写作三项任务的格式与完成核对', '知道T1/T2/T3名称，却总在任务动作和信息完整度上漏项', ['题干动作', '对象与信息', '段落功能', '交卷核对'], '准备TCF Canada写作的学习者', '看懂题却没有先拆要求，写完才发现少回应了一个动作', '把任务要求变成可逐项核对的写前动作'),
  card('tcf7_language', 'TCF Canada写作语体', 'TCF Canada写作中对象、语体与表达的调整', '不同对象下仍用同一套称呼、请求和结尾', ['收件人', '写作目的', '语体选择', '局部修改'], 'TCF Canada写作临考复习的学习者', '句子没有明显错误，但整体读起来不合适', '知道先改哪几处最影响对象感的表达'),
  card('tcf7_ideas', 'TCF Canada写作观点展开', 'TCF Canada写作从空泛判断到具体理由和例子', '总停在“很好、重要、我同意”，后面写不下去', ['明确判断', '具体理由', '现实后果', '生活例子'], 'T2/T3观点展开不足的TCF Canada学习者', '每次想法都只有一句，靠重复凑内容', '把一句判断推进成读者能跟上的段落'),
  card('tcf7_coherence', 'TCF Canada写作段落推进', 'TCF Canada写作如何让材料、理由和结论真正连起来', '连接词很多，段落还是像一句句堆在一起', ['信息顺序', '关系判断', '理由推进', '收束'], '写作结构容易散的TCF Canada学习者', '写完能看懂，但读者看不到这段要往哪里走', '用段落功能而不是堆连接词推进内容'),
  card('tcf7_timing', 'TCF Canada写作限时完成', 'TCF Canada写作限时下的取舍与交卷检查', '三项任务都想写好，最后却常来不及检查', ['任务取舍', '下笔顺序', '限时节点', '最后检查'], '担心TCF Canada写作60分钟不够用的学习者', '时间被某一题拖住，后面只能草草完成', '建立限时里优先保住任务完成度的动作'),
  card('tcf7_examples', 'TCF Canada写作练习复盘', 'TCF Canada写作如何保留前后稿并看见改动', '每次整篇推倒重写，下一次还是不知道哪里变好了', ['第一稿', '单点定位', '局部重写', '前后对照'], '已经练过多篇TCF Canada写作但进步感不强的学习者', '改稿耗时很长，却没有留下可复盘的证据', '把每次练习变成可比较的改动记录'),
];

function card(id: string, family: string, coverageDomain: string, coreProblem: string, motherTopics: string[], audienceState: string, scene: string, urgentNeed: string, override: DemandOverride = {}): ProductTopicScopeCard {
  // The historical cards only had three fields.  Preserve their meaning while
  // giving every card the same demand contract.  High-overlap cards below have
  // explicit overrides; new cards must not rely on this fallback.
  return {
    id, family, coverageDomain, coreProblem, motherTopics,
    demand: {
      situation: audienceState,
      trigger: `遇到「${scene}」时需要马上决定下一步怎么练`,
      frustration: scene,
      desiredOutcome: urgentNeed,
      lossIfIgnored: '继续按原来的方式练，时间会被低效重复消耗，下一次任务仍不知道先改什么。',
      searchLanguage: [coreProblem, coverageDomain],
      demandArchetype: DEMAND_ARCHETYPE_BY_CARD_ID[id] || DEFAULT_DEMAND_ARCHETYPE,
      ...(DEMAND_OVERRIDES[id] || {}),
      ...override,
    },
  };
}

function cardsFor(productId: ProductId, examScope?: ExamScope): ProductTopicScopeCard[] {
  if (productId === 'delf_b2_writing') return [];
  if (productId === 'tcf_canada_writing_7day') return PRODUCT3_CARDS;
  if (examScope === 'tef_canada') return TEF_CARDS;
  if (examScope === 'tcf_canada') return TCF_CARDS;
  return COMMON_CARDS;
}

export function buildProductTopicScopePlan(
  productId: ProductId,
  examScope: ExamScope | undefined,
  scope: 'large' | 'medium',
  count: number,
  recentDomains: string[] = [],
  recentDemandArchetypes: DemandArchetype[] = [],
  excludeDemandArchetypes: DemandArchetype[] = [],
): AssignedProductTopicScope[] {
  // DELF 的已验收发牌顺序保持字节级同源，避免此次迁移影响商品1。
  if (productId === 'delf_b2_writing') {
    return buildProductionTopicScopePlan(scope, count, recentDomains).map(item => ({
      ...item,
      demand: {
        id: item.domainId,
        situation: '正在准备DELF B2写作的中文学习者',
        trigger: '学过一些写作知识，但一到真实题目仍不知道下一步怎么做',
        frustration: item.coreProblem,
        desiredOutcome: `解决「${item.coreProblem}」并形成可执行的写作准备动作`,
        lossIfIgnored: '会持续在零散材料之间切换，练习很难转成稳定的写作能力。',
        searchLanguage: [item.coreProblem, item.coverageDomain],
        examScope,
        motherDomain: item.domainId,
        demandArchetype: DEFAULT_DEMAND_ARCHETYPE,
      },
    }));
  }
  const allCards = cardsFor(productId, examScope);
  const cards = allCards.filter(item => !excludeDemandArchetypes.includes(item.demand.demandArchetype));
  const usableCards = cards.length >= count ? cards : allCards;
  if (count > usableCards.length) throw new Error(`TOPIC_DOMAIN_CAPACITY_EXCEEDED:${productId}:${examScope || 'default'}`);
  const usageForArchetype = (archetype: DemandArchetype) => recentDemandArchetypes.filter(value => value === archetype).length;
  const groups = new Map<DemandArchetype, Array<{ item: ProductTopicScopeCard; index: number; domainUses: number }>>();
  usableCards.forEach((item, index) => {
    const group = groups.get(item.demand.demandArchetype) || [];
    group.push({ item, index, domainUses: recentDomains.filter(id => id === item.id).length });
    groups.set(item.demand.demandArchetype, group);
  });
  const rankedGroups = [...groups.entries()]
    .map(([archetype, entries]) => ({ archetype, entries: entries.sort((a, b) => a.domainUses - b.domainUses || a.index - b.index) }))
    .sort((a, b) => usageForArchetype(a.archetype) - usageForArchetype(b.archetype)
      || a.entries[0]!.index - b.entries[0]!.index);
  // Round-robin across demand archetypes. The first pass maximizes distinct
  // user situations; mother domains only break ties within one situation.
  const ranked: Array<{ item: ProductTopicScopeCard; index: number }> = [];
  for (let depth = 0; ranked.length < usableCards.length; depth += 1) {
    let added = false;
    for (const group of rankedGroups) {
      const entry = group.entries[depth];
      if (!entry) continue;
      ranked.push(entry);
      added = true;
    }
    if (!added) break;
  }
  return Array.from({ length: count }, (_, index) => {
    const item = ranked[index]!.item;
    return {
      slot: index + 1,
      scope: scope === 'large' ? 'level_1_asset' : 'level_2_strategy',
      intent: scope === 'large' ? 'mega_asset' : 'broad_asset',
      domainId: item.id,
      domainFamily: item.family,
      coverageDomain: item.coverageDomain,
      coreProblem: item.coreProblem,
      requiredMotherTopics: item.motherTopics,
      minimumCoverage: scope === 'large' ? LARGE_MINIMUM_COVERAGE : MEDIUM_MINIMUM_COVERAGE,
      demand: { id: item.id, ...item.demand, examScope, motherDomain: item.id },
    };
  });
}
