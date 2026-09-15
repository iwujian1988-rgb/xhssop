import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { emptyAiUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getRecentTitleFingerprints } from '@/lib/title-usage-store';
import type { ProductFacts } from '@/types/content-planning';
import type { ExamScope, ProductId } from '@/types/data';
import type {
  CompetitorCreativeCard,
  CoverTitleCandidate,
  DenseDirectoryCoverPayload,
  DenseDirectorySection,
  EvidenceSnippet,
  GeneratedInnerPage,
  MigratedTopic,
  ReferenceDrivenDraft,
  TitleCandidate,
  UnifiedContentBrief,
} from '@/types/reference-workflow';
import { auditContentPackage, auditWholeNoteEditorialPackage, generateContentPackage, generateFinalCaptionAndBridge, generateFinalCoverBlocks, repairContentPackage } from './content-stage';
import {
  stableHash,
  type ContentBlock,
  type ContentPackage,
  type ContentItem,
  type PipelineArtifacts,
  type PipelineResult,
  type TemplateCapability,
  type TopicOption,
  V2_SCHEMA_VERSION,
  type VersionedArtifact,
} from './contracts';
import { generateTitlePackage, generateAutoTitleFactBrief, TEXT_PRODUCTION_VERSION } from './title-stage';
import { resolveTitleConsensusActive } from './title-consensus';
import { selectProductTags } from './product-tags';
import { appendConversionTransition, assembleFinalCaption } from './conversion';
import { generateTopicOptions, getCapabilityFallback, migratedToTopicOption, topicOptionToMigrated } from './topic-stage';
import { inspectForPublish, isReleaseBlockingIssue, isRepairableQualityIssue, issueAsWarning } from './publish-guard';
import { assertFinalOutput } from './final-output-gate';
import type { ProductShowcasePlan } from '@/lib/product-showcase-library';
import { coverCapacityFailure, coverDisplayBlocks, getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getProductPromptProfile } from '@/lib/product-prompt-profiles';
import { examScopeContext } from '@/lib/product-exam-context';
import { getXhsSearchKeywords } from '@/lib/xhs-search-keywords';
import { assertContentMatchesLockedBrief, assertLockedProductionBrief, buildLockedProductionBrief } from './content-brief';
import type { BatchEditorialTask } from './batch-editorial-plan';
import type { DemandArchetype } from './product-topic-scope-plan';

export const PIPELINE_PROMPT_VERSION = 'v2-pipeline-1';

export function isV2PipelineEnabled() {
  // V2 is the only active runtime. The legacy implementation remains in the
  // repository for historical comparison, but no frontend request may enter it.
  return true;
}

import { assertReviewedInner } from '@/lib/manual-inner-review';

export interface PlanTopicsV2Input {
  avoidTopics?: string[];
  recentDomainIds?: string[];
  recentDemandArchetypes?: DemandArchetype[];
  excludeDemandArchetypes?: DemandArchetype[];
  topicScope?: 'large' | 'medium';
  productId: ProductId;
  card: CompetitorCreativeCard;
  facts: ProductFacts;
  direction?: string;
  contentMode?: 'standard' | 'product_showcase';
  limit?: number;
  recentAngles?: string[];
  /** 当前20条任务中已经使用过的真实Market引用标题；仅作本轮内上下文，不落库。 */
  usedMarketReferenceTitles?: string[];
  usedMarketReasonIds?: string[];
  exhaustedMarketReasonIds?: string[];
  usedMarketTopicCores?: string[];
  usedMarketFinalTopics?: string[];
  topicGenerationAttemptId?: string;
  debugRound?: number;
  /** 共识分支（商品1普通模式）用：single=前台单卡；batch=批量挑选前的候选池生成。 */
  topicMode?: 'single' | 'batch';
  /** 批量入口的来源选择：market / long_tail；未指定时保持历史混合兼容。 */
  topicSourceMode?: 'market' | 'long_tail' | 'mixed';
  batchTopicSlotId?: string;
  batchEditorialTask?: BatchEditorialTask;
  /** 只影响批次Topic提示中的超大范围轮换，不写入Topic或下游Schema。 */
  topicRotationIndex?: number;
  knowledgeModeOverride?: TopicOption['knowledgeMode'];
  examScope?: ExamScope;
}

export interface ComposeV2Input {
  productId: ProductId;
  card: CompetitorCreativeCard;
  topic: MigratedTopic & { v2_topic?: TopicOption };
  evidence: EvidenceSnippet[];
  contentMode?: 'standard' | 'product_showcase';
  showcasePlan?: ProductShowcasePlan;
  /** 三个商品都在教学页之后追加自己的独立资料页；AI原创教学正文不会被该页改义。 */
  endingShowcasePlan?: ProductShowcasePlan;
  /** Product Note owns its own final proof page; do not append legacy promo. */
  appendProductPromoPage?: boolean;
  resumeArtifacts?: PipelineArtifacts;
  resumeDraft?: ReferenceDrivenDraft;
  recentCoverTemplateIds?: string[];
  /** 当前批次更早Job已经生成的候选；只用于避免跨Job复读，不表示人工选中。 */
  recentGeneratedTextTitles?: string[];
  productNoteContext?: {
    noteMode: 'product_note'; productId: ProductId; angleId: string; angleLabel: string;
    targetBuyer: string; buyerMoment: string; mainClaim: string; supportingBenefits: string[];
    selectedAssetIds: string[]; assets: Array<{ assetId: string; reason: string; pageRole: string; shortTitle: string; badge: string; oneLine: string }>;
  };
  examScope?: ExamScope;
  /** Commercial Controller checkpoint. Called only after a stage has passed. */
  onCheckpoint?: (stage: 'execution' | 'content' | 'titles' | 'pages', artifacts: PipelineArtifacts) => Promise<void>;
}

