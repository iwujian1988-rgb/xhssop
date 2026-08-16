import type { ProductId } from '@/types/data';

// 小红书搜索下拉词信号。它只用于标题生成时提醒 LLM 贴近真实搜索入口，
// 不是 SEO 标签池，也不是要求每个标题都硬塞关键词。
export interface XhsSearchKeywordGroup {
  primary: string[];
  secondary: string[];
  avoid: string[];
  validated_at: string;
}

const KEYWORDS: Record<ProductId, XhsSearchKeywordGroup> = {
  delf_b2_writing: {
    primary: ['模板', '范文', '题型', '格式', '评分标准', '批改', '备考资料', '备考攻略'],
    secondary: [
      '真题',
      '高分范文',
      '万能模板',
      '建议信',
      '论坛讨论',
      '议论文',
      '正式非正式',
      '写作题型',
      '句型',
      '连接词',
      '表达',
      '主题',
      '技巧',
      '开头',
      '结尾',
      '用什么书',
      '备考多久',
      'AI批改',
    ],
    avoid: ['14分', '一个月', '时间分配', '时间不够'],
    validated_at: '2026-07-27',
  },
  tef_tcf_canada: {
    // 商品2暂未拿到小红书下拉词截图。这里先用资料包内真实需求词兜底，
    // 后续用户补搜索建议后，把 validated_at 改成实测日期。
    primary: ['TEF Canada', 'TCF Canada', 'CLB7', '法语B2备考', '加拿大法语', '备考资料'],
    secondary: [
      'TEF还是TCF',
      'TCF备考',
      'TEF备考',
      '法语移民',
      'CLB7自测',
      '30天备考',
      '写作句型',
      '主题词汇',
      '真题主题',
      '听力怎么练',
      '口语怎么练',
      '报名流程',
      '查分',
    ],
    avoid: [],
    validated_at: 'product-derived-fallback',
  },
};

export function getXhsSearchKeywords(productId: ProductId): XhsSearchKeywordGroup {
  return KEYWORDS[productId] || { primary: [], secondary: [], avoid: [], validated_at: '' };
}

export function getTitleReferenceKeywords(productId: ProductId): string[] {
  const group = getXhsSearchKeywords(productId);
  return [...group.primary, ...group.secondary];
}

export function getAvoidedLowTrafficKeywords(productId: ProductId): string[] {
  return getXhsSearchKeywords(productId).avoid;
}
