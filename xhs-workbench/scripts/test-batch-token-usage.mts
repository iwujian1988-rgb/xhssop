import assert from 'node:assert/strict';
import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, mergeAiUsage } from '../src/lib/ai-client';
import { estimateTokenCost, summarizeTokenUsage } from '../src/lib/token-usage';

const originalFetch = globalThis.fetch;
const key = process.env.OPENAI_API_KEY;
const bridge = process.env.AI_BRIDGE_DIR;
process.env.OPENAI_API_KEY = 'offline-test';
delete process.env.AI_BRIDGE_DIR;
try {
  let count = 0;
  globalThis.fetch = async () => {
    count++;
    return new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }, choices: [{ finish_reason: count === 1 ? 'length' : 'stop', message: { content: '{}' } }] }), { status: 200 });
  };
  const a = await callOpenAICompatibleJsonWithUsage([], { model: 'test-max', retries: 2 });
  assert.equal(a.usage.calls, 2);
  assert.equal(a.usage.by_model!['test-max'].calls, 2);
  assert.equal(a.usage.by_model!['test-max'].unreported_calls, 0);
  assert.equal(a.usage.by_model!['test-max'].total_tokens, 300);
  const b = await callOpenAICompatibleJsonWithUsage([], { model: 'test-flash', retries: 1 });
  const merged = mergeAiUsage(a.usage, b.usage);
  const legacy = { ...emptyAiUsage(), prompt_tokens: 30, completion_tokens: 20, total_tokens: 50, calls: 1 };
  const total = summarizeTokenUsage([JSON.parse(JSON.stringify(merged)), legacy, undefined]);
  assert.equal(total.total_tokens, 500);
  assert.equal(total.prompt_tokens, 330);
  assert.equal(total.calls, 4);
  assert.equal(estimateTokenCost(a.usage.by_model!['test-max'], '2', '6'), .001);
  assert.equal(estimateTokenCost(a.usage.by_model!['test-max'], '', '6'), null);
  assert.equal(estimateTokenCost(a.usage.by_model!['test-max'], '-1', '6'), null);
  assert.equal(estimateTokenCost({ ...a.usage.by_model!['test-max'], cached_tokens: 100 }, '2', '6', '0.4'), .00084);
  globalThis.fetch = async () => new Response(JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_tokens_details: { cached_tokens: 80 } }, choices: [{ message: { content: '{}' } }] }), { status: 200 });
  const cached = await callOpenAICompatibleJsonWithUsage([], { model: 'cached', retries: 1 });
  assert.equal(cached.usage.by_model!.cached.cached_tokens, 80);
  assert.equal(cached.usage.by_model!.cached.cache_reported_calls, 1);
  assert.equal(mergeAiUsage(cached.usage, cached.usage).by_model!.cached.cached_tokens, 160);
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200 });
  const missing = await callOpenAICompatibleJsonWithUsage([], { model: 'missing', retries: 1 });
  assert.equal(missing.usage.by_model!.missing.unreported_calls, 1);
  console.log('PASS: per-model usage, retries, roundtrip persistence, legacy totals, cost arithmetic, missing usage. Real AI calls = 0');
} finally {
  globalThis.fetch = originalFetch;
  if (key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = key;
  if (bridge === undefined) delete process.env.AI_BRIDGE_DIR; else process.env.AI_BRIDGE_DIR = bridge;
}
