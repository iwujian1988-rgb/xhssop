import nextEnv from '@next/env';
import { loadBatch, loadJob, saveJob } from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { pickProductShowcasePlan } from '../src/lib/product-showcase-library';
import { resolveProductEvidence } from '../src/lib/product-fact-retrieval';
import { composeV2 } from '../src/lib/v2/pipeline';
import { stableHash, type ContentPackage, type VersionedArtifact } from '../src/lib/v2/contracts';

nextEnv.loadEnvConfig(process.cwd());

const batchId = process.argv[2];
const jobId = process.argv[3];
if (!batchId || !jobId) throw new Error('用法：resume-content-root-fix-job.mts <batchId> <jobId>');
const batch = await loadBatch(batchId);
const job = await loadJob(batchId, jobId);
if (!job.artifacts?.selectedTopic) throw new Error(`${jobId} 没有可恢复的选题工件`);
if (!job.artifacts.content && job.draft) {
  const paragraphs = job.draft.caption.split(/\n{2,}/u).map(item => item.trim()).filter(Boolean);
  const contentPages = job.draft.inner_pages.filter(page => page.page_type !== 'product_bridge' && page.page_title.trim() !== '把这一篇接着用下去');
  const reconstructed: ContentPackage = {
    topicSnapshotHash: stableHash(job.artifacts.selectedTopic.data),
    productionBriefHash: job.artifacts.selectedTopic.data.productionBrief?.briefHash,
    coverBlocks: job.draft.cover.sections.map((section, index) => ({
      id: `recovered_cover_${index + 1}`,
      kind: job.artifacts!.selectedTopic!.data.plannedBlockKind || 'benefit',
      heading: section.heading,
      items: section.items,
      priority: 1 as const,
      sourceMode: 'general_advice' as const,
      sourceIds: section.source_ids,
    })),
    pagePlan: contentPages.map((page, index) => ({
      pageId: page.pageId || `P${index + 2}`,
      pageGoal: page.page_title,
      userGets: page.lead,
      pageContentPlan: page.bullets.join('\n'),
    })),
    innerPages: contentPages,
    captionParts: {
      opening: paragraphs[0] || '',
      value: paragraphs.slice(1, -2),
      productBridge: paragraphs.at(-2) || '',
      cta: paragraphs.at(-1) || '',
    },
    tagMaterial: job.draft.tags,
    factualClaims: [],
    frenchSegments: [],
  };
  const resumedArtifact: VersionedArtifact<ContentPackage> = {
    data: reconstructed,
    schema_version: '2.0.0',
    prompt_version: 'v2-content-9-final-page-source+whole-note-editorial-1+final-caption-bridge-2',
    input_hash: stableHash({ batchId, jobId, draftId: job.draft.id, reconstructed }),
    created_at: new Date().toISOString(),
    usage: job.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] },
    warnings: [...(job.warnings || []), '恢复脚本从最终用户可见 draft 重建 content artifact；未重跑页面'],
  };
  job.artifacts.content = resumedArtifact;
}
if (!job.artifacts.content) throw new Error(`${jobId} 没有可恢复的内容工件`);
const card = getCompetitorCreativeCard(job.reference_card_id);
if (!card) throw new Error(`找不到参考卡：${job.reference_card_id}`);
const facts = await loadProductFacts(job.product_id);
const evidence = await resolveProductEvidence(job.product_id, facts, job.topic, 12);
const result = await composeV2({
  productId: job.product_id,
  card,
  topic: job.topic,
  evidence,
  contentMode: batch.content_mode,
  endingShowcasePlan: pickProductShowcasePlan(job.product_id, facts, `content-root-resume|${job.id}`),
  resumeArtifacts: job.artifacts,
  onCheckpoint: async (stage, artifacts) => {
    const currentStage = stage === 'execution' ? 'topic_selected' : stage === 'content' ? 'audited' : stage === 'titles' ? 'title_ready' : 'compiled';
    await saveJob(batchId, { ...job, status: 'running', current_stage: currentStage, artifacts });
  },
});
await saveJob(batchId, {
  ...job,
  status: 'success',
  failure: undefined,
  current_stage: result.currentStage,
  artifacts: result.artifacts,
  draft: result.draft,
  usage: result.usage,
  warnings: result.warnings,
  finished_at: new Date().toISOString(),
});
process.stdout.write(JSON.stringify({
  batchId,
  jobId,
  status: 'READY',
  contentPages: result.artifacts.content?.data.innerPages.map(page => ({ pageId: page.pageId, title: page.page_title, bullets: page.bullets.length })),
  caption: result.draft.caption,
  bridge: result.artifacts.content?.data.bridgePlan,
  titles: result.draft.title_bundles,
  usage: result.usage,
}, null, 2));
