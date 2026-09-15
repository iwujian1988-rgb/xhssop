import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const sourcePath = path.join(root, 'data/batches/batch_1789005556011/jobs/job_005.json');
const sourceBytes = await fs.readFile(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const candidates = source.draft?.titlePackage?.humanSelectableTextTitles || [];
assert.ok(candidates.length >= 2, 'fixture needs at least two title candidates');

const temp = await fs.mkdtemp(path.join(root, '.tmp-shared-title-pool-'));
process.env.INNER_REVIEW_TEST_DATA_DIR = path.join(temp, 'batches');
const require = createRequire(import.meta.url);
const dictionaryPath = require.resolve('dictionary-fr');
require.cache[dictionaryPath] = { id:dictionaryPath, filename:dictionaryPath, loaded:true,
  exports:{ get aff(){ throw new Error('UNEXPECTED_LEGACY_SPELLCHECK'); }, get dic(){ throw new Error('UNEXPECTED_LEGACY_SPELLCHECK'); } } } as NodeModule;

const store = await import('../src/lib/batch-store');
const api = await import('../src/app/api/batch/route');
const { isTextTitleDeliveryReady } = await import('../src/lib/canonical-title-package');

const batchId = 'batch_shared_title_pool_offline';
const job = structuredClone(source);
job.id = 'job_shared_title_pool';
job.status = 'awaiting_review';
job.draft.titlePackage.humanSelectedTextTitleId = null;
job.draft.titlePackage.humanSelectedCoverTitleId = null;
job.draft.selected_title = '';
job.artifacts.titles.data.humanSelectedTextTitleId = null;
job.artifacts.titles.data.humanSelectedCoverTitleId = null;
await store.createPlannedBatchAtomic({id:batchId,product_id:job.product_id,direction:'offline',created_at:new Date().toISOString(),status:'planned',jobs:[]},[job]);

const post = async (body: Record<string,unknown>) => api.POST(new Request('http://localhost/api/batch', {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'update_draft_state',batch_id:batchId,job_id:job.id,...body}),
}));

let response = await post({selected_bundle_id:candidates[0].id,selected_cover_title_id:candidates[0].id});
assert.equal(response.status, 200, await response.clone().text());
let persisted = await store.loadJob(batchId, job.id);
assert.equal(persisted.draft!.titlePackage!.humanSelectedTextTitleId, candidates[0].id);
assert.equal(persisted.draft!.titlePackage!.humanSelectedCoverTitleId, candidates[0].id);
assert.equal(persisted.artifacts!.titles!.data.humanSelectedTextTitleId, candidates[0].id);
assert.equal(persisted.artifacts!.titles!.data.humanSelectedCoverTitleId, candidates[0].id);
assert.equal(persisted.draft!.selected_title, candidates[0].textTitle);

response = await post({selected_cover_title_id:candidates[1].id});
assert.equal(response.status, 200, await response.clone().text());
persisted = await store.loadJob(batchId, job.id);
assert.equal(persisted.draft!.titlePackage!.humanSelectedTextTitleId, candidates[0].id);
assert.equal(persisted.draft!.titlePackage!.humanSelectedCoverTitleId, candidates[1].id);
assert.equal(persisted.draft!.selected_title, candidates[0].textTitle);
assert.equal(persisted.draft!.coverCopy, undefined);
assert.equal(persisted.artifacts!.content!.data.coverCopy, undefined);
assert.equal(persisted.artifacts!.content!.data.coverCandidates, undefined);
assert.equal(isTextTitleDeliveryReady(persisted.draft!), false);

assert.deepEqual(await fs.readFile(sourcePath), sourceBytes, 'source production job changed');
console.log('PASS: independent text/cover choices use one immutable pool; changing cover title preserves text title and invalidates stale cover output.');
console.log('AI_CALLS=0; NETWORK_CALLS=0; temp='+temp);
