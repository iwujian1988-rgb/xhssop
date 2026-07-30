/* eslint-disable no-console */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';
const PRODUCTS = ['delf_b2_writing', 'tef_tcf_canada'] as const;
const PRODUCT_FILTER = process.env.TEST_PRODUCT_ID;
const SELECTED_PRODUCTS = PRODUCT_FILTER ? PRODUCTS.filter(productId => productId === PRODUCT_FILTER) : PRODUCTS;
const RESUME_BATCH_ID = process.env.RESUME_BATCH_ID;
const CARDS = [
  'resource_01_grammar_parchment_red',
  'resource_02_grammar_white_green',
  'resource_05_grammar_clean_purple',
  'resource_15_grammar_grid_purple',
  'resource_11_delf_doc_analysis',
  'resource_06_notes_course_offer',
  'resource_10_plain_text_experience',
  'resource_13_course_roadmap_blue',
  'resource_04_chalkboard_phrase_list',
  'resource_14_collocation_dense_green',
];

interface BatchJob {
  id: string;
  seq: number;
  product_id: string;
  reference_card_id: string;
  status: string;
  attempts: number;
  topic: any;
  draft?: any;
  cover_image_url?: string;
  failure?: { stage: string; message: string };
  usage?: { total_tokens: number; calls: number; autofix_count?: number };
}

const allJobs: BatchJob[] = [];
const batches: any[] = [];

if (PRODUCT_FILTER && SELECTED_PRODUCTS.length === 0) {
  throw new Error(`unknown TEST_PRODUCT_ID=${PRODUCT_FILTER}`);
}

if (RESUME_BATCH_ID) {
  console.log(`\n=== resume ${RESUME_BATCH_ID} ===`);
  const runResult = await postJson('/api/batch', { action: 'run', batch_id: RESUME_BATCH_ID });
  if (!runResult.ok && runResult.status !== 409) {
    throw new Error(`run ${RESUME_BATCH_ID} failed: ${runResult.status} ${JSON.stringify(runResult.json).slice(0, 500)}`);
  }
  console.log(`runner=${JSON.stringify(runResult.json)}`);
  const { batch: finalBatch, jobs } = await pollBatch(RESUME_BATCH_ID);
  batches.push(finalBatch);
  allJobs.push(...jobs);
} else {
for (const productId of SELECTED_PRODUCTS) {
  console.log(`\n=== plan ${productId} ===`);
  const planResult = await postJson('/api/batch', {
    action: 'plan',
    product_id: productId,
    card_ids: CARDS,
    topics_per_card: 1,
    direction: '今天要产出可直接挑选发布的小红书素材：标题要有点击欲，封面标题要和模板匹配，正文要像真人分享，商品承接自然。',
  });
  if (!planResult.ok) throw new Error(`plan ${productId} failed: ${planResult.status} ${JSON.stringify(planResult.json).slice(0, 500)}`);
  const batch = planResult.json.batch;
  console.log(`planned batch=${batch.id} jobs=${batch.jobs.length} usage=${JSON.stringify(planResult.json.usage || {})}`);

  const runResult = await postJson('/api/batch', { action: 'run', batch_id: batch.id });
  if (!runResult.ok && runResult.status !== 409) throw new Error(`run ${batch.id} failed: ${runResult.status} ${JSON.stringify(runResult.json).slice(0, 500)}`);
  console.log(`runner=${JSON.stringify(runResult.json)}`);

  const { batch: finalBatch, jobs } = await pollBatch(batch.id);
  batches.push(finalBatch);
  allJobs.push(...jobs);
}
}

const report = buildReport(allJobs, batches);
const stamp = Date.now();
const fullPath = `material-batch-full-${stamp}.json`;
const summaryPath = `material-batch-summary-${stamp}.md`;
await fs.writeFile(fullPath, JSON.stringify({ batches, jobs: allJobs }, null, 2), 'utf8');
await fs.writeFile(summaryPath, report, 'utf8');

console.log(`\nFULL=${fullPath}`);
console.log(`SUMMARY=${summaryPath}`);
console.log(report);

async function pollBatch(batchId: string) {
  let last: any = null;
  let failedPolls = 0;
  for (let i = 1; i <= 240; i += 1) {
    const result = await getJson(`/api/batch?batch_id=${encodeURIComponent(batchId)}`);
    if (!result.ok) {
      failedPolls += 1;
      console.log(`[${batchId}] poll#${i} transient failure status=${result.status} consecutive=${failedPolls}`);
      if (failedPolls >= 6) throw new Error(`poll ${batchId} failed: ${result.status}`);
      await sleep(10000);
      continue;
    }
    failedPolls = 0;
    last = result.json;
    const jobs = (last.jobs || []) as BatchJob[];
    const done = jobs.filter(job => job.status === 'success' || job.status === 'failed').length;
    const success = jobs.filter(job => job.status === 'success').length;
    const failed = jobs.filter(job => job.status === 'failed').length;
    const running = jobs.find(job => job.status === 'running');
    console.log(`[${batchId}] poll#${i} done=${done}/${jobs.length} ok=${success} fail=${failed} running=${running?.reference_card_id || '-'}`);
    if (last.batch?.status === 'done') return { batch: last.batch, jobs };
    await sleep(10000);
  }
  throw new Error(`batch ${batchId} timeout`);
}

