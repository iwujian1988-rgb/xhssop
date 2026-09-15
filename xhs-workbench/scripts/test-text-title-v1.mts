import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { generateTitlePackage, buildStandardKnowledgeTitlePromptForTest, standardKnowledgeAssetCountsSupported } from '../src/lib/v2/title-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { stableHash } from '../src/lib/v2/contracts';

const root = process.cwd();
const live = process.argv.includes('--live');
if (live) nextEnv.loadEnvConfig(root);
else process.env.OPENAI_API_KEY = 'offline-only';
delete process.env.AI_BRIDGE_DIR;
const output = live ? path.join(root,'data/text-title-v1-abc') : await fs.mkdtemp(path.join(root,'.tmp-text-title-v1-'));
if (live) await fs.mkdir(output); // Exclusive directory: never silently rerun A/B/C.
const inputs = await Promise.all([1,2,3].map(async n => {
  const file = path.join(root,`data/batches/batch_human_review_1788691220835/jobs/job_00${n}.json`);
  const bytes = await fs.readFile(file,'utf8'); const job = JSON.parse(bytes);
  const content = job.artifacts.content.data;
  assert.equal(content.manualInnerReview?.status,'locked');
  assert.equal(content.manualInnerReview.innerHash,stableHash(content.innerPages));
  assert.equal(content.manualInnerReview.innerHash,['149d2z1','1n0315l','17n9jbz'][n-1]);
  const card = getCompetitorCreativeCard(content.selectedCoverTemplateId || job.reference_card_id)!;
  assert.ok(card);
  return {file,bytes,job,input:{topic:job.artifacts.selectedTopic.data,content,capability:getCapabilityFallback(card)}};
}));
const approved = JSON.parse(await fs.readFile(path.join(root,'data/title-style-user-approved.json'),'utf8'));
for (const {input} of inputs) {
  const prompt = buildStandardKnowledgeTitlePromptForTest(input);
  assert.deepEqual(Object.keys(prompt.titleCoreInput).sort(),['product','finalPublicTopic','wholeNoteOutline','finalContentSnapshot','cover','userApprovedStyleReferences','negativeReferences'].sort());
  assert.equal('finalContentSnapshot' in prompt.titleCoreInput,false);
  assert.equal(prompt.styleReferences.length,31);
  assert.ok(prompt.styleReferences.every(s=>approved.some((a:any)=>a.title===s.title)));
  const poisoned = structuredClone(input);
  poisoned.content.captionParts = {opening:'POISON_10主题',value:['POISON'],productBridge:'POISON',cta:'POISON'};
  poisoned.content.coverBlocks.forEach((block: {heading?:string;items:Array<{primary:string}>}) => { block.heading = 'POISON'; block.items.forEach(item => { item.primary = 'POISON'; }); });
  poisoned.topic.audienceState = 'POISON';
  poisoned.topic.promise = 'POISON_100组';
  assert.deepEqual(buildStandardKnowledgeTitlePromptForTest(poisoned).titleCoreInput,prompt.titleCoreInput);
}
const pair = (text:string) => ({textTitle:text,coverTitle:'B2写作素材',coverSubtitle:'按需查阅',mechanism:'test',userRelation:'',noveltyFingerprint:'test'});
assert.equal(standardKnowledgeAssetCountsSupported(pair('5大主题论据'),inputs[1].input),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('10大主题论据'),inputs[1].input),false);
assert.equal(standardKnowledgeAssetCountsSupported(pair('5组表达对照'),inputs[2].input),true);
assert.equal(standardKnowledgeAssetCountsSupported({...pair('告别Bon/Mauvais！5组高分替换'),coverSubtitle:'5组高频词精准升级法'},inputs[2].input),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('7组表达对照'),inputs[2].input),false);
assert.equal(standardKnowledgeAssetCountsSupported(pair('16条表达'),inputs[0].input),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('17条表达'),inputs[0].input),false);
assert.equal(standardKnowledgeAssetCountsSupported(pair('考前48小时，最后3分钟速查'),inputs[0].input),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('90%的人需要这张表'),inputs[0].input),true);
const single = structuredClone(inputs[1].input); single.content.innerPages = single.content.innerPages.slice(1,2);
assert.equal(standardKnowledgeAssetCountsSupported(pair('5大主题论据'),single),false);
assert.equal(standardKnowledgeAssetCountsSupported(pair('1个环境主题'),single),true);
assert.equal(standardKnowledgeAssetCountsSupported(pair('10个主题'),single),false);
assert.equal(standardKnowledgeAssetCountsSupported(pair('3大类场景'),single),false);
const networkFetch = globalThis.fetch;
let count = 0; let active = output;
globalThis.fetch = async (url, options) => {
  assert.ok(count < 3,'NO_MORE_THAN_THREE_REQUESTS'); count++;
  const request = JSON.parse(String(options?.body));
  assert.equal(request.messages.length,2);
  const payload = JSON.parse(request.messages[1].content);
  assert.deepEqual(Object.keys(payload.finalContentSnapshot),['innerPages']);
  await fs.writeFile(path.join(active,'request.json'),JSON.stringify(request,null,2));
  if (!live) {
    const anchor = ['开场白定调','远程办公','词汇选择'][count-1];
    return new Response(JSON.stringify({id:`text-title-offline-${count}`,choices:[{message:{content:JSON.stringify({candidates:[{...pair(`B2写作${anchor}怎么查？`),coverSubtitle:anchor,bundleIntent:'按需查阅',clickReason:'写作时需要材料'},{...pair(`B2写作${anchor}先存好`),coverSubtitle:anchor,bundleIntent:'保存备用',clickReason:'集中复习时查找'}]})}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  }
  const response = await networkFetch(url,options);
  await fs.writeFile(path.join(active,'provider-response.json'),await response.clone().text());
  return response;
};
const results:any[]=[];
// Isolate production function's trace writes; do not mutate source Jobs or usage history.
process.chdir(output);
try {
  for (const [index, item] of inputs.entries()) {
    active = path.join(output,`job_00${index+1}`); await fs.mkdir(active);
    await fs.writeFile(path.join(active,'provenance.json'),JSON.stringify({source:item.file,hash:item.input.content.manualInnerReview.innerHash},null,2));
    try {
      const result = await generateTitlePackage(item.input);
      if (!live) assert.equal(result.data.candidates.length,2);
      assert.equal(result.data.selected.textTitle,result.data.candidates[0].textTitle);
      await fs.writeFile(path.join(active,'result.json'),JSON.stringify(result,null,2));
      results.push({job:`job_00${index+1}`,topic:item.input.topic.topic,hash:item.input.content.manualInnerReview.innerHash,selected:result.data.selected,candidates:result.data.candidates,usage:result.usage,requestId:result.request_id});
    } catch(error) {
      const failure={job:`job_00${index+1}`,error:String(error),debug:(error as any).titleDebug,usage:(error as any).usage};
      results.push(failure); await fs.writeFile(path.join(active,'failure.json'),JSON.stringify(failure,null,2));
    }
    assert.equal(await fs.readFile(item.file,'utf8'),item.bytes);
    await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({live,aiCalls:live?count:0,results},null,2));
  }
} finally {process.chdir(root);}
if (!live) assert.ok(results.every(r=>!r.error));
console.log(JSON.stringify({output,live,aiCalls:live?count:0,results},null,2));
