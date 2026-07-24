import { SkillData, ChainId, CoverTemplateId, TitleTemplateId, PageTemplateId } from '@/types/data';
import { explainCoverTitleMismatch, isCoverTitleCompatible } from './cover-title-compatibility';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateChainProduct(chainId: ChainId, data: SkillData): ValidationResult {
  const chain = data.chains[chainId];
  if (!chain) return { valid: false, errors: [`链路 ${chainId} 不存在`] };
  if (!data.products[chain.product_id]) return { valid: false, errors: [`商品 ${chain.product_id} 不存在`] };
  return { valid: true, errors: [] };
}

export function validateCoverTemplate(
  coverTemplateId: CoverTemplateId,
  chainId: ChainId,
  data: SkillData,
): ValidationResult {
  const chain = data.chains[chainId];
  if (!chain) return { valid: false, errors: ['链路不存在'] };
  if (!chain.allowed_cover_templates.includes(coverTemplateId)) {
    return {
      valid: false,
      errors: [`封面母版「${data.cover_templates[coverTemplateId]?.name || coverTemplateId}」不适合当前链路「${chain.name}」。`],
    };
  }
  return { valid: true, errors: [] };
}

export function validateTitleTemplate(
  titleTemplateId: TitleTemplateId,
  chainId: ChainId,
  data: SkillData,
): ValidationResult {
  const chain = data.chains[chainId];
  if (!chain) return { valid: false, errors: ['链路不存在'] };
  if (!chain.allowed_title_templates.includes(titleTemplateId)) {
    return {
      valid: false,
      errors: [`标题母版「${data.title_templates[titleTemplateId]?.name || titleTemplateId}」不适合当前链路「${chain.name}」。`],
    };
  }
  return { valid: true, errors: [] };
}

export function validateCoverTitleTemplatePair(
  coverTemplateId: CoverTemplateId,
  titleTemplateId: TitleTemplateId,
  data: SkillData,
): ValidationResult {
  if (isCoverTitleCompatible(coverTemplateId, titleTemplateId)) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: [
      explainCoverTitleMismatch(
        data.cover_templates[coverTemplateId]?.name || coverTemplateId,
        data.title_templates[titleTemplateId]?.name || titleTemplateId,
      ),
    ],
  };
}

export function validatePageTemplate(
  pageTemplateId: PageTemplateId,
  chainId: ChainId,
  data: SkillData,
): ValidationResult {
  const chain = data.chains[chainId];
  if (!chain) return { valid: false, errors: ['链路不存在'] };
  if (!chain.allowed_page_templates.includes(pageTemplateId)) {
    return {
      valid: false,
      errors: [`内页结构「${data.page_templates[pageTemplateId]?.name || pageTemplateId}」不适合当前链路「${chain.name}」。`],
    };
  }
  return { valid: true, errors: [] };
}

export function validateHotTitle(hotTitleId: string, chainId: ChainId, data: SkillData): ValidationResult {
  const hotTitle = data.hot_titles.find(h => h.id === hotTitleId);
  if (!hotTitle) return { valid: false, errors: [`标题公式 ${hotTitleId} 不存在`] };
  const chain = data.chains[chainId];
  if (!chain.allowed_title_templates.includes(hotTitle.suitable_title_template)) {
    return {
      valid: false,
      errors: [`标题公式「${hotTitle.source_title}」归类到「${data.title_templates[hotTitle.suitable_title_template]?.name}」，不适合当前链路。`],
    };
  }
  return { valid: true, errors: [] };
}

export function checkForbiddenTerms(text: string, chainId: ChainId, data: SkillData): ValidationResult {
  const chain = data.chains[chainId];
  const productForbidden = data.compatibility_matrix.product_forbidden_terms[chain.product_id] || [];
  const allForbidden = [...chain.forbidden_terms, ...productForbidden, ...data.compatibility_matrix.global_forbidden];
  const errors = Array.from(new Set(allForbidden))
    .filter(term => term && text.includes(term))
    .map(term => `内容包含禁用词「${term}」`);

  return { valid: errors.length === 0, errors };
}

export function validateContentVolume(contentCore: string, contentSourceType: string): ValidationResult {
  const errors: string[] = [];
  const text = contentCore.trim();

  if (!text) return { valid: false, errors: ['内容不能为空'] };

  if (contentSourceType === 'knowledge_point') {
    const lineCount = text.split('\n').filter(l => l.trim().length > 0).length;
    const hasArrow = /->|→|=>|：|:/.test(text);
    const hasExample = /例如|示例|比如|例句|清单|对照|范文|句型/.test(text);
    if (lineCount < 3 && !hasArrow && !hasExample) {
      errors.push('知识点内容太薄了，至少给对照、例句、清单或样张之一。');
    }
  }

  if (contentSourceType === 'third_party_post') {
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0 || (lines.length < 2 && text.length < 50)) {
      errors.push('第三方帖子内容不够，至少给 1-3 段原文/摘录/截图 OCR。');
    }
  }

  return { valid: errors.length === 0, errors };
}
