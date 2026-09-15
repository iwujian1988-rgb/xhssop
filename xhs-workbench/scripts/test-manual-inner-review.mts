import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { saveInnerWorkingCopy, lockInnerWorkingCopy, teachingPages, assertReviewedInner, dropInnerJob, prepareJobForHumanReview } from '../src/lib/manual-inner-review';
import { stableHash } from '../src/lib/v2/contracts';
import type { BatchJob, Batch } from '../src/lib/batch-store';

const root = process.cwd();
const sourcePath = path.join(root, 'data/batches/batch_1788674634433/jobs/job_002.json');
const sourceBytes = await fs.readFile(sourcePath, 'utf8');
const original = JSON.parse(sourceBytes) as BatchJob;
let calls = 0;
globalThis.fetch = (async () => { calls++; throw new Error('NETWORK_FORBIDDEN_IN_REVIEW_TEST'); }) as typeof fetch;
// Real persistence, isolated cwd; never modify the source job or its evidence.
const sandbox = await fs.mkdtemp(path.join(root, '.tmp-review-lock-test-'));
process.chdir(sandbox);
const { createPlannedBatchAtomic, saveJob, loadJob } = await import('../src/lib/batch-store');
const { prepareContentForTitles, compileDraft } = await import('../src/lib/v2/pipeline');
const { repairContentPackage } = await import('../src/lib/v2/content-stage');
const { getCompetitorCreativeCard } = await import('../src/lib/creative-card-library');
const { getCapabilityFallback } = await import('../src/lib/v2/topic-stage');
const { repaginateDraftForOverflow } = await import('../src/lib/render-repagination');
const id = 'review_lock_acceptance';
const batch = { id, product_id: original.product_id, direction: 'isolated offline review test', created_at: new Date().toISOString(), status: 'planned', jobs: [] } as Batch;
await createPlannedBatchAtomic(batch, [original]);
const pages = teachingPages(original.draft!.inner_pages);
pages[0].lead += ' 请结合收件人关系选择表达。';
pages[0].bullets[0] += ' 此处为可替换的开场模板。';
let saved = saveInnerWorkingCopy(original, pages);
assert.equal(saved.artifacts!.content!.data.manualInnerReview?.status, 'needs_review');
assert.deepEqual(saved.artifacts!.content!.data.innerPages, original.artifacts!.content!.data.innerPages);
await saveJob(id, saved);
let locked = lockInnerWorkingCopy(await loadJob(id, original.id));
await saveJob(id, locked);
assert.deepEqual(locked.draft!.inner_pages, locked.artifacts!.content!.data.innerPages);
assert.equal(locked.artifacts!.content!.data.manualInnerReview!.innerHash, stableHash(locked.artifacts!.content!.data.innerPages));
console.log('TEST_1_SAVE_LOCK=PASS');

locked = await loadJob(id, original.id);
assert.deepEqual(locked.draft!.inner_pages, pages);
assertReviewedInner(locked.artifacts!.content!.data);
assert.deepEqual(locked.draft!.manualInnerReview, locked.artifacts!.content!.data.manualInnerReview);
console.log('TEST_2_PERSIST_RELOAD=PASS');
const c = locked.artifacts!.content!.data;
assert.equal(c.captionContentSnapshotHash, undefined);
assert.equal(c.selectedCoverTemplateId, undefined);
assert.equal(c.coverSourceInnerHash, undefined);
assert.equal(c.finalTeachingQa, undefined);
assert.equal(locked.artifacts!.titles, undefined);
assert.equal(locked.artifacts!.compiledDraft, undefined);
assert.equal(locked.cover_image_url, undefined);
assert.equal(locked.image_task_id, undefined);
assert.equal(locked.draft!.downstreamStale, true);
assert.notEqual(locked.commercial?.status, 'READY');
console.log('TEST_3_CAPTION_COVER_QA_TITLE_STALE=PASS');