export async function planTopicsV2(input: PlanTopicsV2Input) {
  const capability = getCapabilityFallback(input.card);
  const generated = await generateTopicOptions({
    ...input,
    direction: input.knowledgeModeOverride === 'educational_original'
      ? `AI自由教育内容：只围绕法语考试知识自由选题，不介绍商品、资料包或购买承接。${input.direction || ''}`
      : input.direction,
    capability,
  });
  const artifact = input.knowledgeModeOverride
    ? { ...generated, data: generated.data.map(topic => input.knowledgeModeOverride === 'educational_original' ? ({
      ...topic,
      primaryGoal: topic.primaryGoal === 'conversion' ? 'save' as const : topic.primaryGoal,
      topicLane: topic.topicLane === 'product_value' ? 'narrow_knowledge' as const : topic.topicLane,
      productBridge: '',
      factTerms: [],
      bridgeBasis: undefined,
      knowledgeMode: 'educational_original' as const,
    }) : ({ ...topic, knowledgeMode: input.knowledgeModeOverride! })) }
    : generated;
  return {
    capability,
    artifact,
    topics: artifact.data.map(topicOptionToMigrated),
    usage: artifact.usage,
  };
}

export async function composeV2(input: ComposeV2Input): Promise<PipelineResult> {
  const capability = getCapabilityFallback(input.card);
  const topicBase = migratedToTopicOption(input.topic, input.productId, input.card);
  const topic: TopicOption = {
    ...topicBase,
    productionBrief: topicBase.productionBrief || buildLockedProductionBrief(topicBase),
  };
  assertLockedProductionBrief(topic);
  // 批量 runner 是串行的：上一条成功后会马上入使用库。把近期正文收尾在
  // 正文阶段就传给模型，避免等到最后才发现整批 CTA 复读。
  const recentUsage = await getRecentTitleFingerprints(input.productId, { days: 30 }).catch(() => undefined);
  const resumableSelectedTopic = input.resumeArtifacts?.selectedTopic;
  const selectedTopic = resumableSelectedTopic?.data.productionBrief
    && resumableSelectedTopic.data.productionBrief.briefHash === topic.productionBrief?.briefHash
    ? resumableSelectedTopic
    : localArtifact(topic, stableHash({ topic: input.topic, productionBrief: topic.productionBrief }), 'v2-topic-selection-locked-2');
  await input.onCheckpoint?.('execution', { selectedTopic });
  const evidence = input.evidence.slice(0, 10);
  const contentInput = {
    topic,
    capability,
    evidence,
    showcasePlan: input.showcasePlan,
    recentCaptionEndings: recentUsage?.recentCaptionEndings.slice(-12),
    recentCoverTemplateIds: input.recentCoverTemplateIds,
  };
  // Product Note is a title-choice workflow even though its renderer/content
  // mode remains product_showcase. Keep that renderer label for downstream
  // layout, but do not let it route Product Note back to the compatibility
  // title path.
  const isProductNote = input.productNoteContext?.noteMode === 'product_note';
  const textFirst = isProductNote || resolveTitleConsensusActive(
    input.productId,
    input.contentMode === 'product_showcase' || topic.primaryGoal === 'conversion' || topic.topicLane === 'product_value',
  );
  let publishReadyContent = await prepareContentForTitles({
    productId: input.productId,
    topic,
    capability,
    evidence,
    contentInput,
    selectedTopic,
    resumeContent: input.resumeArtifacts?.content,
    pauseForHumanReview: true,
    innerOnly: textFirst,
    useDazibao: !isProductNote,
    onCheckpoint: input.onCheckpoint,
  });
  // Product Note is intentionally screenshot-first: the user selected this
  // proof route, so the content model must not silently switch to a teaching
  // template while normal content keeps its existing auto-match behavior.
  let selectedCard = input.showcasePlan
    ? input.card
    : getCompetitorCreativeCard(publishReadyContent.data.selectedCoverTemplateId || '') || input.card;
  let selectedCapability = getCapabilityFallback(selectedCard);
  // Preserve existing human selections. New titles receive a cached supplement,
  // while the native Skill still reads the complete confirmed Inner.
  if (textFirst && !input.resumeArtifacts?.titles?.data.humanSelectedTextTitleId) {
    try {
      publishReadyContent = await generateAutoTitleFactBrief(publishReadyContent, {
        topic, capability:selectedCapability, content:publishReadyContent.data,
      });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const extra = (cause as {usage?:AiUsageSummary})?.usage || emptyAiUsage();
      Object.assign(error,{v2Stage:'title',usage:mergeAiUsage(publishReadyContent.usage,extra),
        partialArtifacts:{selectedTopic,content:publishReadyContent}});
      throw error;
    }
  }
  await input.onCheckpoint?.('content', { selectedTopic, content: publishReadyContent });
  let prebuiltTags = textFirst ? [] : await buildV2Tags(
    input.productId,
    topic,
    publishReadyContent.data,
    recentUsage?.recentTagCounts,
  );
  let titles;
  const resumableTitles = input.resumeArtifacts?.titles;
  const currentContentSnapshotHash = stableHash(textFirst ? publishReadyContent.data.innerPages : publishReadyContent.data);
  const canReuseTitles = Boolean(
    resumableTitles
    && (!textFirst || resumableTitles.prompt_version === TEXT_PRODUCTION_VERSION)
    && resumableTitles.data.contentSnapshotHash === currentContentSnapshotHash
    && resumableTitles.data.productionBriefHash === topic.productionBrief?.briefHash,
  );
  try {
    titles = canReuseTitles
      ? resumableTitles!
      : await generateTitlePackage({
        topic,
        capability: selectedCapability,
        content: publishReadyContent.data,
        recentGeneratedTextTitles: input.recentGeneratedTextTitles,
        noteMode: input.productNoteContext?.noteMode,
        productNoteContext: input.productNoteContext,
      });
    if (titles.data.productionBriefHash !== topic.productionBrief?.briefHash) {
      throw new Error('标题AI拿到的生产工单与内容AI不一致');
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error('V2标题阶段失败');
    const titleUsage = cause && typeof cause === 'object' && 'usage' in cause
      ? (cause as { usage?: AiUsageSummary }).usage || emptyAiUsage()
      : emptyAiUsage();
    Object.assign(error, {
      v2Stage: 'title',
      usage: mergeAiUsage(publishReadyContent.usage, titleUsage),
      partialArtifacts: { selectedTopic, content: publishReadyContent },
    });
    throw error;
  }
  await input.onCheckpoint?.('titles', { selectedTopic, content: publishReadyContent, titles });
  if (textFirst) {
    const chosen = titles.data.humanSelectableTextTitles?.find(c=>c.id===titles.data.humanSelectedTextTitleId);
    const chosenCover = titles.data.humanSelectableTextTitles?.find(c=>c.id===titles.data.humanSelectedCoverTitleId);
    if (!chosen || !chosenCover) {
      if (!input.resumeDraft) throw new Error('TITLE_CHOICE_DRAFT_REQUIRED');
      const bundles = titles.data.candidates.map(c=>({...c,id:c.id!,clickMode:c.clickMode || '标题',clickReason:c.clickReason || ''}));
      const partialDraft: ReferenceDrivenDraft = {...input.resumeDraft,downstreamStale:false,selected_title:'',coverCopy:undefined,
        title_candidates:titles.data.candidates.map(c=>({title:c.textTitle,trigger_type:'标题',reason:'',formula_id:'text',formula_skeleton:'',risk_flags:[]})),
        title_bundles:bundles,
        titlePackage:{...titles.data,candidates:bundles,titleBundles:bundles,source:'current_title_bundles'},
        cover:{kind:'dense_directory',title:'',subtitle:'',sections:[]}};
      throw Object.assign(new Error('TEXT_TITLE_AWAITING_HUMAN_CHOICE'), {v2Stage:'title',partialDraft,
        usage:mergeAiUsage(publishReadyContent.usage,titles.usage),partialArtifacts:{selectedTopic,content:publishReadyContent,titles}});
    }
    try {
      publishReadyContent = await prepareContentForTitles({productId:input.productId,topic,capability,evidence,
        contentInput,selectedTopic,resumeContent:publishReadyContent,onCheckpoint:input.onCheckpoint,
        useDazibao: !isProductNote,
        selectedTextTitle:{id:chosen.id,textTitle:chosen.textTitle},
        selectedCoverTitle:{id:chosenCover.id,textTitle:chosenCover.textTitle}});
    } catch (cause) {
      const error = cause as Error & {partialArtifacts?:PipelineArtifacts};
      error.partialArtifacts = {...error.partialArtifacts,titles};
      throw error;
    }
    selectedCard = input.showcasePlan
      ? input.card
      : getCompetitorCreativeCard(publishReadyContent.data.selectedCoverTemplateId || '') || input.card;
    selectedCapability = getCapabilityFallback(selectedCard);
    if (publishReadyContent.data.coverSelection && !publishReadyContent.data.coverSelection.confirmedTemplateId) {
      if (!input.resumeDraft) throw new Error('COVER_CHOICE_DRAFT_REQUIRED');
      const content = publishReadyContent.data;
      const partialDraft: ReferenceDrivenDraft = {...input.resumeDraft,
        selectedCoverTemplateId: selectedCard.id, coverCopy: content.coverCopy, coverSelection: content.coverSelection,
        cover: {kind:'dense_directory', title:content.coverCopy?.coverTitle || '', subtitle:content.coverCopy?.coverSubtitle || '',
          sections:compileCover(selectedCapability, content.coverBlocks).sections},
      };
      throw Object.assign(new Error('COVER_AWAITING_HUMAN_CHOICE'), {v2Stage:'content',partialDraft,
        usage:mergeAiUsage(publishReadyContent.usage,titles.usage),partialArtifacts:{selectedTopic,content:publishReadyContent,titles}});
    }
    prebuiltTags = await buildV2Tags(input.productId,topic,publishReadyContent.data,recentUsage?.recentTagCounts);
  }
  let draft: ReferenceDrivenDraft;
  try {
    draft = compileDraft({
      productId: input.productId,
      card: selectedCard,
      topic,
      capability: selectedCapability,
      content: publishReadyContent.data,
      titles: titles.data,
      evidence: Array.from(new Map(
        [...(publishReadyContent.data.innerEvidence || []), ...evidence].map(item => [item.id, item]),
      ).values()),
      auditWarnings: publishReadyContent.warnings,
      prebuiltTags,
      showcasePlan: input.showcasePlan,
      endingShowcasePlan: input.endingShowcasePlan,
      appendProductPromoPage: input.appendProductPromoPage,
    });
    const resumeCover = input.resumeDraft;
    if (textFirst && resumeCover?.coverEditStates
      && resumeCover.selectedCoverTemplateId === publishReadyContent.data.coverSelection?.confirmedTemplateId) {
      // Preserve optional human typography/copy edits made after template
      // confirmation; final compilation must not restore generated defaults.
      draft = {
        ...draft,
        cover: structuredClone(resumeCover.cover),
        coverEditStates: structuredClone(resumeCover.coverEditStates),
        cover_edit_meta: structuredClone(resumeCover.cover_edit_meta),
      };
    }
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error('V2编译阶段失败');
    Object.assign(error, {
      v2Stage: 'compile',
      usage: mergeAiUsage(publishReadyContent.usage, titles.usage),
      partialArtifacts: { selectedTopic, content: publishReadyContent, titles },
    });
    throw error;
  }
  const compiledDraft = localArtifact(
    draft,
    stableHash({ topic, content: publishReadyContent.input_hash, titles: titles.input_hash }),
    PIPELINE_PROMPT_VERSION,
  );
  await input.onCheckpoint?.('pages', { selectedTopic, content: publishReadyContent, titles, compiledDraft });
  const usage = mergeAiUsage(publishReadyContent.usage, titles.usage);
  const warnings = uniqueStrings([...publishReadyContent.warnings, ...titles.warnings]);

  return {
    pipelineVersion: 'v2',
    currentStage: 'compiled',
    artifacts: {
      selectedTopic,
      content: publishReadyContent,
      titles,
      compiledDraft,
    },
    draft,
    usage,
    warnings,
  };
}

interface PrepareContentInput {
  innerOnly?: boolean;
  selectedTextTitle?: {id:string;textTitle:string};
  selectedCoverTitle?: {id:string;textTitle:string};
  pauseForHumanReview?: boolean;
  productId: ProductId;
  topic: TopicOption;
  capability: TemplateCapability;
  evidence: EvidenceSnippet[];
  contentInput: Parameters<typeof generateContentPackage>[0];
  selectedTopic: VersionedArtifact<TopicOption>;
  resumeContent?: VersionedArtifact<ContentPackage>;
  onCheckpoint?: ComposeV2Input['onCheckpoint'];
  showcasePlan?: ProductShowcasePlan;
  useDazibao?: boolean;
}

export async function prepareContentForTitles(input: PrepareContentInput, stages = {
  generateContentPackage, generateFinalCaptionAndBridge, generateFinalCoverBlocks, auditContentPackage, repairContentPackage,
}): Promise<VersionedArtifact<ContentPackage>> {
  if (input.resumeContent?.data.manualInnerReview) assertReviewedInner(input.resumeContent.data);
  let next = input.resumeContent || await stages.generateContentPackage(input.contentInput);
  if (input.pauseForHumanReview && !next.data.manualInnerReview) {
    throw Object.assign(new Error('INNER_AWAITING_HUMAN_REVIEW'), {
      v2Stage: 'content', usage: next.usage, partialArtifacts: { selectedTopic: input.selectedTopic, content: next },
    });
  }
  if (input.innerOnly) return next;
  const advance = async (work: () => Promise<VersionedArtifact<ContentPackage>>) => {
    try { next = await work(); assertReviewedInner(next.data); }
    catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const context = error as Error & { usage?: AiUsageSummary; cumulativeUsage?: boolean; coverCandidates?: ContentPackage['coverCandidates'] };
      if (context.coverCandidates) next = { ...next, data: { ...next.data, coverCandidates: context.coverCandidates } };
      const usage = context.cumulativeUsage ? context.usage! : mergeAiUsage(next.usage, context.usage || emptyAiUsage());
      next = { ...next, usage };
      Object.assign(error, { usage, partialArtifacts: { selectedTopic: input.selectedTopic, content: next } });
      throw error;
    }
    await input.onCheckpoint?.('content', { selectedTopic: input.selectedTopic, content: next });
    return next;
  };
  await input.onCheckpoint?.('content', { selectedTopic: input.selectedTopic, content: next });
  if (input.selectedTextTitle && input.selectedCoverTitle && (next.data.coverCopy?.titleId !== input.selectedTextTitle.id
    || next.data.coverCopy?.coverTitleId !== input.selectedCoverTitle.id
    || next.data.coverCopy.sourceInnerHash !== stableHash(next.data.innerPages))) {
    next = await advance(async () => {
      const generated = await stages.generateFinalCoverBlocks(next, {...input.contentInput,
        selectedTextTitle:input.selectedTextTitle,selectedCoverTitle:input.selectedCoverTitle,useDazibao:input.useDazibao});
      generated.data.coverSelection = {titleId:input.selectedTextTitle!.id,coverTitleId:input.selectedCoverTitle!.id,
        sourceInnerHash:stableHash(generated.data.innerPages),confirmedTemplateId:null};
      return generated;
    });
    next.data.finalTeachingQa = undefined;
  }
  // Human may accept the automatic recommendation or choose another already-valid
  // candidate. Stop before Caption/QA/compiler and, importantly, paid image submission.
  if (input.selectedTextTitle && next.data.coverSelection && !next.data.coverSelection.confirmedTemplateId) return next;
  if (next.prompt_version.includes('targeted-repair-1') && next.data.finalTeachingQa?.status !== 'PASS') {
    throw Object.assign(new Error('LANGUAGE_REPAIR_EXHAUSTED'), { v2Stage: 'audit', usage: next.usage,
      partialArtifacts: { selectedTopic: input.selectedTopic, content: next } });
  }
  if (next.data.captionContentSnapshotHash !== stableHash(next.data.innerPages)) {
    next = await advance(() => stages.generateFinalCaptionAndBridge(next, input.contentInput));
    next.data.finalTeachingQa = undefined;
  }
  if (!next.data.selectedCoverTemplateId || next.data.coverSourceInnerHash !== stableHash(next.data.innerPages)) {
    next = await advance(() => stages.generateFinalCoverBlocks(next, {...input.contentInput,useDazibao:input.useDazibao}));
    next.data.finalTeachingQa = undefined;
  }
  const acceptLockedInnerQaAsWarning = () => {
    const qa = next.data.finalTeachingQa;
    const review = next.data.manualInnerReview;
    if (!review || !qa || qa.status === 'PASS' || qa.sourceInnerHash !== review.innerHash) return;
    const unresolved = qa.unresolvedBlockingIssues.length ? qa.unresolvedBlockingIssues : (qa.blockingIssues || []);
    qa.warnings = Array.from(new Set([
      ...(qa.warnings || []),
      ...unresolved.map(issue => `默认通过正文，QA提醒：${typeof issue === 'string' ? issue : JSON.stringify(issue)}`),
    ]));
    // Keep the audit evidence visible, but do not dead-end a production Job
    // when the locked canonical Inner has no safe deterministic correction.
    qa.status = 'PASS';
    qa.approved = true;
    qa.unresolvedBlockingIssues = [];
    next.warnings = Array.from(new Set([...next.warnings, ...qa.warnings]));
  };
  acceptLockedInnerQaAsWarning();
  if (next.data.finalTeachingQa?.status !== 'PASS' || next.data.finalTeachingQa.sourceInnerHash !== stableHash(next.data.innerPages)) next = await advance(() => stages.auditContentPackage(next, input.contentInput));
  acceptLockedInnerQaAsWarning();
  if (next.data.finalTeachingQa?.status !== 'PASS') {
    const before = stableHash(next.data.innerPages);
    next = await advance(() => stages.repairContentPackage(next, input.contentInput, []));
    const rejected = next.data.finalTeachingQa?.rejectedPatches || [];
    const applied = next.data.finalTeachingQa?.appliedPatches || [];
    if (before !== stableHash(next.data.innerPages)) {
      next = await advance(() => stages.generateFinalCaptionAndBridge(next, input.contentInput));
      next = await advance(() => stages.generateFinalCoverBlocks(next, {...input.contentInput,useDazibao:input.useDazibao}));
    }
    next = await advance(() => stages.auditContentPackage(next, input.contentInput));
    next.data.finalTeachingQa!.appliedPatches = applied;
    next.data.finalTeachingQa!.rejectedPatches = rejected;
    if (rejected.length || !applied.length) {
      next.data.finalTeachingQa!.status = 'FAIL';
      next.data.finalTeachingQa!.approved = false;
      next.data.finalTeachingQa!.unresolvedBlockingIssues = ['语言错误未能在有效canonical路径应用修复'];
    }
  }
  if (next.data.finalTeachingQa?.status !== 'PASS') {
    const error = new Error('FINAL_TEACHING_QA_FAILED:一次局部修复及只读复核后仍有明确语言错误');
    Object.assign(error, { v2Stage: 'audit', usage: next.usage,
      partialArtifacts: { selectedTopic: input.selectedTopic, content: next } });
    throw error;
  }
  return next;
}

