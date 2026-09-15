import type { ProductId } from '@/types/data';

/**
 * 批量选题先分配“内容母题”，再让 AI 生成该母题的三种表达方向。
 * 这是生成前的路由，不是生成后的去重补丁：一张卡占用一个母题，后卡不会
 * 再从同一片空白里猜最容易想到的“卡分/7天/语域翻车”。
 */
export interface BatchTopicSlot {
  id: string;
  label: string;
  instruction: string;
}

const DELF_B2_WRITING_SLOTS: BatchTopicSlot[] = [
  ['task_reading', '审题与任务完成', '围绕“读懂任务后到底要交付什么”设计，讲对象、目的、文体和回应范围；不要退回评分自查或字数焦虑。'],
  ['score_selfcheck', '写完后的自我诊断', '围绕“写完怎样判断自己下一步该改什么”设计，交付诊断顺序或检查地图；不要泛写无效努力口号。'],
  ['feedback_loop', '练习为什么没有转化', '围绕“练习—复盘—下一篇调整”的反馈闭环设计，交付可观察的复盘方法；不要重复评分表目录。'],
  ['exam_time', '考场时间与动作安排', '围绕审题、列提纲、成文、回看的取舍设计考场攻略；要写具体动作，不做泛泛考前止损。'],
  ['last_week', '最后一周冲刺取舍', '围绕临考一周“哪些该停、哪些该保留、怎样排优先级”设计反常规攻略；不得和考场时间分配混成同一题。'],
  ['argument_map', '观点到论证的展开地图', '围绕理由、例子、影响、让步怎样形成完整论证设计，交付一张展开地图；不要只说凑够250词。'],
  ['idea_bank', '陌生主题下找观点', '围绕教育、环境、科技、工作等主题如何快速组织可写观点设计，交付观点生成或分类方法。'],
  ['example_evidence', '例子怎样真正支持观点', '围绕空例子、车轱辘话、因果关系不清的问题设计，交付“观点—解释—例子”的判断方法。'],
  ['cohesion', '段落衔接与逻辑关系', '围绕转折、让步、因果、递进怎样服务逻辑设计，交付关系选择地图；不要只列连接词表。'],
  ['formal_register', '正式语体与口语切换', '围绕正式信/论坛投稿里语体怎么选设计，交付口语表达与正式表达的使用判断；不要只做投诉信和建议信的同题换名。'],
  ['letter_adaptation', '同一模板怎样按写信目的改', '围绕投诉、建议、申请、反对等目的切换设计，交付哪些部分可复用、哪些必须重写的迁移攻略。'],
  ['opening_ending', '开头、结尾和称呼的任务感', '围绕开场如何建立关系、结尾如何回应请求设计，交付不同写作目的下的结构对照。'],
  ['vocab_precision', '词汇选择而非堆高级词', '围绕近义词、搭配、正式程度和主题词怎样选设计，交付可比较的选择标准。'],
  ['sentence_variety', '句法怎样服务信息层次', '围绕简单句堆叠、信息关系不清的问题设计，交付句法选择和改写思路；不要只讲单条语法规则。'],
  ['error_map', '高频错误怎样分类修复', '围绕性数一致、时态、介词、虚拟式、直译等错误怎样定位设计，交付错误分类与复盘路径。'],
  ['translation_interference', '中文思路怎样转成法语表达', '围绕直译腔、中文式因果和礼貌表达设计，交付从中文意图到法语写法的转换方法。'],
  ['model_transfer', '范文怎样拆开再迁移', '围绕看懂范文却换题不会写的问题设计，交付范文功能拆解和替换边界。'],
  ['template_risk', '模板怎样用而不写成套话', '围绕模板生搬硬套、内容与任务错配的问题设计，交付可保留与必须改写的部分。'],
  ['topic_drills', '按题型做小型训练', '围绕正式信、论坛投稿、报告等任务怎样分开练设计，交付题型训练路径或自测题库。'],
  ['revision_order', '一篇作文的修改顺序', '围绕写完后从哪开始改设计，交付从任务、逻辑、语体到语言的修改优先级。'],
  ['writing_routine', '从零开始的稳定输出习惯', '围绕不知道如何持续练、每次从头乱写的问题设计，交付可重复但不僵化的练习节奏。'],
  ['material_navigation', '资料很多怎样按问题调用', '围绕资料分散、查找成本高的问题设计，交付按症状找到对应练习材料的使用地图。'],
  ['pre_exam_check', '交卷前最后检查什么', '围绕最后几分钟怎样避免低级失误设计，交付短、明确的交卷前检查顺序；不要复用最后一周冲刺。'],
  ['confidence_gap', '会写但没有把握的原因', '围绕“感觉写得不错却不确定是否达标”设计，区分主观顺手与任务完成、连贯和语体之间的差异。'],
  ['revision_repeat', '复读生如何避免重踩旧坑', '围绕上次失利后如何定位旧问题、建立新练习策略设计，交付复读阶段的重建路线。'],
  ['content_density', '内容不空洞的真正做法', '围绕观点重复、解释太薄、例子不落地的问题设计，交付让内容更扎实的展开方法；不要只回到字数。'],
  ['exam_strategy', '考场遇到陌生题怎么办', '围绕不熟主题、临场没思路、任务压力设计，交付从题干到观点再到结构的应对策略。'],
  ['mixed_review', '考前综合速查包', '围绕不同薄弱项怎样组合复习设计，交付一份有明确分类的综合攻略；不能只说“全部整理好了”。'],
].map(([id, label, instruction]) => ({ id, label, instruction }));

export function claimBatchTopicSlot(input: { productId: ProductId; usedSlotIds: readonly string[] }): BatchTopicSlot | undefined {
  if (input.productId !== 'delf_b2_writing') return undefined;
  return DELF_B2_WRITING_SLOTS.find(slot => !input.usedSlotIds.includes(slot.id));
}

export function buildBatchTopicSlotDirection(slot: BatchTopicSlot, userDirection = '') {
  return [
    userDirection.trim(),
    `【本批唯一内容母题｜${slot.label}】${slot.instruction} 本卡的3个候选都必须围绕这一母题的不同角度；不得借用其他母题。`,
  ].filter(Boolean).join('\n');
}