const card = getCompetitorCreativeCard(original.reference_card_id)!;
const topic = original.artifacts!.selectedTopic!.data;
const contentInput = { topic, capability: getCapabilityFallback(card), evidence: [] };
const prepInput = { ...contentInput, productId: original.product_id, contentInput, selectedTopic: original.artifacts!.selectedTopic!, resumeContent: locked.artifacts!.content! };
let innerCalls = 0, repairCalls = 0, captionCalls = 0, coverCalls = 0, qaCalls = 0;
const stages: Parameters<typeof prepareContentForTitles>[1] = {
  generateContentPackage: async () => { innerCalls++; throw new Error('INNER_MUST_NOT_RUN'); },
  generateFinalCaptionAndBridge: async a => { captionCalls++; assert.deepEqual(a.data.innerPages, pages); return { ...a, data: { ...a.data, captionParts: original.artifacts!.content!.data.captionParts, captionContentSnapshotHash: stableHash(a.data.innerPages) } }; },
  generateFinalCoverBlocks: async a => { coverCalls++; assert.deepEqual(a.data.innerPages, pages); return { ...a, data: { ...a.data, selectedCoverTemplateId: original.reference_card_id, coverBlocks: original.artifacts!.content!.data.coverBlocks, coverSourceInnerHash: stableHash(a.data.innerPages) } }; },
  auditContentPackage: async a => { qaCalls++; return { ...a, data: { ...a.data, finalTeachingQa: { inputSnapshotHash: 'mock', sourceInnerHash: stableHash(a.data.innerPages), status: 'FAIL', approved: false, issues: ['mock spelling'], blockingIssues: ['mock spelling'], blockingPaths: ['innerPages.0.lead'], corrections: [{ path: 'innerPages.0.lead', text: 'MUST NOT APPLY' }], appliedPatches: [], rejectedPatches: [], unresolvedBlockingIssues: ['mock spelling'] } } }; },
  repairContentPackage: async a => { repairCalls++; return a; },
};
const defaultApproved = await prepareContentForTitles(prepInput, stages);
assert.equal(defaultApproved.data.finalTeachingQa?.status, 'PASS');
assert.equal(defaultApproved.data.finalTeachingQa?.approved, true);
assert.deepEqual(defaultApproved.data.finalTeachingQa?.unresolvedBlockingIssues, []);
assert.ok(defaultApproved.data.finalTeachingQa?.blockingIssues?.includes('mock spelling'));
assert.ok(defaultApproved.data.finalTeachingQa?.warnings?.some(item => item.includes('默认通过正文，QA提醒')));
assert.deepEqual(locked.artifacts!.content!.data.innerPages, pages);
await assert.rejects(repairContentPackage(locked.artifacts!.content!, contentInput, []), /LOCKED_INNER_REPAIR_FORBIDDEN/);
assert.equal(innerCalls, 0); assert.equal(repairCalls, 0);
assert.equal(captionCalls, 1); assert.equal(coverCalls, 1); assert.equal(qaCalls, 1);
console.log('TEST_4_QA_WARNING_DEFAULT_APPROVAL_NO_PATCH_NO_INNER=PASS');

const changed = structuredClone(pages);
changed[0].lead += ' 这是再次人工确认的版本。';
const reedited = saveInnerWorkingCopy(locked, changed);
assert.equal(reedited.artifacts!.content!.data.manualInnerReview!.status, 'needs_review');
await assert.rejects(prepareContentForTitles({ ...prepInput, resumeContent: reedited.artifacts!.content }, stages), /INNER_NEEDS_HUMAN_REVIEW/);
const relocked = lockInnerWorkingCopy(reedited);
assert.notEqual(relocked.artifacts!.content!.data.manualInnerReview!.innerHash, c.manualInnerReview!.innerHash);
assert.deepEqual(relocked.artifacts!.content!.data.innerPages, changed);
console.log('TEST_5_REEDIT_RELOCK=PASS');
for (const forbidden of ['reviewedInnerPages', 'finalHumanInner', 'approvedInnerPages', 'publishedInnerPages']) assert.equal(JSON.stringify(relocked).includes('"' + forbidden + '"'), false);
assert.deepEqual(Object.keys(relocked.artifacts!.content!.data.manualInnerReview!).sort(), ['innerHash', 'reviewedAt', 'status']);
console.log('TEST_6_SINGLE_CANONICAL_SOURCE=PASS');

