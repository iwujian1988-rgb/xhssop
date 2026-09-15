import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizeFinalPageItems, paginateVisiblePages } from '../src/lib/v2/content-stage';
import { inspectFinalOutput } from '../src/lib/v2/final-output-gate';

const job = JSON.parse(await fs.readFile('data/batches/batch_final_commercial_1788532236738/jobs/job_001.json', 'utf8'));
const base = structuredClone(job.artifacts.content.data);
base.finalTeachingQa = { inputSnapshotHash: 'test', approved: true, issues: [], corrections: [], appliedPatches: [], rejectedPatches: [], unresolvedBlockingIssues: [], status: 'PASS' };

const valuable = structuredClone(base);
valuable.innerPages = [{ ...valuable.innerPages[0], pageId: 'normal', bullets: ['完整观点一。', '完整观点二。', '完整观点三。', '完整观点四。', '完整观点五。', '完整观点六。'] }];
assert.equal(paginateVisiblePages(valuable.innerPages).length, 1, 'TEST1 固定字符/条目不得拆页');
assert.equal(paginateVisiblePages(valuable.innerPages)[0].bullets.length, 6, 'TEST2 无溢出语义页内容保持');

const markup = structuredClone(base);
markup.innerPages = [{ ...markup.innerPages[0], page_title: '**标题**', lead: '*提示*<br>', bullets: ['| A | B |\n|---|---|\n|x|y|'] }];
const normalized = normalizeFinalPageItems(markup);
const text = JSON.stringify(normalized.innerPages);
assert(!/(?:\*\*|<br|:---|\|---)/u.test(text), 'TEST4 控制符应清理');

for (const fragment of ['强调‘', '总结']) {
  const probe = structuredClone(base);
  probe.innerPages[0].bullets = [fragment];
  probe.captionContentSnapshotHash = undefined;
  assert(inspectFinalOutput(probe).some(item => item.code === 'visible_dangling_fragment'), `TEST5 应拦截 ${fragment}`);
}

const duplicate = structuredClone(base);
duplicate.innerPages = [
  { ...duplicate.innerPages[0], pageId: 'a', page_title: '误区二：只堆高级词' },
  { ...duplicate.innerPages[0], pageId: 'b', page_title: '误区二：忽略论证' },
];
assert(inspectFinalOutput(duplicate).some(item => item.code === 'root_structure_duplicate'), 'TEST6 应识别重复误区编号');

const failedQa = structuredClone(base);
failedQa.finalTeachingQa.approved = false;
failedQa.finalTeachingQa.status = 'FAIL';
assert(inspectFinalOutput(failedQa).some(item => item.code === 'final_teaching_qa_failed'), 'TEST7 QA fail不得READY');

const renderer = await fs.readFile('src/components/templates/inner-pages/InnerPageRenderer.tsx', 'utf8');
const exporter = await fs.readFile('src/lib/export-image.ts', 'utf8');
assert(renderer.includes('data-render-item="true"') && exporter.includes("querySelectorAll('[data-render-item=\"true\"]')"), 'TEST3 DOM真实条目计数已接通');

const batchUi = await fs.readFile('src/app/batch/page.tsx', 'utf8');
const packager = await fs.readFile('scripts/package-final-commercial-output.mjs', 'utf8');
const batchExportRoute = await fs.readFile('src/app/api/batch-export/route.ts', 'utf8');
assert(
  batchUi.includes('readyJobIds')
    && batchExportRoute.includes("commercial?.status === 'READY'")
    && batchExportRoute.includes("'ready-files'")
    && packager.includes("commercial?.status === 'READY'"),
  'TEST8 Validation Render可处理待交付Job，但最终商用包只能包含READY',
);

console.log(JSON.stringify({ TEST1:'PASS', TEST2:'PASS', TEST3:'PASS', TEST4:'PASS', TEST5:'PASS', TEST6:'PASS', TEST7:'PASS', TEST8:'PASS' }, null, 2));
