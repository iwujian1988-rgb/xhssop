import type { ProductId } from '@/types/data';

/**
 * 按商品分流新旧流程（共识 §17 多商品并存）。
 *
 * 阶段 A 只建模块：任何现有文件不得 import 它，接线在阶段 B/D。
 * 开关只描述「商品走哪套流程」，不含 showcase 模式判断（设计 §9 红线：
 * 不动 product_showcase；模式分流由阶段 B 接线时处理）。
 */
export type PipelineVersion = 'consensus-v1' | 'legacy-v2';

export interface PipelineFeatures {
  productId: ProductId;
  /** 商品1 用 consensus-v1（共识对齐新流程）；商品2/3 用 legacy-v2（现有 v2 行为，零变化）。 */
  pipelineVersion: PipelineVersion;
  /** 选题阶段走共识 5 块契约 + 3 方向候选池（设计 §3）。 */
  consensusTopicStage: boolean;
  /** 内容任务单补说话动作/承接计划/承诺范围（设计 §5）。 */
  consensusContentBrief: boolean;
  /** 标题节点读正文+封面块+内页摘要、方向池轮换（设计 §4 / 共识 16.3）。 */
  consensusTitleStage: boolean;
}

const CONSENSUS_V1_FEATURES: PipelineFeatures = {
  productId: 'delf_b2_writing',
  pipelineVersion: 'consensus-v1',
  consensusTopicStage: true,
  consensusContentBrief: true,
  consensusTitleStage: true,
};

const LEGACY_V2_FEATURES: Record<'tef_tcf_canada' | 'tcf_canada_writing_7day', PipelineFeatures> = {
  tef_tcf_canada: {
    productId: 'tef_tcf_canada',
    pipelineVersion: 'legacy-v2',
    consensusTopicStage: false,
    consensusContentBrief: false,
    consensusTitleStage: false,
  },
  tcf_canada_writing_7day: {
    productId: 'tcf_canada_writing_7day',
    pipelineVersion: 'legacy-v2',
    consensusTopicStage: false,
    consensusContentBrief: false,
    consensusTitleStage: false,
  },
};

export function resolvePipelineFeatures(productId: ProductId): PipelineFeatures {
  if (productId === 'delf_b2_writing') return CONSENSUS_V1_FEATURES;
  const legacy = LEGACY_V2_FEATURES[productId];
  if (legacy) return legacy;
  // 宁可响亮失败也不要静默当 legacy 处理。
  throw new Error(`resolvePipelineFeatures: unknown productId "${productId}"`);
}
