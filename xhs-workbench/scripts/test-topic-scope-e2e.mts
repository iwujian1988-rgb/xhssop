import nextEnv from '@next/env';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
nextEnv.loadEnvConfig(process.cwd());
const dir=path.resolve('data/topic-scope-e2e',String(Date.now()));
await mkdir(dir,{recursive:true});
const payloads:any[]=[];
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage();
 await page.route('**/api/batch',async route=>{
   if(route.request().method()==='POST') {payloads.push(route.request().postDataJSON());await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'验收：仅捕获请求，尚未提交'})});}
   else await route.continue();
 });
 await page.goto('http://localhost:3000/batch');
 for(const scope of ['large','medium']) {
   await page.locator(`input[name="topic-scope"][value="${scope}"]`).check();
   await page.locator('#plan-count').fill('10');
   await page.getByRole('button',{name:'生成选题计划（10篇）',exact:true}).click();
   await page.getByText('验收：仅捕获请求，尚未提交',{exact:true}).waitFor();
   assert.equal(payloads.at(-1).topic_scope,scope);
 }
 await page.screenshot({path:path.join(dir,'scope-ui.png')});
} finally {await browser.close();}
await writeFile(path.join(dir,'frontend-payloads.json'),JSON.stringify(payloads,null,2));
console.log('FRONTEND PAYLOAD PASS',dir);
if(!process.argv.includes('--live'))process.exit(0);
const {loadBatch,loadJob}=await import('../src/lib/batch-store');
const {getCompetitorCreativeCard}=await import('../src/lib/creative-card-library');
const {getCapabilityFallback,migratedToTopicOption}=await import('../src/lib/v2/topic-stage');
const {generateStandardKnowledgePagePlan}=await import('../src/lib/v2/content-stage');
const {buildLockedProductionBrief}=await import('../src/lib/v2/content-brief');
const nativeFetch=globalThis.fetch;let label='';let calls=0;let expected:any;
globalThis.fetch=async(url,init)=>{
 const body=JSON.parse(String(init?.body));const user=JSON.parse(body.messages[1].content);calls++;
 if(label.endsWith('topic')){
  assert.equal(user.topicScope,expected);assert.ok(user.scopePlan.every((s:any)=>!s.coreProblem));
  assert.ok(body.messages[0].content.includes('一个明确能力块'));
 }else{assert.deepEqual(Object.keys(user).sort(),['finalPublicTopic','promise']);assert.equal(user.finalPublicTopic,expected.topic);assert.equal(user.promise,expected.promise);}
 await writeFile(path.join(dir,label+'-request.json'),JSON.stringify(body,null,2));
 const res=await nativeFetch(url,init);await writeFile(path.join(dir,label+'-provider.json'),await res.clone().text());return res;
};
for(const payload of payloads){
 label=payload.topic_scope+'-topic';expected=payload.topic_scope;
 const res=await nativeFetch('http://localhost:3000/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const output=await res.json();await writeFile(path.join(dir,label+'-response.json'),JSON.stringify(output,null,2));
 assert.equal(res.status,200,JSON.stringify(output));calls++;
 const saved=await loadBatch(output.batch.id);assert.equal(saved.topic_scope,payload.topic_scope);assert.equal(saved.jobs.length,10);
 const job=await loadJob(saved.id,saved.jobs[0].id);const topic=structuredClone(migratedToTopicOption(job.topic,job.product_id,getCompetitorCreativeCard(job.reference_card_id)!));
 console.log('SAVED_TEST_BATCH',saved.id,payload.topic_scope);
 assert.equal(topic.topic,output.batch.jobs[0].topic.topic);assert.equal(topic.promise,output.batch.jobs[0].topic.content_promise);
 topic.productionBrief=buildLockedProductionBrief(topic);
 label=payload.topic_scope+'-page-plan';expected=topic;
 const plan=await generateStandardKnowledgePagePlan({topic,capability:getCapabilityFallback(getCompetitorCreativeCard(job.reference_card_id)!),evidence:[]});
 assert.ok(plan.data.length);assert.ok(plan.data.every(p=>typeof p.pageContentPlan==='string'));
 await writeFile(path.join(dir,label+'-result.json'),JSON.stringify(plan,null,2));
 console.log(payload.topic_scope,JSON.stringify(saved.jobs.map(j=>j.topic.topic)), 'PLAN',JSON.stringify(plan.data));
}
assert.equal(calls,4);console.log('E2E PASS',dir,'AI_CALLS',calls);
