import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {standardCreativeCards} from '../src/lib/creative-card-library';
import {coverCapacityFailure,coverDisplayBlocks,getCoverTemplateSpec} from '../src/lib/cover-template-specs';
const root=process.cwd();
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const run=process.argv.find(x=>x.startsWith('--input-run='))?.slice(12);
const batch=process.argv.find(x=>x.startsWith('--batch='))?.slice(8);
const dir=path.join(root,'data',batch?`cover-display-${batch}`:run?'cover-display-live-20260907':'cover-display-offline-20260907');
await fs.mkdir(dir,{recursive:true});
const samples:any[]=[];
if(batch){
  const names=(await fs.readdir(path.join(root,'data','batches',batch,'jobs'))).filter(name=>name.endsWith('.json')).sort();
  for(const name of names){
    const job=await read(`data/batches/${batch}/jobs/${name}`);const content=job.artifacts?.content?.data;
    const candidate=content?.coverCandidates?.find((c:any)=>c.templateId===content.selectedCoverTemplateId&&!c.rejectionReason);
    if(candidate)samples.push({id:`${job.id}-original`,candidate,selected:true});
  }
}else if(run){
  const s=await read(`data/${run}/summary.json`);
  for(const e of s.results)for(const [i,c]of (e.candidates||[]).entries())samples.push({id:`${e.label}-${i+1}`,candidate:c,selected:c.templateId===e.selectedTemplateId});
}else{
  const b=await read('data/cover-b-model-comparison-20260907/failure.json');
  b.candidates.forEach((c:any,i:number)=>samples.push({id:`B38-${i+1}`,candidate:c}));
  for(const label of ['A','B','D']){
    const file=label==='D'?'result.json':'failure.json';
    const data=await read(`data/real-cover-abd-final-closeout-20260907/${label}/${file}`);
    (data.candidates||data.data.coverCandidates).forEach((c:any,i:number)=>samples.push({id:`old-${label}-${i+1}`,candidate:c}));
  }
  const card=standardCreativeCards.find(c=>c.id==='production_user_vocab_table')!;
  const spec=getCoverTemplateSpec(card.renderer_id)!;
  const c={templateId:card.id,coverTitle:'B2写作表达资料预览',coverSubtitle:'模板覆盖测试，非新生成文案',coverBlocks:Array.from({length:3},(_,i)=>({heading:`资料${i+1}`,items:Array.from({length:14},()=>({primary:'protéger les données personnelles',secondary:'保护个人数据，完整说明保留在原始数据中'}))}))};
  samples.push({id:'synthetic-dense',candidate:c});
  const memo=standardCreativeCards.find(c=>c.id==='resource_06_notes_course_offer')!;
  assert.equal(coverCapacityFailure(memo.renderer_id,[{items:[{primary:'不足一组'}]}]),'section_capacity');
  const blocks=Array.from({length:4},()=>({items:Array.from({length:4},()=>({primary:'长法语 '.repeat(20)}))}));
  const before=JSON.stringify(blocks);assert.equal(coverCapacityFailure(memo.renderer_id,blocks),undefined);
  assert.equal(coverDisplayBlocks(memo.renderer_id,blocks).flatMap(b=>b.items).length,6);assert.equal(JSON.stringify(blocks),before);
}
const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Cover from './src/components/templates/ReferenceCoverRenderer';window.mountCover=(p)=>createRoot(document.getElementById('root')).render(React.createElement(Cover,p));`,resolveDir:root,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(bundle.outputFiles[0].text);return;}
    const file=path.resolve(root,'public','.'+decodeURIComponent((req.url||'/').split('?')[0]));
    assert.ok(file.startsWith(path.join(root,'public')+path.sep));
    res.end(await fs.readFile(file));
  }catch{res.statusCode=404;res.end();}
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=(server.address() as any).port;
const browser=await chromium.launch({headless:true});
const results:any[]=[];
try{
 for(const s of samples){
  const c=s.candidate,card=standardCreativeCards.find(t=>t.id===c.templateId)!;const spec=getCoverTemplateSpec(card.renderer_id)!;
  const blocks=coverDisplayBlocks(card.renderer_id,c.coverBlocks);
  const structuralFailure=coverCapacityFailure(card.renderer_id,c.coverBlocks);
  const record:any={id:s.id,templateId:c.templateId,selected:s.selected,renderMode:spec.renderMode,structuralFailure,
    sourceCounts:c.coverBlocks.map((b:any)=>b.items.length),displayCounts:blocks.map(b=>b.items.length),title:c.coverTitle,subtitle:c.coverSubtitle};
  if(spec.renderMode==='image_to_image'){results.push({...record,inputContractPass:!structuralFailure,visual:'NOT_TESTED'});continue;}
  const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://127.0.0.1:'+port+'/case',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;width:1080px}#root{width:1080px}img{max-width:100%}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`}));
  await page.goto(`http://127.0.0.1:${port}/case`);
  await page.waitForFunction(()=>typeof (window as any).mountCover==='function',{},{timeout:5000}).catch(e=>{throw new Error('BUNDLE_LOAD_FAILED:'+JSON.stringify(errors)+':'+e.message);});
  await page.evaluate(p=>(window as any).mountCover(p),{renderer:card.renderer_id,payload:{title:c.coverTitle,subtitle:c.coverSubtitle,sections:c.coverBlocks.map((b:any)=>({...b,side_label:b.heading,columns:1}))},referenceImage:card.reference_image});
  await page.waitForFunction(()=>{const e=document.querySelector('[data-cover-visual]');return e&&e.getAttribute('data-cover-visual')!=='pending';});
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>Promise.all(Array.from(document.images).map(img=>img.decode().catch(()=>undefined))));
  record.layout=await page.evaluate(()=>{
    const host=document.querySelector<HTMLElement>('[data-cover-visual]')!;
    const art=host.querySelector<HTMLElement>('article')!;
    return {visual:host.dataset.coverVisual,width:art.getBoundingClientRect().width,height:art.getBoundingClientRect().height,
      sourceCount:host.dataset.coverSourceCount,displayCount:host.dataset.coverDisplayCount,
      core:Array.from(host.querySelectorAll<HTMLElement>('[data-cover-core]')).map(el=>({text:el.textContent,font:getComputedStyle(el).fontSize,line:getComputedStyle(el).lineHeight,height:el.clientHeight,scrollHeight:el.scrollHeight,width:el.clientWidth,scrollWidth:el.scrollWidth,rect:el.getBoundingClientRect().toJSON()})),
      brokenImages:Array.from(host.querySelectorAll('img')).filter(img=>!img.complete||img.naturalWidth===0).map(img=>img.src)};
  });
  record.errors=errors;record.png=path.join(dir,s.id+'.png');
  await page.locator('.cover-display-policy').screenshot({path:record.png});
  results.push(record);await page.close();
 }
 await fs.writeFile(path.join(dir,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(results));
}finally{await browser.close();server.close();}
