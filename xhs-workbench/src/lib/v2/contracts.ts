import type { AiUsageSummary } from '@/lib/ai-client';
import type { ContentShape, CreativeCardRenderer, EvidenceSnippet, GeneratedInnerPage, ReferenceDrivenDraft } from '@/types/reference-workflow';
import type { ExamScope, ProductId } from '@/types/data';
import type { BatchEditorialTask } from './batch-editorial-plan';
import type { CrossExamGenericRisk, DelfSpecificity, SubpointRisk, TopicDemandType, TopicGranularity, TopicValueType } from './topic-value';

export const V2_SCHEMA_VERSION = '2.0.0';
export const REQUIRED_INNER_PAGE_COUNT = 5;

export type PrimaryGoal = 'search' | 'save' | 'click' | 'conversion';
export type TopicLane = 'broad_pain' | 'result_need' | 'narrow_knowledge' | 'product_value';

/** 共识选题 3 方向（共识第 5 节，阶段 B）。legacy 路径不产 direction。 */
export type ConsensusTopicDirection = '大痛点型' | '省时路径型' | '具体方法型';

/** 商品承接依据：命中 editorial map 的能力编号 + 支持模块（阶段 B 新字段）。 */
export interface TopicBridgeBasis {
  capabilityId: string;
  modules: string[];
}

/**
 * AI1 选题结束后由程序锁定的生产工单。AI2/AI3只能读取，不能改写。
 * 它把模板的视觉容量翻译成可机器校验的数据合同，避免标题、正文、封面各说各话。
 */
export interface LockedProductionBrief {
  version: '1';
  templateId: CreativeCardRenderer;
  contentObject: ContentShape;
  coreTopic: string;
  corePromise: string;
  sectionRange: [number, number];
  itemRange: [number, number];
  totalItemRange: [number, number];
  primaryLanguage: 'french' | 'mixed';
  secondaryRole: 'chinese_translation_or_explanation';
  allowedTitleClaims: string[];
  forbiddenTitleClaims: string[];
  briefHash: string;
}
export type ContentBlockKind = 'group' | 'pair' | 'paragraph' | 'quote' | 'example' | 'step' | 'benefit';
export type CompilerFamily = 'directory' | 'pairs' | 'narrative' | 'document' | 'offer';
export type PipelineStage = 'planned' | 'topic_ready' | 'topic_selected' | 'content_ready' | 'audited' | 'title_ready' | 'compiled' | 'rendering';

export interface DensityTier {
  id: 'compact' | 'normal' | 'dense';
  sectionRange: [number, number];
  itemRange: [number, number];
  primaryVisualLength: [number, number];
  secondaryVisualLength: [number, number];
}

export interface TemplateCapability {
  renderer: CreativeCardRenderer;
  family: ContentShape;
  compiler: CompilerFamily;
  renderMode: 'code' | 'hybrid' | 'image_to_image';
  allowedGoals: PrimaryGoal[];
  acceptedBlockKinds: ContentBlockKind[];
  allowedTitleMechanisms: string[];
  densityTiers: DensityTier[];
  languagePolicy: 'mixed' | 'primary_french';
}

