import env from '@next/env';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateContentPackage} from '../src/lib/v2/content-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';
env.loadEnvConfig(process.cwd());
const out='data/inner-teaching-boundaries-20260910';
const batch='data/batches/batch_1789005556011/jobs';
const cases=[['001','c1ec87be-3afa-906c-afcd-1dc824ebe41e'],['005','4c696045-ab4d-9725-8c64-5e64dbab312e'],['009','037d83a1-e07b-97f9-b527-e797ff28b5a3']];
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,x:unknown)=>{await fs.mkdir(path.dirname(`${out}/${p}`),{recursive:true});await fs.writeFile(`${out}/${p}`,JSON.stringify(x,null,2));};
const hash=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
const names=(await fs.readdir(batch)).filter(n=>n.endsWith('.json'));
const hashes=Object.fromEntries(await Promise.all(names.map(async n=>[n,hash(await fs.readFile(`${batch}/${n}`))])));
const nativeFetch=globalThis.fetch;
assert.ok(!process.env.AI_BRIDGE_DIR);
const live=process.argv.includes('--live');
const calls:any[]=[];
try {
 if(!live){
  for(const [id,trace] of cases){
   const old=await read(`data/final-content-traces/${trace}/00_REQUEST_PAYLOAD.json`);
   const raw=await read(`data/final-content-traces/${trace}/01_PROVIDER_RAW.json`);
   const j=await read(`${batch}/job_${id}.json`);
   const requests:any[]=[];
   globalThis.fetch=async(_url:any,init:any)=>{
    const req=JSON.parse(init.body);requests.push(req);assert.ok(requests.length<=2);
    const content=requests.length===1?JSON.stringify({pages:old.userPayload.canonical_page_plan}):raw.messageContent;
    return new Response(JSON.stringify({choices:[{message:{content},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}),{status:200});
   };
   const result=await generateContentPackage({topic:j.artifacts.selectedTopic.data,capability:getCapabilityFallback(getCompetitorCreativeCard(j.reference_card_id)!),evidence:[]});
   assert.equal(requests.length,2);
   const [plan,inner]=requests;
   assert.deepEqual(JSON.parse(plan.messages[1].content),old.userPayload.topic);
   assert.deepEqual(JSON.parse(inner.messages[1].content),old.userPayload);
   assert.equal(inner.model,old.model);assert.equal(inner.temperature,old.temperature);assert.equal(inner.max_tokens,old.maxTokens);
   assert.equal(inner.enable_thinking,false);assert.deepEqual(inner.response_format,{type:'json_object'});
   const s=inner.messages[0].content;
   for(const term of ['当前句子、场景和证据','法语形式确实支持','不必推断唯一原因','原事实、对象、立场、因果关系保持不变','同一次生成内核对四项'])assert.ok(s.includes(term));
   assert.ok(plan.messages[0].content.includes('即使promise要求评分尺度'));
   assert.ok(plan.messages[0].content.includes('将任务改为使用场景'));
   assert.equal(result.data.innerPages.length,5);
   await save(`${id}/request.json`,inner);await save(`${id}/page-plan-request-offline.json`,plan);
   await save(`${id}/source.json`,{trace,oldPrompt:old.systemPrompt,historicalUserPayloadUnchanged:true,modelUnchanged:true,parametersUnchanged:true,normalizerAccepted:true});
  }
  await save('offline.json',{pass:true,realAiCalls:0,pagePlanPromptCaptured:true,historicalInputsPreserved:true});
  console.log('OFFLINE PASS: real production requests captured; model, input, parameters and schema unchanged.');
 } else {
  assert.equal((await read(`${out}/offline.json`)).pass,true);
  await fs.mkdir(`${out}/live-started`);
  for(const [id] of cases){
   const request=await read(`${out}/${id}/request.json`);
   calls.push({id,model:request.model,started:new Date().toISOString()});await save('calls.json',calls);
   try{
    const res=await nativeFetch(process.env.OPENAI_BASE_URL!.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(request),signal:AbortSignal.timeout(300000)});
    const raw=await res.text();await save(`${id}/provider.json`,{status:res.status,raw});assert.ok(res.ok,`HTTP_${res.status}`);
    const p=JSON.parse(raw);await save(`${id}/usage.json`,p.usage||{});
    await save(`${id}/output.json`,{model:p.model,finishReason:p.choices?.[0]?.finish_reason,content:p.choices?.[0]?.message?.content});
    const parsed=JSON.parse(p.choices[0].message.content);await save(`${id}/parsed.json`,parsed);
    assert.ok(Array.isArray(parsed.innerPages));console.log(id,'DONE',p.model,p.choices[0].finish_reason,p.usage);
   }catch(e){await save(`${id}/failure.json`,{error:String(e)});console.log(id,String(e));}
  }
 }
}finally{
 globalThis.fetch=nativeFetch;
 for(const n of names)assert.equal(hash(await fs.readFile(`${batch}/${n}`)),hashes[n]);
 await save(live?'preservation.json':'offline-preservation.json',{unchanged:true,hashes,calls:calls.length,retries:0,productionJobWrites:0});
}
