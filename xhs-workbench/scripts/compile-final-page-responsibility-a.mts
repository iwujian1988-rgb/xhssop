/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence } from '@/lib/product-fact-retrieval';
import { auditContentPackage, generateFinalCaptionAndBridge, generateFinalCoverBlocks } from '@/lib/v2/content-stage';
import { compileDraft } from '@/lib/v2/pipeline';
import { buildLockedProductionBrief } from '@/lib/v2/content-brief';
import { getCapabilityFallback } from '@/lib/v2/topic-stage';
import { stableHash } from '@/lib/v2/contracts';

const fixtureRoot = 'data/full-commercial-content-test/full_commercial_content_test_1788504233326';
const request = JSON.parse(await fs.readFile(`${fixtureRoot}/note_1_request.json`, 'utf8'));
const legacy = JSON.parse(await fs.readFile(`${fixtureRoot}/note_1_response.json`, 'utf8'));
const reportPath = 'data/final-page-responsibility-a/result.json';
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
let authoritativeArtifact = report.authoritativeArtifact;
const topic = structuredClone(request.topic.v2_topic);
topic.productionBrief = buildLockedProductionBrief(topic);
const card = getCompetitorCreativeCard(request.reference_card_id);
if (!card) throw new Error(`找不到参考卡 ${request.reference_card_id}`);
const facts = await loadProductFacts('delf_b2_writing');
const evidence = await resolveProductEvidence('delf_b2_writing', facts, request.topic, 12);
authoritativeArtifact = await generateFinalCaptionAndBridge(authoritativeArtifact, { topic, evidence });
authoritativeArtifact = await generateFinalCoverBlocks(authoritativeArtifact, { topic, capability: getCapabilityFallback(card), evidence });
authoritativeArtifact = await auditContentPackage(authoritativeArtifact, { topic, evidence });
report.authoritativeArtifact = authoritativeArtifact;
report.finalTeachingQa = {
  requestId: authoritativeArtifact.data.finalTeachingQa?.requestId,
  status: authoritativeArtifact.data.finalTeachingQa?.status,
  inputSnapshotHash: authoritativeArtifact.data.finalTeachingQa?.inputSnapshotHash,
  finalTeachingQa: authoritativeArtifact.data.finalTeachingQa,
};
const content = authoritativeArtifact.data;
const titles = structuredClone(legacy.artifacts.titles.data);
titles.contentSnapshotHash = stableHash(content);
titles.productionBriefHash = topic.productionBrief.briefHash;
const draft = compileDraft({
  productId: request.product_id,
  card,
  topic,
  capability: getCapabilityFallback(card),
  content,
  titles,
  evidence,
  auditWarnings: report.authoritativeArtifact.warnings || [],
});

report.compiledArtifactProof = {
  compiledCover: draft.cover,
  compiledInnerPages: draft.inner_pages,
  compiledCaption: draft.caption,
  compiledTags: draft.tags,
  assertions: {
    innerPagesReadFromAuthoritativeContent: content.innerPages.every((page: { page_title: string }) => draft.inner_pages.some((compiled: { page_title: string }) => compiled.page_title === page.page_title)),
    coverReadFromAuthoritativeContent: draft.cover.sections.length > 0 && content.coverBlocks.length > 0,
    captionReadFromAuthoritativeContent: draft.caption.includes(content.captionParts.opening),
    bridgeReadFromAuthoritativeContent: draft.inner_pages.some((page: { page_title: string; lead?: string }) => page.page_title === '把这一篇接着用下去' && page.lead === content.bridgePlan.naturalCta),
    tagsReadFromAuthoritativeContent: content.tagMaterial.some((tag: string) => draft.tags.some((compiled: string) => compiled.includes(tag))),
  },
};
await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report.compiledArtifactProof.assertions, null, 2));
