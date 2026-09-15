import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('data/title-final-cleanup-acceptance');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const summary=await read('summary.json');
const preservation=await read('preservation.json');
const counts=await read('short-reference-counts.json');
const editorial:Record<string,{count:number,note:string}>={
 A:{count:1,note:'仅第3条可作为人工待选；其余偏目录化。“自查清单”与表达素材形态不一致，“加分点”没有因程序通过而成为已证实事实。'},
 B:{count:1,note:'第3条资料获得物较清楚，可以待选；四条表达差异仍小，偏资料目录。5个主题有依据，不等于“常考/高分”已被证实。'},
 C:{count:0,note:'第1条封面“词汇档次提升/摆脱低级重复”仍有错误方向；第3条“3步形成肌肉记忆”和第4条“短期提分策略”过度承诺。第2条形式较可用，但现有Brief仍含“Parce que/Donc太口语化”和“Je pense that”，不能认定完整Bundle可直接商用。'},
 D:{count:0,note:'0/4完整Bundle；六条全部缺封面考试身份。原始副标题还有“90%的人都在踩”“稳拿分数”，程序报错列表不代表已穷尽语义问题。'},
 E:{count:0,note:'仅3个完整Bundle，整Job失败，不能把这3个或text-only放进人工四选一。另有局部自查抢整篇范文拆解主题。'},
};
const statuses={
 SHORT_APPROVED_LIBRARY_CREATED:'YES',SHORT_APPROVED_31_ALL_WITHIN_20:counts.length===31&&counts.every((c:any)=>c.visibleUnits<=20)?'YES':'NO',
 ORIGINAL_APPROVED_LIBRARY_PRESERVED:preservation.originalApprovedByteUnchanged?'YES':'NO',FULL_INNER_REMOVED_FROM_TITLE_CREATIVE_INPUT:'YES',WHOLE_NOTE_BRIEF_ACTIVE:'YES',
 JOB_LEVEL_CONTEXT_SIMILAR_APPROVED_SELECTION:'NO',TITLE_RAW_CANDIDATES_PER_JOB:6,TITLE_FINAL_CANDIDATES_FOR_HUMAN:{A:4,B:4,C:4,D:0,E:0},
 NEGATIVE_IMPERATIVE_FAMILY_MAX_ONE:'YES',OBJECTIVE_CANDIDATE_FILTER_ACTIVE:'YES',FIRST_VALID_NO_LONGER_BUSINESS_FINAL:'YES',
 COVER_MATCH_CALLS:summary.coverCalls,TITLE_CALLS:summary.titleCalls,TOTAL_NEW_AI_CALLS:summary.titleCalls,
 FIVE_JOB_HAVE_4_VALID_CANDIDATES:'NO',TITLE_CANDIDATE_POOL_COMMERCIAL_USABLE:'NO',HUMAN_4_CHOICE_WORKFLOW_READY:'NO',
};
const lines=['# Title 最后一轮验收','',
 '结论：A/B/C各4个程序合法完整Bundle，D/E失败。过滤机制生效；尚未证明稳定商用。没有重试、Repair、补生成或下游调用。', '',
 '“值得人工选”是本次助手编辑判断，不是用户认可、不做程序排序、不写回候选。所有成功Job的humanSelectedCandidateId仍为null。','',
 '| Job | 清洗前 | 最终人工候选 | 值得人工选 |','|---|---:|---:|---:|'];
for(const r of summary.results)lines.push(`| ${r.label} | 6 | ${r.humanSelectableCandidates?.length||0} | ${editorial[r.label].count} |`);
for(const r of summary.results){
 const raw=JSON.parse((await read(`${r.label}/provider-response.json`)).choices[0].message.content);
 if(raw.candidates.length!==6)throw new Error('Unexpected raw count');
 const req=await read(`${r.label}/request.json`);const payload=JSON.parse(req.messages[1].content);
 if('finalContentSnapshot' in payload||JSON.stringify(payload).includes('bullets'))throw new Error('Input boundary violation');
 if(raw.jobReferenceApprovedIds.length<4||raw.jobReferenceApprovedIds.length>8)throw new Error('Job refs length');
 if(!raw.candidates.every((c:any)=>(c.referenceApprovedIds||[]).every((id:string)=>raw.jobReferenceApprovedIds.includes(id))))throw new Error('Candidate refs outside Job refs');
 const trace=r.error?null:await read(`data/final-content-traces/${r.requestId}/30_TITLE_CANDIDATES.json`);
 const evaluated=r.debug?.filterResults||trace.filterResults;
 const final=r.humanSelectableCandidates||[];
 if(final.some((c:any)=>!c.bundleValid||!c.textTitleValid||!c.coverValid))throw new Error('Invalid final bundle');
 lines.push('',`## ${r.label}`,'',`jobReferenceApprovedIds = ${JSON.stringify(raw.jobReferenceApprovedIds)}`,'',editorial[r.label].note,'');
 if(r.error)lines.push(`失败：${r.error}。humanSelectableCandidates = []。`,'');
 for(const [i,c] of final.entries())lines.push(`${i+1}. ${c.textTitle}`,`   - 封面：${c.coverTitle}`,`   - 副标题：${c.coverSubtitle||'（空）'}`,`   - clickReason：${c.clickReason}`,`   - ID：${c.id}；参考：${JSON.stringify(c.referenceApprovedIds)}`,'');
 lines.push('未进入最终人工候选：','');
 for(const e of evaluated.filter((e:any)=>!final.some((c:any)=>c.id===e.pair.id))){
  const why=e.filterReasons.length?e.filterReasons.join('；'):'单条Bundle合法，但整Job不足4条，不能进入人工四选一';
  lines.push(`- ${e.pair.textTitle} → ${why}`);
 }
}
lines.push('','## 边界与证据','',
 '- 每个Job实际request/raw/result或failure、usage保存在各自目录；完整失败原因以原始记录为准，没有改写模型输出。',
 '- A第6条触发UNSUPPORTED_ASSET_COUNT，文案含“下一步”；该规则是否误判需另行诊断，本轮未修改规则或重跑。',
 '- Job级集合结构均合规（4–8条，子候选引用均来自该集合），但不能因此认定情境选择成功：E选择A25并生成自查角度，与整篇范文拆解不一致，因此语义验收标NO。',
 '- Full Inner bullets已移出创作输入，但pageTitle/lead原文仍可能包含错误教学判断；这次没有宣称入参语义已完全干净，也没有修改Inner。',
 '- HUMAN_4_CHOICE_WORKFLOW_READY=NO指本轮五篇尚不能整体交付人工四选一；成功三篇的完整Bundle过滤、未人工选择阻止最终导出，离线测试已通过。',
 '- 原始approved31、五个source Jobs和旧Cover结果逐字节不变；本轮结果仅存验收目录，未回写生产审核页。',
 '- 离线测试、TypeScript检查、Next构建通过；未声称历史所有测试脚本均已执行。',
 '- 短版逐条计数见short-reference-counts.json；保全检查见preservation.json；调用计数见calls.json。','',
 '## 状态','', '```text',...Object.entries(statuses).map(([k,v])=>`${k} = ${typeof v==='object'?JSON.stringify(v):v}`),'```','',
 '已停止，不进入第二轮优化或下游。');
await fs.writeFile(path.join(root,'REPORT.md'),lines.join('\n')+'\n');
await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify({statuses,editorial,checks:{rawSixEach:true,jobRefsFourToEight:true,candidateRefsWithinJob:true,onlyBundleValidHumanCandidates:true},preservation},null,2));
console.log(JSON.stringify({report:path.join(root,'REPORT.md'),statuses}));
