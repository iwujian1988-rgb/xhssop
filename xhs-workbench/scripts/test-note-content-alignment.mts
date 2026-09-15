import nextEnv from '@next/env';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {generateAutoTitleFactBrief,generateTitlePackage,finalizeAutoTitleFactBrief} from '../src/lib/v2/title-stage';
import {emptyAiUsage,mergeAiUsage} from '../src/lib/ai-client';
import {buildNativeTitlePrompt} from '../src/lib/v2/native-title-skill';
import {generateFinalCoverBlocks,generateFinalCaptionAndBridge,buildCommercialCaptionInput} from '../src/lib/v2/content-stage';
import {currentNoteBoundary,FACT_BOUNDARY_VERSION,normalizeScopedFacts} from '../src/lib/v2/note-fact-boundary';
import {obviousInnerConsistencyWarnings,prepareJobForHumanReview,lockInnerWorkingCopy} from '../src/lib/manual-inner-review';
import {buildV2Tags,compileCover} from '../src/lib/v2/pipeline';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';
import {stableHash} from '../src/lib/v2/contracts';

nextEnv.loadEnvConfig(process.cwd());
const batch='data/batches/batch_1789005556011/jobs';
// User-authorized replacement run; retain the previous failed requests/ledger.
const out=process.argv.includes('--authorized-rerun')
 ? 'data/note-content-alignment-20260910-authorized-rerun'
 : 'data/note-content-alignment-20260910';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p:string,x:unknown)=>{await fs.mkdir(path.dirname(`${out}/${p}`),{recursive:true});await fs.writeFile(`${out}/${p}`,JSON.stringify(x,null,2));};
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const protectedFiles=(await fs.readdir(batch)).filter(n=>n.endsWith('.json'));
const hashes=Object.fromEntries(await Promise.all(protectedFiles.map(async n=>[n,sha(await fs.readFile(`${batch}/${n}`))])));
const ids=['006','008','010'];
const inputFor=(j:any,content:any)=>({topic:j.artifacts.selectedTopic.data,content,capability:getCapabilityFallback(getCompetitorCreativeCard(j.reference_card_id)!)});
const originals=Object.fromEntries(await Promise.all(ids.map(async id=>[id,await read(`${batch}/job_${id}.json`)])));
for(const j of Object.values(originals) as any[]){assert.equal(j.artifacts.content.data.manualInnerReview.status,'locked');assert.equal(stableHash(j.artifacts.content.data.innerPages),j.artifacts.content.data.manualInnerReview.innerHash);}

