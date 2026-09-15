import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { repairExpandContentBlocks } from '../src/lib/v2/batch-editorial-plan';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]!.replace(/^['"]|['"]$/g, '');
}

const coordinate = { domainId: 'argument_development', problemId: 'depth', objectId: 'b2_writing', mechanismId: 'content_payload', sceneId: 'exam', scale: 'macro', contentType: 'asset', coordinateHash: 'repair-sample' } as any;
const mother = (topic: string) => ({ taskId: '', topic, motherTopicRationale: '', proposedSubtopics: ['模块一', '模块二', '模块三'], motherTopicScore: 85, valueType: 'collection', topicScope: 'mother', xhsMotherTopicFit: 'strong', xhsEditorialFit: 'strong', courseLanguageRisk: 'low', demandValueMismatch: false, existingBelief: '', counterBelief: '', subpointRisk: 'low' }) as any;

const plan = (overrides: Record<string, unknown>) => ({
  title: '内容块', contentGoal: '交付可直接做成内容页的资料', assetType: 'list',
  concreteDeliverable: '深化观点', mustContain: ['具体内容对象', '展示结构'],
  exampleRequirement: '至少一组法语例句', languageMaterialRequirement: '提供法语表达', cardStructure: '表格分栏', genericAdviceRisk: 'high', ...overrides,
});

const cases = [
  ['generic-1', 'collection', plan({ concreteDeliverable: '建立视角', mustContain: ['多角度分析', '灵活迁移'] })],
  ['generic-2', 'collection', plan({ concreteDeliverable: '加强训练', mustContain: ['第一项', '第二项'] })],
  ['comparison-1', 'comparison', plan({ concreteDeliverable: '整理表达方式', mustContain: ['自然表达', '使用场景'] })],
  ['comparison-2', 'comparison', plan({ concreteDeliverable: '不同写法整理', mustContain: ['语言选择', '适用场景'] })],
  ['self-test-1', 'self_test', plan({ concreteDeliverable: '作文质量审阅', mustContain: ['题目要求', '段落结构'] })],
  ['self-test-2', 'self_test', plan({ concreteDeliverable: '文章内容审阅', mustContain: ['任务回应', '段落内容'] })],
] as const;

async function main() {
  const rawTasks = cases.map(([id, valueType, contentPlan]) => ({ taskId: id, specificAsset: 'DELF B2写作内容资料', expandContentPlans: [contentPlan] }));
  const expected = cases.map(([taskId, valueType]) => ({ taskId, cardId: taskId, topicIndex: 0, lockedCoordinate: coordinate, valueType, motherTopic: mother(`DELF B2写作真实干货：${taskId}`) }));
  const result = await repairExpandContentBlocks(rawTasks, expected as any);
  const report = { sampleSize: cases.length, cases: result.traces, diagnostics: result.diagnostics, unrecoverableTaskIds: result.unrecoverableTaskIds };
  await writeFile('.tmp-repair-sample-real-result.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ sampleSize: cases.length, passed: result.traces.filter(item => item.finalStatus === 'PASS').length, failed: result.traces.filter(item => item.finalStatus !== 'PASS').length, diagnostics: result.diagnostics }, null, 2));
}

main().catch(async error => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await writeFile('.tmp-repair-sample-real-error.json', message, 'utf8').catch(() => undefined);
  console.error(message);
  process.exitCode = 1;
});
