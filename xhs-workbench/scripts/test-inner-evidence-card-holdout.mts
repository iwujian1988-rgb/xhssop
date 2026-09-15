import env from '@next/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateContentPackage } from '../src/lib/v2/content-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { buildLockedProductionBrief } from '../src/lib/v2/content-brief';
import type { UserVisiblePagePlan } from '../src/lib/v2/contracts';

env.loadEnvConfig(process.cwd());
delete process.env.AI_BRIDGE_DIR;

const root = process.cwd();
const outputRoot = path.join(root, 'data', 'inner-evidence-card-holdout-20260910');
const sourceJobFile = path.join(root, 'data', 'batches', 'batch_1789005556011', 'jobs', 'job_001.json');
const nativeFetch = globalThis.fetch;
const live = process.argv.includes('--live');
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const readJson = async <T = any,>(file: string): Promise<T> => JSON.parse(await fs.readFile(file, 'utf8'));
const saveJson = async (file: string, value: unknown) => {
  const target = path.join(outputRoot, file);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const holdouts: Array<{ id: string; topic: string; promise: string; plan: UserVisiblePagePlan[]; expectedEvidence: string[] }> = [
  {
    id: 'A_CONCESSION',
    topic: 'B2写作里三种让步表达怎么正确区分',
    promise: '对比bien que、même si和malgré的结构与逻辑关系，并给出正确使用示例。',
    plan: [{
      pageId: 'p1',
      pageGoal: '交付 bien que、même si、malgré 三种让步表达的结构对比',
      userGets: '三种让步表达的语式或后接结构，以及各一个完整例句',
      pageContentPlan: '说明 bien que 与虚拟式、même si 的常规动词形式、malgré 后接名词短语；不把三者说成结构完全相同',
    }],
    expectedEvidence: ['SUBJONCTIF-BIEN-QUE-01', 'INDICATIF-MEME-SI-01', 'PREPOSITION-MALGRE-01'],
  },
  {
    id: 'B_FORMAL_REQUEST',
    topic: 'B2正式信里不同强度的请求怎么表达',
    promise: '区分il faut、il faudrait、je vous prie和je vous saurais gré的语法形式与礼貌效果。',
    plan: [{
      pageId: 'p1',
      pageGoal: '交付正式请求中 il faut、il faudrait、je vous prie、je vous saurais gré 的对比',
      userGets: '每个表达的实际语法形式、语气效果和适用边界',
      pageContentPlan: '用正式信情境说明四种请求表达；区分条件式、直陈式、命令式标签与礼貌效果',
    }],
    expectedEvidence: ['FALLOIR-IL-FAUT-FAUDRAIT-01', 'FORMAL-SAVOIR-GRE-01', 'FORMAL-JE-VOUS-PRIE-01'],
  },
  {
    id: 'C_DELF_REQUIREMENTS',
    topic: 'DELF B2写作篇幅与评分到底怎么看',
    promise: '说明最低篇幅、任务回应和整体评分维度，不编单句固定扣分规则。',
    plan: [{
      pageId: 'p1',
      pageGoal: '交付DELF B2写作最低篇幅、任务完成和评分方式的事实说明',
      userGets: '250词最低要求、官方评分维度，以及单句错误不对应固定扣分的边界',
      pageContentPlan: '说明DELF B2书面表达篇幅要求、任务回应、连贯、语域、词汇和形态句法的整体评价方式',
    }],
    expectedEvidence: ['DELF-B2-MINIMUM-WORDS-01', 'DELF-B2-SCORING-DIMENSIONS-01', 'DELF-B2-NO-ATOMIC-PENALTY-01'],
  },
];

function dummyInner(plan: UserVisiblePagePlan[]) {
  return JSON.stringify({
    innerPages: plan.map((page, index) => ({
      pageId: page.pageId,
      page_type: 'knowledge_list',
      page_title: `离线占位${index + 1}`,
      lead: '仅用于捕获生产请求。',
      bullets: ['离线占位内容。'],
      source_ids: [],
    })),
  });
}

async function captureProductionRequest(item: typeof holdouts[number]) {
  const sourceJob = await readJson(sourceJobFile);
  const unlockedTopic = { ...sourceJob.artifacts.selectedTopic.data, topic: item.topic, promise: item.promise };
  const topic = { ...unlockedTopic, productionBrief: buildLockedProductionBrief(unlockedTopic) };
  const card = getCompetitorCreativeCard(sourceJob.reference_card_id);
  assert(card, 'source creative card missing');
  const captured: any[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const request = JSON.parse(init?.body || '{}');
    captured.push(request);
    const content = captured.length === 1 ? JSON.stringify({ pages: item.plan }) : dummyInner(item.plan);
    return new Response(JSON.stringify({
      id: `holdout-offline-${item.id}-${captured.length}`,
      model: request.model,
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    await generateContentPackage({ topic, capability: getCapabilityFallback(card), evidence: [] });
  } finally {
    globalThis.fetch = nativeFetch;
  }
  assert.equal(captured.length, 2, `${item.id}: expected Page Plan and Inner requests`);
  return captured[1];
}

async function callProvider(request: any, id: string, variant: 'baseline' | 'evidence') {
  assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY missing');
  assert(process.env.OPENAI_BASE_URL, 'OPENAI_BASE_URL missing');
  const response = await nativeFetch(`${process.env.OPENAI_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(300000),
  });
  const raw = await response.text();
  await saveJson(`${id}/${variant}-provider.json`, { status: response.status, raw });
  assert(response.ok, `${id}/${variant}: HTTP_${response.status}`);
  const provider = JSON.parse(raw);
  const content = provider.choices?.[0]?.message?.content;
  assert.equal(typeof content, 'string', `${id}/${variant}: content missing`);
  const parsed = JSON.parse(content);
  assert(Array.isArray(parsed.innerPages), `${id}/${variant}: innerPages missing`);
  await saveJson(`${id}/${variant}-raw.json`, { content });
  await saveJson(`${id}/${variant}-parsed.json`, parsed);
  await saveJson(`${id}/${variant}-usage.json`, provider.usage || {});
  return { usage: provider.usage || {}, finishReason: provider.choices?.[0]?.finish_reason };
}

const beforeHash = sha256(await fs.readFile(sourceJobFile));
try {
  if (!live) {
    for (const item of holdouts) {
      const request = await captureProductionRequest(item);
      assert.equal(request.model, 'qwen3.8-max-0902', `${item.id}: production Inner model changed`);
      assert.equal(request.temperature, 0.35, `${item.id}: production temperature changed`);
      assert.equal(request.max_tokens, 4600, `${item.id}: production max tokens changed`);
      const userMessage = request.messages.find((message: any) => message.role === 'user');
      const payload = JSON.parse(userMessage.content);
      const actualIds = payload.evidence.map((entry: any) => entry.id);
      console.log(item.id, actualIds);
      item.expectedEvidence.forEach(id => assert(actualIds.includes(id), `${item.id}: missing ${id}`));
      assert(payload.evidence.length <= 4, `${item.id}: page cap exceeded`);
      await saveJson(`${item.id}/request-evidence.json`, request);
      const baselineRequest = structuredClone(request);
      const baselineUser = baselineRequest.messages.find((message: any) => message.role === 'user');
      baselineUser.content = JSON.stringify({ ...payload, evidence: [] });
      await saveJson(`${item.id}/request-baseline.json`, baselineRequest);
      await saveJson(`${item.id}/matched-evidence.json`, payload.evidence);
    }
    await saveJson('offline.json', { pass: true, holdouts: holdouts.map(item => item.id), realAiCalls: 0 });
    console.log('OFFLINE PASS: three paired holdouts captured from the production Inner path.');
  } else {
    assert((await readJson(path.join(outputRoot, 'offline.json'))).pass, 'offline checks must pass first');
    const calls: any[] = [];
    for (const item of holdouts) {
      for (const variant of ['baseline', 'evidence'] as const) {
        const request = await readJson(path.join(outputRoot, item.id, `request-${variant}.json`));
        const call = { id: item.id, variant, model: request.model, startedAt: new Date().toISOString() };
        calls.push(call);
        await saveJson('calls.json', calls);
        const result = await callProvider(request, item.id, variant);
        Object.assign(call, result, { finishedAt: new Date().toISOString() });
        await saveJson('calls.json', calls);
        console.log(item.id, variant, result.finishReason, result.usage);
      }
    }
  }
} finally {
  globalThis.fetch = nativeFetch;
  const afterHash = sha256(await fs.readFile(sourceJobFile));
  assert.equal(afterHash, beforeHash, 'source production Job changed');
  await saveJson(live ? 'preservation.json' : 'offline-preservation.json', {
    unchanged: true,
    sourceJobFile,
    sha256: beforeHash,
  });
}
