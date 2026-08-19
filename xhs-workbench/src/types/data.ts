// ---- 商品 ----
export type ProductId = 'delf_b2_writing' | 'tef_tcf_canada' | 'tcf_canada_writing_7day';

export interface PresetSellingPoint {
  id: string;
  name: string;
  suitable_angles: string[];
}

export interface SEOKeywords {
  core: string[];
  long_tail: string[];
}

export interface Product {
  id: ProductId;
  name: string;
  public_name_options: string[];
  core_audience: string[];
  preset_selling_points: PresetSellingPoint[];
  seo_keywords: SEOKeywords;
  default_tags: string[];
}

// ---- 链路 ----
export type ChainId =
  | 'delf_b2_formula_migration'
  | 'delf_b2_expression_upgrade'
  | 'delf_b2_sentence_patterns'
  | 'delf_b2_mistake_contrast'
  | 'tef_tcf_exam_choice'
  | 'tef_tcf_30_day_clb7';

export type ContentSourceType =
  | 'preset_selling_point'
  | 'knowledge_point'
  | 'third_party_post';

export interface Chain {
  id: ChainId;
  name: string;
  version_scope: string;
  product_id: ProductId;
  content_intent: string;
  allowed_content_source_types: ContentSourceType[];
  recommended_product_points: string[];
  allowed_cover_templates: CoverTemplateId[];
  allowed_title_templates: TitleTemplateId[];
  allowed_page_templates: PageTemplateId[];
  example_cover_titles: string[];
  required_inputs: string[];
  forbidden_terms: string[];
  conflict_notes: string;
}

// ---- 封面母版 ----
export type CoverTemplateId =
  | 'white_blue_pain'
  | 'list_poster'
  | 'table_compare'
  | 'document_sample'
  | 'case_review'
  | 'mistake_compare'
  | 'plan_table';

export interface CanvasConfig {
  ratio: string;
  size: string; // "1080x1440"
}

export interface CoverTemplate {
  id: CoverTemplateId;
  name: string;
  purpose: string;
  similarity_mode?: string;
  description?: string;
  suitable_content: string[];
  canvas: CanvasConfig;
  layout_rules: Record<string, unknown>;
  variable_fields: string[];
  locked_fields: string[];
  forbidden: string[];
}

// ---- 标题母版 ----
export type TitleTemplateId =
  | 'effort_failed'
  | 'not_a_but_b'
  | 'dont_only'
  | 'compare_choice'
  | 'checklist_ready'
  | 'mistake_warning'
  | 'exam_rescue'
  | 'roadmap_planning';

export interface TitleTemplateStructure {
  formula: string;
  psychological_hook: string;
}

export interface OutputRules {
  cover_title?: { max_lines: number; tone: string };
  xhs_title?: { formula: string };
}

export interface TitleTemplate {
  id: TitleTemplateId;
  name: string;
  reference_examples: string[];
  structure: TitleTemplateStructure;
  suitable_content: string[];
  output_rules?: OutputRules;
  example_mapping?: Record<string, unknown>;
}

// ---- 内页结构 ----
export type PageTemplateId =
  | 'pain_breakdown'
  | 'list_value'
  | 'table_compare'
  | 'sample_showcase'
  | 'case_review'
  | 'roadmap'
  | 'mistake_compare'
  | 'plan_calendar';

export interface PageTemplate {
  id: PageTemplateId;
  name: string;
  suitable_for: string[];
  page_count: number;
  structure: Record<string, string>; // "P1": "封面", "P2": "问题是什么", ...
  recommended_single_page_formats: string[];
}

// ---- 文案格式 ----
export type CopyFormatId =
  | 'conclusion_bullets'
  | 'wrong_right'
  | 'table'
  | 'sample_annotation'
  | 'steps';

export interface CopyFormat {
  id: CopyFormatId;
  name: string;
  structure: string[];
  word_limit: Record<string, string>;
}

// ---- 爆款标题 ----
export interface HotTitle {
  id: string;
  source_title: string;
  extracted_structure: string;
  suitable_title_template: TitleTemplateId;
  notes: string;
}

// ---- SEO Tags ----
export interface SEOTagSet {
  core_keywords: string[];
  long_tail_keywords: string[];
  tags: string[];
}

// ---- 兼容性矩阵 ----
export interface StateRequiredFields {
  before_content: string[];
  before_cover_generation: string[];
  before_page_generation: string[];
  before_caption_generation: string[];
}

export interface CompatibilityMatrix {
  principle: string;
  global_forbidden: string[];
  product_forbidden_terms: Record<ProductId, string[]>;
  state_required_fields: StateRequiredFields;
  content_volume_rules: {
    knowledge_point_minimum: string;
    short_content_action: string;
  };
  title_hot_title_rule: string;
  visual_rule: string;
}

// ---- 聚合数据存储 ----
export interface SkillData {
  products: Record<ProductId, Product>;
  chains: Record<ChainId, Chain>;
  cover_templates: Record<CoverTemplateId, CoverTemplate>;
  title_templates: Record<TitleTemplateId, TitleTemplate>;
  page_templates: Record<PageTemplateId, PageTemplate>;
  copy_formats: Record<CopyFormatId, CopyFormat>;
  hot_titles: HotTitle[];
  seo_tags: Record<ProductId, SEOTagSet>;
  compatibility_matrix: CompatibilityMatrix;
}
