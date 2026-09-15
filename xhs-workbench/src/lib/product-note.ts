import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { readProductAssetLibrary, type ProductAsset } from '@/lib/product-asset-manifest';
import type { ProductId } from '@/types/data';
import type { ProductShowcaseAssetCard, ProductShowcasePlan, ProductShowcaseAngle } from '@/lib/product-showcase-library';

export type ProductNoteAngleId = 'overview' | 'pain' | 'use_case';

export interface ProductNoteAssetCopy {
  assetId: string;
  reason: string;
  pageRole: 'cover' | 'inner';
  shortTitle: string;
  badge: string;
  oneLine: string;
}

export interface ProductNotePlan {
  noteMode: 'product_note';
  productId: 'delf_b2_writing';
  angleId: ProductNoteAngleId;
  angleLabel: string;
  targetBuyer: string;
  buyerMoment: string;
  mainClaim: string;
  supportingBenefits: string[];
  selectedAssetIds: string[];
  assets: ProductNoteAssetCopy[];
  appendProductPromoPage: false;
  plannerRequestId?: string;
  usage?: AiUsageSummary;
}

export const PRODUCT_NOTE_ANGLES: Array<{ id: ProductNoteAngleId; label: string; instruction: string }> = [
  { id: 'overview', label: '商品全貌型', instruction: '让用户一眼看懂这套DELF B2写作资料买到什么、覆盖哪些备考环节。' },
  { id: 'pain', label: '痛点对应商品型', instruction: '从一个具体备考卡点切入，证明资料中哪些页面能直接承接这个卡点。' },
  { id: 'use_case', label: '使用场景型', instruction: '围绕用户某个备考时刻，说明他打开资料后具体怎么查、怎么练或怎么改。' },
];

function angle(id: ProductNoteAngleId) {
  const found = PRODUCT_NOTE_ANGLES.find(item => item.id === id);
  if (!found) throw new Error(`不支持的商品笔记角度：${id}`);
  return found;
}

