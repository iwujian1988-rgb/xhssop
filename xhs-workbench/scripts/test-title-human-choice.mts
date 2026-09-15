import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { generateTitlePackage, buildStandardKnowledgeTitlePromptForTest, standardKnowledgeAssetCountsSupported } from '../src/lib/v2/title-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { stableHash } from '../src/lib/v2/contracts';
import { getDraftTitleSelection, applyDraftTitleSelection } from '../src/lib/draft-title-selection';
import { resolveCanonicalTitlePackage } from '../src/lib/canonical-title-package';
import { buildDraftTxt } from '../src/lib/batch-export';

const root=process.cwd(), prior=path.join(root,'data/title-cover-five-acceptance');
const live=process.argv.includes('--live');
assert.ok(live||process.argv.includes('--offline'));
if(live)nextEnv.loadEnvConfig(root);else process.env.OPENAI_API_KEY='offline-only';
delete process.env.AI_BRIDGE_DIR;
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(p,JSON.stringify(v,null,2));
const approved=await read(path.join(root,'data/title-style-user-approved.json'));
const items=await Promise.all(['A','B','C','D','E'].map(async(label,index)=>{
  const provenance=await read(path.join(prior,label,'provenance.json'));
  const sourceBytes=await fs.readFile(provenance.source,'utf8'),job=JSON.parse(sourceBytes);
  const coverPath=path.join(prior,label,'cover-result.json'),coverBytes=await fs.readFile(coverPath,'utf8');
  const content=JSON.parse(coverBytes).data;
  const hash=['149d2z1','1n0315l','17n9jbz','vuq2bl','9cutlq'][index];
  assert.equal(stableHash(content.innerPages),hash);
  assert.equal(stableHash(job.artifacts.content.data.innerPages),hash);
  assert.equal(content.manualInnerReview.status,'locked');
  assert.equal(content.coverSourceInnerHash,hash);
  const card=getCompetitorCreativeCard(content.selectedCoverTemplateId)!;assert.ok(card);
  const input={topic:job.artifacts.selectedTopic.data,content,capability:getCapabilityFallback(card)};
  const prompt=buildStandardKnowledgeTitlePromptForTest(input);
  assert.equal(prompt.titleCoreInput.shortApprovedStyleReferences.length,31);
  assert.equal(approved.length,31);assert.equal(prompt.titleCoreInput.negativeReferences.length,8);
  assert.ok(prompt.systemPrompt.includes('固定返回4个'));
  assert.ok(prompt.systemPrompt.includes('合计最多1条'));
  assert.ok(prompt.systemPrompt.includes('优先情境相似'));
  assert.ok(!/反常识|痛点型|最推荐|排第一|4到6/.test(prompt.systemPrompt));
  return {label,provenance,sourceBytes,coverPath,coverBytes,input,job,prompt};
}));
const pair=(textTitle:string)=>({textTitle,coverTitle:'B2写作',coverSubtitle:'写作材料',mechanism:'test',userRelation:'',noveltyFingerprint:'test'});
for(const [i,text,expected] of [[2,'B2写作词汇内化三步走',true],[2,'B2写作词汇内化四步走',false],[3,'B2写作这3类场景别踩雷',true],[3,'B2写作这4类场景别踩雷',false],[3,'B2写作交卷前必查3点',true],[4,'B2写作范文拆解5步',true],[4,'B2写作范文拆解6步',false]] as const)
  assert.equal(standardKnowledgeAssetCountsSupported(pair(text),items[i].input),expected,text);
for(const bullets of [['🚀 第一步：回顾','📝 第二步：造句','✅ 第三步：自检','💡 补充建议'],['1. 回顾','2. 造句','3. 自检'],['1️⃣回顾','2️⃣造句','3️⃣自检'],['A：回顾','B：造句','C：自检']]){
  const input=structuredClone(items[2].input);input.content.innerPages=[{page_title:'行动步骤',lead:'操作方法',bullets}];
  assert.equal(standardKnowledgeAssetCountsSupported(pair('3步行动方法'),input),true,JSON.stringify(bullets));
  input.content.innerPages[0].bullets=[bullets[0],bullets[0],bullets[2]];
  assert.equal(standardKnowledgeAssetCountsSupported(pair('3步行动方法'),input),false,'duplicate ordinal');
}
const draft=structuredClone(items[0].job.draft);
draft.downstreamStale=false;
draft.titlePackage={titleBundles:(await read(path.join(prior,'A/title-result.json'))).data.titleBundles};
const canonical=resolveCanonicalTitlePackage(draft);assert.ok(canonical.bundles.length);
draft.titlePackage={...draft.titlePackage,titleBundles:canonical.bundles,humanSelectedCandidateId:null};
const selection=getDraftTitleSelection(draft,0);
const preview=applyDraftTitleSelection(draft,selection);
assert.equal(preview.titlePackage!.humanSelectedCandidateId,null);
assert.throws(()=>buildDraftTxt(preview),/TITLE_AWAITING_HUMAN_CHOICE/);
const confirmed=applyDraftTitleSelection(draft,selection,true);
assert.equal(confirmed.titlePackage!.humanSelectedCandidateId,selection.bundleId);
assert.equal(resolveCanonicalTitlePackage(JSON.parse(JSON.stringify(confirmed))).humanSelectedCandidateId,selection.bundleId);
assert.doesNotThrow(()=>buildDraftTxt(confirmed));
assert.throws(()=>applyDraftTitleSelection(draft,{...selection,bundleId:'missing'},true),/NOT_FOUND/);

