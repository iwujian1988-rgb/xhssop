import assert from 'node:assert/strict';
import { buildProductTopicScopePlan } from '../src/lib/v2/product-topic-scope-plan';
import { resolvePipelineFeatures } from '../src/lib/v2/pipeline-features';

const product2Tef = buildProductTopicScopePlan('tef_tcf_canada', 'tef_canada', 'large', 10);
assert.equal(product2Tef.length, 10);
assert.equal(new Set(product2Tef.map(item => item.domainId)).size, 10);
assert.ok(product2Tef.every(item => item.demand.situation && item.demand.trigger && item.demand.frustration && item.demand.desiredOutcome && item.demand.lossIfIgnored && item.demand.searchLanguage.length));
assert.ok(product2Tef.every(item => item.demand.id && item.demand.examScope === 'tef_canada' && item.demand.motherDomain && item.demand.demandArchetype));
assert.ok(product2Tef.every(item => !/TCF Canada写作三项任务|DELF B2/u.test(`${item.coverageDomain} ${item.coreProblem}`)));

const product2Tcf = buildProductTopicScopePlan('tef_tcf_canada', 'tcf_canada', 'large', 10);
assert.equal(product2Tcf.length, 10);
assert.ok(product2Tcf.every(item => !/TEF Canada写作两项任务|DELF B2/u.test(`${item.coverageDomain} ${item.coreProblem}`)));
assert.ok(product2Tcf.every(item => item.demand.situation && item.demand.trigger && item.demand.frustration && item.demand.desiredOutcome && item.demand.lossIfIgnored && item.demand.searchLanguage.length));
assert.ok(product2Tcf.every(item => item.demand.id && item.demand.examScope === 'tcf_canada' && item.demand.motherDomain && item.demand.demandArchetype));
const byId = new Map(product2Tcf.map(item => [item.domainId, item]));
const fullPrep = byId.get('tcf_full_prep')!.demand;
const goal = byId.get('tcf_goal')!.demand;
const schedule = byId.get('tcf_schedule')!.demand;
assert.notEqual(fullPrep.desiredOutcome, goal.desiredOutcome);
assert.notEqual(goal.trigger, schedule.trigger);
assert.notEqual(fullPrep.frustration, schedule.frustration);

// Case A: With three planning/decision cards already covered, a one-slot
// refill must choose an unmet user situation rather than another plan card.
const noMorePlanning = buildProductTopicScopePlan(
  'tef_tcf_canada', 'tcf_canada', 'large', 1, [],
  ['TIME_PRESSURE', 'DIAGNOSIS_UNKNOWN', 'PERFORMANCE_ANXIETY'],
  ['TIME_PRESSURE', 'DIAGNOSIS_UNKNOWN', 'PERFORMANCE_ANXIETY'],
);
assert.ok(!['TIME_PRESSURE', 'DIAGNOSIS_UNKNOWN', 'PERFORMANCE_ANXIETY'].includes(noMorePlanning[0]!.demand.demandArchetype));

// Case B: A writing card may be selected after writing was covered, provided
// the unmet demand is genuinely different (knowledge retrieval, not task confusion).
const retrievalRefill = buildProductTopicScopePlan(
  'tef_tcf_canada', 'tcf_canada', 'large', 1, [], ['TASK_CONFUSION'], ['TASK_CONFUSION'],
);
assert.equal(retrievalRefill[0]!.demand.demandArchetype, 'MATERIAL_OVERLOAD');

// Case C: after two duplicate deletions, two replacement slots are drawn from
// unmet demand archetypes rather than from the missing subject list.
const replacements = buildProductTopicScopePlan(
  'tef_tcf_canada', 'tcf_canada', 'large', 2, [],
  ['OUTPUT_BLOCKED', 'TASK_CONFUSION', 'READING_LISTENING_STUCK'],
  ['OUTPUT_BLOCKED', 'TASK_CONFUSION', 'READING_LISTENING_STUCK'],
);
assert.equal(new Set(replacements.map(item => item.demand.demandArchetype)).size, 2);
assert.ok(replacements.every(item => !['OUTPUT_BLOCKED', 'TASK_CONFUSION', 'READING_LISTENING_STUCK'].includes(item.demand.demandArchetype)));

const product2Common = buildProductTopicScopePlan('tef_tcf_canada', 'common', 'large', 10);
assert.equal(product2Common.length, 10);
assert.equal(new Set(product2Common.map(item => item.domainId)).size, 10);

const product3 = buildProductTopicScopePlan('tcf_canada_writing_7day', 'tcf_canada', 'medium', 10);
assert.equal(product3.length, 10);
assert.ok(product3.every(item => /TCF Canada/u.test(`${item.coverageDomain} ${item.coreProblem}`)));
assert.ok(product3.every(item => !/TEF|DELF/u.test(`${item.coverageDomain} ${item.coreProblem}`)));

for (const productId of ['delf_b2_writing', 'tef_tcf_canada', 'tcf_canada_writing_7day'] as const) {
  const feature = resolvePipelineFeatures(productId);
  assert.equal(feature.pipelineVersion, 'consensus-v1');
  assert.equal(feature.consensusTopicStage, true);
  assert.equal(feature.consensusContentBrief, true);
  assert.equal(feature.consensusTitleStage, true);
}

console.log('product topic scope plan: ok');
