import { loadJob, saveJob } from '../src/lib/batch-store';

const [batchId, jobId, fallbackPageNoRaw] = process.argv.slice(2);
if (!batchId || !jobId) throw new Error('usage: tsx scripts/repair-commercial-page-local.mts <batchId> <jobId>');
const fallbackPageNo = Number(fallbackPageNoRaw || 0);

const job = await loadJob(batchId, jobId);
if (!job.draft) throw new Error('Job没有draft');

const repairedPages = job.draft.inner_pages
  .filter(page => {
    if (page.page_type === 'product_bridge') return true;
    const validBullets = (page.bullets || []).map(item => item.trim()).filter(Boolean);
    return validBullets.length >= 3 || Boolean(page.renderPayload && Object.keys(page.renderPayload).length);
  })
  .map(page => (fallbackPageNo > 0 ? page.page_no === fallbackPageNo : page.semanticLayoutType === 'checklist')
    ? { ...page, semanticLayoutType: 'knowledge_list' as const }
    : page)
  .map((page, index) => ({ ...page, page_no: index + 1 }));

await saveJob(batchId, {
  ...job,
  draft: { ...job.draft, inner_pages: repairedPages },
  commercial: job.commercial ? {
    ...job.commercial,
    status: 'NEEDS_REPAIR',
    currentStage: 'pages',
    stageStatus: { ...job.commercial.stageStatus, pages: 'pass', render: 'pending', export: 'pending' },
    failedStage: undefined,
    failedTarget: undefined,
    failedReason: undefined,
    pageManifest: undefined,
    repairAttempts: { ...job.commercial.repairAttempts, pages: (job.commercial.repairAttempts.pages || 0) + 1 },
    updatedAt: new Date().toISOString(),
  } : job.commercial,
});

const persisted = await loadJob(batchId, jobId);
console.log(JSON.stringify({
  batchId,
  jobId,
  pages: persisted.draft?.inner_pages.map(page => ({ pageNo: page.page_no, title: page.page_title, layout: page.semanticLayoutType })),
  manifest: persisted.commercial?.pageManifest,
}, null, 2));
