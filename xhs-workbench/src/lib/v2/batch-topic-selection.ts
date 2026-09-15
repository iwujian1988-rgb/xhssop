import { findSimilarTopic } from '@/lib/title-usage-store';
import type { ConsensusTopicOption } from './consensus-topic-stage';
import { findHistoricalTopicMatch, type HistoricalTopicMatch, type TopicHistoryDedupMode } from './topic-history-dedup';

/**
 * 阶段 B1：批量挑选纯函数（设计 §3.4“批量挑选保证”）。
 *
 * 候选池数量（恒为 3，共识口径，见 consensus-topic-stage CONSENSUS_CANDIDATE_POOL_SIZE）
 * 与挑选数量 topicsPerCard(1-3) 是两个独立参数：前者决定 AI 产几个候选，
 * 后者决定每张卡从池子里挑几个。两个字段绝不合并。
 *
 * 保证：
 * 1. 同一候选至多选中一次；
 * 2. 优先覆盖不同 direction（N=2 时两个 job 必不同方向）；
 * 3. 卡内硬去重（findSimilarTopic 0.56 对 cardUsedTopicTexts）：命中即落选；
 * 3b. 候选间相似度互查（§8.1-9）：与已选中候选 findSimilarTopic 同阈值命中 → 该候选落选
 *     （死因「与其他候选内容重复」），保证同卡选出的 N 个候选内容互不雷同；
 * 4. 跨卡按“痛点×解决机制”硬去重：改写措辞但因果组合相同也落选；
 * 5. 未选中候选连同原因返回（供 plan_meta.unselected_candidates）。
 */

export const CARD_TOPIC_DEDUP_THRESHOLD = 0.56;
export interface BatchTopicSelectionInput {
  candidates: ConsensusTopicOption[];
  /** 每卡挑选数量，clamp 1-3。 */
  topicsPerCard: number;
  /** 本卡（同卡其他 job）已使用的选题文本：硬去重。 */
  cardUsedTopicTexts: string[];
  /** 整批（前面卡）已使用的选题文本：按因果组合硬去重。 */
  batchUsedTopicTexts: string[];
  /**
   * 整批（前面卡）已使用的选题方向：桶按该方向已用次数升序，实现跨卡方向轮转
   * （阶段F修复4：batch_1787325885084 三卡全选大痛点型）。
   * 只有商品1普通模式的共识分支传入；缺省或为空时稳定排序保持插入顺序，
   * 商品2/3 与 showcase 的调用行为零变化。
   */
  batchUsedDirections?: string[];
  /** Persisted cross-day topics. This is a post-generation sidecar check and never changes TopicOption. */
  historicalTopicTexts?: string[];
  historyDedupMode?: TopicHistoryDedupMode;
}

export interface UnselectedCandidate {
  topic: ConsensusTopicOption;
  reason: string;
}

export interface BatchTopicSelectionResult {
  selected: ConsensusTopicOption[];
  unselected: UnselectedCandidate[];
  warnings: string[];
  historyCollisions: Array<{ topic: ConsensusTopicOption; match: HistoricalTopicMatch }>;
  crossCardCollisions: Array<{ topic: ConsensusTopicOption; match: HistoricalTopicMatch }>;
}

/**
 * 不能只拿“选题名称”做批内查重：模型常把同一个诊断/止损主题换一个钩子，
 * 标题看似不同，pain、promise 和展开内容却完全一样。批内已保存的是完整
 * 工作单文本，因此待选题也必须按相同粒度比较。
 */
export function topicDedupText(topic: ConsensusTopicOption) {
  return [
    topic.topic,
    topic.painOrDesire,
    topic.promise,
    topic.contentAngle,
    ...(topic.expandContents || []),
  ].filter(Boolean).join(' ');
}

