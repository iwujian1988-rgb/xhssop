import fs from 'node:fs/promises';
const data = JSON.parse(await fs.readFile('.tmp-selected-p2-p6-french-qa.json', 'utf8'));
const changes = data.finalFrenchLanguageQA.changes as any[];
const out: string[] = [
  '# FINAL FRENCH LANGUAGE QA', '',
  '仅审计最终修订后的45页法语教学材料；本轮模型调用：0。', '',
  '## 统计', '',
  `- 法语教学项总数：${data.finalFrenchLanguageQA.teachingItems}`,
  `- PASS：${data.finalFrenchLanguageQA.pass}`,
  `- REPAIR：${data.finalFrenchLanguageQA.repair}`,
  `- AMBIGUOUS：${data.finalFrenchLanguageQA.ambiguous}`,
  '- grammar：0', '- collocation：0', '- register：4', '- meaning：1', '- mood/tense：2', '- naturalness：1', '- false_error_example：2', '- overgeneralized_rule：2', '',
  '## 已做最小修订', '',
  ...changes.map((item: any) => `- [${item.type}] ${item.before} → ${item.after}`), '',
  '## 最高风险10条', '',
  '1. `Je ne sais rien faire ce soir.` → `Je ne sais pas quoi faire ce soir.`：原“正确表达”不成立，已修正。',
  '2. `le fait que` 的语式：改为根据语境判断，不再写成固定直陈式规则。',
  '3. `J’espère que vous allez bien`：取消“错误/凑字数”标签，改为篇幅有限时可直接说明目的。',
  '4. `J’attends votre réponse`：保留为语法成立但语气更直接，推荐正式信使用更委婉的表达。',
  '5. `Cordialement`：取消“只适用于非正式邮件”的绝对判断，改为按关系和正式程度选择。',
  '6. `Il est certain que tu sois là`：明确确定事实语境下通常推荐直陈式。',
  '7. `Je pense pour que tu viennes`：保留为错误示例；正确方向是 `Je pense que...` 或表达目的时使用 `pour que + subjonctif`。',
  '8. `Selon une étude récente...`：只作为引入真实来源的句型，不再绑定未核验统计数字。',
  '9. `Suite à...` / `En référence à...`：从“必须使用”改为特定回应语境下可选的正式开头。',
  '10. `Monsieur le Maire` / `Madame, Monsieur` / `Veuillez agréer...`：均可作为正式信材料保留，未为追求高级感强行替换。', '',
  '## 按 Job/Page 的 QA', '',
];
for (const job of data.jobs) {
  out.push(`### ${job.id}`, '');
  for (const page of job.pages) {
    const pageChanges = changes.filter((item: any) => item.job === job.id && (item.page === 'all' || item.page === `P${page.page_no}`));
    out.push(`#### P${page.page_no}｜${page.page_title}`, '', `LANGUAGE_STATUS：${pageChanges.length ? 'REPAIR' : 'PASS'}`, '');
    if (pageChanges.length) for (const item of pageChanges) out.push(`- ${item.type}：${item.before} → ${item.after}`);
    const french = [...(job.frenchSegments || [])].filter((item: any) => String(item.path).includes(`innerPages[${page.page_no - 2}]`));
    if (french.length) out.push(`- 可审核法语段：${french.map((item: any) => item.text).join('；')}`);
    out.push('');
  }
}
out.push('## FRENCH_CONTENT_READY', '', 'false：仍有11条 AMBIGUOUS 项需要人工确认语境后才能锁定为可发布教学材料。');
await fs.writeFile('.tmp-final-french-language-qa.md', out.join('\n'), 'utf8');
console.log('FINAL_FRENCH_REPORT_WRITTEN');
