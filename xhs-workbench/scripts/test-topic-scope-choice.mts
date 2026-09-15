import nextEnv from '@next/env';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {generateTopicOptions,getCapabilityFallback,topicOptionToMigrated} from '../src/lib/v2/topic-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {loadProductFacts} from '../src/lib/product-facts-loader';
nextEnv.loadEnvConfig(process.cwd());
const card=getCompetitorCreativeCard('resource_01_grammar_parchment_red')!;
const facts=await loadProductFacts('delf_b2_writing');
const history=JSON.parse(await readFile('data/batches/batch_1788976037047/batch.json','utf8')).jobs.map((j:any)=>j.topic.topic+'；交付：'+j.topic.content_promise);
const live=process.argv.includes('--live');
const nativeFetch=globalThis.fetch;
const dir='data/topic-scope-choice/'+Date.now();
await mkdir(dir,{recursive:true});
let mode='';let calls=0;
globalThis.fetch=async (url,init)=>{
 const body=JSON.parse(String(init?.body));const payload=JSON.parse(body.messages[1].content);
 assert.equal(payload.topicScope,mode);assert.equal(payload.scopePlan.length,10);
 assert.ok(payload.scopePlan.every((p:any)=>!('coreProblem' in p)&&!('coverageDomain' in p)));
 assert.ok(payload.recentTopics.length<=30);
 await writeFile(dir+'/'+mode+'-request.json',JSON.stringify(body,null,2));calls++;
 if(live){const res=await nativeFetch(url,init);await writeFile(dir+'/'+mode+'-provider.json',await res.clone().text());return res;}
 return new Response(JSON.stringify({id:'offline-'+mode,choices:[{message:{content:JSON.stringify({topics:Array.from({length:10},(_,i)=>({topic:'离线选题'+i,audienceState:'学习者',painOrDesire:'真实任务'+i,promise:'相关材料和完整应用'+i}))})}}],usage:{}}),{headers:{'Content-Type':'application/json'}});
};
for(const scope of ['large','medium'] as const){
 mode=scope;
 const result=await generateTopicOptions({productId:'delf_b2_writing',card,capability:getCapabilityFallback(card),facts,contentMode:'standard',limit:10,topicScope:scope,recentAngles:history});
 assert.equal(result.data.length,10);
 for(const t of result.data){assert.equal(t.topicGranularity,scope==='large'?'level_1_asset':'level_2_strategy');const m=topicOptionToMigrated(t);assert.equal(m.topic,t.topic);assert.equal(m.content_promise,t.promise);assert.equal(t.topicAssignment?.coreProblem,t.painOrDesire);}
 await writeFile(dir+'/'+scope+'-result.json',JSON.stringify(result,null,2));
 history.push(...result.data.map(t=>t.topic+'；交付：'+t.promise));
 console.log(scope,JSON.stringify(result.data.map(t=>({topic:t.topic,promise:t.promise}))),JSON.stringify(result.usage));
}
assert.equal(calls,2);console.log('PASS',dir,'AI_CALLS',live?calls:0);
