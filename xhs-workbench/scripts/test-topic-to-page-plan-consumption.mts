import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const root=process.cwd();
const temp=await fs.mkdtemp(path.join(root,'.tmp-topic-plan-consumption-'));
process.env.OPENAI_API_KEY='OFFLINE_TEST_NOT_A_KEY';
process.env.OPENAI_BASE_URL='https://offline-test.invalid/v1';
delete process.env.AI_BRIDGE_DIR;
const require=createRequire(import.meta.url);
const dictionaryPath=require.resolve('dictionary-fr');
require.cache[dictionaryPath]={id:dictionaryPath,filename:dictionaryPath,loaded:true,exports:{}} as NodeModule;
const {generateTopicOptions,getCapabilityFallback,topicOptionToMigrated,migratedToTopicOption}=require('../src/lib/v2/topic-stage');
const {generateStandardKnowledgePagePlan}=require('../src/lib/v2/content-stage');
const {buildLockedProductionBrief}=require('../src/lib/v2/content-brief');
const {getCompetitorCreativeCard}=require('../src/lib/creative-card-library');
const card=getCompetitorCreativeCard('resource_01_grammar_parchment_red');assert.ok(card);
const capability=getCapabilityFallback(card);
const facts={};
let call=0;const planInputs:any[]=[];
globalThis.fetch=async(_url,init)=>{
  call++;const body=JSON.parse(String(init?.body));const user=JSON.parse(body.messages[1].content);
  if(user.scopePlan){
    assert.equal(body.model,'qwen3.8-max-0902');
    assert.equal(user.count,10);
    const topics=Array.from({length:10},(_,i)=>({
      topic:`离线范围选题${i+1}`,audienceState:'正在练习DELF B2写作',painOrDesire:'需要可以直接使用的写作材料',promise:`交付第${i+1}项可复用资料及一份代表性应用`,
    }));
    return response({topics},'topic-consumption');
  }
  assert.equal(body.model,'qwen3.8-max-0902');
  assert.deepEqual(Object.keys(user).sort(),['finalPublicTopic','promise']);planInputs.push(user);
  return response({pages:[{pageId:'p1',pageGoal:'交付核心资料',userGets:'可复用内容',pageContentPlan:['完整材料','简短中文说明']}]},`plan-consumption-${planInputs.length}`);
};
function response(data:any,id:string){return new Response(JSON.stringify({id,choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{status:200,headers:{'content-type':'application/json','x-request-id':id}});}
process.chdir(temp);
try{
  const generated=await generateTopicOptions({productId:'delf_b2_writing',card,capability,facts,contentMode:'standard',limit:10,topicMode:'batch'});
  assert.equal(generated.data.length,10);
  const scopes=generated.data.map((t:any)=>t.topicGranularity);
  assert.deepEqual(['level_1_asset','level_2_strategy','level_3_micro'].map(scope=>scopes.filter((x:string)=>x===scope).length),[6,4,0]);
  for(const original of generated.data){
    const migrated=topicOptionToMigrated(original);
    const restored=migratedToTopicOption(JSON.parse(JSON.stringify(migrated)),'delf_b2_writing',card);
    assert.equal(restored.topicGranularity,original.topicGranularity);
    assert.equal(restored.topicLane,original.topicLane);
    assert.deepEqual(restored.topicAssignment,original.topicAssignment);
    assert.ok(restored.topicAssignment?.coverageDomain);
    assert.equal(migrated.scope_level,original.topicGranularity==='level_3_micro'?'narrow':'broad');
    restored.productionBrief=buildLockedProductionBrief(restored);
    const plan=await generateStandardKnowledgePagePlan({topic:restored,capability,evidence:[]});
    assert.equal(plan.data.length,1);assert.equal(plan.data[0].pageContentPlan,'完整材料；简短中文说明');
  }
  assert.equal(planInputs.length,10);assert.equal(call,11);
  assert.deepEqual(planInputs,generated.data.map((t:any)=>({finalPublicTopic:t.topic,promise:t.promise})));
  await fs.writeFile('result.json',JSON.stringify({scopes,lanes:generated.data.map((t:any)=>t.topicLane),planInputs,calls:call,realAiCalls:0},null,2));
  console.log(`PASS: 10 Topic -> migrated JSON round-trip -> production Page Plan; 6/4/0 preserved; Page Plan received only finalPublicTopic+promise. REAL_AI_CALLS=0; ${temp}`);
}finally{process.chdir(root);}
