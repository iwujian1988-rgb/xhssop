import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { resolveProductEvidenceByIds } from '../src/lib/product-fact-retrieval';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { inspectForPublish } from '../src/lib/v2/publish-guard';
import { diagnoseTopicOption, getCapabilityFallback } from '../src/lib/v2/topic-stage';

const jobsDir = path.join('data', 'batches', 'batch_1787012587691', 'jobs');

async function loadJob(id: string) {
  return JSON.parse(await fs.readFile(path.join(jobsDir, `${id}.json`), 'utf8')) as any;
}

async function inspectJob(id: string) {
  const job = await loadJob(id);
  const card = getCompetitorCreativeCard(job.reference_card_id);
  assert.ok(card, `${id}: missing card`);
  const facts = await loadProductFacts(job.product_id);
  const content = job.artifacts.content.data;
  const ids = Array.from(new Set<string>([
    ...content.factualClaims.flatMap((claim: any) => claim.sourceIds || []),
    ...content.coverBlocks.flatMap((block: any) => block.sourceIds || []),
    ...content.innerPages.flatMap((page: any) => page.source_ids || []),
  ]));
  const evidence = resolveProductEvidenceByIds(job.product_id, facts, ids);
  return inspectForPublish(content, {
    productId: job.product_id,
    topic: job.topic.v2_topic,
    capability: getCapabilityFallback(card),
    evidence,
  });
}

const registeredFiveTypes = await inspectJob('job_002');
assert.equal(
  registeredFiveTypes.hardIssues.some(item => item.code === 'risky_fact_not_registered'),
  false,
  JSON.stringify(registeredFiveTypes.hardIssues),
);

const mixedRegisteredFacts = await inspectJob('job_005');
assert.equal(
  mixedRegisteredFacts.hardIssues.some(item => item.code === 'risky_fact_not_registered'),
  false,
  JSON.stringify(mixedRegisteredFacts.hardIssues),
);

const experienceJob = await loadJob('job_004');
const experienceCard = getCompetitorCreativeCard(experienceJob.reference_card_id);
assert.ok(experienceCard);
const topicIssues = diagnoseTopicOption(experienceJob.topic.v2_topic, {
  productId: experienceJob.product_id,
  capability: getCapabilityFallback(experienceCard),
});
assert.ok(topicIssues.includes('cover_content_shape_mismatch'), JSON.stringify(topicIssues));

console.log(JSON.stringify({
  ok: true,
  job_002: registeredFiveTypes.hardIssues.map(item => item.code),
  job_004: topicIssues,
  job_005: mixedRegisteredFacts.hardIssues.map(item => item.code),
}, null, 2));
