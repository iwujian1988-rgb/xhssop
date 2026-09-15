// Isolated render of saved real output through the production React component.
// No model calls, no job mutation, no alternate CSS/template implementation.
import fs from 'node:fs/promises';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const out='data/note-content-alignment-20260910-authorized-rerun';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const compiled=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Renderer from './src/components/templates/ReferenceCoverRenderer';createRoot(document.getElementById('root')).render(<Renderer {...window.coverInput}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},tsconfig:'tsconfig.json'});
const browser=await chromium.launch({headless:true});
try {
 for(const id of ['006','008','010']) {
  const cover=await read(`${out}/${id}/cover.json`), c=await read(`${out}/${id}/cover-compiled.json`);
  const input={renderer:c.renderer,payload:{kind:'dense_directory',title:cover.data.coverCopy.coverTitle,subtitle:cover.data.coverCopy.coverSubtitle,sections:c.compiled.sections},previewMode:'production'};
  const page=await browser.newPage({viewport:{width:1080,height:1440},deviceScaleFactor:1});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:1080px}*{box-sizing:border-box}#root{width:1080px}</style><div id="root"></div>');
  await page.evaluate(x=>{(window as any).coverInput=x;},input);
  await page.addScriptTag({content:compiled.outputFiles[0].text});
  await page.waitForFunction(()=>document.querySelector('[data-cover-visual]')?.getAttribute('data-cover-visual')!=='pending');
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.resolve(`${out}/${id}/cover-preview.png`),fullPage:true});
  const metrics=await page.evaluate(()=>({visual:document.querySelector('[data-cover-visual]')?.getAttribute('data-cover-visual'),width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,headings:Array.from(document.querySelectorAll('h1,h2,h3')).map(x=>({text:x.textContent,font:getComputedStyle(x).fontSize}))}));
  await fs.writeFile(`${out}/${id}/render-check.json`,JSON.stringify({productionComponent:true,networkDisabled:true,errors,...metrics},null,2));console.log(id,metrics,errors);
  await page.close();
 }
} finally {await browser.close();}
