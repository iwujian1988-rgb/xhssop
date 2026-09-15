import type { ExamScope, ProductId } from './data';

export type CreativeCardRenderer =
  | 'dazibao_html'
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
  | 'ielts_speaking_toc'
  | 'criminal_law_formula'
  | 'english_grammar_grid'
  | 'french_gender_vocab'
  | 'mao_article_notes'
  | 'english_grammar_notebook'
  | 'french_oral_question_bank'
  | 'french_a1_practice_sheet'
  | 'sat_vocab_dictionary'
  | 'ielts_task1_four_part'
  | 'showcase_screenshot'
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
  exam_scope?: ExamScope;
  topicSource?: 'market' | 'long_tail';
  marketReference?: { sourceTitle: string; sourceSummary?: string; sourceNoteUrl?: string; sourceCoverUrl?: string; noteId?: string; date?: string; likes?: number; favorites?: number; comments?: number; shares?: number; sourceExam?: string };
  imitationMode?: 'DIRECT_NEIGHBOR' | 'STRUCTURE_ONLY';
  /** DELF Market Click Reason Pool provenance; internal metadata only. */
  clickReasonId?: string;
  clickReason?: string;
  primaryReferenceTitle?: string;
  referenceId?: number;
  referenceTopicCoreSeed?: string;
  delfWritingTopicCoreSeed?: string;
  referenceTitleSkeleton?: string;
  skeletonInstantiation?: string;
  referenceCandidates?: Array<{ title: string; titleSkeleton?: string; compatibility: 'ACCEPT' | 'REJECT'; incompatibleReason?: string }>;
  referenceIndexWithinReason?: number;
  rawModelFinalTopic?: string;
  postprocessedFinalTopic?: string;
  historicalTopicCoresForReasonCount?: number;
  topicCore?: string;
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
  /** Optional page scope for short factual boundary cards used by Inner. */
  applicablePageIds?: string[];
}

