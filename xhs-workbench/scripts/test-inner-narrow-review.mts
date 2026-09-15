import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import env from '@next/env';
env.loadEnvConfig(process.cwd());
const out='data/inner-narrow-review-20260910',batch='data/batches/batch_1789005556011/jobs';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const save=async(p:string,x:unknown)=>{await fs.mkdir(path.dirname(`${out}/${p}`),{recursive:true});await fs.writeFile(`${out}/${p}`,JSON.stringify(x,null,2));};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
await fs.mkdir(out,{recursive:true});await fs.mkdir(`${out}/started`);
const names=(await fs.readdir(batch)).filter(n=>n.endsWith('.json'));
const hashes=Object.fromEntries(await Promise.all(names.map(async n=>[n,hash(await fs.readFile(`${batch}/${n}`))])));
const system=`你不是作者，不是重写编辑，不是润色器。你只负责检查并局部修正已经完成的DELF B2中文/法语教学内页中明确会影响使用的错误。
只检查五类：1法语语法形式与中文解释明显不对应(grammar_mismatch)；2语气/语用效果被误写成语法形式(pragmatics_vs_grammar)；3同一篇前后自相矛盾(contradiction)；4数量、步骤、分类前后明显不一致(count_mismatch)；5明显无依据的绝对化、虚构研究或官方/考官规则(unsupported_claim)。
除此之外不要动。禁止优化文风、小红书语气、整页重写、调整结构、增加新知识/例子、升级普通表达、扩写或删除仅不够完美的内容。保留故意展示的错误例句及其教学作用；如果错的是对错误例句的解释，只修解释。普通营销语气不等于教学硬伤。不确定则不修，不凭偏好判断。
数字矛盾结合上下文判断修标题还是正文，不机械以任一方为准。区分语法形式与礼貌/强硬等语用效果。无来源支持的研究、官方要求等不得自行补来源，只删除该断言或局部改为不冒称真实依据的表述。
只返回严格JSON：{"issues":[{"type":"grammar_mismatch | pragmatics_vs_grammar | contradiction | count_mismatch | unsupported_claim","page":"P1","original":"原文中需要替换的精确连续片段","problem":"为何明确错误","replacement":"局部替换文本"}],"revisedInner":[...]}。
type选五类之一。original必须逐字引用原稿，replacement只修该处。revisedInner保留全部页面、顺序、字段、数组长度和未涉错文字，非正文metadata原样保留。只能修改issues列出的局部，不能暗改；没有问题的页面逐字不变。若无明确错误，issues=[]且revisedInner与输入完全一致。不要返回解释或Markdown。`;
function diff(a:any,b:any,p=''):any[]{if(JSON.stringify(a)===JSON.stringify(b))return [];if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>diff(a[k],b[k],`${p}/${k}`));return [{path:p,before:a,after:b}];}
const calls:any[]=[];
try {for(const id of ['005','001','009']){
 const j=await read(`${batch}/job_${id}.json`),original=j.artifacts.content.data.innerPages;
 await save(`${id}/original.json`,original);
 const request={model:'qwen3.8-max-0902',messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({inner:original,evidence:[]})}],temperature:0.2,max_tokens:8000,enable_thinking:false,response_format:{type:'json_object'}};
 await save(`${id}/request.json`,request);calls.push({job:id,model:request.model,started:new Date().toISOString()});await save('calls.json',calls);
 try{
 const res=await fetch(process.env.OPENAI_BASE_URL!.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(request),signal:AbortSignal.timeout(300000)});
 const raw=await res.text();await save(`${id}/provider.json`,{status:res.status,raw});assert.ok(res.ok);
 const provider=JSON.parse(raw);await save(`${id}/usage.json`,provider.usage||{});
 const review=JSON.parse(provider.choices[0].message.content);await save(`${id}/review.json`,review);assert.ok(Array.isArray(review.revisedInner)&&Array.isArray(review.issues));
 await save(`${id}/revised.json`,review.revisedInner);
 await save(`${id}/diff.json`,diff(original,review.revisedInner));
 console.log(id,'DONE',review.issues.length,'issues',diff(original,review.revisedInner).length,'changed fields');
 }catch(e){await save(`${id}/failure.json`,{error:String(e)});console.log(id,String(e));}
 }}finally{for(const n of names)assert.equal(hash(await fs.readFile(`${batch}/${n}`)),hashes[n]);await save('preservation.json',{unchanged:true,hashes,calls:calls.length,retries:0,productionWrites:0});}
