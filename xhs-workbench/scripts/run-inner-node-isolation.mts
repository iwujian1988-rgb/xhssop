/**
 * One-off fixed-input Inner experiment; never imported by production.
 * Reuses the current Inner prompt/options and its existing AI client.
 * No Page Plan, QA, repair, normalization, renderer or downstream calls.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import nextEnv from '@next/env';
import { callOpenAICompatibleJsonWithUsage, type AiMessage, type AiCallOptions } from '../src/lib/ai-client';

nextEnv.loadEnvConfig(process.cwd());
const root = path.resolve('data/inner-node-isolation/2026-09-06-fixed-ab');
const run = process.argv.includes('--run');
const model = process.env.OPENAI_MODEL || 'qwen3.7-flash';
assert.equal(model, 'qwen3.7-flash', 'Experiment must use unchanged current model.');
assert.ok(!process.env.AI_BRIDGE_DIR, 'Experiment requires actual configured provider, not bridge responses.');
const sourcePath = path.resolve('src/lib/v2/content-stage.ts');
const source = await fs.readFile(sourcePath, 'utf8');
const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const innerCalls: ts.CallExpression[] = [];
const property = (node: ts.ObjectLiteralExpression, name: string) =>
  node.properties.find((p): p is ts.PropertyAssignment =>
    ts.isPropertyAssignment(p) && p.name.getText(tree).replace(/['"]/g, '') === name)?.initializer;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'callOpenAICompatibleJsonWithUsage'
      && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])
      && property(node.arguments[1], 'stage')?.getText(tree) === "'inner'") innerCalls.push(node);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(innerCalls.length, 1, 'Expected exactly one existing Inner callsite.');
const call = innerCalls[0];
const messageArray = call.arguments[0] as ts.ArrayLiteralExpression;
const systemObject = messageArray.elements[0] as ts.ObjectLiteralExpression;
const joined = property(systemObject, 'content') as ts.CallExpression;
const promptArray = (joined.expression as ts.PropertyAccessExpression).expression as ts.ArrayLiteralExpression;
assert.ok(ts.isArrayLiteralExpression(promptArray));
const systemPrompt = promptArray.elements.map(node => {
  assert.ok(ts.isStringLiteral(node), 'Read literal source prompt; no copied prompt in test harness.');
  return node.text;
}).join('\n');
const productionOptions = call.arguments[1] as ts.ObjectLiteralExpression;
const options: AiCallOptions = {
  stage: 'inner',
  maxTokens: Number(property(productionOptions, 'maxTokens')?.getText(tree)),
  temperature: Number(property(productionOptions, 'temperature')?.getText(tree)),
  // Diagnostic transport control only: six samples mean six requests, no technical retries.
  retries: 1,
};
assert.equal(options.temperature, 0.72);
assert.equal(options.maxTokens, 10000);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sources = JSON.parse(await fs.readFile(path.join(root, 'source-map.json'), 'utf8'));
const cases: Array<{ task: number; group: string; payload: any; messages: AiMessage[] }> = [];
for (const task of [1, 2, 3]) {
  const original = JSON.parse(await fs.readFile(sources[task - 1].sourcePath, 'utf8'));
  for (const group of ['A', 'B']) {
    const payload = JSON.parse(await fs.readFile(path.join(root, 'inputs', 'task' + task + '-' + group + '.json'), 'utf8'));
    if (group === 'A') assert.deepEqual(payload, original.userPayload, 'A must preserve the actual complete original payload.');
    cases.push({ task, group, payload, messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ] });
  }
}
const manifest = {
  mode: 'FIXED_INPUT_INNER_ONLY',
  sourcePath, sourceSha256: hash(source), systemPrompt, systemPromptSha256: hash(systemPrompt),
  model, options, thinking: false, response_format: { type: 'json_object' },
  productionRetriesUnchanged: Number(property(productionOptions, 'retries')?.getText(tree)),
  transportNote: 'Test only retries=1 to enforce six real requests; generation settings match current Inner.',
  cases: cases.map(c => ({
    task: c.task, group: c.group,
    payloadSha256: hash(JSON.stringify(c.payload)),
    inputPath: path.join(root, 'inputs', 'task' + c.task + '-' + c.group + '.json'),
  })),
};
console.log(JSON.stringify({ run, model, options, promptChars: systemPrompt.length, cases: manifest.cases }, null, 2));
if (!run) process.exit(0);
// Refuse accidental reruns before any external request.
const output = path.join(root, 'short-v1');
await fs.mkdir(output);
const save = async (file: string, data: unknown) =>
  fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
await save(path.join(output, 'manifest.json'), manifest);
let currentDirectory = '';
let currentMessages: AiMessage[] = [];
let requestCount = 0;
const fetchOriginal = globalThis.fetch;
// Capture the exact request body and provider response, including unsuccessful/invalid-JSON responses.
// This wrapper does not alter the request, output, or production client.
globalThis.fetch = async (input, init) => {
  assert.ok(currentDirectory);
  assert.ok(requestCount < 6, 'Six-request budget exhausted.');
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, model);
  assert.equal(body.temperature, options.temperature);
  assert.equal(body.max_tokens, options.maxTokens);
  assert.deepEqual(body.messages, currentMessages);
  await save(path.join(currentDirectory, '01_INPUT.json'), body);
  requestCount++;
  const response = await fetchOriginal(input, init);
  const text = await response.clone().text();
  await save(path.join(currentDirectory, '04_PROVIDER_RAW.json'), {
    httpStatus: response.status, requestId: response.headers.get('x-request-id'),
    bodyText: text,
  });
  return response;
};
const summaries: unknown[] = [];
try {
  for (const c of cases) {
    currentDirectory = path.join(output, 'task' + c.task + '-' + c.group);
    currentMessages = c.messages;
    await fs.mkdir(currentDirectory);
    await fs.writeFile(path.join(currentDirectory, '02_SYSTEM_PROMPT.txt'), systemPrompt + '\n', { flag: 'wx' });
    await save(path.join(currentDirectory, '03_USER_PAYLOAD.json'), c.payload);
    try {
      const result = await callOpenAICompatibleJsonWithUsage<unknown>(c.messages, {
        ...options,
        onResponseTrace: trace => save(path.join(currentDirectory, '05_RESPONSE_TRACE.json'), trace),
      });
      await save(path.join(currentDirectory, '06_PARSED_JSON.json'), result.data);
      const summary = { task: c.task, group: c.group, status: 'GENERATED', requestId: result.requestId, usage: result.usage };
      await save(path.join(currentDirectory, '07_USAGE.json'), summary);
      summaries.push(summary);
      console.log(JSON.stringify(summary));
    } catch (error) {
      const e = error as Error & { usage?: unknown };
      // Avoid disclosing credentials or provider error-body text in console output.
      const summary = { task: c.task, group: c.group, status: 'FAILED', errorName: e.name, usage: e.usage };
      await save(path.join(currentDirectory, '07_USAGE.json'), summary);
      summaries.push(summary);
      console.log(JSON.stringify(summary));
    }
  }
} finally {
  globalThis.fetch = fetchOriginal;
  await save(path.join(output, 'summary.json'), { requestCount, results: summaries });
}
console.log('RESULT_DIRECTORY=' + output);

