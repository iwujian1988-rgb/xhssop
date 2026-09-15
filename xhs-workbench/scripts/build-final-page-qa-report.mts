import fs from 'node:fs/promises';
const data = JSON.parse(await fs.readFile('.tmp-selected-p2-p6-audit-final.json', 'utf8'));
const repairPages = new Set([
  'batch_resource_01_grammar_parchment_red_1|2', 'batch_resource_01_grammar_parchment_red_1|3', 'batch_resource_01_grammar_parchment_red_1|4', 'batch_resource_01_grammar_parchment_red_1|5', 'batch_resource_01_grammar_parchment_red_1|6',
  'batch_resource_01_grammar_parchment_red_2|2', 'batch_resource_01_grammar_parchment_red_2|3', 'batch_resource_01_grammar_parchment_red_2|5', 'batch_resource_01_grammar_parchment_red_2|6',
  'batch_resource_02_grammar_white_green_2|2', 'batch_resource_02_grammar_white_green_2|4', 'batch_resource_02_grammar_white_green_2|6',
  'batch_resource_03_chalkboard_course_1|4', 'batch_resource_03_chalkboard_course_1|5',
  'batch_resource_04_chalkboard_phrase_list_2|2', 'batch_resource_04_chalkboard_phrase_list_2|3',
  'batch_resource_06_notes_course_offer_1|2', 'batch_resource_06_notes_course_offer_1|6',
]);
const out: string[] = [
  '# FINAL P2–P6 EDITORIAL QA', '',
  '本报告基于已生成的9个Job、45页内容，仅做句子/页面级离线修复，未重新调用模型。', '',
  '## 统计', '',
  '- 总页面：45',
  `- 无需修改：${45 - repairPages.size}`,
  `- 需要局部修复：${repairPages.size}`,
  '- FACT_CLAIM_RISK：4页',
  '- FRENCH_LANGUAGE_ACCURACY：1页',
  '- EXAM_CLAIM_STRENGTH：10页',
  '- ASSET_PROMISE_CONSISTENCY：2页',
  '- PAGE_REDUNDANCY：1页（已改为交卷前核对页）',
  '- AI_COURSE_LANGUAGE：6页', '',
  '## 修改记录', '',
  '- 删除未核验的“塑料污染增加30%”，改为非统计型法语论证示例。',
  '- 将 `le fait que` 改为语境说明，不再说成固定单一语式。',
  '- 降低“严重失误、直接扣分、确保得分”等强考试结论。',
  '- 删除“完整素材库包含50条”等未确认资产数字。',
  '- 将课程化表达改为学生能直接理解的说法。',
  '- 将 Job 01 的重复 P6 改为“正式信交卷前30秒核对”。', '',
  '## 每页 QA', '',
];
for (const job of data.jobs) {
  out.push(`### ${job.id}`, '', `Mother：${job.sourceMotherTopic}`, `Final：${job.finalPublicTopic}`, '');
  for (const page of job.pages) {
    const repaired = repairPages.has(`${job.id}|${page.page_no}`);
    out.push(`#### P${page.page_no}｜${page.page_title}`, '', `QA：${repaired ? 'repair（局部修复）' : 'pass（无需修改）'}`, '', `导语：${page.lead}`, '');
    for (const bullet of page.bullets) out.push(`- ${bullet}`);
    out.push('');
  }
}
out.push('## FINAL_PAGE_READY', '', 'false：当前仍需人工复核法语教学例句、考试事实和页面视觉排版后，才能进入最终发布。');
await fs.writeFile('.tmp-final-p2-p6-editorial-qa.md', out.join('\n'), 'utf8');
console.log('FINAL_P2_P6_QA_REPORT_WRITTEN');
