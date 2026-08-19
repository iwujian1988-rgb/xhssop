import type { ProductFacts, ProductFactItem } from '@/types/content-planning';
import type { ProductId } from '@/types/data';

export type ProductShowcaseAssetType = 'directory' | 'library_intro' | 'sample_analysis' | 'phrase_vocab' | 'fact_snapshot';

export interface ProductShowcaseAssetCard {
  id: string;
  productId: ProductId;
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
    id: 'showcase_delf_directory', type: 'directory', label: '知识库目录页', image: '/showcase/delf_b2_writing/directory.png',
    sourceFactIds: ['DA-001', 'DA-002', 'DA-006', 'DA-009', 'DA-011'], sourceFile: '00_使用说明与学习路径 / 02_知识库地图', sourceSection: '目录与学习路径',
    realContent: '目录包含使用说明、范文库、DELF B2评分对照、词汇库、句法库、主题观点库、组合示例库、错题对照库、36项写作检查清单和考前冲刺速查。',
    userValue: '先看全貌，用户能快速判断资料是否覆盖自己要补的环节。', suitableAngles: ['map', 'value-density'], canBeCover: true, canBeInnerPage: true,
  },
  {
    id: 'showcase_delf_library_intro', type: 'library_intro', label: '范文库说明页', image: '/showcase/delf_b2_writing/library-intro.jpg',
    sourceFactIds: ['DA-011', 'CM-001'], sourceFile: '01_范文库_20篇', sourceSection: '范文库说明与任务类型速览',
    realContent: '范文按建议信、正式信、投诉与反对信、论坛投稿等任务组织，并附有可替换表达和学习提示。',
    userValue: '用户看到的不只是“有范文”，而是知道范文按什么任务查、拿到后怎么练。', suitableAngles: ['map', 'content-proof', 'use-method'], canBeCover: true, canBeInnerPage: true,
  },
  {
    id: 'showcase_delf_sample_analysis', type: 'sample_analysis', label: '范文解析页', image: '/showcase/delf_b2_writing/sample-analysis.jpg',
    sourceFactIds: ['DA-011', 'DA-012', 'KA-020'], sourceFile: '01_范文库_20篇 / 06_组合示例库_20条', sourceSection: '完整法语范文、结构标注与可替换表达',
    realContent: '样张展示开头、主体段、结尾、可替换表达和练习提示，适合从“看懂范文”走到“拆出自己的写法”。',
    userValue: '把资料如何帮助用户改作文说具体，避免正文只说“内容很全”。', suitableAngles: ['content-proof', 'use-method', 'value-density'], canBeCover: true, canBeInnerPage: true,
  },
  {
    id: 'showcase_delf_phrase_vocab', type: 'phrase_vocab', label: '句型与词汇页', image: '/showcase/delf_b2_writing/phrase-vocab.jpg',
    sourceFactIds: ['KA-001', 'KA-002', 'DA-003', 'DA-012'], sourceFile: '03_词汇库_240条 / 04_句法库_100条', sourceSection: '法语表达、替换表达、例句与适用场景',
    realContent: '每条资料可按法语表达、可替换表达、例句、适用场景、难度和频率查看，适合写作时查和仿写。',
    userValue: '展示资料颗粒度和使用动作，让“能查、能改、能仿写”有画面。', suitableAngles: ['content-proof', 'use-method', 'value-density'], canBeCover: true, canBeInnerPage: true,
  },
];

export function buildProductShowcaseAssets(productId: ProductId, facts: ProductFacts): ProductShowcaseAssetCard[] {
  if (productId === 'delf_b2_writing') return PRODUCT1_ASSETS.map(asset => ({ ...asset, productId }));
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
  const innerAssets = assets.filter(asset => asset.id !== coverAsset?.id && asset.canBeInnerPage).slice(0, 3);
  return { mode: 'product_showcase', angle, coverAsset, innerAssets };
}

function dynamicAsset(productId: ProductId, item: ProductFactItem, index: number): ProductShowcaseAssetCard {
  return {
    id: `showcase_${productId}_${item.id}`,
    productId,
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
