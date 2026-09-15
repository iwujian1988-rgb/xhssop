import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildProductionTextTitlePrompt} from '../src/lib/v2/title-stage';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';

const batchId='batch_1788970269058';
const jobIds=['job_001','job_002','job_003','job_005','job_008'];
const root=process.cwd();
const rows=[];

for(const jobId of jobIds){
  const filename=path.join(root,'data','batches',batchId,'jobs',`${jobId}.json`);
  const job=JSON.parse(await fs.readFile(filename,'utf8'));
  const card=getCompetitorCreativeCard(job.reference_card_id);
  assert.ok(card,`${jobId}: missing creative card`);
  const built=buildProductionTextTitlePrompt({
    topic:job.artifacts.selectedTopic.data,
    capability:getCapabilityFallback(card),
    content:job.artifacts.content.data,
    recentGeneratedTextTitles:[`${jobId}之前的批次标题示例`],
  });
  const input=built.titleCoreInput;
  assert.equal(input.editorialTopic,job.topic.v2_topic.topic);
  assert.ok(input.factBrief.length>0);
  assert.ok(typeof input.userTask==='string'&&input.userTask.length>0);
  assert.ok(input.wholeNoteOutline.length>=1&&input.wholeNoteOutline.length<=5);
  assert.equal('matchedApprovedReferences' in input,false);
  assert.equal('shortApprovedStyleReferences' in input,false);
  assert.equal('negativeReferences' in input,false);
  assert.equal('intendedPromise' in input,false);
  assert.ok(input.selectedMethodCards.length>=2&&input.selectedMethodCards.length<=4);
  assert.deepEqual(input.previousBatchTitles,[`${jobId}之前的批次标题示例`]);
  rows.push({
    jobId,
    topic:input.editorialTopic,
    searchTerms:input.specificSearchTerms,
    methods:input.selectedMethodCards.map(item=>item.name),
    pages:input.wholeNoteOutline.map(item=>item.pageTitle),
  });
}

const signatures=new Set(rows.map(row=>JSON.stringify({searchTerms:row.searchTerms,pages:row.pages})));
assert.ok(signatures.size>=4,`job-specific routing too repetitive: ${signatures.size}/${rows.length}`);
assert.deepEqual(rows.find(row=>row.jobId==='job_001')?.searchTerms,['DELF B2写作']);
assert.ok(rows.find(row=>row.jobId==='job_002')?.searchTerms.includes('B2写作语法'));
assert.ok(rows.find(row=>row.jobId==='job_003')?.searchTerms.includes('B2正式信'));
assert.ok(rows.find(row=>row.jobId==='job_005')?.searchTerms.includes('B2写作审题'));
assert.ok(rows.find(row=>row.jobId==='job_001')?.methods.includes('保姆级教程 / 新手向'));
assert.equal(buildProductionTextTitlePrompt({
  topic:(JSON.parse(await fs.readFile(path.join(root,'data','batches',batchId,'jobs','job_001.json'),'utf8'))).artifacts.selectedTopic.data,
  capability:getCapabilityFallback(getCompetitorCreativeCard((JSON.parse(await fs.readFile(path.join(root,'data','batches',batchId,'jobs','job_001.json'),'utf8'))).reference_card_id)!),
  content:(JSON.parse(await fs.readFile(path.join(root,'data','batches',batchId,'jobs','job_001.json'),'utf8'))).artifacts.content.data,
}).titleCoreInput.scopeMode,'whole_note');

console.log(JSON.stringify(rows,null,2));
console.log(`PASS: ${rows.length} jobs receive independent editorial scope/fact/task/outline/search and 2-4 progressive method cards.`);