const ready = await prepareContentForTitles(prepInput, { ...stages, auditContentPackage: async a => ({ ...a, data: { ...a.data, finalTeachingQa: { ...original.artifacts!.content!.data.finalTeachingQa!, status: 'PASS', sourceInnerHash: stableHash(a.data.innerPages) } } }) });
const titles = structuredClone(original.artifacts!.titles!.data);
titles.contentSnapshotHash = stableHash(ready.data);
const compiled = compileDraft({ productId: original.product_id, card, topic, capability: getCapabilityFallback(card), content: ready.data, titles, evidence: [], auditWarnings: [] });
assert.deepEqual(teachingPages(compiled.inner_pages), pages);
assert.equal(compiled.inner_pages.filter(p => p.page_type === 'product_bridge').length, 1);
assert.equal(compiled.downstreamStale, false);
const split = repaginateDraftForOverflow(compiled, compiled.inner_pages[0].page_no)!;
assert.deepEqual(split.inner_pages.slice(0, 2).flatMap(p => p.bullets), pages[0].bullets);
assert.equal(split.inner_pages[0].lead, pages[0].lead);
await assert.rejects(prepareContentForTitles({ ...prepInput, resumeContent: { ...ready, data: { ...ready.data, innerPages: changed } } }, stages), /INNER_NEEDS_HUMAN_REVIEW/);
assert.equal(await fs.readFile(sourcePath, 'utf8'), sourceBytes);
assert.equal(calls, 0);
console.log('COMPILER_PRESERVES_REVIEWED_INNER=PASS; NO_DOUBLE_PRODUCT_PAGE=PASS; PAGINATION=PASS; AI_CALLS_USED=0');
// The route's unused legacy compose import has an ESM-only dictionary. Stub that
// dependency in this CJS test harness only; fail if any spelling code invokes it.
const require = createRequire(import.meta.url);
const dictionaryPath = require.resolve('dictionary-fr');
require.cache[dictionaryPath] = { id: dictionaryPath, filename: dictionaryPath, loaded: true,
  exports: { get aff() { throw new Error('UNEXPECTED_LEGACY_SPELLCHECK'); }, get dic() { throw new Error('UNEXPECTED_LEGACY_SPELLCHECK'); } },
} as NodeModule;
const { POST, GET } = await import('../src/app/api/batch/route');
const post = (payload: object) => POST(new Request('http://localhost/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_draft_state', batch_id: id, job_id: original.id, ...payload }) }));
const baseHash = stableHash(teachingPages(locked.draft!.inner_pages));
const apiSave = await post({ inner_pages: changed, expected_inner_hash: baseHash });
assert.equal(apiSave.status, 200);
assert.equal((await apiSave.json()).job.artifacts.content.data.manualInnerReview.status, 'needs_review');
const staleSave = await post({ inner_pages: pages, expected_inner_hash: baseHash });
assert.equal(staleSave.status, 409);
const apiLock = await post({ confirm_inner_review: true, expected_inner_hash: stableHash(changed) });
assert.equal(apiLock.status, 200);
const response = await GET(new Request('http://localhost/api/batch?batch_id=' + id));
assert.equal(response.status, 200);
const apiJob = (await response.json()).jobs[0] as BatchJob;
assert.deepEqual(apiJob.draft!.inner_pages, apiJob.artifacts!.content!.data.innerPages);
assert.deepEqual(apiJob.draft!.inner_pages, changed);
const { buildDraftTxt } = await import('../src/lib/batch-export');
assert.throws(() => buildDraftTxt(apiJob.draft!), /REVIEWED_DOWNSTREAM_STALE/);
const uiSource = await fs.readFile(path.join(root, 'src/components/draft/DraftReview.tsx'), 'utf8');
for (const label of ['保存修改', '通过并锁定', '生成文字标题', '生成封面', '放弃这篇', 'expected_inner_hash']) assert.ok(uiSource.includes(label));
const runnerSource = await fs.readFile(path.join(root, 'src/lib/batch-runner.ts'), 'utf8');
assert.ok(runnerSource.includes('!selectedJobIds || selectedJobIds.has(summary.id)'));
assert.equal(calls, 0);
console.log('REAL_API_SAVE_CONFIRM_GET=PASS; STALE_TAB_REJECTED=PASS; STALE_EXPORT_BLOCKED=PASS; UI_WIRING_STATIC=PASS; AI_CALLS_USED=0');
const { POST: exportPost } = await import('../src/app/api/batch-export/route');
const { NextRequest } = await import('next/server');
const exportRequest = (body: object) => new NextRequest('http://localhost/api/batch-export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const exportInit = await exportPost(exportRequest({ action: 'init', batch_id: id }));
assert.equal(exportInit.status, 200);
const sessionId = (await exportInit.json()).session_id;
const another = structuredClone(changed); another[0].lead += ' 新修订。';
await saveJob(id, lockInnerWorkingCopy(saveInnerWorkingCopy(apiJob, another)));
const staleExport = await exportPost(exportRequest({ action: 'finalize', session_id: sessionId, ready_job_ids: [original.id] }));
assert.equal(staleExport.status, 409);
assert.match((await staleExport.json()).error, /正文审校版本已变化/);
assert.equal(calls, 0);
console.log('OLD_EXPORT_SESSION_REJECTED=PASS');
const fresh = structuredClone(original.artifacts!.content!);
delete fresh.data.manualInnerReview;
let generated = 0;
await assert.rejects(prepareContentForTitles({ ...prepInput, resumeContent: undefined, pauseForHumanReview: true }, {
  ...stages,
  generateContentPackage: async () => { generated++; return fresh; },
  generateFinalCaptionAndBridge: async () => { throw new Error('FORBIDDEN_CAPTION'); },
  generateFinalCoverBlocks: async () => { throw new Error('FORBIDDEN_COVER'); },
  auditContentPackage: async () => { throw new Error('FORBIDDEN_QA'); },
}), /INNER_AWAITING_HUMAN_REVIEW/);
assert.equal(generated, 1);
const pendingReview = prepareJobForHumanReview({ ...original, draft: undefined, artifacts: { selectedTopic: original.artifacts!.selectedTopic, content: fresh } });
assert.equal(pendingReview.status, 'awaiting_review');
const direct = lockInnerWorkingCopy(pendingReview);
assert.deepEqual(direct.artifacts!.content!.data.innerPages, pendingReview.draft!.inner_pages);
assert.equal(saveInnerWorkingCopy(direct, direct.draft!.inner_pages).draft!.manualInnerReview!.status, 'needs_review');
await saveJob(id, pendingReview);
const dropResponse = await post({ drop_inner_review: true, expected_inner_hash: stableHash(pendingReview.draft!.inner_pages) });
assert.equal(dropResponse.status, 200);
const dropped = await loadJob(id, original.id);
assert.equal(dropped.status, 'dropped');
assert.deepEqual(dropped.artifacts!.content!.data.innerPages, pendingReview.artifacts!.content!.data.innerPages);
assert.deepEqual(dropped.usage, pendingReview.usage);
assert.throws(() => lockInnerWorkingCopy(dropped), /HUMAN_REJECTED/);
assert.throws(() => saveInnerWorkingCopy(dropped, pages), /HUMAN_REJECTED/);
assert.throws(() => buildDraftTxt(dropped.draft!), /REVIEWED_DOWNSTREAM_STALE/);
assert.equal((await post({ confirm_inner_review: true })).status, 409);
const resumeDropped = await post({ action: 'resume_reviewed_inner' });
assert.notEqual(resumeDropped.status, 200);
// Exercise the real queue: a dropped job must not prevent dispatch of its successor.
// An intentionally absent card stops that successor before any network call.
const nextJob = { ...original, id: 'job_next', status: 'pending' as const, reference_card_id: 'offline_missing_card', artifacts: undefined, draft: undefined };
await saveJob(id, nextJob);
const { startBatchRunner, getActiveRunner } = await import('../src/lib/batch-runner');
assert.equal((await startBatchRunner(id)).started, true);
for (let i = 0; i < 200 && getActiveRunner(); i++) await new Promise(resolve => setTimeout(resolve, 10));
assert.equal(getActiveRunner(), null);
assert.equal((await loadJob(id, original.id)).status, 'dropped');
assert.match((await loadJob(id, nextJob.id)).failure!.message, /找不到创作卡/);
assert.equal(calls, 0);
console.log('FRESH_INNER_PAUSE=PASS; DIRECT_APPROVE=PASS; DROP_TERMINAL=PASS; REAL_QUEUE_DISPATCHES_NEXT=PASS; AI_CALLS_USED=0');
await fs.writeFile(path.join(sandbox, 'acceptance.json'), JSON.stringify({
  sourceJob: sourcePath, originalUnchanged: (await fs.readFile(sourcePath, 'utf8')) === sourceBytes,
  tests: ['SAVE_LOCK', 'PERSIST_RELOAD', 'DOWNSTREAM_STALE', 'QA_FAIL_NO_PATCH', 'REEDIT_RELOCK', 'SINGLE_CANONICAL'].map(name => ({ name, result: 'PASS' })),
  apiSaveConfirmReload: 'PASS', compilerPreservesText: 'PASS', staleExportSession: 'PASS',
  uiValidation: 'STATIC_WIRING_ONLY', aiCalls: calls,
}, null, 2));
console.log('ISOLATED_ARTIFACTS=' + sandbox);
process.chdir(root);
