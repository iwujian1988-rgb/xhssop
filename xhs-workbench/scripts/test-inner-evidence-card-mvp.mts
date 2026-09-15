import env from '@next/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateContentPackage } from '../src/lib/v2/content-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

env.loadEnvConfig(process.cwd());
delete process.env.AI_BRIDGE_DIR;

const root = process.cwd();
const outputRoot = path.join(root, 'data', 'inner-evidence-card-mvp-20260910');
const batchRoot = path.join(root, 'data', 'batches', 'batch_1789005556011', 'jobs');
const cases = ['001', '005', '009'] as const;
const nativeFetch = globalThis.fetch;
const live = process.argv.includes('--live');

const readJson = async <T = any,>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, 'utf8'));
const saveJson = async (file: string, value: unknown) => {
  const target = path.join(outputRoot, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');

async function fixture(id: typeof cases[number]) {
  const jobFile = path.join(batchRoot, `job_${id}.json`);
  const job = await readJson(jobFile);
  const historicalRequest = await readJson(path.join(root, 'data', 'inner-pro-historical-20260910', id, 'historical-request.json'));
  const historicalRaw = await readJson(path.join(root, 'data', 'inner-pro-historical-20260910', id, 'historical-raw.json'));
  const historicalPayload = JSON.parse(historicalRequest.messages.find((message: any) => message.role === 'user').content);
  const card = getCompetitorCreativeCard(job.reference_card_id);
  assert(card, `${id}: missing creative card ${job.reference_card_id}`);
  return { id, jobFile, job, historicalPayload, historicalRaw, card };
}

async function captureProductionInnerRequest(item: Awaited<ReturnType<typeof fixture>>, innerContent: string) {
  const captured: any[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const request = JSON.parse(init?.body || '{}');
    captured.push(request);
    const content = captured.length === 1
      ? JSON.stringify({ pages: item.historicalPayload.canonical_page_plan })
      : innerContent;
    return new Response(JSON.stringify({
      id: `evidence-card-offline-${item.id}-${captured.length}`,
      model: request.model,
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await generateContentPackage({
      topic: item.job.artifacts.selectedTopic.data,
      capability: getCapabilityFallback(item.card),
      evidence: [],
    });
    assert.equal(captured.length, 2, `${item.id}: expected mocked Page Plan + Inner calls`);
    return { request: captured[1], normalized: result.data };
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

const jobFiles = await fs.readdir(batchRoot);
const beforeHashes = Object.fromEntries(await Promise.all(jobFiles.filter(name => name.endsWith('.json')).map(async name => [
  name,
  sha256(await fs.readFile(path.join(batchRoot, name))),
])));

try {
  if (!live) {
    for (const id of cases) {
      const item = await fixture(id);
      const captured = await captureProductionInnerRequest(item, item.historicalRaw.messageContent);
      const payload = JSON.parse(captured.request.messages.find((message: any) => message.role === 'user').content);
      assert.deepEqual(payload.canonical_page_plan, item.historicalPayload.canonical_page_plan, `${id}: Page Plan changed`);
      assert(Array.isArray(payload.evidence), `${id}: evidence missing`);
      assert(payload.evidence.every((entry: any) => Array.isArray(entry.applicablePageIds)), `${id}: page scopes missing`);
      assert(captured.request.messages[0].content.includes('evidence仅用于核对applicablePageIds'), `${id}: evidence boundary prompt missing`);
      assert.equal(captured.request.model, 'qwen3.8-max-0902', `${id}: Inner model changed`);
      assert.equal(captured.request.temperature, 0.35, `${id}: temperature changed`);
      assert.equal(captured.request.max_tokens, 4600, `${id}: max_tokens changed`);
      await saveJson(`${id}/request.json`, captured.request);
      await saveJson(`${id}/matched-evidence.json`, payload.evidence);
      await saveJson(`${id}/offline-normalized.json`, captured.normalized);
    }
    await saveJson('offline.json', { pass: true, realAiCalls: 0, cases, productionRequestCaptured: true });
    console.log('OFFLINE PASS: production Inner requests captured with page-scoped evidence cards.');
  } else {
    assert((await readJson(path.join(outputRoot, 'offline.json'))).pass, 'offline acceptance must pass first');
    assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY missing');
    assert(process.env.OPENAI_BASE_URL, 'OPENAI_BASE_URL missing');
    const calls: any[] = [];
    for (const id of cases) {
      const request = await readJson(path.join(outputRoot, id, 'request.json'));
      const startedAt = new Date().toISOString();
      calls.push({ id, model: request.model, startedAt });
      await saveJson('calls.json', calls);
      let response: Response;
      try {
        response = await nativeFetch(`${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(300000),
        });
      } catch (error) {
        calls[calls.length - 1] = {
          ...calls[calls.length - 1],
          failedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
          providerReached: false,
        };
        await saveJson('calls.json', calls);
        throw error;
      }
      const raw = await response.text();
      await saveJson(`${id}/provider.json`, { status: response.status, raw });
      assert(response.ok, `${id}: HTTP_${response.status}`);
      const provider = JSON.parse(raw);
      const content = provider.choices?.[0]?.message?.content;
      assert.equal(typeof content, 'string', `${id}: provider content missing`);
      const parsed = JSON.parse(content);
      assert(Array.isArray(parsed.innerPages), `${id}: innerPages missing`);
      await saveJson(`${id}/raw.json`, { content });
      await saveJson(`${id}/parsed.json`, parsed);
      await saveJson(`${id}/usage.json`, provider.usage || {});
      const item = await fixture(id);
      const replayed = await captureProductionInnerRequest(item, content);
      await saveJson(`${id}/normalized.json`, replayed.normalized);
      calls[calls.length - 1] = {
        ...calls[calls.length - 1],
        finishedAt: new Date().toISOString(),
        usage: provider.usage || {},
        finishReason: provider.choices?.[0]?.finish_reason,
      };
      await saveJson('calls.json', calls);
      console.log(id, provider.model, provider.choices?.[0]?.finish_reason, provider.usage);
    }
  }
} finally {
  globalThis.fetch = nativeFetch;
  const afterHashes = Object.fromEntries(await Promise.all(jobFiles.filter(name => name.endsWith('.json')).map(async name => [
    name,
    sha256(await fs.readFile(path.join(batchRoot, name))),
  ])));
  assert.deepEqual(afterHashes, beforeHashes, 'production Job files changed');
  await saveJson(live ? 'preservation.json' : 'offline-preservation.json', {
    unchanged: true,
    productionJobWrites: 0,
    hashes: beforeHashes,
  });
}
