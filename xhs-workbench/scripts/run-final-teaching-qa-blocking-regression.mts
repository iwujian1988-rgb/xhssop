/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import { auditContentPackage } from '@/lib/v2/content-stage';
import type { ContentPackage, VersionedArtifact } from '@/lib/v2/contracts';

const responsibility = JSON.parse(await fs.readFile('data/final-page-responsibility-a/result.json', 'utf8'));
const priorRegression = JSON.parse(await fs.readFile('data/inner-page-minimal-fix-regression/regression-result.json', 'utf8'));
const batchJob = JSON.parse(await fs.readFile('data/batches/batch_1788582332165/jobs/job_013.json', 'utf8'));
const baseArtifact = responsibility.authoritativeArtifact as VersionedArtifact<ContentPackage>;
const topic = batchJob.artifacts.selectedTopic.data;

function withoutPreviousQa(artifact: VersionedArtifact<ContentPackage>): VersionedArtifact<ContentPackage> {
  const next = structuredClone(artifact);
  delete next.data.finalTeachingQa;
  return next;
}

function changedLeafPaths(before: unknown, after: unknown, path = ''): string[] {
  if (Object.is(before, after)) return [];
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => (
      changedLeafPaths(before[index], after[index], `${path}[${index}]`)
    )).flat();
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    return [...keys].flatMap(key => changedLeafPaths(
      (before as Record<string, unknown>)[key],
      (after as Record<string, unknown>)[key],
      path ? `${path}.${key}` : key,
    ));
  }
  return [path || '$'];
}

const warningCase = withoutPreviousQa(baseArtifact);
const warningPages = priorRegression.cases.find((item: { id?: string }) => item.id === 'C_register_switch')?.finalInnerPages;
if (!Array.isArray(warningPages)) throw new Error('找不到 C_register_switch 真实内页快照');
warningCase.data.innerPages = structuredClone(warningPages);
const warningBefore = structuredClone(warningCase.data);
console.error('[qa-blocking-regression] TEST 1 WARNING ONLY');
const warningResult = await auditContentPackage(warningCase, { topic, evidence: [] });

const hardCase = withoutPreviousQa(baseArtifact);
const hardPage = hardCase.data.innerPages[4];
if (!hardPage) throw new Error('找不到历史 dégrorer 所在页面');
hardPage.bullets = hardPage.bullets.map(value => value.replaceAll('dégrader', 'dégrorer'));
hardPage.renderPayload = JSON.parse(JSON.stringify(hardPage.renderPayload).replaceAll('dégrader', 'dégrorer'));
const hardBefore = structuredClone(hardCase.data);
console.error('[qa-blocking-regression] TEST 2 REAL HARD BLOCK');
const hardResult = await auditContentPackage(hardCase, { topic: responsibility.authoritativeArtifact.data.topic || topic, evidence: [] });

const output = {
  generatedAt: new Date().toISOString(),
  model: process.env.OPENAI_MODEL || 'qwen3.7-flash',
  test1WarningOnly: {
    source: 'data/inner-page-minimal-fix-regression/regression-result.json#C_register_switch.finalInnerPages',
    blockingIssues: warningResult.data.finalTeachingQa?.blockingIssues || [],
    warnings: warningResult.data.finalTeachingQa?.warnings || [],
    approved: warningResult.data.finalTeachingQa?.approved,
    status: warningResult.data.finalTeachingQa?.status,
    unresolvedBlockingIssues: warningResult.data.finalTeachingQa?.unresolvedBlockingIssues || [],
    repairTriggered: Boolean(warningResult.data.finalTeachingQa?.appliedPatches.length),
    appliedPatches: warningResult.data.finalTeachingQa?.appliedPatches || [],
    visibleContentChanges: changedLeafPaths(warningBefore, warningResult.data).filter(path => !path.startsWith('finalTeachingQa') && path !== 'frenchSegments'),
  },
  test2RealHardBlock: {
    source: 'data/final-page-responsibility-a/result.json recorded historical dégrorer issue at innerPages[4].bullets[1] and renderPayload.data[1].content',
    beforeOccurrences: JSON.stringify(hardBefore).match(/dégrorer/gu)?.length || 0,
    bulletAfterRepair: hardResult.data.innerPages[4]?.bullets[1] || '',
    renderPayloadContainsDegrorer: JSON.stringify(hardResult.data.innerPages[4]?.renderPayload || null).includes('dégrorer'),
    renderPayloadStatus: hardResult.data.innerPages[4]?.renderPayloadStatus,
    finalBlockingIssues: hardResult.data.finalTeachingQa?.blockingIssues || [],
    warnings: hardResult.data.finalTeachingQa?.warnings || [],
    approved: hardResult.data.finalTeachingQa?.approved,
    status: hardResult.data.finalTeachingQa?.status,
    unresolvedBlockingIssues: hardResult.data.finalTeachingQa?.unresolvedBlockingIssues || [],
    repairTriggered: Boolean(hardResult.data.finalTeachingQa?.appliedPatches.length),
    corrections: hardResult.data.finalTeachingQa?.corrections || [],
    appliedPatches: hardResult.data.finalTeachingQa?.appliedPatches || [],
    visibleContentChanges: changedLeafPaths(hardBefore, hardResult.data).filter(path => !path.startsWith('finalTeachingQa') && path !== 'frenchSegments'),
  },
};

const outputPath = 'data/final-teaching-qa-blocking-regression/result.json';
await fs.mkdir('data/final-teaching-qa-blocking-regression', { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({ outputPath, ...output }, null, 2));