function buildReport(jobs: BatchJob[], batchesValue: any[]) {
  const lines: string[] = [];
  lines.push(`# 小红书素材批量生成验收`);
  lines.push(``);
  lines.push(`批次：${batchesValue.map(batch => batch.id).join('、')}`);
  lines.push(`总任务：${jobs.length}，成功：${jobs.filter(job => job.status === 'success').length}，失败：${jobs.filter(job => job.status === 'failed').length}`);
  lines.push(`总 token：${jobs.reduce((sum, job) => sum + (job.usage?.total_tokens || 0), 0).toLocaleString()}`);
  lines.push(``);
  for (const productId of SELECTED_PRODUCTS) {
    const productJobs = jobs.filter(job => job.product_id === productId);
    lines.push(`## ${productId}`);
    for (const job of productJobs) {
      if (job.status !== 'success') {
        lines.push(``);
        lines.push(`### ❌ ${job.reference_card_id}`);
        lines.push(`失败阶段：${job.failure?.stage || '-'}；原因：${job.failure?.message || '-'}`);
        continue;
      }
      const draft = job.draft;
      const verdict = gradeDraft(job);
      lines.push(``);
      lines.push(`### ${verdict.icon} ${verdict.label}｜${job.reference_card_id}`);
      lines.push(`选题：${job.topic?.topic || '-'}`);
      lines.push(`推荐标题：${draft?.selected_title || '-'}`);
      lines.push(`三档标题：${(draft?.title_candidates || []).map((item: any) => `${item.title_type || item.trigger_type || '-'}：${item.title}`).join(' / ')}`);
      lines.push(`封面：${draft?.cover?.title || '-'}｜${draft?.cover?.subtitle || ''}`);
      if (job.cover_image_url) lines.push(`封面图：${job.cover_image_url}`);
      lines.push(`正文：${clip(draft?.caption || '', 260)}`);
      lines.push(`标签：${(draft?.tags || []).join(' ')}`);
      lines.push(`检查：issues=${JSON.stringify(draft?.checks?.issues || [])} warnings=${JSON.stringify(draft?.checks?.warnings || [])}`);
      lines.push(`运营判断：${verdict.reason}`);
      lines.push(`token=${job.usage?.total_tokens || 0} calls=${job.usage?.calls || 0}`);
    }
  }
  return lines.join('\n');
}

function gradeDraft(job: BatchJob) {
  const draft = job.draft || {};
  const issues = draft.checks?.issues || [];
  const warnings = draft.checks?.warnings || [];
  const title = `${draft.selected_title || ''} ${(draft.title_candidates || []).map((item: any) => item.title).join(' ')}`;
  const cover = `${draft.cover?.title || ''} ${draft.cover?.subtitle || ''}`;
  let score = 0;
  const reasons: string[] = [];
  if (!issues.length) score += 3; else reasons.push(`有硬问题：${issues.join(',')}`);
  if (/[？?!！]|别再|先别|警告|白费|乱|差在哪|越|反而|大全|必背|稳过|提分|冲刺|急救/.test(title)) score += 2; else reasons.push('标题点击欲弱');
  if (/DELF|法语|TEF|TCF|CLB|Canada|加拿大/.test(`${title} ${cover}`)) score += 1; else reasons.push('身份不清');
  if (draft.caption && draft.caption.length >= 240 && draft.caption.length <= 430) score += 1; else reasons.push('正文字数不稳');
  if ((draft.tags || []).length >= 5) score += 1; else reasons.push('标签偏少');
  if (warnings.length <= 2) score += 1; else reasons.push(`提醒偏多：${warnings.join(',')}`);
  if (score >= 8) return { icon: '✅', label: '可优先发', reason: reasons.join('；') || '标题、封面、正文、标签和检查都比较稳。' };
  if (score >= 6) return { icon: '🟡', label: '小改可发', reason: reasons.join('；') || '整体可用，但建议发布前顺一下标题/正文。' };
  return { icon: '🔴', label: '暂不建议发', reason: reasons.join('；') || '综合质量不足。' };
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

async function postJson(path: string, body: Record<string, unknown>) {
  const bodyPath = pathJoinTmp(`xhs-batch-post-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(bodyPath, JSON.stringify(body), 'utf8');
  try {
    const result = await execFileAsync('curl.exe', [
      '-sS',
      '--max-time',
      '1200',
      '-H',
      'Content-Type: application/json',
      '--data-binary',
      `@${bodyPath}`,
      '-w',
      '\nHTTP_STATUS:%{http_code}',
      `${BASE_URL}${path}`,
    ], { maxBuffer: 1024 * 1024 * 32, timeout: 21 * 60 * 1000 });
    const output = result.stdout;
    const match = output.match(/\nHTTP_STATUS:(\d{3})\s*$/);
    const status = match ? Number(match[1]) : 0;
    const text = match ? output.slice(0, match.index) : output;
    const json = JSON.parse(text || '{}');
    return { ok: status >= 200 && status < 300, status, json };
  } finally {
    await fs.unlink(bodyPath).catch(() => {});
  }
}

async function getJson(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(60 * 1000) });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pathJoinTmp(file: string) {
  return path.join(os.tmpdir(), file);
}
