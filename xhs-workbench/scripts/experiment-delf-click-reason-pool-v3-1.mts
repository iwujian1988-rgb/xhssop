import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

type Ref = { referenceId: number; sourceTitle: string; sourceSummary?: string; date?: string; likes?: number; favorites?: number; comments?: number; shares?: number };
type Group = { id: string; reason: string; referenceCount: number; representativeReferences: Ref[]; allReferenceIds: number[]; allReferenceTitles: string[] };

function parseCsvLine(line: string) {
  const cells: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) { const c = line[i]; if (c === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; } else if (c === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += c; }
  cells.push(cell); return cells;
}
const score = (ref: Ref) => 2 * (ref.favorites || 0) + (ref.likes || 0) + 1.5 * (ref.comments || 0) + 2 * (ref.shares || 0);
const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

async function loadSourceRefs() {
  const file = path.join(process.cwd(), 'data', 'market', 'delf_xhs_notes_20260914.csv');
  const rows = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headers = rows[0].map(value => value.trim()); const at = (name: string) => headers.indexOf(name);
  const value = (row: string[], name: string) => row[at(name)]?.trim() || undefined;
  const num = (row: string[], name: string) => { const n = Number(value(row, name)); return Number.isFinite(n) ? n : undefined; };
  return rows.slice(1).reduce<Map<number, Ref>>((map, row, index) => { const title = value(row, '标题'); if (title) map.set(index, { referenceId: index, sourceTitle: title, sourceSummary: value(row, '正文摘要'), date: value(row, '日期'), likes: num(row, '点赞'), favorites: num(row, '收藏'), comments: num(row, '评论'), shares: num(row, '分享') }); return map; }, new Map());
}

function isTargetGroup(group: Group) {
  const text = `${group.reason} ${group.allReferenceTitles.join(' ')}`;
  return group.referenceCount >= 20 || /老师|课程|教学服务|备考时间|阶段规划|时间安排|学习路径|从零开始|范文|模板|万能句型|写作方法/i.test(text);
}

