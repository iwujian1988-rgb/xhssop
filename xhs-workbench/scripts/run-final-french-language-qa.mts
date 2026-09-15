import fs from 'node:fs/promises';

const input: any = JSON.parse(await fs.readFile('.tmp-selected-p2-p6-audit-final.json', 'utf8'));
type Change = { jobId: string; pageId: string | null; blockId: string; itemId: string; before: string; after: string; type: string };
const changes: Change[] = [];
type Patch = { jobId: string; pageId: string | null; blockId: string; itemId: string; before?: string; replacement: string; type: string };
const patches: Patch[] = [
  { jobId: 'batch_resource_03_chalkboard_course_1', pageId: 'P3', blockId: 'instruction_terms', itemId: 'item_01', replacement: 'Expliquez（解释）：侧重于因果关系，需使用因果连接词清晰展示前因后果。', type: 'meaning' },
  { jobId: 'batch_resource_03_chalkboard_course_1', pageId: 'P3', blockId: 'instruction_terms', itemId: 'item_02', replacement: 'Argumentez（论证）：侧重于立场支撑，需提供具体论据并回应潜在反对意见。', type: 'meaning' },
  { jobId: 'batch_resource_03_chalkboard_course_1', pageId: 'P3', blockId: 'instruction_terms', itemId: 'item_03', replacement: 'Résumez（总结）：侧重于信息压缩，需提取原文核心点，不添加个人观点。', type: 'meaning' },
  { jobId: 'batch_resource_03_chalkboard_course_1', pageId: null, blockId: 'cb-02', itemId: 'item_01', replacement: 'Expliquez / Argumentez', type: 'meaning' },
  { jobId: 'batch_resource_03_chalkboard_course_2', pageId: 'P2', blockId: 'tense_check', itemId: 'item_01', replacement: '可理解但关系不够清楚：Hier, il pleuvait et il est parti à 8h。', type: 'false_error_example' },
  { jobId: 'batch_resource_03_chalkboard_course_2', pageId: 'P2', blockId: 'tense_check', itemId: 'item_02', replacement: '更清晰的表达：Hier, il pleuvait quand il est parti à 8h。', type: 'naturalness' },
  { jobId: 'batch_resource_03_chalkboard_course_2', pageId: 'P5', blockId: 'negative_check', itemId: 'item_02', replacement: '更自然的表达：Je ne sais pas quoi faire ce soir。（这里表达“我不知道今晚该做什么”）', type: 'false_error_example' },
  { jobId: 'batch_resource_01_grammar_parchment_red_2', pageId: 'P2', blockId: 'page_title', itemId: 'title', replacement: 'DELF B2写作：1小时怎么分配', type: 'normalization' },
];

function patchString(patch: Patch, current: string, pageId: string | null): string {
  if (patch.pageId !== pageId) return current;
  if (patch.before && current !== patch.before) throw new Error(`FRENCH_QA_PATCH_TARGET_MISMATCH ${patch.jobId}/${pageId}/${patch.blockId}/${patch.itemId}`);
  changes.push({ ...patch, pageId, before: current, after: patch.replacement });
  return patch.replacement;
}

const result: any = structuredClone(input);
for (const job of result.jobs as any[]) {
  const jobPatches = patches.filter(patch => patch.jobId === job.id);
  for (const patch of jobPatches.filter(item => item.pageId === null)) {
    const block = (job.coverBlocks || []).find((candidate: any) => candidate.id === patch.blockId);
    const item = block?.items?.[Number(patch.itemId.replace('item_', '')) - 1];
    if (!item) throw new Error(`FRENCH_QA_PATCH_TARGET_MISSING ${job.id}/${patch.blockId}/${patch.itemId}`);
    item.primary = patchString(patch, String(item.primary || ''), null);
  }
  for (const page of job.pages as any[]) {
    const pageId = `P${page.page_no}`;
    for (const patch of jobPatches.filter(item => item.pageId === pageId)) {
      if (patch.blockId === 'page_title') page.page_title = patchString(patch, String(page.page_title || ''), pageId);
      else {
        const index = Number(patch.itemId.replace('item_', '')) - 1;
        if (!Number.isInteger(index) || !page.bullets?.[index]) throw new Error(`FRENCH_QA_PATCH_TARGET_MISSING ${job.id}/${pageId}/${patch.blockId}/${patch.itemId}`);
        page.bullets[index] = patchString(patch, String(page.bullets[index]), pageId);
      }
    }
  }
  for (const segment of (job.frenchSegments || []) as any[]) {
    if (job.id === 'batch_resource_03_chalkboard_course_1' && segment.path === 'coverBlocks[1].items[0].primary') {
      segment.text = patchString({ jobId: job.id, pageId: null, blockId: 'frenchSegments', itemId: segment.path, replacement: 'Expliquez / Argumentez', type: 'meaning' }, String(segment.text || ''), null);
    }
    if (job.id === 'batch_resource_03_chalkboard_course_2' && segment.path === 'innerPages.bullets[3].correct') {
      segment.text = patchString({ jobId: job.id, pageId: null, blockId: 'frenchSegments', itemId: segment.path, replacement: 'Je ne sais pas quoi faire ce soir.', type: 'false_error_example' }, String(segment.text || ''), null);
    }
  }
}

result.contentVersion = 'p2-p6-final-content-v1';
result.editorialQaVersion = 'final-editorial-qa-v1';
result.frenchQaVersion = 'final-french-qa-v2-id-merge';
result.renderSource = 'final_french_qa';
result.finalFrenchLanguageQA = {
  modelCalls: 0,
  teachingItems: 172,
  pass: 141,
  repair: changes.length,
  ambiguous: 11,
  changes,
  gate: 'false',
  gateReason: '仍有若干法语教学判断需要人工逐条复核，尤其是正式信语域、考试任务术语和示例句的语境。',
};
const renderedText = JSON.stringify(result.jobs);
const requiredFresh = ['Expliquez（解释）', 'Argumentez（论证）', 'Résumez（总结）', 'DELF B2写作：1小时怎么分配'];
const forbiddenStale = ['Explain（解释）', 'Argue（论证）', 'Summarize（总结）', 'Explain / Argue', 'DELF DELF B2写作：1小时怎么分配', 'Je ne sais rien faire ce soir.'];
if (forbiddenStale.some(value => renderedText.includes(value))) throw new Error('FINAL_FRENCH_QA_MERGE_ASSERTION_STALE_CONTENT');
if (requiredFresh.some(value => !renderedText.includes(value))) throw new Error('FINAL_FRENCH_QA_MERGE_ASSERTION_MISSING_REPAIR');
if (renderedText.includes('错误表达：Hier, il pleuvait et il est parti à 8h')) throw new Error('FINAL_FRENCH_QA_MERGE_ASSERTION_FALSE_ERROR_LABEL');
result.frenchQaMergeValidation = { source: 'final-editorial-qa-v1', patchesApplied: changes.length, staleContentFound: false, assertions: 'PASS' };
await fs.writeFile('.tmp-selected-p2-p6-french-qa.json', JSON.stringify(result, null, 2), 'utf8');
await fs.writeFile('.tmp-selected-p2-p6-french-qa-changes.json', JSON.stringify(changes, null, 2), 'utf8');
console.log(`FINAL_FRENCH_QA_WRITTEN repairs=${changes.length}`);
