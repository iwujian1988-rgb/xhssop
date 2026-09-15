import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { generateTitlePackage, buildStandardKnowledgeTitlePromptForTest, filterStandardKnowledgeTitleCandidates, standardKnowledgeAssetCountsSupported } from '../src/lib/v2/title-stage';
import { getDelfB2ShortStyleReferences } from '../src/lib/v2/title-style-library';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { stableHash, countVisibleUnits, type TitlePair } from '../src/lib/v2/contracts';
import { resolveCanonicalTitlePackage } from '../src/lib/canonical-title-package';
import { getDraftTitleSelection, applyDraftTitleSelection } from '../src/lib/draft-title-selection';
import { buildDraftTxt } from '../src/lib/batch-export';

const root=process.cwd(),prior=path.join(root,'data/title-cover-five-acceptance');
const inputContext=process.argv.includes('--input-context');
const simplified=process.argv.includes('--simplified');
const live=process.argv.includes('--live');assert.ok(live||process.argv.includes('--offline'));
if(live)nextEnv.loadEnvConfig(root);else process.env.OPENAI_API_KEY='offline-only';
delete process.env.AI_BRIDGE_DIR;
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(p,JSON.stringify(v,null,2));
const originalPath=path.join(root,'data/title-style-user-approved.json'),originalBytes=await fs.readFile(originalPath,'utf8');
const shortRows=getDelfB2ShortStyleReferences().map(r=>({...r,visibleUnits:countVisibleUnits(r.title)}));
assert.equal(shortRows.length,31);assert.ok(shortRows.every(r=>r.visibleUnits<=20));
console.log(JSON.stringify({shortReferences:shortRows}));
const items=await Promise.all(['A','B','C','D','E'].map(async(label,i)=>{
  const provenance=await read(path.join(prior,label,'provenance.json'));
  const sourceBytes=await fs.readFile(provenance.source,'utf8'),job=JSON.parse(sourceBytes);
  const coverPath=path.join(prior,label,'cover-result.json'),coverBytes=await fs.readFile(coverPath,'utf8'),content=JSON.parse(coverBytes).data;
  const hash=['149d2z1','1n0315l','17n9jbz','vuq2bl','9cutlq'][i];
  assert.equal(stableHash(content.innerPages),hash);assert.equal(stableHash(job.artifacts.content.data.innerPages),hash);
  assert.equal(content.manualInnerReview.status,'locked');assert.equal(content.coverSourceInnerHash,hash);
  const card=getCompetitorCreativeCard(content.selectedCoverTemplateId)!;assert.ok(card);
  const input={topic:job.artifacts.selectedTopic.data,content,capability:getCapabilityFallback(card)};
  const prompt=buildStandardKnowledgeTitlePromptForTest(input);
  assert.equal(prompt.titleCoreInput.shortApprovedStyleReferences.length,31);assert.equal(prompt.titleCoreInput.negativeReferences.length,8);
  assert.deepEqual(Object.keys(prompt.titleCoreInput).sort(),['product','wholeNoteBrief','supportedAssets','cover','shortApprovedStyleReferences','negativeReferences'].sort());
  assert.ok(!JSON.stringify(prompt.titleCoreInput).includes('bullets'));
  assert.ok(prompt.systemPrompt.includes('固定返回6个'));
  if(inputContext||simplified){
    const previous=await read(path.join(root,'data/title-final-cleanup-acceptance',label,'request.json'));
    const old=JSON.parse(previous.messages[1].content);
    assert.deepEqual(prompt.titleCoreInput.shortApprovedStyleReferences.map(({id,title})=>({id,title})),old.shortApprovedStyleReferences);
    assert.ok(getDelfB2ShortStyleReferences().every(r=>typeof r.whenToUse==='string'&&r.whenToUse.length>0));
    assert.deepEqual(prompt.titleCoreInput.negativeReferences,old.negativeReferences);
    assert.ok(!('cover' in prompt.titleCoreInput));
    const anchors=prompt.titleCoreInput.concreteAnchors;
    assert.ok(anchors.flatMap(p=>p.terms).length<=24);
    assert.ok(anchors.every(p=>p.terms.length<=3&&p.terms.every(t=>countVisibleUnits(t)<=24)));
    for(const row of anchors){const page=content.innerPages.find((p:any)=>p.page_no===row.page_no);const text=[page.page_title,page.lead,...page.bullets].join('\n');assert.ok(row.terms.every(t=>text.includes(t)));}
  }
  const poisoned=structuredClone(input);
  poisoned.content.innerPages[0].bullets[0]+=' NEVER_SEND_FULL_INNER_BULLET';
  poisoned.content.captionParts={opening:'NEVER_SEND_CAPTION',value:[],productBridge:'NEVER_SEND_BRIDGE',cta:'NEVER_SEND_CTA'};
  poisoned.topic.audienceState='NEVER_SEND_AUDIENCE';
  (poisoned.topic as any).finalPublicTopic='NEVER_SEND_TOPIC';
  assert.ok(!prompt.systemPrompt.includes('jobReferenceApprovedIds'));
  assert.ok(!('finalPublicTopic' in prompt.titleCoreInput));
  assert.ok(!JSON.stringify(buildStandardKnowledgeTitlePromptForTest(poisoned).titleCoreInput).includes('NEVER_SEND'));
  return {label,input,provenance,sourceBytes,coverPath,coverBytes,job};
}));
const pair=(textTitle:string):TitlePair=>({textTitle,coverTitle:'B2正式信语气',coverSubtitle:'开场白与礼貌表达',mechanism:'test',userRelation:'',noveltyFingerprint:'test'});
const four=['B2正式信语气怎么选？','正式信开场白这样用','B2正式信礼貌表达','写信时语气怎么拿捏？'].map(pair);
const filter=(p:TitlePair[])=>filterStandardKnowledgeTitleCandidates(p,items[0].input);
assert.equal(filter(four).humanSelectableCandidates.length,4);
const negative=filter([pair('别乱写正式信语气'),pair('告别正式信语气问题'),...four]);
assert.equal(negative.humanSelectableCandidates.filter(c=>/^(别|告别)/.test(c.textTitle)).length,1);
assert.ok(negative.evaluated[1].filterReasons.includes('NEGATIVE_IMPERATIVE_FAMILY_LIMIT'));
assert.equal(filter([pair('超'.repeat(21)),pair('长'.repeat(21)),...four]).humanSelectableCandidates.length,4);
assert.equal(filter([pair('B2正式信99条表达'),...four]).evaluated[0].pair.textTitleValid,false);
const duplicates=filter([four[0],{...four[0],textTitle:' B2正式信语气怎么选? '},...four.slice(1),pair('正式信表达先存好')]);
assert.ok(duplicates.evaluated[1].filterReasons.includes('NORMALIZED_DUPLICATE'));
assert.equal(duplicates.humanSelectableCandidates.length,4);
// Shared prefixes and question syntax do NOT constitute duplicate evidence.
assert.equal(filter([pair('B2正式信语气怎么选？'),pair('B2正式信开场怎么写？')]).humanSelectableCandidates.length,2);
const textOnly=filter([{...four[0],coverTitle:'超'.repeat(30)},...four.slice(1)]);
assert.equal(textOnly.evaluated[0].pair.textTitleValid,true);assert.equal(textOnly.evaluated[0].pair.bundleValid,false);
assert.equal(textOnly.humanSelectableCandidates.length,3);assert.ok(textOnly.evaluated[0].pair.warnings?.includes('COVER_ONLY_FAILURE'));
assert.equal(standardKnowledgeAssetCountsSupported(pair('3步内化方法'),items[2].input),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('4步内化方法'),items[2].input),false);
assert.equal(standardKnowledgeAssetCountsSupported(pair('3类场景'),items[3].input),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('4类场景'),items[3].input),false);