export interface TopicOption {
  id: string;
  productId: ProductId;
  /** 商品2的TEF/TCF内容边界；商品1/3可省略。 */
  examScope?: import('@/types/data').ExamScope;
  templateId: CreativeCardRenderer;
  primaryGoal: PrimaryGoal;
  topicLane: TopicLane;
  topic: string;
  /** V2 content_note topic provenance. Legacy jobs may omit it. */
  topicSource?: 'market' | 'long_tail';
  marketReference?: { sourceTitle: string; sourceSummary?: string; sourceNoteUrl?: string; sourceCoverUrl?: string; noteId?: string; date?: string; likes?: number; favorites?: number; comments?: number; shares?: number; sourceExam?: string };
  imitationMode?: 'DIRECT_NEIGHBOR' | 'STRUCTURE_ONLY';
  clickReasonId?: string;
  topicCore?: string;
  /** Stable provenance from the offline DELF Reference Topic Seed artifact. */
  referenceId?: number;
  referenceTopicCoreSeed?: string;
  delfWritingTopicCoreSeed?: string;
  /** Market wording provenance for the three content_note products; internal metadata only. */
  primaryReferenceTitle?: string;
  /** Market wording debug provenance; the model's extracted reference-title skeleton. */
  referenceTitleSkeleton?: string;
  skeletonInstantiation?: string;
  referenceCandidates?: Array<{ title: string; titleSkeleton?: string; compatibility: 'ACCEPT' | 'REJECT'; incompatibleReason?: string }>;
  referenceIndexWithinReason?: number;
  /** Market wording audit; raw and postprocessed values should match. */
  rawModelFinalTopic?: string;
  postprocessedFinalTopic?: string;
  historicalTopicCoresForReasonCount?: number;
  audienceState: string;
  scene: string;
  painOrDesire: string;
  promise: string;
  contentAngle: string;
  plannedBlockKind?: ContentBlockKind;
  productBridge: string;
  seo: { primary: string; related: string[] };
  knowledgeMode: 'product_grounded' | 'exam_grounded' | 'educational_original' | 'mixed';
  factTerms: string[];
  seedSignals: string[];
  noveltyFingerprint: string;
  // —— 共识选题可选扩展（普通内容三商品共用；showcase 路径可不填）——
  direction?: ConsensusTopicDirection;
  /** 准备展开的 3-5 条内容；<3 只警告（§8.1-6）。 */
  expandContents?: string[];
  bridgeBasis?: TopicBridgeBasis;
  coverFitReason?: string;
  clickReason?: string;
  /** 内容提示，非合格硬条件；缺失只警告（§3.3）。 */
  speechAction?: string;
  openingEmotion?: string;
  duplicateWithHistory?: boolean;
  /** 批量规划上游分配的内容母题；仅普通 DELF 批量使用。 */
  batchTopicSlotId?: string;
  /** 总编辑在批次开始时一次性分配的任务单；后续 AI 只能执行。 */
  batchEditorialTask?: BatchEditorialTask;
  /** 程序锁定的跨 AI 生产工单；运行时进入AI2前必须存在。 */
  productionBrief?: LockedProductionBrief;
  /** 小红书消费价值层；不替代 direction，也不改变后续节点契约。 */
  valueType?: TopicValueType;
  specificAsset?: string;
  userGain?: string;
  saveReason?: string;
  delfSpecificity?: DelfSpecificity;
  threeSecondValueCheck?: boolean;
  crossExamGenericRisk?: CrossExamGenericRisk;
  demandType?: TopicDemandType;
  topicGranularity?: TopicGranularity;
  /** 批量选题发牌的追溯信息；不改变公开Topic四字段，也不作为实际质量已达标的证明。 */
  topicAssignment?: {
    slot: number;
    plannedGranularity: TopicGranularity;
    scopeIntent: 'mega_asset' | 'broad_problem' | 'broad_asset';
    coverageDomain: string;
    domainFamily: string;
    coreProblem: string;
    minimumCoverage: string;
    userAngle: string;
    deliveryAngle: string;
    rotationIndex: number;
    domainId?: string;
    /** 内部用户需求卡，只约束选题是否是用户真实会遇到的问题；不作为公开标题模板。 */
    demandAudienceState?: string;
    demandScene?: string;
    demandUrgentNeed?: string;
    /** 完整需求卡：用于审计 Topic 是否来自真实处境，而非课程模块换说法。 */
    demandCard?: {
      id: string;
      situation: string;
      trigger: string;
      frustration: string;
      desiredOutcome: string;
      lossIfIgnored: string;
      searchLanguage: string[];
      examScope?: ExamScope;
      motherDomain: string;
      demandArchetype: string;
    };
    scopeValidation?: 'passed' | 'failed';
    actualGranularity?: 'large' | 'medium' | 'unverified';
    scopeReviewSource?: 'human';
  };
  subpointRisk?: SubpointRisk;
  existingBelief?: string;
  counterBelief?: string;
  publicTopicNaturalness?: boolean;
  motherTopicRationale?: string;
  proposedSubtopics?: string[];
  motherTopicScore?: number;
  xhsMotherTopicFit?: 'strong' | 'acceptable' | 'course_like' | 'micro';
  xhsEditorialFit?: 'strong' | 'acceptable' | 'course_like' | 'weak';
  topicScope?: 'mother' | 'subtopic' | 'micro';
  expandContentPlans?: Array<{
    title: string; contentGoal: string; assetType: string; concreteDeliverable: string;
    mustContain: string[]; exampleRequirement: string; languageMaterialRequirement: string;
    cardStructure: string; genericAdviceRisk: 'low' | 'medium' | 'high';
  }>;
}

export interface ContentItem {
  primary: string;
  secondary?: string;
  note?: string;
}

export interface ContentBlock {
  id: string;
  kind: ContentBlockKind;
  heading?: string;
  items: ContentItem[];
  priority: 1 | 2 | 3;
  sourceMode: 'product_fact' | 'exam_fact' | 'general_advice' | 'ai_example';
  sourceIds: string[];
}

/** 带货承接四拍计划（阶段 C，设计 §5：内容 AI 的响应字段，商品1普通模式可选）。 */
export interface BridgePlan {
  freeSolves: string;
  userStillNeeds: string;
  whyProduct: string;
  naturalCta: string;
}

