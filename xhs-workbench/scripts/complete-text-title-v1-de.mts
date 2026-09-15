import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import { saveInnerWorkingCopy, lockInnerWorkingCopy, dropInnerJob, prepareJobForHumanReview, teachingPages } from '../src/lib/manual-inner-review';
import { saveJob } from '../src/lib/batch-store';
import { stableHash } from '../src/lib/v2/contracts';
import { buildLockedProductionBrief, assertLockedProductionBrief } from '../src/lib/v2/content-brief';
import { generateTitlePackage, buildStandardKnowledgeTitlePromptForTest } from '../src/lib/v2/title-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const root = process.cwd();
const out = path.join(root,'data/text-title-v1-de');
const batch = 'batch_title_v1_pending_review';
const file = (b:string,j:string)=>path.join(root,`data/batches/${b}/jobs/${j}.json`);
const eSource = file('batch_1787619143649','job_005');
const read = async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const write = async(p:string,v:unknown)=>fs.writeFile(p,JSON.stringify(v,null,2));
const sha = async(p:string)=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const changes:any[]=[];
function replace(pages:any[],p:number,field:string,from:string,to:string,index?:number){
  const old=index===undefined?pages[p][field]:pages[p][field][index];
  assert.ok(old.includes(from),`Missing expected text: ${from}`);
  const next=old.replace(from,to);
  if(index===undefined) pages[p][field]=next; else pages[p][field][index]=next;
  changes.push({page:p+1,field,index,from,to});
}
function fixD(job:any){
  const pages=teachingPages(job.draft.inner_pages);
  replace(pages,0,'bullets','漏掉一个要点，结构分直接打折。','漏掉题目要求会影响任务完成度。',0);
  replace(pages,0,'bullets','格式错位是显性扣分项。','格式和语气不匹配会影响整体表达效果。',1);
  replace(pages,0,'bullets','B2高频语法自查','快速语法自查',2);
  assert.equal(job.draft.evidence.length,0);
  replace(pages,0,'bullets','是否达到官方要求的至少250词？','是否达到题目要求的篇幅？',2);
  replace(pages,0,'lead','其实真正的拉分发生在交卷前的最后检查。','交卷前仍值得留时间检查。');
  replace(pages,0,'lead','确保不因低级失误丢分。','检查容易遗漏的问题。');
  replace(pages,1,'lead','只关注语言流畅度而忽略具体指令，是导致结构性丢分的最大原因。','只关注语言流畅度而忽略题目具体指令，很容易导致任务回应不完整。');
  replace(pages,1,'bullets','Utilisez le vouvoiement mais moins rigide','Vouvoyez votre destinataire tout en gardant un ton naturel.',1);
  replace(pages,1,'bullets','explain, suggest, 道歉','expliquer, proposer, 道歉',3);
  replace(pages,2,'bullets',pages[2].bullets[0],'确保引言、主体和结论都有足够空间完成各自功能，避免某一部分过长挤压其他部分。',0);
  replace(pages,2,'bullets','字数超限时','篇幅明显过长时',1);
  changes.push({page:3,field:'bullets',index:3,from:pages[2].bullets[3],to:null});
  pages[2].bullets.splice(3,1);
  replace(pages,2,'lead','B2写作要求至少250词，但','写作需满足题目要求的篇幅，但');
  replace(pages,2,'lead','避免在考场上因篇幅失衡被扣分。','检查是否因篇幅失衡遗漏了内容。');
  replace(pages,3,'lead','语域（Register）的动态调整原则，是B2写作高分的关键。','语域是否符合对象和文体，是写完后值得重点检查的一项。');
  replace(pages,3,'bullets','A plus','À plus',1);
  return pages;
}
function fixE(job:any){
  const pages=teachingPages(job.artifacts.content.data.innerPages);
  replace(pages,0,'bullets','论坛投稿更口语化，但也要有明确观点和支撑例子，不能只是情绪输出。','论坛投稿的语气要根据对象和情境调整，也要有明确观点和支撑例子，不能只是情绪输出。',2);
  replace(pages,1,'bullets','这是B2论证深度的重要体现。','看它是否回应了相关的不同观点。',3);
  replace(pages,2,'lead','用模板看一篇论坛投稿的骨架。','用模板看一个假设的论坛投稿骨架。');
  replace(pages,3,'bullets','每周练2-3个段落，比盲目写整篇更能快速掌握结构。','可以每周选2-3个段落练习，再对照原文检查结构。',3);
  replace(pages,4,'bullets','把节省下来的时间用来仿写和修改，效果比多刷几篇更明显。','把节省下来的时间用来仿写和修改，再检查自己的薄弱环节。',3);
  return pages;
}
if(process.argv.includes('--prepare')){
  const d=await read(file(batch,'job_001')),oldE=await read(file(batch,'job_002')),source=await read(eSource);
  assert.equal(d.artifacts.content.data.manualInnerReview.status,'needs_review');
  assert.equal(oldE.artifacts.content.data.manualInnerReview.status,'needs_review');
  try { await fs.access(file(batch,'job_003')); throw new Error('REPLACEMENT_ALREADY_EXISTS'); } catch(e){if((e as any).code!=='ENOENT')throw e;}
  const dPages=fixD(d),dChanges=changes.splice(0),ePages=fixE(source),eChanges=changes.splice(0);
  const e=structuredClone(source);e.id='job_003';e.seq=3;
  delete e.artifacts.content.data.manualInnerReview;
  // Local compatibility only: historical Topic and teaching content are not regenerated.
  e.artifacts.selectedTopic.data.productionBrief=buildLockedProductionBrief(e.artifacts.selectedTopic.data);
  e.artifacts.content.data.productionBriefHash=e.artifacts.selectedTopic.data.productionBrief.briefHash;
  const prepared=prepareJobForHumanReview(e);
  const lockedD=lockInnerWorkingCopy(saveInnerWorkingCopy(d,dPages));
  const lockedE=lockInnerWorkingCopy(saveInnerWorkingCopy(prepared,ePages));
  for(const job of [lockedD,lockedE]){
    assert.ok(job.artifacts?.content?.data.manualInnerReview);
    assert.ok(job.artifacts.selectedTopic);
    assert.ok(job.draft);
    assert.equal(job.artifacts.content.data.manualInnerReview.status,'locked');
    assert.equal(job.artifacts.content.data.manualInnerReview.innerHash,stableHash(job.artifacts.content.data.innerPages));
    assert.equal(job.draft.downstreamStale,true);
    assert.equal(job.artifacts.titles,undefined);
    assertLockedProductionBrief(job.artifacts.selectedTopic.data);
    assert.ok(getCompetitorCreativeCard(job.reference_card_id));
  }
  await fs.mkdir(out); // Exclusive: never overwrite a completed preparation.
  const protectedFiles=[eSource,...[1,2,3].map(n=>file('batch_human_review_1788691220835',`job_00${n}`)),path.join(root,'data/text-title-v1-abc/summary.json'),path.join(root,'src/lib/v2/title-stage.ts')];
  const protectedHashes=await Promise.all(protectedFiles.map(async p=>({path:p,sha256:await sha(p)})));
  await write(path.join(out,'D-before.json'),d);await write(path.join(out,'old-E-before.json'),oldE);await write(path.join(out,'E-source.json'),source);
  // Persist working copies through the same save/lock APIs as the review UI.
  await saveJob(batch,saveInnerWorkingCopy(d,dPages));await saveJob(batch,lockedD);
  await saveJob(batch,dropInnerJob(oldE));
  await saveJob(batch,saveInnerWorkingCopy(prepared,ePages));await saveJob(batch,lockedE);
  const manifest={reviewActor:'assistant: user-authorized manual-style backend review; not historical QA approval',batch,
    D:{job:'job_001',hash:lockedD.artifacts!.content!.data.manualInnerReview!.innerHash,changes:dChanges,evidenceDecision:'Current D evidence is empty; omit unsupported minimum assertion, not asserting the official minimum is false.'},
    E:{job:'job_003',source:eSource,hash:lockedE.artifacts!.content!.data.manualInnerReview!.innerHash,changes:eChanges,classification:'LIGHT_FIX',compatibility:'Existing buildLockedProductionBrief; no Topic text or Title code changes'},
    candidatesReviewed:[{source:eSource,result:'LIGHT_FIX',selected:true},{source:file('batch_content_root_fix_1788574229201','job_003'),result:'DROP',reason:'English teaching and invented scoring/level rules throughout'},{source:file('batch_1787616253061','job_005'),result:'DROP',reason:'Incorrect word-count demonstration, unsupported city facts and pervasive mandatory four-step/scoring claims'}],
    oldE:{job:'job_002',status:'dropped',reason:'Pervasive invented method/scoring rules; repair approaches rewrite'},protectedHashes,aiCalls:0};
  await write(path.join(out,'review.json'),manifest);
  for(const x of protectedHashes)assert.equal(await sha(x.path),x.sha256);
  console.log(JSON.stringify({prepared:true,D:manifest.D.hash,E:manifest.E.hash,oldE:'dropped',aiCalls:0}));
  process.exit(0);
}
const live=process.argv.includes('--live');
assert.ok(live||process.argv.includes('--offline'),'Use --prepare, --offline or --live');
if(live)nextEnv.loadEnvConfig(root);else process.env.OPENAI_API_KEY='offline-only';
delete process.env.AI_BRIDGE_DIR;
const manifest=await read(path.join(out,'review.json'));
for(const x of manifest.protectedHashes)assert.equal(await sha(x.path),x.sha256);
const runOut=live?path.join(out,'live'):await fs.mkdtemp(path.join(root,'.tmp-title-de-'));
if(live)await fs.mkdir(runOut); // No automatic reruns even after partial failure.
const inputs=await Promise.all(['D','E'].map(async label=>{
  const job=await read(file(batch,manifest[label].job));
  const content=job.artifacts.content.data,topic=job.artifacts.selectedTopic.data;
  assert.equal(content.manualInnerReview.status,'locked');
  assert.equal(content.manualInnerReview.innerHash,manifest[label].hash);
  assert.equal(stableHash(content.innerPages),manifest[label].hash);
  const input={content,topic,capability:getCapabilityFallback(getCompetitorCreativeCard(job.reference_card_id)!)};
  const prompt=buildStandardKnowledgeTitlePromptForTest(input);
  assert.equal('finalContentSnapshot' in prompt.titleCoreInput,false);
  assert.equal(prompt.styleReferences.length,6);
  return {label,input};
}));
const originalFetch=globalThis.fetch;let calls=0;let active='';let perJob=0;
globalThis.fetch=async(url,options)=>{
  assert.ok(calls<2&&perJob===0,'EXACTLY_ONE_ATTEMPT_PER_JOB: no retries');calls++;perJob++;
  const request=JSON.parse(String(options?.body));
  await write(path.join(active,'request.json'),request);
  await write(path.join(runOut,'calls.json'),{attempts:calls,aiCalls:live?calls:0});
  if(!live){
    const title=active.endsWith('D')?'B2写作检查前先看任务完整性':'B2写作范文怎么拆开练？';
    const c={textTitle:title,coverTitle:'DELF B2写作',coverSubtitle:active.endsWith('D')?'任务完整性':'范文结构',clickReason:'写作练习时按具体动作检查',bundleIntent:'练习检查'};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({candidates:[c,{...c,textTitle:title+'先看'}]})}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  }
  const response=await originalFetch(url,options);
  await fs.writeFile(path.join(active,'provider-response.json'),await response.clone().text());
  return response;
};
const results:any[]=[];
process.chdir(runOut);
try{
  for(const {label,input} of inputs){
    active=path.join(runOut,label);await fs.mkdir(active);perJob=0;
    await write(path.join(active,'input.json'),input);
    try{
      const result=await generateTitlePackage(input);
      assert.equal(result.data.selected.textTitle,result.data.candidates[0].textTitle);
      await write(path.join(active,'result.json'),result);
      results.push({label,topic:input.topic.topic,hash:input.content.manualInnerReview.innerHash,selected:result.data.selected,candidates:result.data.candidates,usage:result.usage,requestId:result.request_id});
    }catch(error){
      const failure={label,error:String(error),debug:(error as any).titleDebug,usage:(error as any).usage};
      results.push(failure);await write(path.join(active,'failure.json'),failure);
    }
    await write(path.join(runOut,'summary.json'),{live,aiCalls:live?calls:0,results});
  }
}finally{process.chdir(root);globalThis.fetch=originalFetch;}
for(const x of manifest.protectedHashes)assert.equal(await sha(x.path),x.sha256);
await write(path.join(runOut,'preservation.json'),{ABCJobsAndSummaryUnchanged:true,sourceEUnchanged:true,titleStageUnchanged:true});
console.log(JSON.stringify({output:runOut,live,aiCalls:live?calls:0,results},null,2));
assert.ok(results.every(r=>!r.error),'See saved failures; do not automatically retry live');
