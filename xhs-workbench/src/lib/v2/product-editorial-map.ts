import type { ProductId } from '@/types/data';

/**
 * 商品1（delf_b2_writing）的商品能力、支持模块、购买者地图。
 * 供阶段 B/D 作为选题 5 块契约「商品身份」块的输入。
 *
 * 红线：内容全部来自仓库真实资料，禁止编造商品功能。
 * - 能力/模块：data/product_facts_delf_b2.json（CM-001~CM-007）+ src/lib/product-showcase-library.ts
 *   商品1 showcase 资产的 sourceFile 模块名。
 * - 购买者地图：product_facts_delf_b2.json 的 audiences（AU-001~AU-007）与 raw_pain_points。
 * - 考试边界不放这里：阶段 B 直接调 listVerifiedExamFacts(productId)（设计 §3.1）。
 *
 * 字段名内部用英文；阶段 B 转 5 块契约中文键时再映射。
 * 三个商品均提供同一结构。内容取自各自 product facts；不会把商品1能力
 * 作为商品2/3的标题输入。
 */

export interface EditorialCapability {
  capabilityId: string;
  capability: string;
  /** 必须能在 showcase 库（product-showcase-library.ts）商品1资产的 sourceFile 模块名中找到对应。 */
  modules: string[];
}

export interface BuyerMap {
  userStages: string[];
  realStates: string[];
  motivations: string[];
}

export interface ProductEditorialMap {
  productId: ProductId;
  capabilities: EditorialCapability[];
  buyerMap: BuyerMap;
}

const DELF_B2_EDITORIAL_MAP: ProductEditorialMap = {
  productId: 'delf_b2_writing',
  capabilities: [
    {
      capabilityId: 'cap-sample-library',
      capability: '按题型组织的完整法语范文与结构标注，覆盖正式信、建议信、投诉/反对信、论坛投稿等写作题型，附可替换表达',
      modules: ['01_范文库_20篇'],
    },
    {
      capabilityId: 'cap-score-selfcheck',
      capability: 'DELF B2评分维度对照与36项写作检查清单，写完后逐项自查复盘',
      modules: ['02_DELF_B2评分对照', '08_写作检查清单_36项'],
    },
    {
      capabilityId: 'cap-vocab-library',
      capability: '240条词汇库，按功能（观点/原因/对比/让步/建议/总结/正式信开头结尾）和主题分类，每条带例句与适用场景',
      modules: ['03_词汇库_240条'],
    },
    {
      capabilityId: 'cap-syntax-library',
      capability: '100条句法库，按虚拟式、条件式、让步、因果、对比、强调、递进、正式信、结论分类，可替换句型带使用条件',
      modules: ['04_句法库_100条'],
    },
    {
      capabilityId: 'cap-topic-ideas',
      capability: '50条主题观点库，覆盖教育、环境、科技、工作、健康、社交媒体等主题，每条含法语观点句、例子与可搭配句型',
      modules: ['05_主题观点库_50条'],
    },
    {
      capabilityId: 'cap-combination-examples',
      capability: '20条组合示例，把词汇、句法和主题观点组合成正式信、观点文、论坛投稿等场景下可练的内容',
      modules: ['06_组合示例库_20条'],
    },
    {
      capabilityId: 'cap-error-correction',
      capability: '30条错题对照库，按性数一致、虚拟式、条件式、中式直译、口语词混入、介词、连接词等错误类型给出修改方向',
      modules: ['07_错题对照库_30条'],
    },
    {
      capabilityId: 'cap-path-and-review',
      capability: '使用说明与学习路径（系统备考/考前冲刺/临考救命题定位）加考前冲刺速查',
      modules: ['00_使用说明与学习路径', '09_考前冲刺速查'],
    },
  ],
  buyerMap: {
    userStages: [
      '法语在 B1-B2 之间、距考 1-3 个月、正在系统备考的考生',
      '法语 A2-B1、距考不到 4 周、需要冲刺产出完整作文的考生',
      '距考不到一周、临时需要救命题和速查内容的临考考生',
      '考过 DELF B2 但写作部分没通过、准备再考的复读生',
      '写作卡在具体瓶颈（词汇贫乏、句式单一、论证展开不足）的考生',
      '偏好按主题拆解加可直接套用结构来练写作的考生',
    ],
    realStates: [
      '性数一致错误频发，名词、形容词和过去分词搭配常出错',
      '虚拟式用错：bien que、il faut que 后该用虚拟的地方用了直陈',
      '把中文句式直译成法语，写出 apprendre des connaissances 这类不自然表达',
      '口语词 on、ça、beaucoup de 混进正式写作，语体不达标',
      '作文写不够 250 词，观点和例证展开不充分，只能硬凑字数',
      '开头结尾没思路，考场上时间不够用，写完也没系统检查的习惯',
    ],
    motivations: [
      '想在写完之后有可执行的检查动作，而不是写完就交、不知道自己错在哪',
      '想短期产出一批完整作文并拿到自评依据，冲刺阶段不浪费时间',
      '想拿到能直接按题型查、按主题套的范文和表达，练的时候有东西可仿写',
      '想定位自己的薄弱环节到具体错误类型和对应模块，补得有针对性',
      '想解决论证展开不足，把观点、例子、让步结构组织成够词数的完整作文',
      '临考想快速定位再过一遍最该检查的内容，避免在熟悉错误上丢分',
    ],
  },
};

