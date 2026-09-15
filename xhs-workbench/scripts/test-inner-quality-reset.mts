/** Fixed real input replay only; no production workflow or downstream imports.
 * Reuses the source Inner call expression and the existing production AI client.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import nextEnv from '@next/env';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

nextEnv.loadEnvConfig(process.cwd());
const run = process.argv.includes('--run');
const stability = process.argv.includes('--stability');
const round = process.argv.includes('--round2') ? 2 : 1;
if (stability) assert.equal(round, 1, 'Final stability test has no second round.');
const selected = (process.argv.find(a => a.startsWith('--cases='))?.slice(8) || 'A,B,C').split(',');
assert.ok(selected.length && selected.every(c => ['A', 'B', 'C'].includes(c)));
assert.equal(new Set(selected).size, selected.length);
if (round === 1) assert.deepEqual(selected, ['A', 'B', 'C']);
const root = path.resolve(stability ? 'data/inner-commercial-stability/2026-09-06' : 'data/inner-quality-reset/2026-09-06');
const output = path.join(root, stability ? 'run' : `round-${round}`);
const sourceRoot = path.resolve(stability ? 'data/inner-quality-reset/2026-09-06/round-2' : 'data/plan-finalize-inner/2026-09-06');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const source = await fs.readFile('src/lib/v2/content-stage.ts', 'utf8');
const tree = ts.createSourceFile('content-stage.ts', source, ts.ScriptTarget.Latest, true);
const prop = (n: ts.ObjectLiteralExpression, key: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText(tree).replace(/['"]/g, '') === key)?.initializer;
const calls: ts.CallExpression[] = [];
function visit(n: ts.Node) {
  if (ts.isCallExpression(n) && n.expression.getText(tree) === 'callOpenAICompatibleJsonWithUsage'
      && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])
      && prop(n.arguments[1], 'stage')?.getText(tree) === "'inner'") calls.push(n);
  ts.forEachChild(n, visit);
}
visit(tree);
assert.equal(calls.length, 1);
const call = calls[0];
const options = call.arguments[1] as ts.ObjectLiteralExpression;
assert.equal(prop(options, 'temperature')?.getText(tree), stability ? '0.35' : '0.72');
assert.equal(prop(options, 'maxTokens')?.getText(tree), '10000');
assert.equal(prop(options, 'retries')?.getText(tree), '2');
assert.equal(process.env.OPENAI_MODEL || 'qwen3.7-flash', 'qwen3.7-flash');
assert.ok(!process.env.AI_BRIDGE_DIR);
assert.equal(new URL(process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').origin, 'https://dashscope.aliyuncs.com');
// Execute the exact production call expression, with only its promptInput dependency supplied.
const js = ts.transpileModule(`let finalContentResponseTrace; return ${call.getText(tree)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const invoke = new Function('callOpenAICompatibleJsonWithUsage', 'promptInput', js);
let cleanPlan = (pages: any[]) => pages;
if (stability) {
  const cleaner = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'reduceInnerPlanNoise');
  assert.ok(cleaner);
  assert.ok(source.includes('canonical_page_plan: reduceInnerPlanNoise(standardPagePlan!.data.map'));
  const cleanerJs = ts.transpileModule(cleaner.getText(tree), {compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None}}).outputText;
  cleanPlan = new Function(`${cleanerJs}; return reduceInnerPlanNoise;`)();
  const fixture = [{pageId: '高分句式-ID', pageGoal: '3组高分句式，每组完整应用', userGets: '2个案例，5组完整例句及中文解释', pageContentPlan: 'B2高分句式；高阶表达；低级表达；基础表达；语法/词汇升级点；系统升级；场景：课程咨询；Before/After'}];
  const before = JSON.stringify(fixture);
  Object.freeze(fixture[0]); Object.freeze(fixture);
  const cleaned = cleanPlan(fixture);
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(cleaned[0].pageId, fixture[0].pageId);
  assert.equal(cleaned[0].pageGoal, '3组句式，每组完整应用');
  assert.equal(cleaned[0].userGets, fixture[0].userGets);
  assert.equal(cleaned[0].pageContentPlan, '适合本页任务的句式；表达；原表达；原表达；语法/词汇修改点；系统升级；场景：课程咨询；Before/After');
  assert.deepEqual(cleanPlan(cleaned), cleaned);
}
const cases = await Promise.all(selected.map(async id => {
  const file = path.join(sourceRoot, id, stability ? 'request.json' : 'inner-1/request.json');
  const request = JSON.parse(await fs.readFile(file, 'utf8'));
  const originalPayload = JSON.parse(request.messages[1].content);
  const payload = stability ? {...originalPayload, canonical_page_plan: cleanPlan(originalPayload.canonical_page_plan)} : originalPayload;
  assert.deepEqual(Object.keys(payload).sort(), ['canonical_page_plan', 'evidence', 'topic']);
  assert.deepEqual(payload.topic, originalPayload.topic);
  assert.deepEqual(payload.evidence, originalPayload.evidence);
  assert.equal(JSON.stringify(originalPayload), request.messages[1].content);
  const planNumbers = (plan: unknown) => JSON.stringify(plan).replace(/B2/g, '').match(/\d+/g);
  assert.deepEqual(planNumbers(payload.canonical_page_plan), planNumbers(originalPayload.canonical_page_plan), 'Preserve plan quantities; B2 inside a removed teaching label is not an asset count.');
  return { id, file, request, payload, originalPayload, payloadSha256: hash(JSON.stringify(payload)), originalPayloadSha256: hash(request.messages[1].content) };
}));
if (round === 2) {
  const review = JSON.parse(await fs.readFile(path.join(root, 'round-1-review.json'), 'utf8'));
  assert.equal(review.allowOnePromptRevision, true);
  assert.ok(selected.every(id => review.failedCases.includes(id)));
}
console.log(JSON.stringify({run, round, stability, planCopyUnitChecks: stability ? 'PASS' : undefined, cases: cases.map(c => ({case: c.id, input: c.file, sha256: c.payloadSha256})), productionCallExtracted: true}));
if (!run) process.exit(0);
await fs.mkdir(root, { recursive: true });
await fs.mkdir(output); // Exclusive: no overwriting evidence or accidental rerun.
const save = (file: string, data: unknown) => fs.writeFile(path.join(output, file), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
await save('manifest.json', { round, stability, sourceSha256: hash(source), productionCall: call.getText(tree), cases: cases.map(c => ({case: c.id, source: c.file, payloadSha256: c.payloadSha256, originalPayloadSha256: c.originalPayloadSha256})) });
const nativeFetch = globalThis.fetch;
let active: typeof cases[number];
const attempts = new Set<string>();
const observed: any[] = [];
const results: any[] = [];
globalThis.fetch = async (url, init) => {
  assert.ok(active);
  assert.ok(!attempts.has(active.id), 'No second network request per sample, including technical retry.');
  assert.ok(observed.length < selected.length);
  const body = JSON.parse(String(init?.body));
  assert.equal(body.messages[1].content, stability ? JSON.stringify(active.payload) : active.request.messages[1].content, 'Only production-cleaned Plan copy may change input.');
  assert.deepEqual({...body, messages: undefined}, {...active.request, messages: undefined, ...(stability ? {temperature: 0.35} : {})}, 'Only Inner temperature may change generation parameters.');
  assert.equal(body.messages.length, 2);
  attempts.add(active.id);
  const entry: any = {case: active.id, payloadSha256: hash(body.messages[1].content)};
  observed.push(entry);
  await save(`${active.id}/request.json`, body);
  await save(`${active.id}/user-payload.json`, JSON.parse(body.messages[1].content));
  await fs.writeFile(path.join(output, active.id, 'system.txt'), body.messages[0].content, {flag: 'wx'});
  console.log(`REQUEST ${round} ${active.id}`);
  const response = await nativeFetch(url, init);
  const bodyText = await response.clone().text();
  entry.httpStatus = response.status;
  await save(`${active.id}/raw.json`, {httpStatus: response.status, requestId: response.headers.get('x-request-id'), bodyText});
  const wire = JSON.parse(bodyText);
  entry.usage = wire.usage;
  entry.finishReason = wire.choices?.[0]?.finish_reason;
  await save(`${active.id}/usage.json`, wire.usage || null);
  const text = wire.choices?.[0]?.message?.content;
  if (typeof text === 'string') await fs.writeFile(path.join(output, active.id, 'raw-content.txt'), text, {flag: 'wx'});
  return response;
};
try {
  for (const c of cases) {
    active = c;
    await fs.mkdir(path.join(output, c.id));
    if (stability) {
      await save(`${c.id}/original-input.json`, c.originalPayload);
      await save(`${c.id}/original-plan.json`, c.originalPayload.canonical_page_plan);
      await save(`${c.id}/clean-plan.json`, c.payload.canonical_page_plan);
    }
    try {
      const result = await invoke(callOpenAICompatibleJsonWithUsage, c.payload);
      await save(`${c.id}/parsed.json`, result.data);
      await save(`${c.id}/result.json`, result);
      results.push({case: c.id, status: 'GENERATED', usage: result.usage});
    } catch (e) {
      results.push({case: c.id, status: 'FAILED', errorName: (e as Error).name});
    }
    console.log(`DONE ${c.id} ${results.at(-1).status}`);
  }
} finally {
  globalThis.fetch = nativeFetch;
  await save('summary.json', {observed, results, httpCalls: observed.length});
}
console.log(`OUTPUT ${output}`);
