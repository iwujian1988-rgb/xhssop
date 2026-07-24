import { CoverTemplateId, TitleTemplateId } from '@/types/data';

const coverTitleMap: Record<CoverTemplateId, TitleTemplateId[]> = {
  list_poster: ['checklist_ready', 'roadmap_planning', 'exam_rescue'],
  table_compare: ['compare_choice', 'mistake_warning', 'dont_only'],
  mistake_compare: ['mistake_warning', 'dont_only', 'not_a_but_b'],
  white_blue_pain: ['effort_failed', 'not_a_but_b', 'dont_only', 'mistake_warning'],
  document_sample: ['checklist_ready', 'effort_failed', 'not_a_but_b'],
  case_review: ['mistake_warning', 'exam_rescue', 'dont_only'],
  plan_table: ['roadmap_planning', 'exam_rescue', 'checklist_ready'],
};

export function getAllowedTitlesForCover(coverTemplateId: CoverTemplateId): TitleTemplateId[] {
  return coverTitleMap[coverTemplateId] || [];
}

export function isCoverTitleCompatible(
  coverTemplateId: CoverTemplateId | null,
  titleTemplateId: TitleTemplateId | null,
) {
  if (!coverTemplateId || !titleTemplateId) return false;
  return getAllowedTitlesForCover(coverTemplateId).includes(titleTemplateId);
}

export function explainCoverTitleMismatch(coverName: string, titleName: string) {
  return `封面类型「${coverName}」和标题类型「${titleName}」错配，已禁止生成。请换成匹配的标题或封面。`;
}
