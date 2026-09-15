import fs from 'node:fs/promises';
const dir='data/automatic-title-fact-brief-acceptance';
const data=JSON.parse(await fs.readFile(`${dir}/live/summary.json`,'utf8'));
const keys=['FACT_SCOPE_MATCH','FACT_COUNTS_MATCH','IMPORTANT_MODULES_PRESERVED','NO_LOCAL_TO_GLOBAL_DRIFT','NO_INVENTED_CONTENT','NO_MARKETING_CONTAMINATION','NO_SILENT_INNER_CORRECTION'];
const audit:Record<string,any>={
 A:{failed:['NO_INVENTED_CONTENT'],difference:'主要范围与人工版一致；额外列出5/6/5条素材。每句附中文释义为过度概括：P3多项只有场景与用法说明，没有完整中文译文。',reason:'每句附中文释义并非所有句子都满足；把部分释义覆盖扩大为全部。'},
 B:{failed:[],difference:'范围一致；AUTO_MORE_COMPLETE_BUT_CORRECT：增加每个主题3条论据的真实数量。67个中文字符略短于目标，但主要范围齐全。',reason:''},
 C:{failed:[],difference:'AUTO_MORE_COMPLETE_BUT_CORRECT：增加P1避免堆砌生僻词的导读。五组替换及三步练习均在正文；没有称正文已纠错或否认历史升级判断。笼统词仍带原文评价色彩，但未宣称高级或提分。',reason:''},
 D:{failed:[],difference:'AUTO_MORE_COMPLETE_BUT_CORRECT：补出语法自查、篇幅调整与具体场景。各数量均明确局部页码。未写B2，考试身份表达比人工版弱，但没有改变实际内容范围。',reason:''},
 E:{failed:['FACT_COUNTS_MATCH','NO_LOCAL_TO_GLOBAL_DRIFT'],difference:'补充官方手册/评分维度均能在Inner找到，不因人工版未提就判发明；但五维评分仅P5局部，scope误写整篇。骨架分析没有被写成完整范文。',reason:'supportedCounts[0] count=5本身正确，但scope=整篇不正确；该项来源仅P5，属于局部自检模块。'}
};
let report='# 自动 Title Fact Brief 单次验收\n\n';
report+='五次单次生成；temperature=0.2、max_tokens=2600、enable_thinking=false。人工Brief仅在生成后对照，未发送模型。验收依据锁定Inner，而不是人工Brief逐字匹配。所有生成文本保持原样。\n\n';
report+='| Job | 自动Fact Brief | 是否忠实 | 主要差异 |\n|---|---|---|---|\n';
const results=data.results.map((r:any)=>{const a=audit[r.label];const flags=Object.fromEntries(keys.map(k=>[k,a.failed.includes(k)?'NO':'YES']));report+=`| ${r.label} | ${r.parsed.factBrief} | ${a.failed.length?'NO':'YES'} | ${a.difference} |\n`;return {...r,audit:{...a,flags}};});
for(const r of results){report+=`\n## ${r.label}\n\n人工参考：${r.humanReference.replace(/\s+/g,' ')}\n\n中文字符数：${r.chineseCharacters}\n\nsupportedCounts / scopeNotes（原始输出）：\n\n\`\`\`json\n${JSON.stringify({supportedCounts:r.parsed.supportedCounts,scopeNotes:r.parsed.scopeNotes},null,2)}\n\`\`\`\n\n\`\`\`text\n${Object.entries(r.audit.flags).map(([k,v])=>`${k} = ${v}`).join('\n')}\n\`\`\`\n${r.audit.reason?'\nNO原因：'+r.audit.reason+'\n':''}`;}
const final={FACT_BRIEF_MODEL:'qwen3.8-max-0902',FACT_BRIEF_CALLS:data.calls,TITLE_CALLS:0,COVER_CALLS:0,AUTOMATIC_FACT_BRIEF_PASS:'NO',NEXT_STEP:'REVIEW_FACT_BRIEF_FAILURES'};
report+='\n## 总结\n\nA/C/D/E的label没有把数值写入label文本，但均有独立count，不属于数量口径错误。五篇scopeNotes均为空；不能以空数组本身判失败，但E确实遗漏重要局部范围限制。A/D未显式保留B2，记录为下游身份信息风险，本轮不生成Title验证。此实验不验证官方规则真伪或Inner教学质量。\n\n'+Object.entries(final).map(([k,v])=>`${k} = ${v}`).join('\n\n')+'\n';
await fs.writeFile(`${dir}/REPORT.md`,report);await fs.writeFile(`${dir}/acceptance.json`,JSON.stringify({results,final},null,2));
const preservation=JSON.parse(await fs.readFile(`${dir}/live/preservation.json`,'utf8'));console.log(JSON.stringify({final,protectedFilesUnchanged:preservation.unchanged,protectedFileCount:preservation.protectedFileCount}));
