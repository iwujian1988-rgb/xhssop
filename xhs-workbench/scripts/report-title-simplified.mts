import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('data/title-simplified-acceptance');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const summary=await read('summary.json');const preservation=await read('preservation.json');
const rows:any[]=[];
const editorial:Record<string,any>={
 A:{count:0,catalogRaw:[1,3,6],note:'仍偏功能句型表/表达组合/核心表达清单；6条中4条超长，仅2个Bundle合法，整Job失败。'},
 B:{count:0,catalogRaw:[1,4,6],note:'不再只是四个前缀，但资料式命名仍超过2条；3条超长，1条数量不支持，仅2个Bundle合法。'},
 C:{count:0,catalogRaw:[2,3,4,6],note:'只评价本轮Title：5条超长，原始标题出现无依据Digne，clickReason出现考官喜欢等判断。仅1个Bundle合法；不把历史Inner质量并入本轮成败。'},
 D:{count:0,catalogRaw:[1,2,3,5,6],note:'未再出现90%，但6条全部以DELF B2写作开头且全部超长；部分标题局部聚焦教授口语/篇幅，未稳定守住整篇交卷前检查范围。'},
 E:{count:1,catalogRaw:[3,5],note:'最终第4条最值得人工选择（助手判断）：看懂范文不如学会拆解：B2写作进阶。第2条文字可读，但clickReason有只练核心逻辑就能拿分的过度推断。第1条高分承诺、第3条自查角度仍有问题。'},
};
for(const r of summary.results){
 const request=await read(`${r.label}/request.json`),payload=JSON.parse(request.messages[1].content);
 const raw=JSON.parse((await read(`${r.label}/provider-response.json`)).choices[0].message.content);
 assert.equal(raw.candidates.length,6);assert.ok(!('finalPublicTopic' in payload));assert.ok(!JSON.stringify(payload).includes('bullets'));assert.ok(!request.messages[0].content.includes('jobReferenceApprovedIds'));
 assert.equal(payload.shortApprovedStyleReferences.length,31);assert.ok(payload.shortApprovedStyleReferences.every((r:any)=>Object.keys(r).sort().join(',')==='id,title'));
 const previous=JSON.parse(JSON.parse(await fs.readFile(path.resolve('data/title-final-cleanup-acceptance',r.label,'request.json'),'utf8')).messages[1].content);
 assert.deepEqual(payload.shortApprovedStyleReferences,previous.shortApprovedStyleReferences);assert.deepEqual(payload.negativeReferences,previous.negativeReferences);
 const filter=r.debug?.filterResults||(await read(`data/final-content-traces/${r.requestId}/30_TITLE_CANDIDATES.json`)).filterResults;
 const final=r.humanSelectableCandidates||[];
 assert.ok(final.every((c:any)=>c.bundleValid&&c.textTitleValid&&c.coverValid));
 rows.push({job:r.label,raw:raw.candidates,final,filter,brief:payload.wholeNoteBrief,eligibleCount:r.debug?.eligibleCount??final.length,error:r.error,editorial:editorial[r.label],usage:r.usage});
}
const status={FINAL_PUBLIC_TOPIC_REMOVED_FROM_TITLE_CREATIVE_INPUT:'YES',JOB_LEVEL_APPROVED_PRESELECTION_REMOVED:'YES',SHORT_APPROVED_31_USED:'YES',FULL_INNER_REMOVED_FROM_TITLE_CREATIVE_INPUT:'YES',WHOLE_NOTE_BRIEF_ACTIVE:'YES',CONCRETE_ANCHORS_ACTIVE:'YES',TEXT_TITLE_TARGET_LENGTH:'12-18',TEXT_TITLE_HARD_MAX:20,RAW_CANDIDATES_EXACTLY_6:'YES',CATALOG_STYLE_RAW_CANDIDATES_MAX_2:'NO',NEGATIVE_IMPERATIVE_FINAL_MAX_1:'YES',COVER_CALLS:summary.coverCalls,TITLE_CALLS:summary.titleCalls,TOTAL_NEW_AI_CALLS:summary.titleCalls,FIVE_JOB_HAVE_4_VALID_BUNDLES:'NO',TITLE_CANDIDATE_POOL_COMMERCIAL_USABLE:'NO',HUMAN_4_CHOICE_WORKFLOW_READY:'NO'};
const lines=['# Title 最后一轮简化修正：真实验收','', '| Job | 6条raw textTitle | 最终4条 | 值得人工选 |','|---|---|---|---:|'];
for(const r of rows)lines.push(`| ${r.job} | ${r.raw.map((c:any,i:number)=>`${i+1}. ${c.textTitle}`).join('<br>')} | ${r.final.length?r.final.map((c:any,i:number)=>`${i+1}. ${c.textTitle}`).join('<br>'):`0；单条合法${r.eligibleCount}，不足4条整Job失败`} | ${r.editorial.count} |`);
lines.push('','以上值得人工选是助手编辑判断，不是用户已认可；未写回原始Job/审核页。目录式数量是人工验收判断，不是新增过滤规则。');
for(const r of rows){
 lines.push('',`## ${r.job}`,'',r.editorial.note,'','### WHOLE NOTE BRIEF','');
 for(const p of r.brief.pages)lines.push(`- P${p.page_no} ${p.pageTitle}（${p.structure}）：${p.lead}`);
 lines.push('','### CONCRETE ANCHORS','');
 for(const p of r.brief.concreteAnchors)lines.push(`- P${p.page_no} ${p.contentForm}：${p.terms.join(' / ')||'无额外短锚点'}`);
 lines.push('','### 最终Bundle','');
 if(!r.final.length)lines.push(`humanSelectableCandidates = []；${r.error}。`);
 for(const [i,c] of r.final.entries())lines.push(`${i+1}. textTitle：${c.textTitle}`,`   - clickReason：${c.clickReason}`,`   - referenceApprovedId：${c.referenceApprovedId||'未返回'}`,`   - coverTitle：${c.coverTitle}`,`   - coverSubtitle：${c.coverSubtitle}`,`   - ID：${c.id}`,'');
 lines.push('','### 未进入人工候选','');
 for(const e of r.filter.filter((e:any)=>!r.final.some((c:any)=>c.id===e.pair.id)))lines.push(`- ${e.pair.textTitle} → ${e.filterReasons.length?e.filterReasons.join('；'):'单条Bundle合法，但整Job不足4条，不进入人工候选'}`);
 lines.push('',`目录式raw（人工判断，保守列明显条目）：${r.editorial.catalogRaw.join(', ')}。`);
}
lines.push('','## 状态','', '```text',...Object.entries(status).map(([k,v])=>`${k} = ${v}`),'```','',
 '原始approved库、source Jobs与旧Cover逐字节未改；原短31条与旧真实请求一致；negative8条未改。模型/temperature/maxTokens不变，每Job一次，无重试。离线验证和TypeScript检查通过。',
 '当前公共接口为json_object，没有JSON Schema选项；精确6条由Prompt要求和Title返回数量检查实现，未扩展公共模型接口。',
 '只运行了本轮5次，已停止；无第二轮Prompt优化、Caption、Render或生图。');
await fs.writeFile(path.join(root,'REPORT.md'),lines.join('\n')+'\n');
await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify({status,rows,preservation},null,2));
console.log(path.join(root,'REPORT.md'));
