/* eslint-disable no-console */
import { selectTopicsForCard } from '../src/lib/v2/batch-topic-selection';
import type { ConsensusTopicOption } from '../src/lib/v2/consensus-topic-stage';
import { findHistoricalTopicMatch, selectRecentTopicRepresentatives } from '../src/lib/v2/topic-history-dedup';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) console.log(`ok: ${message}`);
  else { failures += 1; console.error(`FAIL: ${message}`); }
}

function candidate(id: string, direction: ConsensusTopicOption['direction'], topic: string): ConsensusTopicOption {
  return {
    id, productId: 'delf_b2_writing', templateId: 'parchment_dense_directory',
    primaryGoal: 'click', topicLane: 'narrow_knowledge', topic,
    audienceState: '测试用户', scene: '测试场景', painOrDesire: '测试痛点', promise: '测试结果',
    contentAngle: topic, plannedBlockKind: 'group', productBridge: '',
    seo: { primary: 'DELF B2写作', related: [] }, knowledgeMode: 'educational_original',
    factTerms: [], seedSignals: [], noveltyFingerprint: id, direction, expandContents: [topic],
  };
}

const yesterday = '写不够250词？用原因、例子和因果链展开观点';
const duplicate = '论证卡壳写不满250词，用因果链和例子扩写';
const differentMechanism = '写不够250词？补一组主题高级词和固定搭配';

assert(Boolean(findHistoricalTopicMatch(duplicate, [yesterday])), '同一痛点+同一解决机制命中');
assert(!findHistoricalTopicMatch(differentMechanism, [yesterday]), '同痛点但不同机制不误杀');

const plateauYesterday = 'B2写作无效练习：为什么你写了10篇还是卡在3分档？评分维度自我诊断';
const plateauDuplicate = '无效刷题陷阱：为什么写了10篇还是卡在3分档？用评分维度做精准诊断';
const stopLossYesterday = '考前7天止损指南：停掉这3种低效动作，把时间留给提分项';
const stopLossDuplicate = '考前止损：停掉这3个低效动作，把时间留给真正该练的部分';
assert(Boolean(findHistoricalTopicMatch(plateauDuplicate, [plateauYesterday])), '大痛点“写了10篇仍卡分”换皮也命中');
assert(Boolean(findHistoricalTopicMatch(stopLossDuplicate, [stopLossYesterday])), '冲刺止损攻略换皮也命中');

const pool = [
  candidate('duplicate', '大痛点型', duplicate),
  candidate('fresh-path', '省时路径型', '考前按题型安排一小时写作流程'),
  candidate('fresh-method', '具体方法型', '正式信称呼与结尾如何对应收件人'),
];
const enforce = selectTopicsForCard({
  candidates: pool, topicsPerCard: 2, cardUsedTopicTexts: [], batchUsedTopicTexts: [],
  historicalTopicTexts: [yesterday], historyDedupMode: 'enforce',
});
assert(!enforce.selected.some(item => item.id === 'duplicate'), 'enforce 淘汰跨天重复');
assert(enforce.selected.length === 2, '有新候选时任务名额不减少');
assert(enforce.historyCollisions.length === 1, '碰撞带独立审计记录');

const shadow = selectTopicsForCard({
  candidates: pool, topicsPerCard: 1, cardUsedTopicTexts: [], batchUsedTopicTexts: [],
  historicalTopicTexts: [yesterday], historyDedupMode: 'shadow',
});
assert(shadow.selected[0]?.id === 'duplicate', 'shadow 保持旧选择行为');
assert(shadow.warnings.some(item => item.includes('跨天查重影子命中')), 'shadow 只写提醒');
assert(selectRecentTopicRepresentatives(Array.from({ length: 100 }, (_, index) => `${yesterday}${index}`), 10).length <= 10, '历史提示固定最多10条');

// 批内不能只比较工作标题。下面两条标题不同，但工作单里的痛点/承诺都是
// “写完不知道对不对 → 评分维度诊断”，必须被视为同一题。
const firstDiagnostic = {
  ...candidate('diagnostic-a', '大痛点型', '写完就交 vs 系统自查'),
  painOrDesire: '写完后心里没底，不知道考官看什么，练了很多篇仍没有进步',
  promise: '用评分维度和检查清单做自我诊断，定位短板',
  contentAngle: '从盲目刷题转到评分维度诊断',
  expandContents: ['评分维度', '检查清单', '定位短板'],
};
const renamedDiagnostic = {
  ...candidate('diagnostic-b', '大痛点型', '写完却不敢交：无效努力的破局点'),
  painOrDesire: '写完不知道对不对，刷题很多却找不到短板',
  promise: '用自我诊断流程定位评分维度问题',
  contentAngle: '评分维度诊断替代盲目刷题',
  expandContents: ['自我诊断', '评分维度', '检查动作'],
};
const fullBriefDedup = selectTopicsForCard({
  candidates: [renamedDiagnostic], topicsPerCard: 1, cardUsedTopicTexts: [],
  batchUsedTopicTexts: [
    `${firstDiagnostic.topic} ${firstDiagnostic.painOrDesire} ${firstDiagnostic.promise} ${firstDiagnostic.contentAngle} ${firstDiagnostic.expandContents.join(' ')}`,
  ],
});
assert(fullBriefDedup.selected.length === 0, '标题不同但工作单相同的诊断题被批内去重');
assert(fullBriefDedup.crossCardCollisions.length === 1, '完整工作单重复带跨卡碰撞记录');

console.log(failures ? `${failures} FAILURES` : 'ALL PASS');
process.exit(failures ? 1 : 0);
