import fs from 'node:fs/promises';
const dir='data/title-net-feel-abd-test';
const data=JSON.parse(await fs.readFile(`${dir}/live/summary.json`,'utf8'));
const audit:Record<string,any>={
A:{net:[2,3,7,8],ready:[1],finalReady:[1],factBoundary:true,notes:'网感增强但主要落在三段式、Cordialement及虚拟式等范围问题上。raw2三段式把素材组织误作写法；raw6将投诉局部突出为整篇；raw7泛化禁止把邮件祝颂语搬入书信，超出来源；raw8只突出P2。raw3超长。raw5的16为5+6+5相加有来源，但旧数量过滤不支持，未改。raw1自然交代范围与场景整理，可以原样选。'},
B:{net:[1,2,4,6,8],ready:[2,4,5,6,8],finalReady:[2,3],factBoundary:false,notes:'情绪与真实论据资产结合。终于不用硬憋、后悔为允许的主观情绪，不当作客观效果保证；15条论据有来源，raw2/6却被既有数量过滤拒绝。raw1超20，不能算原样可发布。最终2/3可原样选；没有新增考试频率或得分事实。'},
D:{net:[1,3,4,8],ready:[1,4],finalReady:[1,3],factBoundary:true,notes:'raw1/4自然，最终1/3可选，第一人称分享不是虚构考试成绩。raw2四模块被说成四步，过滤拒绝；raw6把篇幅失衡说成写偏且来不及改，范围歧义，过滤拒绝。raw3/8只聚焦收件人局部，不计整篇推荐。raw5/7合法但偏功能目录，未计值得选。'}
};
let md='# Title 网感分布 A/B/D 单次测试\n\n只追加候选风格分布段；自动Brief原样复用，无Brief调用。A用最近userTask版，B/D用五篇E2E版，不人工补字段。统一当前Title窄约束和approved exact去重；B/D未在这一当前版本下做过严格单变量对照，不能将差异完全归因于风格段。\n\n网感与原样值得选均为编辑判断，不是用户已认可。情绪/第一人称不因形式本身判错，仍检查长度与内容范围。\n\n';
md+='| Job | 明显网感/8 | raw原样值得选 | 最终4条值得选 | <=20 | 程序剩余 | raw事实越界 |\n|---|---:|---:|---:|---:|---:|---|\n';
for(const r of data.results){const a=audit[r.label];md+=`| ${r.label} | ${a.net.length} | ${a.ready.length} | ${a.finalReady.length} | ${r.le20} | ${r.survival} | ${a.factBoundary?'YES':'NO'} |\n`;}
for(const r of data.results){const a=audit[r.label];md+=`\n## ${r.label}\n\n| # | 原文 | units | reference | 过滤 |\n|---|---|---:|---|---|\n`;r.candidates.forEach((c:any,i:number)=>md+=`| ${i+1} | ${c.textTitle} | ${c.visibleUnits} | ${c.referenceApprovedId} | ${c.filterReasons.join(' / ')||'通过'} |\n`);md+='\n最终4条：\n\n';r.humanSelectableTextTitles.forEach((c:any,i:number)=>md+=`${i+1}. ${c.textTitle}\n`);md+=`\nraw值得选编号：${a.ready.join('、')}；最终值得选编号：${a.finalReady.join('、')}。\n\n${a.notes}\n`;}
md+='\n## 结论\n\n最终4条值得选数量：A上轮1→本轮1，B此前E2E2→本轮2，D此前E2E1→本轮2，未下降。但A未解决错误结构/局部范围，且A/B各有一条超长；D存在四步口径错误。因此不能以风格增强代替事实验收，不冻结Text Title。网感要求已在当前实验Title调用路径生效，未切换全局生产默认模型，未运行Cover或第二轮。\n\n```text\nTITLE_STYLE_NET_FEEL_PASS = NO\nTEXT_TITLE_FROZEN = NO\nTITLE_CALLS = 3\nFACT_BRIEF_CALLS = 0\nCOVER_CALLS = 0\nTOTAL_AI_CALLS = 3\n```\n';
await fs.writeFile(`${dir}/REPORT.md`,md);await fs.writeFile(`${dir}/acceptance.json`,JSON.stringify({audit,TITLE_STYLE_NET_FEEL_PASS:'NO',calls:data.calls},null,2));
const p=JSON.parse(await fs.readFile(`${dir}/live/preservation.json`,'utf8'));console.log(JSON.stringify({calls:data.calls,unchanged:p.unchanged,protectedFiles:p.protectedFileCount}));
