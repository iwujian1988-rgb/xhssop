import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const batchId='batch_1788843125888';
const output=path.resolve('data/readable-orphan-regression');
await fs.mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://localhost:4100/batch?batch_id=${batchId}`);
  for(const jobId of ['job_004','job_005']){
    const review=page.getByTestId(`review-${jobId}`);
    await review.waitFor();
    const innerSection=review.locator('details').first();
    await innerSection.waitFor();
    if(!(await innerSection.getAttribute('open')))await innerSection.locator('summary').click();
    await innerSection.screenshot({path:path.join(output,`${jobId}.png`)});
    const continuations=innerSection.locator('[data-readable-layout="1"][data-readable-part]:not([data-readable-part="1"])');
    const occupancy=await continuations.evaluateAll(nodes=>nodes.map(node=>{
      const article=node as HTMLElement;
      const last=article.lastElementChild as HTMLElement|null;
      const articleRect=article.getBoundingClientRect();
      const lastRect=last?.getBoundingClientRect();
      return {
        source:Number(article.dataset.sourcePageNo),
        part:Number(article.dataset.readablePart),
        total:Number(article.dataset.readableTotal),
        ratio:lastRect?(lastRect.bottom-articleRect.top)/articleRect.height:0,
        text:(article.textContent||'').replace(/\s+/g,' ').trim(),
      };
    }));
    for(const item of occupancy)assert.ok(item.ratio>=0.34,`${jobId} source P${item.source} part ${item.part}/${item.total} remains sparse: ${item.ratio.toFixed(2)} ${item.text}`);
    console.log(jobId,occupancy.map(item=>({source:item.source,part:`${item.part}/${item.total}`,occupancy:Number(item.ratio.toFixed(2))})));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: no sparse continuation page in real job_004/job_005; REAL_AI_CALLS=0; PRODUCTION_WRITES=0');
}finally{await browser.close();}
