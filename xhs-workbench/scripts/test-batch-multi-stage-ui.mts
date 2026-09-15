import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const fixture = JSON.parse(await fs.readFile('data/batches/batch_1788907160212/jobs/job_001.json', 'utf8'));
const makeTitleJob = (id: string) => {
  const job = structuredClone(fixture);
  job.id = id; job.status = 'awaiting_review'; job.failure = undefined; job.commercial = undefined;
  job.draft.id = `review_${id}`; job.draft.selected_title = '';
  job.draft.titlePackage.humanSelectedTextTitleId = null;
  job.draft.titlePackage.humanSelectedCandidateId = null;
  job.draft.titlePackage.selectedBundleId = undefined;
  job.draft.selected_bundle_id = undefined;
  delete job.draft.coverCopy; delete job.draft.coverSelection;
  delete job.artifacts.content.data.coverCopy; delete job.artifacts.content.data.coverSelection;
  delete job.artifacts.content.data.coverCandidates;
  job.artifacts.titles.data.humanSelectedTextTitleId = null;
  job.artifacts.titles.data.humanSelectedCandidateId = null;
  return job;
};
const jobs = [makeTitleJob('job_001'), makeTitleJob('job_002')];
const batch = { id: 'batch_multi_stage_ui', product_id: 'delf_b2_writing', content_mode: 'standard', status: 'done', created_at: new Date().toISOString(), jobs: jobs.map(job => job.id) };
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
let resumeBody: any;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/api/batch**', async route => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'update_draft_state') {
        const job = jobs.find(item => item.id === body.job_id)!;
        if (body.readable_page_plan) {
          job.draft.readablePagePlan = body.readable_page_plan;
          await route.fulfill({ json: { job } }); return;
        }
        if (body.cover_edit_state) {
          await route.fulfill({ json: { job } }); return;
        }
        if (body.selected_cover_template_id) {
          job.draft.selectedCoverTemplateId = body.selected_cover_template_id;
          job.draft.coverSelection.confirmedTemplateId = body.selected_cover_template_id;
          job.artifacts.content.data.coverSelection.confirmedTemplateId = body.selected_cover_template_id;
          await route.fulfill({ json: { job } }); return;
        }
        const titleCandidates = [
          ...(job.draft.titlePackage.humanSelectableTextTitles || []),
          ...(job.draft.titlePackage.titleBundles || []),
          ...(job.draft.title_bundles || []),
        ];
        const selected = titleCandidates.find((item: any) => item.id === body.selected_bundle_id);
        assert.ok(selected, `fixture title candidate not found: ${body.selected_bundle_id}`);
        job.draft.titlePackage.humanSelectedTextTitleId = selected.id;
        job.draft.titlePackage.selectedBundleId = selected.id;
        job.draft.selected_bundle_id = selected.id;
        job.draft.selected_title = selected.textTitle;
        job.artifacts.titles.data.humanSelectedTextTitleId = selected.id;
        await route.fulfill({ json: { job } }); return;
      }
      if (body.action === 'resume_selected_jobs') {
        resumeBody = body; await route.fulfill({ json: { started: true, job_ids: body.job_ids } }); return;
      }
      throw new Error(`unexpected action ${body.action}`);
    }
    await route.fulfill({ json: { batch, jobs, active_runner: null } });
  });
  await page.goto(baseUrl + '/batch?batch_id=' + batch.id);
  await page.getByTestId('batch-title-advance').first().waitFor();
  assert.equal(await page.getByRole('checkbox').count(), 2);
  assert.equal(await page.getByRole('checkbox').first().isChecked(), true);
  assert.equal(await page.getByRole('checkbox').nth(1).isChecked(), true);
  assert.equal(await page.getByRole('button', { name: '一键进入封面匹配（2篇）' }).count(), 2);
  assert.equal(await page.getByRole('button', { name: '一键进入封面匹配（2篇）' }).first().isDisabled(), true);
  for (const id of ['job_001', 'job_002']) {
    const article = page.getByTestId(`review-${id}`);
    await article.getByRole('button', { name: /文字标题：/ }).first().click();
  }
  await page.getByRole('button', { name: '一键进入封面匹配（2篇）' }).first().waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('button', { name: '一键进入封面匹配（2篇）' }).first().isEnabled(), true);
  await page.getByRole('button', { name: '一键进入封面匹配（2篇）' }).first().click();
  assert.deepEqual(resumeBody.job_ids, ['job_001', 'job_002']);
  for (let index = 0; index < jobs.length; index += 1) {
    const coverJob = structuredClone(fixture);
    coverJob.id = jobs[index].id; coverJob.status = 'awaiting_review'; coverJob.failure = undefined; coverJob.commercial = undefined;
    coverJob.draft.id = `review_${coverJob.id}`;
    coverJob.draft.coverSelection.confirmedTemplateId = null;
    coverJob.draft.coverSelection.downstreamComplete = false;
    coverJob.artifacts.content.data.coverSelection.confirmedTemplateId = null;
    jobs[index] = coverJob;
  }
  resumeBody = undefined;
  await page.reload();
  await page.getByTestId('batch-cover-advance').first().waitFor();
  assert.equal(await page.getByRole('button', { name: '一键生成成品（2篇）' }).count(), 2);
  assert.equal(await page.getByRole('button', { name: '一键生成成品（2篇）' }).first().isDisabled(), true);
  for (const [index,id] of ['job_001', 'job_002'].entries()) {
    const article = page.getByTestId(`review-${id}`);
    if(index===0)await article.getByRole('radio').nth(2).check();
    await article.getByRole('button', { name: '使用这个封面' }).click();
    await article.getByRole('button', { name: '封面模板已确认' }).waitFor();
    await article.getByTestId('manual-cover-editor-entry').waitFor();
  }
  const firstArticle = page.getByTestId('review-job_001');
  await firstArticle.locator('.rc-notebook').waitFor();
  await firstArticle.getByRole('button', { name: '收起修改工具' }).waitFor();
  await firstArticle.getByRole('button', { name: /^title\s/ }).click();
  await firstArticle.getByText('字号', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '一键生成成品（2篇）' }).first().isEnabled(), true);
  await page.getByRole('button', { name: '一键生成成品（2篇）' }).last().click();
  assert.deepEqual(resumeBody.job_ids, ['job_001', 'job_002']);
  const mixedTitleJob=makeTitleJob('job_005');
  const mixedCoverJob=structuredClone(fixture);
  mixedCoverJob.id='job_001';mixedCoverJob.status='awaiting_review';mixedCoverJob.failure=undefined;mixedCoverJob.commercial=undefined;
  mixedCoverJob.draft.id='review_job_001';mixedCoverJob.draft.coverSelection.confirmedTemplateId=null;mixedCoverJob.draft.coverSelection.downstreamComplete=false;
  mixedCoverJob.artifacts.content.data.coverSelection.confirmedTemplateId=null;
  jobs.splice(0,jobs.length,mixedTitleJob,mixedCoverJob);
  await page.reload();
  await page.getByRole('tab',{name:'选文字标题（1）'}).waitFor();
  assert.equal(await page.getByTestId('batch-title-stage').count(),1);
  assert.equal(await page.getByTestId('batch-cover-stage').count(),0,'标题页不得同时渲染封面操作');
  await page.getByRole('tab',{name:'选封面（1）'}).click();
  await page.getByTestId('batch-cover-stage').waitFor();
  assert.equal(await page.getByTestId('batch-title-stage').count(),0,'封面页不得同时渲染标题候选');
  assert.equal(await page.getByText('人工选择标题方案',{exact:true}).count(),0,'封面页DOM不得残留标题选择器');
  const validTitleJob=makeTitleJob('job_001');
  const failedTitleJob=makeTitleJob('job_005');
  failedTitleJob.status='failed';failedTitleJob.failure={stage:'title',message:'INSUFFICIENT_VALID_TEXT_TITLES:3/4',attempts:1};
  jobs.splice(0,jobs.length,validTitleJob,failedTitleJob);
  await page.reload();
  await page.getByTestId('batch-title-stage').waitFor();
  const failedCheckbox=page.getByRole('checkbox',{name:/job_005/});
  assert.equal(await failedCheckbox.isDisabled(),true,'失败Job必须退出批量推进选择');
  assert.equal(await page.getByRole('button',{name:'一键进入封面匹配（1篇）'}).first().isDisabled(),true);
  await page.getByTestId('review-job_001').getByRole('button',{name:/文字标题：/}).first().click();
  assert.equal(await page.getByRole('button',{name:'一键进入封面匹配（1篇）'}).first().isEnabled(),true,'失败Job不得阻塞成功Job继续');
  console.log('PASS: title and cover stages are isolated, mixed batches use explicit sub-tabs, per-job choice required, top/bottom batch actions, selected IDs only; AI_CALLS=0');
} finally { await browser.close(); }