const TEF_TCF_EDITORIAL_MAP: ProductEditorialMap = {
  productId: 'tef_tcf_canada',
  capabilities: [
    { capabilityId: 'cap-exam-choice', capability: 'TEF Canada 与 TCF Canada 的选择、考试差异和准备判断', modules: ['01_我要考TEF还是TCF'] },
    { capabilityId: 'cap-goal-diagnosis', capability: '围绕 CLB/NCLC 目标的四科差距诊断与训练优先级', modules: ['02_先测一下你离CLB7有多远'] },
    { capabilityId: 'cap-output-training', capability: '写作句型、段落表达和口语观点/过渡句训练', modules: ['03_写作提分捷径', '08_开口说没那么可怕'] },
    { capabilityId: 'cap-vocabulary', capability: '按主题整理的词汇与输出调用训练', modules: ['04_背词不迷路'] },
    { capabilityId: 'cap-exam-prep', capability: '真题主题、听力训练、30天计划与模考后的调整', modules: ['05_写作练什么', '06_30天怎么安排', '07_听力这件事急不来'] },
    { capabilityId: 'cap-process', capability: '报名、考试当天与查分流程准备', modules: ['12_上考场那天从报名到查分全流程'] },
  ],
  buyerMap: {
    userStages: ['准备以法语成绩支持加拿大移民规划、尚未选定TEF或TCF的人', '目标明确但四科基础不均衡、需要安排训练的人', '每天只能留出有限备考时间的上班族或学生', '临近考试、需要同时理清流程和训练的人'],
    realStates: ['不知道先考TEF还是TCF，担心选错后重来', '不知道自己离目标差在哪一科，容易平均用力', '背过表达但在写作或口语输出时调不出来', '听力被语速和连续语流带跑，做完题只会看分数'],
    motivations: ['想先确认考试选择和训练优先级，再投入时间', '想把零散资料变成四科可执行的计划', '想让词汇和句型真正服务写作、口语输出', '想在考前把流程与复盘安排清楚'],
  },
};

const TCF7_EDITORIAL_MAP: ProductEditorialMap = {
  productId: 'tcf_canada_writing_7day',
  capabilities: [
    { capabilityId: 'cap-task-map', capability: 'TCF Canada 写作 T1/T2/T3 的任务格式、完成动作和字数核对', modules: ['任务格式速查'] },
    { capabilityId: 'cap-seven-day', capability: '考前7天每天一个写作纠错动作与限时训练路径', modules: ['7天路径'] },
    { capabilityId: 'cap-t1', capability: 'T1 信息完整、对象意识与称呼/请求/结尾调整', modules: ['Day 3 信息完整度', 'Day 6 对象和语体'] },
    { capabilityId: 'cap-t2t3', capability: 'T2 评论补写、T3 材料比较与观点展开', modules: ['Day 1 材料比较', 'Day 2 评论补写', 'Day 4 把立场展开'] },
    { capabilityId: 'cap-revision', capability: '完整作答后定位一个问题、局部重写并保存前后稿', modules: ['写后：先定位，再重写', '留存两个版本'] },
    { capabilityId: 'cap-final-check', capability: '考前90秒检查与三项任务复盘', modules: ['先做90秒检查'] },
  ],
  buyerMap: {
    userStages: ['距离TCF Canada考试约一到三周、能写基础句子但输出不稳定的人', '考前最后一周需要集中查漏补缺的写作考生', '已经练过多篇作文、但不知道下一篇该具体改哪里的人', '看得懂题干却常漏掉任务动作、对象或信息要求的人'],
    realStates: ['T1 容易漏掉题干动作、时间地点或请求', 'T2 只会叙述经历，缺评价和理由', 'T3 把两份材料并列摘要，或观点只有一句', '写完总想整篇重来，却没有留下可比较的修改结果'],
    motivations: ['想分清T1/T2/T3各自的完成要求', '想把空泛判断展开成理由、结果或例子', '想用有限时间做一次真正有顺序的改稿', '想在考前保住任务完成度而不是盲背模板'],
  },
};

export function getProductEditorialMap(productId: ProductId): ProductEditorialMap | undefined {
  if (productId === 'delf_b2_writing') return DELF_B2_EDITORIAL_MAP;
  if (productId === 'tef_tcf_canada') return TEF_TCF_EDITORIAL_MAP;
  if (productId === 'tcf_canada_writing_7day') return TCF7_EDITORIAL_MAP;
  return undefined;
}
