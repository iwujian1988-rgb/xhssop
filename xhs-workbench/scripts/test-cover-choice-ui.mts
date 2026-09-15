import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
const batchId='batch_1788843125888';
const jobId='job_001';
const original=await fs.readFile(`data/batches/${batchId}/jobs/${jobId}.json`,'utf8');
const fixture=JSON.parse(original);
const output=path.resolve('data/cover-choice-ui');await fs.mkdir(output,{recursive:true});
const baseUrl=process.env.UI_TEST_URL || 'http://localhost:4100';
const browser=await chromium.launch({headless:true});
try {
  for(const width of [1280,390]) {
    const job=structuredClone(fixture);job.status='awaiting_review';delete job.cover_image_url;
    job.draft.coverSelection={titleId:job.draft.coverCopy.titleId,sourceInnerHash:job.draft.coverCopy.sourceInnerHash,confirmedTemplateId:null};
    let posts=0;
    const page=await browser.newPage({viewport:{width,height:960}});
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',async route=>{
      if(route.request().method()==='POST') {
        const body=route.request().postDataJSON();posts++;
        assert.equal(body.action,'update_draft_state');assert.equal(body.expected_cover_request_id,job.draft.coverCopy.requestId);
        const candidate=job.artifacts.content.data.coverCandidates.find((c:any)=>c.templateId===body.selected_cover_template_id);
        assert.ok(candidate);job.draft.selectedCoverTemplateId=candidate.templateId;
        job.draft.coverSelection.confirmedTemplateId=candidate.templateId;
        job.draft.coverSelection.downstreamComplete=false;
        job.reference_card_id=candidate.templateId;
        await route.fulfill({json:{job}});return;
      }
      await route.fulfill({json:{batch:{id:batchId,product_id:'delf_b2_writing',content_mode:'standard',status:'done',created_at:'2026-09-07T14:48:30Z',jobs:[job.id]},jobs:[job],active_runner:null}});
    });
    await page.goto(`${baseUrl}/batch?batch_id=${batchId}`);
    const picker=page.getByTestId('cover-candidate-picker');
    await page.waitForTimeout(1000);
    if (!await picker.count()) {
      console.error(await page.locator('body').innerText());
      console.error(errors);
    }
    await picker.waitFor();
    assert.equal(await picker.getByRole('radio').count(),job.artifacts.content.data.coverCandidates.filter((candidate:any)=>!candidate.rejectionReason).length);
    await picker.getByRole('button',{name:/查看全部封面模板/}).click();
    const library=picker.getByTestId('full-cover-library');await library.waitFor();
    assert.ok(await library.getByRole('radio').count()>job.artifacts.content.data.coverCandidates.length,'完整模板库必须多于推荐候选');
    await library.getByRole('button',{name:'高信息密度',exact:true}).click();
    assert.ok(await library.getByRole('radio').count()>0,'必须能筛选高信息密度模板');
    await library.screenshot({path:path.join(output,`full-library-high-density-${width}.png`)});
    await picker.getByRole('button',{name:'收起全部模板',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'请先确认封面',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'导出封面',exact:true}).count(),0);
    await picker.screenshot({path:path.join(output,`choices-${width}.png`)});
    await picker.getByRole('radio').nth(1).check();
    await picker.getByRole('button',{name:'使用这个封面',exact:true}).click();
    await picker.getByRole('button',{name:'封面模板已确认',exact:true}).waitFor();
    await picker.getByTestId('cover-next-action').waitFor();
    assert.equal(await picker.getByTestId('cover-next-action').getByRole('button',{name:/生成.*封面/}).count(),0,'批量模式不得出现单篇生成按钮');
    assert.equal(await page.getByRole('button',{name:'继续生成后半程',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'导出封面',exact:true}).count(),0);
    await picker.screenshot({path:path.join(output,`confirmed-${width}.png`)});
    job.draft.coverSelection.downstreamComplete=true;
    await page.reload();
    const alternativeCount=job.artifacts.content.data.coverCandidates.filter((candidate:any)=>!candidate.rejectionReason).length-1;
    const reopen=page.getByRole('button',{name:`更换封面（另有${alternativeCount}个）`,exact:true});
    await reopen.waitFor();
    await reopen.click();
    const completedPicker=page.getByTestId('cover-candidate-picker');
    await completedPicker.getByTestId('cover-complete-state').waitFor();
    assert.equal(await completedPicker.getByRole('button',{name:/生成.*封面/}).count(),0,'成品完成后不得继续显示生成按钮');
    await completedPicker.getByRole('radio').first().check();
    assert.equal(await completedPicker.getByRole('button',{name:'使用这个封面',exact:true}).isEnabled(),true,'换选其他模板后才允许重新确认');
    assert.equal(await completedPicker.getByTestId('cover-complete-state').count(),0,'预选其他模板时不应把旧模板显示为当前完成态');
    assert.equal(posts,1);assert.deepEqual(errors,[]);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
    await page.close();
  }
  assert.equal(await fs.readFile(`data/batches/${batchId}/jobs/${jobId}.json`,'utf8'),original);
  console.log('PASS: desktop/mobile choice, pending/confirmed feedback, export held until downstream complete, one intercepted save, no image calls. REAL_AI_CALLS=0; PRODUCTION_WRITES=0');
}finally{await browser.close();}
