import type { ProductId } from '@/types/data';
import type { TopicOption } from './contracts';
import { resolvePipelineFeatures } from './pipeline-features';

/**
 * 阶段 C（设计 §5 改动 E）：内容任务单增补——把共识选题阶段产出的
 * speechAction / openingEmotion / expandContents / bridgeBasis 接进内容阶段 prompt。
 *
 * 纪律：
 * - 全部是软约束：任何字段缺失只进 missing 列表（调用方转警告），绝不抛错。
 * - 纯本地派生，零 AI 调用。
 * - prompt 文本不塞固定示例句，只给结构描述与规则（历史教训：AI 会抄示例）。
 * - 只有商品1（delf_b2_writing）普通模式开启；showcase 与商品2/3 完全不走这里。
 */

/** 带货承接四拍计划（内容 AI 的响应字段，英文键）。 */
export interface BridgePlanBlock {
  freeSolves: string;
  userStillNeeds: string;
  whyProduct: string;
  naturalCta: string;
}

/** 内容任务单增补块（键名与设计 §5 一致，中文）。 */
export interface ConsensusBriefBlock {
  '本篇说话动作': string;
  '开头情绪起势': string;
  '标题可承诺范围': string;
  '人话表达提醒': string;
  '带货承接计划': string;
}

/** 缺失字段中文名（调用方据此生成警告文案）。 */
export const CONSENSUS_BRIEF_FIELD_LABELS = {
  speechAction: '本篇说话动作（speechAction）',
  openingEmotion: '开头情绪起势（openingEmotion）',
  expandContents: '准备展开的内容（expandContents）',
  promise: '用户想得到的结果（promise）',
} as const;

export function resolveContentBriefActive(productId: ProductId, isProductShowcase: boolean): boolean {
  return resolvePipelineFeatures(productId).consensusContentBrief && !isProductShowcase;
}

/**
 * 从 topic 本地派生「标题可承诺范围」：列出本篇承诺了什么、可展开什么、
 * 事实锚词有哪些。标题与正文的承诺都不得超出这个范围（软提示）。
 */
export function deriveTitlePromiseRange(topic: TopicOption): string {
  const parts: string[] = [];
  const promise = (topic.promise || '').trim();
  if (promise) parts.push(`本篇向读者承诺的核心结果是「${promise}」`);
  const expandContents = (topic.expandContents || []).map(item => item && item.trim()).filter(Boolean);
  if (expandContents.length) parts.push(`本篇可展开的内容限于「${expandContents.join('；')}」`);
  const factTerms = (topic.factTerms || []).map(item => item && item.trim()).filter(Boolean);
  if (factTerms.length) parts.push(`涉及考试或商品事实时只能引用这些锚词「${factTerms.join('、')}」`);
  if (!parts.length) return '';
  return `${parts.join('。')}。标题与正文的承诺不得超出以上范围。`;
}

/**
 * 产出设计 §5 的五块内容任务单增补。带货承接计划是「给内容 AI 的产出要求」
 * （要求其在响应 bridgePlan 字段按四拍输出），不是现在填好的文本。
 * 缺失字段值留空并记入 missing，永不抛错。
 */
export function buildConsensusBriefBlock(topic: TopicOption): { block: ConsensusBriefBlock; missing: string[] } {
  const missing: string[] = [];
  const speechAction = (topic.speechAction || '').trim();
  const openingEmotion = (topic.openingEmotion || '').trim();
  if (!speechAction) missing.push(CONSENSUS_BRIEF_FIELD_LABELS.speechAction);
  if (!openingEmotion) missing.push(CONSENSUS_BRIEF_FIELD_LABELS.openingEmotion);

  const promise = (topic.promise || '').trim();
  if (!promise) missing.push(CONSENSUS_BRIEF_FIELD_LABELS.promise);
  const expandContents = (topic.expandContents || []).map(item => item && item.trim()).filter(Boolean);
  if (!expandContents.length) missing.push(CONSENSUS_BRIEF_FIELD_LABELS.expandContents);

  const basis = topic.bridgeBasis
    ? `只锚定能力 ${topic.bridgeBasis.capabilityId} 与模块 ${topic.bridgeBasis.modules.join('、')}，不得编造输入之外的商品功能`
    : '按 evidence 中真实存在的商品资产写，不得编造输入之外的商品功能';

  return {
    block: {
      '本篇说话动作': speechAction,
      '开头情绪起势': openingEmotion,
      '标题可承诺范围': deriveTitlePromiseRange(topic),
      '人话表达提醒': '正文、封面与内页都按系统提示中的人话表达要求写：不用「不是…而是…」「真正的…」「建议收藏」等AI套话，句子写完整，像有经验的人在对同阶段考生说话。',
      '带货承接计划': `在响应的 bridgePlan 字段按四拍各写一句完整中文：freeSolves=本篇免费内容先帮读者解决什么；userStillNeeds=读者照本篇做完后仍然缺什么；whyProduct=商品为什么能接上这个缺口（${basis}）；naturalCta=最后如何自然引导读者查看商品。四拍都要写，不写空话。`,
    },
    missing,
  };
}
