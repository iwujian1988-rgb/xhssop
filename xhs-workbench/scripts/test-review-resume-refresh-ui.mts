import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const batchId='batch_1788792510292';
const original=await fs.readFile(`data/batches/${batchId}/jobs/job_002.json`,'utf8');
const ready=JSON.parse(original);
ready.draft.titlePackage.humanSelectedTextTitleId=null;
ready.draft.selected_title='';
delete ready.draft.coverCopy;
delete ready.draft.coverSelection;
const before=structuredClone(ready);
delete before.draft.titlePackage;
before.draft.title_bundles=[];before.draft.title_candidates=[];
before.draft.selected_title='';before.draft.downstreamStale=true;
const dir=path.resolve('data/review-resume-ui');await fs.mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
  for(const fail of [false,true]){
    const page=await browser.newPage({viewport:{width:1280,height:960}});
    let posts=0,readsAfterStart=0,started=false;
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/batch**',async route=>{
      if(route.request().method()==='POST'){
        const req=route.request().postDataJSON();assert.equal(req.action,'resume_reviewed_inner');posts++;
        // Hold response long enough to observe pending button/feedback.
        await new Promise(resolve=>setTimeout(resolve,350));
        if(fail){await route.fulfill({status:409,json:{error:'测试：已有任务运行，请稍后再试'}});return;}
        started=true;await route.fulfill({json:{started:true}});return;
      }
      if(started)readsAfterStart++;
      const running=started&&readsAfterStart===1;
      const job=started&&!running?ready:before;
      await route.fulfill({json:{batch:{id:batchId,product_id:'delf_b2_writing',content_mode:'standard',status:running?'running':'done',jobs:[job.id],created_at:'2026-09-07T14:48:30Z'},jobs:[{...job,status:running?'running':'awaiting_review'}],active_runner:running?batchId:null}});
    });
    await page.goto(`http://localhost:4100/batch?batch_id=${batchId}`);
    await page.getByText(batchId,{exact:true}).waitFor({timeout:15000});
    const generateTitleButton=page.getByRole('button',{name:'生成文字标题',exact:true});
    await generateTitleButton.click();
    await page.getByText('正在生成文字标题…',{exact:true}).waitFor();
    assert.equal(await page.locator('details').first().getAttribute('open'),null,'生成时应折叠内页');
    if(fail){
      await page.getByTestId('review-action-feedback').filter({hasText:'测试：已有任务运行，请稍后再试'}).waitFor();
      assert.equal(await page.getByRole('button',{name:'生成文字标题',exact:true}).isEnabled(),true);
    } else {
      await page.getByText('文字标题：'+ready.draft.titlePackage.humanSelectableTextTitles[0].textTitle,{exact:true}).first().waitFor({timeout:15000});
      assert.ok(readsAfterStart>=2,'resume must wake stopped polling');
      assert.equal(await page.getByRole('button',{name:'生成文字标题',exact:true}).count(),0);
    }
    assert.equal(posts,1);assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(dir,fail?'error.png':'titles-loaded.png'),fullPage:true});
    await page.close();
  }
  assert.equal(await fs.readFile(`data/batches/${batchId}/jobs/job_002.json`,'utf8'),original);
  console.log('PASS: done batch resume starts polling; existing titles appear; pending/error visible; one mocked POST each; REAL_AI_CALLS=0; PRODUCTION_WRITES=0');
} finally {await browser.close();}
