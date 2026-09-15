import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { generateTitlePackage, buildStandardKnowledgeTitlePromptForTest, assessStandardKnowledgeTitlePair, standardKnowledgeAssetCountsSupported } from '../src/lib/v2/title-stage';
import { generateFinalCoverBlocks } from '../src/lib/v2/content-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { stableHash } from '../src/lib/v2/contracts';

// Acceptance harness only. Does not save Jobs or orchestrate downstream production.
const root = process.cwd();
const live = process.argv.includes('--live');
assert.ok(live || process.argv.includes('--offline'));
if (live) nextEnv.loadEnvConfig(root); else process.env.OPENAI_API_KEY = 'offline-only';
delete process.env.AI_BRIDGE_DIR;
const read = async (p:string) => JSON.parse(await fs.readFile(p,'utf8'));
const write = async (p:string,v:unknown) => fs.writeFile(p,JSON.stringify(v,null,2));
const sources = [
  ['A','batch_human_review_1788691220835','job_001','149d2z1'],
  ['B','batch_human_review_1788691220835','job_002','1n0315l'],
  ['C','batch_human_review_1788691220835','job_003','17n9jbz'],
  ['D','batch_title_v1_pending_review','job_001','vuq2bl'],
  ['E','batch_title_v1_pending_review','job_003','9cutlq'],
];
const items = await Promise.all(sources.map(async ([label,batch,id,hash]) => {
  const file = path.join(root,`data/batches/${batch}/jobs/${id}.json`);
  const bytes = await fs.readFile(file,'utf8'), job = JSON.parse(bytes), content = job.artifacts.content.data;
  assert.equal(content.manualInnerReview.status,'locked');
  assert.equal(content.manualInnerReview.innerHash,hash);
  assert.equal(stableHash(content.innerPages),hash);
  const card = getCompetitorCreativeCard(content.selectedCoverTemplateId || job.reference_card_id)!;
  assert.ok(card);
  return {label,file,bytes,hash,job,input:{topic:job.artifacts.selectedTopic.data,content,capability:getCapabilityFallback(card)}};
}));
assert.equal(items[0].input.content.coverSourceInnerHash,'149d2z1');
assert.ok(items[0].input.content.coverBlocks.length);
const approved = await read(path.join(root,'data/title-style-user-approved.json'));
assert.equal(approved.length,31);
for (const {input} of items) {
  const p = buildStandardKnowledgeTitlePromptForTest(input);
  assert.equal(p.styleReferences.length,31);
  assert.equal(p.titleCoreInput.shortApprovedStyleReferences.length,31);
  assert.deepEqual(p.titleCoreInput.shortApprovedStyleReferences.map(x=>x.id),approved.map((_:unknown,i:number)=>`A${String(i+1).padStart(2,'0')}`));
  assert.equal(p.titleCoreInput.negativeReferences.length,8);
  assert.equal('finalContentSnapshot' in p.titleCoreInput,false);
  assert.equal(p.titleCoreInput.wholeNoteBrief.pageCount,p.titleCoreInput.wholeNoteBrief.pages.length);
  assert.deepEqual(Object.keys(p.titleCoreInput).sort(),['product','finalPublicTopic','wholeNoteOutline','finalContentSnapshot','cover','userApprovedStyleReferences','negativeReferences'].sort());
  const poisoned = structuredClone(input);
  poisoned.content.captionParts = { opening:'POISON',value:['POISON'],productBridge:'POISON',cta:'POISON' };
  poisoned.topic.promise = 'POISON'; poisoned.topic.audienceState = 'POISON';
  poisoned.content.coverCandidates = [{templateId:'POISON',fitReason:'POISON',coverBlocks:[]}];
  for(const block of poisoned.content.coverBlocks) {
    block.heading = 'POISON';
    for(const x of block.items) { x.primary='POISON';x.secondary='POISON';x.note='POISON'; }
  }
  assert.deepEqual(buildStandardKnowledgeTitlePromptForTest(poisoned).titleCoreInput,p.titleCoreInput);
}
const pair = (textTitle:string,coverTitle='B2写作',coverSubtitle='写作材料') => ({textTitle,coverTitle,coverSubtitle,mechanism:'test',userRelation:'',noveltyFingerprint:'test'});
for (const [i,text,expected] of [[3,'B2写作交卷前必查3点',true],[3,'B2写作交卷前必查4点',false],[4,'B2写作范文拆解5步',true],[4,'B2写作范文拆解6步',false],[1,'5大主题论据',true],[1,'10大主题论据',false],[2,'5组表达对照',true],[2,'7组表达对照',false],[0,'16条表达',true],[0,'17条表达',false]] as const) {
  assert.equal(standardKnowledgeAssetCountsSupported(pair(text),items[i].input),expected,text);
}
const a = items[0].input;
const good = pair('B2正式信语气怎么选？','正式信语气怎么选','开场白与礼貌表达');
assert.equal(assessStandardKnowledgeTitlePair(good,a).bundleValid,true);
const badCover = {...good,coverTitle:'标题'.repeat(20)};
const split = assessStandardKnowledgeTitlePair(badCover,a);
assert.equal(split.textTitleValid,true);assert.equal(split.coverValid,false);assert.equal(split.bundleValid,false);
assert.equal(assessStandardKnowledgeTitlePair({...good,textTitle:'文字'.repeat(30)},a).textTitleValid,false);
assert.equal(assessStandardKnowledgeTitlePair({...good,coverTitle:'TCF正式信语气'},a).coverValid,false);
const noIdentity = {...a,capability:getCapabilityFallback(getCompetitorCreativeCard('resource_10_plain_text_experience')!)};
assert.equal(assessStandardKnowledgeTitlePair(good,noIdentity).coverValid,false);
assert.equal(assessStandardKnowledgeTitlePair({...good,coverSubtitle:'B2写作礼貌表达'},noIdentity).coverValid,true);

