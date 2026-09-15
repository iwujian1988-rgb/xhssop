import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import JSZip from 'jszip';
const batchId='batch_1788792510292';
const root=path.resolve('data/batches',batchId,'jobs');
const originals=await Promise.all(['002','003'].map(id=>fs.readFile(path.join(root,`job_${id}.json`),'utf8')));
const fixtures=originals.map(raw=>JSON.parse(raw));
// Only historical DERIVED P1 QA state is refreshed. Actual draft pages stay intact.
for(const job of fixtures)job.commercial.pageManifest.pages.P1.frenchQaStatus='pass';
const out=path.resolve('data/batch-export-ui');await fs.mkdir(out,{recursive:true});
const coverFixture=await fs.readFile('public/generated-cover-backgrounds/delf-b2-product-library-collage.png');
const downloadFixture=await new JSZip().file('导出校验.txt','ZIP_DOWNLOAD_OK').generateAsync({type:'nodebuffer'});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:960}});
const actions:any[]=[];const uploads:string[]=[];const errors:string[]=[];
page.on('pageerror',e=>errors.push(e.message));
let finalized=false;
try{
  await page.route('**/*',async route=>{
    const req=route.request();const url=new URL(req.url());
    if(!['127.0.0.1','localhost'].includes(url.hostname)) {
      if(req.url()===fixtures[0].cover_image_url||req.url()===fixtures[1].cover_image_url) return route.fulfill({body:coverFixture,contentType:'image/png',headers:{'Access-Control-Allow-Origin':'*'}});
      return route.abort();
    }
    if(!url.pathname.startsWith('/api/'))return route.continue();
    if(req.method()==='GET'){
      if(url.pathname==='/api/offline-download.zip')return route.fulfill({body:downloadFixture,contentType:'application/zip'});
      return route.fulfill({json:{batch:{id:batchId,status:'done',product_id:'delf_b2_writing',content_mode:'standard',created_at:'2026-09-07T14:48:30Z',jobs:fixtures.map(j=>j.id)},jobs:fixtures,active_runner:null}});
    }
    if(req.headers()['content-type']?.includes('multipart/form-data')) {
      const text=req.postDataBuffer()!.toString();
      const name=text.match(/name="relative_path"\r\n\r\n([^\r]+)/)?.[1];assert.ok(name);uploads.push(name);
      return route.fulfill({json:{ok:true}});
    }
    const body=req.postDataJSON();actions.push(body);
    if(body.action==='init')return route.fulfill({json:{session_id:'offline-export-session'}});
    if(body.readable_page_plan){const job=fixtures.find(j=>j.id===body.job_id);job.draft.readablePagePlan=body.readable_page_plan;return route.fulfill({json:{job}});}
    if(body.action==='update_commercial_delivery')return route.fulfill({json:{status:'READY'}});
    if(body.action==='finalize'){finalized=true;return route.fulfill({json:{download_url:'/api/offline-download.zip',file_count:uploads.length,zip_size:downloadFixture.length}});}
    if(body.render_overflow_page_no!==undefined)return route.fulfill({status:409,json:{error:'OFFLINE_REAL_PAGE_OVERFLOW:未改写原稿，需要无损分页'}});
    throw new Error('UNEXPECTED_MUTATION:'+JSON.stringify(body));
  });
  await page.goto((process.env.UI_TEST_URL || 'http://localhost:4100/batch')+'?batch_id='+batchId);
  await page.getByText(batchId,{exact:true}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'成品池（2）',exact:true}).click();
  await page.getByRole('button',{name:'一键导出全部（zip）',exact:true}).click();
  await page.getByText('导出过程已结束；已完成的文件不会因弹窗关闭而丢失',{exact:true}).waitFor({timeout:90000});
  const modalText=await page.locator('body').innerText();
  assert.ok(!modalText.includes('尚未人工选择标题'));
  assert.ok(actions.some(a=>a.action==='init'));
  assert.equal(finalized,true,'Both actual page sets must reach ZIP finalization');
  const expected=fixtures.reduce((n,j)=>n+j.draft.readablePagePlan.pages.length+2,0);
  assert.equal(uploads.length,expected,'Both covers, every readable page and both text files');
  assert.ok(uploads.length>16,'Dense original pages should flow onto more readable pages');
  assert.deepEqual(errors,[]);
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'展开预览',exact:true}).last().click();
  const innerDetails=page.locator('details').filter({has:page.getByText('查看已锁定内页',{exact:true})}).last();
  if(!(await innerDetails.getAttribute('open')))await innerDetails.locator('summary').click();
  const readable=page.locator('[data-readable-layout="1"]');
  await readable.first().waitFor();
  const visibleInner=(await readable.allTextContents()).join('\n');
  assert.ok(!visibleInner.includes('**'));
  assert.ok(!visibleInner.includes('原P'));
  assert.ok(!visibleInner.includes('改写资产'));
  assert.ok(visibleInner.includes('[Signature]'));
  assert.ok(await readable.locator('strong').count()>0);
  assert.ok(await page.getByText('内容偏长：教学内页超过5页目标。仅提醒，不影响审核、继续生成或导出，不自动重试。',{exact:true}).count()>0);
  await readable.filter({has:page.locator('strong')}).first().screenshot({path:path.join(out,'markdown-fixed.png')});
  await readable.first().screenshot({path:path.join(out,'readable-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  await readable.first().screenshot({path:path.join(out,'readable-mobile.png')});
  const overflow=await readable.evaluateAll(nodes=>nodes.filter(n=>n.scrollHeight>n.clientHeight+1).length);
  assert.equal(overflow,0,'Narrow preview must not clip any readable page');
  await page.screenshot({path:path.join(out,'result.png')});
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({actions,uploads,finalized,modalText,errors,realAiCalls:0,productionWrites:0,remoteCover:'local fixture used to isolate CORS/network'},null,2));
  console.log(JSON.stringify({finalized,uploads:uploads.length,actions:actions.map(a=>a.action),ending:modalText.slice(-1800)}));
  for(let i=0;i<2;i++)assert.equal(await fs.readFile(path.join(root,`job_00${i+2}.json`),'utf8'),originals[i]);
}finally{await browser.close();}
