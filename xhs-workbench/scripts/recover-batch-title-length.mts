import assert from 'node:assert/strict';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { loadAllJobs, loadJob, saveJob } from '../src/lib/batch-store';
import { filterTextTitleCandidates, TEXT_PRODUCTION_VERSION, type TitleStageInput } from '../src/lib/v2/title-stage';
import { stableHash, V2_SCHEMA_VERSION, type TitlePackage } from '../src/lib/v2/contracts';
import { composeV2 } from '../src/lib/v2/pipeline';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';

const batchId = 'batch_1789005556011';
const base = `data/batches/${batchId}`;
const ids: Record<string,string> = {job_006:'381ca494-9b41-935e-8abf-3ba4325cdcc7',job_007:'fbcacea0-f20a-9623-9f7a-cfac9d9f4083',job_009:'0d97b2b6-7455-917a-ae08-c5bc5f3b592f',job_010:'ecd6bb5d-fb32-9f1a-a1ba-ecc884321096'};
globalThis.fetch = async () => { throw new Error('RECOVERY_NETWORK_FORBIDDEN'); };
const all = await loadAllJobs(batchId);
assert.ok(all.every(j=>j.status!=='running' && j.status!=='pending'), 'Batch still executing');
const backup = `data/recovery-backups/${batchId}-titles-${Date.now()}`;
await mkdir(backup,{recursive:true});
await copyFile(`${base}/batch.json`,`${backup}/batch.json`);
const untouched = new Map<string,string>();
for(const job of all) {
  await copyFile(`${base}/jobs/${job.id}.json`,`${backup}/${job.id}.json`);
  if(!ids[job.id]) untouched.set(job.id,await readFile(`${base}/jobs/${job.id}.json`,'utf8'));
}
const prepared = [];
for(const [id,requestId] of Object.entries(ids)) {
  const job=await loadJob(batchId,id);
  assert.equal(job.status,'failed');
  assert.match(job.failure!.message,/^INSUFFICIENT_VALID_TEXT_TITLES:/);
  assert.ok(job.draft && job.artifacts?.content && job.artifacts.selectedTopic);
  const trace=JSON.parse(await readFile(`data/final-content-traces/${requestId}/30_TEXT_TITLE_CANDIDATES.json`,'utf8'));
  const input={topic:job.artifacts.selectedTopic.data,content:job.artifacts.content.data} as TitleStageInput;
  assert.equal(trace.input.topic,input.topic.topic);
  const filtered=filterTextTitleCandidates(trace.evaluated.map((e:any)=>e.candidate),input);
  assert.ok(filtered.humanSelectableTextTitles.length>=4);
  const previews=filtered.humanSelectableTextTitles.map(c=>({...c,coverTitle:'',mechanism:'',userRelation:'',noveltyFingerprint:stableHash(c.textTitle),textTitleValid:true}));
  const data:TitlePackage={nativeSkillReport:trace.creatorRaw,mode:'text_only',humanSelectableTextTitles:filtered.humanSelectableTextTitles,humanSelectedTextTitleId:null,humanSelectedCandidateId:null,sourceInnerHash:stableHash(input.content.innerPages),contentSnapshotHash:stableHash(input.content.innerPages),productionBriefHash:input.topic.productionBrief!.briefHash,candidates:previews,selected:previews[0],titleBundles:previews};
  const titles={data,schema_version:V2_SCHEMA_VERSION,prompt_version:TEXT_PRODUCTION_VERSION,input_hash:stableHash(trace.input),created_at:new Date().toISOString(),usage:trace.usage,request_id:requestId,warnings:['TEXT_TITLE_AWAITING_HUMAN_CHOICE','RECOVERED_EXISTING_TITLE_RESPONSE_LENGTH_WARNING']};
  let paused:any;
  try { await composeV2({productId:job.product_id,card:getCompetitorCreativeCard(job.reference_card_id)!,topic:job.topic,evidence:job.draft.evidence || [],contentMode:'standard',resumeArtifacts:{...job.artifacts,titles},resumeDraft:job.draft}); }
  catch(e){paused=e;}
  assert.equal(paused?.message,'TEXT_TITLE_AWAITING_HUMAN_CHOICE');
  assert.deepEqual(paused.partialDraft.inner_pages,job.draft.inner_pages);
  assert.equal(paused.partialDraft.selected_title,'');
  assert.equal(paused.partialDraft.titlePackage.humanSelectedTextTitleId,null);
  prepared.push({...job,status:'awaiting_review' as const,current_stage:'title_ready' as const,failure:undefined,stage_failures:job.stage_failures?.filter(f=>f.stage!=='title'),finished_at:undefined,artifacts:paused.partialArtifacts,draft:paused.partialDraft});
}
for(const job of prepared) {
  const current=await loadJob(batchId,job.id);
  assert.equal(current.status,'failed');
  await saveJob(batchId,job);
  const saved=await loadJob(batchId,job.id);
  assert.deepEqual(saved.usage,current.usage,'Never add already-paid usage again');
  console.log(job.id,saved.status,saved.draft!.titlePackage!.humanSelectableTextTitles!.length);
}
for(const [id,original] of untouched) assert.equal(await readFile(`${base}/jobs/${id}.json`,'utf8'),original);
await writeFile(`${backup}/recovery.json`,JSON.stringify({batchId,jobs:Object.keys(ids),aiCalls:0,untouchedJobs:[...untouched.keys()]},null,2));
console.log('Recovered without model calls. Backup:',backup);
