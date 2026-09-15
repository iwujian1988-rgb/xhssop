import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import nextEnv from '@next/env';
const root=process.cwd();nextEnv.loadEnvConfig(root);
const live=process.argv.includes('--live');
assert.ok(live || process.argv.includes('--prepare'));
const runName=process.argv.find(a=>a.startsWith('--run-name='))?.slice('--run-name='.length)||'real-cover-abd-acceptance-v1';
assert.match(runName,/^real-cover-abd-[a-z0-9-]+$/);
const dir=path.join(root,'data',runName);
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(path.join(dir,p),JSON.stringify(v,null,2));
const sha=(b:Buffer)=>crypto.createHash('sha256').update(b).digest('hex');
await fs.mkdir(dir,{recursive:true});
const protectedFiles=['.env.local','data/title-style-short-approved.json','data/title-style-user-approved.json','data/title-usage.json'];
async function walk(d:string){for(const e of await fs.readdir(path.resolve(root,d),{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else protectedFiles.push(p);}}
await walk('src');
const titles={A:'练B2信函总纠结语气？这篇能帮上忙',B:'远程办公、环保…B2写作这5个话题怎么辩',D:'交卷前心虚？B2写作自查走一遍'};
const hashes={A:'149d2z1',B:'1n0315l',D:'vuq2bl'};
const require=createRequire(import.meta.url);
const clientPath=require.resolve('../src/lib/ai-client.ts');
const client=require(clientPath);
let current='';let realCalls=0;let wrappedCalls=0;
const perJob:Record<string,number>={};
// Test-only module adapter: exact production messages/options, except one attempt.
// No mock response, no changed model, no changed prompt, no persistent production edit.
require.cache[clientPath]!.exports={...client,callOpenAICompatibleJsonWithUsage:async(messages:any[],options:any)=>{
  assert.equal(options.stage,'cover');assert.ok(current);wrappedCalls++;
  assert.equal(perJob[current] || 0,0,'NO_RETRY');
  await write(`${current}/request.json`,{model:options.model||process.env.OPENAI_MODEL,messages,temperature:options.temperature,maxTokens:options.maxTokens,retries:1});
  return client.callOpenAICompatibleJsonWithUsage(messages,{...options,retries:1,onResponseTrace:async(trace:any)=>{
    await write(`${current}/response-trace.json`,trace);
  }});
}};
const {stableHash,countVisibleUnits}=await import('../src/lib/v2/contracts');
const {generateFinalCoverBlocks}=await import('../src/lib/v2/content-stage');
const {getCompetitorCreativeCard}=await import('../src/lib/creative-card-library');
const {getCapabilityFallback}=await import('../src/lib/v2/topic-stage');
const entries=[];
for(const label of ['A','B','D'] as const){
  const p=await read(`data/title-cover-five-acceptance/${label}/provenance.json`);
  const job=await read(p.source);protectedFiles.push(p.source);
  const artifact=structuredClone(job.artifacts.content);
  assert.equal(artifact.data.manualInnerReview.status,'locked');
  assert.equal(stableHash(artifact.data.innerPages),hashes[label]);assert.equal(artifact.data.manualInnerReview.innerHash,hashes[label]);
  artifact.usage=client.emptyAiUsage();
  const card=getCompetitorCreativeCard(job.reference_card_id)!;
  entries.push({label,source:p.source,innerHash:hashes[label],TEST_SELECTED_TEXT_TITLE:titles[label],titleVisibleUnits:countVisibleUnits(titles[label]),artifact,
    input:{topic:job.artifacts.selectedTopic.data,capability:getCapabilityFallback(card),evidence:[],selectedTextTitle:{id:`TEST_SELECTED_TEXT_TITLE_${label}`,textTitle:titles[label]}}});
}
const before=Object.fromEntries(await Promise.all(protectedFiles.map(async p=>[p,sha(await fs.readFile(path.resolve(root,p)))])));
await write('prepared.json',entries);
if(!live){console.log('PREPARED locked A/B/D; AI_CALLS=0');process.exit(0);}
assert.ok(process.env.OPENAI_API_KEY);assert.ok(!process.env.AI_BRIDGE_DIR,'NO_BRIDGE');
await fs.mkdir(path.join(dir,'live-started')); // Fail closed on accidental second run.
const endpoint=(process.env.OPENAI_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/,'')+'/chat/completions';
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),endpoint,'ONLY_COVER_TEXT_ENDPOINT');
  assert.ok(wrappedCalls>realCalls,'ADAPTER_MUST_BE_ACTIVE');
  assert.equal(perJob[current]||0,0,'NO_RETRY');assert.ok(realCalls<3);
  perJob[current]=1;realCalls++;
  await write('calls.json',{realCalls,perJob});
  const body=JSON.parse(String(init?.body));await write(`${current}/provider-request.json`,body);
  let response:Response;
  try { response=await realFetch(url,init); }
  catch(error) {
    const err=error as any;
    await write(`${current}/network-error.json`,{name:err.name,message:err.message,cause:err.cause?{name:err.cause.name,code:err.cause.code,message:err.cause.message}:null});
    throw error;
  }
  const raw=await response.clone().text();await fs.writeFile(path.join(dir,current,'provider-response.txt'),raw);
  try{const parsed=JSON.parse(raw);await write(`${current}/usage.json`,parsed.usage||{});await fs.writeFile(path.join(dir,current,'raw.txt'),parsed.choices?.[0]?.message?.content||'');}catch{}
  return response;
};
const results:any[]=[];
try{
 for(const e of entries){
  current=e.label;await fs.mkdir(path.join(dir,current));
  await write(`${current}/provenance.json`,{source:e.source,innerHash:e.innerHash,TEST_SELECTED_TEXT_TITLE:e.TEST_SELECTED_TEXT_TITLE,formalHumanSelection:false});
  try{
   const out=await generateFinalCoverBlocks(e.artifact,e.input);await write(`${current}/result.json`,out);
   assert.equal(stableHash(out.data.innerPages),e.innerHash);assert.equal(e.input.selectedTextTitle.textTitle,e.TEST_SELECTED_TEXT_TITLE);
   results.push({label:e.label,selectedTextTitle:e.TEST_SELECTED_TEXT_TITLE,selectedTemplateId:out.data.selectedCoverTemplateId,copy:out.data.coverCopy,candidates:out.data.coverCandidates,usage:out.usage});
  }catch(error){const err=error as any;await write(`${current}/failure.json`,{message:String(err.message),candidates:err.coverCandidates,usage:err.usage});results.push({label:e.label,selectedTextTitle:e.TEST_SELECTED_TEXT_TITLE,error:String(err.message),candidates:err.coverCandidates});}
  await write('summary.json',{realCalls,results});console.log(JSON.stringify(results.at(-1)));
 }
}finally{
 globalThis.fetch=realFetch;
 const changed=[];for(const p of protectedFiles)if(sha(await fs.readFile(path.resolve(root,p)))!==before[p])changed.push(p);
 await write('preservation.json',{unchanged:changed.length===0,changed,checked:protectedFiles.length,realCalls,wrappedCalls});assert.deepEqual(changed,[]);
}
console.log(`REAL_COVER_AI_CALLS=${realCalls}; OTHER_AI_CALLS=0`);
