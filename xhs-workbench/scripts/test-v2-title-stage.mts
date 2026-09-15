/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { generateTitlePackage } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentPackage, TopicOption } from '../src/lib/v2/contracts';

nextEnv.loadEnvConfig(process.cwd());

const sourcePath = process.env.TEST_SOURCE || 'v2-real-smoke-tef-publishable.json';
const outputPath = process.env.TEST_OUTPUT || 'v2-title-stage-latest.json';
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as Array<Record<string, any>>;
const item = source.find(entry => entry.artifacts?.content?.data && entry.topic?.v2_topic);
if (!item) throw new Error(`没有在 ${sourcePath} 找到可复用的V2内容产物`);

const card = getCompetitorCreativeCard(item.reference_card_id);
if (!card) throw new Error(`找不到竞品创作卡：${item.reference_card_id}`);

const result = await generateTitlePackage({
  topic: item.topic.v2_topic as TopicOption,
  capability: getCapabilityFallback(card),
  content: item.artifacts.content.data as ContentPackage,
});

await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({
  ok: true,
  selected: result.data.selected,
  candidate_count: result.data.candidates.length,
  usage: result.usage,
  output: outputPath,
}, null, 2));
