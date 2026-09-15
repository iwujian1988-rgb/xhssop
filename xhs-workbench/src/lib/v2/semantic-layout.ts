import type { SemanticLayoutType } from '@/types/reference-workflow';

/** Maps the execution/content contract to a presentation contract. */
export function semanticLayoutTypeFromAssetType(assetType: string | undefined): SemanticLayoutType {
  const value = String(assetType || '').trim().toLowerCase();
  if (value === 'comparison') return 'comparison';
  if (value === 'self_test' || value === 'checklist') return 'checklist';
  if (value === 'expression_bank' || value === 'phrase') return 'expression_bank';
  if (value === 'mistake') return 'mistake';
  if (value === 'before_after') return 'before_after';
  if (value === 'timeline') return 'timeline';
  if (value === 'step_by_step' || value === 'steps') return 'steps';
  if (value === 'argument_bank' || value === 'collection' || value === 'category_cards') return 'category_cards';
  if (value === 'example_breakdown') return 'example_breakdown';
  if (value === 'framework' || value === 'list' || value === 'dense_reference') return 'dense_reference';
  return 'knowledge_list';
}
