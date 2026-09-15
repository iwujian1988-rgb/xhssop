import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]!.replace(/^['"]|['"]$/g, '');
}
import { standardCreativeCards } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { allocateLockedCoordinates } from '../src/lib/v2/batch-topic-map';
import { coordinateHash, type TopicCoordinate } from '../src/lib/v2/topic-coordinate-taxonomy';
import { BATCH_TOPIC_EXPRESSIONS, planBatchEditorialTasks } from '../src/lib/v2/batch-editorial-plan';
import { demandTypeForBatchIndex, granularityForBatchIndex, valueTypeForBatchIndex } from '../src/lib/v2/topic-value';

const count = Math.max(20, Math.min(20, Number(process.argv[2] || 20)));
const cards = standardCreativeCards.slice(0, count);
if (cards.length < count) throw new Error(`可用标准封面只有${cards.length}张`);
const coordinates = allocateLockedCoordinates(count, []).map((base, index) => ({
  ...base,
  problemNote: `测试问题${index + 1}`,
  outcomeNote: `测试结果${index + 1}`,
  coordinateHash: coordinateHash(base),
} satisfies TopicCoordinate));
const result = await planBatchEditorialTasks({
  productId: 'delf_b2_writing',
  entries: cards.map((card, index) => ({
    coordinate: coordinates[index]!, cardId: card.id, cardName: card.name,
    capability: getCapabilityFallback(card), topicIndex: 0,
    topicExpression: BATCH_TOPIC_EXPRESSIONS[index % BATCH_TOPIC_EXPRESSIONS.length]!,
    valueType: valueTypeForBatchIndex(index),
    demandType: demandTypeForBatchIndex(index),
    topicGranularity: granularityForBatchIndex(index),
  })),
});

const countBy = <T extends string>(items: T[]) => Object.fromEntries([...new Set(items)].map(key => [key, items.filter(item => item === key).length]));
const abstract = /提升能力|深化理解|优化逻辑|建立体系|稳定节奏|改善思维|提升水平|强化训练|聚焦核心|诊断误区|重构思维|稳定考感|多维视角|循环检测|优先级策略/;
const rows = result.tasks.map(task => ({
  topic: task.topic, demand_type: task.demandType, value_type: task.valueType, topic_granularity: task.topicGranularity,
  specific_asset: task.specificAsset, scene: task.userScene, pain: task.coreProblem, subpoint_risk: task.subpointRisk, delf_specificity: task.delfSpecificity,
  existing_belief: task.existingBelief, counter_belief: task.counterBelief,
  cross_exam_generic_risk: task.crossExamGenericRisk,
}));
console.log(JSON.stringify({
  count: rows.length, rows,
  value_type: countBy(result.tasks.map(item => item.valueType)),
  scene: countBy(result.tasks.map(item => item.userScene)),
  specificity: countBy(result.tasks.map(item => item.delfSpecificity)),
  granularity: countBy(result.tasks.map(item => item.topicGranularity)),
  demand_type: countBy(result.tasks.map(item => item.demandType)),
  cross_exam_risk: countBy(result.tasks.map(item => item.crossExamGenericRisk)),
  abstract_asset_count: result.tasks.filter(item => abstract.test(`${item.topic} ${item.specificAsset} ${item.userGain}`)).length,
  warnings: result.warnings,
  usage: result.usage,
}, null, 2));