// Zero-call checks use explicitly marked fixtures, never scored as generated output.
if(!process.argv.includes('--live-titles')&&!process.argv.includes('--live-downstream')){
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('OFFLINE_NETWORK_FORBIDDEN');};
 const issues:any={};
 for(const id of ['003','005','009']){
  const j=await read(`${batch}/job_${id}.json`);issues[id]=obviousInnerConsistencyWarnings(j.artifacts.content.data.innerPages);assert.ok(issues[id].length);
  const prepared=prepareJobForHumanReview(j);assert.ok(prepared.draft!.checks.warnings!.some(w=>w.includes('正文一致性提醒')));
  const locked=lockInnerWorkingCopy(prepared);assert.ok(locked.artifacts!.content!.warnings.some(w=>w.includes('正文一致性提醒')));
 }
 for(const id of ids){
  const j=originals[id],c=structuredClone(j.artifacts.content.data),pages=c.innerPages;
  const p=pages.find((p:any)=>p.page_no===4);
  const raw=[{value:'OFFLINE_FIXTURE',refersTo:'OFFLINE_FIXTURE',sourcePages:[4],evidence:p.bullets[0]}];
  const facts=normalizeScopedFacts(raw,pages);assert.equal(facts[0].scope,'局部P4');
  assert.deepEqual(normalizeScopedFacts([{...raw[0],sourcePages:[5]}],pages),[]);
  assert.deepEqual(normalizeScopedFacts([{...raw[0],evidence:'invented not in source'}],pages),[]);
  c.autoFactBrief={boundaryVersion:FACT_BOUNDARY_VERSION,sourceInnerHash:stableHash(pages),factBrief:'OFFLINE_FIXTURE',userTask:'OFFLINE_FIXTURE',noteCore:j.artifacts.selectedTopic.data.topic,deliverables:['OFFLINE_FIXTURE'],scopedFacts:facts,doNotReframe:[],scopeNotes:[],supportedCounts:[]};
  const prompt=buildNativeTitlePrompt(inputFor(j,c));assert.equal(prompt.systemPrompt,await fs.readFile(prompt.skillPath,'utf8'));
  for(const p of pages)for(const b of p.bullets)assert.ok(prompt.userPrompt.includes(b));
  assert.deepEqual(prompt.titleCoreInput.factBoundary,currentNoteBoundary(c));
  const caption=buildCommercialCaptionInput(j.artifacts.selectedTopic.data.topic,'DELF B2',pages,[],c.autoFactBrief);
  assert.deepEqual(caption.payload.factBoundary,currentNoteBoundary(c));assert.deepEqual(caption.payload.seoKeywords,['法语写作','DELF B2']);
  let coverCaptured=false;
  globalThis.fetch=async(_url:any,init:any)=>{
   const req=JSON.parse(init.body),payload=JSON.parse(req.messages[1].content);
   assert.deepEqual(payload.factBoundary,currentNoteBoundary(c));assert.deepEqual(payload.finalInnerPages,pages);
   assert.ok(req.messages[0].content.includes('不决定正文有几类/几步'));
   coverCaptured=true;throw Error('OFFLINE_CAPTURE_ONLY');
  };
  await assert.rejects(()=>generateFinalCoverBlocks({...j.artifacts.content,data:c},{topic:j.artifacts.selectedTopic.data,capability:inputFor(j,c).capability,evidence:[],selectedTextTitle:{id:'OFFLINE_ONLY',textTitle:'OFFLINE_ONLY'}}));
  assert.ok(coverCaptured);
  c.innerPages[0].lead+=' CHANGED';assert.equal(currentNoteBoundary(c),undefined);
 }
 let fixtureCalls=0;
 globalThis.fetch=async()=>{fixtureCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({factBrief:'OFFLINE_FIXTURE_NOT_MODEL_OUTPUT',userTask:'OFFLINE_FIXTURE',scopeNotes:[],noteCore:'OFFLINE_FIXTURE',deliverables:['OFFLINE_FIXTURE'],scopedFacts:[],doNotReframe:[]})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}),{status:200,headers:{'Content-Type':'application/json'}});};
 const source=structuredClone(originals['006'].artifacts.content);delete source.data.autoFactBrief;
 const cacheDir=await fs.mkdtemp(path.join(await fs.realpath('.'),'data','alignment-offline-cache-'));
 const formatFixture={factBrief:'OFFLINE_FIXTURE',userTask:'OFFLINE_FIXTURE',scopeNotes:'  局部来源说明  ',noteCore:'OFFLINE_FIXTURE',deliverables:['OFFLINE_FIXTURE'],scopedFacts:[],doNotReframe:[]};
 assert.deepEqual(finalizeAutoTitleFactBrief(source,inputFor(originals['006'],source.data),formatFixture).scopeNotes,['局部来源说明']);
 assert.deepEqual(finalizeAutoTitleFactBrief(source,inputFor(originals['006'],source.data),{...formatFixture,scopeNotes:['局部来源说明']}).scopeNotes,['局部来源说明']);
 assert.throws(()=>finalizeAutoTitleFactBrief(source,inputFor(originals['006'],source.data),{...formatFixture,scopeNotes:23}),/INVALID_AUTO_FACT_BRIEF/);
 const first=await generateAutoTitleFactBrief(source,inputFor(originals['006'],source.data),cacheDir);
 const second=await generateAutoTitleFactBrief(source,inputFor(originals['006'],source.data),cacheDir);
 assert.equal(fixtureCalls,1);assert.deepEqual(first.data.autoFactBrief,second.data.autoFactBrief);
 const unlocked=structuredClone(source);unlocked.data.manualInnerReview.status='needs_review';
 await assert.rejects(()=>generateAutoTitleFactBrief(unlocked,inputFor(originals['006'],unlocked.data),cacheDir));assert.equal(fixtureCalls,1);
 const j=await read(`${batch}/job_001.json`);const tags=await buildV2Tags('delf_b2_writing',j.artifacts.selectedTopic.data,j.artifacts.content.data);
 assert.ok(!tags.some(t=>/信件|建议信|邮件/.test(t)));
 globalThis.fetch=oldFetch;await write('offline.json',{pass:true,aiCalls:0,mockedFixtureCalls:fixtureCalls,cacheReuse:true,coverInputCaptured:true,issues,tags001:tags,sourceHashes:hashes});console.log('OFFLINE_PASS');process.exit(0);
}

const originalFetch=globalThis.fetch;
let active={job:'',stage:''};
globalThis.fetch=async(url:any,init:any)=>{
 assert.ok(String(url).endsWith('/chat/completions'),'ONLY_TEXT_CALLS');
 const ledgerFile=`${out}/calls.json`;let ledger:any[]=[];try{ledger=await read(ledgerFile);}catch{}
 assert.ok(ledger.length<12);assert.ok(!ledger.some(c=>c.job===active.job&&c.stage===active.stage),'NO_RETRIES');
 assert.ok(['fact_brief','title','cover','caption'].includes(active.stage));
 const req=JSON.parse(init.body);ledger.push({...active,model:req.model,started:new Date().toISOString()});await write('calls.json',ledger);
 await write(`${active.job}/${active.stage}-request.json`,req);
 const response=await originalFetch(url,init);
 const raw=await response.clone().text();await write(`${active.job}/${active.stage}-provider.json`,{status:response.status,raw});
 return response;
};

