import assert from 'node:assert/strict';
import { buildTopicScopeAssignments, demandTypeForBatchIndex, granularityForBatchIndex, megaCoverageDomainForOrdinal, scopeIntentForBatchIndex, valueTypeForBatchIndex, TOPIC_VALUE_TYPES, valueTypeIsCompatibleWithAsset, MEGA_TOPIC_COVERAGE_DOMAINS } from '../src/lib/v2/topic-value';

const values = Array.from({ length: 20 }, (_, index) => valueTypeForBatchIndex(index));
assert.equal(values.length, 20);
assert.equal(new Set(values).size, 10, '20个名额应覆盖10种内容价值类型');
assert.equal(values.filter(item => item === 'usable_list' || item === 'collection').length, 6, '清单/整理在20条中应有约30%');
assert.equal(values.filter(item => item === 'shortcut' || item === 'exam_rescue').length, 4, '捷径/急救在20条中至少应有4条');
assert(valueTypeIsCompatibleWithAsset('usable_list', '8个可以直接使用的法语表达'));
assert(valueTypeIsCompatibleWithAsset('comparison', '一组普通写法与B2写法对照'));
assert(!valueTypeIsCompatibleWithAsset('shortcut', '提升综合能力'));
assert.deepEqual([...new Set(values)].sort(), [...TOPIC_VALUE_TYPES].sort());
const granularities = Array.from({ length: 20 }, (_, index) => granularityForBatchIndex(index));
assert.equal(granularities.filter(item => item === 'level_1_asset').length, 12);
assert.equal(granularities.filter(item => item === 'level_2_strategy').length, 8);
assert.equal(granularities.filter(item => item === 'level_3_micro').length, 0);
const firstTen = granularities.slice(0, 10);
assert.deepEqual(['level_1_asset','level_2_strategy','level_3_micro'].map(scope=>firstTen.filter(item=>item===scope).length),[6,4,0]);
const firstTenIntents = Array.from({ length: 10 }, (_, index) => scopeIntentForBatchIndex(index));
assert.deepEqual(['mega_asset','broad_problem','broad_asset'].map(intent=>firstTenIntents.filter(item=>item===intent).length),[4,2,4]);
for (let index = 0; index < 20; index += 1) {
  if (granularityForBatchIndex(index) === 'level_2_strategy') assert.equal(scopeIntentForBatchIndex(index), 'broad_asset');
  else assert.notEqual(scopeIntentForBatchIndex(index), 'broad_asset', 'level_2才应使用broad_asset');
}
const rotationA = Array.from({ length: 4 }, (_, index) => megaCoverageDomainForOrdinal(index, 0, 10));
const rotationB = Array.from({ length: 4 }, (_, index) => megaCoverageDomainForOrdinal(index, 1, 10));
assert.equal(new Set(rotationA).size, 4);
assert.equal(new Set(rotationB).size, 4);
assert.equal(rotationA.filter(item => rotationB.includes(item)).length, 0, '相邻10篇批次应轮换到不同超大领域');
assert.ok(MEGA_TOPIC_COVERAGE_DOMAINS.every(item => !/单独审题|时间分配|范文拆解/.test(item)), 'Mega池不能混入单项任务');
for (const rotationIndex of [0, 1, 2, 17, 126]) {
  const dealt = buildTopicScopeAssignments(10, rotationIndex);
  assert.equal(dealt.length, 10);
  assert.deepEqual(['mega_asset','broad_problem','broad_asset'].map(intent => dealt.filter(item => item.intent === intent).length), [4,2,4]);
  assert.ok(dealt.every(item => item.coverageDomain && item.domainFamily && item.coreProblem && item.minimumCoverage && item.userAngle && item.deliveryAngle));
  assert.equal(new Set(dealt.map(item => item.domainFamily)).size, 10, `rotation ${rotationIndex} 同批内容家族不得碰撞`);
  assert.equal(new Set(dealt.map(item => item.coreProblem)).size, 10, `rotation ${rotationIndex} 同批核心问题不得碰撞`);
  assert.ok(dealt.filter(item => item.intent === 'mega_asset').every(item => /至少覆盖|至少3/.test(item.minimumCoverage)));
}
const dealtA = buildTopicScopeAssignments(10, 0);
const dealtB = buildTopicScopeAssignments(10, 1);
assert.notDeepEqual(dealtA.map(item => item.coverageDomain), dealtB.map(item => item.coverageDomain), '相邻批次必须轮换领域');
const dealtTwenty = buildTopicScopeAssignments(20, 3);
assert.equal(dealtTwenty.length, 20);
assert.equal(new Set(dealtTwenty.map(item=>item.coreProblem)).size,20,'20篇必须共用核心问题去重历史');
assert.ok(new Set(dealtTwenty.map(item=>item.domainFamily)).size>=16,'领域家族应全批次优先错开，允许不同问题复用同一领域');
assert.deepEqual(['mega_asset','broad_problem','broad_asset'].map(intent=>dealtTwenty.filter(item=>item.intent===intent).length),[8,4,8]);
assert.equal(new Set(Array.from({ length: 20 }, (_, index) => demandTypeForBatchIndex(index))).size, 7);
console.log('test-v2-topic-value passed', JSON.stringify({ count: values.length, distribution: Object.fromEntries(TOPIC_VALUE_TYPES.map(key => [key, values.filter(item => item === key).length])) }));
