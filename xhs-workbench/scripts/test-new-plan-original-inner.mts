import env from '@next/env';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateContentPackage} from '../src/lib/v2/content-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';
env.loadEnvConfig(process.cwd());
assert.ok(!process.env.AI_BRIDGE_DIR);
const out='data/new-plan-original-inner-20260910';
const batch='data/batches/batch_1789005556011/jobs';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,x:unknown)=>{await fs.mkdir(path.dirname(`${out}/${p}`),{recursive:true});await fs.writeFile(`${out}/${p}`,JSON.stringify(x,null,2));};
const hash=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
await fs.mkdir(out,{recursive:true});await fs.mkdir(`${out}/started`);
const names=(await fs.readdir(batch)).filter(n=>n.endsWith('.json'));
const hashes=Object.fromEntries(await Promise.all(names.map(async n=>[n,hash(await fs.readFile(`${batch}/${n}`))])));
const sourcePath='src/lib/v2/content-stage.ts';
const sourceHash=hash(await fs.readFile(sourcePath));
const candidate=await read('data/inner-teaching-boundaries-20260910/001/page-plan-request-offline.json');
const planSystem=candidate.messages[0].content+'\n对照只规划使用场景、表达效果或结构差异，不固定安排“错误→正确”教学裁决，不要求为每个例子补一个专业规则；不得预先裁定语法形式、文体禁令或某种逻辑一定错误。';
const nativeFetch=globalThis.fetch,calls:any[]=[];
const cases=[['001','c1ec87be-3afa-906c-afcd-1dc824ebe41e'],['005','4c696045-ab4d-9725-8c64-5e64dbab312e'],['009','037d83a1-e07b-97f9-b527-e797ff28b5a3']];
try{for(const [id,trace] of cases){
 const old=await read(`data/final-content-traces/${trace}/00_REQUEST_PAYLOAD.json`);
 const j=await read(`${batch}/job_${id}.json`);
 await save(`${id}/OLD_PAGE_PLAN.json`,old.userPayload.canonical_page_plan);
 const sent=new Set<string>();
 globalThis.fetch=async(url:any,init:any)=>{
  const r=JSON.parse(init.body);const stage=r.max_tokens===2600?'page_plan':'inner';
  assert.ok(!sent.has(stage),'NO_RETRY_ALLOWED');assert.ok(calls.length<6);sent.add(stage);
  if(stage==='page_plan'){
   assert.deepEqual(JSON.parse(r.messages[1].content),old.userPayload.topic);
   r.messages[0].content=planSystem;
  }else{
   assert.equal(r.max_tokens,old.maxTokens);assert.equal(r.temperature,old.temperature);assert.equal(r.model,old.model);
   assert.equal(r.messages[0].content,old.systemPrompt);
   assert.equal(r.enable_thinking,false);assert.deepEqual(r.response_format,{type:'json_object'});
   const payload=JSON.parse(r.messages[1].content);
   assert.deepEqual({...payload,canonical_page_plan:old.userPayload.canonical_page_plan},old.userPayload);
   await save(`${id}/NEW_PAGE_PLAN.json`,payload.canonical_page_plan);
   await save(`${id}/invariance.json`,{innerSystemExactHistorical:true,onlyUserPayloadChange:'canonical_page_plan',model:r.model,temperature:r.temperature,maxTokens:r.max_tokens,schemaAndProviderParametersUnchanged:true});
  }
  await save(`${id}/${stage}-request.json`,r);
  calls.push({id,stage,model:r.model,started:new Date().toISOString()});await save('calls.json',calls);
  const res=await nativeFetch(url,{...init,body:JSON.stringify(r),signal:AbortSignal.timeout(300000)});
  const raw=await res.text();await save(`${id}/${stage}-provider.json`,{status:res.status,raw});
  if(res.ok){const p=JSON.parse(raw);await save(`${id}/${stage}-usage.json`,p.usage||{});
   await save(`${id}/${stage}-raw.json`,{model:p.model,finishReason:p.choices?.[0]?.finish_reason,content:p.choices?.[0]?.message?.content});
   // Save without repairing or modifying the model's content.
   try{await save(`${id}/${stage}-parsed.json`,JSON.parse(p.choices[0].message.content));}catch{}
  }
  console.log(id,stage,'HTTP',res.status);
  return new Response(raw,{status:res.status,headers:res.headers});
 };
 try{const result=await generateContentPackage({topic:j.artifacts.selectedTopic.data,capability:getCapabilityFallback(getCompetitorCreativeCard(j.reference_card_id)!),evidence:[]});await save(`${id}/normalized-result.json`,result);console.log(id,'COMPLETE');}
 catch(e){await save(`${id}/failure.json`,{error:String(e)});console.log(id,String(e));}
}}finally{
 globalThis.fetch=nativeFetch;
 for(const n of names)assert.equal(hash(await fs.readFile(`${batch}/${n}`)),hashes[n]);
 assert.equal(hash(await fs.readFile(sourcePath)),sourceHash);
 await save('preservation.json',{unchanged:true,hashes,productionSourceUnchanged:true,calls:calls.length,pagePlanCalls:calls.filter(c=>c.stage==='page_plan').length,innerCalls:calls.filter(c=>c.stage==='inner').length,networkRetries:0,jobWrites:0});
}
