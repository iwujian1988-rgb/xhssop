import { CoverTemplateId, TitleTemplateId } from './data';

export type NoteFormat =
  | 'real_experience'
  | 'product_showcase'
  | 'knowledge_teaching'
  | 'self_test';

export type TitleTriggerType =
  | 'cognitive_conflict'
  | 'curiosity_gap'
  | 'fear_loss'
  | 'identity'
  | 'number_anchor'
  | 'result_promise'
  | 'social_proof'
  | 'controversy'
  | 'scenario'
  | 'action_call'
  | 'authority'
  | 'interaction_test';

export type PageVisualType =
  | 'cover'
  | 'big_text'
  | 'checklist'
  | 'table'
  | 'wrong_right'
  | 'flow'
  | 'doc_sample'
  | 'directory'
  | 'self_test'
  | 'soft_sell'
  | 'fit';

export type FactCategory =
  | 'audiences'
  | 'use_cases'
  | 'raw_pain_points'
  | 'raw_selling_points'
  | 'knowledge_assets'
  | 'content_modules'
  | 'displayable_assets';

export interface ProductFactItem {
  id: string;
  text: string;
  source_file: string;
  source_section: string;
  evidence: string;
  raw_keywords: string[];
}

export type ProductFacts = Record<FactCategory, ProductFactItem[]>;

export interface CreativeAsset {
  id: string;
  source_id: string;
  source_category: FactCategory;
  text: string;
  source_file: string;
  evidence: string;
  tags: string[];
}

export interface EvidenceAsset {
  id: string;
  text: string;
  source_file: string;
  source_section: string;
  evidence: string;
  tags: string[];
  asset_type: string;
  related_selling_point_ids: string[];
  can_support_pain_ids: string[];
  can_be_visualized_as: string[];
  allowed_cover_types: CoverTemplateId[];
  forbidden_cover_types: CoverTemplateId[];
  can_be_cover: boolean;
  can_be_inner_page: boolean;
  can_be_purchase_reason: boolean;
}

export interface PainCluster {
  id: string;
  name: string;
  user_facing_pain: string;
  tags: string[];
  detail_pain_ids: string[];
}

export interface SellingCluster {
  id: string;
  name: string;
  user_facing_value: string;
  tags: string[];
  raw_selling_point_ids: string[];
}

export interface AudienceCluster {
  id: string;
  name: string;
  user_state: string;
  tags: string[];
  raw_audience_ids: string[];
}

export interface HardGateResult {
  passed: boolean;
  reasons: string[];
}

export interface CandidateScore {
  total: number;
  pain_strength: number;
  selling_solution_fit: number;
  evidence_support: number;
  visual_display: number;
  title_click_potential: number;
  product_fit: number;
  freshness: number;
}

export interface CreativeBrief {
  audience_state: string;
  user_pain: string;
  user_value: string;
  proof_asset: string;
  detail_example: string;
  note_angle: string;
  product_claim_limit: string;
}

export interface TitleFormulaOption {
  formula_id: string;
  trigger_type: TitleTriggerType;
  formula: string;
  title: string;
  note_format: NoteFormat;
  reason: string;
  risk_flags: string[];
}

export interface PageBlueprint {
  page_no: number;
  role: 'cover' | 'hook' | 'turn' | 'value' | 'proof' | 'soft_sell' | 'fit';
  visual_type: PageVisualType;
  page_title: string;
  main_text: string;
  bullets: string[];
  asset_hint: string;
}

export interface NoteFormatPlan {
  note_format: NoteFormat;
  title: string;
  title_formula_id: string;
  caption_angle: string;
  pages: PageBlueprint[];
}

export interface NoteCandidate {
  id: string;
  audience_cluster?: AudienceCluster;
  audience?: CreativeAsset;
  pain_cluster: PainCluster;
  pain: CreativeAsset;
  selling_cluster: SellingCluster;
  selling_point: CreativeAsset;
  knowledge_asset: CreativeAsset;
  evidence_asset: EvidenceAsset;
  tags: string[];
  allowed_title_templates: TitleTemplateId[];
  allowed_cover_templates: CoverTemplateId[];
  hard_gate: HardGateResult;
  score: CandidateScore;
  creative_brief: CreativeBrief;
  recommended_note_formats: NoteFormat[];
  title_options: TitleFormulaOption[];
  format_plans: NoteFormatPlan[];
}

export interface ContentPlanningResult {
  facts_summary: Record<FactCategory, number>;
  audiences: CreativeAsset[];
  pains: CreativeAsset[];
  selling_points: CreativeAsset[];
  knowledge_assets: CreativeAsset[];
  evidence_assets: EvidenceAsset[];
  pain_clusters: PainCluster[];
  selling_clusters: SellingCluster[];
  audience_clusters: AudienceCluster[];
  candidates: NoteCandidate[];
  rejected_count: number;
}