const draft=structuredClone(items[0].job.draft);draft.downstreamStale=false;
draft.titlePackage={titleBundles:(await read(path.join(prior,'A/title-result.json'))).data.titleBundles,humanSelectedCandidateId:null};
const preview=applyDraftTitleSelection(draft,getDraftTitleSelection(draft,0));
assert.equal(resolveCanonicalTitlePackage(preview).humanSelectedCandidateId,null);
assert.throws(()=>buildDraftTxt(preview),/TITLE_AWAITING_HUMAN_CHOICE/);
assert.ok(resolveCanonicalTitlePackage(applyDraftTitleSelection(draft,getDraftTitleSelection(draft,0),true)).humanSelectedCandidateId);

const output=live?path.join(root,simplified?'data/title-simplified-acceptance':inputContext?'data/title-input-context-acceptance':'data/title-final-cleanup-acceptance'):await fs.mkdtemp(path.join(root,'.tmp-title-final-cleanup-'));
if(live)await fs.mkdir(output); // Exclusive even after failure: never silently rerun a Job.
await write(path.join(output,'short-reference-counts.json'),shortRows);
const realFetch=globalThis.fetch;let active=output,label='',perJob=0;let mockResponse:unknown;
const calls:string[]=[],results:any[]=[];
globalThis.fetch=async(url,options)=>{
  assert.equal(perJob,0,'NO_RETRY');assert.ok(calls.length<(live?5:9));perJob++;calls.push(label);
  const request=JSON.parse(String(options?.body));
  const payload=JSON.parse(request.messages[1].content);
  assert.equal(payload.shortApprovedStyleReferences.length,31);assert.ok(!('finalContentSnapshot' in payload));
  assert.ok(!JSON.stringify(payload).includes('bullets'));
  await write(path.join(active,'request.json'),request);
  await write(path.join(output,'calls.json'),{coverCalls:0,titleCalls:live?calls.length:0,attempts:calls});
  if(!live)return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(mockResponse)}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  const response=await realFetch(url,options);await fs.writeFile(path.join(active,'provider-response.json'),await response.clone().text());return response;
};
try{
  process.chdir(output);
  if(!live){
    for(const count of [4,5,7]){
      label=`raw-count-${count}`;active=path.join(output,label);await fs.mkdir(active);perJob=0;
      mockResponse={candidates:Array.from({length:count},(_,i)=>four[i%four.length])};
      await assert.rejects(generateTitlePackage(items[0].input),(error:any)=>{
        assert.equal(error.message,`INVALID_TITLE_RAW_CANDIDATE_COUNT:${count}/6`);
        assert.deepEqual(error.titleDebug.humanSelectableCandidates,[]);return true;
      });
    }
    label='insufficient';active=path.join(output,label);await fs.mkdir(active);perJob=0;
    mockResponse={candidates:[...four.slice(0,3),{...four[3],coverTitle:'超'.repeat(30)},four[0],four[1]]};
    await assert.rejects(generateTitlePackage(items[0].input),(error:any)=>{
      assert.match(error.message,/INSUFFICIENT_VALID_TITLE_CANDIDATES:3\/4/);
      assert.deepEqual(error.titleDebug.humanSelectableCandidates,[]);
      return true;
    });
  }
  for(const item of items){
    label=item.label;active=path.join(output,label);await fs.mkdir(active);perJob=0;
    await write(path.join(active,'provenance.json'),{...item.provenance,reusedCover:item.coverPath});
    await write(path.join(active,'validator-input.json'),item.input);
    if(!live){const anchor={A:'正式信语气',B:'远程办公论据',C:'词汇表达',D:'交卷检查',E:'范文拆解'}[label]!;
      mockResponse={candidates:['怎么用？','先存好','值得看','用起来','很实用','怎么练？'].map(end=>({...pair(`B2写作${anchor}${end}`),coverTitle:`B2写作${anchor}`,coverSubtitle:anchor,clickReason:`写作时需要${anchor}`,referenceApprovedId:'A15'}))};}
    try{
      const result=await generateTitlePackage(item.input);
      assert.equal(result.data.humanSelectedCandidateId,null);assert.equal(result.data.humanSelectableCandidates?.length,4);
      assert.ok(result.data.humanSelectableCandidates!.every(c=>c.bundleValid&&c.textTitleValid&&c.coverValid));
      assert.equal(result.data.candidates.length,4);
      await write(path.join(active,'result.json'),result);
      results.push({label,humanSelectedCandidateId:null,jobReferenceApprovedIds:result.data.jobReferenceApprovedIds,rawCandidates:result.data.titleStageTrace?.normalizedBundles,humanSelectableCandidates:result.data.humanSelectableCandidates,usage:result.usage,requestId:result.request_id});
    }catch(error){const failure={label,error:String(error),debug:(error as any).titleDebug,usage:(error as any).usage};await write(path.join(active,'failure.json'),failure);results.push(failure);}
    await write(path.join(output,'summary.json'),{live,coverCalls:0,titleCalls:live?calls.length:0,results});
    console.log(JSON.stringify({label,ok:!results.at(-1).error,calls:calls.length}));
  }
}finally{process.chdir(root);globalThis.fetch=realFetch;}
assert.equal(await fs.readFile(originalPath,'utf8'),originalBytes);
for(const i of items){assert.equal(await fs.readFile(i.provenance.source,'utf8'),i.sourceBytes);assert.equal(await fs.readFile(i.coverPath,'utf8'),i.coverBytes);}
await write(path.join(output,'preservation.json'),{originalApprovedByteUnchanged:true,sourceJobsByteUnchanged:true,priorCoverByteUnchanged:true,aiCalls:live?calls.length:0});
console.log(JSON.stringify({output,aiCalls:live?calls.length:0}));
if(!live)assert.ok(results.every(r=>!r.error),JSON.stringify(results));
