import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd();
const temp=await fs.mkdtemp(path.join(root,'.tmp-auto-cover-plan-'));
process.env.INNER_REVIEW_TEST_DATA_DIR=temp;
process.env.OPENAI_API_KEY='OFFLINE_TEST_NOT_A_KEY';
process.env.OPENAI_BASE_URL='https://offline-test.invalid/v1';
delete process.env.AI_BRIDGE_DIR;
const require=createRequire(import.meta.url);
const dictionaryPath=require.resolve('dictionary-fr');
require.cache[dictionaryPath]={id:dictionaryPath,filename:dictionaryPath,loaded:true,
  exports:{get aff(){throw new Error('UNEXPECTED_LEGACY_SPELLCHECK');},get dic(){throw new Error('UNEXPECTED_LEGACY_SPELLCHECK');}}} as NodeModule;
const {POST}=require('../src/app/api/batch/route');
const {loadAllJobs}=require('../src/lib/batch-store');
const {standardCreativeCards}=require('../src/lib/creative-card-library');
let calls=0;
const counts:number[]=[];
let simulateIncomplete=false;
let incompleteCall=0;
globalThis.fetch=async (_url,init)=>{
  calls++;
  const req=JSON.parse(String(init?.body));
  assert.equal(req.model,'qwen3.8-max-0902');
  const payload=JSON.parse(req.messages[1].content);
  assert.ok(Number.isInteger(payload.count));
  assert.ok(!('coverTemplate' in payload));
  assert.equal(payload.scopePlan.length,payload.count);
  assert.ok(payload.scopePlan.every((s:any)=>s.coverageDomain&&s.coreProblem&&s.minimumCoverage&&s.userAngle&&s.promiseDeliveryHint));
  assert.ok(payload.scopePlan.every((s:any)=>!('scope' in s)&&!('intent' in s)&&!('domainFamily' in s)&&!('deliveryAngle' in s)));
  assert.equal(new Set(payload.scopePlan.map((s:any)=>s.coreProblem)).size,payload.scopePlan.length);
  assert.match(req.messages[0].content,/minimumCoverage是不可缩小的范围下限/);
  assert.match(req.messages[0].content,/最多5个内页/);
  assert.match(req.messages[0].content,/自然、具体、普通人能直接读懂/);
  assert.match(req.messages[0].content,/promiseDeliveryHint只允许影响promise/);
  assert.match(req.messages[0].content,/topic只用自然、具体/);
  assert.ok(!/mega_asset|broad_asset|每10篇|topic负责点击理由|3分钟搞懂|直接拿走/.test(req.messages[0].content));
  assert.ok(!req.messages[0].content.includes('提供/整理＋哪些场景或主题＋几组材料＋完整应用及中文说明'));
  counts.push(payload.count);
  let outputCount=payload.count;
  if(simulateIncomplete){incompleteCall++;outputCount=incompleteCall===1?Math.max(1,payload.count-3):payload.count;}
  const topics=Array.from({length:outputCount},(_,i)=>({topic:`离线选题${i+1}`,audienceState:'练习写作',painOrDesire:'需要表达材料',promise:'提供场景表达和中文说明'}));
  return new Response(JSON.stringify({id:`mock-${calls}`,choices:[{message:{content:JSON.stringify({topics})}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{status:200});
};
const post=(extra:object)=>POST(new Request('http://offline/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'plan',product_id:'delf_b2_writing',content_mode:'standard',knowledge_mode:'educational_original',...extra})}));
for(const job_count of [1,3,10,20]){
  const response=await post({job_count,card_ids:standardCreativeCards.map((c:any)=>c.id),topics_per_card:3});
  assert.equal(response.status,200);const json=await response.json();
  const jobs=await loadAllJobs(json.batch.id);assert.equal(jobs.length,job_count);
  const expectedScopes=Array.from({length:job_count},(_,index)=>payloadScope(index));
  assert.deepEqual(jobs.map((job:any)=>job.topic.v2_topic.topicGranularity),expectedScopes);
  assert.ok(jobs.every((job:any)=>job.topic.v2_topic.topicAssignment?.coverageDomain));
  assert.ok(jobs.every((job:any)=>job.topic.v2_topic.topicAssignment?.coreProblem));
  assert.deepEqual(jobs.map((job:any)=>job.topic.scope_level),expectedScopes.map(scope=>scope==='level_3_micro'?'narrow':'broad'));
  assert.deepEqual(jobs.map((job:any)=>job.topic.v2_topic.topicLane),expectedScopes.map(scope=>scope==='level_1_asset'?'broad_pain':scope==='level_2_strategy'?'result_need':'narrow_knowledge'));
  assert.equal(counts.at(-1),job_count);
}
simulateIncomplete=true;incompleteCall=0;
const beforeRecovery=calls;
const recovered=await post({job_count:10,card_ids:standardCreativeCards.map((c:any)=>c.id),topics_per_card:3});
assert.equal(recovered.status,200);const recoveredJson=await recovered.json();
assert.equal((await loadAllJobs(recoveredJson.batch.id)).length,10);
assert.equal(calls-beforeRecovery,2);
assert.deepEqual(counts.slice(-2),[10,3]);
simulateIncomplete=false;
const beforeInvalid=calls;
for(const job_count of [0,21,-1,1.5,'2',null])assert.equal((await post({job_count})).status,400);
assert.equal((await post({})).status,400);
assert.equal((await post({product_id:'tef_tcf_canada',job_count:1})).status,400);
assert.equal((await post({content_mode:'product_showcase',job_count:1})).status,400);
assert.equal(calls,beforeInvalid);
const card=standardCreativeCards.find((c:any)=>c.supported);
const legacy=await post({card_ids:[card.id],topics_per_card:2});
assert.equal(legacy.status,200);
assert.equal((await loadAllJobs((await legacy.json()).batch.id)).length,2);
assert.deepEqual(counts,[1,3,10,20,10,3,2]);
console.log(`PASS: explicit count creates 1/3/10/20 jobs; incomplete 10=>7 is recovered by one missing-only call for 3; 10=>6/4/0 and 20=>12/8/0 persisted; invalid counts fail before model; legacy input still supported. REAL_AI_CALLS=0; isolated=${temp}`);

function payloadScope(index:number){
  const cycle=['level_1_asset','level_1_asset','level_2_strategy','level_1_asset','level_2_strategy','level_1_asset','level_1_asset','level_2_strategy','level_1_asset','level_2_strategy','level_1_asset','level_1_asset','level_2_strategy','level_1_asset','level_2_strategy','level_1_asset','level_1_asset','level_2_strategy','level_1_asset','level_2_strategy'];
  return cycle[index%cycle.length];
}
