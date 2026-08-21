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
 * 商品2/3 返回 undefined——完成商品1验收后才迁移，undefined 是阶段 B 回退现状行为的信号。
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

export function getProductEditorialMap(productId: ProductId): ProductEditorialMap | undefined {
  if (productId === 'delf_b2_writing') return DELF_B2_EDITORIAL_MAP;
  return undefined;
}
