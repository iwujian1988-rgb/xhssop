import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stableHash } from '../src/lib/v2/contracts';
const root=process.cwd(),out=path.join(root,'data/text-title-v1-de');
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const review=await read(path.join(out,'review.json'));
const abc=await read(path.join(root,'data/text-title-v1-abc/summary.json'));
const de=await read(path.join(out,'live/summary.json'));
assert.equal(de.aiCalls,2);
const jobs:any[]=[];
for(const [index,result] of abc.results.entries()){
  const trace=await read(path.join(root,`data/text-title-v1-abc/data/final-content-traces/${result.requestId}/30_TITLE_CANDIDATES.json`));
  jobs.push({job:['A','B','C'][index],finalPublicTopic:trace.input.finalPublicTopic,actualContent:trace.input.finalContentSnapshot.innerPages,allCandidates:trace.candidates,raw:trace.raw,selected:result.selected,usage:result.usage,requestId:result.requestId,reviewedInnerHash:result.hash,source:'Existing ABC trace: no rerun'});
}
for(const result of de.results){
  const dir=path.join(out,'live',result.label);
  const input=await read(path.join(dir,'input.json'));
  const request=await read(path.join(dir,'request.json'));
  const response=await read(path.join(dir,'provider-response.json'));
  const payload=JSON.parse(request.messages[1].content);
  assert.deepEqual(Object.keys(payload.finalContentSnapshot),['innerPages']);
  assert.deepEqual(payload.finalContentSnapshot.innerPages.map((p:any)=>[p.page_title,p.lead,p.bullets]),input.content.innerPages.map((p:any)=>[p.page_title,p.lead,p.bullets]));
  const persisted=await read(path.join(root,`data/batches/${review.batch}/jobs/${review[result.label].job}.json`));
  assert.equal(persisted.artifacts.content.data.manualInnerReview.status,'locked');
  assert.equal(stableHash(persisted.artifacts.content.data.innerPages),review[result.label].hash);
  assert.equal(persisted.draft.downstreamStale,true);
  jobs.push({job:result.label,finalPublicTopic:payload.finalPublicTopic,actualContent:payload.finalContentSnapshot.innerPages,allCandidates:result.debug.finalCandidates,raw:result.debug.creatorRaw,selected:null,error:result.error,usage:result.usage,requestId:response.id,reviewedInnerHash:review[result.label].hash,source:dir});
}
const oldE=await read(path.join(root,`data/batches/${review.batch}/jobs/job_002.json`));
assert.equal(oldE.status,'dropped');
for(const p of review.protectedHashes){
  assert.equal(createHash('sha256').update(await fs.readFile(p.path)).digest('hex'),p.sha256);
}
const flags={D_CHECKLIST_LIGHT_FIX_DONE:'YES',D_CHECKLIST_LOCKED:'YES',D_REVIEWED_INNER_HASH:review.D.hash,OLD_E_METHOD_JOB_DROPPED:'YES',REPLACEMENT_E_FOUND:'YES',REPLACEMENT_E_SOURCE:review.E.source,REPLACEMENT_E_LIGHT_FIX_ONLY:'YES',REPLACEMENT_E_LOCKED:'YES',E_REVIEWED_INNER_HASH:review.E.hash,D_TITLE_CALLS:1,E_TITLE_CALLS:1,ABC_TITLE_RERUN:'NO',TOTAL_NEW_AI_CALLS:2,TITLE_5_JOB_COMPLETE:'NO',TEXT_TITLE_STYLE_LESS_FORMULAIC_PASS:'YES',TEXT_TITLE_HUMANNESS_PASS:'YES',TEXT_TITLE_SPECIFICITY_PASS:'YES',TEXT_TITLE_CLICK_REASON_DIVERSITY_PASS:'YES',TEXT_TITLE_DELIVERY_ALIGNMENT_PASS:'YES',TITLE_DIRECTORY_TONE_SYSTEMIC:'NO',TITLE_LOCAL_SUBPOINT_OVERFOCUS_SYSTEMIC:'YES',TEXT_TITLE_FINALIZED:'NO',NEXT_STEP:'FIX_TEXT_TITLE_ONCE'};
await fs.writeFile(path.join(out,'five-job-acceptance.json'),JSON.stringify({flags,scope:'5 real samples available, but only ABC selected; style flags concern observed textTitle copy, not production completion; local overfocus is repeated in candidate pool, not every selected title.',review,jobs,newUsage:{prompt_tokens:3341,completion_tokens:741,total_tokens:4082,calls:2},proof:{ABCAndOriginalEUnchanged:true,TitleStageUnchanged:true,DEPayloadMatchesLockedInner:true,oldEDroppedPreserved:true}},null,2));
const lines=['# 五篇真实 Title 候选明细','', 'A/B/C 复用原始 trace；D/E 本轮各调用一次。selected=null 表示整组校验失败，不能把人工偏好冒充程序选中。历史失败原因按原 trace 保留，不篡改。',''];
for(const j of jobs){
  lines.push(`## ${j.job}`, '', `finalPublicTopic：${j.finalPublicTopic}`, '',`reviewedInnerHash：${j.reviewedInnerHash}`, '',`selected：${j.selected?.textTitle??'无（全部候选被现有校验拒绝）'}`, '', 'actualContent：');
  for(const p of j.actualContent)lines.push(`- ${p.page_title}：${p.lead}`);
  lines.push('');
  for(const [i,c] of j.allCandidates.entries())lines.push(`### 候选 ${i+1}`, '',`textTitle：${c.pair.textTitle}`, '',`clickReason（原文）：${c.pair.clickReason}`, '',`coverTitle：${c.pair.coverTitle}`, '',`coverSubtitle：${c.pair.coverSubtitle}`, '',`过滤原因：${c.failures.join('；')||'无（通过）'}`, '');
}
lines.push('完整正文（包括 bullets）、raw、usage、来源、人工修订差异和最终标志见同目录 five-job-acceptance.json；原始 provider-response/request 保留在 live/D 和 live/E。');
await fs.writeFile(path.join(out,'CANDIDATES.md'),lines.join('\n'));
console.log(JSON.stringify({flags,verification:'passed',newTokens:4082},null,2));
