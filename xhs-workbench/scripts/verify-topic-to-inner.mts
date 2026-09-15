import nextEnv from '@next/env';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {composeV2} from '../src/lib/v2/pipeline';
import {emptyAiUsage} from '../src/lib/ai-client';
import {topicOptionToMigrated} from '../src/lib/v2/topic-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {createPlannedBatchAtomic,loadJob,saveJob,updateBatchStatus,type BatchJob} from '../src/lib/batch-store';
import {prepareJobForHumanReview,lockInnerWorkingCopy,assertReviewedInner} from '../src/lib/manual-inner-review';
import {stableHash,type TopicOption,type PipelineArtifacts} from '../src/lib/v2/contracts';
nextEnv.loadEnvConfig(process.cwd());
const dir='data/topic-to-inner-frozen-v5';await mkdir(dir,{recursive:true});
const lock=await open(dir+'/STARTED.lock','wx');await lock.writeFile(new Date().toISOString());await lock.close();
const timestamp=Date.now();let mode='',expected:TopicOption;let count=0;const stageCalls=new Set<string>();
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
  const request=JSON.parse(String(init?.body));const user=JSON.parse(request.messages[1].content);
  const stage='canonical_page_plan' in user?'inner':'page_plan';
  const key=mode+'-'+stage;
  assert.ok(!stageCalls.has(key)&&count<4,'No retry or extra stage allowed');
  const topic=stage==='inner'?user.topic:user;
  assert.deepEqual(Object.keys(topic).sort(),['finalPublicTopic','promise']);
  assert.equal(topic.finalPublicTopic,expected.topic);assert.equal(topic.promise,expected.promise);
  if(stage==='inner'){
    assert.deepEqual(Object.keys(user).sort(),['canonical_page_plan','evidence','topic']);
    assert.deepEqual(user.evidence,[]);
    assert.ok(user.canonical_page_plan.length>0&&user.canonical_page_plan.every((p:any)=>typeof p.pageContentPlan==='string'));
  }
  await writeFile(dir+'/'+key+'-request.json',JSON.stringify(request,null,2));
  stageCalls.add(key);count++;
  const response=await nativeFetch(url,init);
  await writeFile(dir+'/'+key+'-provider.json',await response.clone().text());return response;
};
const summary:any[]=[];
for(const [scope,source] of [['large','data/topic-large-domain-v5/live-result.json'],['medium','data/topic-medium-production-audit-v1/result.json']] as const){
  mode=scope;const artifact=JSON.parse(await readFile(source,'utf8'));expected=structuredClone(artifact.data[0]);
  const originalHash=stableHash(expected);const batchId=`batch_verify_${mode}_${timestamp}`;
  const card=getCompetitorCreativeCard(expected.templateId)||getCompetitorCreativeCard('resource_01_grammar_parchment_red')!;
  const job:BatchJob={id:'job_001',seq:1,product_id:'delf_b2_writing',reference_card_id:card.id,topic:topicOptionToMigrated(expected),status:'pending',attempts:0,pipeline_version:'v2',current_stage:'topic_selected'};
  await createPlannedBatchAtomic({id:batchId,product_id:job.product_id,direction:'验收：复用冻结Topic，只到Inner，不启动后续',content_mode:'standard',knowledge_mode:'educational_original',topic_scope:scope,created_at:new Date().toISOString(),status:'planned',pipeline_version:'v2',jobs:[]},[job]);
  await saveJob(batchId,{...job,status:'running',attempts:1});
  console.log('START',mode,batchId,expected.topic);
  try{
    await composeV2({productId:job.product_id,card,topic:job.topic,evidence:[],contentMode:'standard',onCheckpoint:async(stage,artifacts)=>{
      assert.equal(stage,'execution','Must stop before downstream stages');
      await saveJob(batchId,{...job,status:'running',attempts:1,artifacts,current_stage:'topic_selected'});
    }});
    throw new Error('EXPECTED_INNER_CHECKPOINT_MISSING');
  }catch(error){
    const e=error as Error & {partialArtifacts?:PipelineArtifacts;usage?:BatchJob['usage']};
    if(e.message==='INNER_AWAITING_HUMAN_REVIEW'&&e.partialArtifacts?.content){
      await writeFile(dir+'/'+mode+'-checkpoint.json',JSON.stringify(e.partialArtifacts,null,2));
      const prepared=prepareJobForHumanReview({...job,attempts:1,artifacts:e.partialArtifacts,usage:e.usage});
      const approved=lockInnerWorkingCopy(prepared);
      // 与生产相同的准备/锁定；本次不执行runner的递归续跑，避免Title调用。
      await saveJob(batchId,{...approved,status:'awaiting_review',failure:undefined});
      const saved=await loadJob(batchId,job.id);assertReviewedInner(saved.artifacts!.content!.data);
      assert.equal(saved.topic.topic,expected.topic);assert.equal(saved.topic.content_promise,expected.promise);
      assert.equal(saved.current_stage,'content_ready');assert.equal(saved.draft!.selected_title,'');
      assert.ok(!saved.artifacts?.titles);assert.equal(saved.artifacts!.content!.data.manualInnerReview!.status,'locked');
      assert.deepEqual(saved.draft!.inner_pages,saved.artifacts!.content!.data.innerPages);
      const pages=saved.draft!.inner_pages;
      summary.push({mode,batchId,status:'PASS',checkpoint:'content_ready',innerLocked:true,pages:pages.length,usage:e.usage,warnings:e.partialArtifacts.content.warnings,pageDetails:pages.map(p=>({title:p.page_title,bullets:p.bullets.length,chars:Array.from(p.lead+p.bullets.join('')).length}))});
      await writeFile(dir+'/'+mode+'-saved-job.json',JSON.stringify(saved,null,2));
    }else{
      await saveJob(batchId,{...await loadJob(batchId,job.id),status:'failed',failure:{stage:'content',message:e.message,attempts:1,usage:e.usage||emptyAiUsage()},usage:e.usage});
      summary.push({mode,batchId,status:'FAIL',error:e.message,usage:e.usage});
      await writeFile(dir+'/'+mode+'-error.json',JSON.stringify({message:e.message,stack:e.stack,artifacts:e.partialArtifacts},null,2));
    }
  }
  await updateBatchStatus(batchId,'done');
  assert.equal(stableHash(expected),originalHash);
  await writeFile(dir+'/summary.json',JSON.stringify({calls:count,stages:[...stageCalls],summary},null,2));
}
console.log(JSON.stringify({calls:count,stages:[...stageCalls],summary},null,2));
