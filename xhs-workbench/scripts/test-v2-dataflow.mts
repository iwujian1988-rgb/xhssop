import assert from 'node:assert/strict';

import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { coverTemplateSpecs, getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { compileCover } from '../src/lib/v2/pipeline';
import { countVisibleUnits, type ContentBlock } from '../src/lib/v2/contracts';

let cases = 0;
for (const card of competitorCreativeCards.filter(item => item.supported)) {
  const capability = getCapabilityFallback(card);
  assert.equal(capability.renderer, card.renderer_id);
  assert.ok(capability.densityTiers.length === 3);

  for (const tier of capability.densityTiers) {
    const sectionCount = tier.sectionRange[1];
    const itemCount = tier.itemRange[1];
    const blocks = makeBlocks(capability.acceptedBlockKinds[0], sectionCount, itemCount, capability.languagePolicy === 'primary_french', tier.secondaryVisualLength[1] > 0);
    const compiled = compileCover(capability, blocks);
    const spec = getCoverTemplateSpec(capability.renderer)!;
    const visibleTotal = compiled.sections.reduce((sum, section) => sum + section.items.length, 0);
    assert.ok(compiled.sections.length >= (spec.sectionRange?.[0] || 1), `${card.id}/${tier.id}: section underflow`);
    assert.ok(visibleTotal <= (spec.maxTotalItems || visibleTotal), `${card.id}/${tier.id}: measured total capacity exceeded`);
    assert.ok(compiled.sections.every(section => section.items.length > 0), `${card.id}/${tier.id}: empty section leaked`);
    assert.ok(compiled.sections.every(section => section.items.every(item => !item.primary.endsWith('…'))), `${card.id}/${tier.id}: compiler truncated text`);
    cases += 1;
  }

  const compact = capability.densityTiers[0];
  const overflowBlocks = makeBlocks(
    capability.acceptedBlockKinds[0],
    compact.sectionRange[0],
    compact.itemRange[0] + 1,
    capability.languagePolicy === 'primary_french',
    compact.secondaryVisualLength[1] > 0,
  );
  const longValue = '这是一条故意超过封面视觉容量、必须完整移动到内页而不能被截断的解释文字'.repeat(4);
  overflowBlocks[0].items[0].primary = longValue;
  const overflow = compileCover(capability, overflowBlocks);
  assert.ok(overflow.overflow.some(item => item.item.primary === longValue), `${card.id}: long item was not preserved`);
  assert.ok(!overflow.sections.some(section => section.items.some(item => item.primary.includes(longValue.slice(0, 10)))), `${card.id}: long item leaked into cover`);
  cases += 1;
}

const supportedCards = competitorCreativeCards.filter(item => item.supported);
const supportedRenderers = new Set(supportedCards.map(item => item.renderer_id));
assert.equal(supportedCards.length, 31, '当前参考卡总数变更时需人工确认新增卡已进入回归');
assert.equal(supportedRenderers.size, Object.keys(coverTemplateSpecs).length, '每套可用渲染模板都必须有规格并进入回归');
assert.equal(countVisibleUnits('DELF B2写作，考前7天查这张表'), 17);
console.log(JSON.stringify({ ok: true, cards: supportedCards.length, templates: supportedRenderers.size, density_cases: cases, visible_unit_rule: 'grapheme' }, null, 2));

function makeBlocks(kind: ContentBlock['kind'], sections: number, items: number, frenchPrimary: boolean, includeSecondary = true): ContentBlock[] {
  return Array.from({ length: sections }, (_, sectionIndex) => ({
    id: `block_${sectionIndex + 1}`,
    kind,
    heading: `第${sectionIndex + 1}组`,
    priority: (sectionIndex < 2 ? 1 : sectionIndex < 4 ? 2 : 3) as 1 | 2 | 3,
    sourceMode: sectionIndex % 2 ? 'general_advice' : 'ai_example',
    sourceIds: [],
    items: Array.from({ length: items }, (_, itemIndex) => ({
      primary: frenchPrimary ? `en premier lieu ${sectionIndex + 1}-${itemIndex + 1}` : `知识点${sectionIndex + 1}-${itemIndex + 1}`,
      ...(includeSecondary ? { secondary: `简短解释${itemIndex + 1}` } : {}),
    })),
  }));
}
