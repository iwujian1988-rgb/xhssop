/* eslint-disable no-console */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { compileDraft } from '../src/lib/v2/pipeline';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const source = JSON.parse(await fs.readFile('v2-real-smoke-20260818-r2.json', 'utf8'));
const item = source.find((entry: any) => entry.product_id === 'delf_b2_writing');
const titleArtifact = JSON.parse(await fs.readFile('v2-title-stage-delf-20260818-r6.json', 'utf8'));
const card = getCompetitorCreativeCard(item.reference_card_id);
assert(card);
const draft = compileDraft({
  productId: 'delf_b2_writing',
  card,
  topic: item.topic.v2_topic,
  capability: getCapabilityFallback(card),
  content: item.artifacts.content.data,
  titles: titleArtifact.data,
  evidence: item.draft.evidence,
  auditWarnings: [],
});
assert(draft.cover.sections.length >= 4);
assert(draft.cover.sections.filter(section => section.items.length >= 3).length >= 2);
console.log(JSON.stringify({
  ok: true,
  title: draft.selected_title,
  coverTitle: draft.cover.title,
  sections: draft.cover.sections.map(section => ({ heading: section.heading, items: section.items.length })),
  innerPages: draft.inner_pages.length,
}, null, 2));