if(process.argv.includes('--live-titles')){
 await fs.mkdir(`${out}/${process.argv.includes('--resume-saved-briefs')?'saved-brief-resume-started':'live-started'}`); // exclusive marker
 for(const id of ids){
  const j=originals[id];active={job:id,stage:'fact_brief'};
  try{
   const source=structuredClone(j.artifacts.content);delete source.data.autoFactBrief;
   let brief;
   if(process.argv.includes('--resume-saved-briefs')){
    const saved=await read(`${out}/${id}/fact_brief-provider.json`);assert.equal(saved.status,200);
    const provider=JSON.parse(saved.raw);assert.equal(provider.choices[0].finish_reason,'stop');
    const raw=JSON.parse(provider.choices[0].message.content);
    const normalized=finalizeAutoTitleFactBrief(source,inputFor(j,source.data),raw);
    assert.equal(normalized.factBrief,raw.factBrief.trim());assert.equal(normalized.userTask,raw.userTask.trim());
    assert.deepEqual(normalized.scopeNotes,typeof raw.scopeNotes==='string'?[raw.scopeNotes.trim()]:raw.scopeNotes);
    const u=provider.usage;
    const usage={...emptyAiUsage(),prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens,total_tokens:u.total_tokens,calls:1,
     by_model:{'qwen3.8-max-0902':{prompt_tokens:u.prompt_tokens,completion_tokens:u.completion_tokens,total_tokens:u.total_tokens,calls:1,unreported_calls:0,cached_tokens:u.prompt_tokens_details?.cached_tokens||0,cache_reported_calls:typeof u.prompt_tokens_details?.cached_tokens==='number'?1:0}},stage_calls:{fact_brief:1}};
    brief={...source,data:{...source.data,autoFactBrief:normalized},usage:mergeAiUsage(source.usage,usage)};
    await fs.mkdir(`${out}/cache`,{recursive:true});
    await fs.writeFile(`${out}/cache/${FACT_BOUNDARY_VERSION}-${normalized.sourceInnerHash}.json`,JSON.stringify(normalized,null,2),{flag:'wx'});
    await write(`${id}/deterministic-replay.json`,{originalProvider:`${id}/fact_brief-provider.json`,change:'scopeNotes string -> one-item string array; no wording edits',aiCalls:0});
   }else{brief=await generateAutoTitleFactBrief(source,inputFor(j,source.data),`${out}/cache`);}
   await write(`${id}/brief.json`,brief);
   const before=(await read(`${out}/calls.json`)).length;
   const cached=await generateAutoTitleFactBrief(source,inputFor(j,source.data),`${out}/cache`);
   assert.deepEqual(cached.data.autoFactBrief,brief.data.autoFactBrief);assert.equal((await read(`${out}/calls.json`)).length,before);
   active={job:id,stage:'title'};
   const titles=await generateTitlePackage(inputFor(j,brief.data));await write(`${id}/titles.json`,titles);
   console.log(JSON.stringify({job:id,brief:brief.data.autoFactBrief,candidates:titles.data.humanSelectableTextTitles},null,2));
  }catch(e){await write(`${id}/failure.json`,{stage:active.stage,error:String(e)});console.log(id,String(e));}
 }
}else{
 const selections=await read(`${out}/test-selections.json`);
 for(const id of ids){
  const j=originals[id],brief=await read(`${out}/${id}/brief.json`),titles=await read(`${out}/${id}/titles.json`);
  const selected=titles.data.humanSelectableTextTitles.find((c:any)=>c.id===selections[id].id);assert.ok(selected);
  await write(`${id}/selection.json`,{...selected,selectionType:'TEST_SELECTION',reason:selections[id].reason});
  const base={topic:j.artifacts.selectedTopic.data,capability:inputFor(j,brief.data).capability,evidence:[],selectedTextTitle:selected};
  active={job:id,stage:'cover'};
  try{
   const cover=await generateFinalCoverBlocks(structuredClone(brief),base);await write(`${id}/cover.json`,cover);
   const card=getCompetitorCreativeCard(cover.data.selectedCoverTemplateId!)!;
   await write(`${id}/cover-compiled.json`,{cardId:card.id,renderer:card.renderer_id,compiled:compileCover(getCapabilityFallback(card),cover.data.coverBlocks)});
  }catch(e){await write(`${id}/cover-failure.json`,{error:String(e)});console.log(id,'COVER',String(e));}
  active={job:id,stage:'caption'};
  try{
   const caption=await generateFinalCaptionAndBridge(structuredClone(brief),{...base,jobId:`TEST_SELECTION_${id}`});
   const tags=await buildV2Tags('delf_b2_writing',base.topic,caption.data);await write(`${id}/caption.json`,caption);await write(`${id}/tags.json`,tags);
   console.log(id,JSON.stringify({caption:caption.data.captionParts,tags}));
  }catch(e){await write(`${id}/caption-failure.json`,{error:String(e)});console.log(id,'CAPTION',String(e));}
 }
}
for(const n of protectedFiles)assert.equal(sha(await fs.readFile(`${batch}/${n}`)),hashes[n],`SOURCE_CHANGED:${n}`);
await write('preservation.json',{unchanged:true,hashes});
console.log('SOURCE_JOBS_UNCHANGED; CALLS', (await read(`${out}/calls.json`)).length);
