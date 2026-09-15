import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterTextTitleCandidates, type TitleStageInput } from '../src/lib/v2/title-stage';

const ids = {
  job_006: '381ca494-9b41-935e-8abf-3ba4325cdcc7',
  job_007: 'fbcacea0-f20a-9623-9f7a-cfac9d9f4083',
  job_009: '0d97b2b6-7455-917a-ae08-c5bc5f3b592f',
  job_010: 'ecd6bb5d-fb32-9f1a-a1ba-ecc884321096',
};
for (const [jobId, traceId] of Object.entries(ids)) {
  const job = JSON.parse(readFileSync(`data/batches/batch_1789005556011/jobs/${jobId}.json`, 'utf8'));
  const trace = JSON.parse(readFileSync(`data/final-content-traces/${traceId}/30_TEXT_TITLE_CANDIDATES.json`, 'utf8'));
  const input = { topic: job.artifacts.selectedTopic.data, content: job.artifacts.content.data } as TitleStageInput;
  const result = filterTextTitleCandidates(trace.evaluated.map((e: any) => e.candidate), input);
  assert.ok(result.humanSelectableTextTitles.length >= 4);
  for (let i = 0; i < trace.evaluated.length; i++) {
    assert.deepEqual(result.evaluated[i].filterReasons, trace.evaluated[i].filterReasons.filter((r: string) => r !== 'TEXT_TITLE_OVER_20'));
    if (trace.evaluated[i].filterReasons.includes('TEXT_TITLE_OVER_20')) assert.ok(result.evaluated[i].warnings.includes('TEXT_TITLE_OVER_20'));
  }
  console.log(`${jobId}: ${trace.survivalCount} -> ${result.survivalCount}; other rejects unchanged`);
}
console.log('PASS. AI calls = 0. Production jobs unchanged.');
