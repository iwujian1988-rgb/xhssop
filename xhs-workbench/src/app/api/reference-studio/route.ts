import { NextResponse } from 'next/server';
import { getRecentAiUsage, resetRecentAiUsage } from '@/lib/ai-client';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { compactProductContext, resolveProductEvidence } from '@/lib/product-fact-retrieval';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { composeWithRetry } from '@/lib/compose-with-retry';
import { generateTopics, refineSeededTopics } from '@/lib/reference-compose';
import { planSeededTopics } from '@/lib/editorial-seed-library';
import { getRecentSeedIds, recordSeedUsage } from '@/lib/seed-usage-store';
import { createBatch, formatJobId, saveJob } from '@/lib/batch-store';
import type { ProductId } from '@/types/data';
import type { ReferenceWorkflowRequest } from '@/types/reference-workflow';

const productIds: ProductId[] = ['delf_b2_writing', 'tef_tcf_canada'];

export async function POST(request: Request) {
  resetRecentAiUsage();
  try {
    const body = await request.json() as ReferenceWorkflowRequest;
    if (!productIds.includes(body.product_id)) return error('不支持的商品', 400);
    const card = getCompetitorCreativeCard(body.reference_card_id);
    if (!card) return error('没有找到竞品创作卡', 404);
    if (!card.supported || !getCoverTemplateSpec(card.renderer_id)) {
      return error('当前竞品卡尚未接入动态生成链路。', 400);
    }

    const facts = await loadProductFacts(body.product_id);
    if (body.action === 'topics') {
      const recentSeedIds = await getRecentSeedIds(body.product_id, card.id);
      const seededTopics = planSeededTopics({
        productId: body.product_id,
        card,
        facts,
        direction: body.direction || '',
        limit: 4,
        recentSeedIds,
      });
      const topics = seededTopics.length ? await refineSeededTopics({
        productId: body.product_id,
        card,
        seededTopics,
        direction: body.direction || '',
      }) : await generateTopics({
          productId: body.product_id,
          card,
          productContext: compactProductContext(facts),
          direction: body.direction || '',
        });
      return NextResponse.json({ card, topics, usage: getRecentAiUsage() });
    }

    if (!body.topic) return error('请先选择内容任务', 400);
    const evidence = await resolveProductEvidence(body.product_id, facts, body.topic);
    const outcome = await composeWithRetry({
      productId: body.product_id,
      card,
      topic: body.topic,
      evidence,
    }, body.max_attempts ? { maxAttempts: body.max_attempts } : undefined);
    if (!outcome.ok) {
      const retried = outcome.failure.attempts - 1;
      const retryDescription = retried > 0
        ? `整条流程已自动重跑${retried}次仍失败`
        : '内部返修后仍未通过，本次未整条重跑';
      // 必须带 usage：失败前已经烧了几万 token，尸体池/benchmark 要靠这个数。
      return NextResponse.json({
        error: `${outcome.failure.message}（${retryDescription}，阶段：${outcome.failure.stage}）`,
        usage: outcome.failure.usage,
      }, { status: 500 });
    }
    // 单条生成也落盘，方便历史回看。复用 batch-store 的存储格式（job_001.json），
    // batch_id 用 single_ 前缀，listBatches 默认只列 batch_ 前缀，不会污染 /batch 页面。
    const savedBatchId = `single_${Date.now()}`;
    const now = new Date().toISOString();
    await createBatch({
      id: savedBatchId,
      product_id: body.product_id,
      direction: '',
      created_at: now,
      status: 'done',
      jobs: [],
    });
    await saveJob(savedBatchId, {
      id: formatJobId(1),
      seq: 1,
      product_id: body.product_id,
      reference_card_id: card.id,
      topic: body.topic,
      status: 'success',
      attempts: outcome.attempts,
      draft: outcome.draft,
      started_at: now,
      finished_at: now,
      usage: outcome.usage,
    });
    await recordSeedUsage({ productId: body.product_id, cardId: card.id, draft: outcome.draft })
      .catch(cause => console.error('record seed usage failed:', cause));
    return NextResponse.json({ card, draft: outcome.draft, usage: outcome.usage, saved_batch_id: savedBatchId });
  } catch (cause) {
    console.error('reference studio failed:', cause);
    return error(cause instanceof Error ? cause.message : '笔记生成失败', 500);
  }
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
