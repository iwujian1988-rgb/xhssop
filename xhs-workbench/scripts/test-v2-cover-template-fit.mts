import assert from 'node:assert/strict';

import {
  coverTemplateSpecs,
  getCoverTemplatePrompt,
  type CoverTemplateSpec,
} from '../src/lib/cover-template-specs';
import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { compileCover } from '../src/lib/v2/pipeline';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentBlock } from '../src/lib/v2/contracts';

let compiledCases = 0;

for (const card of competitorCreativeCards.filter(item => item.supported)) {
  const spec = coverTemplateSpecs[card.renderer_id as keyof typeof coverTemplateSpecs] as CoverTemplateSpec | undefined;
  assert(spec, `${card.id}: supported template must have a visual contract`);

  const sections = spec.sectionRange || [spec.sectionCount, spec.sectionCount];
  const items = spec.itemRange || [spec.itemsPerSection, spec.itemsPerSection];
  assert(sections[0] >= 1 && sections[0] <= sections[1], `${card.id}: invalid section range`);
  assert(items[0] >= 1 && items[0] <= items[1], `${card.id}: invalid item range`);
  assert(spec.minTotalItems >= sections[0], `${card.id}: total minimum cannot be below section minimum`);
  assert((spec.maxTotalItems || Number.POSITIVE_INFINITY) >= spec.minTotalItems, `${card.id}: invalid total range`);

  const prompt = getCoverTemplatePrompt(card.renderer_id);
  assert(prompt.includes('视觉实测容量'), `${card.id}: prompt must identify measured visual capacity`);
  assert(prompt.includes('各组不必等量'), `${card.id}: prompt must allow uneven groups`);
  assert(!/必须输出\d+组，每组\d+条/.test(prompt), `${card.id}: old rigid equal-group contract leaked into prompt`);

  const capability = getCapabilityFallback(card);
  const blocks = makeUnevenBlocks(
    capability.acceptedBlockKinds[0],
    sections[1],
    items[0],
    items[1],
    capability.languagePolicy === 'primary_french',
    spec.maxSecondaryVisualLength > 0,
  );
  if (spec.notePartCount) {
    for (const block of blocks) for (const item of block.items) {
      item.note = Array.from({length:spec.notePartCount},(_,index)=>`支项${index + 1}`).join('｜');
    }
  }
  const inputItems = blocks.reduce((sum, block) => sum + block.items.length, 0);
  const compiled = compileCover(capability, blocks);
  const visibleItems = compiled.sections.reduce((sum, section) => sum + section.items.length, 0);

  assert(visibleItems <= (spec.maxTotalItems || inputItems), `${card.id}: compiled cover exceeds measured total capacity`);
  assert.equal(visibleItems + compiled.overflow.length, inputItems, `${card.id}: overflow must preserve every complete item`);
  assert(compiled.sections.every(section => section.items.every(item => !item.primary.endsWith('…'))), `${card.id}: compiler must not truncate copy`);
  compiledCases += 1;
}

const official = coverTemplateSpecs.official_notice;
const pain = coverTemplateSpecs.pain_quote_big;
const showcase = coverTemplateSpecs.showcase_screenshot;
assert(coverTemplateSpecs.parchment_dense_directory.minTotalItems >= 22, 'parchment directory must retain reference-like density');
assert(coverTemplateSpecs.white_green_directory.minTotalItems >= 24, 'white-green directory must retain reference-like density');
assert(coverTemplateSpecs.clean_purple_directory.minTotalItems >= 20, 'clean purple directory must retain reference-like density');
assert(coverTemplateSpecs.grid_purple_directory.minTotalItems >= 24, 'grid purple directory must retain reference-like density');
assert(coverTemplateSpecs.blackboard_phrase.minTotalItems >= 18, 'phrase board must retain reference-like density');
assert(coverTemplateSpecs.collocation_dense.minTotalItems >= 36, 'collocation sheet must retain reference-like density');
assert.equal(official.renderMode, 'image_to_image', 'official notice must use the generated blank reference bitmap and image workflow');
assert.equal(pain.renderMode, 'code', 'pain quote uses deterministic feed typography');
assert.deepEqual(showcase.sectionRange, [1, 1], 'knowledge-base showcase has one visual proof slot');
assert.equal(showcase.maxTotalItems, 1, 'knowledge-base showcase must not become a tiny text list');

console.log(JSON.stringify({ ok: true, compiled_cases: compiledCases }, null, 2));

function makeUnevenBlocks(kind: ContentBlock['kind'], sectionCount: number, minItems: number, maxItems: number, frenchPrimary: boolean, includeSecondary: boolean): ContentBlock[] {
  return Array.from({ length: sectionCount }, (_, sectionIndex) => {
    const itemCount = Math.max(minItems, maxItems - (sectionIndex % 3));
    return {
      id: `block_${sectionIndex + 1}`,
      kind,
      heading: `第${sectionIndex + 1}组`,
      priority: (sectionIndex < 2 ? 1 : sectionIndex < 4 ? 2 : 3) as 1 | 2 | 3,
      sourceMode: 'general_advice' as const,
      sourceIds: [],
      items: Array.from({ length: itemCount }, (_, itemIndex) => ({
        primary: frenchPrimary ? `expression ${sectionIndex + 1}-${itemIndex + 1}` : `知识点${sectionIndex + 1}-${itemIndex + 1}`,
        ...(includeSecondary ? { secondary: `解释${itemIndex + 1}` } : {}),
      })),
    };
  });
}
