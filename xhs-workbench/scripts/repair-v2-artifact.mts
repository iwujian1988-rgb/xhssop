/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { auditContentPackage, repairContentPackage } from '../src/lib/v2/content-stage';
import { compileDraft } from '../src/lib/v2/pipeline';
import { inspectForPublish } from '../src/lib/v2/publish-guard';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

nextEnv.loadEnvConfig(process.cwd());

const sourcePath = process.env.TEST_SOURCE || 'v2-real-smoke-delf-20260818-r6.json';
const titlePath = process.env.TEST_TITLES || 'v2-title-stage-delf-20260818-r7.json';
const outputPath = process.env.TEST_OUTPUT || 'v2-repaired-artifact-latest.json';
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as Array<Record<string, any>>;
const item = source.find(entry => entry.artifacts?.content?.data && entry.topic?.v2_topic && entry.draft?.evidence);
if (!item) throw new Error(`没有在 ${sourcePath} 找到可修复的V2产物`);
const titles = JSON.parse(await fs.readFile(titlePath, 'utf8'));
const card = getCompetitorCreativeCard(item.reference_card_id);
if (!card) throw new Error(`找不到竞品创作卡：${item.reference_card_id}`);

const capability = getCapabilityFallback(card);
const input = {
  productId: item.product_id,
  topic: item.topic.v2_topic,
  capability,
  evidence: item.draft.evidence,
};
const initial = inspectForPublish(item.artifacts.content.data, input);
let repaired = initial.hardIssues.length
  ? await repairContentPackage(item.artifacts.content, {
      topic: input.topic,
      capability,
      evidence: input.evidence,
    }, initial.hardIssues)
  : { ...item.artifacts.content, data: initial.content, warnings: [...item.artifacts.content.warnings, ...initial.warnings] };
const frenchChanged = JSON.stringify(repaired.data.frenchSegments) !== JSON.stringify(item.artifacts.content.data.frenchSegments);
if (frenchChanged) repaired = await auditContentPackage(repaired, { topic: input.topic, evidence: input.evidence });
const finalInspection = inspectForPublish(repaired.data, input);
if (finalInspection.hardIssues.length) {
  console.error(JSON.stringify({ ok: false, issues: finalInspection.hardIssues }, null, 2));
  process.exitCode = 1;
} else {
  const draft = compileDraft({
    productId: item.product_id,
    card,
    topic: input.topic,
    capability,
    content: finalInspection.content,
    titles: titles.data,
    evidence: input.evidence,
    auditWarnings: finalInspection.warnings,
    prebuiltTags: item.draft.tags,
  });
  const result = {
    ok: true,
    source: sourcePath,
    repaired_content: repaired,
    title_artifact: titles,
    draft,
    warnings: finalInspection.warnings,
  };
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify({
    ok: true,
    title: draft.selected_title,
    cover: draft.cover.title,
    pages: draft.inner_pages.map(page => ({ title: page.page_title, bullets: page.bullets.length })),
    usage: repaired.usage,
    french_audit_ran: frenchChanged,
    output: outputPath,
  }, null, 2));
}
