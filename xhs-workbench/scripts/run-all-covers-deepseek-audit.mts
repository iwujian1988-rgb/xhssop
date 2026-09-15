/* eslint-disable no-console */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { standardCreativeCards } from '../src/lib/creative-card-library';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4100';
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 5);
const POLL_MS = Number(process.env.POLL_MS || 10_000);
const outputPath = process.env.OUT_JSON || path.join(os.tmpdir(), 'xhs-cover-audits', `all-covers-deepseek-audit-${Date.now()}.json`);
const requestedCardIds = new Set((process.env.CARD_IDS || '').split(',').map(value => value.trim()).filter(Boolean));
const cards = standardCreativeCards.filter(card => card.supported && (!requestedCardIds.size || requestedCardIds.has(card.id)));
const chunks = Array.from({ length: Math.ceil(cards.length / CHUNK_SIZE) }, (_, index) => cards.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE));
const report: Record<string, any> = {
  started_at: new Date().toISOString(),
  base_url: BASE_URL,
  model_mode: 'real_deepseek',
  cards: cards.map(card => ({ id: card.id, renderer: card.renderer_id, name: card.name })),
  batches: [],
  jobs: [],
};

console.log(`[cover-audit] cards=${cards.length} chunks=${chunks.length} chunk_size=${CHUNK_SIZE}`);
await fs.mkdir(path.dirname(outputPath), { recursive: true });

for (const [chunkIndex, chunk] of chunks.entries()) {
  console.log(`[cover-audit] plan chunk ${chunkIndex + 1}/${chunks.length}: ${chunk.map(card => card.id).join(', ')}`);
  const planned = await post('/api/batch', {
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: chunk.map(card => card.id),
    topics_per_card: 1,
    knowledge_mode: process.env.KNOWLEDGE_MODE || 'educational_original',
    direction: '用于真实小红书发布验收。每张封面必须使用不同且适合其信息组织方式的DELF B2写作选题；内容具体、法语准确、可执行，不介绍开发过程。',
  });
  const batchId = planned.batch?.id;
  if (!batchId) throw new Error(`chunk ${chunkIndex + 1} 未返回batch id`);
  console.log(`[cover-audit] planned ${batchId} jobs=${planned.batch.jobs.length} tokens=${planned.usage?.total_tokens || 0}`);
  await post('/api/batch', { action: 'run', batch_id: batchId });
  const final = await waitForBatch(batchId, chunkIndex + 1, chunks.length);
  report.batches.push({ id: batchId, plan_usage: planned.usage, batch: final.batch });
  report.jobs.push(...(final.jobs || []));
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
}

report.finished_at = new Date().toISOString();
report.summary = {
  total: report.jobs.length,
  success: report.jobs.filter((job: any) => job.status === 'success').length,
  failed: report.jobs.filter((job: any) => job.status === 'failed').length,
  tokens: report.jobs.reduce((sum: number, job: any) => sum + Number(job.usage?.total_tokens || job.failure?.usage?.total_tokens || 0), 0),
  calls: report.jobs.reduce((sum: number, job: any) => sum + Number(job.usage?.calls || job.failure?.usage?.calls || 0), 0),
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`[cover-audit] complete ${JSON.stringify(report.summary)} output=${outputPath}`);

async function waitForBatch(batchId: string, chunkIndex: number, chunkCount: number) {
  for (let poll = 1; poll <= 360; poll += 1) {
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
    const state = await get(`/api/batch?batch_id=${encodeURIComponent(batchId)}`);
    const jobs = state.jobs || [];
    const done = jobs.filter((job: any) => ['success', 'failed'].includes(job.status)).length;
    const ok = jobs.filter((job: any) => job.status === 'success').length;
    const fail = jobs.filter((job: any) => job.status === 'failed').length;
    const running = jobs.find((job: any) => job.status === 'running');
    console.log(`[cover-audit] chunk=${chunkIndex}/${chunkCount} poll=${poll} done=${done}/${jobs.length} ok=${ok} fail=${fail} running=${running?.reference_card_id || '-'}`);
    if (state.batch?.status === 'done') return state;
  }
  throw new Error(`batch timeout: ${batchId}`);
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(600_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status}: ${json.error || JSON.stringify(json).slice(0, 1000)}`);
  return json;
}

async function get(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(60_000) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status}: ${json.error || JSON.stringify(json).slice(0, 1000)}`);
  return json;
}