async function regroupTarget(refs: Ref[], target: Ref[], frozen: Group[]) {
  const references = target.map(ref => ({ index: ref.referenceId, title: ref.sourceTitle, summary: (ref.sourceSummary || '').slice(0, 280), likes: ref.likes, favorites: ref.favorites, comments: ref.comments, shares: ref.shares }));
  const existing = frozen.map(group => ({ id: group.id, reason: group.reason }));
  const result = await callOpenAICompatibleJsonWithUsage<{ groups?: Array<{ reason?: string; referenceIds?: number[]; existingGroupId?: string }> }>([
    { role: 'system', content: [
      '你在修复一个已有的DELF B2 Market Click Reason Pool，只处理本次提供的待重分配Reference。',
      '冻结的已有Reason可以复用：如果Reference的点击动机与某个已有Reason一致，填existingGroupId，不要创建同义新组。只有确实不同才创建新Reason。',
      '重点按“用户为什么点”拆分，不按作者、老师、账号或知识模块拆分。备考经历要区分：真实成长路径、时间投入/强度、在职执行、现实难度/预期、避坑无用功、反常识问题、基础差是否可能；写作内容要区分：直接拿来背的模板、真实范文、评分/扣分、表达升级、文体格式、考场时间、短期救急、资料整理；时间内容要区分正常周期、临考求生、日常执行、特殊身份。',
      '不要把不同动机叫“综合提分方法”。每条Reference必须且只能进入一个组。允许少量singleton。输出reason必须是一句自然中文，不能复述月份、分数、年龄或具体人物故事。',
      '只返回JSON：{"groups":[{"reason":"...","referenceIds":[12,18],"existingGroupId":"reason_07"}]}。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ frozenExistingReasons: existing, references }) },
  ], { stage: 'delf-click-reason-v3-1-target-regroup', model: 'deepseek-flash', temperature: 0.15, maxTokens: 12000, retries: 1 });
  return result.data.groups || [];
}

async function refineOversized(groups: Array<{ reason?: string; referenceIds?: number[]; existingGroupId?: string }>, refs: Map<number, Ref>, frozen: Group[], round: number) {
  const out: typeof groups = [];
  for (const group of groups) {
    const ids = [...new Set((group.referenceIds || []).filter(id => refs.has(id)))];
    if (ids.length <= 20) { out.push({ ...group, referenceIds: ids }); continue; }
    const result = await regroupTarget([...refs.values()], ids.map(id => refs.get(id)!), frozen);
    out.push(...result);
  }
  return out;
}

const outDir = path.join(process.cwd(), 'artifacts', 'delf-click-reason-pool-experiment-20260914');
const baseline = JSON.parse(await readFile(path.join(outDir, 'audit-v3.json'), 'utf8')) as { groups: Group[]; excludedReferences: Array<{ sourceTitle: string; reason: string; referenceId: number }>; rawReferenceCount: number; retainedReferenceCount: number };
const sourceRefs = await loadSourceRefs();
const allBaselineGroups = baseline.groups.filter(group => !group.id.startsWith('reason_unassigned_'));
const targetGroups = allBaselineGroups.filter(isTargetGroup);
const frozenGroups = allBaselineGroups.filter(group => !isTargetGroup(group));
const targetIds = new Set(targetGroups.flatMap(group => group.allReferenceIds));
const rawUnassignedIds = baseline.groups.filter(group => group.id.startsWith('reason_unassigned_')).flatMap(group => group.allReferenceIds);
const targetRefs = [...new Set([...targetIds, ...rawUnassignedIds])].map(id => sourceRefs.get(id)).filter(Boolean) as Ref[];
const firstPass = await regroupTarget([...sourceRefs.values()], targetRefs, frozenGroups);
const secondPass = await refineOversized(firstPass, sourceRefs, frozenGroups, 1);
const thirdPass = await refineOversized(secondPass, sourceRefs, frozenGroups, 2);

const assignments = new Map<string, number[]>();
const frozenById = new Map(frozenGroups.map(group => [group.id, group]));
for (const group of thirdPass) {
  const key = group.existingGroupId && frozenById.has(group.existingGroupId) ? group.existingGroupId : `new_${assignments.size + 1}`;
  assignments.set(key, [...(assignments.get(key) || []), ...(group.referenceIds || [])]);
}
const groups: Group[] = frozenGroups.map(group => ({ ...group, allReferenceIds: [...group.allReferenceIds], allReferenceTitles: [...group.allReferenceTitles], representativeReferences: [...group.representativeReferences] }));
for (const [key, ids] of assignments) {
  const uniqueIds = [...new Set(ids)].map(id => sourceRefs.get(id)).filter(Boolean) as Ref[];
  if (!uniqueIds.length) continue;
  const existing = frozenById.get(key);
  const reason = existing?.reason || thirdPass.find(group => (group.referenceIds || []).includes(uniqueIds[0].referenceId))?.reason || '用户想找到更适合自己的DELF B2备考参考。';
  if (existing) {
    const destination = groups.find(group => group.id === existing.id)!;
    const merged = [...new Set([...destination.allReferenceIds, ...uniqueIds.map(ref => ref.referenceId)])].map(id => sourceRefs.get(id)).filter(Boolean) as Ref[];
    destination.referenceCount = merged.length;
    destination.representativeReferences = merged.slice().sort((a, b) => score(b) - score(a)).slice(0, 3);
    destination.allReferenceIds = merged.map(ref => ref.referenceId);
    destination.allReferenceTitles = merged.map(ref => ref.sourceTitle);
  } else groups.push({ id: `reason_new_${groups.length + 1}`, reason, referenceCount: uniqueIds.length, representativeReferences: uniqueIds.slice().sort((a, b) => score(b) - score(a)).slice(0, 3), allReferenceIds: uniqueIds.map(ref => ref.referenceId), allReferenceTitles: uniqueIds.map(ref => ref.sourceTitle) });
}
const assigned = new Set(groups.flatMap(group => group.allReferenceIds));
const unassignedRefs = targetRefs.filter(ref => !assigned.has(ref.referenceId));
const rawUnassignedReferenceCount = unassignedRefs.length;
for (const ref of unassignedRefs) groups.push({ id: `reason_new_${groups.length + 1}`, reason: '该Reference的点击动机较独特，暂保留为独立市场理由，待人工复核。', referenceCount: 1, representativeReferences: [ref], allReferenceIds: [ref.referenceId], allReferenceTitles: [ref.sourceTitle] });

const regressionTitles = ['考了法语B2，劝大家不要想得太天真了', 'DELF B2高分通过，3个月自主备考经验分享', '法语B2，浪费时间行为belike', 'DELF B2短期备考怎么做？经验贴来啦！！！', '非法专DELF B2在职备考三个月90分攻略', '法语B2一次上岸，我的5个月作息', '法语B2实际不是考试而是记忆力大赛', '严肃避雷我考法语b2时做的无用功'];
const regression = regressionTitles.map(title => { const expected = normalize(title); const retained = [...sourceRefs.values()].find(ref => { const actual = normalize(ref.sourceTitle); return actual === expected || actual.includes(expected) || expected.includes(actual); }); const excluded = baseline.excludedReferences.find(item => item.sourceTitle && normalize(item.sourceTitle) === expected); return { title, retained: Boolean(retained), matchedTitle: retained?.sourceTitle || null, excluded: excluded || null }; });
const audit = { version: 'phase-a-v3.1-targeted-repair', source: 'delf_xhs_notes_20260914.csv', rawReferenceCount: baseline.rawReferenceCount, excludedReferenceCount: baseline.rawReferenceCount - baseline.retainedReferenceCount, retainedReferenceCount: baseline.retainedReferenceCount, clickReasonGroupCount: groups.length, singletonGroupCount: groups.filter(group => group.referenceCount === 1).length, oversizedGroupCount: groups.filter(group => group.referenceCount > 20).length, rawUnassignedReferenceCount, fallbackSingletonCount: unassignedRefs.length, targetGroupIds: targetGroups.map(group => group.id), frozenGroupIds: frozenGroups.map(group => group.id), repairedGroups: targetGroups.map(group => ({ id: group.id, oldReason: group.reason, oldReferenceCount: group.referenceCount })), newReasonCount: groups.filter(group => group.id.startsWith('reason_new_')).length, mergedIntoExistingReasonCount: [...assignments.keys()].filter(key => frozenById.has(key)).length, groups, largestGroups: groups.slice().sort((a, b) => b.referenceCount - a.referenceCount).slice(0, 10), excludedHighValueRegressionCheck: regression, stillNeedsHumanReview: groups.filter(group => group.referenceCount > 20).map(group => ({ id: group.id, reason: group.reason, referenceCount: group.referenceCount })), usage: 'see AI usage logs above' };
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'audit-v3-1.json'), JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ output: path.join(outDir, 'audit-v3-1.json'), retainedReferenceCount: audit.retainedReferenceCount, excludedReferenceCount: audit.excludedReferenceCount, clickReasonGroupCount: audit.clickReasonGroupCount, singletonGroupCount: audit.singletonGroupCount, oversizedGroupCount: audit.oversizedGroupCount, rawUnassignedReferenceCount: audit.rawUnassignedReferenceCount, fallbackSingletonCount: audit.fallbackSingletonCount, repairedGroups: audit.repairedGroups, newReasonCount: audit.newReasonCount, mergedIntoExistingReasonCount: audit.mergedIntoExistingReasonCount, excludedHighValueRegressionCheck: regression, largestGroups: audit.largestGroups.map(group => ({ id: group.id, reason: group.reason, referenceCount: group.referenceCount, representativeTitles: group.representativeReferences.map(ref => ref.sourceTitle) })) }, null, 2));
