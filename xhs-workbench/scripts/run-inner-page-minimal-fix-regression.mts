/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence } from '@/lib/product-fact-retrieval';
import { auditContentPackage, generateContentPackage } from '@/lib/v2/content-stage';
import { buildLockedProductionBrief } from '@/lib/v2/content-brief';
import { getCapabilityFallback } from '@/lib/v2/topic-stage';
import type { TopicOption } from '@/lib/v2/contracts';
import type { BatchJob } from '@/lib/batch-store';
import type { MigratedTopic } from '@/types/reference-workflow';

const fixtureRoot = 'data/full-commercial-content-test/full_commercial_content_test_1788504233326';
const note1 = JSON.parse(await fs.readFile(`${fixtureRoot}/note_1_request.json`, 'utf8'));
const note2 = JSON.parse(await fs.readFile(`${fixtureRoot}/note_2_request.json`, 'utf8'));
const source13 = JSON.parse(await fs.readFile('data/batches/batch_1788582332165/jobs/job_013.json', 'utf8')) as BatchJob;

const cases = [
  { id: 'A_argument_bank', request: note1 },
  { id: 'B_b1_vs_b2', request: note2 },
  {
    id: 'C_register_switch',
    request: {
      product_id: source13.product_id,
      reference_card_id: source13.reference_card_id,
      topic: {
        ...source13.topic,
        v2_topic: source13.artifacts?.selectedTopic?.data,
      },
    },
  },
] as const;

const facts = await loadProductFacts('delf_b2_writing');
const report: Record<string, unknown> = {
  generatedAt: new Date().toISOString(),
  model: process.env.OPENAI_MODEL || 'qwen3.7-flash',
  promptPatch: 'INNER_PAGE_CONTENT_MINIMAL_FIX',
  cases: [],
};

for (const item of cases) {
  const card = getCompetitorCreativeCard(item.request.reference_card_id);
  if (!card) throw new Error(`${item.id}: 找不到参考卡 ${item.request.reference_card_id}`);
  const migrated = item.request.topic as MigratedTopic & { v2_topic?: TopicOption };
  if (!migrated.v2_topic) throw new Error(`${item.id}: 缺少v2_topic`);
  const topic = structuredClone(migrated.v2_topic);
  topic.productionBrief = buildLockedProductionBrief(topic);
  const capability = getCapabilityFallback(card);
  const evidence = await resolveProductEvidence('delf_b2_writing', facts, migrated, 12);
  console.error(`[inner-page-minimal-fix] START ${item.id}`);
  try {
    const generated = await generateContentPackage({ topic, capability, evidence });
    const audited = await auditContentPackage(generated, { topic, evidence });
    (report.cases as Array<Record<string, unknown>>).push({
      id: item.id,
      finalPublicTopic: topic.topic,
      motherTopic: topic.batchEditorialTask?.lockedMotherTopic || topic.topic,
      referenceCardId: item.request.reference_card_id,
      pagePlanRequestId: generated.data.pagePlan?.length ? 'included-in-generateContentPackage-usage' : null,
      finalContentRequestId: generated.request_id,
      finalTeachingQaRequestId: audited.data.finalTeachingQa?.requestId || audited.request_id,
      canonicalPagePlan: generated.data.pagePlan,
      finalInnerPages: audited.data.innerPages,
      finalTeachingQa: audited.data.finalTeachingQa,
      generatedWarnings: generated.warnings,
      auditedWarnings: audited.warnings,
      generatedUsage: generated.usage,
      auditedUsage: audited.usage,
    });
    console.error(`[inner-page-minimal-fix] DONE ${item.id} pages=${audited.data.innerPages.length} qa=${audited.data.finalTeachingQa?.status}`);
  } catch (error) {
    (report.cases as Array<Record<string, unknown>>).push({
      id: item.id,
      status: 'FAILED',
      error: error instanceof Error ? error.stack || error.message : String(error),
    });
    console.error(`[inner-page-minimal-fix] FAIL ${item.id} ${String(error)}`);
  }
}

const output = '.tmp-inner-page-minimal-fix-regression.json';
await fs.writeFile(output, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ output, cases: (report.cases as unknown[]).length }, null, 2));
