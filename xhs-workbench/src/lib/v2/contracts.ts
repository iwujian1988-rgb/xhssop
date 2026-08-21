import type { AiUsageSummary } from '@/lib/ai-client';
import type { ContentShape, CreativeCardRenderer, GeneratedInnerPage, ReferenceDrivenDraft } from '@/types/reference-workflow';
import type { ProductId } from '@/types/data';

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
  templateId: CreativeCardRenderer;
  primaryGoal: PrimaryGoal;
  topicLane: TopicLane;
  topic: string;
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
  // —— 阶段 B 共识选题可选扩展（仅商品1普通模式会填；legacy 路径永远不填）——
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

export interface ContentPackage {
  topicSnapshotHash: string;
  coverBlocks: ContentBlock[];
  innerPages: GeneratedInnerPage[];
  captionParts: { opening: string; value: string[]; productBridge: string; cta: string };
  tagMaterial: string[];
  factualClaims: Array<{ text: string; type: 'product' | 'exam' | 'general_advice' | 'example'; sourceIds: string[] }>;
  frenchSegments: Array<{ path: string; text: string; translation?: string }>;
  /** 阶段 C 共识内容任务单增补（设计 §5）：带货承接四拍计划；只有商品1普通模式、且 AI 四拍完整时才填。legacy 永不带。 */
  bridgePlan?: BridgePlan;
}

export interface TitlePair {
  textTitle: string;
  coverTitle: string;
  coverSubtitle?: string;
  mechanism: string;
  userRelation: string;
  seoKeyword?: string;
  noveltyFingerprint: string;
}

export interface TitlePackage {
  contentSnapshotHash: string;
  candidates: TitlePair[];
  selected: TitlePair;
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

export function countVisibleUnits(input: string): number {
  const normalized = input.normalize('NFC').replace(/\s+/g, '');
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