export interface UnifiedContentBrief {
  product_id: ProductId;
  exam_scope?: ExamScope;
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
  /** Exact product/exam identity for renderers; prevents legacy DELF footer fallbacks. */
  productIdentity?: string;
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

export type SemanticLayoutType =
  | 'comparison'
  | 'checklist'
  | 'expression_bank'
  | 'mistake'
  | 'before_after'
  | 'timeline'
  | 'steps'
  | 'category_cards'
  | 'example_breakdown'
  | 'dense_reference'
  | 'knowledge_list';

export interface StructuredExpressionItem {
  fr: string;
  zh: string;
  note?: string;
}

export interface StructuredComparisonItem {
  text: string;
  note?: string;
}

export interface StructuredRenderPayload {
  semanticLayoutType: SemanticLayoutType;
  comparisonTitle?: string;
  left?: { label: string; items: StructuredComparisonItem[] };
  right?: { label: string; items: StructuredComparisonItem[] };
  comparisonDimensions?: string[];
  takeaway?: string;
  items?: Array<{ check: string; criterion: string; actionIfFail: string; example?: string }>;
  groups?: Array<{ label: string; context?: string; items: StructuredExpressionItem[] }>;
  cases?: Array<{ wrong: string; why: string; better: string; explanation?: string }>;
  before?: string;
  changes?: string[];
  after?: string;
  steps?: Array<{ step: string; title: string; action: string; example?: string }>;
  categories?: Array<{ title: string; items: string[] }>;
}

export interface GeneratedInnerPage {
  /** Public product label injected by the content stage; renderers must not infer it from copy. */
  product_identity?: string;
  readableLayout?: {sourcePageNo:number;part:number;total:number;bulletNumbers:number[];leadRuns:import('@/lib/inner-display-text').InlineRun[];bulletRuns:import('@/lib/inner-display-text').InlineRun[][]};
  pageId?: string;
  page_no: number;
  page_type: 'knowledge_list' | 'example_explain' | 'wrong_right' | 'steps' | 'product_bridge';
  page_title: string;
  lead: string;
  bullets: string[];
  source_ids: string[];
  style_variant?: InnerPageStyleVariant;
  /** Upstream semantic presentation contract; the renderer must not infer this from copy. */
  semanticLayoutType?: SemanticLayoutType;
  /** Concrete page composition produced upstream; renderer must not infer it from copy. */
  renderPayload?: StructuredRenderPayload;
  renderPayloadStatus?: 'VALID' | 'INSUFFICIENT_STRUCTURED_CONTENT';
  originalLayoutType?: SemanticLayoutType;
  finalLayoutType?: SemanticLayoutType;
  layoutChangeReason?: string;
  /** 商品介绍模式：这一页对应的真实资料卡截图。普通模式为空。 */
  showcase_asset_id?: string;
  showcase_asset_label?: string;
  showcase_asset_image?: string;
}

export interface DraftTitleBundle {
  id: string;
  clickMode: string;
  slotId?: string;
  requestedClickMode?: string;
  sourceDirection?: string;
  generatorClickMode?: string;
  detectedClickMode?: string;
  finalClickMode?: string;
  clickReason: string;
  bundleIntent?: string;
  bundleAnchor?: string;
  bundleIntentKeywords?: string[];
  textTitle: string;
  coverKicker?: string;
  coverTitle: string;
  coverSubtitle?: string;
  topicScope?: 'mother' | 'subtopic' | 'micro';
  pairSemanticMatch?: 'strong' | 'acceptable' | 'weak';
  promisePayloadFit?: 'aligned' | 'stretched' | 'detached';
  templateFit?: { fits: boolean; visibleChars: number; maxVisibleChars: number; estimatedLines: number; maxLines: number };
  warnings?: string[];
  hardFailures?: string[];
  softWarnings?: string[];
  modeScoreNotes?: string[];
}

export interface DraftTitlePackage {
  nativeSkillReport?: string;
  semanticBoundaryReview?: {
    version: string;
    reviewedCandidateCount: number;
    keptCandidateIds: string[];
    rejectedCandidates: Array<{ id:string; textTitle:string; reason:string; evidence?:string }>;
    requestId: string;
  };
  sourceInnerHash?: string;
  mode?: 'text_only';
  fixedCoverTitle?: string;
  humanSelectedTextTitleId?: string | null;
  /** Human-selected cover headline from the same immutable text-title pool. */
  humanSelectedCoverTitleId?: string | null;
  humanSelectableTextTitles?: Array<{id:string;textTitle:string;clickReason:string;referenceApprovedId:string}>;
  /** null means selectedBundleId is only a compatibility preview. */
  humanSelectedCandidateId?: string | null;
  schemaVersion?: string;
  titlePackageVersion?: string;
  contentSnapshotHash?: string;
  productionBriefHash?: string;
  titleBundles?: DraftTitleBundle[];
  /** Compatibility only. New drafts write titleBundles. */
  candidates?: DraftTitleBundle[];
  recommendedBundleId?: string;
  selectedBundleId?: string;
  source?: 'current_title_bundles' | 'legacy_candidates' | 'legacy_two_bundle_draft';
  migratedAt?: string;
}

export interface DraftCoverEditState {
  edited: boolean;
  blocks: unknown[];
  updatedAt?: string;
}

export interface ReferenceDrivenDraft {
  readablePagePlan?: import('@/lib/readable-inner-layout').ReadablePagePlan;
  coverSelection?: { titleId: string; coverTitleId?: string; sourceInnerHash: string; confirmedTemplateId: string | null; downstreamComplete?: boolean };
  coverCopy?: { status: 'complete'; titleId: string; coverTitleId?: string; sourceInnerHash: string; coverTitle: string; coverSubtitle: string; requestId: string };
  /** Review metadata only; canonical text stays in the content artifact. */
  manualInnerReview?: { status: 'locked' | 'needs_review' | 'dropped'; innerHash: string; reviewedAt: string; droppedAt?: string };
  downstreamStale?: boolean;
  /** The user explicitly kept downstream output after a manual Inner edit. */
  downstreamPreservedAfterInnerEdit?: boolean;
  /** Hash of the Inner that produced the still-visible downstream preview. */
  downstreamSourceInnerHash?: string;
  selectedCoverTemplateId?: string;
  /** Manual Market content_note cover choice; persisted in the existing draft JSON. */
  coverRoute?: 'MARKET_REFERENCE_COVER' | 'DAZIBAO';
  coverReferenceSource?: 'MARKET_REFERENCE' | 'DAZIBAO_POOL';
  selectedMarketReferenceId?: number;
  selectedDazibaoReferenceId?: string;
  id: string;
  content_mode?: 'standard' | 'product_showcase';
  brief: UnifiedContentBrief;
  title_candidates: TitleCandidate[];
  selected_title: string;
  cover_title_candidates?: CoverTitleCandidate[];
  /** 新版标题组真源；旧 title_candidates/cover_title_candidates 仅保留兼容。 */
  title_bundles?: DraftTitleBundle[];
  /** Canonical persisted title package used by preview, text export and image export. */
  titlePackage?: DraftTitlePackage;
  recommended_bundle_id?: string;
  selected_bundle_id?: string;
  title_stage_trace?: {
    primaryClickMode: string;
    secondaryClickMode: string;
    directions: string[];
    normalizedBundles: unknown[];
    selectorInputs?: unknown[];
    recommendedReason?: string;
    selectedOriginalPosition?: number;
  };
  cover_edit_meta?: { edited: boolean; editedBlocks: string[]; bundleId?: string; blocks?: unknown[] };
  /** Per-Bundle cover editor state. This survives refresh and does not leak between Bundles. */
  coverEditStates?: Record<string, DraftCoverEditState>;
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
  /** 仅 product_showcase 模式使用：记录本次随机选到的截图和展示角度。 */
  showcase?: {
    angle_id: string;
    angle_label: string;
    cover_asset_id: string;
    cover_asset_label: string;
    cover_image?: string;
    inner_asset_ids: string[];
    asset_labels: string[];
  };
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
  content_mode?: 'standard' | 'product_showcase';
  knowledge_mode?: 'product_grounded' | 'educational_original' | 'mixed';
  topic?: MigratedTopic;
  max_attempts?: number;
}
