import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {countVisibleUnits,stableHash} from '../src/lib/v2/contracts';
import {filterTextTitleCandidates} from '../src/lib/v2/title-stage';
const root=process.cwd();nextEnv.loadEnvConfig(root);
const live=process.argv.includes('--live');assert.ok(live||process.argv.includes('--prepare'));
const dir=path.join(root,'data/qwen38-title-acde-acceptance');await fs.mkdir(dir,{recursive:true});
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(path.join(dir,p),JSON.stringify(v,null,2));
const hash=(s:Buffer|string)=>crypto.createHash('sha256').update(s).digest('hex');
const baseline=await read('data/b-title-model-comparison/live/alternative/request.json');
const baseUser=JSON.parse(baseline.messages[1].content);
assert.equal(baseline.model,'qwen3.8-max-0902');assert.equal(baseline.temperature,.92);assert.equal(baseline.max_tokens,2600);
assert.equal(baseline.enable_thinking,false);assert.equal(baseUser.shortApprovedStyleReferences.length,31);assert.equal(baseUser.negativeReferences.length,8);
const task=await fs.readFile('C:/Users/imwuj/.codex/attachments/18e5a625-86ea-4b13-a687-f5bd6aa9a814/pasted-text.txt','utf8');
const sections=[...task.matchAll(/【FACT BRIEF】([\s\S]*?)【TITLE GUARDRAILS】([\s\S]*?)(?===================================================)/g)];
assert.equal(sections.length,4);
const labels=['A','C','D','E'];
const factChecks=[['p1开场：询问/请求/异议','p2正文：建议/异议','p3收尾：收件人关系与行动期待'],['p2-p6五组表达对照','p7三步练习','描述内容存在，不证明历史教学解释正确'],['p1任务完成检查','p2收件人场景','p3篇幅','p4语气格式'],['p1题型','p2结构拆解','p3假设示例','p4关键段落仿写','p5选择性练习']];
const entries=[];
const protectedPaths:string[]=[];
async function walk(d:string){for(const e of await fs.readdir(path.resolve(root,d),{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else protectedPaths.push(p);}}
await walk('src');await walk('data/b-title-model-comparison');
protectedPaths.push('.env.local','data/title-style-short-approved.json','data/title-style-user-approved.json');
for(const [i,label] of labels.entries()){
 const provenance=await read(`data/title-cover-five-acceptance/${label}/provenance.json`);
 const job=await read(provenance.source);const content=job.artifacts.content.data;
 assert.equal(content.manualInnerReview.status,'locked');assert.equal(stableHash(content.innerPages),provenance.lockedInnerHash);
 const validator=await read(`data/text-title-only-acceptance/${label}/validator-input.json`);
 assert.deepEqual(validator.content.innerPages,content.innerPages);
 protectedPaths.push(provenance.source);
 const payload={titleFactBrief:sections[i][1].trim(),shortApprovedStyleReferences:baseUser.shortApprovedStyleReferences,negativeReferences:baseUser.negativeReferences,titleGuardrails:sections[i][2].trim()};
 const request={...baseline,messages:[baseline.messages[0],{role:'user',content:JSON.stringify(payload)}]};
 assert.equal(request.messages[0].content,baseline.messages[0].content);
 entries.push({label,provenance,factChecks:factChecks[i],request,validator});
}
const hashes=Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,hash(await fs.readFile(path.resolve(root,p)))])));
if(!live){await write('prepared.json',entries.map(({validator,...e})=>e));console.log('PREPARED: four verified locked inputs; AI_CALLS=0');process.exit(0);}
assert.equal((process.env.OPENAI_BASE_URL||'').replace(/\/$/,''),'https://dashscope.aliyuncs.com/compatible-mode/v1');
assert.ok(process.env.OPENAI_API_KEY);
await fs.mkdir(path.join(dir,'live')); // Exclusive: a second invocation cannot repeat these calls.
let calls=0;const results:any[]=[];
for(const e of entries){
 await fs.mkdir(path.join(dir,'live',e.label));await write(`live/${e.label}/request.json`,e.request);
 await write(`live/${e.label}/provenance.json`,{...e.provenance,factChecks:e.factChecks});
 calls++;await write('live/calls.json',{calls,retries:0,coverCalls:0,bCalls:0});
 try{
 const response=await fetch(`${process.env.OPENAI_BASE_URL!.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(e.request),signal:AbortSignal.timeout(300000)});
 const body=await response.text();await fs.writeFile(path.join(dir,'live',e.label,'provider-response.json'),body);
 if(!response.ok)throw new Error(`HTTP_${response.status}`);
 const provider=JSON.parse(body),raw=provider.choices?.[0]?.message?.content||'';
 await fs.writeFile(path.join(dir,'live',e.label,'raw.txt'),raw);await write(`live/${e.label}/usage.json`,provider.usage);
 const parsed=JSON.parse(raw);await write(`live/${e.label}/parsed.json`,parsed);
 assert.equal(provider.choices[0].finish_reason,'stop');assert.equal(parsed.candidates.length,8);
 // Existing filter requires clickReason; local sentinel only satisfies that unrelated schema check.
 // Never add it to the model request/raw output or to a production Job.
 const filtered=filterTextTitleCandidates(parsed.candidates.map((c:any)=>({...c,clickReason:'离线适配占位（非模型输出）'})),e.validator);
 await write(`live/${e.label}/offline-filter.json`,{adaptation:'clickReason sentinel only; no production writes',...filtered});
 const candidates=parsed.candidates.map((c:any,i:number)=>({...c,visibleUnits:countVisibleUnits(c.textTitle),filterReasons:filtered.evaluated[i].filterReasons}));
 results.push({label:e.label,candidates,le20:candidates.filter((c:any)=>c.visibleUnits<=20).length,le16:candidates.filter((c:any)=>c.visibleUnits<=16).length,existingFilterSurvival:filtered.survivalCount,usage:provider.usage});
 }catch(error){results.push({label:e.label,error:String(error)});}
 await write('live/summary.json',{calls,results});console.log(JSON.stringify(results.at(-1)));
}
for(const p of protectedPaths)assert.equal(hash(await fs.readFile(path.resolve(root,p))),hashes[p],`PROTECTED_FILE_CHANGED:${p}`);
await write('live/preservation.json',{unchanged:true,protectedFileCount:protectedPaths.length,hashes,calls,productionModel:process.env.OPENAI_MODEL,systemPromptUnchanged:true,short31AndNegative8Unchanged:true});