/** STANDARD KNOWLEDGE 的页面规划真源；旧 assetType 等字段仅保留兼容。 */
export interface UserVisiblePagePlan {
  pageId: string;
  pageGoal: string;
  userGets: string;
  pageContentPlan: string;
  /** 这一页在整篇核心任务中的职责；可选以兼容历史页面计划。 */
  pageRole?: string;
  contributionToCore?: string;
}

export interface ContentPackage {
  /** 单篇笔记唯一主线；所有页面和下游商业产物都围绕它消费。 */
  wholeNoteCore?: string;
  /** Page-scoped factual boundaries actually available to the Inner call. */
  innerEvidence?: EvidenceSnippet[];
  autoFactBrief?: { factBrief: string; userTask?: string; supportedCounts: Array<{label:string;count:number;sourcePages:number[];scope:string}>; scopeNotes: string[]; sourceInnerHash: string } & Partial<import('./note-fact-boundary').NoteFactBoundary>;
  coverSelection?: { titleId: string; coverTitleId?: string; sourceInnerHash: string; confirmedTemplateId: string | null };
  coverCopy?: { status: 'complete'; titleId: string; coverTitleId?: string; sourceInnerHash: string; coverTitle: string; coverSubtitle: string; requestId: string };
  conversionMode?: 'image_product_page' | 'comment_link' | 'product_card' | 'product_detail';
  transitionText?: string;
  finalTagSources?: Array<{ tag: string; source: string; sourceQuery: string; rank: number; views: number; tag_id: string }>;
  manualInnerReview?: { status: 'locked' | 'needs_review' | 'dropped'; innerHash: string; reviewedAt: string; droppedAt?: string };
  coverSourceInnerHash?: string;
  topicSnapshotHash: string;
  productionBriefHash?: string;
  coverBlocks: ContentBlock[];
  coverCandidates?: Array<{
    coverTitle?: string; coverSubtitle?: string;
    templateId: string; fitReason: string; coverBlocks: ContentBlock[];
    renderMode: TemplateCapability['renderMode']; rejectionReason?: string;
  }>;
  selectedCoverTemplateId?: string;
  pagePlan?: UserVisiblePagePlan[];
  innerPages: GeneratedInnerPage[];
  captionParts: { opening: string; value: string[]; productBridge: string; cta: string };
  tagMaterial: string[];
  factualClaims: Array<{ text: string; type: 'product' | 'exam' | 'general_advice' | 'example'; sourceIds: string[] }>;
  frenchSegments: Array<{ path: string; text: string; translation?: string }>;
  /** Caption 必须绑定到它实际读取的最终可见内页快照。 */
  captionContentSnapshotHash?: string;
  /** 最终教学审校的可追溯证据；只有 PASS 才能进入商用导出。 */
  finalTeachingQa?: {
    sourceInnerHash?: string;
    requestId?: string;
    inputSnapshotHash: string;
    approved: boolean;
    issues: string[];
    corrections: Array<{ path?: string; text?: string; translation?: string; reason?: string }>;
    appliedPatches: Array<{ path: string; text?: string; translation?: string; reason?: string }>;
    rejectedPatches: Array<{ path?: string; text?: string; translation?: string; reason?: string }>;
    /** 仅限明确拼写、语法或法语残句；非空时阻断 READY。 */
    blockingIssues?: string[];
    blockingPaths?: string[];
    /** 自然度、语域、教学偏好等非确定性意见；永不阻断 READY。 */
    warnings?: string[];
    unresolvedBlockingIssues: string[];
    status: 'PASS' | 'FAIL';
  };
  /** 阶段 C 共识内容任务单增补（设计 §5）：带货承接四拍计划；只有商品1普通模式、且 AI 四拍完整时才填。legacy 永不带。 */
  bridgePlan?: BridgePlan;
}

export interface TitlePair {
  referenceApprovedIds?: string[];
  referenceApprovedId?: string;
  /** Computed locally, never trusted from model output. */
  textTitleValid?: boolean;
  coverValid?: boolean;
  bundleValid?: boolean;
  id?: string;
  slotId?: 'primary' | 'secondary' | 'emotional' | 'alternate';
  requestedClickMode?: TitleClickMode | 'UNKNOWN';
  sourceDirection?: 'material' | 'pain' | 'emotion' | 'counter' | 'fast_path' | 'voice' | string;
  generatorClickMode?: string;
  detectedClickMode?: TitleClickMode | 'UNKNOWN';
  finalClickMode?: TitleClickMode | 'UNKNOWN';
  textTitle: string;
  coverKicker?: string;
  coverTitle: string;
  coverSubtitle?: string;
  mechanism: string;
  userRelation: string;
  seoKeyword?: string;
  noveltyFingerprint: string;
  clickMode?: TitleClickMode;
  clickReason?: string;
  /** 同一组三件套共享的唯一点击主轴；不直接展示给用户。 */
  bundleIntent?: string;
  /** 必须同时出现在 textTitle 与 coverTitle 中的非泛化主题锚点。 */
  bundleAnchor?: string;
  /** coverSubtitle 用来承接 bundleIntent 的短语锚点；不直接展示。 */
  bundleIntentKeywords?: string[];
  topicScope?: 'mother' | 'subtopic' | 'micro';
  pairSemanticMatch?: 'strong' | 'acceptable' | 'weak';
  promisePayloadFit?: 'aligned' | 'stretched' | 'detached';
  templateFit?: TitleTemplateFit;
  warnings?: string[];
  hardFailures?: string[];
  softWarnings?: string[];
  modeScoreNotes?: string[];
}

