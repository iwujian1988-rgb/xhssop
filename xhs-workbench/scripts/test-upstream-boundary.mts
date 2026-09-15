/** One-off diagnostic only. Calls existing production nodes; never imported by production. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import nextEnv from '@next/env';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { resolveProductEvidence } from '../src/lib/product-fact-retrieval';
import { generateTopicOptions, getCapabilityFallback, topicOptionToMigrated } from '../src/lib/v2/topic-stage';
import { buildLockedProductionBrief } from '../src/lib/v2/content-brief';
import { generateContentPackage } from '../src/lib/v2/content-stage';

nextEnv.loadEnvConfig(process.cwd());
const recovery = process.argv.includes('--network-recovery');
const output = path.resolve('data/upstream-boundary/2026-09-06' + (recovery ? '-network-recovery' : ''));
const run = process.argv.includes('--run');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const topicSource = await fs.readFile('src/lib/v2/topic-stage.ts', 'utf8');
const contentSource = await fs.readFile('src/lib/v2/content-stage.ts', 'utf8');
const parse = (s: string) => ts.createSourceFile('source.ts', s, ts.ScriptTarget.Latest, true);
const contentTree = parse(contentSource);
function property(object: ts.ObjectLiteralExpression, key: string) {
  return object.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p)
    && p.name.getText().replace(/['"]/g, '') === key)?.initializer;
}
function findCall(source: string, stage: string) {
  const tree = parse(source);
  const matches: ts.CallExpression[] = [];
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(tree) === 'callOpenAICompatibleJsonWithUsage'
      && n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])
      && property(n.arguments[1], 'stage')?.getText(tree) === `'${stage}'`) matches.push(n);
    ts.forEachChild(n, visit);
  }
  visit(tree);
  assert.equal(matches.length, 1);
  const call = matches[0];
  const system = (call.arguments[0] as ts.ArrayLiteralExpression).elements[0] as ts.ObjectLiteralExpression;
  const joined = property(system, 'content') as ts.CallExpression;
  const strings = (joined.expression as ts.PropertyAccessExpression).expression as ts.ArrayLiteralExpression;
  assert.ok(ts.isArrayLiteralExpression(strings));
  const prompt = strings.elements.map(n => { assert.ok(ts.isStringLiteral(n)); return n.text; }).join('\n');
  return { prompt, options: call.arguments[1] as ts.ObjectLiteralExpression };
}
const calls = {
  topic: findCall(topicSource, 'topic'),
  page_plan: findCall(contentSource, 'page_plan'),
  inner: findCall(contentSource, 'inner'),
};
const oldInner = (await fs.readFile('data/inner-node-isolation/2026-09-06-fixed-ab/short-v1/task1-A/02_SYSTEM_PROMPT.txt', 'utf8')).trimEnd();
assert.equal(calls.inner.prompt, oldInner);
assert.equal(calls.inner.prompt.length, 699);
assert.equal(property(calls.inner.options, 'temperature')?.getText(), '0.72');
assert.equal(property(calls.inner.options, 'maxTokens')?.getText(), '10000');
assert.equal(property(calls.inner.options, 'retries')?.getText(), '2');
assert.equal(process.env.OPENAI_MODEL || 'qwen3.7-flash', 'qwen3.7-flash');
assert.ok(!process.env.AI_BRIDGE_DIR, 'Real configured provider required.');

const fn = contentTree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'generateContentPackage') as ts.FunctionDeclaration;
function initializer(name: string) {
  const declarations = fn.body!.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]);
  return declarations.find(d => d.name.getText(contentTree) === name)!.initializer!;
}
function objectKeys(n: ts.Node) {
  assert.ok(ts.isObjectLiteralExpression(n));
  return n.properties.map(p => { assert.ok(ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)); return p.name.getText(); }).sort();
}
const topKeys = ['topic', 'canonical_page_plan', 'evidence'].sort();
const topicKeys = ['finalPublicTopic', 'audienceState', 'painOrDesire', 'promise'].sort();
const pageKeys = ['pageId', 'pageGoal', 'userGets', 'pageContentPlan'].sort();
const evidenceKeys = ['id', 'category', 'text', 'evidence', 'caution'].sort();
const payloadExpression = initializer('promptInput');
const topicExpression = initializer('canonicalTopic');
assert.ok(ts.isConditionalExpression(payloadExpression));
assert.ok(ts.isConditionalExpression(topicExpression));
assert.deepEqual(objectKeys(payloadExpression.whenTrue), topKeys);
assert.deepEqual(objectKeys(topicExpression.whenTrue), topicKeys);
const planMap = property(payloadExpression.whenTrue as ts.ObjectLiteralExpression, 'canonical_page_plan') as ts.CallExpression;
const pageBody = (planMap.arguments[0] as ts.ArrowFunction).body as ts.ParenthesizedExpression;
assert.deepEqual(objectKeys(pageBody.expression), pageKeys);
const evidenceMap = initializer('evidence') as ts.CallExpression;
const evidenceBody = (evidenceMap.arguments[0] as ts.ArrowFunction).body as ts.ParenthesizedExpression;
assert.deepEqual(objectKeys(evidenceBody.expression), evidenceKeys);
const proof = { checkedBeforeNetwork: true, topKeys, topicKeys, pageKeys, evidenceKeys,
  innerSystemUnchanged: true, innerChars: oldInner.length, innerSha256: hash(oldInner),
  sourceHashes: { topic: hash(topicSource), content: hash(contentSource) },
  innerParameters: { model: 'qwen3.7-flash', temperature: 0.72, max_tokens: 10000, retries: 2 } };
console.log(JSON.stringify(proof));
if (!run) process.exit(0);

if (recovery) {
  const previous = JSON.parse(await fs.readFile('data/upstream-boundary/2026-09-06/summary.json', 'utf8'));
  assert.equal(previous.observed.length, 6);
  assert.ok(previous.observed.every((r: any) => r.stage === 'topic' && r.networkError && !r.httpStatus));
}

// Exclusive directory creation prevents an accidental second run of the three cases.
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output);
const save = (file: string, value: unknown) => fs.writeFile(path.join(output, file), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
await save('preflight.json', proof);
const seedJob = JSON.parse(await fs.readFile('data/batches/batch_1788674634433/jobs/job_002.json', 'utf8'));
const card = getCompetitorCreativeCard(seedJob.reference_card_id);
assert.ok(card);
const capability = getCapabilityFallback(card);
const facts = await loadProductFacts('delf_b2_writing');
const cases = [
  { id: 'A', direction: 'DELF B2正式信具体场景素材：围绕咨询、跟进、投诉、建议等真实写信需求，策划一篇可收藏的素材笔记。' },
  { id: 'B', direction: 'DELF B2写作：3个社会议题的可收藏论据素材，主题由你选择，给案例及可直接使用的法语表达。' },
  { id: 'C', direction: 'DELF B2写作具体改写案例：给出原表达、修改后表达及中文说明，让读者拿走完整可用的修改前后材料。' },
];
let currentCase = '';
const attempts: Record<string, number> = {};
const observed: Array<Record<string, any>> = [];
const results: Array<Record<string, any>> = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body));
  const stage = Object.entries(calls).find(([, c]) => c.prompt === body.messages?.[0]?.content)?.[0];
  assert.ok(stage && currentCase, 'Unexpected node: no request sent.');
  const key = `${currentCase}/${stage}`;
  const attempt = (attempts[key] || 0) + 1;
  assert.ok(attempt <= (stage === 'page_plan' ? 1 : 2), 'Only existing technical retry allowed.');
  assert.ok(observed.length < 15, 'Three cases only; at most one existing retry per Topic/Inner.');
  assert.equal(body.model, 'qwen3.7-flash');
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  const user = JSON.parse(body.messages[1].content);
  if (stage === 'inner') {
    assert.deepEqual(Object.keys(user).sort(), topKeys);
    assert.deepEqual(Object.keys(user.topic).sort(), topicKeys);
    user.canonical_page_plan.forEach((p: object) => assert.deepEqual(Object.keys(p).sort(), pageKeys));
    user.evidence.forEach((e: any) => {
      assert.deepEqual(Object.keys(e).sort(), evidenceKeys);
      assert.equal(e.category, 'official_exam_fact');
    });
    assert.equal(body.messages[0].content, oldInner);
    assert.equal(body.temperature, 0.72);
    assert.equal(body.max_tokens, 10000);
  }
  const dir = `${currentCase}/${stage}-${attempt}`;
  await fs.mkdir(path.join(output, dir));
  await save(`${dir}/request.json`, body);
  await save(`${dir}/user-payload.json`, user);
  await fs.writeFile(path.join(output, dir, 'system.txt'), body.messages[0].content, { flag: 'wx' });
  attempts[key] = attempt;
  const entry: Record<string, any> = { case: currentCase, stage, attempt, dir };
  observed.push(entry);
  console.log(`REQUEST ${currentCase} ${stage} ${attempt}`);
  try {
    const response = await nativeFetch(url, init);
    const bodyText = await response.clone().text();
    entry.httpStatus = response.status;
    entry.requestId = response.headers.get('x-request-id');
    await save(`${dir}/raw.json`, { httpStatus: response.status, requestId: entry.requestId, bodyText });
    try {
      const wire = JSON.parse(bodyText);
      entry.usage = wire.usage;
      entry.finishReason = wire.choices?.[0]?.finish_reason;
      await save(`${dir}/usage.json`, wire.usage || null);
      const text = wire.choices?.[0]?.message?.content;
      if (typeof text === 'string') {
        await fs.writeFile(path.join(output, dir, 'raw-content.txt'), text, { flag: 'wx' });
        try { await save(`${dir}/parsed.json`, JSON.parse(text)); } catch { entry.rawJsonValid = false; }
      }
    } catch { entry.providerJsonValid = false; }
    return response;
  } catch (error) {
    entry.networkError = error instanceof Error ? error.name : 'Error';
    entry.causeCode = (error as { cause?: { code?: string } }).cause?.code;
    await save(`${dir}/network-error.json`, { name: entry.networkError, causeCode: entry.causeCode });
    throw error;
  }
};
try {
  for (const item of cases) {
    currentCase = item.id;
    await fs.mkdir(path.join(output, item.id));
    await save(`${item.id}/direction.json`, item);
    try {
      const generatedTopic = await generateTopicOptions({ productId: 'delf_b2_writing', card, capability, facts,
        contentMode: 'standard', limit: 1, direction: item.direction, topicMode: 'single' });
      await save(`${item.id}/topic-artifact.json`, generatedTopic);
      assert.equal(generatedTopic.data.length, 1);
      const topic = generatedTopic.data[0];
      topic.productionBrief = buildLockedProductionBrief(topic);
      const evidence = await resolveProductEvidence('delf_b2_writing', facts, topicOptionToMigrated(topic), 8);
      const content = await generateContentPackage({ topic, capability, evidence });
      await save(`${item.id}/content-artifact.json`, content);
      results.push({ case: item.id, status: 'GENERATED', topicUsage: generatedTopic.usage, contentUsage: content.usage });
    } catch (error) {
      const e = error as Error & { usage?: unknown };
      results.push({ case: item.id, status: 'FAILED', errorName: e.name, usage: e.usage });
    }
    console.log(`CASE_DONE ${item.id} ${results.at(-1)?.status}`);
  }
} finally {
  globalThis.fetch = nativeFetch;
  await save('summary.json', { observed, results, httpCalls: observed.length });
}
console.log(`OUTPUT ${output}`);
