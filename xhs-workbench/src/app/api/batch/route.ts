import { NextResponse } from 'next/server';

import { getRecentAiUsage, resetRecentAiUsage } from '@/lib/ai-client';
import { formatBatchId, formatJobId, createBatch, deleteJob, listBatches, loadAllJobs, loadBatch, saveJob, type Batch, type BatchJob } from '@/lib/batch-store';
import { getActiveRunner, startBatchRunner } from '@/lib/batch-runner';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { generateTopics, refineSeededTopics } from '@/lib/reference-compose';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { compactProductContext } from '@/lib/product-fact-retrieval';
import { planSeededTopics } from '@/lib/editorial-seed-library';
import { getRecentSeedIds } from '@/lib/seed-usage-store';
import type { ProductId } from '@/types/data';

export const runtime = 'nodejs';

const productIds: ProductId[] = ['delf_b2_writing', 'tef_tcf_canada'];

interface PlanBody {
  product_id: ProductId;
  card_ids: string[];
  direction?: string;
  topics_per_card?: number;
}

interface RunBody {
  batch_id: string;
}

interface RetryFailedBody {
  batch_id: string;
}

interface DeleteJobBody {
  batch_id: string;
  job_id: string;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    switch (body?.action) {
      case 'plan':
        return await handlePlan(body as PlanBody);
      case 'run':
        return await handleRun(body as RunBody);
      case 'retry_failed':
        return await handleRetryFailed(body as RetryFailedBody);
      case 'delete_job':
        return await handleDeleteJob(body as DeleteJobBody);
      default:
        return error(`未知 action: ${body?.action ?? '(missing)'}`, 400);
    }
  } catch (cause) {
    console.error('batch POST failed:', cause);
    return error(cause instanceof Error ? cause.message : '批量请求失败', 500);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const batchId = url.searchParams.get('batch_id');
    if (batchId) {
      const batch = await loadBatch(batchId);
      const jobs = await loadAllJobs(batchId);
      return NextResponse.json({ batch, jobs, active_runner: getActiveRunner() });
    }
    if (url.searchParams.get('list')) {
      const batches = await listBatches();
      return NextResponse.json({ batches });
    }
    return error('请提供 batch_id 或 list=1', 400);
  } catch (cause) {
    console.error('batch GET failed:', cause);
    return error(cause instanceof Error ? cause.message : '批量查询失败', 500);
  }
}

async function handlePlan(body: PlanBody) {
  if (!productIds.includes(body.product_id)) return error('不支持的商品', 400);
  if (!Array.isArray(body.card_ids) || body.card_ids.length === 0) return error('card_ids 不能为空', 400);
  const topicsPerCard = clamp(body.topics_per_card ?? 2, 1, 3);
  const direction = (body.direction || '').trim();

  resetRecentAiUsage();
  const batchId = formatBatchId();
  const facts = await loadProductFacts(body.product_id);
  const productContext = compactProductContext(facts);

  const batch: Batch = {
    id: batchId,
    product_id: body.product_id,
    direction,
    created_at: new Date().toISOString(),
    status: 'planned',
    jobs: [],
  };
  await createBatch(batch);

  const seenTopics = new Set<string>();
  // 批内发牌上下文：上一张卡发过的 seed 和确认的选题文本要传给下一张卡，
  // 否则各卡独立选牌会把同一个 seed 发 5 次（batch_1786754651839 的
  // delf_pain_logic_jump），不同 seed 也会收敛到同一知识点。
  const batchUsedSeedIds: string[] = [];
  const batchUsedTopicTexts: string[] = [];
  let seq = 1;

  for (const cardId of body.card_ids) {
    const card = getCompetitorCreativeCard(cardId);
    if (!card || !card.supported) continue;
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (!spec) continue;

    const recentSeedIds = await getRecentSeedIds(body.product_id, card.id);
    const seededTopics = planSeededTopics({
      productId: body.product_id,
      card,
      facts,
      direction,
      limit: topicsPerCard,
      recentSeedIds,
      batchUsedSeedIds,
      batchUsedTopicTexts,
    });
    const topics = seededTopics.length ? await refineSeededTopics({
      productId: body.product_id,
      card,
      seededTopics,
      direction,
    }) : await generateTopics({
        productId: body.product_id,
        card,
        productContext,
        direction,
      });

    for (const topic of topics.slice(0, topicsPerCard)) {
      const topicKey = `${card.renderer_id}:${topic.seed_id || topic.topic}`;
      if (seenTopics.has(topicKey)) continue;
      seenTopics.add(topicKey);
      if (topic.seed_id) batchUsedSeedIds.push(topic.seed_id);
      batchUsedTopicTexts.push(`${topic.topic} ${topic.content_promise || ''} ${(topic.dynamic_fact_terms || []).join(' ')}`);
      const job: BatchJob = {
        id: formatJobId(seq),
        seq,
        product_id: body.product_id,
        reference_card_id: cardId,
        topic,
        status: 'pending',
        attempts: 0,
      };
      await saveJob(batchId, job);
      seq += 1;
    }
  }

  const finalBatch = await loadBatch(batchId);
  return NextResponse.json({ batch: finalBatch, usage: getRecentAiUsage() });
}

async function handleRun(body: RunBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  const batch = await loadBatch(body.batch_id).catch(() => null);
  if (!batch) return error(`找不到 batch: ${body.batch_id}`, 404);
  const outcome = await startBatchRunner(body.batch_id);
  if (!outcome.started) return NextResponse.json({ started: false, reason: outcome.reason }, { status: 409 });
  return NextResponse.json({ started: true });
}

async function handleRetryFailed(body: RetryFailedBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  const jobs = await loadAllJobs(body.batch_id);
  const failedJobs = jobs.filter(job => job.status === 'failed');
  if (!failedJobs.length) return error('没有 failed 状态的 job 可重试', 400);
  for (const job of failedJobs) {
    // 挂在生图阶段的 job 保留 failure 标记：runOneJob 靠 `failure.stage==='image' && draft`
    // 识别"compose 已成功、只差图"的状态，跳过 LLM 重跑直接恢复生图任务。
    const keepFailure = job.failure?.stage === 'image' && job.draft ? job.failure : undefined;
    await saveJob(body.batch_id, {
      ...job,
      status: 'pending',
      attempts: 0,
      failure: keepFailure,
      started_at: undefined,
      finished_at: undefined,
    });
  }
  const outcome = await startBatchRunner(body.batch_id);
  if (!outcome.started) return NextResponse.json({ started: false, reason: outcome.reason }, { status: 409 });
  return NextResponse.json({ started: true, reset_count: failedJobs.length });
}

async function handleDeleteJob(body: DeleteJobBody) {
  if (!body.batch_id) return error('batch_id 不能为空', 400);
  if (!body.job_id) return error('job_id 不能为空', 400);
  await deleteJob(body.batch_id, body.job_id);
  return NextResponse.json({ deleted: true });
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
