import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { teachingPages } from '../src/lib/manual-inner-review';
import { stableHash } from '../src/lib/v2/contracts';
const directory = process.argv[2];
const sampleBatch = process.argv[3];
const read = async (p: string) => JSON.parse(await fs.readFile(p, 'utf8'));
const fixture = await read(path.join(directory, 'fixture.json'));
const results = [];
for (const [index, source] of fixture.provenance.entries()) {
  const job = await read(path.join(directory, 'data/batches', fixture.id, 'jobs', `${source.jobId}.json`));
  const original = await read(source.source);
  const expected = teachingPages(original.artifacts.content.data.innerPages);
  if (index === 1) {
    expected[0].page_title += '【浏览器测试修改一】';
    expected[0].lead += '【浏览器测试修改二，仅隔离测试】';
  }
  assert.deepEqual(job.draft.inner_pages, expected);
  assert.deepEqual(job.artifacts.content.data.innerPages, index === 2 ? original.artifacts.content.data.innerPages : expected);
  assert.deepEqual(job.usage, original.usage);
  assert.equal(job.draft.manualInnerReview.status, index === 2 ? 'dropped' : 'locked');
  if (index !== 2) assert.equal(job.draft.manualInnerReview.innerHash, stableHash(expected));
  if (index === 2) assert.equal(job.status, 'dropped');
  const userJob = await read(path.join('data/batches', sampleBatch, 'jobs', `${source.jobId}.json`));
  assert.equal(userJob.status, 'awaiting_review');
  assert.equal(userJob.draft.manualInnerReview.status, 'needs_review');
  assert.deepEqual(userJob.draft.inner_pages, teachingPages(original.artifacts.content.data.innerPages));
  results.push({ jobId: source.jobId, browserPersistedStatus: job.draft.manualInnerReview.status, sourceAndUsagePreserved: true, userSampleUnreviewed: true });
}
const intercepted = await read(path.join(directory, 'intercepted-continuations.json'));
assert.ok(intercepted.length >= 2);
assert.ok(intercepted.every((event: { locked: boolean; canonicalEqualsDraft: boolean; aiCalls: number }) => event.locked && event.canonicalEqualsDraft && event.aiCalls === 0));
await fs.writeFile(path.join(directory, 'persistence-verification.json'), JSON.stringify({ results, intercepted, aiCalls: 0 }, null, 2));
console.log('BROWSER_A_B_C_PERSISTENCE=PASS; USER_SAMPLES_UNREVIEWED=PASS; HISTORICAL_USAGE_UNCHANGED=PASS; AI_CALLS_USED=0');
