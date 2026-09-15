import {build} from 'esbuild';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
const code=await build({entryPoints:['src/lib/readable-inner-layout.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Layout'});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto('about:blank');
 await page.addScriptTag({content:code.outputFiles[0].text});
 const result=await page.evaluate(()=>{
  const api=(window as any).Layout;
  const tests=['中','Une expression française dans un contexte précis. '];
  return tests.map(unit=>{
   let lo=1,hi=800,best=0;
   while(lo<=hi){const n=(lo+hi)>>1;const source=[{page_no:1,page_type:'knowledge_list',page_title:'法语写作表达与使用场景',lead:'根据具体语境选择表达。',bullets:[unit.repeat(n)],style_variant:'lined-notebook'}];
    if(api.measureReadablePagePlan(source).pages.length===1){best=n;lo=n+1;}else hi=n-1;
   }
   return {sample:unit,characters:best*unit.length,scope:'Single bullet; one title and short lead. Not a hard quota.'};
  });
 });
 await fs.writeFile('data/inner-capacity-20260908.json',JSON.stringify(result,null,2));console.log(result);
}finally{await browser.close();}
