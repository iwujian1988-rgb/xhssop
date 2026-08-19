import fs from 'node:fs/promises';
import path from 'node:path';

import type { FactCategory, ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';

const LEGACY_FACT_PATHS: Record<ProductId, string> = {
  delf_b2_writing: 'D:\\claude_work\\xunixiangmu\\deliverables\\product_facts.json',
  tef_tcf_canada: 'D:\\claude_work\\waiyuxhssop\\xhs-workbench\\data\\product_facts_tef_tcf.json',
  tcf_canada_writing_7day: 'D:\\claude_work\\waiyuxhssop\\xhs-workbench\\data\\product_facts_tcf_canada_7day.json',
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
  const candidates = factPathCandidates(productId);
  let raw: string | undefined;
  let resolvedPath = '';
  for (const candidate of candidates) {
    try {
      raw = await fs.readFile(candidate, 'utf8');
      resolvedPath = candidate;
      break;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
  }
  if (!raw) {
    throw new Error(`商品 ${productId} 缺少结构化事实文件。已检查：${candidates.join('；')}`);
  }
  const parsed = JSON.parse(raw) as Partial<ProductFacts>;

  for (const category of CATEGORIES) {
    if (!Array.isArray(parsed[category])) {
      throw new Error(`product_facts missing array: ${category} (${resolvedPath})`);
    }
  }

  return parsed as ProductFacts;
}

function factPathCandidates(productId: ProductId) {
  const envPath = productId === 'delf_b2_writing'
    ? process.env.DELF_PRODUCT_FACTS_PATH
    : productId === 'tef_tcf_canada'
      ? process.env.TEF_TCF_PRODUCT_FACTS_PATH
      : process.env.TCF_CANADA_WRITING_7DAY_FACTS_PATH;
  const repoName = productId === 'delf_b2_writing'
    ? 'product_facts_delf_b2.json'
    : productId === 'tef_tcf_canada'
      ? 'product_facts_tef_tcf.json'
      : 'product_facts_tcf_canada_7day.json';
  return Array.from(new Set([
    envPath,
    path.resolve(process.cwd(), 'data', repoName),
    LEGACY_FACT_PATHS[productId],
  ].filter((value): value is string => Boolean(value))));
}
