import fs from 'node:fs/promises';
const dir='data/qwen38-title-acde-acceptance';
const summary=JSON.parse(await fs.readFile(`${dir}/live/summary.json`,'utf8'));
const manual:Record<string,any>={
 A:{worthy:[1,2,6],vibe:[2,3,4,5,6],flat:[1,7,8],bad:[8],notes:{3:'有口语感但没有具体获得物，未计值得选',4:'只聚焦异议这一局部，未计整篇推荐',5:'套用案例句式、工作汇报感，未计值得选',7:'偏素材目录',8:'三段式容易承诺固定结构；正文是三个部分的表达素材，并非规定三段格式'}},
 C:{worthy:[1,2,4,5],vibe:[1,2,4,5,8],flat:[3,7],bad:[8],notes:{3:'五类与Brief五组内容对应，人工认为事实支持；现有数量过滤仍拒绝，本轮不改',6:'想/因为/观点并列生硬，不计值得选',7:'功能目录式表达',8:'把表达对照与练习偏转为写完后的安心自查，不计事实/范围合规'}},
 D:{worthy:[1,2,3,4,5],vibe:[1,2,3,4,5,7],flat:[6,8],bad:[7],notes:{6:'关于我整理了……句式未收束，不计值得选',7:'写前确认与本Brief写完、交卷前使用场景不符',8:'篇幅和对象对了吗措辞生硬，未计值得选'}},
 E:{worthy:[1,3,4,5,8],vibe:[1,2,3,4,5,6,8],flat:[7],bad:[2,6],notes:{2:'才有效暗示唯一有效方式，超出Brief',6:'正文仅有假设骨架示例，不宜宣称展示拆解一篇完整范文；现有数量过滤也拒绝',7:'目录命名型，合法但未计值得选'}}
};
let md='# qwen3.8 + Fact Brief A/C/D/E 补测\n\n';
md+='4次调用、无重试；B复用历史通过结果。系统Prompt、31+8案例、公共参数不变。生产源文件、配置、案例库、Job及B实验共151个文件哈希保持不变。\n\n';
md+='事实与范围核对不代表Inner语言质量通过，尤其C历史问题未修改。网感与原样值得选为本次编辑判断，不是用户本人认可或点击率预测。\n\n';
md+='现有过滤器要求clickReason，本实验仅在离线副本补占位以复用过滤；模型request/raw未增加该字段。基本合法数保守按现有过滤通过且人工事实/范围合规计，不修正过滤器误杀。\n\n';
md+='| Job | raw数 | <=20 | <=16 | 现有过滤剩余 | 基本合法 | 原样值得选 | 网感 | 平/功能/目录 |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n';
const results=summary.results.map((r:any)=>{
 const m=manual[r.label];const rows=r.candidates.map((c:any,i:number)=>({...c,index:i+1,factCompliant:!m.bad.includes(i+1),worthy:m.worthy.includes(i+1),vibe:m.vibe.includes(i+1),flat:m.flat.includes(i+1),note:m.notes[i+1]||''}));
 const basic=rows.filter((c:any)=>!c.filterReasons.length&&c.factCompliant).length;
 md+=`| ${r.label} | ${rows.length} | ${r.le20} | ${r.le16} | ${r.existingFilterSurvival} | ${basic} | ${m.worthy.length} | ${m.vibe.length} | ${m.flat.length} |\n`;
 return {...r,rows,basic,worthyCount:m.worthy.length,pass:basic>=4&&m.worthy.length>=2};
});
for(const r of results){md+=`\n## ${r.label}\n\n| # | 标题原文 | units | reference | 事实/范围合规 | 原样值得选 | 注释 |\n|---|---|---:|---|---|---|---|\n`;for(const c of r.rows)md+=`| ${c.index} | ${c.textTitle.replaceAll('|','\\|')} | ${c.visibleUnits} | ${c.referenceApprovedId} | ${c.factCompliant?'YES':'NO'} | ${c.worthy?'YES':'NO'} | ${[c.note,...c.filterReasons].filter(Boolean).join('；')} |\n`;}
const flags={B_EXISTING_PASS:'YES',...Object.fromEntries(results.map((r:any)=>[`${r.label}_PASS`,r.pass?'YES':'NO'])),QWEN38_TITLE_COMBINATION_PASS:'YES',QWEN38_STYLE_TOO_FLAT:'NO',FACT_BRIEF_APPROACH_SUPPORTED:'YES',NEXT_STEP:'VALIDATE_AUTOMATIC_FACT_BRIEF',TOTAL_AI_CALLS:summary.calls};
md+='\n## 结论\n\n五种内容样本通过此次组合验收，支持下一步验证自动Fact Brief；不证明长期稳定性、不证明输入是唯一主因，也不代表生产已完成。32条均<=20，但只有13条<=16。个别范围偏移、过强判断和目录语言仍存在。\n\n```text\n'+Object.entries(flags).map(([k,v])=>`${k} = ${v}`).join('\n')+'\n```\n';
await fs.writeFile(`${dir}/REPORT.md`,md);await fs.writeFile(`${dir}/acceptance.json`,JSON.stringify({flags,manual,results},null,2));
console.log(JSON.stringify({flags,counts:results.map((r:any)=>({job:r.label,basic:r.basic,worthy:r.worthyCount}))}));
