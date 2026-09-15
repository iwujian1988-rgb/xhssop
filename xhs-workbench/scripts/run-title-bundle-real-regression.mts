/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
import { generateTitlePackage, diagnoseTitlePair } from '../src/lib/v2/title-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { buildLockedProductionBrief } from '../src/lib/v2/content-brief';
import type { ContentPackage, TopicOption } from '../src/lib/v2/contracts';

nextEnv.loadEnvConfig(process.cwd());

const base = process.env.TEST_BASE_URL || 'http://localhost:4100';
const batchId = process.env.TEST_BATCH_ID || 'batch_1788145696701';
const outputPath = process.env.TEST_OUTPUT || '.tmp-title-bundle-real-regression.json';
const requestedJobIds = (process.env.TEST_JOB_IDS || '').split(',').map(value => value.trim()).filter(Boolean);
const requestedLimit = Number(process.env.TEST_LIMIT || (requestedJobIds.length ? requestedJobIds.length : 10));

const response = await fetch(`${base}/api/batch?batch_id=${encodeURIComponent(batchId)}`);
if (!response.ok) throw new Error(`读取批次失败：HTTP ${response.status}`);
const batch = await response.json() as { jobs?: Array<Record<string, any>> };
const jobs = (batch.jobs || []).filter(job => job.status === 'success' && (job.artifacts?.selectedTopic?.data || job.topic?.v2_topic) && job.artifacts?.content?.data);
const selected = requestedJobIds.length
  ? requestedJobIds.map(id => jobs.find(job => job.id === id)).filter((job): job is Record<string, any> => Boolean(job))
  : jobs.slice(0, requestedLimit);
if (selected.length < requestedLimit) throw new Error(`可复用完整内容不足${requestedLimit}个，实际${selected.length}`);

const rows: Array<Record<string, unknown>> = [];
for (const job of selected) {
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!card) throw new Error(`找不到创作卡：${job.reference_card_id}`);
  const sourceTopic = (job.artifacts.selectedTopic?.data || job.topic.v2_topic) as TopicOption;
  const topic = sourceTopic.productionBrief ? sourceTopic : { ...sourceTopic, productionBrief: buildLockedProductionBrief(sourceTopic) };
  const content = job.artifacts.content.data as ContentPackage;
  const started = Date.now();
  try {
    const artifact = await generateTitlePackage({ topic, capability: getCapabilityFallback(card), content });
    const bundles = artifact.data.titleBundles || artifact.data.candidates;
    rows.push({
      jobId: job.id,
      referenceCardId: job.reference_card_id,
      motherTopic: topic.topic,
      finalPublicTopic: topic.topic,
      primaryClickMode: artifact.data.titleStageTrace?.primaryClickMode,
      secondaryClickMode: artifact.data.titleStageTrace?.secondaryClickMode,
      specificAsset: topic.specificAsset,
      templateId: card.renderer_id,
      templateCapacity: {
        ...(() => { const spec = getCoverTemplateSpec(card.renderer_id); return spec ? {
          titleMinVisibleChars: spec.titleMinVisibleChars,
          titlePreferredMinChars: spec.titlePreferredMinChars,
          titlePreferredMaxChars: spec.titlePreferredMaxChars,
          titleMaxVisibleChars: spec.titleMaxVisibleChars,
          titleMaxLines: spec.titleMaxLines,
          subtitleMaxVisibleChars: spec.subtitleMaxVisibleChars,
          subtitleMaxLines: spec.subtitleMaxLines,
          kickerSupported: spec.kickerSupported,
          kickerMaxVisibleChars: spec.kickerMaxVisibleChars,
        } : {}; })(),
      },
      bundles: bundles.map((bundle, index) => ({
        ...bundle,
        qaFailures: diagnoseTitlePair(bundle, { topic, capability: getCapabilityFallback(card), content }),
        originalPosition: index + 1,
        selectorScore: artifact.data.titleStageTrace?.selectorInputs?.find(item => item.id === bundle.id)?.score,
      })),
      recommendedBundleId: artifact.data.recommendedBundleId,
      selectedBundleId: artifact.data.selectedBundleId,
      selectedOriginalPosition: artifact.data.titleStageTrace?.selectedOriginalPosition,
      trace: artifact.data.titleStageTrace,
      warnings: artifact.warnings,
      usage: artifact.usage,
      elapsedMs: Date.now() - started,
    });
  } catch (error) {
    rows.push({ jobId: job.id, referenceCardId: job.reference_card_id, status: 'failed', error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started });
  }
  await fs.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), batchId, model: process.env.AI_MODEL || 'configured-by-ai-client', rows }, null, 2), 'utf8');
  console.log(`[title-regression] ${job.id} ${rows.at(-1)?.status || 'success'} ${Math.round((Date.now() - started) / 1000)}s`);
}
console.log(`[title-regression] wrote ${outputPath}`);
