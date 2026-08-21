import { NextResponse } from 'next/server';

import { emptyAiUsage, getRecentAiUsage, mergeAiUsage, resetRecentAiUsage } from '@/lib/ai-client';
import { formatBatchId, formatJobId, createBatch, deleteJob, listBatches, loadAllJobs, loadBatch, saveJob, type Batch, type BatchJob, type ContentMode } from '@/lib/batch-store';
import { getActiveRunner, startBatchRunner } from '@/lib/batch-runner';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { generateTopics, refineSeededTopics } from '@/lib/reference-compose';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { compactProductContext } from '@/lib/product-fact-retrieval';
import { planSeededTopics } from '@/lib/editorial-seed-library';
import { getRecentSeedIds } from '@/lib/seed-usage-store';
import { findSimilarTopic } from '@/lib/title-usage-store';
import type { ProductId } from '@/types/data';
import { isV2PipelineEnabled, planTopicsV2 } from '@/lib/v2/pipeline';
import { resolvePipelineFeatures } from '@/lib/v2/pipeline-features';
import { selectTopicsForCard } from '@/lib/v2/batch-topic-selection';
import { topicOptionToMigrated } from '@/lib/v2/topic-stage';
import type { ConsensusTopicOption } from '@/lib/v2/consensus-topic-stage';
import type { BatchPlanMeta } from '@/lib/batch-store';

export const runtime = 'nodejs';

const productIds: ProductId[] = ['delf_b2_writing', 'tef_tcf_canada', 'tcf_canada_writing_7day'];

interface PlanBody {
  product_id: ProductId;
  card_ids: string[];
  direction?: string;
  content_mode?: ContentMode;
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
  const contentMode: ContentMode = body.content_mode === 'product_showcase' ? 'product_showcase' : 'standard';

  resetRecentAiUsage();
  const batchId = formatBatchId();
  const facts = await loadProductFacts(body.product_id);
  const productContext = compactProductContext(facts);

  const batch: Batch = {
    id: batchId,
    product_id: body.product_id,
    direction,
    content_mode: contentMode,
    created_at: new Date().toISOString(),
    status: 'planned',
    pipeline_version: isV2PipelineEnabled() ? 'v2' : 'v1',
    jobs: [],
  };
  await createBatch(batch);

  const seenTopics = new Set<string>();
  // 批内发牌上下文：上一张卡发过的 seed 和确认的选题文本要传给下一张卡，
  // 否则各卡独立选牌会把同一个 seed 发 5 次（batch_1786754651839 的
  // delf_pain_logic_jump），不同 seed 也会收敛到同一知识点。
  const batchUsedSeedIds: string[] = [];
  const batchUsedTopicTexts: string[] = [];
  // B2（§3.4）：仅商品1 + 普通模式走共识 3 候选池 + 程序挑选；
  // 商品2/3 与 showcase 的批量路径完全不走新逻辑。
  const useConsensusPlan = isV2PipelineEnabled()
    && resolvePipelineFeatures(body.product_id).consensusTopicStage
    && contentMode !== 'product_showcase';
  const planMeta: BatchPlanMeta = {};
  let seq = 1;
  let v2Usage = emptyAiUsage();

  for (const cardId of body.card_ids) {
    const card = getCompetitorCreativeCard(cardId);
    if (!card || !card.supported) continue;
    // 商品展示截图只能在“介绍知识库”模式使用，防止绕过前台直接提交错模式卡片。
    if (contentMode === 'standard' && card.renderer_id === 'showcase_screenshot') continue;
    if (contentMode === 'product_showcase' && card.renderer_id !== 'showcase_screenshot') continue;
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (!spec) continue;

    let topics;
    if (isV2PipelineEnabled()) {
      const planned = await planTopicsV2({
        productId: body.product_id,
        card,
        facts,
        direction,
        contentMode,
        // 前台选择的是最终要生成的选题数；不要再额外硬编码候选池数量。
        // （共识分支忽略 limit：候选池恒为 3，由 selectTopicsForCard 挑 topicsPerCard 个。）
        limit: topicsPerCard,
        recentAngles: batchUsedTopicTexts,
        topicMode: 'batch',
      });
      v2Usage = mergeAiUsage(v2Usage, planned.usage);
      if (useConsensusPlan) {
        // 共识挑选：卡内候选间互查 + 方向覆盖 + 跨卡软规避；未选中候选与警告进 plan_meta。
        const selection = selectTopicsForCard({
          candidates: planned.artifact.data as ConsensusTopicOption[],
          topicsPerCard,
          cardUsedTopicTexts: [],
          batchUsedTopicTexts,
        });
        topics = selection.selected.map(topicOptionToMigrated);
        planMeta.unselected_candidates = [
          ...(planMeta.unselected_candidates || []),
          ...selection.unselected.map(item => ({ card_id: cardId, topic: item.topic.topic, reason: item.reason })),
        ];
        planMeta.warnings = [
          ...(planMeta.warnings || []),
          ...planned.artifact.warnings,
          ...selection.warnings,
        ];
        if (planned.artifact.needsManualReview) planMeta.needs_manual_review = true;
      } else {
        topics = planned.topics;
      }
    } else {
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
      topics = seededTopics.length ? await refineSeededTopics({
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
    }

    let acceptedForCard = 0;
    // 介绍模式中，每张截图本身就是一个独立商品展示任务，不能被跨卡去重吞掉。
    const cardUsedTopicTexts: string[] = [];
    for (const topic of topics) {
      if (acceptedForCard >= topicsPerCard) break;
      const topicText = `${topic.topic} ${topic.content_promise || ''}`.trim();
      // 每张已选封面都是独立 job；只在同一张封面内去重。
      // 之前普通模式使用 batchUsedTopicTexts，导致不同封面拿到相似选题时被跨卡吞掉。
      const duplicateScope = cardUsedTopicTexts;
      if (findSimilarTopic(topicText, duplicateScope, 0.56)) continue;
      const topicKey = `${cardId}:${topic.seed_id || topic.id || topic.topic}`;
      if (seenTopics.has(topicKey)) continue;
      seenTopics.add(topicKey);
      if (topic.seed_id) batchUsedSeedIds.push(topic.seed_id);
      batchUsedTopicTexts.push(`${topic.topic} ${topic.content_promise || ''} ${(topic.dynamic_fact_terms || []).join(' ')}`);
      cardUsedTopicTexts.push(topicText);
      const job: BatchJob = {
        id: formatJobId(seq),
        seq,
        product_id: body.product_id,
        reference_card_id: cardId,
        topic,
        status: 'pending',
        attempts: 0,
      pipeline_version: 'v2',
        current_stage: isV2PipelineEnabled() ? 'topic_selected' : undefined,
      };
      await saveJob(batchId, job);
      acceptedForCard += 1;
      seq += 1;
    }
  }

  const finalBatch = await loadBatch(batchId);
  // plan_meta 持久化进批计划（只加字段，不破坏现有结构；仅共识挑选路径有值）。
  if (planMeta.unselected_candidates || planMeta.warnings || planMeta.needs_manual_review) {
    finalBatch.plan_meta = planMeta;
    await createBatch(finalBatch);
  }
  return NextResponse.json({
    batch: finalBatch,
    usage: isV2PipelineEnabled() ? v2Usage : getRecentAiUsage(),
    pipeline_version: isV2PipelineEnabled() ? 'v2' : 'v1',
  });
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
