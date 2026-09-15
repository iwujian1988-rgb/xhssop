import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';
import {stableHash,countVisibleUnits} from '../src/lib/v2/contracts';
import {filterTextTitleCandidates} from '../src/lib/v2/title-stage';
const root=process.cwd();nextEnv.loadEnvConfig(root);
const live=process.argv.includes('--live');assert.ok(live||process.argv.includes('--prepare'));
const netFeel=process.argv.includes('--net-feel-abd');
const taskScopeA=netFeel||process.argv.includes('--user-task-scope-a');
const combinationA=taskScopeA||process.argv.includes('--combination-a');
const dir=path.join(root,netFeel?'data/title-net-feel-abd-test':taskScopeA?'data/a-title-user-task-scope-test':combinationA?'data/a-title-combination-fix-test':'data/auto-brief-title-e2e');await fs.mkdir(dir,{recursive:true});
const read=async(p:string)=>JSON.parse(await fs.readFile(path.resolve(root,p),'utf8'));
const write=async(p:string,v:unknown)=>fs.writeFile(path.join(dir,p),JSON.stringify(v,null,2));
const sha=(s:Buffer|string)=>crypto.createHash('sha256').update(s).digest('hex');
const briefBaseline=await read('data/automatic-title-fact-brief-a-final/live/A/request.json');
const titleBaseline=await read('data/b-title-model-comparison/live/alternative/request.json');
const refs=JSON.parse(titleBaseline.messages[1].content);
assert.equal(refs.shortApprovedStyleReferences.length,31);assert.equal(refs.negativeReferences.length,8);
const normalizeTitle=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
const approvedKeys=new Set(refs.shortApprovedStyleReferences.map((r:any)=>normalizeTitle(r.title)));
assert.equal(normalizeTitle('Ｂ２ 写作：你好！'),normalizeTitle('b2写作你好'));
assert.ok(approvedKeys.has(normalizeTitle(refs.shortApprovedStyleReferences[24].title)));
assert.ok(!approvedKeys.has(normalizeTitle(refs.shortApprovedStyleReferences[24].title+'新内容')));
if(combinationA){
 briefBaseline.messages[0]={...briefBaseline.messages[0],content:briefBaseline.messages[0].content
 .replace('恰好三个字段','恰好四个字段').replace('{"factBrief":"...","supportedCounts"','{"factBrief":"...","userUseCase":"...","supportedCounts"')
 +'\nuserUseCase用中性事实语言说明真实使用者在做什么事情时需要本文、帮助完成什么具体任务；只能从locked Inner推出，不创造用户痛点，不新增效果承诺。scopeNotes只记录真实的素材组织方式、局部范围及内容适用条件，不写标题禁令或泛化教学规则。'};
 titleBaseline.messages[0]={...titleBaseline.messages[0],content:titleBaseline.messages[0].content
 +'\n结合userUseCase理解使用任务，遵守scopeNotes的事实范围；不能把素材组织方式说成考试固定格式。禁止直接复制任一approved标题原句。除非事实输入明确支持，不得使用“X就够”“只要X就行”“固定句式”“直接套用”“比X更有用”“才有效”等充分性、绝对化或比较效果说法。'};
}
if(taskScopeA){
 briefBaseline.messages[0].content=briefBaseline.messages[0].content.replaceAll('userUseCase','userTask')
 .replace('userTask用中性事实语言说明真实使用者在做什么事情时需要本文、帮助完成什么具体任务；只能从locked Inner推出，不创造用户痛点，不新增效果承诺。scopeNotes只记录真实的素材组织方式、局部范围及内容适用条件，不写标题禁令或泛化教学规则。',
 'userTask用中性事实语言说明用户正在完成什么真实动作或判断，只能从locked Inner推出，不创造用户痛点或营销效果。不要描述资料功能，不要写成查找模板、找资料、查句型、获取素材、使用素材库、看攻略或查清单，除非查询本身确实是现实任务。factBrief只描述实际内容，不混入userTask。scopeNotes只记录影响整篇范围的事实边界：局部不能冒充整篇，资料组织结构不能被误说成官方固定规则，使用条件不能被误说成无条件适用。必须依据实际内容归纳，不记录具体词语用法等普通局部教学知识，不添加新的教学规则。');
 titleBaseline.messages[0].content=titleBaseline.messages[0].content.replaceAll('userUseCase','userTask')
 +'\nfactBrief表示实际内容，userTask表示用户正在完成的任务或判断，scopeNotes表示不能把整篇说偏的事实边界。不要输出分析，仍只输出8个textTitle与referenceApprovedId。';
}
const expected:Record<string,string>={A:'149d2z1',B:'1n0315l',C:'17n9jbz',D:'vuq2bl',E:'9cutlq'};
if(netFeel)titleBaseline.messages[0].content+='\n候选风格分布：8条中至少2～3条明显具有发布者人感、态度、情绪或小红书网感，其余保持稳、具体、直接，不要求全部网感化。可以表达个人感受、惊讶、后悔、松一口气、发现感、自然反问、口语、分享推荐关系或轻度夸张节奏；不固定必须出现后悔、我勒个豆、别卷了、难道只有我等口癖。学习approved的语气、节奏与分享关系，不复制原句。所有风格仍服从既有事实范围、数量和20 visible units上限，不因网感增强放行历史过度承诺或局部冒充整篇。';
// Same deterministic scope operation as the frozen Fact Brief experiment.
function deterministicScope(sourcePages:unknown,allowedPages:number[]){
 assert.ok(Array.isArray(sourcePages)&&sourcePages.length>0,'MISSING_COUNT_SOURCE_PAGES');
 assert.ok(sourcePages.every(p=>Number.isInteger(p)&&allowedPages.includes(p)),'INVALID_COUNT_SOURCE_PAGES');
 const pages=[...new Set(sourcePages as number[])].sort((a,b)=>a-b);
 return {sourcePages:pages,scope:pages.length===1?`局部（第${pages[0]}页）`:`覆盖第${pages.join('、')}页`};
}
const protectedPaths:string[]=[];
async function walk(d:string){for(const e of await fs.readdir(path.resolve(root,d),{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())await walk(p);else protectedPaths.push(p);}}
await walk('src');protectedPaths.push('.env.local','data/title-style-short-approved.json','data/title-style-user-approved.json','data/automatic-title-fact-brief-a-final/live/A/request.json','data/b-title-model-comparison/live/alternative/request.json');
if(netFeel)protectedPaths.push('data/a-title-user-task-scope-test/live/A/factBrief/final.json','data/auto-brief-title-e2e/live/B/factBrief/final.json','data/auto-brief-title-e2e/live/D/factBrief/final.json');
const entries=[];
for(const label of (netFeel?['A','B','D']:combinationA?['A']:Object.keys(expected))){
 const provenance=await read(`data/title-cover-five-acceptance/${label}/provenance.json`),job=await read(provenance.source),content=job.artifacts.content.data;
 assert.equal(content.manualInnerReview.status,'locked');assert.equal(stableHash(content.innerPages),expected[label]);assert.equal(content.manualInnerReview.innerHash,expected[label]);protectedPaths.push(provenance.source);
 const canonicalInner=content.innerPages.map((p:any)=>({pageNo:p.page_no,pageTitle:p.page_title,lead:p.lead,bullets:p.bullets,contentForm:p.semanticLayoutType||p.page_type}));
 const validator=await read(`data/text-title-only-acceptance/${label}/validator-input.json`);assert.deepEqual(validator.content.innerPages,content.innerPages);
 const briefRequest={...briefBaseline,messages:[briefBaseline.messages[0],{role:'user',content:JSON.stringify({canonicalInner})}]};
 entries.push({label,source:provenance.source,innerHash:expected[label],canonicalInner,briefRequest,validator});
}
const hashes=Object.fromEntries(await Promise.all(protectedPaths.map(async p=>[p,sha(await fs.readFile(path.resolve(root,p)))])));
if(!live){await write('prepared.json',entries.map(({validator,...e})=>e));await write('title-baseline.json',titleBaseline);console.log(`PREPARED: ${entries.length} locked hashes verified; normalized equality assertions passed; AI_CALLS=0`);process.exit(0);}
assert.equal((process.env.OPENAI_BASE_URL||'').replace(/\/$/,''),'https://dashscope.aliyuncs.com/compatible-mode/v1');assert.ok(process.env.OPENAI_API_KEY);
await fs.mkdir(path.join(dir,'live'));
const calls={factBrief:0,title:0,cover:0,retries:0};const results:any[]=[];
async function call(label:string,stage:'factBrief'|'title',request:any){
 const target=`live/${label}/${stage}`;await fs.mkdir(path.join(dir,target));await write(`${target}/request.json`,request);
 calls[stage]++;await write('live/calls.json',calls);
 const response=await fetch(`${process.env.OPENAI_BASE_URL!.replace(/\/$/,'')}/chat/completions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify(request),signal:AbortSignal.timeout(300000)});
 const body=await response.text();await fs.writeFile(path.join(dir,target,'provider-response.json'),body);if(!response.ok)throw new Error(`HTTP_${response.status}`);
 const provider=JSON.parse(body),raw=provider.choices?.[0]?.message?.content||'';await fs.writeFile(path.join(dir,target,'raw.txt'),raw);await write(`${target}/usage.json`,provider.usage);
 const parsed=JSON.parse(raw);await write(`${target}/parsed.json`,parsed);assert.equal(provider.choices[0].finish_reason,'stop');return parsed;
}
for(const e of entries){
 await fs.mkdir(path.join(dir,'live',e.label));await write(`live/${e.label}/provenance.json`,{source:e.source,innerHash:e.innerHash});
 try{
 let brief:any;
 if(netFeel){
 const source=e.label==='A'?'data/a-title-user-task-scope-test/live/A/factBrief/final.json':`data/auto-brief-title-e2e/live/${e.label}/factBrief/final.json`;
 brief=await read(source);await write(`live/${e.label}/reused-brief.json`,{source,sha256:sha(JSON.stringify(brief)),brief});
 }else{
 const parsed=await call(e.label,'factBrief',e.briefRequest);
 assert.deepEqual(Object.keys(parsed).sort(),combinationA?['factBrief','scopeNotes','supportedCounts',taskScopeA?'userTask':'userUseCase']:['factBrief','scopeNotes','supportedCounts']);assert.equal(typeof parsed.factBrief,'string');assert.ok(Array.isArray(parsed.supportedCounts)&&Array.isArray(parsed.scopeNotes));
 if(combinationA)assert.equal(typeof parsed[taskScopeA?'userTask':'userUseCase'],'string');
 brief={...parsed,supportedCounts:parsed.supportedCounts.map((c:any)=>{assert.equal(typeof c.label,'string');assert.ok(Number.isInteger(c.count)&&c.count>0);return {label:c.label,count:c.count,...deterministicScope(c.sourcePages,e.canonicalInner.map((p:any)=>p.pageNo))};})};
 await write(`live/${e.label}/factBrief/final.json`,brief);
 }
 // No human intervention or content-level acceptance occurs between these calls.
 const useCase=taskScopeA&&typeof brief.userTask==='string'?{userTask:brief.userTask}:!netFeel&&combinationA?{userUseCase:brief.userUseCase}:{};
 const titlePayload={factBrief:brief.factBrief,...useCase,supportedCounts:brief.supportedCounts,scopeNotes:brief.scopeNotes,examIdentity:'DELF B2',shortApprovedStyleReferences:refs.shortApprovedStyleReferences,negativeReferences:refs.negativeReferences};
 assert.deepEqual({factBrief:titlePayload.factBrief,...useCase,supportedCounts:titlePayload.supportedCounts,scopeNotes:titlePayload.scopeNotes},brief);
 const titleRequest={...titleBaseline,messages:[titleBaseline.messages[0],{role:'user',content:JSON.stringify(titlePayload)}]};
 const titles=await call(e.label,'title',titleRequest);
 assert.equal(titles.candidates.length,8);
 for(const c of titles.candidates)assert.deepEqual(Object.keys(c).sort(),['referenceApprovedId','textTitle']);
 // Frozen two-field experiment adapter: sentinel satisfies only the old clickReason presence check.
 const copies=titles.candidates.map((c:any)=>combinationA&&approvedKeys.has(normalizeTitle(c.textTitle)));
 const remaining=titles.candidates.filter((_:any,i:number)=>!copies[i]);
 const filtered=filterTextTitleCandidates(remaining.map((c:any)=>({...c,clickReason:'离线适配占位（非模型输出）'})),e.validator);
 let filteredIndex=0;
 const rawReasons=titles.candidates.map((_:any,i:number)=>copies[i]?['APPROVED_NORMALIZED_EXACT_COPY']:filtered.evaluated[filteredIndex++].filterReasons);
 await write(`live/${e.label}/approved-copy-check.json`,{normalization:'NFKC + lowercase + remove punctuation/whitespace',copies,rawReasons});
 await write(`live/${e.label}/filter.json`,filtered);
 const humanSelectableTextTitles=filtered.humanSelectableTextTitles.map(({clickReason,...c}:any)=>c);
 await write(`live/${e.label}/human-selection.json`,{humanSelectedTextTitleId:null,humanSelectableTextTitles});
 const candidates=titles.candidates.map((c:any,i:number)=>({...c,visibleUnits:countVisibleUnits(c.textTitle),filterReasons:rawReasons[i]}));
 results.push({label:e.label,innerHash:e.innerHash,brief,candidates,le20:candidates.filter((c:any)=>c.visibleUnits<=20).length,survival:filtered.survivalCount,humanSelectableTextTitles,humanSelectedTextTitleId:null,briefToTitleExact:true,briefHash:sha(JSON.stringify(brief))});
 }catch(error){results.push({label:e.label,error:String(error)});}
 await write('live/summary.json',{calls,results});console.log(JSON.stringify(results.at(-1)));
}
for(const p of protectedPaths)assert.equal(sha(await fs.readFile(path.resolve(root,p))),hashes[p],`PROTECTED_FILE_CHANGED:${p}`);
await write('live/preservation.json',{unchanged:true,protectedFileCount:protectedPaths.length,hashes,productionModel:process.env.OPENAI_MODEL,calls});
