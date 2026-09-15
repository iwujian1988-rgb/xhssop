import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const dir=path.resolve('data/auto-cover-entry-ui');await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:960}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const payloads:any[]=[];
// All API mutations intercepted: no production job or provider touched.
await page.route('**/api/**',async route=>{
  if(route.request().method()==='POST')payloads.push(route.request().postDataJSON());
  await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'离线请求已捕获，未创建任务'})});
});
async function submit(name:string){
  const response=page.waitForResponse(r=>r.url().includes('/api/batch')&&r.request().method()==='POST');
  await page.getByRole('button',{name,exact:true}).click();await response;
  await page.getByText('离线请求已捕获，未创建任务',{exact:true}).waitFor();
}
try{
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:4100/batch');
  const count=page.getByLabel('生成篇数',{exact:true});
  await count.waitFor();assert.equal(await count.inputValue(),'1');
  assert.equal(await page.getByRole('checkbox').count(),0);
  assert.equal(await page.getByText('只选 code/hybrid',{exact:true}).count(),0);
  await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});
  for(const value of ['', '0','21','1.5']){
    await count.fill(value);assert.equal(await page.getByRole('button',{name:/生成选题计划/}).isDisabled(),true);
  }
  await count.fill('1');await submit('生成选题计划（1篇）');
  assert.equal(payloads[0].job_count,1);assert.ok(!('card_ids' in payloads[0]));assert.ok(!('topics_per_card' in payloads[0]));
  await count.fill('20');await submit('生成选题计划（20篇）');assert.equal(payloads[1].job_count,20);
  await page.getByLabel('商品',{exact:true}).selectOption('tef_tcf_canada');
  assert.ok(await page.getByRole('checkbox').count()>0);await submit('生成批量计划');
  assert.ok(payloads[2].card_ids.length>0);assert.ok(!('job_count' in payloads[2]));
  await page.getByLabel('商品',{exact:true}).selectOption('delf_b2_writing');
  await page.getByLabel('内容模式',{exact:true}).selectOption('product_showcase');
  assert.ok(await page.getByRole('checkbox').count()>0);await submit('生成批量计划');
  assert.equal(payloads[3].content_mode,'product_showcase');assert.ok(!('job_count' in payloads[3]));
  await page.getByLabel('内容模式',{exact:true}).selectOption('standard');
  assert.equal(await page.getByRole('checkbox').count(),0);assert.equal(await count.inputValue(),'20');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.unroute('**/api/**');
  const fakeBatch={id:'batch_ui_mock',product_id:'delf_b2_writing',content_mode:'standard',status:'planned',created_at:'2026-09-07T00:00:00Z',jobs:['job_001']};
  const fakeJob={id:'job_001',seq:1,product_id:'delf_b2_writing',reference_card_id:'resource_11_delf_doc_analysis',status:'pending',attempts:0,topic:{topic:'正式信语气怎么选'}};
  await page.route('**/api/**',async route=>{
    const body=route.request().method()==='POST' ? {batch:fakeBatch,usage:{calls:0,total_tokens:0}} : {batch:fakeBatch,jobs:[fakeJob],active_runner:null};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(process.env.UI_TEST_URL || 'http://127.0.0.1:4100/batch');
  await page.getByRole('button',{name:'生成选题计划（1篇）',exact:true}).click();
  await page.getByText('计划确认（1 篇笔记）',{exact:true}).waitFor();
  assert.equal(await page.getByText('封面待自动匹配',{exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'确认选题，生成正文',exact:true}).count(),1);
  await page.screenshot({path:path.join(dir,'plan-mock.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({pass:true,realAiCalls:0,productionWrites:0,payloads,errors},null,2));
  console.log('PASS: real page, new/legacy modes, invalid input, request body, desktop/mobile; REAL_AI_CALLS=0; PRODUCTION_WRITES=0');
}finally{await browser.close();}
