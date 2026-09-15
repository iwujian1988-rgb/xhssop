/* eslint-disable no-console */
import { diagnoseTopicOption, selectTopicPortfolio } from '../src/lib/v2/topic-stage';
import { findSimilarTopic, topicIntentFingerprint } from '../src/lib/title-usage-store';
import type { TemplateCapability, TopicLane, TopicOption } from '../src/lib/v2/contracts';

const capability = {
  renderer: 'parchment_dense_directory',
  family: 'directory',
  compiler: 'directory',
  renderMode: 'code',
  allowedGoals: ['search', 'save', 'click', 'conversion'],
  acceptedBlockKinds: ['group', 'step', 'benefit'],
  allowedTitleMechanisms: ['资料型', '痛点型'],
  densityTiers: [],
  languagePolicy: 'mixed',
} as TemplateCapability;

function topic(id: string, lane: TopicLane, text: string, pain: string, promise: string, goal: TopicOption['primaryGoal'] = 'click'): TopicOption {
  return {
    id,
    productId: 'delf_b2_writing',
    templateId: capability.renderer,
    primaryGoal: goal,
    topicLane: lane,
    topic: text,
    audienceState: '正在准备DELF B2写作的考生',
    scene: '考前练习写作时',
    painOrDesire: pain,
    promise,
    contentAngle: '按封面分组展示',
    productBridge: '用写作知识库里的检查清单和句型库继续练习',
    seo: { primary: 'DELF B2写作', related: ['法语B2写作'] },
    knowledgeMode: 'mixed',
    factTerms: ['写作检查清单'],
    seedSignals: ['清单'],
    noveltyFingerprint: id,
  };
}

const candidates = [
  topic('pain', 'broad_pain', 'DELF B2作文写完却不知道怎么改', '作文写完只能从头读一遍', '给出考前能自己执行的检查顺序', 'search'),
  topic('result', 'result_need', '考前如何快速检查一篇B2作文', '检查没有顺序，时间总不够用', '整理一套从格式到论证的检查路径', 'save'),
  topic('narrow', 'narrow_knowledge', '正式信里tu和vous怎么保持一致', '称呼和人称容易前后混用', '用短例句讲清人称一致', 'click'),
  topic('product', 'product_value', '一套B2写作知识库能帮你查什么', '练习时反复翻不同文件找答案', '展示检查清单、句型库和范文的使用顺序', 'conversion'),
  topic('duplicate', 'result_need', '考前怎么快速检查DELF B2作文', '检查没有顺序，考试时间不够', '给出从格式到论证的检查顺序', 'save'),
  topic('machine', 'broad_pain', 'DELF B2写作资料太散总卡住', '资料太散导致写作卡住', '解决卡在这一步的问题', 'search'),
];

