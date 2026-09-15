import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]!.replace(/^['"]|['"]$/g, '');
}
import { generateMotherTopics } from '../src/lib/v2/mother-topic-stage';
import { demandTypeForBatchIndex } from '../src/lib/v2/topic-value';
import type { TopicCoordinate } from '../src/lib/v2/topic-coordinate-taxonomy';

const domains: TopicCoordinate['domainId'][] = [
  'task_decoding', 'idea_generation', 'argument_development', 'evidence_examples', 'structure_cohesion',
  'register_genre', 'grammar_accuracy', 'lexical_precision', 'revision_feedback', 'exam_execution',
  'study_strategy', 'material_transfer', 'confidence_rebuild',
];

const inputs = Array.from({ length: 20 }, (_, index) => ({
  taskId: `mother_${String(index + 1).padStart(2, '0')}`,
  domainId: domains[index % domains.length]!,
  demandType: demandTypeForBatchIndex(index),
}));

const result = await generateMotherTopics('delf_b2_writing', inputs, { acceptBelowThreshold: true });
const report = {
  total: result.topics.length,
  topics: result.topics.map(item => ({
    ...item,
    demandType: inputs.find(input => input.taskId === item.taskId)?.demandType,
    valueType: item.valueType,
  })),
  topicScope: {
    mother: result.topics.filter(item => item.topicScope === 'mother').length,
    subtopic: result.topics.filter(item => item.topicScope === 'subtopic').length,
    micro: result.topics.filter(item => item.topicScope === 'micro').length,
  },
  xhsEditorialFit: {
    strong: result.topics.filter(item => item.xhsEditorialFit === 'strong').length,
    acceptable: result.topics.filter(item => item.xhsEditorialFit === 'acceptable').length,
    course_like: result.topics.filter(item => item.xhsEditorialFit === 'course_like').length,
    weak: result.topics.filter(item => item.xhsEditorialFit === 'weak').length,
  },
  courseLanguageRisk: {
    low: result.topics.filter(item => item.courseLanguageRisk === 'low').length,
    medium: result.topics.filter(item => item.courseLanguageRisk === 'medium').length,
    high: result.topics.filter(item => item.courseLanguageRisk === 'high').length,
  },
  demandValueMismatch: result.topics.filter(item => item.demandValueMismatch).length,
  warnings: result.warnings,
  usage: result.usage,
};
await writeFile('.tmp-mother-only-real-result.json', JSON.stringify(report, null, 2), 'utf8');
process.stdout.write(`MOTHER_ONLY_RESULT_WRITTEN ${report.total}\n`);
