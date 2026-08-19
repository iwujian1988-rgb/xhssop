import { emptyAiUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getRecentTitleFingerprints } from '@/lib/title-usage-store';
import type { ProductFacts } from '@/types/content-planning';
import type { ProductId } from '@/types/data';
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
import { auditContentPackage, generateContentPackage, repairContentPackage } from './content-stage';
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
import { generateTitlePackage } from './title-stage';
import { generateTopicOptions, getCapabilityFallback, migratedToTopicOption, topicOptionToMigrated } from './topic-stage';
import { inspectForPublish, isReleaseBlockingIssue, issueAsWarning } from './publish-guard';
import type { ProductShowcasePlan } from '@/lib/product-showcase-library';

export const PIPELINE_PROMPT_VERSION = 'v2-pipeline-1';

export function isV2PipelineEnabled() {
  // V2 is the only active runtime. The legacy implementation remains in the
  // repository for historical comparison, but no frontend request may enter it.
  return true;
}

export interface PlanTopicsV2Input {
  productId: ProductId;
  card: CompetitorCreativeCard;
  facts: ProductFacts;
  direction?: string;
  contentMode?: 'standard' | 'product_showcase';
  limit?: number;
  recentAngles?: string[];
}

export interface ComposeV2Input {
  productId: ProductId;
  card: CompetitorCreativeCard;
  topic: MigratedTopic & { v2_topic?: TopicOption };
  evidence: EvidenceSnippet[];
  contentMode?: 'standard' | 'product_showcase';
  showcasePlan?: ProductShowcasePlan;
  resumeArtifacts?: PipelineArtifacts;
}

export async function planTopicsV2(input: PlanTopicsV2Input) {
  const capability = getCapabilityFallback(input.card);
  const artifact = await generateTopicOptions({ ...input, capability });
  return {
    capability,
    artifact,
    topics: artifact.data.map(topicOptionToMigrated),
    usage: artifact.usage,
  };
}

