/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence } from '@/lib/product-fact-retrieval';
import {
  auditContentPackage,
  auditWholeNoteEditorialPackage,
  generateContentPackage,
  generateFinalCaptionAndBridge,
  generateFinalCoverBlocks,
} from '@/lib/v2/content-stage';
import { buildLockedProductionBrief } from '@/lib/v2/content-brief';
import { getCapabilityFallback } from '@/lib/v2/topic-stage';
import type { TopicOption } from '@/lib/v2/contracts';
import type { MigratedTopic } from '@/types/reference-workflow';

const fixtureRoot = 'data/full-commercial-content-test/full_commercial_content_test_1788504233326';
const request = JSON.parse(await fs.readFile(`${fixtureRoot}/note_1_request.json`, 'utf8'));
const card = getCompetitorCreativeCard(request.reference_card_id);
if (!card) throw new Error(`找不到参考卡 ${request.reference_card_id}`);
const migrated = request.topic as MigratedTopic & { v2_topic?: TopicOption };
if (!migrated.v2_topic) throw new Error('A Topic 缺少 v2_topic');
const topic = structuredClone(migrated.v2_topic);
topic.productionBrief = buildLockedProductionBrief(topic);
const capability = getCapabilityFallback(card);
const facts = await loadProductFacts('delf_b2_writing');
const evidence = await resolveProductEvidence('delf_b2_writing', facts, migrated, 12);
const contentInput = { topic, capability, evidence };

console.error('[final-page-responsibility-a] FINAL PAGE CONTENT');
const generated = await generateContentPackage(contentInput);
console.error('[final-page-responsibility-a] WHOLE NOTE EDITORIAL');
const editorial = await auditWholeNoteEditorialPackage(generated, { topic });
console.error('[final-page-responsibility-a] CAPTION / BRIDGE / TAGS');
const captioned = await generateFinalCaptionAndBridge(editorial, contentInput);
console.error('[final-page-responsibility-a] COVER BLOCKS');
const covered = await generateFinalCoverBlocks(captioned, contentInput);
console.error('[final-page-responsibility-a] FINAL TEACHING QA');
const audited = await auditContentPackage(covered, { topic, evidence });

const traceRoot = 'data/final-content-traces';
const contentTraceDir = `${traceRoot}/${generated.request_id}`;
const requestTrace = JSON.parse(await fs.readFile(`${contentTraceDir}/00_REQUEST_PAYLOAD.json`, 'utf8'));
const rawTrace = JSON.parse(await fs.readFile(`${contentTraceDir}/01_PROVIDER_RAW.json`, 'utf8'));
const parsedTrace = JSON.parse(await fs.readFile(`${contentTraceDir}/02_PARSED_JSON.json`, 'utf8'));
const normalizedTrace = JSON.parse(await fs.readFile(`${contentTraceDir}/03_NORMALIZED_PAGES.json`, 'utf8'));
const captionTrace = JSON.parse(await fs.readFile(`${traceRoot}/${captioned.request_id}/10_FINAL_CAPTION_BRIDGE_TAGS.json`, 'utf8'));
const coverTrace = JSON.parse(await fs.readFile(`${traceRoot}/${covered.request_id}/20_FINAL_COVER_BLOCKS.json`, 'utf8'));

const parsed = parsedTrace.parsedJson && typeof parsedTrace.parsedJson === 'object'
  ? parsedTrace.parsedJson as Record<string, unknown>
  : {};
const report = {
  generatedAt: new Date().toISOString(),
  topic: topic.topic,
  finalPageContent: {
    requestId: generated.request_id,
    model: requestTrace.model,
    systemPrompt: requestTrace.systemPrompt,
    userPayloadTopLevelKeys: Object.keys(requestTrace.userPayload || {}),
    userPayload: requestTrace.userPayload,
    rawResponse: rawTrace.messageContent,
    parsedJson: parsedTrace.parsedJson,
    rawTopLevelKeys: Object.keys(parsed),
    normalizedPages: normalizedTrace.pages,
    finalInnerPagesAfterEditorialAndQa: audited.data.innerPages,
  },
  captionBridgeTags: captionTrace,
  coverBlocks: coverTrace,
  finalTeachingQa: {
    requestId: audited.data.finalTeachingQa?.requestId,
    status: audited.data.finalTeachingQa?.status,
    inputSnapshotHash: audited.data.finalTeachingQa?.inputSnapshotHash,
    visibleSegmentPaths: [
      ...audited.data.coverBlocks.flatMap((block, blockIndex) => block.items.flatMap((_, itemIndex) => [
        `coverBlocks[${blockIndex}].items[${itemIndex}].primary`,
        `coverBlocks[${blockIndex}].items[${itemIndex}].secondary`,
        `coverBlocks[${blockIndex}].items[${itemIndex}].note`,
      ])),
      ...audited.data.innerPages.flatMap((page, pageIndex) => [
        `innerPages[${pageIndex}].page_title`,
        `innerPages[${pageIndex}].lead`,
        ...page.bullets.map((_, bulletIndex) => `innerPages[${pageIndex}].bullets[${bulletIndex}]`),
      ]),
      'captionParts.opening',
      ...audited.data.captionParts.value.map((_, index) => `captionParts.value[${index}]`),
      'captionParts.productBridge',
      'captionParts.cta',
      'bridgePlan.freeSolves',
      'bridgePlan.userStillNeeds',
      'bridgePlan.whyProduct',
      'bridgePlan.naturalCta',
    ],
    finalTeachingQa: audited.data.finalTeachingQa,
  },
  authoritativeArtifact: audited,
  compileSourceProof: {
    compiledInnerPagesSource: 'content.innerPages',
    compiledCoverBlocksSource: 'content.coverBlocks',
    compiledCaptionSource: 'content.captionParts',
    compiledBridgeSource: 'content.bridgePlan',
    compiledTagSource: 'content.tagMaterial (through buildV2Tags/prebuiltTags; fallback uses this field)',
  },
};

const output = 'data/final-page-responsibility-a/result.json';
await fs.mkdir('data/final-page-responsibility-a', { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  output,
  requestIds: {
    finalPageContent: generated.request_id,
    captionBridgeTags: captioned.request_id,
    coverBlocks: covered.request_id,
    finalTeachingQa: audited.data.finalTeachingQa?.requestId,
  },
  rawTopLevelKeys: Object.keys(parsed),
  pages: audited.data.innerPages.length,
  coverBlocks: audited.data.coverBlocks.length,
  qa: audited.data.finalTeachingQa?.status,
}, null, 2));