const output=live?path.join(root,'data/title-human-choice-acceptance'):await fs.mkdtemp(path.join(root,'.tmp-title-human-choice-'));
if(live)await fs.mkdir(output); // Exclusive, including partial runs. No automatic retries.
const networkFetch=globalThis.fetch;let active=output,label='',perJob=0;
const calls:string[]=[],results:any[]=[];
globalThis.fetch=async(url,options)=>{
  assert.equal(perJob,0,'NO_RETRIES');assert.ok(calls.length<5);perJob++;calls.push(label);
  const request=JSON.parse(String(options?.body));
  const payload=JSON.parse(request.messages[1].content);
  assert.equal(payload.userApprovedStyleReferences.length,31);assert.equal(payload.negativeReferences.length,8);
  assert.ok(payload.wholeNoteOutline);assert.ok(!('coverBlocks' in payload.cover));
  await write(path.join(active,'request.json'),request);
  await write(path.join(output,'calls.json'),{coverCalls:0,titleCalls:live?calls.length:0,labels:calls});
  if(!live){
    const anchor={A:'正式信语气',B:'远程办公论据',C:'词汇表达',D:'交卷检查',E:'范文拆解'}[label]!;
    const candidates=['怎么用？','值得看','先存好','用起来'].map((end,i)=>({...pair(`B2写作${anchor}${end}`),coverTitle:`B2写作${anchor}`,coverSubtitle:anchor,clickReason:`写作时想知道${anchor}的用法`,referenceApprovedIds:['A25'],...(i===3?{coverTitle:'超长'.repeat(30)}:{})}));
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({candidates})}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  }
  const response=await networkFetch(url,options);
  await fs.writeFile(path.join(active,'provider-response.json'),await response.clone().text());
  return response;
};
try{
  process.chdir(output);
  for(const item of items){
    label=item.label;active=path.join(output,label);await fs.mkdir(active);perJob=0;
    await write(path.join(active,'provenance.json'),{...item.provenance,reusedCover:item.coverPath});
    await write(path.join(active,'input.json'),item.input);
    try{
      const result=await generateTitlePackage(item.input);
      assert.equal(result.data.humanSelectedCandidateId,null);
      assert.equal(result.data.recommendedBundleId,undefined);
      if(!live){assert.equal(result.data.titleStageTrace!.normalizedBundles.length,4);assert.equal(result.data.candidates.length,3);assert.ok(result.data.titleStageTrace!.normalizedBundles[3].warnings?.includes('COVER_ONLY_FAILURE'));}
      await write(path.join(active,'result.json'),result);
      results.push({label,candidates:result.data.titleStageTrace?.normalizedBundles,validCandidates:result.data.candidates,humanSelectedCandidateId:null,usage:result.usage,requestId:result.request_id});
    }catch(error){const failure={label,error:String(error),debug:(error as any).titleDebug,usage:(error as any).usage};await write(path.join(active,'failure.json'),failure);results.push(failure);}
    await write(path.join(output,'summary.json'),{live,coverCalls:0,titleCalls:live?calls.length:0,results});
    console.log(JSON.stringify({label,ok:!results.at(-1).error,calls:calls.length}));
  }
}finally{process.chdir(root);globalThis.fetch=networkFetch;}
for(const item of items){assert.equal(await fs.readFile(item.provenance.source,'utf8'),item.sourceBytes);assert.equal(await fs.readFile(item.coverPath,'utf8'),item.coverBytes);}
assert.deepEqual(await read(path.join(root,'data/title-style-user-approved.json')),approved);
await write(path.join(output,'preservation.json'),{sourceJobsUnchanged:true,priorCoverArtifactsUnchanged:true,approved31Unchanged:true,aiCalls:live?calls.length:0});
console.log(JSON.stringify({output,aiCalls:live?calls.length:0}));
if(!live)assert.ok(results.every(r=>!r.error),JSON.stringify(results));
