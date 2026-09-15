import pool from '../../../data/product_promo_pool_delf_b2.json';
import { stableHash } from './contracts';

export function selectProductPromo(productId: string, seed: string, previousText = '', recentTexts: string[] = []) {
  if (productId !== pool.productId || pool.reviewStatus !== 'approved') return undefined;
  const retained = pool.items.find(item => item.text === previousText);
  if (retained) return retained;
  const start = parseInt(stableHash(seed),36) % pool.items.length;
  const rotated = [...pool.items.slice(start),...pool.items.slice(0,start)];
  return rotated.find(item => !recentTexts.some(text => text.includes(item.text) || text.includes(item.text.slice(-16)))) || rotated[0];
}

export function approvedPromoByText(text: string) {
  return pool.reviewStatus === 'approved' ? pool.items.find(item => item.text === text) : undefined;
}