export async function composeV2(input: ComposeV2Input): Promise<PipelineResult> {
  const capability = getCapabilityFallback(input.card);
  const topic = migratedToTopicOption(input.topic, input.productId, input.card);
  const selectedTopic = input.resumeArtifacts?.selectedTopic
    || localArtifact(topic, stableHash(input.topic), 'v2-topic-selection-1');
  const evidence = input.evidence.slice(0, 10);
  const contentInput = {
    topic,
    capability,
    evidence,
    showcasePlan: input.showcasePlan,
  };
  const publishReadyContent = await prepareContentForTitles({
    productId: input.productId,
    topic,
    capability,
    evidence,
    contentInput,
    selectedTopic,
    resumeContent: input.resumeArtifacts?.content,
  });
  const recentUsage = await getRecentTitleFingerprints(input.productId, { days: 30 }).catch(() => undefined);
  const prebuiltTags = await buildV2Tags(
    input.productId,
    topic,
    publishReadyContent.data,
    recentUsage?.recentTagCounts,
  );
  let titles;
  try {
    titles = await generateTitlePackage({
      topic,
      capability,
      content: publishReadyContent.data,
    });
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
  const draft = compileDraft({
    productId: input.productId,
    card: input.card,
    topic,
    capability,
    content: publishReadyContent.data,
    titles: titles.data,
    evidence,
    auditWarnings: publishReadyContent.warnings,
    prebuiltTags,
    showcasePlan: input.showcasePlan,
  });
  const compiledDraft = localArtifact(
    draft,
    stableHash({ topic, content: publishReadyContent.input_hash, titles: titles.input_hash }),
    PIPELINE_PROMPT_VERSION,
  );
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
  productId: ProductId;
  topic: TopicOption;
  capability: TemplateCapability;
  evidence: EvidenceSnippet[];
  contentInput: Parameters<typeof generateContentPackage>[0];
  selectedTopic: VersionedArtifact<TopicOption>;
  resumeContent?: VersionedArtifact<ContentPackage>;
  showcasePlan?: ProductShowcasePlan;
}

async function prepareContentForTitles(input: PrepareContentInput): Promise<VersionedArtifact<ContentPackage>> {
  if (input.resumeContent) {
    let resumedContent = input.resumeContent;
    let resumedInspection = inspectForPublish(resumedContent.data, input);
    const initialBlocking = resumedInspection.hardIssues.filter(isReleaseBlockingIssue);
    if (initialBlocking.length) {
      resumedContent = await repairContentPackage(resumedContent, input.contentInput, initialBlocking);
      resumedInspection = inspectForPublish(resumedContent.data, input);
    }
    const remainingBlocking = resumedInspection.hardIssues.filter(isReleaseBlockingIssue);
    const resumedAdvisory = resumedInspection.hardIssues.filter(issue => !isReleaseBlockingIssue(issue));
    if (remainingBlocking.length) {
      const error = new Error(`V2 断点内容已失效：${remainingBlocking.map(item => item.code).join('、')}`);
      Object.assign(error, {
        v2Stage: 'audit',
        usage: resumedContent.usage,
        publishIssues: remainingBlocking,
        partialArtifacts: { selectedTopic: input.selectedTopic, content: resumedContent },
      });
      throw error;
    }
    return {
      ...resumedContent,
      data: resumedInspection.content,
      warnings: uniqueStrings([
        ...resumedContent.warnings,
        ...resumedInspection.warnings,
        ...resumedAdvisory.map(issueAsWarning),
        '已复用审校通过的内容，仅续跑标题阶段',
      ]),
    };
  }

  let generatedContent = await generateContentPackage(input.contentInput);
  let inspection = inspectForPublish(generatedContent.data, input);
  const initialBlocking = inspection.hardIssues.filter(isReleaseBlockingIssue);
  if (initialBlocking.length) {
    const initialIssues = inspection.hardIssues;
    generatedContent = await repairContentPackage(generatedContent, input.contentInput, initialBlocking);
    inspection = inspectForPublish(generatedContent.data, input);
    const remainingBlocking = inspection.hardIssues.filter(isReleaseBlockingIssue);
    if (remainingBlocking.length) {
      console.error('[v2-publish-repair-rejected]', JSON.stringify({
        product_id: input.productId,
        template_id: input.capability.renderer,
        topic: input.topic.topic,
        initial_issues: initialIssues,
        remaining_issues: remainingBlocking,
        repaired_summary: {
          cover: generatedContent.data.coverBlocks.map(block => ({ heading: block.heading, items: block.items.length })),
          inner_pages: generatedContent.data.innerPages.map(page => ({ title: page.page_title, bullets: page.bullets.length })),
          caption_units: [
            generatedContent.data.captionParts.opening,
            ...generatedContent.data.captionParts.value,
            generatedContent.data.captionParts.productBridge,
            generatedContent.data.captionParts.cta,
          ].join('').length,
          claims: generatedContent.data.factualClaims,
        },
      }));
    }
  }
  const blockingAfterRepair = inspection.hardIssues.filter(isReleaseBlockingIssue);
  const advisoryAfterRepair = inspection.hardIssues.filter(issue => !isReleaseBlockingIssue(issue));
  if (blockingAfterRepair.length) {
    const error = new Error(`V2 发布闸门未通过：${blockingAfterRepair.map(item => `${item.code}${item.path ? `@${item.path}` : ''}`).join('、')}`);
    Object.assign(error, {
      v2Stage: 'audit',
      usage: generatedContent.usage,
      publishIssues: blockingAfterRepair,
      partialArtifacts: { selectedTopic: input.selectedTopic, content: generatedContent },
    });
    throw error;
  }
  const guardedContent = {
    ...generatedContent,
    data: inspection.content,
    warnings: uniqueStrings([...inspection.warnings, ...advisoryAfterRepair.map(issueAsWarning)]),
  };
  const auditedContent = await auditContentPackage(guardedContent, {
    topic: input.topic,
    evidence: input.evidence,
  });
  const finalInspection = inspectForPublish(auditedContent.data, input);
  const finalBlocking = finalInspection.hardIssues.filter(isReleaseBlockingIssue);
  const finalAdvisory = finalInspection.hardIssues.filter(issue => !isReleaseBlockingIssue(issue));
  if (finalBlocking.length) {
    const error = new Error(`V2 法语返修后发布闸门未通过：${finalBlocking.map(item => item.code).join('、')}`);
    Object.assign(error, {
      v2Stage: 'audit',
      usage: auditedContent.usage,
      publishIssues: finalBlocking,
      partialArtifacts: { selectedTopic: input.selectedTopic, content: auditedContent },
    });
    throw error;
  }
  return {
    ...auditedContent,
    data: finalInspection.content,
    warnings: uniqueStrings([...auditedContent.warnings, ...finalInspection.warnings, ...finalAdvisory.map(issueAsWarning)]),
  };
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
}

export function compileDraft(input: CompileInput): ReferenceDrivenDraft {
  const compiled = compileCover(input.capability, input.content.coverBlocks);
  const cover: DenseDirectoryCoverPayload = {
    kind: 'dense_directory',
    title: input.titles.selected.coverTitle,
    subtitle: sanitizeDisplayTitle(input.titles.selected.coverSubtitle || input.topic.promise),
    sections: compiled.sections,
  };
  const overflowPage = buildOverflowPage(compiled.overflow, input.content.innerPages.length + 1);
  let innerPages = normalizeInnerPages([
    ...input.content.innerPages,
    ...(overflowPage ? [overflowPage] : []),
  ], `${input.productId}|${input.card.id}|${input.topic.id}`);
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
  const brief = buildBrief(input);
  const titleCandidates = input.titles.candidates.map<TitleCandidate>((candidate, index) => ({
    title: candidate.textTitle,
    title_type: toTextTitleType(candidate),
    formula_id: `v2_${candidate.mechanism || index + 1}`,
    trigger_type: toTextTitleType(candidate),
    formula_skeleton: '',
    reason: candidate.userRelation,
    risk_flags: [],
  }));
  const caption = buildCaption(input.content.captionParts);
  const tags = input.prebuiltTags?.length
    ? input.prebuiltTags
    : buildFallbackTags(input.productId, input.topic, input.content.tagMaterial);
  const issues = uniqueStrings([...input.auditWarnings]);

  return {
    id: `draft_v2_${Date.now()}_${stableHash(`${input.card.id}|${input.topic.id}`)}`,
    brief,
    title_candidates: titleCandidates,
    selected_title: input.titles.selected.textTitle,
    cover_title_candidates: input.titles.candidates.map(candidate => ({
      template_id: input.card.renderer_id,
      title: candidate.coverTitle,
      subtitle: candidate.coverSubtitle,
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
      content_density_ok: true,
      issues: [],
      warnings: issues,
    },
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
} {
  const tier = chooseDensityTier(capability, blocks);
  const ordered = blocks.slice().sort((a, b) => a.priority - b.priority);
  const maxSections = tier.sectionRange[1];
  const maxItems = tier.itemRange[1];
  const minSections = tier.sectionRange[0];
  const minItems = tier.itemRange[0];
  const sections: DenseDirectorySection[] = [];
  const overflow: Array<{ heading: string; item: ContentItem; sourceIds: string[] }> = [];

  for (const block of ordered) {
    const accepted = capability.acceptedBlockKinds.includes(block.kind);
    if (!accepted) {
      for (const item of block.items) overflow.push({ heading: block.heading || '', item, sourceIds: block.sourceIds });
      continue;
    }
    if (sections.length >= maxSections) {
      for (const item of block.items) overflow.push({ heading: block.heading || '', item, sourceIds: block.sourceIds });
      continue;
    }
    const visible: ContentItem[] = [];
    for (const item of block.items) {
      const fits = visualLength(item.primary) <= tier.primaryVisualLength[1]
        && visualLength(item.secondary || '') <= tier.secondaryVisualLength[1];
      if (!fits || visible.length >= maxItems) {
        overflow.push({ heading: block.heading || '', item, sourceIds: block.sourceIds });
      } else {
        visible.push(item);
      }
    }
    if (!visible.length) continue;
    sections.push({
      side_label: compactSideLabel(block.heading || `第${sections.length + 1}组`),
      heading: block.heading || `第${sections.length + 1}组`,
      columns: chooseColumns(visible.length),
      items: visible.map(item => ({ primary: item.primary, secondary: item.secondary, note: item.note })),
      source_type: sourceType(block),
      source_ids: block.sourceIds,
    });
  }

  if (sections.length < minSections) {
    throw new Error(`V2编译失败：${capability.renderer} 需要至少${minSections}个完整分组，当前只有${sections.length}个`);
  }
  const underfilled = sections.filter(section => section.items.length < minItems);
  if (underfilled.length > Math.floor(sections.length / 2)) {
    throw new Error(`V2编译失败：${capability.renderer} 的完整短条目不足，不能靠截断或补空话填封面`);
  }
  return { sections, overflow };
}

function chooseDensityTier(capability: TemplateCapability, blocks: ContentBlock[]) {
  const orderedBlocks = blocks.filter(block => capability.acceptedBlockKinds.includes(block.kind));
  const fitting = capability.densityTiers.filter(tier => {
    const visibleCounts = orderedBlocks
      .map(block => block.items.filter(item => (
        visualLength(item.primary) <= tier.primaryVisualLength[1]
        && visualLength(item.secondary || '') <= tier.secondaryVisualLength[1]
      )).slice(0, tier.itemRange[1]).length)
      .filter(count => count > 0)
      .slice(0, tier.sectionRange[1]);
    if (visibleCounts.length < tier.sectionRange[0] || visibleCounts.length > tier.sectionRange[1]) return false;
    const underfilled = visibleCounts.filter(count => count < tier.itemRange[0]).length;
    return underfilled <= Math.floor(visibleCounts.length / 2);
  });
  return fitting.at(-1) || capability.densityTiers[0];
}

function buildBrief(input: CompileInput): UnifiedContentBrief {
  return {
    product_id: input.productId,
    reference_card_id: input.card.id,
    topic: input.topic.topic,
    audience: input.topic.audienceState,
    scene: input.topic.scene,
    pain: input.topic.painOrDesire,
    content_value: input.topic.promise,
    content_shape: input.capability.family,
    selling_point: input.topic.productBridge,
    buying_reason: input.topic.promise,
    product_claim_limit: '商品事实只使用本次证据；科普、方法和示例允许原创。',
    knowledge_base_plan: input.topic.knowledgeMode === 'educational_original' ? '仅核对商品承接' : '少量事实检索与承接',
    ai_original_plan: '围绕选题原创科普、方法、解释和示例',
    cover_requirement: `${input.card.name}；${input.capability.compiler}；完整条目优先，长解释转内页`,
    difference_from_recent: input.topic.noveltyFingerprint,
  };
}

function buildCaption(parts: CompileInput['content']['captionParts']) {
  return [parts.opening, ...parts.value, parts.productBridge, parts.cta]
    .map(value => value.trim())
    .filter(Boolean)
    .join('\n\n');
}

async function buildV2Tags(productId: ProductId, topic: TopicOption, content: ContentPackage, recentTagCounts?: Map<string, number>) {
  const contentContext = [
    topic.topic,
    topic.audienceState,
    topic.scene,
    topic.painOrDesire,
    topic.promise,
    ...content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...content.innerPages.flatMap(page => [page.page_title, page.lead || '', ...page.bullets]),
    content.captionParts.opening,
    ...content.captionParts.value,
    content.captionParts.productBridge,
  ].filter(Boolean).join(' ');
  // Lazy import keeps the pure compiler/dataflow test independent from the
  // optional French dictionary loaded by the legacy compose module.
  const { normalizeTags } = await import('@/lib/reference-compose');
  return normalizeTags(
    content.tagMaterial,
    uniqueStrings([topic.seo.primary, ...topic.seo.related]),
    productId,
    contentContext,
    topic.noveltyFingerprint || topic.id,
    recentTagCounts,
    uniqueStrings([topic.seo.primary, ...topic.seo.related, ...topic.factTerms]),
  );
}

function buildFallbackTags(productId: ProductId, topic: TopicOption, material: string[]) {
  const identities = productId === 'delf_b2_writing'
    ? ['DELF B2', '法语写作']
    : ['TEF TCF', '加拿大法语'];
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
  return {
    page_no: pageNo,
    page_type: 'knowledge_list',
    page_title: '封面放不下的补充内容',
    lead: '长解释和完整例子放在这里，封面只保留最容易扫读的内容。',
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
    bullets: page.bullets.map(item => item.trim()).filter(Boolean),
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

function visualLength(value: string) {
  return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value.trim())).length;
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));
}

export function pipelineUsage(...usage: AiUsageSummary[]) {
  return mergeAiUsage(...usage);
}
