import type { ProductFacts, ProductFactItem } from '@/types/content-planning';
import type { ProductId } from '@/types/data';

export type ProductShowcaseAssetType = 'directory' | 'library_intro' | 'sample_analysis' | 'phrase_vocab' | 'fact_snapshot';

export interface ProductShowcaseAssetCard {
  id: string;
  productId: ProductId;
  /** 上一级资料模块/文件夹，同一模块下可以有多张截图。 */
  moduleId?: string;
  moduleLabel?: string;
  type: ProductShowcaseAssetType;
  label: string;
  image?: string;
  sourceFactIds: string[];
  sourceFile: string;
  sourceSection: string;
  realContent: string;
  userValue: string;
  suitableAngles: string[];
  canBeCover: boolean;
  canBeInnerPage: boolean;
}

export interface ProductShowcaseAngle {
  id: string;
  label: string;
  instruction: string;
  preferredTypes: ProductShowcaseAssetType[];
}

export interface ProductShowcasePlan {
  mode: 'product_showcase';
  angle: ProductShowcaseAngle;
  coverAsset: ProductShowcaseAssetCard;
  innerAssets: ProductShowcaseAssetCard[];
}

export const PRODUCT_SHOWCASE_ANGLES: ProductShowcaseAngle[] = [
  { id: 'map', label: '先看全貌', instruction: '把知识库的目录、模块和使用路径讲清楚，让用户知道买到的不是一页零散资料。', preferredTypes: ['directory', 'library_intro'] },
  { id: 'content-proof', label: '看里面到底有什么', instruction: '用真实资料页证明内容够具体，突出范文、句型、词汇、错题和检查工具如何组合。', preferredTypes: ['library_intro', 'sample_analysis', 'phrase_vocab'] },
  { id: 'use-method', label: '告诉用户怎么用', instruction: '展示一页资料和一个使用动作，说明用户在备考哪个阶段可以拿来查、练、改。', preferredTypes: ['sample_analysis', 'phrase_vocab', 'directory'] },
  { id: 'value-density', label: '把获得感讲透', instruction: '集中展示资料密度、整理方式和可反复查用的价值，避免只报数量。', preferredTypes: ['phrase_vocab', 'sample_analysis', 'directory'] },
];

const PRODUCT1_ASSETS: Omit<ProductShowcaseAssetCard, 'productId'>[] = [
  {
    id: 'showcase_delf_directory', type: 'directory', label: '知识库目录页', image: '/showcase/delf_b2_writing/pdf-pages/page-002.jpg',
    sourceFactIds: ['DA-001', 'DA-002', 'DA-006', 'DA-009', 'DA-011'], sourceFile: '00_使用说明与学习路径 / 02_知识库地图', sourceSection: '目录与学习路径',
    realContent: '目录包含使用说明、范文库、DELF B2评分对照、词汇库、句法库、主题观点库、组合示例库、错题对照库、36项写作检查清单和考前冲刺速查。',
    userValue: '先看全貌，用户能快速判断资料是否覆盖自己要补的环节。', suitableAngles: ['map', 'value-density'], canBeCover: true, canBeInnerPage: true,
  },
  {
    id: 'showcase_delf_library_intro', type: 'library_intro', label: '学习路径与范文库说明页', image: '/showcase/delf_b2_writing/pdf-pages/page-003.jpg',
    sourceFactIds: ['DA-011', 'CM-001'], sourceFile: '01_范文库_20篇', sourceSection: '范文库说明与任务类型速览',
    realContent: '范文按建议信、正式信、投诉与反对信、论坛投稿等任务组织，并附有可替换表达和学习提示。',
    userValue: '用户看到的不只是“有范文”，而是知道范文按什么任务查、拿到后怎么练。', suitableAngles: ['map', 'content-proof', 'use-method'], canBeCover: true, canBeInnerPage: true,
  },
  {
    id: 'showcase_delf_sample_analysis', type: 'sample_analysis', label: '范文解析与可替换表达页', image: '/showcase/delf_b2_writing/pdf-pages/page-007.jpg',
    sourceFactIds: ['DA-011', 'DA-012', 'KA-020'], sourceFile: '01_范文库_20篇 / 06_组合示例库_20条', sourceSection: '完整法语范文、结构标注与可替换表达',
    realContent: '样张展示开头、主体段、结尾、可替换表达和练习提示，适合从“看懂范文”走到“拆出自己的写法”。',
    userValue: '把资料如何帮助用户改作文说具体，避免正文只说“内容很全”。', suitableAngles: ['content-proof', 'use-method', 'value-density'], canBeCover: true, canBeInnerPage: true,
  },
  {
    id: 'showcase_delf_phrase_vocab', type: 'phrase_vocab', label: '词汇与句型资料页', image: '/showcase/delf_b2_writing/pdf-pages/page-108.jpg',
    sourceFactIds: ['KA-001', 'KA-002', 'DA-003', 'DA-012'], sourceFile: '03_词汇库_240条 / 04_句法库_100条', sourceSection: '法语表达、替换表达、例句与适用场景',
    realContent: '每条资料可按法语表达、可替换表达、例句、适用场景、难度和频率查看，适合写作时查和仿写。',
    userValue: '展示资料颗粒度和使用动作，让“能查、能改、能仿写”有画面。', suitableAngles: ['content-proof', 'use-method', 'value-density'], canBeCover: true, canBeInnerPage: true,
  },
];

