import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { repairExpandContentBlocks } from '../src/lib/v2/batch-editorial-plan';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]!.replace(/^['"]|['"]$/g, '');
}

const batch = JSON.parse(readFileSync('.tmp-mother-topic-real-result.json', 'utf8')) as any;
const trace = (batch.repairTraces || []).find((item: any) => item.jobId === 'batch_resource_04_chalkboard_phrase_list_2' && item.blockIndex === 0);
if (!trace) throw new Error('找不到真实 Generation Failure trace');
const raw = trace.initial.rawModelResponse;
const task = { ...raw, expandContentPlans: [trace.initial.normalizedBlock] };
const expected = [{ taskId: raw.taskId, cardId: raw.cardId, topicIndex: raw.topicIndex, lockedCoordinate: { domainId: 'argument_development', problemId: 'depth', objectId: 'b2_writing', mechanismId: 'content_payload', sceneId: 'exam', scale: 'macro', contentType: 'asset', coordinateHash: 'generation-failure-repair' }, valueType: 'mistake', motherTopic: { topic: raw.topic, proposedSubtopics: [], valueType: 'mistake' } }];

const result = await repairExpandContentBlocks([task], expected as any);
await writeFile('.tmp-generation-failure-repair-real-result.json', JSON.stringify(result, null, 2), 'utf8');
console.log(JSON.stringify({ traceCount: result.traces.length, status: result.traces[0]?.finalStatus, attempts: result.traces[0]?.repairAttempts.length, diagnostics: result.diagnostics }, null, 2));