export type TitleClickMode =
  | 'COLLECTION_ASSET'
  | 'EMOTIONAL_CURIOSITY'
  | 'PAIN_QUESTION'
  | 'INSIGHT_CONTRARIAN'
  | 'COMPARISON_GAP'
  | 'URGENT_EXAM'
  | 'SELF_TEST_AVOIDANCE'
  | 'VOICE_EXPERIENCE';

export interface TitleTemplateFit {
  fits: boolean;
  kickerFits?: boolean;
  titleFits?: boolean;
  subtitleFits?: boolean;
  defaultRenderFits?: boolean;
  fitReasons?: string[];
  visibleChars: number;
  maxVisibleChars: number;
  estimatedLines: number;
  maxLines: number;
}

export interface TitleStageTrace {
  primaryClickMode: TitleClickMode;
  secondaryClickMode: TitleClickMode;
  directions: string[];
  generatorRaw?: unknown;
  normalizedBundles: TitlePair[];
  selectorInputs?: Array<{ id?: string; clickMode?: TitleClickMode; score: number; originalPosition: number }>;
  recommendedReason?: string;
  selectedOriginalPosition?: number;
}

export interface TitlePackage {
  nativeSkillReport?: string;
  /** A narrow, non-rewriting semantic gate applied after the native title Skill. */
  semanticBoundaryReview?: {
    version: string;
    reviewedCandidateCount: number;
    keptCandidateIds: string[];
    rejectedCandidates: Array<{ id:string; textTitle:string; reason:string; evidence?:string }>;
    requestId: string;
  };
  sourceInnerHash?: string;
  mode?: 'text_only';
  /** Market content_note locks the cover headline to the selected Market finalTopic. */
  fixedCoverTitle?: string;
  humanSelectedTextTitleId?: string | null;
  humanSelectedCoverTitleId?: string | null;
  humanSelectableTextTitles?: Array<{
    id:string;
    textTitle:string;
    clickReason:string;
    referenceApprovedId:string;
    method?:string;
    hookOrSearchTerm?:string;
    score?:number;
    risk?:string;
    riskReason?:string;
  }>;
  humanSelectableCandidates?: TitlePair[];
  jobReferenceApprovedIds?: string[];
  /** undefined = legacy; null = awaits human; string = explicit human choice. */
  humanSelectedCandidateId?: string | null;
  contentSnapshotHash: string;
  productionBriefHash?: string;
  candidates: TitlePair[];
  selected: TitlePair;
  titleBundles?: TitlePair[];
  recommendedBundleId?: string;
  selectedBundleId?: string;
  titleStageTrace?: TitleStageTrace;
}

export interface ArtifactMeta {
  schema_version: string;
  prompt_version: string;
  input_hash: string;
  created_at: string;
  usage: AiUsageSummary;
  warnings: string[];
  request_id?: string;
  /** 机器可读标记：本工件产自程序保守兜底，需人工复核（§8.1-10）。legacy 永远不带。 */
  needsManualReview?: boolean;
}

export interface VersionedArtifact<T> extends ArtifactMeta {
  data: T;
}

export interface PipelineArtifacts {
  topics?: VersionedArtifact<TopicOption[]>;
  selectedTopic?: VersionedArtifact<TopicOption>;
  content?: VersionedArtifact<ContentPackage>;
  titles?: VersionedArtifact<TitlePackage>;
  compiledDraft?: VersionedArtifact<ReferenceDrivenDraft>;
}

export interface StageFailure {
  stage: PipelineStage | 'topic' | 'content' | 'audit' | 'title' | 'compile';
  message: string;
  paths?: string[];
  retryable: boolean;
}

export interface PipelineResult {
  pipelineVersion: 'v2';
  currentStage: PipelineStage;
  artifacts: PipelineArtifacts;
  draft: ReferenceDrivenDraft;
  usage: AiUsageSummary;
  warnings: string[];
}

export function countVisibleUnits(input: unknown): number {
  const normalized = (typeof input === 'string' ? input : '').normalize('NFC').replace(/\s+/g, '');
  return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(normalized)).length;
}

export function stableHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
