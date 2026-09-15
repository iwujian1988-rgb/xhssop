/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { diagnoseTitlePair } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const source = JSON.parse(await fs.readFile('v2-real-smoke-20260818-r2.json', 'utf8'));
const item = source.find((entry: any) => entry.product_id === 'delf_b2_writing');
const card = getCompetitorCreativeCard(item.reference_card_id);
const input = {
  topic: item.topic.v2_topic,
  capability: getCapabilityFallback(card!),
  content: item.artifacts.content.data,
};
const candidates = [
  {
    textTitle: 'DELF B2写作练了没底？',
    coverTitle: 'DELF B2写作5维自查',
    coverSubtitle: '一张表揪出你的最弱项',
    mechanism: '自查定位',
    userRelation: '练过几篇但心里没底的考生',
    seoKeyword: 'DELF B2写作自查',
    noveltyFingerprint: '自查表|定位短板',
  },
  {
    textTitle: 'DELF B2写作短板怎么找？',
    coverTitle: 'DELF B2写作短板36项查',
    coverSubtitle: '逐条核对，找到最弱维度',
    mechanism: '清单定位',
    userRelation: '不知道短板在哪里的考生',
    seoKeyword: 'DELF B2写作短板',
    noveltyFingerprint: '36项|定位短板',
  },
];
console.log(JSON.stringify(candidates.map(candidate => ({ candidate, failures: diagnoseTitlePair(candidate, input) })), null, 2));
