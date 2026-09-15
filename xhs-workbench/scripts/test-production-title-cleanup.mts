import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {composeV2} from '../src/lib/v2/pipeline';
import {filterTextTitleCandidates,buildProductionTextTitlePrompt,FACT_BRIEF_MODEL,TEXT_MODEL} from '../src/lib/v2/title-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';
import {lockInnerWorkingCopy} from '../src/lib/manual-inner-review';
import {applyDraftTitleSelection,getDraftTitleSelection} from '../src/lib/draft-title-selection';
import {assertDraftTitleReadyForExport} from '../src/lib/batch-export';
import {isTextTitleDeliveryReady} from '../src/lib/canonical-title-package';
import {stableHash} from '../src/lib/v2/contracts';

const root=process.cwd();
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const provenance=await read('data/title-cover-five-acceptance/A/provenance.json');
const original=await read(provenance.source);
const protectedPaths=['.env.local','data/title-style-short-approved.json','data/title-style-user-approved.json','data/title-usage.json',provenance.source];
const before=await Promise.all(protectedPaths.map(p=>fs.readFile(path.resolve(root,p))));
const temp=await fs.mkdtemp(path.join(root,'.tmp-production-title-cleanup-'));
const job=lockInnerWorkingCopy({...original,draft:{...original.draft,inner_pages:original.artifacts.content.data.innerPages}});
assert.equal(stableHash(job.artifacts!.content!.data.innerPages),'149d2z1');
const canonical=JSON.stringify(job.artifacts!.content!.data.innerPages);
const card=getCompetitorCreativeCard(job.reference_card_id)!;
const input={productId:job.product_id,card,topic:job.topic,evidence:[],contentMode:'standard' as const,resumeArtifacts:job.artifacts,resumeDraft:job.draft};
const calls:Array<{stage:string;model:string}>=[];
const rawTitles=['B2正式信，语气怎么选','写B2信，先想清楚对象','B2正式信别写得太随意','原来B2信也要看对象','B2写信，我终于不纠结了','B2信函的收尾有讲究','B2正式信，先判断写给谁','写B2信，建议和异议怎么说'];
let failCover=true;
process.env.OPENAI_API_KEY='OFFLINE_TEST_NOT_A_KEY';
process.env.OPENAI_MODEL='unchanged-default-model';
process.env.OPENAI_BASE_URL='https://offline-test.invalid/v1';
delete process.env.AI_BRIDGE_DIR;
const fetchBefore=globalThis.fetch;
globalThis.fetch=async(_url,init)=>{
  const request=JSON.parse(String(init?.body));const system=request.messages[0].content as string;
  const payload=JSON.parse(request.messages[1].content);
  let data:unknown;let stage:string;
  if(system.startsWith('你只将人工锁定')) {
    stage='brief';assert.equal(request.model,FACT_BRIEF_MODEL);assert.deepEqual(Object.keys(payload),['canonicalInner']);
    data={factBrief:'这篇提供正式信的开场、建议与异议、结尾敬语和行动期待表达，附语气与场景说明。',userTask:'写正式信时根据目的和对象选择语气与表达。',scopeNotes:['不同部分对应不同交际意图。']}; // No model counts: production must derive them itself.
  }else if(system.startsWith('\n你为小红书DELF B2中文学习笔记生成文字标题')) {
    stage='title';assert.equal(request.model,TEXT_MODEL);
    assert.ok(system.includes('不再重新建立或输出第二份内容简报'));
    assert.ok(system.includes('只使用selectedMethodCards'));
    assert.ok(!system.includes('至少覆盖 6 种不同方法'));
    assert.deepEqual(Object.keys(payload).sort(),['editorialTopic','scopeMode','factBrief','userTask','supportedCounts','scopeNotes','examIdentity','targetAudience','allowedAudienceLabels','specificSearchTerms','selectedMethodCards','wholeNoteOutline','previousBatchTitles'].sort());
    assert.ok(payload.selectedMethodCards.length>=2&&payload.selectedMethodCards.length<=4);
    assert.equal('negativeReferences' in payload,false);
    assert.equal('intendedPromise' in payload,false);
    assert.equal(payload.targetAudience,'正在准备DELF B2写作的中文学习者');assert.ok(payload.specificSearchTerms.includes('B2正式信'));
    assert.equal(payload.wholeNoteOutline.length,3);assert.equal(payload.editorialTopic,job.artifacts!.selectedTopic!.data.topic);
    assert.ok(!payload.supportedCounts.some((c:any)=>c.count===999));
    data={candidates:rawTitles.map((textTitle,index)=>({textTitle,referenceApprovedId:'',method:payload.selectedMethodCards[index%payload.selectedMethodCards.length].name,risk:'低',riskReason:''}))};
  }else if(system.startsWith('你是现有小红书封面模块')) {
    stage='cover';assert.equal(payload.selectedTextTitle,rawTitles[0]);
    calls.push({stage,model:request.model});
    if(failCover){failCover=false;return new Response('OFFLINE_COVER_FAILURE',{status:400});}
    const contract=payload.templates.find((c:any)=>c.renderMode==='code'&&!c.primaryFrenchOnly&&c.noteInstruction==='可省略note');
    assert.ok(contract);
    data={candidates:[{templateId:contract.templateId,fitReason:'离线结构测试',coverTitle:'B2正式信语气选择',coverSubtitle:'目的与对象',
      coverBlocks:contract.exampleItemCounts.map((n:number,i:number)=>({id:`b${i}`,kind:'group',heading:'表达',priority:1,sourceMode:'general_advice',sourceIds:[],items:Array.from({length:n},(_,j)=>({primary:['根据对象选择语气','建议与异议表达','结尾行动期待','正式信收尾方式'][i+j]||'正式信表达场景'}))}))}]};
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
  }else if(system.startsWith('你负责小红书图文笔记')) {
    stage='caption';data={captionParts:{opening:'B2正式信写作，可以按交际目的选择表达。',value:['这里整理开场、建议与异议和结尾。']}};
  }else if(system.includes('拼写')&&system.includes('blockingIssues')) {
    stage='qa';data={approved:true,blockingIssues:[],warnings:[],corrections:[]};
  }else throw new Error('UNEXPECTED_AI_PATH:'+system.slice(0,70));
  calls.push({stage,model:request.model});
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(data)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}}));
};

