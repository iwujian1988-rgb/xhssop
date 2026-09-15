/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { diagnoseTopicOption, getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { TopicOption } from '../src/lib/v2/contracts';

const file = process.argv[2] || 'v2-real-acceptance-composed.json';
const payload = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, any>;
const products = Array.isArray(payload.products) ? payload.products : [];
const results: Array<Record<string, unknown>> = [];

for (const product of products) {
  const jobs = product?.final?.batch?.jobs || [];
  for (const job of jobs) {
    const card = getCompetitorCreativeCard(job.reference_card_id);
    const topic = job?.topic?.v2_topic as TopicOption | undefined;
    if (!card || !topic) continue;
    const failures = diagnoseTopicOption(topic, { productId: product.id, capability: getCapabilityFallback(card) });
    results.push({ product: product.id, job: job.id, card: job.reference_card_id, topic: topic.topic, failures });
  }
}

console.log(JSON.stringify({
  file,
  total: results.length,
  rejected: results.filter(item => Array.isArray(item.failures) && item.failures.length > 0).length,
  results,
}, null, 2));