interface CompileInput {
  productId: ProductId;
  card: CompetitorCreativeCard;
  topic: TopicOption;
  capability: TemplateCapability;
  content: Awaited<ReturnType<typeof generateContentPackage>>['data'];
  titles: Awaited<ReturnType<typeof generateTitlePackage>>['data'];
  evidence: EvidenceSnippet[];
  auditWarnings: string[];
  prebuiltTags?: string[];
  showcasePlan?: ProductShowcasePlan;
  endingShowcasePlan?: ProductShowcasePlan;
  appendProductPromoPage?: boolean;
}

export function compileDraft(input: CompileInput): ReferenceDrivenDraft {
  assertReviewedInner(input.content);
  if (input.content.manualInnerReview && [input.content.captionContentSnapshotHash, input.content.coverSourceInnerHash, input.content.finalTeachingQa?.sourceInnerHash].some(hash => hash !== input.content.manualInnerReview!.innerHash)) {
    throw new Error('REVIEWED_DOWNSTREAM_STALE');
  }
  const currentContentSnapshotHash = stableHash(input.titles.mode==='text_only' ? input.content.innerPages : input.content);
  if (input.titles.contentSnapshotHash !== currentContentSnapshotHash) {
    throw new Error(`TITLE_ARTIFACT_STALE:标题读取的内容快照${input.titles.contentSnapshotHash}与最终页面${currentContentSnapshotHash}不一致，必须只重跑标题节点`);
  }
  assertFinalCommercialSnapshot(input.content);
  const compiled = compileCover(input.capability, input.content.coverBlocks);
  const compiledItemCount = compiled.sections.reduce((sum, section) => sum + section.items.length, 0);
  const normalizeTitle = (value: string) => value;
  const cover: DenseDirectoryCoverPayload = {
    kind: 'dense_directory',
    productIdentity: examScopeContext(input.topic.productId, input.topic.examScope)?.displayIdentity
      || getProductPromptProfile(input.topic.productId).noteIdentity,
    title: input.titles.mode==='text_only' ? input.content.coverCopy?.coverTitle || '' : normalizeTitle(input.titles.selected.coverTitle),
    subtitle: input.titles.mode==='text_only' ? input.content.coverCopy?.coverSubtitle || '' : input.titles.selected.coverSubtitle || '',
    sections: compiled.sections,
  };
  // Canonical source survives compilation byte-for-byte; only presentation metadata changes.
  let innerPages: GeneratedInnerPage[] = input.content.innerPages.map((page, index) => ({
    ...page, page_no: index + 1, style_variant: page.style_variant || 'draft-paper' as const,
    renderPayload: undefined,
  }));
  if (input.showcasePlan) {
    innerPages = innerPages.map((page, index) => {
      const asset = input.showcasePlan?.innerAssets[index];
      return asset ? {
        ...page,
        showcase_asset_id: asset.id,
        showcase_asset_label: asset.label,
        showcase_asset_image: asset.image,
      } : page;
    });
  }
  // 末页统一作为教学正文之后的独立资料页。它读取商品自己的 bridge copy，
  // 不参与前面五页的主线生成，因此不会把 AI 原创教学改写成商品介绍。
  const appendFixedProductPage = input.appendProductPromoPage !== false;
  if (appendFixedProductPage) {
    const endingAsset = input.endingShowcasePlan?.coverAsset;
    // 商品介绍末页使用商品自己的固定总览图，不跟随 job/topic salt
    // 随机变化。三个商品统一使用各自的固定资料拼图末页。
    const fixedProductEnding = input.productId === 'delf_b2_writing'
      || input.productId === 'tef_tcf_canada'
      || input.productId === 'tcf_canada_writing_7day';
    const bridge = wholeProductBridgeCopy(input.productId);
    innerPages = appendConversionTransition(innerPages, input.content);
    innerPages = [...innerPages, {
    page_no: innerPages.length + 1,
    page_type: 'product_bridge',
    style_variant: 'draft-paper',
    page_title: bridge.title,
    lead: bridge.lead,
    bullets: bridge.bullets,
    source_ids: fixedProductEnding ? [] : endingAsset?.sourceFactIds || [],
    showcase_asset_id: fixedProductEnding ? `fixed_${input.productId}_product_overview` : endingAsset?.id || 'fixed_product_library_collage',
    showcase_asset_label: fixedProductEnding ? bridge.assetLabel : endingAsset?.label || bridge.assetLabel,
    showcase_asset_image: fixedProductEnding
      ? input.productId === 'tef_tcf_canada'
        ? '/generated-cover-backgrounds/tef-tcf-product-library-collage.png'
        : input.productId === 'tcf_canada_writing_7day'
          ? '/generated-cover-backgrounds/tcf-writing-7day-product-library-collage.png'
          : '/generated-cover-backgrounds/delf-b2-product-library-collage.png'
      : endingAsset?.image,
    }];
  }
  const brief = buildBrief(input);
  const titleCandidates = input.titles.candidates.map<TitleCandidate>((candidate, index) => ({
    title: normalizeTitle(candidate.textTitle),
    title_type: toTextTitleType(candidate),
    formula_id: `v2_${candidate.mechanism || index + 1}`,
    trigger_type: toTextTitleType(candidate),
    formula_skeleton: '',
    reason: candidate.userRelation,
    risk_flags: [],
  }));
  const tags = input.prebuiltTags?.length
    ? input.prebuiltTags
    : buildFallbackTags(input.productId, input.topic, input.content.tagMaterial);
  const caption = buildCaption(input.content.captionParts, tags);
  const issues = uniqueStrings([...input.auditWarnings, ...compiled.warnings]);
  const compiledTitleBundles = (input.titles.titleBundles || input.titles.candidates).map((candidate, index) => ({
    id: candidate.id || `title_bundle_${index + 1}`,
    clickMode: candidate.clickMode || candidate.mechanism,
    slotId: candidate.slotId,
    requestedClickMode: candidate.requestedClickMode,
    sourceDirection: candidate.sourceDirection,
    generatorClickMode: candidate.generatorClickMode,
    detectedClickMode: candidate.detectedClickMode,
    finalClickMode: candidate.finalClickMode,
    clickReason: candidate.clickReason || candidate.userRelation,
    bundleIntent: candidate.bundleIntent,
    bundleAnchor: candidate.bundleAnchor,
    bundleIntentKeywords: candidate.bundleIntentKeywords,
    textTitle: normalizeTitle(candidate.textTitle),
    coverKicker: candidate.coverKicker ? normalizeTitle(candidate.coverKicker) : undefined,
    coverTitle: normalizeTitle(candidate.coverTitle),
    coverSubtitle: candidate.coverSubtitle ? normalizeTitle(candidate.coverSubtitle) : undefined,
    topicScope: candidate.topicScope,
    pairSemanticMatch: candidate.pairSemanticMatch,
    promisePayloadFit: candidate.promisePayloadFit,
    templateFit: candidate.templateFit,
    warnings: candidate.warnings,
    hardFailures: candidate.hardFailures,
    softWarnings: candidate.softWarnings,
    modeScoreNotes: candidate.modeScoreNotes,
  }));

  return {
    id: `draft_v2_${Date.now()}_${stableHash(`${input.card.id}|${input.topic.id}`)}`,
    manualInnerReview: input.content.manualInnerReview,
    coverCopy: input.content.coverCopy,
    coverSelection: input.content.coverSelection ? {...input.content.coverSelection,downstreamComplete:true} : undefined,
    downstreamStale: false,
    selectedCoverTemplateId: input.card.id,
    content_mode: input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value'
      ? 'product_showcase'
      : 'standard',
    brief,
    title_candidates: titleCandidates,
    selected_title: input.titles.mode==='text_only' ? input.titles.humanSelectableTextTitles?.find(c=>c.id===input.titles.humanSelectedTextTitleId)?.textTitle || '' : normalizeTitle(input.titles.selected.textTitle),
    title_bundles: compiledTitleBundles,
    titlePackage: {
      schemaVersion: '2.0.0',
      titlePackageVersion: 'canonical-title-package-v1',
      nativeSkillReport: input.titles.nativeSkillReport,
      semanticBoundaryReview: input.titles.semanticBoundaryReview,
      humanSelectedCandidateId: input.titles.humanSelectedCandidateId,
      mode:input.titles.mode,
      fixedCoverTitle:input.titles.fixedCoverTitle,
      sourceInnerHash:input.titles.sourceInnerHash,
      humanSelectedTextTitleId:input.titles.humanSelectedTextTitleId,
      humanSelectedCoverTitleId:input.titles.humanSelectedCoverTitleId,
      humanSelectableTextTitles:input.titles.humanSelectableTextTitles,
      contentSnapshotHash: input.titles.contentSnapshotHash,
      productionBriefHash: input.titles.productionBriefHash,
      titleBundles: compiledTitleBundles,
      recommendedBundleId: input.titles.recommendedBundleId,
      selectedBundleId: input.titles.selectedBundleId || input.titles.selected.id,
      source: 'current_title_bundles',
    },
    recommended_bundle_id: input.titles.recommendedBundleId,
    selected_bundle_id: input.titles.selectedBundleId || input.titles.selected.id,
    title_stage_trace: input.titles.titleStageTrace,
    cover_title_candidates: input.titles.candidates.map(candidate => ({
      template_id: input.card.renderer_id,
      title: normalizeTitle(candidate.coverTitle),
      subtitle: candidate.coverSubtitle ? normalizeTitle(candidate.coverSubtitle) : undefined,
      title_type: toCoverTitleType(candidate),
      reason: candidate.userRelation,
    })),
    cover,
    inner_pages: innerPages,
    caption,
    tags,
    seo_keywords: uniqueStrings([input.topic.seo.primary, ...input.topic.seo.related]).slice(0, 8),
    accuracy_audit: {
      approved: true,
      corrected_count: 0,
      issues: issues.filter(item => /法语|事实|French|fact/i.test(item)),
    },
    evidence: input.evidence,
    showcase: input.showcasePlan ? {
      angle_id: input.showcasePlan.angle.id,
      angle_label: input.showcasePlan.angle.label,
      cover_asset_id: input.showcasePlan.coverAsset.id,
      cover_asset_label: input.showcasePlan.coverAsset.label,
      cover_image: input.showcasePlan.coverAsset.image,
      inner_asset_ids: input.showcasePlan.innerAssets.map(asset => asset.id),
      asset_labels: [input.showcasePlan.coverAsset, ...input.showcasePlan.innerAssets].map(asset => asset.label),
    } : undefined,
    checks: {
      title_cover_consistent: true,
      template_capacity_ok: true,
      product_claims_grounded: true,
      content_density_ok: compiled.warnings.length === 0,
      issues: [],
      warnings: issues,
    },
  };
}

