import {
  ChainId,
  ContentSourceType,
  CoverTemplateId,
  TitleTemplateId,
  PageTemplateId,
  CopyFormatId,
} from './data';

// ---- 页面角色 ----
export type PageRole = 'cover' | 'bridge' | 'value' | 'proof' | 'soft_sell' | 'fit';

// ---- 封面候选 ----
export interface CoverVariant {
  id: string; // "variant_1" | "variant_2" | "variant_3"
  version_type: string;
  competitor_style_id?: string;
  cover_title: string;
  cover_title_lines: string[];
  xhs_title: string;
  title_source: string;
  migration_logic: string;
  seo_keywords: string[];
  cover_template_id: CoverTemplateId;
  title_template_id: TitleTemplateId;
  layout_notes: string;
}

// ---- 内页脚本 ----
export interface PageScript {
  page_no: number; // 1-7
  role: PageRole;
  page_title: string;
  core_conclusion: string;
  support_content: string[];
  copy_format_id: CopyFormatId;
  visual_notes: string;
}

// ---- 工作流状态（唯一可变状态源）----
export interface WorkflowState {
  // Step 1-2: 链路 + 商品
  chain_id: ChainId | null;
  // product_id 从 chain 推导，不直接存储

  // Step 3-4: 内容
  content_source_type: ContentSourceType | null;
  content_core: string | null;
  selected_product_point_id: string | null;

  // Step 5-6: 母版
  cover_template_id: CoverTemplateId | null;
  title_template_id: TitleTemplateId | null;
  hot_title_id: string | null;
  selected_reference_id: string | null;

  // Step 7-8: 封面候选
  variants: CoverVariant[];
  selected_variant_id: string | null;

  // Step 9: 内页
  page_template_id: PageTemplateId | null;
  page_scripts: PageScript[] | null;

  // Step 10: caption + tags
  caption: string | null;
  tags: string[];
}

// ---- 初始状态 ----
export const INITIAL_STATE: WorkflowState = {
  chain_id: null,
  content_source_type: null,
  content_core: null,
  selected_product_point_id: null,
  cover_template_id: null,
  title_template_id: null,
  hot_title_id: null,
  selected_reference_id: null,
  variants: [],
  selected_variant_id: null,
  page_template_id: null,
  page_scripts: null,
  caption: null,
  tags: [],
};

// ---- 工作流步骤枚举（由状态派生）----
export type WorkflowStep =
  | 'select_chain'
  | 'select_content_source'
  | 'fill_content'
  | 'select_cover_template'
  | 'select_title_template'
  | 'generate_covers'
  | 'select_variant'
  | 'generate_pages'
  | 'generate_caption'
  | 'export';

// ---- Reducer Actions ----
export type WorkflowAction =
  | { type: 'SET_CHAIN'; chain_id: ChainId }
  | { type: 'SET_CONTENT_SOURCE'; content_source_type: ContentSourceType }
  | { type: 'SET_CONTENT_CORE'; content_core: string; product_point_id?: string | null }
  | { type: 'SET_COVER_TEMPLATE'; cover_template_id: CoverTemplateId }
  | { type: 'SET_REFERENCE_COVER'; reference_id: string; cover_template_id: CoverTemplateId }
  | { type: 'SET_TITLE_TEMPLATE'; title_template_id: TitleTemplateId; hot_title_id?: string | null }
  | { type: 'SET_VARIANTS'; variants: CoverVariant[] }
  | { type: 'SELECT_VARIANT'; variant_id: string }
  | { type: 'SET_PAGE_TEMPLATE'; page_template_id: PageTemplateId }
  | { type: 'SET_PAGE_SCRIPTS'; page_scripts: PageScript[] }
  | { type: 'SET_CAPTION_AND_TAGS'; caption: string; tags: string[] }
  | { type: 'RESET' };
