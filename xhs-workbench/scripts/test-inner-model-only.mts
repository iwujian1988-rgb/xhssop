import nextEnv from '@next/env';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateContentPackage} from '../src/lib/v2/content-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';
nextEnv.loadEnvConfig(process.cwd());
assert.ok(!process.env.AI_BRIDGE_DIR);
const out='data/inner-model-only-20260910';
const batch='data/batches/batch_1789005556011/jobs';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,x:unknown)=>{await fs.mkdir(path.dirname(`${out}/${p}`),{recursive:true});await fs.writeFile(`${out}/${p}`,JSON.stringify(x,null,2));};
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
await fs.mkdir(out,{recursive:true});await fs.mkdir(`${out}/started`);
const files=(await fs.readdir(batch)).filter(x=>x.endsWith('.json'));
const originalHashes=Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await fs.readFile(`${batch}/${f}`))])));
const nativeFetch=globalThis.fetch;
const models=['qwen3.7-flash','deepseek-v4-flash'];
const cases=[{id:'case1',job:'005',focus:'grammar form versus pragmatic effect'},{id:'case2',job:'009',focus:'counts and steps'},{id:'case3',job:'001',focus:'absolute teaching claims'}];
const inputs:any[]=[];
// Capture unchanged production Inner request using the saved Page Plan, with networking disabled.
for(const c of cases){
 const job=await read(`${batch}/job_${c.job}.json`);let captured:any;let planGiven=false;
 globalThis.fetch=async(_url:any,init:any)=>{
  const req=JSON.parse(init.body);
  if(!planGiven){planGiven=true;assert.equal(req.max_tokens,2600);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({pages:job.artifacts.content.data.pagePlan})},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}),{status:200});}
  if(captured)assert.deepEqual(req,captured);else captured=req;
  throw new Error('OFFLINE_INNER_CAPTURE_ONLY');
 };
 try{await generateContentPackage({topic:job.artifacts.selectedTopic.data,capability:getCapabilityFallback(getCompetitorCreativeCard(job.reference_card_id)!),evidence:[]});}catch{}
 assert.ok(captured);const payload=JSON.parse(captured.messages[1].content);
 assert.deepEqual(payload.topic,{finalPublicTopic:job.artifacts.selectedTopic.data.topic,promise:job.artifacts.selectedTopic.data.promise});
 assert.deepEqual(payload.canonical_page_plan,job.artifacts.content.data.pagePlan);
 await save(`${c.id}/source.json`,{...c,sourceJob:`${batch}/job_${c.job}.json`,topic:job.artifacts.selectedTopic.data,canonicalPagePlan:job.artifacts.content.data.pagePlan,productionModel:captured.model,evidence:[],skill:'No separate Skill loaded by production Inner; unchanged system prompt is complete.'});
 await save(`${c.id}/production-request.json`,captured);
 const requests=models.map(model=>({...captured,model}));
 const strip=(r:any)=>{const {model,...rest}=r;return rest;};
 assert.deepEqual(strip(requests[0]),strip(requests[1]));
 await save(`${c.id}/single-variable.json`,{equalExceptModel:true,requestWithoutModelHash:sha(JSON.stringify(strip(requests[0]))),models,temperature:captured.temperature,max_tokens:captured.max_tokens,providerParameters:strip({...captured,messages:undefined})});
 inputs.push({c,requests});
}
globalThis.fetch=nativeFetch;
const ledger:any[]=[];
try {
 for(const {c,requests} of inputs)for(let i=0;i<requests.length;i++){
  const req=requests[i],arm=i===0?'qwen':'deepseek';
  await save(`${c.id}/${arm}-request.json`,req);
  assert.ok(ledger.length<6);ledger.push({case:c.id,job:c.job,model:req.model,arm,started:new Date().toISOString()});await save('calls.json',ledger);
  try{
   const response=await nativeFetch(`${process.env.OPENAI_BASE_URL!.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(req),signal:AbortSignal.timeout(300000)});
   const raw=await response.text();await save(`${c.id}/${arm}-provider.json`,{status:response.status,raw});
   assert.ok(response.ok,`HTTP_${response.status}`);
   const provider=JSON.parse(raw),content=provider.choices?.[0]?.message?.content;
   await save(`${c.id}/${arm}-usage.json`,provider.usage||{});
   await save(`${c.id}/${arm}-output.json`,{finishReason:provider.choices?.[0]?.finish_reason,returnedModel:provider.model,content});
   const parsed=JSON.parse(content);await save(`${c.id}/${arm}-parsed.json`,parsed);
   assert.ok(Array.isArray(parsed.innerPages));
   console.log(c.id,arm,'SUCCESS',parsed.innerPages.length,'pages',provider.usage);
  }catch(error){await save(`${c.id}/${arm}-failure.json`,{error:String(error)});console.log(c.id,arm,String(error));}
 }
} finally {
 for(const f of files)assert.equal(sha(await fs.readFile(`${batch}/${f}`)),originalHashes[f]);
 await save('preservation.json',{unchanged:true,originalHashes,productionModelUnchanged:true,promptUnchanged:true,realInnerCalls:ledger.length,otherRealAiCalls:0,retries:0});
}