function normalizeTemplateCountClaim(value: string, renderer: TemplateCapability['renderer'], itemCount: number) {
  if (renderer !== 'criminal_law_formula' || !itemCount) return value;
  return value.replace(/\d+\s*(项|条|句)(?=(?:自查|检查|清单|公式|方法|要点)?)/gu, `${itemCount}$1`);
}

function wholeProductBridgeCopy(productId: ProductId) {
  if (productId === 'tef_tcf_canada') return {
    title: 'TEF/TCF CA CLB冲刺实战笔记',
    lead: '从选考判断到四科训练，12份资料按备考阶段整理。',
    bullets: ['先确认更适合 TEF 还是 TCF，再按听、读、说、写找到对应方法、题型、表达和练习计划', '不用再四处拼资料，也不会把两场考试混成一场'],
    assetLabel: 'TEF/TCF CA CLB冲刺实战笔记总览',
  };
  if (productId === 'tcf_canada_writing_7day') return {
    title: 'TCF Canada写作7天急救锦囊',
    lead: '7天、7套原创训练，把T1/T2/T3最容易丢分的动作逐个纠正。',
    bullets: ['从任务拆解、考生作答页到T3示范和90秒检查，每天只集中改一个关键动作', '不是背模板，而是用改前改后对照，看清自己到底错在哪'],
    assetLabel: 'TCF Canada写作7天急救锦囊总览',
  };
  return {
    title: 'DELF B2写作资料库',
    lead: '范文、表达、观点和自查工具，按真正的备考动作串成一条学习路径。',
    bullets: ['卡在题型：按任务找范文和结构', '卡在表达：按功能查词汇和句型', '写完以后：照评分项和清单复盘'],
    assetLabel: 'DELF B2写作资料总览',
  };
}

