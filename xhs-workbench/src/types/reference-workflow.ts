import type { ProductId } from './data';

export type CreativeCardRenderer =
  | 'parchment_dense_directory'
  | 'white_green_directory'
  | 'clean_purple_directory'
  | 'grid_purple_directory'
  | 'blackboard_phrase'
  | 'blackboard_offer'
  | 'memo_offer'
  | 'word_flashcard'
  | 'book_cover'
  | 'notebook_big_words'
  | 'plain_experience'
  | 'document_analysis'
  | 'vocab_table'
  | 'course_roadmap'
  | 'collocation_dense'
  | 'official_notice'
  | 'pain_quote_big'
  | 'ai_scene_overlay';

export type ContentShape =
  | 'directory'
  | 'phrase'
  | 'offer'
  | 'flashcard'
  | 'book'
  | 'pain'
  | 'experience'
  | 'document'
  | 'table'
  | 'roadmap';

export type TitleCandidateType = '资料型' | '解释型' | '痛点型' | '强钩子型' | '情绪型' | '结果型';

export type CoverTitleType = '资料' | '大全' | '时效' | '稀缺' | '情绪' | '结果' | '反常识';

export interface EditorialSeed {
  seed_id: string;
  product_id: ProductId;
  topic: string;
  keyword_candidates: string[];
  audience: string;
  user_pain: string;
  user_need: string;
  pay_trigger: string;
  use_scenario: string;
  content_shapes: ContentShape[];
  anchor_fact_ids: string[];
  dynamic_fact_terms: string[];
  ai_original_scope: string;
  title_trigger_types: string[];
  page_plan: string[];
}

export interface CompetitorCreativeCard {
  id: string;
  name: string;
  reference_image: string;
  renderer_id: CreativeCardRenderer;
  content_mechanism: string;
  click_mechanism: string;
  visual_mechanism: string;
  suitable_audiences: string[];
  suitable_pains: string[];
  required_payload: string[];
  forbidden_uses: string[];
  density: 'low' | 'medium' | 'high' | 'very_high';
  supported: boolean;
}

export interface MigratedTopic {
  id: string;
  scope_level?: 'broad' | 'narrow';
  topic_type?: 'search_pain' | 'selling_point' | 'narrow_knowledge' | 'product_showcase';
  topic: string;
  audience: string;
  scene: string;
  pain: string;
  content_promise: string;
  product_bridge: string;
  why_this_reference_fits: string;
  novelty: string;
  search_terms: string[];
  content_source_plan: {
    knowledge_base: string;
    ai_original: string;
  };
  seed_id?: string;
  content_shape?: ContentShape;
  anchor_fact_ids?: string[];
  dynamic_fact_terms?: string[];
  ai_original_scope?: string;
  title_trigger_types?: string[];
  page_plan?: string[];
}

export interface EvidenceSnippet {
  id: string;
  category: string;
  text: string;
  evidence: string;
  source_file: string;
  source_section: string;
  score: number;
  source_role?: 'anchor' | 'dynamic';
  source_excerpt?: string;
  usage_caution?: string;
}

export interface UnifiedContentBrief {
  product_id: ProductId;
  reference_card_id: string;
  topic: string;
  audience: string;
  scene: string;
  pain: string;
  content_value: string;
  content_shape: string;
  selling_point: string;
  buying_reason: string;
  product_claim_limit: string;
  knowledge_base_plan: string;
  ai_original_plan: string;
  cover_requirement: string;
  difference_from_recent: string;
  seed_id?: string;
  page_plan?: string[];
  public_source_policy?: string;
}

export interface TitleCandidate {
  title: string;
  title_type?: TitleCandidateType;
  formula_id: string;
  trigger_type: string;
  formula_skeleton: string;
  reason: string;
  risk_flags: string[];
}

export interface CoverTitleCandidate {
  template_id: CreativeCardRenderer;
  title: string;
  subtitle?: string;
  title_type?: CoverTitleType;
  reason?: string;
  fit_score?: number;
}

export interface DenseDirectoryItem {
  primary: string;
  secondary?: string;
  note?: string;
}

export interface DenseDirectorySection {
  side_label: string;
  heading: string;
  columns: 2 | 3 | 4 | 5;
  items: DenseDirectoryItem[];
  source_type: 'knowledge_base' | 'ai_derived' | 'ai_original' | 'mixed';
  source_ids: string[];
}

export interface DenseDirectoryCoverPayload {
  kind: 'dense_directory';
  title: string;
  subtitle: string;
  sections: DenseDirectorySection[];
}

export type InnerPageStyleVariant =
  | 'lined-notebook'
  | 'grid-notebook'
  | 'dot-notebook'
  | 'sticky-note'
  | 'draft-paper'
  | 'loose-leaf'
  | 'kraft-paper';

export interface GeneratedInnerPage {
  page_no: number;
  page_type: 'knowledge_list' | 'example_explain' | 'wrong_right' | 'steps' | 'product_bridge';
  page_title: string;
  lead: string;
  bullets: string[];
  source_ids: string[];
  style_variant?: InnerPageStyleVariant;
}

export interface ReferenceDrivenDraft {
  id: string;
  brief: UnifiedContentBrief;
  title_candidates: TitleCandidate[];
  selected_title: string;
  cover_title_candidates?: CoverTitleCandidate[];
  cover: DenseDirectoryCoverPayload;
  inner_pages: GeneratedInnerPage[];
  caption: string;
  tags: string[];
  /** 本篇 caption 的叙事骨架 id（failure_recovery 等 5 种，代码按 seed 指定）。
   *  记录进 title-usage-store，喂回下一批让骨架分布可观测、可去重。 */
  narrative_skeleton?: string;
  seo_keywords: string[];
  accuracy_audit: {
    approved: boolean;
    corrected_count: number;
    issues: string[];
  };
  evidence: EvidenceSnippet[];
  checks: {
    title_cover_consistent: boolean;
    template_capacity_ok: boolean;
    product_claims_grounded: boolean;
    content_density_ok: boolean;
    issues: string[];
    warnings?: string[];
  };
}

export interface ReferenceWorkflowRequest {
  action: 'topics' | 'compose';
  product_id: ProductId;
  reference_card_id: string;
  direction?: string;
  topic?: MigratedTopic;
  max_attempts?: number;
}
