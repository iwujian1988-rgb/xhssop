import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { resolveProductEvidenceByIds } from '../src/lib/product-fact-retrieval';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { inspectForPublish, isReleaseBlockingIssue } from '../src/lib/v2/publish-guard';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const batchId = process.env.TEST_BATCH_ID || 'batch_1787034927680';
const jobsDir = path.join('data', 'batches', batchId, 'jobs');
const names = (await fs.readdir(jobsDir)).filter(name => /^job_\d+\.json$/.test(name)).sort();
const results: Array<{ id: string; previous: string; hardIssues: string[]; bridge: string; warnings: number }> = [];

for (const name of names) {
  const job = JSON.parse(await fs.readFile(path.join(jobsDir, name), 'utf8')) as any;
  assert.ok(job.artifacts?.content?.data, `${name}: missing content artifact`);
  const card = getCompetitorCreativeCard(job.reference_card_id);
  assert.ok(card, `${name}: missing reference card`);
  const content = job.artifacts.content.data;
  const facts = await loadProductFacts(job.product_id);
  const ids = Array.from(new Set<string>([
    ...content.factualClaims.flatMap((claim: any) => claim.sourceIds || []),
    ...content.coverBlocks.flatMap((block: any) => block.sourceIds || []),
    ...content.innerPages.flatMap((page: any) => page.source_ids || []),
  ]));
  const evidence = resolveProductEvidenceByIds(job.product_id, facts, ids);
  const inspected = inspectForPublish(content, {
    productId: job.product_id,
    topic: job.topic.v2_topic,
    capability: getCapabilityFallback(card),
    evidence,
  });
  const releaseBlocking = inspected.hardIssues.filter(isReleaseBlockingIssue);
  const stricterHistoricalCodes = new Set([
  'unsupported_exam_fact',
  'unsupported_learning_number',
    'risky_fact_not_registered',
    'invalid_claim_still_public',
    'fabricated_personal_experience',
    // 本轮将 plain_experience 从 70-110 字长段落收紧为 28-52 字的信息流可读判断，
    // 历史产物被新视觉契约标记为过长是预期行为，新产物由密度发布闸门硬拦。
    'cover_density_below_contract',
    'cover_group_underfilled',
  ]);
  assert.equal(
    releaseBlocking.every(issue => stricterHistoricalCodes.has(issue.code)),
    true,
    `${job.id}: 历史产物只允许因本轮收紧的事实/经历规则被识别，不得出现其他新回归 ${JSON.stringify(inspected.hardIssues)}`,
  );
  results.push({
    id: job.id,
    previous: job.failure?.message || 'success',
    hardIssues: inspected.hardIssues.map(item => `${item.code}@${item.path || ''}: ${item.message}`),
    bridge: inspected.content.captionParts.productBridge,
    warnings: inspected.warnings.length,
  });
}

console.log(JSON.stringify({ batchId, results }, null, 2));
