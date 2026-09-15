import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { generateContentPackage, generateStandardKnowledgePagePlan } from '../src/lib/v2/content-stage';

nextEnv.loadEnvConfig(process.cwd());
assert.ok(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is required for this real validation.');
assert.ok(!process.env.AI_BRIDGE_DIR, 'Real configured provider required.');

const batchId = 'batch_1788838821341';
const requestedJobIds = process.argv.slice(2).filter(value => /^job_\d+$/u.test(value));
const jobIds = requestedJobIds.length ? requestedJobIds : ['job_001', 'job_002', 'job_005', 'job_006'];
const output = path.resolve('data', 'page-plan-capacity-real-validation', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, { recursive: true });
const results: any[] = [];
let firstRealPlan: any;
let firstInput: any;

for (const jobId of jobIds) {
  const job = JSON.parse(await fs.readFile(path.join('data', 'batches', batchId, 'jobs', `${jobId}.json`), 'utf8'));
  const topic = structuredClone(job.artifacts.selectedTopic.data);
  const card = getCompetitorCreativeCard(job.reference_card_id);
  assert.ok(card, `${jobId}: missing card`);
  const capability = getCapabilityFallback(card);
  const started = Date.now();
  try {
    const plan = await generateStandardKnowledgePagePlan({ topic, capability, evidence: [] });
    const record = {
      jobId,
      status: 'PASS',
      topic: topic.topic,
      promise: topic.promise,
      pages: plan.data,
      pageCount: plan.data.length,
      pageContentPlanTypes: plan.data.map((page: any) => typeof page.pageContentPlan),
      fieldLengths: plan.data.map((page: any) => ({
        pageId: page.pageId,
        pageGoal: page.pageGoal.length,
        userGets: page.userGets.length,
        pageContentPlan: page.pageContentPlan.length,
      })),
      warnings: plan.warnings,
      usage: plan.usage,
      requestId: plan.request_id,
      elapsedMs: Date.now() - started,
    };
    results.push(record);
    await fs.writeFile(path.join(output, `${jobId}-page-plan.json`), `${JSON.stringify(record, null, 2)}\n`);
    if (!firstRealPlan) {
      firstRealPlan = plan;
      firstInput = { topic, capability, evidence: [] };
    }
  } catch (error) {
    const failure = {
      jobId,
      status: 'FAIL',
      message: error instanceof Error ? error.message : String(error),
      usage: (error as any)?.usage,
      elapsedMs: Date.now() - started,
    };
    results.push(failure);
    await fs.writeFile(path.join(output, `${jobId}-page-plan-failure.json`), `${JSON.stringify(failure, null, 2)}\n`);
  }
}

let innerValidation: any = { status: 'SKIPPED', reason: 'NO_REAL_PLAN_AVAILABLE' };
if (firstRealPlan && firstInput) {
  const nativeFetch = globalThis.fetch;
  let reusedPlan = false;
  let realInnerCalls = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    const stage = body?.metadata?.stage || '';
    const system = String(body?.messages?.[0]?.content || '');
    const isPagePlan = stage === 'page_plan' || system.startsWith('你只分配每页交付的资产');
    if (isPagePlan) {
      assert.equal(reusedPlan, false, 'Page Plan should be injected once.');
      reusedPlan = true;
      return new Response(JSON.stringify({
        id: 'reused-real-page-plan',
        choices: [{ message: { content: JSON.stringify({ pages: firstRealPlan.data }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'reused-real-page-plan' } });
    }
    if (system.startsWith('根据topic的finalPublicTopic')) realInnerCalls += 1;
    return nativeFetch(url, init);
  };
  try {
    const content = await generateContentPackage(firstInput);
    innerValidation = {
      status: 'PASS',
      sourceJobId: results.find(item => item.status === 'PASS')?.jobId,
      reusedExactRealPlan: reusedPlan,
      realInnerCalls,
      innerPageCount: content.data.innerPages.length,
      consumedPagePlan: content.data.pagePlan,
      innerPages: content.data.innerPages,
      usage: content.usage,
      requestId: content.request_id,
    };
  } catch (error) {
    innerValidation = {
      status: 'FAIL', reusedExactRealPlan: reusedPlan, realInnerCalls,
      message: error instanceof Error ? error.message : String(error),
      usage: (error as any)?.usage,
    };
  } finally {
    globalThis.fetch = nativeFetch;
  }
  await fs.writeFile(path.join(output, 'inner-consumption.json'), `${JSON.stringify(innerValidation, null, 2)}\n`);
}

const summary = {
  batchId,
  output,
  pagePlanCallsExpected: jobIds.length,
  pagePlanPassCount: results.filter(item => item.status === 'PASS').length,
  pagePlanFailureCount: results.filter(item => item.status === 'FAIL').length,
  allPlansAtMostFive: results.filter(item => item.status === 'PASS').every(item => item.pageCount <= 5),
  allFinalPageContentPlansStrings: results.filter(item => item.status === 'PASS').every(item => item.pageContentPlanTypes.every((type: string) => type === 'string')),
  innerValidation,
  results,
};
await fs.writeFile(path.join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({
  output,
  pagePlanPassCount: summary.pagePlanPassCount,
  pagePlanFailureCount: summary.pagePlanFailureCount,
  allPlansAtMostFive: summary.allPlansAtMostFive,
  allFinalPageContentPlansStrings: summary.allFinalPageContentPlansStrings,
  innerStatus: innerValidation.status,
  realInnerCalls: innerValidation.realInnerCalls,
  innerPageCount: innerValidation.innerPageCount,
}, null, 2));
