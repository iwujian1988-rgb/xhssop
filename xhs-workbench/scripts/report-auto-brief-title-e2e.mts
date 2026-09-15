import fs from 'node:fs/promises';
const dir='data/auto-brief-title-e2e';
const data=JSON.parse(await fs.readFile(`${dir}/live/summary.json`,'utf8'));
const audit:Record<string,any>={
 A:{briefFaithful:true,worthyFinal:[],notes:'最终1三段式易把三个素材部分理解为固定段式；最终2/3偏目录，没有具体卡点或获得物；最终4直接套用忽略按语境选择。原始6“16句就够”无充分性支持却通过过滤。原始2的16是5+6+5合计，过滤器不支持该口径。'},
 B:{briefFaithful:true,worthyFinal:[1,4],notes:'最终1/4原样可选；最终2/3偏功能资料标题。原始3被数量过滤拒绝，虽然15条在正文与自动数量中可核对；“搞定”另有过强结果暗示。'},
 C:{briefFaithful:true,worthyFinal:[4],notes:'Brief五组对照与三步练习有来源；supportedCounts未列3步不影响Brief自身支持该数量。最终1“5组替换就够”是未经支持的充分性承诺，过滤器漏过；最终2偏目录，最终3泛化写好，未计值得选。原始7把练习流程改称自查三步，存在用途偏移。'},
 D:{briefFaithful:true,worthyFinal:[1],notes:'最终1自然、原样可选，但逐字复制A25参考，须记录而非当成原创性提升。最终2套路过泛，最终3工作汇报，最终4只突出局部篇幅调整。原始1把4个模块改为4步，数量口径不成立；原始3三类收件人有事实支持但被过滤拒绝。'},
 E:{briefFaithful:true,worthyFinal:[3],notes:'最终3覆盖范文利用与仿写主线，可原样选。最终1比较效果比背更有用未明确支持；最终2聚焦局部论坛骨架；最终4过泛。P5评分数量已限定局部，但原始4仍将局部包装成整篇自检标题且被数量过滤拒绝。'}
};
let report='# 自动 Fact Brief → Title 五篇E2E验收\n\n';
report+='使用最终冻结Brief系统Prompt，五篇重新调用；Brief temperature=0.2，Title temperature=0.92，均qwen3.8-max-0902、max_tokens=2600、enable_thinking=false。Title系统Prompt与B对照实验保持相同，输入仅改为本轮规定的六项。自动Brief只经过已冻结scope代码处理，未人工修改或补写。\n\n';
report+='本轮为实验脚本串联，不回写生产Job，不代表已部署。复用现有filterTextTitleCandidates；沿用之前双字段实验的离线clickReason占位适配，仅绕开不适用于双字段输出的存在性检查，不改变长度/数量/重复/家族过滤；占位未进入任何模型请求、raw或最终候选。\n\n';
report+='原样值得选是编辑验收意见，不是用户实际选择。全部humanSelectedTextTitleId=null。\n\n';
report+='| Job | Auto Brief忠实 | 8条<=20 | 合法剩余（程序） | 最终4条对应raw编号 | 原样值得选数 |\n|---|---|---:|---:|---|---:|\n';
for(const r of data.results){const a=audit[r.label];report+=`| ${r.label} | YES | ${r.le20} | ${r.survival} | ${r.humanSelectableTextTitles.map((s:any)=>r.candidates.findIndex((c:any)=>c.textTitle===s.textTitle)+1).join('、')} | ${a.worthyFinal.length} |\n`;}
for(const r of data.results){const a=audit[r.label];report+=`\n## ${r.label}\n\n锁定hash：${r.innerHash}\n\n### Auto Fact Brief\n\n${r.brief.factBrief}\n\n\`\`\`json\n${JSON.stringify({supportedCounts:r.brief.supportedCounts,scopeNotes:r.brief.scopeNotes},null,2)}\n\`\`\`\n\n### 8条raw textTitle\n\n`;r.candidates.forEach((c:any,i:number)=>{report+=`${i+1}. ${c.textTitle}（${c.visibleUnits} units；${c.referenceApprovedId}；${c.filterReasons.length?c.filterReasons.join(' / '):'程序通过'}）\n`;});report+='\n### 最终4条\n\n';r.humanSelectableTextTitles.forEach((c:any,i:number)=>{report+=`${i+1}. ${c.textTitle}\n`;});report+=`\n### 人工验收\n\n原样值得选：${a.worthyFinal.length?'最终候选第'+a.worthyFinal.join('、')+'条':'0条'}。\n\n${a.notes}\n`;}
const final={FACT_BRIEF_VERSION_FROZEN:'YES',FACT_BRIEF_MODEL:'qwen3.8-max-0902',TITLE_MODEL:'qwen3.8-max-0902',FACT_BRIEF_CALLS:data.calls.factBrief,TITLE_CALLS:data.calls.title,COVER_CALLS:0,TOTAL_AI_CALLS:data.calls.factBrief+data.calls.title,AUTO_FACT_BRIEF_ALL_FAITHFUL:'YES',FIVE_JOB_HAVE_4_VALID_TEXT_TITLES:'YES',FIVE_JOB_HAVE_AT_LEAST_ONE_PUBLISH_READY_TITLE:'NO',AUTO_BRIEF_TO_TITLE_E2E_PASS:'NO',TEXT_TITLE_PRODUCTION_READY:'NO',NEXT_STEP:'REVIEW_E2E_FAILURES'};
report+='\n## 结论\n\n五篇均通过长度和程序候选数，但程序合法不代表事实和发布质量全部合格。A最终4条未达到编辑原样值得选标准，故整体失败。Brief主要内容忠实；不能据此排除接口粒度、增加数量输入、取消逐Job Guardrails或随机波动对Title的影响，本轮不是因果隔离实验。确凿问题是范围/承诺漏检与部分候选目录化，而非超长。\n\nFIVE_JOB_HAVE_4_VALID_TEXT_TITLES=YES仅指冻结客观过滤输出数量，不表示4条全部通过人工事实验收。\n\n\`\`\`text\n'+Object.entries(final).map(([k,v])=>`${k} = ${v}`).join('\n')+'\n\`\`\`\n';
await fs.writeFile(`${dir}/REPORT.md`,report);await fs.writeFile(`${dir}/acceptance.json`,JSON.stringify({audit,final},null,2));
const preservation=JSON.parse(await fs.readFile(`${dir}/live/preservation.json`,'utf8'));console.log(JSON.stringify({final,protectedFilesUnchanged:preservation.unchanged,count:preservation.protectedFileCount}));
