/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { inspectForPublish } from '../src/lib/v2/publish-guard';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const sources = process.env.TEST_SOURCE
  ? [process.env.TEST_SOURCE]
  : [
      'v2-real-smoke-latest.json',
      'v2-real-smoke-tef-publishable.json',
    ];
const results: Array<Record<string, unknown>> = [];
for (const sourcePath of sources) {
  const source = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as Array<Record<string, any>>;
  for (const item of source) {
    if (!item.artifacts?.content?.data || !item.topic?.v2_topic) continue;
    const card = getCompetitorCreativeCard(item.reference_card_id);
    if (!card) continue;
    const evidence = item.draft?.evidence || item.artifacts?.compiledDraft?.data?.evidence || [];
    const inspected = inspectForPublish(item.artifacts.content.data, {
      productId: item.product_id,
      topic: item.topic.v2_topic,
      capability: getCapabilityFallback(card),
      evidence,
    });
    results.push({
      source: sourcePath,
      product: item.product_id,
      title: item.draft?.selected_title,
      hard_issues: inspected.hardIssues,
      warnings: inspected.warnings,
    });
  }
}

console.log(JSON.stringify({ ok: true, reviewed: results.length, results }, null, 2));
