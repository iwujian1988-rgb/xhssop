import fs from 'node:fs/promises';
import { FactCategory, ProductFacts } from '@/types/content-planning';
import { ProductId } from '@/types/data';

const FACT_PATHS: Record<ProductId, string> = {
  delf_b2_writing: 'D:\\claude_work\\xunixiangmu\\deliverables\\product_facts.json',
  tef_tcf_canada: 'D:\\claude_work\\waiyuxhssop\\xhs-workbench\\data\\product_facts_tef_tcf.json',
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
  const raw = await fs.readFile(path, 'utf8').catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`商品 ${productId} 的结构化知识事实尚未准备：${path}`);
    }
    throw cause;
  });
  const parsed = JSON.parse(raw) as Partial<ProductFacts>;

  for (const category of CATEGORIES) {
    if (!Array.isArray(parsed[category])) {
      throw new Error(`product_facts missing array: ${category}`);
    }
  }

  return parsed as ProductFacts;
}
