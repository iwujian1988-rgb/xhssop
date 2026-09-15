import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import env from '@next/env';
env.loadEnvConfig(process.cwd());
const out='data/inner-pro-historical-20260910';
const batch='data/batches/batch_1789005556011/jobs';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p,x)=>{await fs.mkdir(path.dirname(`${out}/${p}`),{recursive:true});await fs.writeFile(`${out}/${p}`,JSON.stringify(x,null,2));};
const hash=b=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(out,{recursive:true});await fs.mkdir(`${out}/started`);
const names=(await fs.readdir(batch)).filter(n=>n.endsWith('.json'));
const hashes=Object.fromEntries(await Promise.all(names.map(async n=>[n,hash(await fs.readFile(`${batch}/${n}`))])));
const cases=[['001','c1ec87be-3afa-906c-afcd-1dc824ebe41e'],['005','4c696045-ab4d-9725-8c64-5e64dbab312e'],['009','037d83a1-e07b-97f9-b527-e797ff28b5a3']];
const calls=[];
try {for(const [id,trace] of cases){
 const root=`data/final-content-traces/${trace}`;
 const old=await read(`${root}/00_REQUEST_PAYLOAD.json`);
 const historical={model:old.model,messages:[{role:'system',content:old.systemPrompt},{role:'user',content:JSON.stringify(old.userPayload)}],temperature:old.temperature,max_tokens:old.maxTokens,enable_thinking:false,response_format:{type:'json_object'}};
 const request={...historical,model:'deepseek-v4-pro'};
 assert.deepEqual({...request,model:historical.model},historical);
 await save(`${id}/historical-request.json`,historical);
 await save(`${id}/historical-raw.json`,await read(`${root}/01_PROVIDER_RAW.json`));
 await save(`${id}/request.json`,request);
 await save(`${id}/provenance.json`,{trace,requestReconstructedFromSavedSnapshot:true,otherFieldsEqual:true,temperature:old.temperature,maxTokens:old.maxTokens});
 calls.push({id,model:request.model,started:new Date().toISOString()});await save('calls.json',calls);
 try {
 const r=await fetch(process.env.OPENAI_BASE_URL.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(request),signal:AbortSignal.timeout(300000)});
 const raw=await r.text();await save(`${id}/provider.json`,{status:r.status,raw});assert.ok(r.ok,`HTTP_${r.status}`);
 const p=JSON.parse(raw);await save(`${id}/usage.json`,p.usage||{});
 await save(`${id}/output.json`,{model:p.model,finishReason:p.choices?.[0]?.finish_reason,content:p.choices?.[0]?.message?.content});
 const parsed=JSON.parse(p.choices[0].message.content);await save(`${id}/parsed.json`,parsed);
 console.log(id,'DONE',p.model,p.choices[0].finish_reason,p.usage);
 }catch(e){await save(`${id}/failure.json`,{error:String(e)});console.log(id,String(e));}
}}finally{for(const n of names)assert.equal(hash(await fs.readFile(`${batch}/${n}`)),hashes[n]);await save('preservation.json',{unchanged:true,hashes,calls:calls.length,retries:0,productionWrites:0});}