// 只放少量“证明资料长什么样”的代表页，不把整本 PDF 变成可浏览副本。
const PRODUCT1_PDF_TEASERS: Omit<ProductShowcaseAssetCard, 'productId'>[] = [
  ['page-008', '评分维度与检查提示页', 'sample_analysis', '02_DELF_B2评分对照', '评分维度、检查动作与写作结果的对应关系。'],
  ['page-012', '范文主题拆解页', 'sample_analysis', '01_范文库_20篇', '展示范文如何从题目、结构和表达三个层面拆开使用。'],
  ['page-016', '范文结构标注页', 'sample_analysis', '01_范文库_20篇', '展示开头、主体段和结尾的组织方式，不展示整套范文。'],
  ['page-020', '范文练习提示页', 'sample_analysis', '01_范文库_20篇', '展示看完范文之后如何提炼表达并转成自己的练习。'],
  ['page-040', '范文表达摘取页', 'phrase_vocab', '01_范文库_20篇 / 06_组合示例库_20条', '展示从完整范文中提取可复用表达的方式。'],
  ['page-060', '高频词汇资料页', 'phrase_vocab', '03_词汇库_240条', '展示词汇按主题、表达和例句整理的颗粒度。'],
  ['page-080', '词汇分类速查页', 'phrase_vocab', '03_词汇库_240条', '展示用户写作时可以快速查找的分类结构。'],
  ['page-109', '主题词汇示例页', 'phrase_vocab', '03_词汇库_240条', '展示主题词汇与法语表达的对应关系。'],
  ['page-110', '词汇场景整理页', 'phrase_vocab', '03_词汇库_240条', '展示同一主题下的表达、释义和使用提示。'],
  ['page-120', '句法规则资料页', 'phrase_vocab', '04_句法库_100条', '展示句法资料如何按规则、例句和使用场景整理。'],
  ['page-140', '句型替换资料页', 'phrase_vocab', '04_句法库_100条', '展示可替换句型和常见使用条件。'],
  ['page-190', '错题对照与修正页', 'sample_analysis', '07_错题对照库_30条', '展示错误、修改方向和可复用提醒的对照形式。'],
  ['page-004', '评分对照使用页', 'sample_analysis', '02_DELF_B2评分对照', '展示评分维度如何转成写完之后的检查动作。'],
  ['page-005', '写作检查清单页', 'sample_analysis', '08_写作检查清单_36项', '展示检查清单如何帮助用户逐项复盘作文。'],
  ['page-150', '句型库示例页', 'phrase_vocab', '04_句法库_100条', '展示句型、例句和写作场景之间如何对应。'],
  ['page-160', '主题观点整理页', 'sample_analysis', '05_主题观点库_50条', '展示观点素材如何按主题整理，方便写作前调用。'],
  ['page-180', '组合示例资料页', 'sample_analysis', '06_组合示例库_20条', '展示词汇、句法和主题如何组合成可练内容。'],
  ['page-200', '错题复盘示例页', 'sample_analysis', '07_错题对照库_30条', '展示错误对照、修改方向和复盘提醒。'],
  ['page-210', '考前速查资料页', 'sample_analysis', '09_考前冲刺速查', '展示考前如何快速定位需要再检查的内容。'],
  ['page-220', '学习路径说明页', 'directory', '00_使用说明与学习路径', '展示从看范文、拆表达到自查复盘的使用路径。'],
].map(([page, label, type, sourceFile, realContent]) => ({
  id: `showcase_delf_${page}`,
  type: type as ProductShowcaseAssetType,
  label,
  image: `/showcase/delf_b2_writing/pdf-pages/${page}.jpg`,
  sourceFactIds: [],
  sourceFile,
  sourceSection: label,
  realContent,
  userValue: '只展示一页代表内容，让用户看到资料的真实整理方式和使用价值。',
  suitableAngles: ['content-proof', 'use-method', 'value-density'],
  canBeCover: false,
  canBeInnerPage: true,
}));

