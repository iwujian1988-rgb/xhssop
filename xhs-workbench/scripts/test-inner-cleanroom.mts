/** One-off read-only production audit and experimental input replay. Never imported by production. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import nextEnv from '@next/env';
import {callOpenAICompatibleJsonWithUsage} from '../src/lib/ai-client';

nextEnv.loadEnvConfig(process.cwd());
const root = path.resolve('data/inner-cleanroom/2026-09-06');
const run = process.argv.includes('--run');
const prepare = process.argv.includes('--prepare');
assert.notEqual(run, prepare, 'Choose exactly one: --prepare (zero network) or --run (three calls).');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const save = (file: string, value: unknown) => fs.writeFile(path.join(root, file), JSON.stringify(value, null, 2) + '\n', {flag:'wx'});
const write = (file: string, value: string) => fs.writeFile(path.join(root, file), value, {flag:'wx'});
const source = await fs.readFile('src/lib/v2/content-stage.ts', 'utf8');
const tree = ts.createSourceFile('content-stage.ts', source, ts.ScriptTarget.Latest, true);
const prop = (n: ts.ObjectLiteralExpression, key: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(tree).replace(/['"]/g,'')===key)?.initializer;
const calls: ts.CallExpression[] = [];
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(tree)==='callOpenAICompatibleJsonWithUsage' && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1]) && prop(n.arguments[1], 'stage')?.getText(tree)==="'inner'") calls.push(n);
  ts.forEachChild(n,visit);
}
visit(tree); assert.equal(calls.length,1);
const call = calls[0];
const fn = tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='generateContentPackage') as ts.FunctionDeclaration;
const initial = (name:string) => fn.body!.statements.filter(ts.isVariableStatement).flatMap(n=>[...n.declarationList.declarations]).find(d=>d.name.getText(tree)===name)!.initializer!;
const topicExpr = initial('canonicalTopic'); const payloadExpr = initial('promptInput');
assert.ok(ts.isConditionalExpression(topicExpr) && ts.isConditionalExpression(payloadExpr));
const cleaner = tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='reduceInnerPlanNoise')!;
const transpile = (text:string) => ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText;
const buildPayload = new Function('input','standardPagePlan','evidence',transpile(`${cleaner.getText(tree)}\nconst canonicalTopic=${topicExpr.whenTrue.getText(tree)}; return ${payloadExpr.whenTrue.getText(tree)};`));
const invoke = new Function('callOpenAICompatibleJsonWithUsage','promptInput',transpile(`let finalContentResponseTrace; return ${call.getText(tree)};`));
const joined = prop((call.arguments[0] as ts.ArrayLiteralExpression).elements[0] as ts.ObjectLiteralExpression,'content') as ts.CallExpression;
const literals = ((joined.expression as ts.PropertyAccessExpression).expression as ts.ArrayLiteralExpression).elements;
const paragraphs = literals.map(n=>{assert.ok(ts.isStringLiteral(n));return n.text;});
const system = paragraphs.join('\n');
const options = call.arguments[1] as ts.ObjectLiteralExpression;
assert.equal(prop(options,'temperature')?.getText(tree),'0.35');
assert.equal(prop(options,'maxTokens')?.getText(tree),'10000');
assert.equal(prop(options,'retries')?.getText(tree),'2');
assert.equal(process.env.OPENAI_MODEL || 'qwen3.7-flash','qwen3.7-flash');
assert.ok(!process.env.AI_BRIDGE_DIR);
assert.equal(new URL(process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').origin,'https://dashscope.aliyuncs.com');
const edits = JSON.parse(await fs.readFile(path.join(root,'experimental-edits.json'),'utf8'));
const at = (obj:any, field:string) => field.split('.').reduce((v,k)=>v[k],obj);
const set = (obj:any,field:string,value:any) => {const keys=field.split('.'); const key=keys.pop()!; const parent=keys.reduce((v,k)=>v[k],obj); assert.equal(typeof parent[key],'string'); parent[key]=value;};
const cases:any[]=[];
for(const id of ['A','B','C']) {
  const priorDir=path.resolve(`data/inner-commercial-stability/2026-09-06/run/${id}`);
  const wire=JSON.parse(await fs.readFile(path.join(priorDir,'request.json'),'utf8'));
  const prior=JSON.parse(wire.messages[1].content);
  const preNoise=JSON.parse(await fs.readFile(path.join(priorDir,'original-input.json'),'utf8'));
  assert.deepEqual(preNoise.evidence,[]);
  const current=buildPayload({topic:{topic:preNoise.topic.finalPublicTopic,promise:preNoise.topic.promise}},{data:preNoise.canonical_page_plan},[]);
  assert.equal(JSON.stringify(current),wire.messages[1].content,'Current production builder must exactly reconstruct the last wire input.');
  assert.equal(system,wire.messages[0].content,'Current source system must equal previous real request.');
  assert.deepEqual(current,prior);
  const clean=structuredClone(current);
  const diff=Object.entries(edits[id]).map(([field,value])=>{const before=at(clean,field);set(clean,field,value);return {field,before,after:value};});
  assert.deepEqual(clean.evidence,current.evidence);
  assert.equal(clean.canonical_page_plan.length,current.canonical_page_plan.length);
  clean.canonical_page_plan.forEach((p:any,i:number)=>{
    assert.equal(p.pageId,current.canonical_page_plan[i].pageId);
    assert.equal(p.userGets,current.canonical_page_plan[i].userGets,'All explicit asset quantities and applications retained verbatim.');
  });
  cases.push({id,wire,current,clean,diff,source:priorDir});
}
async function sourceHashes() {
  const result:Record<string,string>={};
  async function walk(dir:string) { for(const ent of await fs.readdir(dir,{withFileTypes:true})) { const name=path.join(dir,ent.name); if(ent.isDirectory()) await walk(name); else if(ent.isFile()) result[name]=hash(await fs.readFile(name,'utf8')); } }
  await walk('src');
  for(const name of ['package.json','tsconfig.json']) result[name]=hash(await fs.readFile(name,'utf8'));
  return result;
}
const productionHashes=await sourceHashes();
const md=(v:any)=>String(v).replace(/\|/g,'\\|').replace(/\n/g,'<br>');
if(prepare) {
  for(const c of cases) {
    await write(`${c.id}_CURRENT_SYSTEM.txt`,system);
    await save(`${c.id}_CURRENT_USER_PAYLOAD.json`,c.current);
    await save(`${c.id}_CLEAN_INPUT.json`,c.clean);
    await save(`${c.id}_DIFF.json`,c.diff);
    await write(`${c.id}_DIFF.md`, `# ${c.id} ORIGINAL → CLEAN\n\n| 字段 | 原文 | 实验副本 |\n|---|---|---|\n`+c.diff.map((d:any)=>`| ${md(d.field)} | ${md(d.before)} | ${md(d.after)} |`).join('\n')+'\n');
  }
  const effects=[
    ['定义输入与目标','要求交齐核心资产'],
    ['开放内容形式','按阅读负担自然分页','真人语气但不虚构经历'],
    ['语言准确性','明确否定上游评价是教学依据；不是正向等级要求','改写保留语义边界'],
    ['解释对应实际法语','中法语言边界','证据与假设案例边界'],
    ['严格JSON与单一顶层','已有必需字段合同','可选展示意图，不强制类型配额','单一正文与下游职责隔离'],
  ];
  const systemRows=paragraphs.flatMap((p,i)=>p.split('。').filter(Boolean).map((s,j)=>({sentence:s+'。',effect:effects[i][j] || '当前输出合同',necessary:i===4&&j===2?'可选，允许布局意图':'是',risk:'未见正向诱导；不把否定句中的关键词当诱导证据',decision:'KEEP'})));
  await write('SYSTEM_SENTENCE_AUDIT.md','# 当前System逐句审计\n\nSYSTEM_CLEAN_NEEDED = NO；CURRENT_INNER_SYSTEM_FULLY_CLEAN = YES（指未见明确正向教学诱导，并非保证模型服从）。\n\n| System句子 | 真正作用 | 是否必要 | 是否会诱导错误 | KEEP / REMOVE / REWRITE |\n|---|---|---|---|---|\n'+systemRows.map(r=>`| ${md(r.sentence)} | ${r.effect} | ${r.necessary} | ${r.risk} | ${r.decision} |`).join('\n')+'\n\n自由选择形式与交齐材料不冲突；保留原意与B原Plan要求扩展论据有跨消息冲突。DELF B2是领域身份，不是升级要求。Schema枚举含英文是结构字段，不是正文英语教学指令。实验沿用原System，未另造Clean System。\n');
  const rows:any[]=[];
  for(const c of cases) {
    const add=(field:string,risk:string,impact:string)=>rows.push([c.id,field,typeof at(c.current,field)==='string'?at(c.current,field):JSON.stringify(at(c.current,field)),risk,impact]);
    add('topic.finalPublicTopic',c.id==='B'?'高分/满分/万能等点击话术可被当教学目标':c.id==='A'?'直接拿走/万能属于点击承诺，不是材料主题':'稳过/直接拿走属于点击钩子，不是材料要求','可能；作者不必看到这些钩子，保留DELF B2领域及主题即可');
    add('topic.promise',c.id==='B'?'明确要求修改后高阶表达，与System无等级化要求冲突':c.id==='A'?'无等级结论；4类4组与Plan每类4组的层级有歧义':'无等级结论；公开1组，Plan扩展为9组','B明确会诱导；A/C是交付负担/粒度问题，不能偷偷缩减');
    c.current.canonical_page_plan.forEach((p:any,i:number)=>{
      add(`canonical_page_plan.${i}.pageGoal`,c.id==='C'&&i===0?'强化论据可能被理解为增强原立场；实验改为论据表达':'只规定类别或功能，无等级/真实事实结论',c.id==='C'&&i===0?'可能':'正常决定任务内容，不是污染');
      add(`canonical_page_plan.${i}.userGets`,c.id==='A'?'每类4组句式与2案例；没有列明第4组角色，存在计数粒度歧义':'明确数量、改写、解释与应用，无等级结论','决定交付负担，实验逐字保留');
      const bRisk=['强制复杂从句、词汇替换和语法优化，预定修改方法','学术化/深度/客观性导向，把论证风格预定为教学目标','要求原句单一利益变为综合论证，与保留原意直接冲突'][i];
      add(`canonical_page_plan.${i}.pageContentPlan`,c.id==='B'?bRisk:c.id==='A'?'具体信函功能和完整前后文本要求，没有法语答案或得分规则':'无明显等级词；仍限定语法/词汇修改点，可能诱导每组都找语法术语',c.id==='B'?'明确可能；不能只删除高级二字':c.id==='A'?'影响工作量，保留；不是教学等级污染':'可能；实验改为本次实际修改说明，保留解释和所有案例');
    });
    add('evidence','空数组，无来源文本或外部事实注入','不应产生真实法律/研究断言；允许明确假设案例');
  }
  await write('USER_FIELD_AUDIT.md','# 当前User逐字段语义审计\n\n| Task | 字段 | 原文 | 风险 | 是否可能影响Inner |\n|---|---|---|---|---|\n'+rows.map(r=>'| '+r.map(md).join(' | ')+' |').join('\n')+'\n\n所有pageId仅作标识，逐字保留。这里逐项审查而非关键词程序评分。原文全部来自重建后与实际wire逐字一致的请求。\n');
  await save('audit-manifest.json',{systemCleanNeeded:false,currentSystemFullyClean:true,currentInputFullyClean:false,systemSha256:hash(system),allThreeSystemsByteEqual:true,productionBuilderMatchesAllPriorWire:true,productionHashes,parameters:{model:'qwen3.7-flash',temperature:0.35,max_tokens:10000,thinking:false,response_format:{type:'json_object'},productionRetries:2},cases:cases.map(c=>({id:c.id,source:c.source,currentHash:hash(JSON.stringify(c.current)),cleanHash:hash(JSON.stringify(c.clean)),systemHash:hash(system)}))});
  console.log('PREPARED: no network calls; source reconstruction and asset counts checked.');
  process.exit(0);
}
const audit=JSON.parse(await fs.readFile(path.join(root,'audit-manifest.json'),'utf8'));
assert.deepEqual(productionHashes,audit.productionHashes,'Production frozen since audit.');
assert.equal(hash(system),audit.systemSha256);
for(const c of cases) assert.deepEqual(c.clean,JSON.parse(await fs.readFile(path.join(root,`${c.id}_CLEAN_INPUT.json`),'utf8')));
await fs.mkdir(path.join(root,'run')); // Exclusive: no rerun or best-of selection.
const originalFetch=globalThis.fetch; let active:any;
const sent=new Set<string>(); const observed:any[]=[]; const results:any[]=[];
globalThis.fetch=async(url,init)=>{
  assert.ok(active&&!sent.has(active.id)&&sent.size<3,'Exactly one request per task, no technical retry send.');
  const body=JSON.parse(String(init?.body));
  assert.deepEqual({...body,messages:undefined},{...active.wire,messages:undefined});
  assert.equal(body.messages.length,2); assert.equal(body.messages[0].content,system); assert.equal(body.messages[1].content,JSON.stringify(active.clean));
  sent.add(active.id); const entry:any={case:active.id};observed.push(entry);
  await save(`run/${active.id}/request.json`,body);
  console.log(`REQUEST ${active.id}`);
  const response=await originalFetch(url,init); const text=await response.clone().text(); entry.httpStatus=response.status;
  await save(`run/${active.id}/raw.json`,{httpStatus:response.status,requestId:response.headers.get('x-request-id'),bodyText:text});
  const wire=JSON.parse(text); entry.usage=wire.usage; entry.finishReason=wire.choices?.[0]?.finish_reason;
  await save(`run/${active.id}/usage.json`,wire.usage||null);
  if(typeof wire.choices?.[0]?.message?.content==='string') await write(`run/${active.id}/raw-content.txt`,wire.choices[0].message.content);
  return response;
};
try {
  for(const c of cases) {
    active=c; await fs.mkdir(path.join(root,'run',c.id));
    await save(`run/${c.id}/original-input.json`,c.current); await save(`run/${c.id}/clean-input.json`,c.clean); await write(`run/${c.id}/system.txt`,system);
    try { const result=await invoke(callOpenAICompatibleJsonWithUsage,c.clean); await save(`run/${c.id}/parsed.json`,result.data); await save(`run/${c.id}/result.json`,result); results.push({case:c.id,status:'GENERATED',usage:result.usage}); }
    catch(e) {results.push({case:c.id,status:'FAILED',errorName:(e as Error).name});}
    console.log(`DONE ${c.id} ${results.at(-1).status}`);
  }
} finally {
  globalThis.fetch=originalFetch;
  await save('run/summary.json',{observed,results,httpCalls:sent.size,productionUnchanged:JSON.stringify(await sourceHashes())===JSON.stringify(productionHashes)});
}
