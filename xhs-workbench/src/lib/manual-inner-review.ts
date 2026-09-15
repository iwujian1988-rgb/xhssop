import type { BatchJob } from './batch-store';
import type { GeneratedInnerPage } from '@/types/reference-workflow';
import { stableHash, type ContentPackage } from './v2/contracts';

/** Narrow, non-blocking checks before locking. Never rewrite intentional examples. */
export function obviousInnerConsistencyWarnings(pages: GeneratedInnerPage[]): string[] {
  const warnings: string[] = [];
  const count = (s:string) => Number(s) || ({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10} as Record<string,number>)[s];
  for (const p of pages) {
    const titleCount = p.page_title.match(/([一二两三四五六七八九十\d]+)步/);
    for (const bullet of p.bullets) {
      const bodyCount = bullet.match(/(?:拆解|操作|步骤|流程|分成|分为|共|共计)([一二两三四五六七八九十\d]+)步[：:]/);
      if (titleCount && bodyCount && count(titleCount[1]) !== count(bodyCount[1])) {
        warnings.push(`正文一致性提醒 P${p.page_no}：页标题“${titleCount[0]}”与正文“${bodyCount[0]}”不一致，请核对；未自动修改。`);
      }
      if (/Je me permets/i.test(bullet) && /条件式/.test(bullet) && !/不是|并非|不等于|或委婉/.test(bullet)
        && !/voudrais|pourrais|permettrais|serait|aurait/i.test(bullet)) {
        warnings.push(`正文一致性提醒 P${p.page_no}：Je me permets是直陈式现在时，礼貌效果不等于条件式；请核对中文说明。`);
      }
      if (/Vous devez/i.test(bullet) && /用命令式/.test(bullet) && !/不是|并非|不等于/.test(bullet)) {
        warnings.push(`正文一致性提醒 P${p.page_no}：Vous devez是直陈式形式，命令效果不等于命令式；请核对中文说明。`);
      }
    }
  }
  return [...new Set(warnings)];
}

/** Product assembly is not part of the reviewed teaching source. Never trim text. */
export function teachingPages(pages: GeneratedInnerPage[]): GeneratedInnerPage[] {
  if (!Array.isArray(pages)) throw new Error('INNER_STRUCTURE_INVALID');
  const result = pages.filter(page => page?.page_type !== 'product_bridge' && page?.pageId !== 'conversion_transition').map((page, index) => {
    if (!page || typeof page.page_title !== 'string' || !page.page_title.trim()
      || typeof page.lead !== 'string' || !Array.isArray(page.bullets)
      || page.bullets.some(item => typeof item !== 'string')) throw new Error('INNER_STRUCTURE_INVALID');
    const { renderPayload: _payload, ...canonical } = page;
    return { ...canonical, page_no: index + 1 };
  });
  if (!result.length) throw new Error('INNER_STRUCTURE_INVALID:empty');
  return structuredClone(result);
}

export function assertReviewedInner(content?: ContentPackage) {
  if (!content) throw new Error('REVIEWED_INNER_MISSING');
  const review = content.manualInnerReview;
  if (review && (review.status !== 'locked' || review.innerHash !== stableHash(content.innerPages))) {
    throw new Error('INNER_NEEDS_HUMAN_REVIEW');
  }
}

export function assertInnerRepairAllowed(content: ContentPackage) {
  if (content.manualInnerReview) throw new Error('LOCKED_INNER_REPAIR_FORBIDDEN:NEEDS_HUMAN_REVIEW');
}

/** One explicit invalidation list, not a dependency engine. Historical files stay intact. */
function invalidate(job: BatchJob) {
  const content = job.artifacts!.content!;
  Object.assign(content.data, {
    autoFactBrief:undefined,coverCopy:undefined,
    captionParts: { opening: '', value: [], productBridge: '', cta: '' },
    captionContentSnapshotHash: undefined, bridgePlan: undefined, tagMaterial: [],
    transitionText: undefined, finalTagSources: undefined,
    coverCandidates: undefined, selectedCoverTemplateId: undefined, coverBlocks: [],
    coverSourceInnerHash: undefined, finalTeachingQa: undefined, frenchSegments: [], factualClaims: [],
  });
  job.artifacts!.titles = undefined;
  job.artifacts!.compiledDraft = undefined;
  Object.assign(job.draft!, {
    readablePagePlan:undefined,
    coverCopy:undefined,
    caption: '', tags: [], title_candidates: [], selected_title: '', title_bundles: [],
    titlePackage: undefined, selected_bundle_id: undefined, recommended_bundle_id: undefined,
    title_stage_trace: undefined, cover_title_candidates: [], selectedCoverTemplateId: undefined,
    cover: { kind: 'dense_directory', title: '', subtitle: '', sections: [] },
    coverEditStates: undefined, cover_edit_meta: undefined, downstreamStale: true,
    downstreamSourceInnerHash: undefined,
  });
  job.cover_image_url = undefined;
  job.image_task_id = undefined;
  job.commercial = undefined;
  job.failure = undefined;
  job.finished_at = undefined;
  job.status = 'awaiting_review'; // never auto-run on save/confirm
  job.current_stage = 'content_ready';
}