const output = live ? path.join(root,'data/title-cover-five-acceptance') : await fs.mkdtemp(path.join(root,'.tmp-title-cover-five-'));
if(live) await fs.mkdir(output); // Exclusive: never rerun/overwrite a partial or completed live run.
const originalFetch = globalThis.fetch;
const calls:Array<{label:string;stage:string}> = [];
let active = output, label = '', stage = '', perStage = 0;
const results:any[] = [];
globalThis.fetch = async (url,options) => {
  assert.ok(stage==='title'||stage==='cover','FORBIDDEN_STAGE');
  assert.ok(perStage===0 && calls.length<9,'NO_RETRIES_OR_EXTRA_CALLS');
  if(stage==='cover')assert.notEqual(label,'A');
  perStage++;calls.push({label,stage});
  const req=JSON.parse(String(options?.body));
  await write(path.join(active,`${stage}-request.json`),req);
  await write(path.join(output,'calls.json'),{calls,aiCalls:live?calls.length:0});
  if(!live) {
    const anchor = {A:'正式信语气',B:'远程办公论据',C:'词汇表达',D:'交卷检查',E:'范文拆解'}[label]!;
    const seed=pair(`B2写作${anchor}怎么用？`,`B2写作${anchor}`,anchor);
    const candidates=[{...seed,coverTitle:'封面'.repeat(30)},...['先存好','别忽略','怎么练','用起来','值得看'].map(s=>({...seed,textTitle:`B2写作${anchor}${s}`}))].map(c=>({...c,clickReason:anchor,referenceApprovedIds:['A07','A25']}));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({candidates})}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  }
  const response=await originalFetch(url,options);
  await fs.writeFile(path.join(active,`${stage}-provider-response.json`),await response.clone().text());
  return response;
};
try {
  for(const item of items) {
    label=item.label;active=path.join(output,label);await fs.mkdir(active);
    await write(path.join(active,'provenance.json'),{source:item.file,lockedInnerHash:item.hash,reuseCover:label==='A'});
    let contentArtifact=structuredClone(item.job.artifacts.content);
    try {
      if(live && label!=='A') {
        stage='cover';perStage=0;process.chdir(root); // Preserve existing template asset availability.
        contentArtifact=await generateFinalCoverBlocks(contentArtifact,{topic:item.input.topic,capability:item.input.capability,evidence:contentArtifact.data.evidence||[]});
      }
      await write(path.join(active,'cover-result.json'),contentArtifact);
      const matched=contentArtifact.data.selectedCoverTemplateId;
      const card=getCompetitorCreativeCard(matched || item.job.reference_card_id)!;
      assert.ok(card);
      if(live) {assert.ok(matched);assert.equal(contentArtifact.data.coverSourceInnerHash,item.hash);}
      const input={...item.input,content:contentArtifact.data,capability:getCapabilityFallback(card)};
      await write(path.join(active,'title-input.json'),input);
      await write(path.join(active,'title-prompt.json'),buildStandardKnowledgeTitlePromptForTest(input));
      stage='title';perStage=0;process.chdir(output);
      const result=await generateTitlePackage(input);
      await write(path.join(active,'title-result.json'),result);
      if(!live) {
        assert.equal(result.data.titleStageTrace?.normalizedBundles?.length,4);
        const first=result.data.titleStageTrace!.normalizedBundles[0];
        assert.equal(first.textTitleValid,true);assert.equal(first.coverValid,false);
        assert.ok(first.warnings?.includes('COVER_ONLY_FAILURE'));
        assert.equal(result.data.selected.bundleValid,true);
      }
      results.push({label,templateId:matched,selected:result.data.selected,candidates:result.data.titleStageTrace?.normalizedBundles,requestId:result.request_id});
    } catch(error) {
      const failure={label,stage,error:String(error),debug:(error as any).titleDebug,coverCandidates:(error as any).coverCandidates,usage:(error as any).usage};
      await write(path.join(active,'failure.json'),failure);results.push(failure);
    }
    assert.equal(await fs.readFile(item.file,'utf8'),item.bytes);
    await write(path.join(output,'summary.json'),{live,calls,aiCalls:live?calls.length:0,results});
    console.log(JSON.stringify({label,stage,ok:!results.at(-1).error,calls:calls.length}));
  }
} finally { process.chdir(root);globalThis.fetch=originalFetch; }
for(const item of items)assert.equal(await fs.readFile(item.file,'utf8'),item.bytes);
await write(path.join(output,'preservation.json'),{allFiveSourceJobsByteUnchanged:true,lockedInnerHashes:items.map(x=>x.hash)});
console.log(JSON.stringify({output,coverCalls:calls.filter(x=>x.stage==='cover').length,titleCalls:calls.filter(x=>x.stage==='title').length,aiCalls:live?calls.length:0}));
if(!live)assert.ok(results.every(r=>!r.error),JSON.stringify(results.filter(r=>r.error)));
