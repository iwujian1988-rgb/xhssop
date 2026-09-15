import assert from 'node:assert/strict';

import { buildBatchTopicSlotDirection, claimBatchTopicSlot } from '../src/lib/v2/batch-topic-portfolio';

const used: string[] = [];
const slots = Array.from({ length: 25 }, () => {
  const slot = claimBatchTopicSlot({ productId: 'delf_b2_writing', usedSlotIds: used });
  assert.ok(slot, '25 张封面都有可分配的内容母题');
  used.push(slot.id);
  return slot;
});

assert.equal(new Set(used).size, 25, '25 张封面先占用 25 个不同内容母题');
const instruction = buildBatchTopicSlotDirection(slots[0]!, '用户补充方向');
assert.ok(instruction.includes('【本批唯一内容母题｜'), '方向字符串带批量母题标记');
assert.ok(instruction.includes('不得借用其他母题'), '方向字符串禁止回退到其他热点');
assert.equal(claimBatchTopicSlot({ productId: 'tef_tcf_canada', usedSlotIds: [] }), undefined, '非 DELF 商品保持原路径');

console.log('batch topic portfolio: PASS');
