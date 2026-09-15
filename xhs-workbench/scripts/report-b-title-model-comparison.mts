import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('data/b-title-model-comparison/live');
const summary=JSON.parse(await fs.readFile(path.join(root,'summary.json'),'utf8'));
const editorial={
 current:{catalogIndices:[2,4,5,7],unsupportedMarketingIndices:[4],directlyPublishableIndices:[],basicQualifiedCount:0,notes:'目录判断为人工编辑观察；第4条把题材称为热点，Brief未支持。8条均超过20，不能原样发布。'},
 alternative:{catalogIndices:[3,6,7],unsupportedMarketingIndices:[8],directlyPublishableIndices:[1,4,5],basicQualifiedCount:5,notes:'第8条“够用”是Brief未支持的充分性承诺；第2条把5个主题说成5组法语表达，数量口径含混，且直接抄不够谨慎，未计入原样推荐。第3/6/7条目录感偏强，基本合格数保守排除第2/8条，再将3条目录命名限制为2条。明确原样值得选为第1/4/5条。'},
};
const statuses={CURRENT_MODEL:'qwen3.7-flash',ALTERNATIVE_MODEL:'qwen3.8-max-0902',CURRENT_MODEL_WITH_CLEAN_BRIEF_PASS:'NO',ALTERNATIVE_MODEL_WITH_CLEAN_BRIEF_PASS:'YES',INPUT_IS_MAIN_PROBLEM:'UNPROVEN',CURRENT_TITLE_MODEL_IS_MAIN_PROBLEM:'YES',CURRENT_TITLE_DESIGN_STILL_HAS_PROBLEM:'UNPROVEN',RECOMMENDED_NEXT_STEP:'CHANGE_TITLE_MODEL',TOTAL_AI_CALLS:summary.calls};
const lines=['# B标题两模型对照','', '| 模型 | 标题数 | ≤20 | ≤16 | 原样值得选 | 目录味 | 乱承诺 |','|---|---:|---:|---:|---:|---:|---:|'];
for(const r of summary.results){const e=editorial[r.label as keyof typeof editorial];lines.push(`| ${r.model} | ${r.candidates.length} | ${r.le20} | ${r.le16} | ${e.directlyPublishableIndices.length} | ${e.catalogIndices.length} | ${e.unsupportedMarketingIndices.length} |`);}
lines.push('','目录味、乱承诺、原样值得选均是助手编辑判断，不是用户认可。≤16两组都是0；替代模型只通过20字硬上限与本次商用候选池标准，不代表已稳定达到目标长度。');
for(const r of summary.results){const e=editorial[r.label as keyof typeof editorial];lines.push('',`## ${r.model}`,'');r.candidates.forEach((c:any,i:number)=>lines.push(`${i+1}. ${c.textTitle}（${c.visibleUnits}；${c.referenceApprovedId}）`));lines.push('',e.notes,`原样推荐序号：${e.directlyPublishableIndices.join('、')||'无'}；保守基本合格数：${e.basicQualifiedCount}。`);}
lines.push('','## 判定','',
 '这是情况B：同一个极短事实Brief与同一套生成要求下，当前模型仍8/8超长，替代模型8/8不超长，且至少4条基本合格、3条值得原样选择。下一步只建议评估Title节点换模型，不继续磨当前Prompt。',
 '本次仅一个B样本、每模型一次，支持当前模型是本次任务表现的主要问题，不证明替代模型在所有主题上长期稳定。与历史B相比，实验还按用户要求去掉了clickReason，因此不能把历史→本次变化单独归因于Brief。两次本轮调用之间只有model不同。',
 '未修改生产Prompt、模型默认值、配置、过滤器、案例库或B Job；源文件及配置逐字节SHA256复核通过。没有自动换模型。',
 '共同参数：temperature=0.92,max_tokens=2600,enable_thinking=false,response_format=json_object。供应商和认证沿用现有DashScope，模型列表HTTP200确认替代模型存在。一次只读模型列表查询不计入文本生成调用，两次生成均无重试。','',
 '共同内容说明只有用户给定TITLE FACT BRIEF；31短标题与8反例复用生产真实请求。实验system仅作用户要求的输入字段/输出字段适配，其他基础指令保留，生产文件未改。','',
 'usage：',...summary.results.map((r:any)=>`- ${r.model}：${JSON.stringify(r.usage)}`),'','```text',...Object.entries(statuses).map(([k,v])=>`${k} = ${v}`),'```','',
 '请求、完整供应商响应、raw文本、parsed及usage分别见current/与alternative/。已停止，无第二轮实验或生产修改。');
await fs.writeFile(path.join(root,'REPORT.md'),lines.join('\n')+'\n');
await fs.writeFile(path.join(root,'acceptance.json'),JSON.stringify({statuses,editorial,results:summary.results},null,2));
console.log(path.join(root,'REPORT.md'));
