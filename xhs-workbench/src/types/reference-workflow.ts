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
  | 'ai_scene_overlay';

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
}

export interface EvidenceSnippet {
  id: string;
  category: string;
  text: string;
  evidence: string;
  source_file: string;
  source_section: string;
  score: number;
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
}

export interface TitleCandidate {
  title: string;
  formula_id: string;
  trigger_type: string;
  formula_skeleton: string;
  reason: string;
  risk_flags: string[];
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

export interface GeneratedInnerPage {
  page_no: number;
  page_type: 'knowledge_list' | 'example_explain' | 'wrong_right' | 'steps' | 'product_bridge';
  page_title: string;
  lead: string;
  bullets: string[];
  source_ids: string[];
}

export interface ReferenceDrivenDraft {
  id: string;
  brief: UnifiedContentBrief;
  title_candidates: TitleCandidate[];
  selected_title: string;
  cover: DenseDirectoryCoverPayload;
  inner_pages: GeneratedInnerPage[];
  caption: string;
  tags: string[];
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
