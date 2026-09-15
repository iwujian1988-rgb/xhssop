import type { ProductId } from '@/types/data';

// 小红书搜索下拉词信号。标题只把它当软参考；标签会从中挑与正文匹配的真实搜索词，
// 不是要求每个标题或每组标签把整池关键词全部硬塞进去。
export interface XhsSearchKeywordGroup {
  primary: string[];
  secondary: string[];
  avoid: string[];
  validated_at: string;
}

const KEYWORDS: Record<ProductId, XhsSearchKeywordGroup> = {
  delf_b2_writing: {
    primary: ['模板', '范文', '真题', '题型', '技巧', '信件', '格式', '多少词', '高分范文', '主题'],
    secondary: [
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
      '写几篇',
      '招聘会',
    ],
    avoid: ['14分', '一个月', '时间分配', '时间不够'],
    validated_at: '2026-08-23-xhs-related-search-screenshot',
  },
  tef_tcf_canada: {
    // 商品2暂未拿到小红书下拉词截图。这里先用资料包内真实需求词兜底，
    // 后续用户补搜索建议后，把 validated_at 改成实测日期。
    primary: ['TEF Canada', 'TCF Canada', 'CLB7', '加拿大法语', '备考资料'],
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
  tcf_canada_writing_7day: {
    primary: ['TCF Canada写作', 'TCF写作', 'TCF Canada备考', '法语写作', '考前资料'],
    secondary: ['TCF写作题型', 'TCF写作范文', 'TCF写作模板', 'TCF写作字数', 'T1写作', 'T2写作', 'T3写作', 'TCF写作怎么练', 'TCF写作纠错', '7天备考'],
    avoid: [],
    validated_at: 'product-derived-from-source-markdown',
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
