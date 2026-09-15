import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const bundle = await build({ stdin: { contents: "import {nodeToPngBlob} from './src/lib/export-image'; window.exportTest=nodeToPngBlob;", resolveDir: process.cwd() }, bundle:true, write:false, platform:'browser', format:'iife' });
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  await page.setContent('<div id="canvas" data-cover-visual="fail" style="position:relative;width:1080px;height:1440px;background:white"><div data-cover-block-id="coverTitle" style="position:absolute;left:1000px;top:50px;width:126px;height:100px;background:red;font-size:80px">字</div><div data-editor-only style="position:absolute;left:0;top:0;width:20px;height:20px;background:blue"></div></div>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const result=await page.evaluate(async()=>{
    const node=document.querySelector<HTMLElement>('#canvas')!;
    const text=node.querySelector<HTMLElement>('[data-cover-block-id]')!;
    const before=text.style.cssText;
    const blob=await (window as any).exportTest(node);
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0);
    const result={width:bitmap.width,height:bitmap.height,overflow:node.scrollWidth,unchanged:before===text.style.cssText,editorRestored:node.querySelector<HTMLElement>('[data-editor-only]')!.style.display==='',edge:[...ctx.getImageData(1070,140,1,1).data],tool:[...ctx.getImageData(10,10,1,1).data]};
    bitmap.close();return result;
  });
  assert.equal(result.width,1080);assert.equal(result.height,1440);assert.ok(result.overflow>1080);
  assert.ok(result.unchanged && result.editorRestored);
  assert.deepEqual(result.edge,[255,0,0,255]);assert.deepEqual(result.tool,[255,255,255,255]);
  console.log('PASS',result);
} finally {await browser.close();}
