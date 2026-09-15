import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('data/title-human-choice-acceptance');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(dir,p),'utf8'));
const summary=await read('summary.json');
assert.equal(summary.titleCalls,5);assert.equal(summary.coverCalls,0);assert.equal(summary.results.length,5);
const evaluations:Record<string,{worth:string;issue:string}>={
  A:{worth:'1（A4）',issue:'A1/A3均为否定祈使开头；仍偏素材库/指南命名，A2数量被拦截。'},
  B:{worth:'0（按当前长度限制）',issue:'四条全超20字符；B2把论据素材误称自查资料。'},
  C:{worth:'1（C4，仅标题表达）',issue:'C1/C2数量被拦截；低级词、万能替换等内容风险仍在。Inner未改。'},
  D:{worth:'1（D1，仅文字）',issue:'D1封面缺身份且编90%数据；D2/D3均为否定祈使开头。'},
  E:{worth:'2（E1/E2，封面承诺仍需人工看）',issue:'E3把写完自查情境错套到范文拆解；E4最快/只练过强。'},
};
const yn=(v:unknown)=>v?'YES':'NO';
const rows:any[]=[];const refs:Record<string,number>={};let tokens=0;
for(const r of summary.results){
  const request=await read(`${r.label}/request.json`),payload=JSON.parse(request.messages[1].content);
  assert.equal(payload.userApprovedStyleReferences.length,31);assert.equal(payload.negativeReferences.length,8);
  assert.ok(request.messages[0].content.includes('优先情境相似'));
  const response=await read(`${r.label}/provider-response.json`);
  const raw=JSON.parse(response.choices[0].message.content.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  assert.equal(raw.candidates.length,4);
  const candidates=r.candidates||r.debug.finalCandidates.map((x:any)=>x.pair);
  if(!r.error)assert.equal(r.humanSelectedCandidateId,null);
  for(const c of candidates)for(const id of c.referenceApprovedIds||[])refs[id]=(refs[id]||0)+1;
  tokens+=response.usage.total_tokens;
  rows.push({label:r.label,template:payload.cover.templateId,raw:raw.candidates,candidates,
    negativeStarts:candidates.filter((c:any)=>/^(?:别|不要|拒绝|告别)/.test(c.textTitle)).length,
    evaluation:evaluations[r.label],error:r.error,humanSelectedCandidateId:null});
}
const flags={TITLE_STYLE_COLLAPSE_FIXED:'NO',CONTEXT_SIMILAR_APPROVED_REFERENCE_ACTIVE:'YES',WHOLE_NOTE_SCOPE_ALIGNMENT_IMPROVED:'NO',
  VALID_CANDIDATES_PRESERVED_FOR_HUMAN_CHOICE:'YES',FIRST_VALID_NO_LONGER_BUSINESS_FINAL:'YES',COUNT_FALSE_REJECT_FIXED:'YES',
  COVER_MATCH_CALLS:0,TITLE_CALLS:5,TOTAL_NEW_AI_CALLS:5,HUMAN_4_CHOICE_WORKFLOW_READY:'NO',TITLE_CANDIDATE_POOL_COMMERCIAL_USABLE:'NO'};
const lines=['# Title 人工四选一：单轮真实结果','',
  '只调用5次Title，复用原Cover，未重试、未改Inner、未生成图片或运行Caption/QA/Render。下列“值得选”仅为助手编辑判断，不代表用户已认可或已选择。所有人工选择ID仍为null。','',
  '| Job | 4个textTitle | 值得人工选 | 最大问题 |','|---|---|---|---|'];
for(const r of rows)lines.push(`| ${r.label} | ${r.candidates.map((c:any,i:number)=>`${i+1}. ${c.textTitle}`).join('<br>')} | ${r.evaluation.worth} | ${r.evaluation.issue} |`);
lines.push('','## 完整20条候选','');
for(const r of rows){lines.push(`### ${r.label} — ${r.template}`,'');for(const [i,c] of r.raw.entries()){
  const v=r.candidates[i];
  lines.push(`#### Candidate ${i+1}`,'',`textTitle: ${c.textTitle}`,`clickReason: ${c.clickReason}`,`referenceApprovedIds: ${JSON.stringify(c.referenceApprovedIds)}`,
    `textTitleValid: ${yn(v.textTitleValid)}`,'',`coverTitle: ${c.coverTitle}`,`coverSubtitle: ${c.coverSubtitle}`,`coverValid: ${yn(v.coverValid)}`,
    `失败原因: ${v.hardFailures?.join('；')||'无（仅程序校验）'}`,'');
}}
lines.push('## 判读边界','',
  '- 否定祈使开头A/B/C/D/E分别为 '+rows.map(r=>r.negativeStarts).join('/')+'。A、D违反每组最多1条；不能宣称句式塌缩已解决。',
  '- 情境相似参考规则已进入五份真实Prompt，但使用效果仍不稳定。B2、E3仍套用“写完不踏实”的自查表达；这不是当前内容的主要用途。',
  '- COUNT_FALSE_REJECT_FIXED=YES仅指本轮指定的C中文/emoji三步、D场景A/B/C以及重复编号反例离线通过；不表示任意数量表述均能识别，A2、C1/C2等本轮原始失败均保留，不追加修复。',
  '- 人工选择代码语义已实现并离线验证：first-valid只作预览、人工字段初始null、选择后保存、未选择不允许最终文字导出。但五篇端到端四选一尚不稳定（B没有合法文字候选）；本轮结果单独保存，未写回源Job/前端，所以HUMAN_4_CHOICE_WORKFLOW_READY记NO。',
  '- C的locked Inner历史问题保留；这次不是Inner质量复核。程序valid不代表内容真实、风格合格或可直接发布。',
  '- TypeScript/build与离线回放已通过；模型、温度、31条库、8条反例和Cover Matcher未改。','',
  '## 状态','', '```text',...Object.entries(flags).map(([k,v])=>`${k} = ${v}`),'```','',
  `本轮token总数：${tokens}。参考ID使用分布：${JSON.stringify(refs)}。`,
  '完成后已停止，无第二轮Prompt调整、AI调用或下游执行。');
await fs.writeFile(path.join(dir,'REPORT.md'),lines.join('\n'));
await fs.writeFile(path.join(dir,'acceptance.json'),JSON.stringify({flags,rows,refs,tokens},null,2));
console.log(JSON.stringify({flags,tokens,report:path.join(dir,'REPORT.md')},null,2));