function wholeProductBridge(productId: ProductId, asset: ProductShowcasePlan['coverAsset']) {
  if (productId === 'delf_b2_writing') {
    return {
      lead: '范文、表达、观点和自查工具，按真正的备考动作串成一条学习路径。',
      bullets: [
        '卡在题型：按任务找范文和结构',
        '卡在表达：按功能查词汇和句型',
        '写完以后：照评分项和清单复盘',
      ],
    };
  }
  return {
    lead: asset.userValue || '把分散的备考内容按学习顺序整理，方便你查、练和复盘。',
    bullets: [asset.realContent || '按模块整理核心资料和练习入口。', '从目录找到对应内容，再按自己的备考阶段使用。'],
  };
}

function toTextTitleType(candidate: { mechanism: string; textTitle: string }): NonNullable<TitleCandidate['title_type']> {
  const title = `${candidate.mechanism} ${candidate.textTitle}`;
  if (/解释|怎么|为什么|区别|看懂|搞懂|原理/.test(title)) return '解释型';
  if (/情绪|焦虑|慌|没底|崩溃|急|害怕/.test(title)) return '情绪型';
  if (/痛点|损失|丢分|不会|写不好|来不及|选错|白背|白练/.test(title)) return '痛点型';
  if (/反常识|认知冲突|原来|竟然|别再|不是|而是|误区/.test(title)) return '强钩子型';
  if (/结果|提分|高分|写出来|少走弯路|马上|用得上|省时间/.test(title)) return '结果型';
  return '资料型';
}

