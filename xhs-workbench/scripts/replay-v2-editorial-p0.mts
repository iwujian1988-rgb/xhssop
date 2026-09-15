import { readFileSync } from 'node:fs';
import { normalizeRepairPatch, mergeContentPlanPatch, parseExpandContentPlans, validateExpandContentPlan } from '../src/lib/v2/batch-editorial-plan';

const report = JSON.parse(readFileSync('.tmp-mother-topic-real-result.json', 'utf8')) as any;
const traces = report.repairTraces as any[];
const find = (jobId: string, blockIndex: number) => traces.find(item => item.jobId === jobId && item.blockIndex === blockIndex);

function replayPatch(jobId: string, blockIndex: number) {
  const trace = find(jobId, blockIndex);
  if (!trace) return { jobId, blockIndex, status: 'MISSING_TRACE' };
  const last = trace.repairAttempts.at(-1);
  const patch = normalizeRepairPatch(last.rawModelResponse.plan);
  const merged = mergeContentPlanPatch(trace.initial.normalizedBlock, patch, trace.initial.validation.missingRequirements);
  const normalized = parseExpandContentPlans([merged])[0]!;
  const validation = validateExpandContentPlan(normalized, trace.initial.rawModelResponse.valueType, trace.initial.rawModelResponse.topic, trace.initial.rawModelResponse.specificAsset);
  return { jobId, blockIndex, patch, normalized, validation, status: validation.valid ? 'PASS' : 'FAIL' };
}

function replayComparisonAggregation() {
  const trace = find('batch_resource_04_chalkboard_phrase_list_1', 1);
  if (!trace) return { status: 'MISSING_TRACE' };
  const rawTask = trace.initial.rawModelResponse;
  const plans = parseExpandContentPlans(rawTask.expandContentPlans);
  const blockResults = plans.map(plan => validateExpandContentPlan(plan, 'comparison', rawTask.topic, rawTask.specificAsset));
  return { blockResults, status: blockResults.every(item => item.valid) ? 'PASS' : 'FAIL' };
}

const result = {
  replayCase1: replayPatch('batch_resource_03_chalkboard_course_2', 1),
  replayCase2: replayPatch('batch_resource_04_chalkboard_phrase_list_2', 1),
  replayCase3: replayComparisonAggregation(),
};
console.log(JSON.stringify(result, null, 2));
