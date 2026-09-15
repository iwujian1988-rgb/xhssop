import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { measureCoverTextHeight, growCoverTextBoxes } from '../src/lib/cover-text-measurement';
import { createDefaultCoverBlocks } from '../src/lib/cover-editor';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<div style="position:relative;width:1080px;height:1440px;container-type:inline-size;transform:scale(.5);transform-origin:top left">
    <div id="text" data-cover-block-id="coverTitle" contenteditable="true" style="position:absolute;width:300px;height:60px;box-sizing:content-box;padding:20px;display:flex;align-items:center;white-space:pre-wrap;overflow-wrap:anywhere;font-size:40px;line-height:1.4">一段需要换行的封面标题测试<span data-editor-only style="position:absolute;bottom:0;height:16px">handle</span></div></div>`);
  const result = await page.evaluate((source) => {
    const measure = (0, eval)(`(${source})`) as (node:HTMLElement)=>number;
    const node = document.querySelector<HTMLElement>('#text')!;
    const oldHeights:number[] = [];
    for(let i=0;i<5;i++){const height=node.scrollHeight;oldHeights.push(height);node.style.height=`${height}px`;}
    node.style.height='60px';
    const heights:number[]=[];
    for(let i=0;i<30;i++){
      const height=measure(node);heights.push(height);node.style.height=`${height}px`;node.style.left=`${i*3}px`;
    }
    const wide=measure(node);node.style.width='150px';const narrow=measure(node);
    return {oldHeights,heights,wide,narrow,handles:node.querySelectorAll('[data-editor-only]').length,blocks:document.querySelectorAll('[data-cover-block-id]').length};
  }, measureCoverTextHeight.toString());
  assert.ok(result.oldHeights[4]>result.oldHeights[0], 'Reproduce live-box padding feedback');
  assert.equal(new Set(result.heights).size,1,'Intrinsic height must stay stable while dragging');
  assert.ok(result.narrow >= result.wide,'Resize must measure wrapping');
  assert.equal(result.handles,1);assert.equal(result.blocks,1);
  const state={blocks:createDefaultCoverBlocks({renderer:'parchment_dense_directory',title:'测试标题',subtitle:''}),selectedIds:['coverTitle']};
  const heights=new Map([['coverTitle',500]]);
  const grown=growCoverTextBoxes(state,heights);
  assert.equal(grown.blocks.find(b=>b.id==='coverTitle')!.height,500);
  assert.equal(growCoverTextBoxes(grown,heights),grown,'No-op must preserve state identity');
  assert.equal(grown.blocks[0].text,state.blocks[0].text);
  console.log('PASS',JSON.stringify(result),'No model calls or production writes.');
} finally {await browser.close();}