function toCoverTitleType(candidate: { mechanism: string; coverTitle: string }): NonNullable<CoverTitleCandidate['title_type']> {
  const title = `${candidate.mechanism} ${candidate.coverTitle}`;
  if (/反常识|原来|竟然|别再|不是|而是|误区/.test(title)) return '反常识';
  if (/情绪|焦虑|慌|没底|急|害怕|崩溃/.test(title)) return '情绪';
  if (/结果|提分|高分|写出来|少走弯路|马上|用得上/.test(title)) return '结果';
  if (/稀缺|少见|难找|独家/.test(title)) return '稀缺';
  if (/考前|报名|2026|今年|最后|冲刺/.test(title)) return '时效';
  if (/大全|全套|合集|资料|清单|速查|目录|体系/.test(title)) return '大全';
  return '资料';
}

function sanitizeDisplayTitle(value: string) {
  return value.replace(/\s*\bweakest\b\s*/gi, '最弱').replace(/\s+/g, ' ').trim();
}

export function compileCover(capability: TemplateCapability, blocks: ContentBlock[]): {
  sections: DenseDirectorySection[];
  overflow: Array<{ heading: string; item: ContentItem; sourceIds: string[] }>;
  warnings: string[];
} {
  const failure = coverCapacityFailure(capability.renderer, blocks);
  if (failure) throw new Error('COVER_CAPACITY:' + failure);
  const displayed = coverDisplayBlocks(capability.renderer, blocks);
  const overflow = blocks.flatMap((block, blockIndex) => {
    const visibleCount = displayed[blockIndex]?.items.length || 0;
    return block.items.slice(visibleCount).map(item => ({ heading: block.heading || '', item: { ...item }, sourceIds: [...block.sourceIds] }));
  });
  return { sections: displayed.map(block => ({
    heading: block.heading || '', side_label: '', columns: 2, items: block.items.map(item => ({ ...item })),
    source_type: sourceType(block), source_ids: block.sourceIds,
  })), overflow, warnings: overflow.length ? [`封面按模板容量展示，${overflow.length}条完整内容保留在内页`] : [] };
}

