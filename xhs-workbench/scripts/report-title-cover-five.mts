import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('data/title-cover-five-acceptance');
const read=async(p:string)=>JSON.parse(await fs.readFile(path.join(dir,p),'utf8'));
const summary=await read('summary.json');
assert.equal(summary.results.length,5,'Wait for all five results; do not run generation here');
assert.equal(summary.calls.length,9);
const approved=JSON.parse(await fs.readFile('data/title-style-user-approved.json','utf8'));
const rows:any[]=[];const references:Record<string,number>={};let tokens=0;
for(const r of summary.results){
  const label=r.label;
  const req=await read(`${label}/title-request.json`);
  const payload=JSON.parse(req.messages[1].content);
  assert.deepEqual(payload.userApprovedStyleReferences.map((x:any)=>x.title),approved.map((x:any)=>x.title));
  assert.equal(payload.negativeReferences.length,8);
  assert.deepEqual(payload.wholeNoteOutline,payload.finalContentSnapshot.innerPages.map((p:any)=>({page_no:p.page_no,title:p.page_title,lead:p.lead})));
  assert.deepEqual(Object.keys(payload).sort(),['product','finalPublicTopic','wholeNoteOutline','finalContentSnapshot','cover','userApprovedStyleReferences','negativeReferences'].sort());
  assert.equal('fitReason' in payload.cover,false);
  assert.equal('coverBlocks' in payload.cover,false);
  const cover=await read(`${label}/cover-result.json`);
  assert.equal(payload.cover.templateId,cover.data.selectedCoverTemplateId);
  assert.equal(cover.data.coverSourceInnerHash,(await read(`${label}/provenance.json`)).lockedInnerHash);
  const provider=await read(`${label}/title-provider-response.json`);
  const rawText=provider.choices[0].message.content;
  const raw=JSON.parse(rawText.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  const candidates=r.candidates || r.debug.finalCandidates.map((x:any)=>x.pair);
  assert.equal(raw.candidates.length,candidates.length);
  for(const c of candidates)for(const id of c.referenceApprovedIds||[])references[id]=(references[id]||0)+1;
  tokens+=provider.usage.total_tokens;
  if(label!=='A')tokens+=(await read(`${label}/cover-provider-response.json`)).usage.total_tokens;
  rows.push({label,templateId:payload.cover.templateId,templateName:payload.cover.name,renderMode:payload.cover.renderMode,
    raw,candidates,selected:r.selected,usage:provider.usage,rawText});
}
const flags={FULL_31_APPROVED_USED:'YES',FIXED_SIX_FEWSHOT_REMOVED:'YES',NEGATIVE_REFERENCES_USED:'YES',WHOLE_NOTE_OUTLINE_ACTIVE:'YES',
  MIN_CANDIDATES:Math.min(...rows.map(r=>r.raw.candidates.length)),TITLE_AI_CALLS_PER_JOB:1,
  TEXT_TITLE_COVER_VALIDATION_SEPARATED:'YES',COVER_FAILURE_CAN_PRESERVE_GOOD_TEXT_TITLE:'YES',
  COUNT_FALSE_REJECT_FIXED:'NO',COVER_IDENTITY_VALIDATION_FIXED:'YES',REAL_5_JOB_TEST_COMPLETE:'YES',
  COVER_MATCH_CALLS:summary.calls.filter((x:any)=>x.stage==='cover').length,TITLE_CALLS:summary.calls.filter((x:any)=>x.stage==='title').length,
  TOTAL_NEW_AI_CALLS:summary.calls.length,TEXT_TITLE_USER_STYLE_MATCH:'NO',COVER_TITLE_TEMPLATE_AWARE:'NO',TITLE_BUNDLE_PRODUCTION_READY:'NO'};
const escape=(v:unknown)=>String(v??'').replace(/\|/g,'\\|').replace(/\n/g,' ');
const yn=(b:boolean)=>b?'YES':'NO';
const lines=['# Text Title + Cover Title 五篇单轮验收','',
  '仅一次真实测试。Cover 4次 + Title 5次；A复用hash=149d2z1封面。未重试，未生成图片，未运行Caption/QA/Render，未修改Cover Matcher。',
  '五个源Job字节不变；新结果保存于本验收目录，未覆盖人工锁定稿或写回页面。','',
  '| Job | Candidate 1 textTitle | 实际封面模板 | coverTitle | 程序Bundle可用 |',
  '|---|---|---|---|---|---|'];
for(const r of rows){const c=r.candidates[0];lines.push(`| ${r.label} | ${escape(c.textTitle)} | ${r.templateName} (${r.templateId}) | ${escape(c.coverTitle)} | ${yn(c.bundleValid)} |`);}
lines.push('','“程序可用”只代表当前确定性校验通过，不等于风格或教学事实人工验收通过。D无可发布Bundle，文字候选保留在failure.json及30_TITLE_CANDIDATES.json。','',
  '## 人工观察（本轮不据此再修改）','',
  '- 未达到整体用户风格验收：有问句、反常识和网感，但仍有“指南/素材库+功能说明”的目录句；“救命检”等压缩表达不自然。差异不是资料、高分等词本身，而是整句话的推荐关系和自然程度。',
  '- 局部页抢整篇仍存在：C4只讲末页三步内化；D2/D3/D4分别抬高审题场景、篇幅、语域页为整篇标题。具体切口不必全部判坏，但本轮没有稳定体现全篇自检范围。',
  '- C2写“低级词替换”、C3写“拒绝口语化”，有将语境选择强化为等级/禁用判断的风险；当前validator没有完整识别，不能以textTitleValid冒充内容正确。',
  '- 重要来源区别：C的真实locked Inner已包含“升级A/B”、考官视角、“Parce que/Donc太口语化？”及“Je pense that”“Un grand nombre of/de”“Fondamentally”等原文。因此C的问题不能全部归咎于Title发明，locked状态不等于内容已经正确。此次没有修改或重跑Inner。',
  '- D1 clickReason写“90%的丢分”，副标题写“少扣一半分”，都是本轮明确的无依据量化得分承诺；D4的“阅卷老师直接懵”也是模型自行描写判断。',
  '- 真实模板信息输入已成功；但输出适配不能判全部通过：D封面所有候选漏考试身份，C2副标题超长；C匹配路线图模板，却仍以通用误区/升级口号为主。',
  '- 同一clickReason不是完全失效，但存在弱关联：A2文字“没思路”过泛，封面讲语气；B1从辩证思路转成泛“避坑”。不能认定五篇所有Bundle语义一致已通过。',
  '- D“交卷前3点”、E“范文拆解5步”的指定离线例已通过；但C末页确实有带emoji的第一/二/三步，D审题页确有情境A/B/C，真实C4、D2仍被数量校验误杀。因此整体COUNT_FALSE_REJECT_FIXED记NO，不冒充全部修复。本轮停止，不追加第二轮。',
  '- E1把结构练习扩大成“B2写作只练骨架就够了”，E2把范文拆解模板称为自查模板，也不宜仅凭程序通过就直接发布。','',
  '## 全部原始候选与计算状态','');
for(const r of rows){
  lines.push(`### ${r.label} — ${r.templateName}`,``, `templateId = ${r.templateId}; renderMode = ${r.renderMode}`,'');
  for(const [i,c] of r.raw.candidates.entries()){
    const computed=r.candidates[i];
    lines.push(`#### Candidate ${i+1}`,'',`- clickReason：${c.clickReason}`,`- referenceApprovedIds：${JSON.stringify(c.referenceApprovedIds)}`,
      `- textTitle：${c.textTitle}`,`- coverTitle：${c.coverTitle}`,`- coverSubtitle：${c.coverSubtitle}`,
      `- textTitleValid / coverValid / bundleValid：${yn(computed.textTitleValid)} / ${yn(computed.coverValid)} / ${yn(computed.bundleValid)}`,
      `- 失败原因：${computed.hardFailures.length?computed.hardFailures.join('；'):'无（仅程序校验）'}`,
      `- 标记：${computed.warnings?.join('；')||'无'}`,'');
  }
}
lines.push('## 参考ID分布','',`使用 ${Object.keys(references).length}/31 个ID；全部计数：`, '',JSON.stringify(references,null,2),'',
  '只记录模型声明的参考ID，不将其视为确实学到风格的证明。未加shuffle。','',
  '## 验收状态','', '```text',...Object.entries(flags).map(([k,v])=>`${k} = ${v}`),'```','',
  `本轮9个provider响应总tokens = ${tokens}（不含A历史Cover，不累计历史usage）。`,
  '已停止；未自行第二轮优化或继续生产。');
await fs.writeFile(path.join(dir,'REPORT.md'),lines.join('\n'));
await fs.writeFile(path.join(dir,'acceptance.json'),JSON.stringify({flags,tokens,references,rows:rows.map(({rawText,...rest})=>rest)},null,2));
console.log(JSON.stringify({flags,tokens,references,report:path.join(dir,'REPORT.md')},null,2));