export function selectTopicsForCard(input: BatchTopicSelectionInput): BatchTopicSelectionResult {
  const desired = Math.max(1, Math.min(3, Math.floor(input.topicsPerCard)));
  const warnings: string[] = [];
  const unselected: UnselectedCandidate[] = [];
  const selected: ConsensusTopicOption[] = [];
  const historyCollisions: Array<{ topic: ConsensusTopicOption; match: HistoricalTopicMatch }> = [];
  const crossCardCollisions: Array<{ topic: ConsensusTopicOption; match: HistoricalTopicMatch }> = [];
  if (input.candidates.length === 0) {
    return { selected, unselected, warnings: ['候选池为空，无法挑选'], historyCollisions, crossCardCollisions };
  }
  if (desired > input.candidates.length) {
    warnings.push(`请求挑选${desired}个但候选池只有${input.candidates.length}个，按候选池数量降级`);
  }

  // 卡内硬去重：与已用选题相似度达阈值直接落选（死因：与历史重复）。
  const historyMode = input.historyDedupMode || 'off';
  const hardFiltered = input.candidates.filter(candidate => {
    if (historyMode !== 'off') {
      const match = findHistoricalTopicMatch(candidate.topic, input.historicalTopicTexts || []);
      if (match) {
        historyCollisions.push({ topic: candidate, match });
        if (historyMode === 'enforce') {
          unselected.push({ topic: candidate, reason: `与跨天历史重复：与“${match.similar}”属于同一痛点和解决机制（${match.score.toFixed(2)}）` });
          return false;
        }
        warnings.push(`跨天查重影子命中：候选“${candidate.topic}”与“${match.similar}”相似（${match.score.toFixed(2)}），当前仍放行`);
      }
    }
    const candidateText = topicDedupText(candidate);
    const hit = findSimilarTopic(candidateText, input.cardUsedTopicTexts, CARD_TOPIC_DEDUP_THRESHOLD);
    if (hit) {
      unselected.push({ topic: candidate, reason: `与历史重复：与“${hit.similar}”相似度${hit.score.toFixed(2)}` });
      return false;
    }
    return true;
  });

  // 按方向分桶（无方向的候选单放一桶），保证优先覆盖不同 direction。
  const buckets = new Map<string, ConsensusTopicOption[]>();
  for (const candidate of hardFiltered) {
    const key = candidate.direction || '(未分类)';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(candidate);
  }

  const attempted = new Set<ConsensusTopicOption>();
  const pick = (candidate: ConsensusTopicOption): boolean => {
    if (attempted.has(candidate)) return false;
    attempted.add(candidate);
    // §8.1-9 候选间相似度互查：待选候选与已选中列表内部 findSimilarTopic（同阈值 0.56），
    // 命中则该候选落选（死因：与其他候选内容重复），防止方向不同但文本雷同的候选同时选中。
    const candidateText = topicDedupText(candidate);
    const similarHit = findSimilarTopic(candidateText, selected.map(topicDedupText), CARD_TOPIC_DEDUP_THRESHOLD);
    if (similarHit) {
      unselected.push({ topic: candidate, reason: `与其他候选内容重复：与已选“${similarHit.similar}”相似度${similarHit.score.toFixed(2)}` });
      return false;
    }
    const crossMatch = findHistoricalTopicMatch(candidateText, input.batchUsedTopicTexts);
    if (crossMatch) {
      crossCardCollisions.push({ topic: candidate, match: crossMatch });
      unselected.push({ topic: candidate, reason: `与本批前序选题重复：与“${crossMatch.similar}”属于同一痛点和解决机制（${crossMatch.score.toFixed(2)}）` });
      return false;
    }
    selected.push(candidate);
    return true;
  };

  // 第一轮：每个方向桶取一个，凑满 N 或桶用尽（保证 N 个尽量来自不同方向）。
  // 修复4：桶访问顺序按「该方向整批已用次数」升序——前面卡用过的方向排后面，
  // 后面的卡优先覆盖没出现过的方向。
  const directionUsage = (direction: string) =>
    (input.batchUsedDirections || []).filter(used => used === direction).length;
  const orderedGroups = [...buckets.values()]
    .sort((a, b) => directionUsage(a[0]!.direction || '(未分类)') - directionUsage(b[0]!.direction || '(未分类)'));
  for (const group of orderedGroups) {
    if (selected.length >= desired) break;
    pick(group[0]!);
  }
  // 第二轮：还有名额就从剩余候选补。
  for (const candidate of hardFiltered) {
    if (selected.length >= desired) break;
    if (!selected.includes(candidate)) pick(candidate);
  }

  for (const candidate of hardFiltered) {
    // pick() 里已带具体死因（如「与其他候选内容重复」）的候选不再重复登记。
    if (!selected.includes(candidate) && !unselected.some(item => item.topic === candidate)) {
      unselected.push({ topic: candidate, reason: selected.length >= desired ? '名额已满，落选' : '与其他候选方向或内容重复，落选' });
    }
  }
  if (selected.length < desired) {
    warnings.push(`本卡只选出${selected.length}个选题，少于请求的${desired}个（卡内去重淘汰了部分候选），已按可用数量继续`);
  }
  return { selected, unselected, warnings, historyCollisions, crossCardCollisions };
}