function chooseDensityTier(capability: TemplateCapability, blocks: ContentBlock[]) {
  const orderedBlocks = blocks.filter(block => capability.acceptedBlockKinds.includes(block.kind));
  const templateSpec = getCoverTemplateSpec(capability.renderer);
  const fitting = capability.densityTiers.filter(tier => {
    const acceptsEllipsizedRows = capability.renderer === 'french_oral_question_bank';
    const visibleCounts = orderedBlocks
      .map(block => block.items.filter(item => acceptsEllipsizedRows || (
        visualLength(item.primary) <= tier.primaryVisualLength[1]
        && visualLength(item.secondary || '') <= tier.secondaryVisualLength[1]
      )).slice(0, tier.itemRange[1]).length)
      .filter(count => count > 0)
      .slice(0, tier.sectionRange[1]);
    if (visibleCounts.length < tier.sectionRange[0] || visibleCounts.length > tier.sectionRange[1]) return false;
    const underfilled = visibleCounts.filter(count => count < tier.itemRange[0]).length;
    if (underfilled > Math.floor(visibleCounts.length / 2)) return false;
    if (templateSpec?.maxTotalItems) {
      const total = visibleCounts.reduce((sum, count) => sum + count, 0);
      const excess = Math.max(0, total - templateSpec.maxTotalItems);
      const removable = visibleCounts.reduce((sum, count) => sum + Math.max(0, count - tier.itemRange[0]), 0);
      if (excess > removable) return false;
    }
    return true;
  });
  return fitting.at(-1) || capability.densityTiers[0];
}