function candidateAssets(assets: ProductAsset[], id: ProductNoteAngleId): ProductAsset[] {
  const terms = id === 'overview' ? ['全貌', '目录', '范文', '词汇', '句型', '评分', '清单']
    : id === 'pain' ? ['检查', '错题', '观点', '论据', '结构', '评分', '表达']
      : ['范文', '练习', '使用', '场景', '句型', '检查', '路径'];
  const scored = assets.filter(item => item.curationTier === 'A' || item.curationTier === 'B').map(item => ({
    item,
    score: terms.reduce((sum, term) => sum + (item.moduleTag.includes(term) || item.buyerNeedTags.some(tag => tag.includes(term)) || item.sellingAngleTags.some(tag => tag.includes(term)) ? 2 : 0), 0)
      + (item.proofStrength === 'strong' ? 2 : item.proofStrength === 'medium' ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score || a.item.sourcePage - b.item.sourcePage);
  const selected: ProductAsset[] = [];
  const modules = new Set<string>();
  for (const entry of scored) {
    if (selected.length >= 8) break;
    if (!modules.has(entry.item.moduleTag) || selected.length >= 5) { selected.push(entry.item); modules.add(entry.item.moduleTag); }
  }
  return selected;
}

export async function planProductNote(productId: ProductId, angleId: ProductNoteAngleId): Promise<{ plan: ProductNotePlan; usage: AiUsageSummary }> {
  if (productId !== 'delf_b2_writing') throw new Error('Phase 1B 当前只支持商品1 DELF B2写作资料');
  const library = await readProductAssetLibrary();
  if (!library) throw new Error('商品素材库尚未初始化');
  const available = candidateAssets(library.manifest.assets, angleId);
  if (available.length < 4) throw new Error(`INSUFFICIENT_PRODUCT_PROOF_ASSETS:${angleId}:${available.length}/4`);
  const selectedAngle = angle(angleId);
  const candidates = available.map(item => ({
    assetId: item.assetId, sourcePage: item.sourcePage, moduleTag: item.moduleTag,
    buyerNeedTags: item.buyerNeedTags, sellingAngleTags: item.sellingAngleTags,
    supportedClaims: item.supportedClaims.map(claim => claim.claim), proofStrength: item.proofStrength,
  }));
  const result = await callOpenAICompatibleJsonWithUsage<Partial<ProductNotePlan>>([
    { role: 'system', content: [
      '你是商品笔记策划，不是课程作者。用户已经选定selling angle，你只能为这个角度选择真实素材并写极短图片旁说明。',
      '素材只能证明卖点，不能反过来改变selling angle；不得把DELF B2写作资料写成课程、老师服务或泛泛知识课。',
      '只返回JSON。selectedAssetIds只能从候选assetId中选择4到6个；assets必须每个选中ID恰好一条。每条只写reason、pageRole、shortTitle、badge、oneLine。不要虚构素材没有展示的数量、官方承诺或效果。appendProductPromoPage必须为false。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ productId, sellingAngle: selectedAngle, candidateAssets: candidates }) },
  ], { stage: 'product_note_planner', model: process.env.PRODUCTION_TEXT_MODEL || 'deepseek-flash', maxTokens: 2600, temperature: 0.25, retries: 0 });
  const raw = result.data;
  const ids = Array.isArray(raw.selectedAssetIds) ? raw.selectedAssetIds.filter((id): id is string => typeof id === 'string') : [];
  const validIds = ids.filter(id => candidates.some(asset => asset.assetId === id)).slice(0, 6);
  if (validIds.length < 4) throw Object.assign(new Error(`PRODUCT_NOTE_PLAN_INVALID:${validIds.length}/4`), { usage: result.usage });
  const rawCopies = Array.isArray(raw.assets) ? raw.assets : [];
  const copies: ProductNoteAssetCopy[] = validIds.map((assetId, index) => {
    const copy = rawCopies.find(item => item && typeof item === 'object' && (item as ProductNoteAssetCopy).assetId === assetId) as Partial<ProductNoteAssetCopy> | undefined;
    return { assetId, reason: String(copy?.reason || '这张真实资料页直接证明本篇卖点。'), pageRole: index === 0 ? 'cover' : 'inner', shortTitle: String(copy?.shortTitle || '资料内容'), badge: String(copy?.badge || '真实样张'), oneLine: String(copy?.oneLine || '打开后可按这页内容直接查、练或复盘。') };
  });
  const plan: ProductNotePlan = {
    noteMode: 'product_note', productId: 'delf_b2_writing', angleId, angleLabel: selectedAngle.label,
    targetBuyer: String(raw.targetBuyer || '正在准备 DELF B2 写作、想先看清资料内容的学习者'),
    buyerMoment: String(raw.buyerMoment || selectedAngle.instruction),
    mainClaim: String(raw.mainClaim || selectedAngle.instruction),
    supportingBenefits: Array.isArray(raw.supportingBenefits) ? raw.supportingBenefits.filter((x): x is string => typeof x === 'string').slice(0, 4) : [],
    selectedAssetIds: validIds, assets: copies, appendProductPromoPage: false, plannerRequestId: result.requestId, usage: result.usage,
  };
  return { plan, usage: result.usage };
}

export function productNoteToShowcasePlan(plan: ProductNotePlan, pdfHash: string): ProductShowcasePlan {
  const copyById = new Map(plan.assets.map(item => [item.assetId, item]));
  const assets = plan.selectedAssetIds.map((id, index) => {
    const sourcePage = Number(id.match(/(\d+)$/)?.[1] || 0);
    const copy = copyById.get(id)!;
    const image = `/api/product-assets?assetId=${encodeURIComponent(id)}&pdfHash=${encodeURIComponent(pdfHash)}&size=full`;
    return { id, productId: plan.productId, type: 'sample_analysis', label: copy.shortTitle, image,
      sourceFactIds: [], sourceFile: '商品PDF素材库', sourceSection: `PDF第${sourcePage || '?'}页`, realContent: copy.oneLine,
      userValue: copy.reason, suitableAngles: [plan.angleId], canBeCover: index === 0, canBeInnerPage: index > 0 } as ProductShowcaseAssetCard;
  });
  const first = assets[0];
  const angleDef: ProductShowcaseAngle = { id: plan.angleId, label: plan.angleLabel, instruction: plan.mainClaim, preferredTypes: ['sample_analysis'] };
  return { mode: 'product_showcase', angle: angleDef, coverAsset: first, innerAssets: assets.slice(1) };
}