const selected = selectTopicPortfolio(candidates, { productId: 'delf_b2_writing', capability });
const machineFailures = diagnoseTopicOption(candidates.at(-1)!, { productId: 'delf_b2_writing', capability });
const experienceCapability = { ...capability, renderer: 'plain_experience', family: 'experience', compiler: 'narrative', acceptedBlockKinds: ['paragraph', 'quote', 'step'] } as TemplateCapability;
const lessonTopic = {
  ...topic('lesson', 'narrow_knowledge', 'DELF B2写作里bien que怎么用', '写作时总拿不准语式', '讲清规则并附错误对照', 'search'),
  contentAngle: '先讲规则，再列对比例子，最后给一个自查口诀',
};
const lessonFailures = diagnoseTopicOption(lessonTopic, { productId: 'delf_b2_writing', capability: experienceCapability });
const phraseCapability = { ...capability, renderer: 'blackboard_phrase', family: 'phrase', compiler: 'pairs', acceptedBlockKinds: ['pair', 'group'] } as TemplateCapability;
const timePlanOnPhraseCover = {
  ...topic('phrase_time', 'result_need', 'DELF B2写作1小时时间分配', '考场总是写不完', '给出四步时间规划'),
  contentAngle: '按审题、草稿、正文、检查分配时间',
  plannedBlockKind: 'pair' as const,
};
const phraseAssetTopic = {
  ...topic('phrase_asset', 'narrow_knowledge', 'DELF B2正式信关系词对照', '表达关系时只会重复用同一个词', '按让步、原因、结果分组给出可替换表达'),
  contentAngle: '把正式信短语和连接词按功能做成对照表',
  plannedBlockKind: 'pair' as const,
};
const mismatchedStepTopic = {
  ...topic('step_mismatch', 'result_need', 'DELF B2写作3步自查', '写完不知道怎么查', '3步完成考前自查'),
  expandContents: ['核对任务', '检查结构', '检查语法', '最后读一遍'],
};
const familyCases = [
  ['directory', '完整故事和第一人称复盘', 'paragraph', true],
  ['pain', '整理成词汇表和固定搭配表', 'group', true],
  ['offer', '只讲语法规则解析和例句精讲', 'step', true],
  ['document', '按四个阶段规划学习路径', 'step', true],
  ['roadmap', '只做一条语法规则的逐句解析', 'example', true],
  ['directory', '按主题分组整理成可扫读清单', 'group', false],
  ['offer', '展示资料包含什么以及适合谁使用', 'benefit', false],
  ['document', '保留原句并做中文解析和迁移改写', 'example', false],
  ['roadmap', '按四个阶段安排练习路径', 'step', false],
] as const;
const familyShapeAssertions = familyCases.map(([family, angle, blockKind, expectedMismatch]) => {
  const familyCapability = {
    ...capability,
    family,
    acceptedBlockKinds: family === 'document' ? ['example', 'pair', 'group']
      : family === 'roadmap' || family === 'offer' ? ['benefit', 'group', 'step']
        : family === 'pain' ? ['paragraph', 'quote', 'step']
          : ['group', 'step', 'benefit'],
  } as TemplateCapability;
  const candidate = {
    ...topic(`family_${family}_${angle}`, 'result_need', '测试选题', '测试痛点', '测试承诺'),
    contentAngle: angle,
    plannedBlockKind: blockKind,
  };
  const mismatch = diagnoseTopicOption(candidate, { productId: 'delf_b2_writing', capability: familyCapability })
    .includes('cover_content_shape_mismatch');
  return mismatch === expectedMismatch;
});
const lanes = new Set(selected.map(item => item.topicLane));
const assertions = {
  selectsFour: selected.length === 4,
  coversFourLanes: ['broad_pain', 'result_need', 'narrow_knowledge', 'product_value'].every(lane => lanes.has(lane as TopicLane)),
  dropsNearDuplicate: !selected.some(item => item.id === 'duplicate'),
  rejectsMachineLanguage: machineFailures.includes('machine_expression'),
  rejectsLessonPlanForExperienceCover: lessonFailures.includes('cover_content_shape_mismatch'),
  rejectsTimePlanOnPhraseCover: diagnoseTopicOption(timePlanOnPhraseCover, { productId: 'delf_b2_writing', capability: phraseCapability }).includes('cover_content_shape_mismatch'),
  acceptsActualPhraseAsset: !diagnoseTopicOption(phraseAssetTopic, { productId: 'delf_b2_writing', capability: phraseCapability }).includes('cover_content_shape_mismatch'),
  rejectsPromisedStepCountMismatch: diagnoseTopicOption(mismatchedStepTopic, { productId: 'delf_b2_writing', capability }).includes('cover_content_shape_mismatch'),
  coversAllClearFamilyMismatches: familyShapeAssertions.every(Boolean),
  detectsRewordedExamChoice: Boolean(findSimilarTopic(
    'TEF和TCF Canada到底选哪个？先看区别再报名',
    ['TEF还是TCF？选错方向等于白备考'],
    0.56,
  )),
  keepsDifferentWritingAngles: !findSimilarTopic(
    'DELF B2正式信的称呼和结尾怎么写',
    ['DELF B2写作字数总是不够怎么办'],
    0.56,
  ),
};

if (Object.values(assertions).some(value => !value)) {
  console.error(JSON.stringify({
    ok: false,
    assertions,
    selected: selected.map(item => item.id),
    machineFailures,
    intentDebug: [
      Array.from(topicIntentFingerprint('TEF和TCF Canada到底选哪个？先看区别再报名')),
      Array.from(topicIntentFingerprint('TEF还是TCF？选错方向等于白备考')),
    ],
  }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, assertions, selected: selected.map(item => ({ id: item.id, lane: item.topicLane })) }, null, 2));
}