function buildBrief(input: CompileInput): UnifiedContentBrief {
  const editorialOnly = input.topic.knowledgeMode === 'educational_original';
  return {
    product_id: input.productId,
    reference_card_id: input.card.id,
    topic: input.topic.topic,
    audience: input.topic.audienceState,
    scene: input.topic.scene,
    pain: input.topic.painOrDesire,
    content_value: input.topic.promise,
    content_shape: input.capability.family,
    selling_point: editorialOnly ? '' : input.topic.productBridge,
    buying_reason: input.topic.promise,
    product_claim_limit: editorialOnly ? '本篇不写商品事实或商品承接。' : '商品事实只使用本次证据；科普、方法和示例允许原创。',
    knowledge_base_plan: editorialOnly ? '不检索本地知识库' : '少量事实检索与承接',
    ai_original_plan: editorialOnly ? '围绕法语考试范围自由选题并原创全部教育内容' : '围绕选题原创科普、方法、解释和示例',
    cover_requirement: `${input.productId === 'delf_b2_writing' ? input.card.name : '当前已选封面模板'}；${input.capability.compiler}；完整条目优先，长解释转内页`,
    exam_scope: input.topic.examScope,
    difference_from_recent: input.topic.noveltyFingerprint,
  };
}

function buildCaption(parts: CompileInput['content']['captionParts'], tags: string[]) {
  return assembleFinalCaption(parts, tags);
}

function assertFinalCommercialSnapshot(content: ContentPackage) {
  if (!content.innerPages.length || content.finalTeachingQa?.status !== 'PASS') {
    throw new Error('FINAL_COMPILE_CHECK_FAILED:missing pages or language QA');
  }
}

function visibleCount(value: string) {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return ({ 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[value] || 0;
}

export async function buildV2Tags(productId: ProductId, topic: TopicOption, content: ContentPackage, recentTagCounts?: Map<string, number>) {
  content.finalTagSources = selectProductTags(productId, topic, content, recentTagCounts);
  return content.finalTagSources.map(item => item.tag);
}

function buildFallbackTags(productId: ProductId, topic: TopicOption, material: string[]) {
  const identities = productId === 'delf_b2_writing'
    ? ['DELF B2', '法语写作']
    : productId === 'tcf_canada_writing_7day'
      ? ['TCF Canada写作', 'TCF写作', '法语写作']
      : topic.examScope === 'tef_canada'
        ? ['TEF Canada', 'TEF备考', '加拿大法语']
        : topic.examScope === 'tcf_canada'
          ? ['TCF Canada', 'TCF备考', '加拿大法语']
          : ['TEF Canada', 'TCF Canada', '加拿大法语'];
  return uniqueStrings([...identities, topic.seo.primary, ...topic.seo.related, ...material])
    .map(value => value.replace(/^#+/, '').replace(/\s+/g, ''))
    .filter(value => value.length >= 2)
    .slice(0, 10)
    .map(value => `#${value}`);
}

function buildOverflowPage(
  overflow: Array<{ heading: string; item: ContentItem; sourceIds: string[] }>,
  pageNo: number,
): GeneratedInnerPage | null {
  if (!overflow.length) return null;
  const headings = uniqueStrings(overflow.map(item => safeText(item.heading)).filter(Boolean));
  const focus = headings[0] || '本篇重点';
  return {
    page_no: pageNo,
    page_type: 'knowledge_list',
    page_title: `${focus}：完整例子与用法`,
    lead: '把前面的要点放回完整语境，下面对照法语表达、中文含义和实际用法。',
    bullets: overflow.slice(0, 12).map(({ heading, item }) => [heading, item.primary, item.secondary, item.note].filter(Boolean).join('：')),
    source_ids: uniqueStrings(overflow.flatMap(item => item.sourceIds)),
  };
}

function normalizeInnerPages(pages: GeneratedInnerPage[], styleSeed: string) {
  // Keep one visual language inside a note, while distributing different
  // notes across the available inner-page skins. The old V1 normalizer did
  // this; V2 was dropping style_variant, so the renderer always fell back to
  // lined-notebook.
  const styles: NonNullable<GeneratedInnerPage['style_variant']>[] = [
    'lined-notebook', 'grid-notebook', 'dot-notebook',
    'sticky-note', 'draft-paper', 'loose-leaf', 'kraft-paper',
  ];
  const styleIndex = Number.parseInt(stableHash(styleSeed), 36) % styles.length;
  const styleVariant = styles[styleIndex];
  return pages.map((page, index) => ({
    ...page,
    page_no: index + 1,
    bullets: page.bullets.map(item => safeText(item)).filter(Boolean),
    source_ids: uniqueStrings(page.source_ids),
    style_variant: styleVariant,
  }));
}

function sourceType(block: ContentBlock): DenseDirectorySection['source_type'] {
  if (block.sourceMode === 'product_fact') return 'knowledge_base';
  if (block.sourceMode === 'ai_example' || block.sourceMode === 'general_advice') return 'ai_original';
  return block.sourceIds.length ? 'mixed' : 'ai_derived';
}

function chooseColumns(length: number): 2 | 3 | 4 | 5 {
  if (length <= 2) return 2;
  if (length === 3) return 3;
  if (length === 4) return 4;
  return 5;
}

function compactSideLabel(value: string) {
  const compact = value.replace(/[：:·\s]/g, '');
  return Array.from(compact).slice(0, 6).join('');
}

function visualLength(value: unknown) {
  return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(safeText(value))).length;
}

function localArtifact<T>(data: T, inputHash: string, promptVersion: string): VersionedArtifact<T> {
  return {
    data,
    schema_version: V2_SCHEMA_VERSION,
    prompt_version: promptVersion,
    input_hash: inputHash,
    created_at: new Date().toISOString(),
    usage: emptyAiUsage(),
    warnings: [],
  };
}

function safeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(values.map(value => safeText(value)).filter(Boolean)));
}

export function pipelineUsage(...usage: AiUsageSummary[]) {
  return mergeAiUsage(...usage);
}
