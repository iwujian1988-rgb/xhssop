import { NextResponse } from 'next/server';
import { getRecentAiUsage, resetRecentAiUsage } from '@/lib/ai-client';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { compactProductContext, retrieveProductFacts } from '@/lib/product-fact-retrieval';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { composeDraft, generateTopics } from '@/lib/reference-compose';
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
      const topics = await generateTopics({
        productId: body.product_id,
        card,
        productContext: compactProductContext(facts),
        direction: body.direction || '',
      });
      return NextResponse.json({ card, topics, usage: getRecentAiUsage() });
    }

    if (!body.topic) return error('请先选择迁移选题', 400);
    const evidence = retrieveProductFacts(facts, body.topic);
    const draft = await composeDraft({
      productId: body.product_id,
      card,
      topic: body.topic,
      evidence,
    });
    return NextResponse.json({ card, draft, usage: getRecentAiUsage() });
  } catch (cause) {
    console.error('reference studio failed:', cause);
    return error(cause instanceof Error ? cause.message : '笔记生成失败', 500);
  }
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