try {
  process.chdir(temp); // All generated traces stay in an isolated test directory.
  let pause:any;
  try {await composeV2(input);assert.fail('Must pause before Cover');}catch(error){pause=error;}
  assert.equal(pause.message,'TEXT_TITLE_AWAITING_HUMAN_CHOICE');
  assert.deepEqual(calls.map(c=>c.stage),['brief','title']);
  assert.equal(pause.partialDraft.selected_title,'');
  assert.equal(pause.partialDraft.titlePackage.humanSelectableTextTitles.length,8);
  assert.throws(()=>assertDraftTitleReadyForExport(pause.partialDraft),/AWAITING_HUMAN_CHOICE/);
  const preview=applyDraftTitleSelection(pause.partialDraft,getDraftTitleSelection(pause.partialDraft,0));
  assert.equal(preview.selected_title,'');
  const chosen=applyDraftTitleSelection(pause.partialDraft,getDraftTitleSelection(pause.partialDraft,0),true);
  assert.equal(chosen.selected_title,rawTitles[0]);assert.throws(()=>assertDraftTitleReadyForExport(chosen),/COVER_COPY_PENDING/);
  const titles=pause.partialArtifacts.titles;
  titles.data.humanSelectedTextTitleId=chosen.titlePackage!.humanSelectedTextTitleId;
  titles.data.selected=titles.data.candidates[0];
  let failure:any;
  try {await composeV2({...input,resumeArtifacts:pause.partialArtifacts,resumeDraft:chosen});assert.fail('Cover must fail');}catch(error){failure=error;}
  assert.match(failure.message,/OFFLINE_COVER_FAILURE/);
  assert.equal(failure.partialArtifacts.titles.data.humanSelectedTextTitleId,titles.data.humanSelectedTextTitleId);
  assert.equal(JSON.stringify(failure.partialArtifacts.content.data.innerPages),canonical);
  let coverPause:any;
  try {await composeV2({...input,resumeArtifacts:failure.partialArtifacts,resumeDraft:chosen});assert.fail('Must confirm cover before downstream');}catch(error){coverPause=error;}
  assert.equal(coverPause.message,'COVER_AWAITING_HUMAN_CHOICE');
  assert.deepEqual(calls.map(c=>c.stage),['brief','title','cover','cover']);
  assert.throws(()=>assertDraftTitleReadyForExport(coverPause.partialDraft),/COVER_COPY_PENDING/);
  coverPause.partialArtifacts.content.data.coverSelection.confirmedTemplateId=coverPause.partialArtifacts.content.data.selectedCoverTemplateId;
  const result=await composeV2({...input,resumeArtifacts:coverPause.partialArtifacts,resumeDraft:coverPause.partialDraft});
  assert.deepEqual(calls.map(c=>c.stage),['brief','title','cover','cover','caption','qa']);
  assert.ok(calls.slice(2).every(c=>c.model===(c.stage==='cover'?'qwen3.8-max-0902':'unchanged-default-model')));
  assert.equal(result.draft.selected_title,rawTitles[0]);assert.ok(isTextTitleDeliveryReady(result.draft));
  assert.doesNotThrow(()=>assertDraftTitleReadyForExport(result.draft));
  assert.equal(JSON.stringify(result.artifacts.content!.data.innerPages),canonical);
  const changed=applyDraftTitleSelection(result.draft,getDraftTitleSelection(result.draft,1),true);
  assert.equal(changed.coverCopy,undefined);assert.throws(()=>assertDraftTitleReadyForExport(changed),/COVER_COPY_PENDING/);
  const bad=structuredClone(result.draft);bad.coverCopy!.titleId='stale';assert.throws(()=>assertDraftTitleReadyForExport(bad),/COVER_COPY_PENDING/);

  const validator={topic:pause.partialArtifacts.selectedTopic.data,capability:getCapabilityFallback(card),content:pause.partialArtifacts.content.data};
  const diverse=filterTextTitleCandidates(['别纠结B2语气','不要乱选B2语气','告别B2写信焦虑','拒绝B2乱用语气'].map(textTitle=>({textTitle})),validator);
  assert.equal(diverse.survivalCount,4);assert.equal(diverse.humanSelectableTextTitles.length,4);
  assert.ok(diverse.evaluated.every(e=>!e.filterReasons.includes('NEGATIVE_FAMILY_LIMIT')));
  const checks=filterTextTitleCandidates(['B2高分资料看看','B2提分攻略分享','90%考官喜欢','B2必考句型','B2稳过保证','B2写信'.repeat(6),'','B2写信，语气怎么选','Ｂ２写信语气怎么选','B2写作没思路？先从观点库开始','B2的999条表达'].map(textTitle=>({textTitle})),validator);
  assert.equal(checks.evaluated[0].filterReasons.length,0);assert.equal(checks.evaluated[1].filterReasons.length,0);
  for(const i of [2,3,4])assert.ok(checks.evaluated[i].warnings.includes('UNSUPPORTED_MARKETING_FACT'));
  assert.ok(checks.evaluated[5].filterReasons.includes('TEXT_TITLE_OVER_20'));
  assert.ok(checks.evaluated[6].filterReasons.includes('EMPTY_TEXT_TITLE'));
  assert.ok(checks.evaluated[8].filterReasons.includes('NORMALIZED_DUPLICATE'));
  assert.ok(checks.evaluated[9].filterReasons.includes('APPROVED_NORMALIZED_EXACT_COPY'));
  assert.ok(checks.evaluated[10].warnings.includes('UNSUPPORTED_FACTS_COUNTS'));
  assert.ok(!JSON.stringify(buildProductionTextTitlePrompt(validator).titleCoreInput).includes('coverBlocks'));
  const edge=filterTextTitleCandidates(['B2写作指南','B2写作清单','B2写作资料','B2写作手册','没有同词也能说人话','TEF加拿大写作资料','B2写信16句就够','B2写信999句'].map(textTitle=>({textTitle})),validator);
  assert.ok(edge.survivalCount>=4);assert.equal(edge.humanSelectableTextTitles.length,edge.survivalCount);
  assert.ok(edge.evaluated[4].warnings.includes('UNSUPPORTED_CONTENT_SCOPE'));assert.equal(edge.evaluated[4].filterReasons.length,0);
  assert.ok(edge.evaluated[5].warnings.includes('WRONG_EXAM_IDENTITY'));
  assert.ok(edge.evaluated[6].warnings.includes('UNSUPPORTED_RESULT_GUARANTEE'));
  assert.ok(edge.evaluated[7].warnings.includes('UNSUPPORTED_FACTS_COUNTS'));
  assert.equal(filterTextTitleCandidates([{textTitle:'B2正式信怎么写'}],validator).humanSelectableTextTitles.length,0);
  const crossBatch=filterTextTitleCandidates(
    [{textTitle:'写完觉得虚？这份B2自查很有用✅'},{textTitle:'B2正式信语气怎么选'}],
    {...validator,recentGeneratedTextTitles:['写完觉得虚，这份B2自查很有用']},
  );
  assert.ok(crossBatch.evaluated[0].filterReasons.includes('PREVIOUS_BATCH_NORMALIZED_DUPLICATE'));
  assert.equal(crossBatch.evaluated[1].filterReasons.includes('PREVIOUS_BATCH_NORMALIZED_DUPLICATE'),false);

  // Exercise the actual selection API and persisted state, not a fabricated UI flag.
  process.env.INNER_REVIEW_TEST_DATA_DIR=path.join(temp,'isolated-batches');
  const store=await import('../src/lib/batch-store');
  // Same fail-closed legacy dictionary stub as test-manual-inner-review.mts.
  const require=createRequire(import.meta.url);const dictionaryPath=require.resolve('dictionary-fr');
  require.cache[dictionaryPath]={id:dictionaryPath,filename:dictionaryPath,loaded:true,
    exports:{get aff(){throw new Error('UNEXPECTED_LEGACY_SPELLCHECK');},get dic(){throw new Error('UNEXPECTED_LEGACY_SPELLCHECK');}}} as NodeModule;
  const api=await import('../src/app/api/batch/route');
  const batchId='batch_cleanup_offline';
  const pausedJob={...job,status:'awaiting_review' as const,artifacts:pause.partialArtifacts,draft:pause.partialDraft};
  pausedJob.artifacts=structuredClone(pausedJob.artifacts);
  pausedJob.artifacts!.titles!.data.humanSelectedTextTitleId=null;
  await store.createPlannedBatchAtomic({id:batchId,product_id:job.product_id,direction:'offline',created_at:new Date().toISOString(),status:'planned',jobs:[]},[pausedJob]);
  const response=await api.POST(new Request('http://localhost/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'update_draft_state',batch_id:batchId,job_id:job.id,selected_bundle_id:chosen.titlePackage!.humanSelectedTextTitleId})}));
  assert.equal(response.status,200,await response.clone().text());
  const persisted=await store.loadJob(batchId,job.id);
  assert.equal(persisted.draft!.selected_title,rawTitles[0]);
  assert.equal(persisted.artifacts!.titles!.data.humanSelectedTextTitleId,chosen.titlePackage!.humanSelectedTextTitleId);
  assert.equal(persisted.draft!.coverCopy,undefined);assert.equal(persisted.cover_image_url,undefined);assert.notEqual(persisted.commercial?.status,'READY');
  assert.equal(persisted.status,'awaiting_review');
  assert.throws(()=>assertDraftTitleReadyForExport(persisted.draft!),/COVER_COPY_PENDING/);
  console.log('PASS: real compose offline state flow; 8 raw/no clickReason; all valid candidates exposed; selection/version/export; canonical unchanged.');
} finally {
  globalThis.fetch=fetchBefore;process.chdir(root);
  for(let i=0;i<protectedPaths.length;i++)assert.deepEqual(await fs.readFile(path.resolve(root,protectedPaths[i])),before[i],protectedPaths[i]+' modified');
}
console.log('REAL_AI_CALLS=0; NETWORK_CALLS=0; isolated traces='+temp);