export function buildProductShowcaseAssets(productId: ProductId, facts: ProductFacts): ProductShowcaseAssetCard[] {
  if (productId === 'delf_b2_writing') {
    const fallbackFactIds = [
      ...facts.knowledge_assets,
      ...facts.content_modules,
      ...facts.raw_selling_points,
    ].map(item => item.id);
    return [...PRODUCT1_ASSETS, ...PRODUCT1_PDF_TEASERS].map((asset, index) => ({
      ...asset,
      productId,
      moduleId: asset.sourceFile.split(' / ')[0],
      moduleLabel: asset.sourceFile.split(' / ')[0],
      sourceFactIds: asset.sourceFactIds.length ? asset.sourceFactIds : [fallbackFactIds[index % Math.max(fallbackFactIds.length, 1)] || `PDF-TEASER-${index + 1}`],
    }));
  }
  return facts.displayable_assets.map((item, index) => dynamicAsset(productId, item, index));
}

export function pickProductShowcasePlan(productId: ProductId, facts: ProductFacts, salt = ''): ProductShowcasePlan {
  const assets = buildProductShowcaseAssets(productId, facts);
  const angle = PRODUCT_SHOWCASE_ANGLES[hash(`${productId}|${salt}`) % PRODUCT_SHOWCASE_ANGLES.length];
  const preferred = assets.filter(asset => angle.preferredTypes.includes(asset.type));
  const pool = preferred.length >= 2 ? preferred : assets;
  const start = pool.length ? hash(`${salt}|${angle.id}`) % pool.length : 0;
  const ordered = pool.length ? [...pool.slice(start), ...pool.slice(0, start)] : [];
  const coverAsset = ordered.find(asset => asset.canBeCover) || assets[0];
  const innerPool = assets.filter(asset => asset.id !== coverAsset?.id && asset.canBeInnerPage);
  const shuffled = [...innerPool].sort((a, b) => hash(`${salt}|${a.id}`) - hash(`${salt}|${b.id}`));
  const modules = new Map<string, ProductShowcaseAssetCard[]>();
  for (const asset of shuffled) {
    const moduleId = asset.moduleId || asset.sourceFile;
    const group = modules.get(moduleId) || [];
    group.push(asset);
    modules.set(moduleId, group);
  }
  // 先跨模块取图，保证 5 张图不是同一个文件夹的重复截图；模块不足时再从剩余截图补齐。
  const innerAssets: ProductShowcaseAssetCard[] = [];
  for (const group of Array.from(modules.values())) {
    if (innerAssets.length >= 5) break;
    if (group[0]) innerAssets.push(group[0]);
  }
  for (const asset of shuffled) {
    if (innerAssets.length >= 5) break;
    if (!innerAssets.some(item => item.id === asset.id)) innerAssets.push(asset);
  }
  return { mode: 'product_showcase', angle, coverAsset, innerAssets };
}

function dynamicAsset(productId: ProductId, item: ProductFactItem, index: number): ProductShowcaseAssetCard {
  return {
    id: `showcase_${productId}_${item.id}`,
    productId,
    moduleId: item.source_file,
    moduleLabel: item.source_section || item.source_file,
    type: index % 3 === 0 ? 'directory' : index % 3 === 1 ? 'sample_analysis' : 'fact_snapshot',
    label: item.text,
    sourceFactIds: [item.id],
    sourceFile: item.source_file,
    sourceSection: item.source_section,
    realContent: `${item.text}。${item.evidence}`,
    userValue: '用真实资料条目说明商品具体包含什么、怎么查和怎么使用。',
    suitableAngles: ['map', 'content-proof', 'use-method', 'value-density'],
    canBeCover: true,
    canBeInnerPage: true,
  };
}

function hash(value: string) {
  let result = 2166136261;
  for (const char of value) { result ^= char.charCodeAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0);
}
