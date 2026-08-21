import type { ProductId } from '@/types/data';
import { stableHash, type TitlePair, type TopicOption } from './contracts';
import { resolvePipelineFeatures } from './pipeline-features';
import { deriveTitlePromiseRange } from './content-brief';

/**
 * 阶段 D（设计 §4 / 共识 16.3）：标题方向池与输出数量分离。
 *
 * 纪律：
 * - 只有商品1（delf_b2_writing）普通模式开启；showcase 与商品2/3 完全不走这里。
 * - 方向按 noveltyFingerprint 稳定哈希采样：同一指纹永远同一子集（含顺序），
 *   不同指纹采样不同；不建小 N 固定模板，只定义 6 个方向的结构描述。
 * - prompt 文本不塞固定标题示例，只给方向的结构说明（历史教训：AI 会抄示例）。
 */

/** 6 方向池（共识 16.3：资料/大全、大痛点、情绪、反常识、结果/省时路径、真人陈述）。 */
export type TitleDirection = 'material' | 'pain' | 'emotion' | 'counter' | 'fast_path' | 'voice';

export const TITLE_DIRECTIONS: Array<{ id: TitleDirection; label: string; brief: string }> = [
  { id: 'material', label: '资料/大全型', brief: '突出资料、清单、大全、整理完整感与可收藏性' },
  { id: 'pain', label: '大痛点型', brief: '从备考者正在经历的最大具体困扰切入' },
  { id: 'emotion', label: '情绪型', brief: '承载备考焦虑、委屈、破防等情绪共鸣，情绪要具体不空喊' },
  { id: 'counter', label: '反常识型', brief: '挑战常见做法或认知，给出反转观点' },
  { id: 'fast_path', label: '省时路径型', brief: '强调更省时间的做法路径，只讲路径不讲天赋，不作提分/通过承诺' },
  { id: 'voice', label: '真人陈述型', brief: '像过来人一样第一人称陈述经验与判断' },
];

/** 标题共识新路径门控：商品1 且非知识库介绍模式（productShowcase 判定沿用 title-stage 现状）。 */
export function resolveTitleConsensusActive(productId: ProductId, isProductShowcase: boolean): boolean {
  return resolvePipelineFeatures(productId).consensusTitleStage && !isProductShowcase;
}

/** 输出组数收口：默认 4，clamp 1-8（设计 §4.1 / 共识 18-3）。 */
export function clampTitleCandidateCount(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 4;
  return Math.max(1, Math.min(8, Math.round(value)));
}

/**
 * 从 6 方向池为本篇采样 directionCount 个方向（带稳定顺序）。
 * 用 stableHash(fingerprint|方向id) 排序实现确定性洗牌：同一指纹永远同一有序子集；
 * 不同指纹落进 720 种排列中的不同窗口，天然打散（比固定步长轮换多几个数量级的组合）。
 * directionCount 超过池子大小时封顶取全池。
 */
export function sampleDirectionsForNote(fingerprint: string, directionCount: number): TitleDirection[] {
  const count = Math.max(1, Math.min(directionCount, TITLE_DIRECTIONS.length));
  return TITLE_DIRECTIONS
    .map(direction => ({ id: direction.id, key: stableHash(`${fingerprint}|${direction.id}`) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, count)
    .map(item => item.id);
}

/** 门控开的 required_candidate_mix：每个采样方向恰好 1 组。 */
export function candidateMixForDirections(directions: TitleDirection[]): Record<string, number> {
  const mix: Record<string, number> = {};
  for (const direction of directions) mix[direction] = 1;
  return mix;
}

/** 门控开时替换 legacy「四种机制各1组」两行 system 的方向子集说明。 */
export function titleDirectionPromptLines(directions: TitleDirection[], candidateCount: number): string[] {
  const list = directions
    .map(id => TITLE_DIRECTIONS.find(item => item.id === id))
    .filter((item): item is { id: TitleDirection; label: string; brief: string } => Boolean(item))
    .map(item => `${item.label}（${item.id}）：${item.brief}`)
    .join('；');
  const exactlyOne = candidateCount <= directions.length;
  return [
    `本次只返回${candidateCount}组成对候选，方向子集如下，${exactlyOne ? '每方向恰好1组' : '每方向至少1组，多余组数在子集内换角度'}，禁止用同一方向改写凑数，也不要返回多余组数：${list}。`,
    `mechanism字段必须填写本次方向子集的英文值之一：${directions.join('/')}。各组候选的句式和核心点击理由必须真正不同，不能只换同义词。`,
  ];
}

/**
 * 6 方向分类器（设计 §4.2：现有 4 机制正则思路 + 情绪/真人陈述判别词）。
 * 仅门控路径使用；legacy 的 classifyTitleMechanism 4 分类保持不动。
 */
export function classifyTitleDirection(pair: TitlePair): TitleDirection {
  const declared = pair.mechanism.toLowerCase();
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  if (/voice|真人|过来人|亲测|亲历|我考过|我练了|考了两次|复读/.test(`${declared} ${title}`)) return 'voice';
  if (/emotion|情绪|焦虑|破防|崩溃|心累|emo|发慌|慌了|emo了/.test(`${declared} ${title}`)) return 'emotion';
  if (/counter|反常识|认知冲突|争议|挑战|原来|竟然|反而|越.+越|不是.+而是|别再|误区|真相/.test(`${declared} ${title}`)) return 'counter';
  if (/pain|大痛点|恐惧|损失|风险|避坑|警告|选错|丢分|白练|白背|浪费|来不及|后悔|最怕|致命|千万别/.test(`${declared} ${title}`)) return 'pain';
  if (/fast_path|省时|省时间|少走弯路|更快|五分钟|三分钟|不用.{0,6}直接|先别|别急|提分|高分|写出来|会展开|搞懂|看懂|选对/.test(`${declared} ${title}`)) return 'fast_path';
  return 'material';
}

/**
 * 承诺超出「标题可承诺范围」的轻量检查（设计 §5 末尾 / §6.2：只返修标题，不硬拦）。
 * 判定规则：标题出现强效果承诺词（保过/包过/押题/原题/满分/保证通过/快速提分类），
 * 而 promise / expandContents / factTerms 都没有这个承诺时，记一条返修级 failure。
 * 承诺词在范围内则放行；模糊概括（"帮你更快找到重点"类）不在此列，不拦（§6.1）。
 */
const STRONG_PROMISE_PATTERN = /保过|包过|保证通过|押题|原题|满分|一次通过|短期提分|快速提分|秒过/;

export function titlePromiseBeyondRange(pair: TitlePair, topic: TopicOption): string | null {
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const match = title.match(STRONG_PROMISE_PATTERN);
  if (!match) return null;
  const allowed = [topic.promise, ...(topic.expandContents || []), ...(topic.factTerms || [])].join(' ');
  if (allowed.includes(match[0])) return null;
  return `标题承诺「${match[0]}」超出本篇可承诺范围，正文与选题都没有这个承诺`;
}

/** user JSON 里的「标题可承诺范围」文本（复用阶段 C 的派生，不重复实现）。 */
export function titlePromiseRangeText(topic: TopicOption): string | undefined {
  const text = deriveTitlePromiseRange(topic);
  return text || undefined;
}
