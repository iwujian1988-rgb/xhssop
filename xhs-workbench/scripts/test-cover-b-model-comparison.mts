import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import nextEnv from '@next/env';
const root=process.cwd();nextEnv.loadEnvConfig(root);
const baseline='data/real-cover-abd-final-closeout-20260907';
const dir=path.join(root,'data/cover-b-model-comparison-20260907');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(path.join(dir,p),JSON.stringify(v,null,2));
const sha=(b:Buffer|string)=>crypto.createHash('sha256').update(b).digest('hex');
const request=await read(baseline+'/B/request.json');
const providerRequest=await read(baseline+'/B/provider-request.json');
const prepared=(await read(baseline+'/prepared.json')).find((x:any)=>x.label==='B');
const model='qwen3.8-max-0902';
assert.equal(request.model,'qwen3.7-flash');
assert.equal(prepared.innerHash,'1n0315l');
const protectedPaths=['.env.local','data/title-style-short-approved.json','data/title-style-user-approved.json','data/title-usage.json',prepared.source];
async function walk(d:string){for(const e of await fs.readdir(path.join(root,d),{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else protectedPaths.push(p);}}
await walk('src');
const before=Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,sha(await fs.readFile(path.resolve(root,p)))])));
await fs.mkdir(dir); // One authorized experiment; never overwrite or resume live.
await write('provenance.json',{baseline,source:prepared.source,innerHash:prepared.innerHash,baselineModel:request.model,alternativeModel:model,formalHumanSelection:false});
const require=createRequire(import.meta.url);
const clientPath=require.resolve('../src/lib/ai-client.ts');
const client=require(clientPath);
let wrappedCalls=0;let attempts=0;let responses=0;
require.cache[clientPath]!.exports={...client,callOpenAICompatibleJsonWithUsage:async(messages:any[],options:any)=>{
  assert.equal(++wrappedCalls,1);assert.equal(options.stage,'cover');
  // Abort before networking if the production prompt or content changed since baseline.
  assert.deepEqual(messages,request.messages);
  assert.equal(options.temperature,request.temperature);assert.equal(options.maxTokens,request.maxTokens);
  await write('request.json',{...request,model,retries:1});
  return client.callOpenAICompatibleJsonWithUsage(request.messages,{...options,model,retries:1,onResponseTrace:async(trace:any)=>write('response-trace.json',trace)});
}};
const {generateFinalCoverBlocks}=await import('../src/lib/v2/content-stage');
const {stableHash}=await import('../src/lib/v2/contracts');
assert.equal(stableHash(prepared.artifact.data.innerPages),prepared.innerHash);
assert.ok(!process.env.AI_BRIDGE_DIR,'NO_BRIDGE');
const endpoint=(process.env.OPENAI_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/,'')+'/chat/completions';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),endpoint);assert.equal(attempts,0,'NO_RETRY');assert.equal(wrappedCalls,1);
  const body=JSON.parse(String(init?.body));
  assert.deepEqual(body,{...providerRequest,model},'MODEL_MUST_BE_ONLY_REQUEST_VARIABLE');
  attempts++;await write('calls.json',{attempts,responses,retries:0});
  await write('provider-request.json',body);
  await write('request-equality.json',{modelOnlyDifference:true,messagesHash:sha(JSON.stringify(body.messages)),baselineMessagesHash:sha(JSON.stringify(providerRequest.messages)),temperature:body.temperature,maxTokens:body.max_tokens});
  const response=await originalFetch(url,init);responses++;
  await write('calls.json',{attempts,responses,retries:0,status:response.status});
  const raw=await response.clone().text();await fs.writeFile(path.join(dir,'provider-response.txt'),raw);
  try {const p=JSON.parse(raw);await write('usage.json',p.usage||{});await fs.writeFile(path.join(dir,'raw.txt'),p.choices?.[0]?.message?.content||'');}catch{}
  return response;
};
try {
  const artifact=structuredClone(prepared.artifact);artifact.usage=client.emptyAiUsage();
  const result=await generateFinalCoverBlocks(artifact,prepared.input);
  assert.equal(stableHash(result.data.innerPages),prepared.innerHash);
  await write('result.json',result);
  await write('summary.json',{selectedTemplateId:result.data.selectedCoverTemplateId,coverCopy:result.data.coverCopy,candidates:result.data.coverCandidates,usage:result.usage});
  console.log(JSON.stringify({selectedTemplateId:result.data.selectedCoverTemplateId,coverCopy:result.data.coverCopy,candidates:result.data.coverCandidates,usage:result.usage}));
} catch(error){
  const e=error as any;await write('failure.json',{message:e.message,cause:e.cause?.message,candidates:e.coverCandidates,usage:e.usage});
  console.log(JSON.stringify({error:e.message,candidates:e.coverCandidates}));
} finally {
  globalThis.fetch=originalFetch;
  const changed=[];for(const p of protectedPaths)if(before[p]!==sha(await fs.readFile(path.resolve(root,p))))changed.push(p);
  await write('preservation.json',{unchanged:changed.length===0,changed,checked:protectedPaths.length,attempts,responses,wrappedCalls});
  assert.deepEqual(changed,[]);
}
console.log(`NEW_COVER_REQUEST_ATTEMPTS=${attempts}; RESPONSES=${responses}; OTHER_AI_CALLS=0`);
