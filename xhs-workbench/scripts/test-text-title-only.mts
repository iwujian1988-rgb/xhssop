import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {generateTitlePackage,buildStandardKnowledgeTitlePromptForTest,filterTextTitleCandidates,isObviousCatalogTextTitle} from '../src/lib/v2/title-stage';
import {stableHash,countVisibleUnits} from '../src/lib/v2/contracts';
import {getDraftTitleSelection,applyDraftTitleSelection} from '../src/lib/draft-title-selection';
import {requireHumanSelectedTextTitle} from '../src/lib/canonical-title-package';
import {buildDraftTxt} from '../src/lib/batch-export';
const root=process.cwd(),live=process.argv.includes('--live');
assert.ok(live||process.argv.includes('--offline'));if(live)nextEnv.loadEnvConfig(root);else process.env.OPENAI_API_KEY='offline-only';
delete process.env.AI_BRIDGE_DIR;
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(p,JSON.stringify(v,null,2));
const protectedFiles=['data/title-style-user-approved.json','data/title-style-short-approved.json'];
const saved=await Promise.all(protectedFiles.map(p=>fs.readFile(path.join(root,p),'utf8')));
const items=await Promise.all(['A','B','C','D','E'].map(async(label,i)=>{
 const input=await read(path.join(root,'data/title-input-context-acceptance',label,'validator-input.json'));
 const provenance=await read(path.join(root,'data/title-cover-five-acceptance',label,'provenance.json'));
 const sourceBytes=await fs.readFile(provenance.source,'utf8');const job=JSON.parse(sourceBytes);
 const hash=['149d2z1','1n0315l','17n9jbz','vuq2bl','9cutlq'][i];
 assert.equal(stableHash(input.content.innerPages),hash);assert.equal(stableHash(job.artifacts.content.data.innerPages),hash);assert.equal(input.content.manualInnerReview.status,'locked');
 const prompt=buildStandardKnowledgeTitlePromptForTest(input);
 assert.deepEqual(Object.keys(prompt.titleCoreInput).sort(),['wholeNoteBrief','concreteAnchors','supportedAssets','shortApprovedStyleReferences','negativeReferences'].sort());
 assert.ok(!/cover|finalPublicTopic|bullets|caption|cta|promo/i.test(JSON.stringify(prompt.titleCoreInput)));
 const poisoned=structuredClone(input);poisoned.content.coverBlocks=[];poisoned.capability.renderer='NONEXISTENT';poisoned.topic.finalPublicTopic='NEVER_SEND';poisoned.topic.audienceState='NEVER_SEND';
 assert.deepEqual(buildStandardKnowledgeTitlePromptForTest(poisoned).titleCoreInput,prompt.titleCoreInput);
 return {label,input,provenance,sourceBytes,job};
}));
const c=(textTitle:string)=>({textTitle,clickReason:'想把正式信的语气写得合适',referenceApprovedId:'A15'});
assert.equal(isObviousCatalogTextTitle('B2写完不放心？照清单查一下'),false);
assert.equal(isObviousCatalogTextTitle('B2正式信句型速查'),true);
const four=['B2正式信开场怎么写？','B2正式信语气怎么选？','B2正式信结尾怎么写？','B2正式信建议怎么提？'].map(c);
const filtered=filterTextTitleCandidates([...four,c('字'.repeat(21)),c('B2正式信99条表达'),four[0],c('B2正式信稳拿高分')],items[0].input);
assert.equal(filtered.humanSelectableTextTitles.length,4);assert.equal(filtered.survivalCount,4);
assert.ok(filtered.evaluated[4].filterReasons.includes('TEXT_TITLE_OVER_20'));
assert.ok(filtered.evaluated[5].filterReasons.includes('UNSUPPORTED_FACTS_COUNTS'));
assert.ok(filtered.evaluated[6].filterReasons.includes('NORMALIZED_DUPLICATE'));
assert.ok(filtered.evaluated[7].filterReasons.includes('UNSUPPORTED_MARKETING_FACT'));
assert.equal(filterTextTitleCandidates([c('别乱写B2正式信'),c('告别B2正式信语气错位'),...four],items[0].input).evaluated[1].filterReasons.includes('NEGATIVE_FAMILY_LIMIT'),true);
const catalog=filterTextTitleCandidates(['B2正式信开场指南','B2正式信语气手册','B2正式信结尾速查',...four.map(c=>c.textTitle)].map(c),items[0].input);
assert.ok(catalog.evaluated[2].filterReasons.includes('CATALOG_FAMILY_LIMIT'));
const output=live?path.join(root,'data/text-title-only-acceptance'):await fs.mkdtemp(path.join(root,'.tmp-text-only-'));
if(live)await fs.mkdir(output);
const realFetch=globalThis.fetch;let active=output,label='',perJob=0,mock:unknown;const calls:string[]=[],results:any[]=[];
globalThis.fetch=async(url,options)=>{
 assert.equal(perJob++,0,'NO_RETRY');assert.ok(calls.length<(live?5:6));calls.push(label);
 const request=JSON.parse(String(options?.body));const payload=JSON.parse(request.messages[1].content);
 assert.ok(!('cover' in payload)&&!('finalPublicTopic' in payload));assert.equal(payload.shortApprovedStyleReferences.length,31);
 await write(path.join(active,'request.json'),request);await write(path.join(output,'calls.json'),{titleCalls:live?calls.length:0,coverCopyCalls:0,coverMatcherCalls:0,attempts:calls});
 if(!live)return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(mock)}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
 const response=await realFetch(url,options);await fs.writeFile(path.join(active,'provider-response.json'),await response.clone().text());return response;
};
try{
 process.chdir(output);
 if(!live){label='raw-count';active=path.join(output,label);await fs.mkdir(active);perJob=0;mock={candidates:four};await assert.rejects(generateTitlePackage(items[0].input),/INVALID_TEXT_TITLE_RAW_COUNT:4\/8/);}
 for(const item of items){
  label=item.label;active=path.join(output,label);await fs.mkdir(active);perJob=0;
  await write(path.join(active,'validator-input.json'),item.input);await write(path.join(active,'provenance.json'),item.provenance);
  const anchor={A:'正式信语气',B:'远程办公论据',C:'词汇表达',D:'交卷检查',E:'范文拆解'}[label]!;
  mock={candidates:['怎么用？','怎么练？','先存好','这样用','怎么写？','怎么选？','用起来','怎么查？'].map(s=>c(`B2写作${anchor}${s}`))};
  try{
   const result=await generateTitlePackage(item.input);await write(path.join(active,'result.json'),result);
   assert.equal(result.data.humanSelectedTextTitleId,null);assert.equal(result.data.humanSelectableTextTitles?.length,4);
   assert.ok(result.data.humanSelectableTextTitles!.every(c=>!('coverTitle' in c)&&countVisibleUnits(c.textTitle)<=20));
   const draft=structuredClone(item.job.draft);draft.downstreamStale=false;draft.titlePackage={...result.data,titleBundles:result.data.candidates};
   const preview=applyDraftTitleSelection(draft,getDraftTitleSelection(draft,0));
   assert.throws(()=>requireHumanSelectedTextTitle(preview),/AWAITING_HUMAN/);assert.throws(()=>buildDraftTxt(preview),/AWAITING_HUMAN/);
   const chosen=applyDraftTitleSelection(draft,getDraftTitleSelection(draft,1),true);
   assert.equal(requireHumanSelectedTextTitle(chosen).id,result.data.humanSelectableTextTitles![1].id);
   assert.deepEqual(chosen.cover,draft.cover);assert.throws(()=>buildDraftTxt(chosen),/COVER_COPY_PENDING/);
   const invalid=structuredClone(chosen);invalid.titlePackage!.humanSelectedTextTitleId='stale';assert.throws(()=>requireHumanSelectedTextTitle(invalid),/AWAITING_HUMAN/);
   results.push({label,data:result.data,usage:result.usage,requestId:result.request_id});
  }catch(e){const failure={label,error:String(e),debug:(e as any).titleDebug,usage:(e as any).usage};await write(path.join(active,'failure.json'),failure);results.push(failure);}
  await write(path.join(output,'summary.json'),{live,titleCalls:live?calls.length:0,coverCopyCalls:0,results});console.log(JSON.stringify({label,error:results.at(-1).error||null,calls:calls.length}));
 }
}finally{globalThis.fetch=realFetch;process.chdir(root);}
for(const [i,p] of protectedFiles.entries())assert.equal(await fs.readFile(path.join(root,p),'utf8'),saved[i]);
for(const i of items)assert.equal(await fs.readFile(i.provenance.source,'utf8'),i.sourceBytes);
await write(path.join(output,'preservation.json'),{approvedLibrariesUnchanged:true,sourceJobsUnchanged:true,titleCalls:live?calls.length:0,coverCopyCalls:0});
console.log(JSON.stringify({output}));if(!live)assert.ok(results.every(r=>!r.error),JSON.stringify(results));