export function saveInnerWorkingCopy(jobInput: BatchJob, pages: GeneratedInnerPage[], options: { invalidateDownstream?: boolean } = {}): BatchJob {
  const job = structuredClone(jobInput);
  assertNotDropped(job);
  if (!job.draft || !job.artifacts?.content) throw new Error('CANONICAL_ARTIFACT_REQUIRED');
  const working = teachingPages(pages);
  job.draft.inner_pages = working;
  const consistencyWarnings = obviousInnerConsistencyWarnings(working);
  job.artifacts.content.warnings = [...new Set([...job.artifacts.content.warnings.filter(w=>!w.startsWith('正文一致性提醒')), ...consistencyWarnings])];
  job.draft.checks.warnings = [...new Set([...(job.draft.checks.warnings || []).filter(w=>!w.startsWith('正文一致性提醒')), ...consistencyWarnings])];
  job.draft.readablePagePlan = undefined;
  const old = job.artifacts.content.data.manualInnerReview;
  const invalidateDownstream = options.invalidateDownstream !== false;
  if (!invalidateDownstream) {
    // Explicit user choice: keep existing title/cover/caption output as-is.
    // The edited Inner is still persisted for the user's next decision, but
    // downstream artifacts remain available as a preview of the prior source.
    // A preview may remain visible, but it is never the current version once
    // the working Inner has changed.  Export gates consume this flag.
    job.draft.downstreamStale = true;
    job.draft.downstreamPreservedAfterInnerEdit = true;
    job.draft.downstreamSourceInnerHash = old?.innerHash;
    job.draft.manualInnerReview = old ? { ...old } : undefined;
    job.draft.checks.warnings = [...new Set([...(job.draft.checks.warnings || []), '下游标题、封面和发布文字仍基于修改前的正文'])];
    return job;
  }
  job.artifacts.content.data.manualInnerReview = {
    status: 'needs_review', innerHash: old?.innerHash || stableHash(job.artifacts.content.data.innerPages),
    reviewedAt: old?.reviewedAt || '',
  };
  invalidate(job);
  job.draft.manualInnerReview = { ...job.artifacts.content.data.manualInnerReview };
  job.draft.downstreamPreservedAfterInnerEdit = false;
  job.draft.downstreamSourceInnerHash = undefined;
  return job;
}

export function lockInnerWorkingCopy(jobInput: BatchJob): BatchJob {
  const job = structuredClone(jobInput);
  assertNotDropped(job);
  if (!job.draft || !job.artifacts?.content) throw new Error('CANONICAL_ARTIFACT_REQUIRED');
  const pages = teachingPages(job.draft.inner_pages);
  const consistencyWarnings = obviousInnerConsistencyWarnings(pages);
  job.artifacts.content.warnings = [...new Set([...job.artifacts.content.warnings, ...consistencyWarnings])];
  job.draft.checks.warnings = [...new Set([...(job.draft.checks.warnings || []), ...consistencyWarnings])];
  job.artifacts.content.data.innerPages = pages;
  job.draft.inner_pages = structuredClone(pages);
  job.artifacts.content.data.manualInnerReview = {
    status: 'locked', innerHash: stableHash(pages), reviewedAt: new Date().toISOString(),
  };
  invalidate(job);
  // Do not inherit a previous automatic repair budget into a new human revision.
  job.artifacts.content.prompt_version = 'human-reviewed-inner-1';
  job.draft.manualInnerReview = { ...job.artifacts.content.data.manualInnerReview };
  job.draft.downstreamSourceInnerHash = undefined;
  return job;
}

export function assertNotDropped(job: BatchJob) {
  if (job.status === 'dropped' || job.artifacts?.content?.data.manualInnerReview?.status === 'dropped'
    || job.draft?.manualInnerReview?.status === 'dropped') throw new Error('HUMAN_REJECTED:这篇已放弃，只能查看');
}

export function dropInnerJob(jobInput: BatchJob): BatchJob {
  const job = structuredClone(jobInput);
  assertNotDropped(job);
  if (!job.artifacts?.content || !job.draft) throw new Error('CANONICAL_ARTIFACT_REQUIRED');
  const review = { status: 'dropped' as const, innerHash: '', reviewedAt: '', droppedAt: new Date().toISOString() };
  job.artifacts.content.data.manualInnerReview = review;
  job.draft.manualInnerReview = { ...review };
  job.draft.downstreamStale = true;
  job.status = 'dropped';
  // Preserve all content, traces, usage and previous results as historical evidence.
  return job;
}

/** Build the existing DraftReview working view, with no invented downstream output. */
export function prepareJobForHumanReview(jobInput: BatchJob): BatchJob {
  const job = structuredClone(jobInput);
  assertNotDropped(job);
  const content = job.artifacts?.content?.data;
  const topic = job.artifacts?.selectedTopic?.data;
  if (!content || !topic) throw new Error('CANONICAL_ARTIFACT_REQUIRED');
  if (!job.draft) job.draft = {
    id: `review_${job.id}`, content_mode: 'standard',
    brief: { product_id: job.product_id, reference_card_id: job.reference_card_id, topic: topic.topic,
      audience: topic.audienceState, scene: topic.scene, pain: topic.painOrDesire, content_value: topic.promise,
      content_shape: 'directory', selling_point: '', buying_reason: '', product_claim_limit: '',
      knowledge_base_plan: '', ai_original_plan: '', cover_requirement: '', difference_from_recent: '' },
    title_candidates: [], selected_title: '', cover: { kind: 'dense_directory', title: '', subtitle: '', sections: [] },
    inner_pages: teachingPages(content.innerPages), caption: '', tags: [], seo_keywords: [], evidence: [],
    accuracy_audit: { approved: false, corrected_count: 0, issues: [] },
    checks: { title_cover_consistent: false, template_capacity_ok: false, product_claims_grounded: false, content_density_ok: false, issues: [] },
  };
  return saveInnerWorkingCopy(job, content.innerPages);
}

export function isRunnableJob(job: Pick<BatchJob, 'status' | 'artifacts'>) {
  return job.status === 'pending' && job.artifacts?.content?.data.manualInnerReview?.status !== 'dropped';
}
