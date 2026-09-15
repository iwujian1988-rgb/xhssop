/* eslint-disable no-console */
/** Offline contract test for the product-showcase branch. It does not call an AI API. */
import fs from 'node:fs';
import path from 'node:path';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { buildProductShowcaseAssets, pickProductShowcasePlan } from '@/lib/product-showcase-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getCompetitorCreativeCard, productShowcaseCreativeCards } from '@/lib/creative-card-library';

const root = process.cwd();
const products = ['delf_b2_writing', 'tef_tcf_canada', 'tcf_canada_writing_7day'] as const;

for (const productId of products) {
  const facts = await loadProductFacts(productId);
  const assets = buildProductShowcaseAssets(productId, facts);
  if (!assets.length) throw new Error(`${productId}: 没有资料卡`);
  if (assets.some(asset => asset.image?.endsWith('/page-002.jpg'))) throw new Error(`${productId}: 用户拒绝的 page-002.jpg 不得进入可见资产池`);
  const plan = pickProductShowcasePlan(productId, facts, `${productId}|offline-test`);
  if (!plan.coverAsset) throw new Error(`${productId}: 没有封面资料卡`);
  if (plan.innerAssets.length !== 5) throw new Error(`${productId}: 内页资料卡应为5张，实际${plan.innerAssets.length}张`);
  for (const asset of [plan.coverAsset, ...plan.innerAssets]) {
    if (!asset.sourceFactIds.length) throw new Error(`${productId}/${asset.id}: 没有事实来源`);
    if (asset.image) {
      const relative = asset.image.replace(/^\//, '').replaceAll('/', path.sep);
      if (!fs.existsSync(path.join(root, 'public', relative))) {
        console.warn(`[showcase] ${productId}/${asset.id}: 图片未预置，将使用资料卡文字页`);
      }
    }
  }
  console.log(`[showcase] ${productId}: ${assets.length} cards -> cover=${plan.coverAsset.id}, inner=${plan.innerAssets.map(item => item.id).join(',')}`);
}

if (productShowcaseCreativeCards.length !== 4) throw new Error('商品介绍模式应有4张可选封面截图');
for (const card of productShowcaseCreativeCards) {
  if (!getCompetitorCreativeCard(card.id)) throw new Error(`创作卡未注册：${card.id}`);
  if (getCoverTemplateSpec(card.renderer_id)?.renderMode !== 'hybrid') throw new Error(`截图卡不是 hybrid：${card.id}`);
}
console.log('[showcase] PASS: product, card, cover and inner asset contracts are connected');
