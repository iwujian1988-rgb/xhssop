import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {countVisibleUnits} from '../src/lib/v2/contracts';
const root=path.resolve('data/text-title-only-acceptance');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(root,p),'utf8'));
const summary=await read('summary.json'),rows:any[]=[];
const notes:Record<string,string>={
 A:'4/8超长，剩3条。部分标题只讲异议或结尾，程序词汇重合检查不能保证整篇范围；无最终4条。',
 B:'8/8超长；仍有结构性矛盾/核心论点解析等章节语言，且把五主题拆成各个局部标题；更高分、高频仍出现。',
 C:'5/8超长，剩2条。这里只评价本轮Title；量化程度与观点陈述的多元表达仍像章节名。',
 D:'7条程序存活，前4条入池。首条考前最后3分钟，做完作文别急着交卷最值得人工选；第2/4条偏局部，第3条有未证实扣分推断，不把7条程序存活等同7条内容合格。',
 E:'8条程序存活，前4条入池。第3条拒绝死记硬背，B2写作其实有套路可供人工选；第1条并列投诉信与正式信易混淆，第4条只练骨架不写全文仍有过度泛化。未选入的第8条仍漂移到自查。',
};
for(const r of summary.results){
 const request=await read(`${r.label}/request.json`),payload=JSON.parse(request.messages[1].content);
 assert.deepEqual(Object.keys(payload).sort(),['wholeNoteBrief','concreteAnchors','supportedAssets','shortApprovedStyleReferences','negativeReferences'].sort());
 const raw=JSON.parse((await read(`${r.label}/provider-response.json`)).choices[0].message.content).candidates;
 assert.equal(raw.length,8);assert.ok(raw.every((c:any)=>!('coverTitle' in c)&&!('coverSubtitle' in c)));
 const trace=r.debug||await read(`data/final-content-traces/${r.requestId}/30_TEXT_TITLE_CANDIDATES.json`);
 rows.push({job:r.label,raw:raw.map((c:any)=>({...c,visibleUnits:countVisibleUnits(c.textTitle)})),survivalCount:trace.survivalCount,final:r.data?.humanSelectableTextTitles||[],evaluated:trace.evaluated,worthyCount:['D','E'].includes(r.label)?1:0,note:notes[r.label],input:payload,usage:r.usage});
}
const overlong=rows.flatMap(r=>r.raw).filter(c=>c.visibleUnits>20).length;
const flags={FOUR_VALID_TEXT_TITLES_SURVIVE:'NO (D/E YES; A/B/C NO)',AT_LEAST_ONE_HUMAN_WORTHY_TITLE:'NO (D/E YES; A/B/C no final pool)',TEXT_ONLY_STILL_OVERLONG:`YES (${overlong}/40)`,TEXT_ONLY_STILL_CATALOG_LIKE:'YES (部分仍是章节/资料命名，人工观察，非简单词命中)',TEXT_ONLY_STILL_INVENTS_MARKETING_FACTS:'YES',COVER_IS_NOT_MAIN_ROOT_CAUSE:true};
const lines=['# TEXT TITLE ONLY 隔离验收','', '| Job | 8条raw（原文；括号为visible units） | 合法剩余数¹ | 最终人工4选候选 | 值得选² |','|---|---|---:|---|---:|'];
for(const r of rows)lines.push(`| ${r.job} | ${r.raw.map((c:any,i:number)=>`${i+1}. ${c.textTitle}（${c.visibleUnits}）`).join('<br>')} | ${r.survivalCount} | ${r.final.length?r.final.map((c:any,i:number)=>`${i+1}. ${c.textTitle}`).join('<br>'):'无；不足4条'} | ${r.worthyCount} |`);
lines.push('','¹ 合法剩余指程序经过长度/事实规则/重复/多样性处理的存活数，不是人工确认全部无事实或范围问题。','² 助手编辑判断，不是用户已选中或已认可；成功Job的humanSelectedTextTitleId仍为null。','',`40条中${overlong}条超过20；A4/B8/C5/D1/E0。D/E变短，A/B/C仍失败。`,'',
 '结论：COVER_IS_NOT_MAIN_ROOT_CAUSE。本次排除了“只要拿走Cover就能稳定解决”的解释；不再把持续超长和章节化主要归因于Bundle。它不是证明Cover完全无影响的严格单变量实验（同时改变了候选数和长度目标），也尚未分离Brief措辞、示例与模型遵循能力各自的影响。','');
for(const r of rows){
 lines.push(`## ${r.job}`,'',r.note,'','### 最终人工候选','');
 if(!r.final.length)lines.push('humanSelectableTextTitles = []；INSUFFICIENT_VALID_TEXT_TITLES。');
 for(const [i,c] of r.final.entries())lines.push(`${i+1}. ${c.textTitle}`,`   - clickReason：${c.clickReason}`,`   - referenceApprovedId：${c.referenceApprovedId}`,`   - ID：${c.id}`,'');
 lines.push('','### 未进入最终候选','');
 for(const e of r.evaluated.filter((e:any)=>!r.final.some((c:any)=>c.id===e.candidate.id)))lines.push(`- ${e.candidate.textTitle} → ${e.filterReasons.length?e.filterReasons.join('；'):r.final.length?'合法备用，按顺序不进入前4':'单条程序合法，但整Job不足4条'}`);
 lines.push('','### 真实输入','', '```json',JSON.stringify(r.input,null,2),'```','');
}
lines.push('## 分项结论','', '```text',...Object.entries(flags).map(([k,v])=>`${k} = ${v}`),'TEXT_TITLE_CALLS = 5','COVER_COPY_CALLS = 0','COVER_MATCHER_CALLS = 0','RETRIES = 0','```','',
 '状态验证：first-valid只能预览；未人工确认或ID无效，requireHumanSelectedTextTitle与TXT导出均拒绝。现有选择API记录humanSelectedTextTitleId并不改封面；Cover Copy未接通，因此选定后也以COVER_COPY_PENDING阻止成品导出。没有新建并行生产链路。',
 '技术验证：离线测试与TypeScript通过；原始/短版approved库和source Jobs未改。结果只存验收目录，未回写审核页面；本轮未运行完整生产、Render、Caption或Cover。',
 '事实规则限于已有内容/数量匹配和当前未获证据支持的明确考试频率/成绩承诺；不是完整语义裁判。“省时又见效”等仍可能漏过，已在QUALITY中独立指出。',
 '已停止，未做第二轮修改或补生成。');
await fs.writeFile(path.join(root,'REPORT.md'),lines.join('\n')+'\n');
await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify({flags,rows,overlong,preservation:await read('preservation.json')},null,2));
console.log(JSON.stringify({report:path.join(root,'REPORT.md'),flags}));
