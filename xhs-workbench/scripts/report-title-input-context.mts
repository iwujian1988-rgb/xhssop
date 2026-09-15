import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('data/title-input-context-acceptance');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const summary=await read('summary.json');
const preservation=await read('preservation.json');
const notes:Record<string,string>={A:'6条全部超长，仍是高分素材库/攻略/必备等命名，未改善。',B:'仅此Job留下4条，但全部是攻略/加分点/必备/考前必看加同一资产名，封面也高度重复；编辑判断0条明显值得选。',C:'只返回4条，不是6条；全部超长，另有5步与真实3步不符、低级词替换及because串线。',D:'封面身份已通过，且出现写完/交卷/检查，但6条文字标题全部超长；90%和阅卷老师隐形陷阱缺依据。',E:'未选A25，主要回到范文拆解，但仍生成高分自查库；A13/A23/A04/A11不在Job组选定的A06/A10/A15/A24中。只有1个合法Bundle，不足4条，不能进入人工选择。'};
const rows:any[]=[];
const lines=['# Title 输入三项修复：五篇真实验收','', '本轮5次Title，Cover 0次，无重试/Repair/补生成/下游调用。只有B满足4个完整Bundle，仍未证明稳定商用。值得人工选是助手编辑判断，不冒充用户认可。','', '| Job | jobReferenceApprovedIds + whenToUse | raw数量 | 最终人工候选 | 值得人工选 |','|---|---|---:|---:|---:|'];
for(const r of summary.results){
 const req=await read(`${r.label}/request.json`),payload=JSON.parse(req.messages[1].content);
 const provider=await read(`${r.label}/provider-response.json`),raw=JSON.parse(provider.choices[0].message.content);
 const final=r.humanSelectableCandidates||[];
 const references=raw.jobReferenceApprovedIds.map((id:string)=>({id,whenToUse:payload.shortApprovedStyleReferences.find((x:any)=>x.id===id)?.whenToUse}));
 const filter=r.debug?.filterResults||(await read(`data/final-content-traces/${r.requestId}/30_TITLE_CANDIDATES.json`)).filterResults;
 rows.push({job:r.label,references,raw:raw.candidates,final,filter,error:r.error,eligibleCount:r.debug?.eligibleCount??final.length,editorWillingCount:0,note:notes[r.label],usage:r.usage,coverRequiresExamIdentity:payload.cover.coverRequiresExamIdentity});
 lines.push(`| ${r.label} | ${references.map((x:any)=>`${x.id}：${x.whenToUse}`).join('；')} | ${raw.candidates.length} | ${final.length} | 0 |`);
}
for(const row of rows){
 lines.push('',`## ${row.job}`,'',row.note,'',`jobReferenceApprovedIds = ${JSON.stringify(row.references.map((r:any)=>r.id))}`,'','### 原始候选（原文，未缩短）','');
 row.raw.forEach((c:any,i:number)=>{
  const f=row.filter.find((f:any)=>f.pair.textTitle===c.textTitle);
  lines.push(`${i+1}. ${c.textTitle}`,`   - coverTitle：${c.coverTitle}`,`   - coverSubtitle：${c.coverSubtitle}`,`   - clickReason：${c.clickReason}`,`   - referenceApprovedIds：${JSON.stringify(c.referenceApprovedIds)}`,`   - 校验/清洗：${f?.filterReasons.length?f.filterReasons.join('；'):'单条Bundle合法'}`,'');
 });
 lines.push('### 最终人工候选','');
 if(!row.final.length)lines.push(`空数组。${row.error}；单条合法数量${row.eligibleCount}，不以text-only或不足4条凑数。`);
 else row.final.forEach((c:any,i:number)=>lines.push(`${i+1}. ${c.textTitle}（${c.id}）`));
}
lines.push('','## 本轮判断','',
 '- A/B不再大量退化成高分资料/攻略/素材库：NO。',
 '- D围绕写完/交卷前/检查：有相关原文，但0个最终候选，未达可选目标。',
 '- E不再误选A25：YES；彻底消除自查角度漂移：NO；严格从Job组选引用：NO。',
 '- 五篇稳定留下4条且有1–2条值得选：NO。',
 '- 封面缺考试身份的原有失败：本轮未出现；长度和内容质量仍失败。',
 '- 原始31条库、source Jobs、既有Cover逐字节未改；真实结果只在验收目录，未写入生产人工审核页。',
 '- 本次读取实际raw数量：A6/B6/C4/D6/E6，共28条，绝不把C报告成6条。',
 '- 已停止，不再修改生产代码或追加调用。');
await fs.writeFile(path.join(root,'REPORT.md'),lines.join('\n')+'\n');
await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify({titleCalls:summary.titleCalls,coverCalls:summary.coverCalls,rows,preservation},null,2));
console.log(path.join(root,'REPORT.md'));
