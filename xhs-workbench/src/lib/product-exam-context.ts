import type { ExamScope, ProductId } from '@/types/data';

export const PRODUCT2_EXAM_SCOPES = ['tef_canada', 'tcf_canada', 'common'] as const;

export function resolveExamScope(productId: ProductId, requested?: string): ExamScope | undefined {
  if (productId === 'tcf_canada_writing_7day') return 'tcf_canada';
  if (productId !== 'tef_tcf_canada') return undefined;
  const value = (requested || '').trim().toLowerCase();
  if (value === 'tef_canada') return 'tef_canada';
  if (value === 'tcf_canada') return 'tcf_canada';
  if (value === 'common') return 'common';
  if (/\btcf(?:\s*canada)?\b/i.test(value) && !/\btef(?:\s*canada)?\b/i.test(value)) return 'tcf_canada';
  if (/\btef(?:\s*canada)?\b/i.test(value) && !/\btcf(?:\s*canada)?\b/i.test(value)) return 'tef_canada';
  return 'common';
}

export function examScopeContext(productId: ProductId, scope?: ExamScope) {
  if (productId === 'tef_tcf_canada') {
    const effective = scope || 'common';
    if (effective === 'tef_canada') return {
      scope: effective,
      displayIdentity: 'TEF Canada',
      rule: '本篇只讲TEF Canada。标题、正文、封面、Caption和Tags不得把TCF写成同一考试，也不得使用“TEF/TCF写作”作为一个考试名称。',
      audience: '准备TEF Canada、关注加拿大移民法语成绩和CLB/NCLC目标的中文学习者。',
    };
    if (effective === 'tcf_canada') return {
      scope: effective,
      displayIdentity: 'TCF Canada',
      rule: '本篇只讲TCF Canada。标题、正文、封面、Caption和Tags不得把TEF写成同一考试，也不得使用“TEF/TCF写作”作为一个考试名称。',
      audience: '准备TCF Canada、关注加拿大移民法语成绩和CLB/NCLC目标的中文学习者。',
    };
    return {
      scope: effective,
      displayIdentity: 'TEF Canada / TCF Canada',
      rule: '只有选考比较、移民政策或两场考试共同适用的方法才能同时提TEF和TCF。写作专题必须选择一个考试；共同内容要写“无论考TEF Canada还是TCF Canada”，不能拼成“写TEF/TCF Canada写作时”。',
      audience: '正在准备加拿大移民法语考试、需要在TEF Canada和TCF Canada之间做选择或使用共同备考方法的中文学习者。',
    };
  }
  if (productId === 'tcf_canada_writing_7day') return {
    scope: 'tcf_canada' as const,
    displayIdentity: 'TCF Canada',
    rule: '本篇只讲TCF Canada写作，必须区分Tâche 1、Tâche 2和Tâche 3，不得混入TEF或DELF。',
    audience: '考前7天准备TCF Canada写作、需要快速定位并纠正写作问题的中文学习者。',
  };
  return undefined;
}
