import nextEnv from '@next/env';
import {mkdir,readFile,writeFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {generateTopicOptions,getCapabilityFallback,topicOptionToMigrated} from '../src/lib/v2/topic-stage';
import {buildProductionTopicScopePlan} from '../src/lib/v2/topic-value';
import {listBatches} from '../src/lib/batch-store';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {loadProductFacts} from '../src/lib/product-facts-loader';
nextEnv.loadEnvConfig(process.cwd());
const dir='data/topic-medium-production-audit-v1';
await mkdir(dir,{recursive:true});
const lock=await open(dir+'/LIVE_CALL_STARTED.lock','wx');await lock.writeFile(new Date().toISOString());await lock.close();
const frozen=['src/lib/v2/topic-stage.ts','src/lib/v2/topic-value.ts','src/app/api/batch/route.ts','src/lib/v2/contracts.ts','src/lib/v2/pipeline.ts'];
const hashes=async()=>Object.fromEntries(await Promise.all(frozen.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
const before=await hashes();
const batches=(await listBatches({recentLimit:20})).filter(b=>b.product_id==='delf_b2_writing' && b.content_mode==='standard').sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,5);
const jobs=batches.flatMap(b=>b.jobs);
const recentAngles=jobs.map(j=>j.topic.topic).slice(0,30).reverse();
const avoidTopics=jobs.map(j=>j.topic.topic).slice(0,30);
const slots=buildProductionTopicScopePlan('medium',20);
assert.ok(slots.every(s=>!s.coverageDomain && !s.coreProblem && s.scope==='level_2_strategy'));
await writeFile(dir+'/audit-context.json',JSON.stringify({before,historyBatchIds:batches.map(b=>b.id),avoidTopics,slots},null,2));
const nativeFetch=globalThis.fetch;let calls=0,blockedExtraRequests=0;
globalThis.fetch=async(url,init)=>{
  if(calls>=1){blockedExtraRequests++;throw new Error('AUDIT_ONE_CALL_BUDGET: recovery request blocked before network');}
  const request=JSON.parse(String(init?.body)),payload=JSON.parse(request.messages[1].content);
  assert.equal(payload.topicScope,'medium');assert.equal(payload.count,10);
  assert.equal(request.model,'qwen3.8-max-0902');assert.equal(request.temperature,0.85);
  assert.deepEqual(payload.avoidTopics,avoidTopics);assert.ok(!('recentTopics' in payload));
  assert.ok(payload.scopePlan.every((s:any)=>!('coverageDomain' in s)&&!('coreProblem' in s)));
  await writeFile(dir+'/request.json',JSON.stringify(request,null,2));
  calls++;const response=await nativeFetch(url,init);
  await writeFile(dir+'/provider.json',await response.clone().text());return response;
};
try{
  const card=getCompetitorCreativeCard('resource_01_grammar_parchment_red')!;
  const result=await generateTopicOptions({productId:'delf_b2_writing',card,capability:getCapabilityFallback(card),facts:await loadProductFacts('delf_b2_writing'),contentMode:'standard',topicScope:'medium',limit:10,recentAngles,avoidTopics,direction:'AI自由教育内容：只围绕法语考试知识自由选题，不介绍商品、资料包或购买承接。'});
  for(const topic of result.data){
    assert.equal(topic.topicAssignment?.actualGranularity,'unverified');
    assert.equal(topic.topicAssignment?.plannedGranularity,'level_2_strategy');
    const m=topicOptionToMigrated(topic);assert.equal(m.topic,topic.topic);assert.equal(m.content_promise,topic.promise);
  }
  await writeFile(dir+'/result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({calls,accepted:result.data.length,usage:result.usage,warnings:result.warnings,topics:result.data.map(t=>({topic:t.topic,promise:t.promise}))},null,2));
}catch(error){await writeFile(dir+'/error.json',JSON.stringify({error:String(error),calls,blockedExtraRequests},null,2));throw error;}
finally{
  const after=await hashes();assert.deepEqual(after,before);
  await writeFile(dir+'/code-unchanged.json',JSON.stringify({unchanged:true,after,calls,blockedExtraRequests},null,2));
}
