import assert from 'node:assert/strict';
import type { CompetitorCreativeCard, ContentShape, CreativeCardRenderer } from '../src/types/reference-workflow';
import type { TemplateCapability } from '../src/lib/v2/contracts';
import { matchTopicCoordinatesToCoverSlots, type CoverCapabilitySlot } from '../src/lib/v2/cover-topic-matcher';
import { coordinateHash, type TopicContentType, type TopicCoordinate, type TopicScale } from '../src/lib/v2/topic-coordinate-taxonomy';

function coordinate(id: string, contentType: TopicContentType, scale: TopicScale): TopicCoordinate {
  const index = Number(id.replace(/\D/g, '')) || 1;
  const objectIds = ['prompt', 'outline', 'argument', 'example', 'paragraph', 'connector'] as const;
  const base = {
    domainId: 'task_decoding' as const,
    problemId: 'misread_instruction' as const,
    objectId: objectIds[(index - 1) % objectIds.length]!,
    mechanismId: 'instruction_matrix' as const,
    sceneId: (index % 2 ? 'daily_practice' : 'exam_room') as 'daily_practice' | 'exam_room',
  };
  return { coordinateId: id, ...base, scale, contentType, problemNote: `问题${id}`, outcomeNote: `结果${id}`, coordinateHash: coordinateHash(base) };
}

function slot(slotId: string, family: ContentShape, renderer: CreativeCardRenderer, supported = true): CoverCapabilitySlot {
  const card: CompetitorCreativeCard = {
    id: `card-${slotId}`, name: slotId, reference_image: '', renderer_id: renderer,
    content_mechanism: '', click_mechanism: '', visual_mechanism: '', suitable_audiences: [],
    suitable_pains: [], required_payload: [], forbidden_uses: [], density: 'high', supported,
  };
  const capability: TemplateCapability = {
    renderer, family, compiler: 'directory', renderMode: 'code', allowedGoals: ['save'],
    acceptedBlockKinds: ['group'], allowedTitleMechanisms: [],
    densityTiers: [{ id: 'normal', sectionRange: [1, 1], itemRange: [1, 1], primaryVisualLength: [1, 20], secondaryVisualLength: [0, 20] }],
    languagePolicy: 'mixed',
  };
  return { slotId, card, capability };
}

const coordinates = [
  coordinate('coord-1', 'pain', 'broad'),
  coordinate('coord-2', 'reference', 'specific'),
  coordinate('coord-3', 'guide', 'strategy'),
  coordinate('coord-4', 'summary', 'reference'),
];
const slots = [
  slot('pain-slot', 'pain', 'pain_quote_big'),
  slot('table-slot', 'table', 'vocab_table'),
  slot('roadmap-slot', 'roadmap', 'course_roadmap'),
  slot('directory-slot', 'directory', 'white_green_directory'),
];
const before = JSON.stringify(coordinates);
const result = matchTopicCoordinatesToCoverSlots(coordinates, slots);

assert.equal(result.matches.length, 4, '每个封面名额都有且只有一个匹配');
assert.equal(new Set(result.matches.map(item => item.slotId)).size, 4, '每个名额恰好使用一次');
assert.equal(new Set(result.matches.map(item => item.coordinateId)).size, 4, '每个坐标恰好使用一次');
assert.deepEqual(result.matches.map(item => item.coordinateId), ['coord-1', 'coord-2', 'coord-3', 'coord-4'], '内容类型与规模优先匹配对应 family');
assert.equal(JSON.stringify(coordinates), before, '匹配不得修改锁定坐标');
for (const match of result.matches) {
  const original = coordinates.find(item => item.coordinateId === match.coordinateId);
  assert.equal(match.coordinate, original, '返回原始锁定坐标对象，不克隆或改写');
  assert.equal(match.coordinateHash, original?.coordinateHash, '坐标哈希原样贯穿匹配');
}
assert.deepEqual(matchTopicCoordinatesToCoverSlots(coordinates, slots).matches.map(item => item.coordinateId), result.matches.map(item => item.coordinateId), '相同输入得到确定性结果');

const warningSlots = [
  slot('unsupported', 'pain', 'pain_quote_big', false),
  slot('weak-fit', 'phrase', 'blackboard_phrase'),
];
warningSlots[1]!.card.renderer_id = 'white_green_directory';
const warnings = matchTopicCoordinatesToCoverSlots([
  coordinate('coord-5', 'pain', 'broad'),
  coordinate('coord-6', 'pain', 'broad'),
], warningSlots).warnings;
assert.ok(warnings.some(item => item.code === 'unsupported_card'), '不可用 card 返回可见 warning，但不丢名额');
assert.ok(warnings.some(item => item.code === 'renderer_mismatch'), 'card/capability renderer 不一致时返回 warning');
assert.ok(warnings.some(item => item.code === 'weak_content_type_fit'), '内容类型弱适配返回 warning');
assert.ok(warnings.some(item => item.code === 'weak_scale_fit'), '规模弱适配返回 warning');

assert.throws(() => matchTopicCoordinatesToCoverSlots(coordinates.slice(0, 1), slots.slice(0, 2)), /数量.*不一致/, '数量不一致时拒绝产生半批匹配');
assert.throws(() => matchTopicCoordinatesToCoverSlots(coordinates.slice(0, 2), [slots[0]!, { ...slots[1]!, slotId: slots[0]!.slotId }]), /重复 slotId/, '重复名额ID时拒绝匹配');
assert.throws(() => matchTopicCoordinatesToCoverSlots([coordinates[0]!, { ...coordinates[1]!, coordinateHash: coordinates[0]!.coordinateHash }], slots.slice(0, 2)), /重复 coordinateHash/, '重复锁定坐标时拒绝匹配');

console.log('test-v2-cover-topic-matcher passed');
