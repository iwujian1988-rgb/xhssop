import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {countVisibleUnits} from '../src/lib/v2/contracts';
const root=process.cwd();nextEnv.loadEnvConfig(root);
const live=process.argv.includes('--live');assert.ok(live||process.argv.includes('--prepare'));
const directory=path.join(root,'data/b-title-model-comparison');await fs.mkdir(directory,{recursive:true});
const hash=(s:string|Buffer)=>crypto.createHash('sha256').update(s).digest('hex');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(path.join(directory,p),JSON.stringify(v,null,2));
const previous=await read('data/text-title-only-acceptance/B/request.json');
const oldPayload=JSON.parse(previous.messages[1].content);
const factBrief='这篇给正在练B2议论文的人提供论据素材。\n包括远程办公、环保、数字健康、教育公平、城市生活5个主题。\n每个主题有正反论据和可用于写作的法语表达。\n主要帮助写作文时展开观点。\n不承诺这些主题是高频、常考、必考，也不承诺提分效果。';
// Experimental message adaptation only. No production builder or configuration writes.
const lines=previous.messages[0].content.split('\n');
lines[0]='你只写小红书DELF B2文字标题。TITLE FACT BRIEF是唯一内容说明，按整篇范围创作，不能让局部主题冒充整篇。';
lines[1]='一次恰好生成8个可以原样直接发布的标题，每个只有textTitle、referenceApprovedId；不输出clickReason、解释、类型或评分，不依赖人工改写。';
lines[4]='不得虚构高频、常考、必考、考官喜欢、高分、提分、最快、满分、90%等承诺；TITLE FACT BRIEF不支持这些说法，不能从参考标题继承。数量只能取本Brief明确提供的事实。';
lines[6]='只返回JSON：{"candidates":[{"textTitle":"短标题","referenceApprovedId":"A15"}]}。数组恰好8个对象，不是示例中的1个；不输出其他字段或referenceWhy。';
const messages=[{role:'system',content:lines.join('\n')},{role:'user',content:JSON.stringify({titleFactBrief:factBrief,shortApprovedStyleReferences:oldPayload.shortApprovedStyleReferences,negativeReferences:oldPayload.negativeReferences})}];
const models=[process.env.OPENAI_MODEL||'qwen3.7-flash','qwen3.8-max-0902'];
const requests=models.map(model=>({...previous,model,messages}));
assert.equal(requests[0].temperature,0.92);assert.equal(requests[0].max_tokens,2600);
assert.equal(requests[0].enable_thinking,false);assert.equal(oldPayload.shortApprovedStyleReferences.length,31);assert.equal(oldPayload.negativeReferences.length,8);
assert.ok(oldPayload.shortApprovedStyleReferences.every((r:any)=>countVisibleUnits(r.title)<=20));
const {model:a,...restA}=requests[0],{model:b,...restB}=requests[1];assert.deepEqual(restA,restB);
assert.ok(!/wholeNoteBrief|concreteAnchors|pageTitle|page lead|finalPublicTopic|bullets|coverTemplate/.test(JSON.stringify(messages)));
const protectedPaths:string[]=[];
async function walk(dir:string){for(const e of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())await walk(p);else protectedPaths.push(p);}}
await walk('src');protectedPaths.push('.env.local','data/title-style-short-approved.json','data/title-style-user-approved.json','data/batches/batch_human_review_1788691220835/jobs/job_002.json');
const hashes=Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,hash(await fs.readFile(path.join(root,p)))])));
if(!live){await write('prepared.json',{models,requests,equalExceptModel:true,commonBodyHash:hash(JSON.stringify(restA)),modelAvailabilityEvidence:'Existing configured DashScope GET /models returned HTTP 200; qwen3.8-max-0902 listed. No new provider.'});console.log('PREPARED; AI_CALLS=0');process.exit(0);}
await fs.mkdir(path.join(directory,'live')); // Exclusive: never overwrite/re-run the experiment.
const results:any[]=[];let calls=0;
for(const [i,request] of requests.entries()){
 const label=i===0?'current':'alternative';await fs.mkdir(path.join(directory,'live',label));await write(`live/${label}/request.json`,request);
 calls++;await write('live/calls.json',{textGenerationCalls:calls,modelListQueries:1,retries:0});
 const base=(process.env.OPENAI_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/,'');
 try{
  const response=await fetch(`${base}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(request),signal:AbortSignal.timeout(300000)});
  const body=await response.text();await fs.writeFile(path.join(directory,'live',label,'provider-response.json'),body);
  if(!response.ok)throw new Error(`HTTP_${response.status}`);
  const provider=JSON.parse(body);const raw=provider.choices?.[0]?.message?.content;
  await fs.writeFile(path.join(directory,'live',label,'raw.txt'),raw||'');
  await write(`live/${label}/usage.json`,provider.usage||null);
  if(provider.choices?.[0]?.finish_reason==='length')throw new Error('TRUNCATED');
  const parsed=JSON.parse(raw);await write(`live/${label}/parsed.json`,parsed);
  const candidates=(parsed.candidates||[]).map((c:any)=>({...c,visibleUnits:countVisibleUnits(c.textTitle)}));
  const result={label,model:request.model,candidates,le20:candidates.filter((c:any)=>c.visibleUnits<=20).length,le16:candidates.filter((c:any)=>c.visibleUnits<=16).length,usage:provider.usage};results.push(result);
 }catch(e){results.push({label,model:request.model,error:String(e)});}
 await write('live/summary.json',{calls,results});console.log(JSON.stringify(results.at(-1)));
}
for(const p of protectedPaths)assert.equal(hash(await fs.readFile(path.join(root,p))),hashes[p],`PROTECTED_FILE_CHANGED:${p}`);
await write('live/preservation.json',{productionSourceConfigLibrariesAndBJobUnchanged:true,protectedFileCount:protectedPaths.length,equalExceptModel:true,commonBodyHash:hash(JSON.stringify(restA)),calls});
