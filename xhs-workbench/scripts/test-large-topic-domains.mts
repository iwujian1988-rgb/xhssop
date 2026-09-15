import nextEnv from '@next/env';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,open} from 'node:fs/promises';
import {buildProductionTopicScopePlan,checkAssignedLargeScope} from '../src/lib/v2/topic-value';
import {generateTopicOptions,getCapabilityFallback,topicOptionToMigrated} from '../src/lib/v2/topic-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {loadProductFacts} from '../src/lib/product-facts-loader';
nextEnv.loadEnvConfig(process.cwd());
const live=process.argv.includes('--live');
const dir='data/topic-large-domain-v5';
await mkdir(dir,{recursive:true});
if(live){
  // 预算锁永久保留；同一轮重启也不得重复调用。不是生产工作流锁。
  const lock=await open(dir+'/LIVE_CALL_STARTED.lock','wx');await lock.writeFile(new Date().toISOString());await lock.close();
}
const plan=buildProductionTopicScopePlan('large',20);
assert.equal(new Set(plan.map(p=>p.coverageDomain)).size,20);
assert.equal(new Set(plan.map(p=>p.coreProblem)).size,20);
assert.ok(plan.every(p=>p.requiredMotherTopics.length>=4));
assert.notEqual(buildProductionTopicScopePlan('large',10,[plan[0].domainId])[0].domainId,plan[0].domainId);
assert.ok(buildProductionTopicScopePlan('medium',10).every(p=>!p.coverageDomain));
const source=JSON.parse(await readFile('data/batches/batch_1789001441643/batch.json','utf8'));
const history=source.jobs.map((j:any)=>j.topic.topic);
for(const i of [4,6,9]){
  const t=source.jobs[i].topic;
  const check=checkAssignedLargeScope(t.topic,t.content_promise,plan[0].requiredMotherTopics);
  assert.equal(check.passed,true);assert.ok(check.warnings.length);
}
const priorProvider=JSON.parse(await readFile('data/topic-large-domain-v4/live-provider.json','utf8'));
const priorTopics=JSON.parse(priorProvider.choices[0].message.content).topics;
for(const i of [2,6,7,9]) assert.equal(checkAssignedLargeScope(priorTopics[i].topic,priorTopics[i].promise,plan[i].requiredMotherTopics).passed,true);
const microExamples=['B2写作开头怎么写','B2作文结尾怎么写','par exemple怎么用','B2写作：Cordialement的用法','单一句型的用法','只讲一个语法点的用法','单一段落怎么写','单一具体题目解析'];
for(const text of microExamples) assert.equal(checkAssignedLargeScope(text,'',plan[0].requiredMotherTopics).passed,false,text);
for(const text of ['B2写作开头、正文、结尾怎么组织','B2写作考前复习包括时间分配和自查','B2写作语法、词汇与语域怎么准备','B2写作题型：正式信、议论文、论坛帖','B2写作需要哪些语言知识']) assert.equal(checkAssignedLargeScope(text,'',plan[0].requiredMotherTopics).passed,true,text);
const card=getCompetitorCreativeCard('resource_01_grammar_parchment_red')!;
const facts=await loadProductFacts('delf_b2_writing');
const nativeFetch=globalThis.fetch;let calls=0;let broken=false;let replay=false;
globalThis.fetch=async(url,init)=>{
  calls++;assert.ok(calls<=(live?1:3),'No extra model request allowed');
  const body=JSON.parse(String(init?.body));const payload=JSON.parse(body.messages[1].content);
  assert.equal(body.model,'qwen3.8-max-0902');assert.equal(body.temperature,0.85);
  assert.equal(payload.scopePlan.length,10);
  assert.equal(new Set(payload.scopePlan.map((p:any)=>p.coverageDomain)).size,10);
  assert.deepEqual(payload.avoidTopics,[]);assert.ok(!('recentTopics' in payload));
  assert.ok(!JSON.stringify(body).includes('mega_asset'));assert.ok(!JSON.stringify(body).includes('broad_asset'));
  assert.ok(!JSON.stringify(body).includes('自我诊断与迭代修正系统'));
  assert.ok(body.messages[0].content.includes('禁止学习、模仿、延续'));
  assert.ok(body.messages[0].content.includes('只用于promise，不据此命名topic'));
  assert.ok(body.messages[0].content.includes('子模块移入promise'));
  await writeFile(dir+(live?'/live':'/offline')+'-request.json',JSON.stringify(body,null,2));
  if(live){const res=await nativeFetch(url,init);await writeFile(dir+'/live-provider.json',await res.clone().text());return res;}
  const topics=replay?structuredClone(priorTopics):plan.slice(0,10).map((p,i)=>({topic:p.coverageDomain,audienceState:'备考者'+i,painOrDesire:p.coreProblem,promise:p.requiredMotherTopics.map(s=>s.split('/')[0]).join('、')}));
  if(broken) topics[0]={...topics[0],topic:'B2写作：par exemple怎么用'};
  return new Response(JSON.stringify({id:'offline',choices:[{message:{content:JSON.stringify({topics})}}],usage:{}}),{headers:{'Content-Type':'application/json'}});
};
const input={productId:'delf_b2_writing' as const,card,capability:getCapabilityFallback(card),facts,contentMode:'standard' as const,topicScope:'large' as const,limit:10,recentAngles:history,avoidTopics:[],direction:'AI自由教育内容：只围绕法语考试知识自由选题，不介绍商品、资料包或购买承接。'};
try {
  const result=await generateTopicOptions(input);
  await writeFile(dir+(live?'/live':'/offline')+'-result.json',JSON.stringify(result,null,2));
  for(const topic of result.data){
    assert.equal(topic.topicAssignment?.actualGranularity,'unverified');assert.equal(topic.topicGranularity,undefined);
    assert.equal(topic.topicAssignment?.scopeValidation,'passed');
    const migrated=topicOptionToMigrated(topic);assert.equal(migrated.topic,topic.topic);assert.equal(migrated.content_promise,topic.promise);
  }
  if(!live){
    assert.equal(result.data.length,10);broken=true;
    const rejected=await generateTopicOptions(input);assert.equal(rejected.data.length,9);
    assert.ok(rejected.warnings?.some(w=>w.includes('EXPLICIT_MICRO_TOPIC')));
    broken=false;replay=true;
    const replayed=await generateTopicOptions(input);assert.equal(replayed.data.length,10);
    assert.deepEqual(replayed.data.map(t=>t.topic),priorTopics.map((t:any)=>t.topic));
    await writeFile(dir+'/offline-replay-result.json',JSON.stringify(replayed,null,2));
    console.log('OFFLINE PASS: old false rejects 4/4 accepted; 8 micro examples rejected; 5 broad/cross-module examples accepted; old raw 10/10 survives production filtering');
  }
  console.log(JSON.stringify({live,calls,usage:result.usage,accepted:result.data.length,warnings:result.warnings,topics:result.data.map(t=>({slot:t.topicAssignment?.slot,domain:t.topicAssignment?.coverageDomain,topic:t.topic,promise:t.promise}))},null,2));
}catch(error){await writeFile(dir+(live?'/live':'/offline')+'-error.json',JSON.stringify({error:String(error),calls},null,2));throw error;}
