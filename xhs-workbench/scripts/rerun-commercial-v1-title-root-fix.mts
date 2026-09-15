import fs from 'node:fs/promises';
import path from 'node:path';

import { loadJob, saveJob } from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { generateTitlePackage } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const batchId = process.argv[2] || 'batch_commercial_v1_1788485294624';
const requestedJobIds = process.argv.slice(3);
const jobIds = requestedJobIds.length ? requestedJobIds : ['job_001', 'job_002', 'job_003'];
const output: Array<Record<string, unknown>> = [];

function updateDraftTitles(draft: any, titles: any) {
  const bundles = (titles.titleBundles || titles.candidates).map((candidate: any, index: number) => ({
    id: candidate.id || `title_bundle_${index + 1}`,
    clickMode: candidate.clickMode || candidate.mechanism,
    slotId: candidate.slotId,
    requestedClickMode: candidate.requestedClickMode,
    sourceDirection: candidate.sourceDirection,
    generatorClickMode: candidate.generatorClickMode,
    detectedClickMode: candidate.detectedClickMode,
    finalClickMode: candidate.finalClickMode,
    clickReason: candidate.clickReason || candidate.userRelation || '',
    bundleIntent: candidate.bundleIntent,
    bundleAnchor: candidate.bundleAnchor,
    bundleIntentKeywords: candidate.bundleIntentKeywords,
    textTitle: candidate.textTitle,
    coverKicker: candidate.coverKicker,
    coverTitle: candidate.coverTitle,
    coverSubtitle: candidate.coverSubtitle,
    topicScope: candidate.topicScope,
    pairSemanticMatch: candidate.pairSemanticMatch,
    promisePayloadFit: candidate.promisePayloadFit,
    templateFit: candidate.templateFit,
    warnings: candidate.warnings,
    hardFailures: candidate.hardFailures,
    softWarnings: candidate.softWarnings,
    modeScoreNotes: candidate.modeScoreNotes,
  }));
  const selectedId = titles.selectedBundleId || titles.selected.id || bundles[0]?.id;
  const selected = bundles.find((bundle: any) => bundle.id === selectedId) || bundles[0];
  if (!selected) throw new Error('标题节点没有返回可持久化候选');
  const titleCandidates = bundles.map((bundle: any, index: number) => ({
    ...(draft.title_candidates?.[index] || {}),
    title: bundle.textTitle,
    title_type: draft.title_candidates?.[index]?.title_type || 'human_editorial_hook',
    formula_id: `v2_${bundle.clickMode || index + 1}`,
    trigger_type: draft.title_candidates?.[index]?.trigger_type || 'human_editorial_hook',
    formula_skeleton: '',
    reason: bundle.clickReason,
    risk_flags: [],
  }));
  const coverCandidates = bundles.map((bundle: any, index: number) => ({
    ...(draft.cover_title_candidates?.[index] || {}),
    title: bundle.coverTitle,
    subtitle: bundle.coverSubtitle,
    title_type: draft.cover_title_candidates?.[index]?.title_type || 'human_editorial_hook',
    reason: bundle.clickReason,
  }));
  return {
    ...draft,
    title_candidates: titleCandidates,
    selected_title: selected.textTitle,
    title_bundles: bundles,
    titlePackage: {
      schemaVersion: '2.0.0',
      titlePackageVersion: 'canonical-title-package-v1',
      contentSnapshotHash: titles.contentSnapshotHash,
      productionBriefHash: titles.productionBriefHash,
      titleBundles: bundles,
      recommendedBundleId: titles.recommendedBundleId || selected.id,
      selectedBundleId: selected.id,
      source: 'current_title_bundles',
    },
    recommended_bundle_id: titles.recommendedBundleId || selected.id,
    selected_bundle_id: selected.id,
    title_stage_trace: titles.titleStageTrace,
    cover_title_candidates: coverCandidates,
    cover: {
      ...draft.cover,
      title: selected.coverTitle,
      subtitle: selected.coverSubtitle || draft.cover.subtitle,
    },
  };
}

for (const jobId of jobIds) {
  try {
  const job = await loadJob(batchId, jobId);
  if (!job.artifacts?.selectedTopic || !job.artifacts.content || !job.draft) {
    throw new Error(`${jobId} 缺少最终内容、选题或Draft工件`);
  }
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!card) throw new Error(`${jobId} 找不到模板卡 ${job.reference_card_id}`);
  const beforeInnerPages = JSON.stringify(job.draft.inner_pages);
  const beforeCaption = job.draft.caption;
  const titleArtifact = await generateTitlePackage({
    topic: job.artifacts.selectedTopic.data,
    capability: getCapabilityFallback(card),
    content: job.artifacts.content.data,
  });
  const nextDraft = updateDraftTitles(job.draft, titleArtifact.data);
  if (JSON.stringify(nextDraft.inner_pages) !== beforeInnerPages || nextDraft.caption !== beforeCaption) {
    throw new Error(`${jobId} 标题重跑意外修改了内页或Caption`);
  }
  await saveJob(batchId, {
    ...job,
    draft: nextDraft,
    artifacts: {
      ...job.artifacts,
      titles: titleArtifact,
      ...(job.artifacts.compiledDraft ? {
        compiledDraft: {
          ...job.artifacts.compiledDraft,
          data: nextDraft,
          created_at: new Date().toISOString(),
        },
      } : {}),
    },
    warnings: [...new Set([...(job.warnings || []), ...titleArtifact.warnings, 'TITLE_ROOT_FIX_RERUN_ONLY'])],
  });
  const bundles = titleArtifact.data.titleBundles || titleArtifact.data.candidates;
  output.push({
    jobId,
    topic: job.artifacts.selectedTopic.data.topic,
    contentSnapshotHash: titleArtifact.data.contentSnapshotHash,
    creatorRaw: (titleArtifact.data.titleStageTrace?.generatorRaw as any)?.creator,
    secondEditor: (titleArtifact.data.titleStageTrace?.generatorRaw as any)?.editor,
    fieldRepairAttempts: (titleArtifact.data.titleStageTrace?.generatorRaw as any)?.fieldRepairAttempts,
    fieldRepair: titleArtifact.warnings.filter(item => item.startsWith('FIELD_REPAIR')),
    titleBundles: bundles.map(bundle => ({
      textTitle: bundle.textTitle,
      coverTitle: bundle.coverTitle,
      coverSubtitle: bundle.coverSubtitle,
    })),
    requestId: titleArtifact.request_id,
    promptVersion: titleArtifact.prompt_version,
    usage: titleArtifact.usage,
  });
  process.stderr.write(`[title-root-fix] ${jobId} ${bundles.length} bundles, editor=0\n`);
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    output.push({
      jobId,
      error: error.message,
      titleDebug: (error as Error & { titleDebug?: unknown }).titleDebug,
      usage: (error as Error & { usage?: unknown }).usage,
    });
    process.stderr.write(`[title-root-fix] FAIL ${jobId}: ${error.message}\n`);
  }
}

const result = {
  batchId,
  generatedAt: new Date().toISOString(),
  creatorCalls: jobIds.length,
  secondEditorCalls: 0,
  jobs: output,
};
const resultPath = path.resolve('.tmp-title-root-fix-commercial-v1.json');
await fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(JSON.stringify({ resultPath, ...result }, null, 2));
