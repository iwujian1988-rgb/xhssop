import fs from 'node:fs/promises';
const data = JSON.parse(await fs.readFile('.tmp-selected-p2-p6-audit.json', 'utf8'));
const out: string[] = ['# P2–P6 成品测试报告', '', `生成 Job：${data.jobs.length}`, '', '## 前置修正', '- 05-2 暂缓：无效法语示例未进入成品生成。', '- 06-1 已改回 DELF B2 写作语境。', '- “万能”已离线统一为“常用/可复用”。', ''];
for (const job of data.jobs) {
  out.push(`## ${job.id}`, '', `Mother Topic：${job.sourceMotherTopic}`, `Final Public Topic：${job.finalPublicTopic}`, `specificAsset：${job.specificAsset}`, '');
  for (const page of job.pages) {
    out.push(`### P${page.page_no}｜${page.page_title}`, '', page.lead, '');
    for (const bullet of page.bullets) out.push(`- ${bullet}`);
    out.push('');
  }
}
await fs.writeFile('.tmp-selected-p2-p6-report.md', out.join('\n'), 'utf8');
console.log('P2_P6_REPORT_WRITTEN');
