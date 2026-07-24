import fs from 'node:fs/promises';
import { FactCategory, ProductFacts } from '@/types/content-planning';
import { ProductId } from '@/types/data';

const FACT_PATHS: Record<ProductId, string> = {
  delf_b2_writing: 'D:\\claude_work\\xunixiangmu\\deliverables\\product_facts.json',
  tef_tcf_canada: 'D:\\claude_work\\taolun\\法语付费资料\\product_facts.json',
};

const CATEGORIES: FactCategory[] = [
  'audiences',
  'use_cases',
  'raw_pain_points',
  'raw_selling_points',
  'knowledge_assets',
  'content_modules',
  'displayable_assets',
];

export async function loadProductFacts(productId: ProductId): Promise<ProductFacts> {
  const path = FACT_PATHS[productId];
  const raw = await fs.readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ProductFacts>;

  for (const category of CATEGORIES) {
    if (!Array.isArray(parsed[category])) {
      throw new Error(`product_facts missing array: ${category}`);
    }
  }

  return parsed as ProductFacts;
}
