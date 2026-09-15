import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

type Ref = { referenceId: number; sourceTitle: string; sourceSummary?: string; date?: string; likes?: number; favorites?: number; comments?: number; shares?: number };
type Exclusion = { referenceId: number; sourceTitle: string; reason: string };

function parseCsvLine(line: string) {
  const cells: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += c;
  }
  cells.push(cell); return cells;
}
const hasAny = (text: string, patterns: RegExp[]) => patterns.some(pattern => pattern.test(text));

async function loadRefs() {
  const file = path.join(process.cwd(), 'data', 'market', 'delf_xhs_notes_20260914.csv');
  const rows = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headers = rows[0].map(value => value.trim());
  const at = (name: string) => headers.indexOf(name);
  const value = (row: string[], name: string) => row[at(name)]?.trim() || undefined;
  const num = (row: string[], name: string) => { const n = Number(value(row, name)); return Number.isFinite(n) ? n : undefined; };
  const cutoff = new Date('2026-09-14T00:00:00Z'); cutoff.setMonth(cutoff.getMonth() - 6);
  const refs: Ref[] = []; const exclusions: Exclusion[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const sourceTitle = value(row, '标题'); const sourceSummary = value(row, '正文摘要'); const date = value(row, '日期');
    if (!sourceTitle) { exclusions.push({ referenceId: rowIndex, sourceTitle: '', reason: 'missing_title' }); return; }
    if (date && !Number.isNaN(Date.parse(date)) && new Date(date) < cutoff) { exclusions.push({ referenceId: rowIndex, sourceTitle, reason: 'older_than_six_months' }); return; }
    // sourceExam is intentionally ignored because the CSV contains known mislabelled rows.
    const text = `${sourceTitle} ${sourceSummary || ''}`;
    const hasDelfB2 = /delf\s*(?:[-_ ]?b2|b二)|\bdelfb2\b/i.test(text);
    const hasGenericB2 = /法语\s*b2|\bb2\b|B2|法语二级/i.test(text);
    const otherExam = hasAny(text, [/\btcf(?:\s*canada)?\b/i, /\btef(?:\s*canada)?\b/i]);
    const otherLevel = hasAny(text, [/\bdelf\s*(?:[-_ ]?b1|a1|a2)\b/i, /\bdalf\s*(?:[-_ ]?c1|c2)\b/i]);
    const hasRelevantMarketSignal = hasAny(text, [/考试|备考|上岸|通过|高分|考场|出分|作息|学习|刷题|真题|资料|经验|写作|口语|听力|阅读|法语/i]);
    const promotional = hasAny(text, [/报名课程|课程咨询|私教|加微信|扫码|优惠|招生|招收学员|购买链接/]);
    if (otherExam) exclusions.push({ referenceId: rowIndex, sourceTitle, reason: 'other_exam_tcf_or_tef' });
    else if (otherLevel) exclusions.push({ referenceId: rowIndex, sourceTitle, reason: 'other_level_or_dalf' });
    else if (!hasDelfB2 && !hasGenericB2 && !hasRelevantMarketSignal) exclusions.push({ referenceId: rowIndex, sourceTitle, reason: 'not_relevant_b2_market' });
    else if (promotional && !/经验|备考|作息|避坑|真题|资料|考试|学习|写作|口语|听力|阅读/i.test(text)) exclusions.push({ referenceId: rowIndex, sourceTitle, reason: 'promotion_without_content_signal' });
    else refs.push({ referenceId: rowIndex, sourceTitle, sourceSummary, date, likes: num(row, '点赞'), favorites: num(row, '收藏'), comments: num(row, '评论'), shares: num(row, '分享') });
  });
  refs.sort((a, b) => (2 * (b.favorites || 0) + (b.likes || 0) + 1.5 * (b.comments || 0) + 2 * (b.shares || 0)) - (2 * (a.favorites || 0) + (a.likes || 0) + 1.5 * (a.comments || 0) + 2 * (a.shares || 0)));
  return { refs, exclusions };
}

async function buildGlobalGroups(refs: Ref[]) {
  const references = refs.map((ref, index) => ({ index, title: ref.sourceTitle, summary: (ref.sourceSummary || '').slice(0, 260), likes: ref.likes, favorites: ref.favorites, comments: ref.comments, shares: ref.shares }));
  const result = await callOpenAICompatibleJsonWithUsage<{ groups?: Array<{ reason?: string; referenceIndexes?: number[] }> }>([
    { role: 'system', content: [
      '你是小红书市场编辑，负责从一整批DELF B2市场参考中归纳共享的用户点击动机。',
      '这是全局归纳：先观察所有标题和摘要背后反复出现的“用户点进去本质上想得到什么”，再建立Reason Groups，并把每条Reference分配到最合适的一组。不要先给每条Reference写独立理由再聚类。',
      'Reason必须比原标题高一层，不要复述具体月份、年龄、分数、人物身份或单篇故事，要表达可跨多篇成立的真实需求。仅换月份、分数或在职身份，不要拆组。',
      '不要按“口语/写作/词汇/语法”这种知识模块分类；同一模块里，怕跑题、想看评分标准、想分配考场时间、想看范文、想学高级表达、想练真实任务，是不同点击理由，应分开。真题战报/最新考情/成绩晒图/实战技巧也不要混为一组，只有“想知道最近考了什么和趋势”才归入考情。资料组只收资料、教材、网站、题库、资源合集和工具推荐。',
      '不要规定固定组数，也不要把每篇文章单独成组；数据应明显收缩到几十个量级。允许少量真正独特的singleton，但不要为了消灭singleton硬塞进无关组。每条Reference必须且只能进入一个组；每组reason是一句自然中文，不用ClickMode、Archetype、FOMO、信息差等术语。',
      '只返回JSON：{"groups":[{"reason":"...","referenceIndexes":[0,3]}]}，不要解释或额外字段。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ instruction: '请对以下全部Reference先全局归纳，再分配到Reason Groups。', references }) },
  ], { stage: 'delf-click-reason-global-group', model: 'deepseek-flash', temperature: 0.15, maxTokens: 16000, retries: 1 });
  return result;
}

async function refineOversizedGroups(groups: Array<{ reason: string; referenceIndexes: number[] }>, refs: Ref[]) {
  const refined: Array<{ reason?: string; referenceIndexes?: number[] }> = [];
  for (const group of groups) {
    if (group.referenceIndexes.length <= 20) { refined.push(group); continue; }
    const references = group.referenceIndexes.map(index => ({ index, title: refs[index].sourceTitle, summary: (refs[index].sourceSummary || '').slice(0, 260) }));
    const result = await callOpenAICompatibleJsonWithUsage<{ groups?: Array<{ reason?: string; referenceIndexes?: number[] }> }>([
      { role: 'system', content: [
        '你在做DELF B2市场点击理由的二次归纳。下面是一组过大的Reference，判断它是否包含多个不同的“用户为什么会点”。',
        '必须按用户要解决的事情拆，而不是按知识模块拆。口语/写作内部可能分别是：怕跑题、想懂评分、想看范文、想学高级表达、想练真实任务、想安排考场时间；只有点击动机相同才合并。',
        '如果本质确实一致可以保留一组，但不能把不同动机都叫“专项提分方法”。本组超过20条时，除非所有标题都明确是同一个具体点击动机，否则必须拆成多个子组；“完整备考经验和方法”不是可接受的超级桶。每条Reference必须且只能进入一个子组，允许少量singleton。只返回JSON：{"groups":[{"reason":"...","referenceIndexes":[0,1]}]}。',
      ].join('\n') },
      { role: 'user', content: JSON.stringify({ oversizedReason: group.reason, references }) },
    ], { stage: 'delf-click-reason-oversized-refine', model: 'deepseek-flash', temperature: 0.15, maxTokens: 9000, retries: 1 });
    refined.push(...(result.data.groups || []));
  }
  return refined;
}

const { refs, exclusions } = await loadRefs();
const grouping = await buildGlobalGroups(refs);
const rawGroups = (grouping.data.groups || []).map(group => ({ reason: group.reason?.trim() || '用户想找到可参考的备考做法。', referenceIndexes: [...new Set((group.referenceIndexes || []).filter(i => Number.isInteger(i) && i >= 0 && i < refs.length))] }));
const refinedGroups = await refineOversizedGroups(rawGroups, refs);
const assigned = new Set<number>();
const groups = refinedGroups.map((group, index) => {
  const indexes = [...new Set((group.referenceIndexes || []).filter(i => Number.isInteger(i) && i >= 0 && i < refs.length && !assigned.has(i)))];
  indexes.forEach(i => assigned.add(i));
  const members = indexes.map(i => refs[i]);
  const score = (ref: Ref) => 2 * (ref.favorites || 0) + (ref.likes || 0) + 1.5 * (ref.comments || 0) + 2 * (ref.shares || 0);
  return { id: `reason_${String(index + 1).padStart(2, '0')}`, reason: group.reason?.trim() || '用户想找到可参考的备考做法。', referenceCount: members.length, representativeReferences: members.slice().sort((a, b) => score(b) - score(a)).slice(0, 3), allReferenceIds: members.map(ref => ref.referenceId), allReferenceTitles: members.map(ref => ref.sourceTitle) };
}).filter(group => group.referenceCount > 0);
refs.forEach((_, index) => {
  if (!assigned.has(index)) groups.push({ id: `reason_unassigned_${index}`, reason: '该Reference的点击动机在本轮归纳中未能稳定合并，保留待人工复核。', referenceCount: 1, representativeReferences: [refs[index]], allReferenceIds: [refs[index].referenceId], allReferenceTitles: [refs[index].sourceTitle] });
});
const outDir = path.join(process.cwd(), 'artifacts', 'delf-click-reason-pool-experiment-20260914');
await mkdir(outDir, { recursive: true });
const exclusionStats = exclusions.reduce<Record<string, number>>((stats, item) => { stats[item.reason] = (stats[item.reason] || 0) + 1; return stats; }, {});
const normalizeTitle = (title: string) => title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const regressionTitles = ['考了法语B2，劝大家不要想得太天真了', 'DELF B2高分通过，3个月自主备考经验分享', '法语B2，浪费时间行为belike', 'DELF B2短期备考怎么做？经验贴来啦！！！', '非法专DELF B2在职备考三个月90分攻略', '法语B2一次上岸，我的5个月作息', '法语B2实际不是考试而是记忆力大赛', '严肃避雷我考法语b2时做的无用功'];
const regressionCheck = regressionTitles.map(title => { const expected = normalizeTitle(title); const retainedRef = refs.find(ref => { const actual = normalizeTitle(ref.sourceTitle); return actual === expected || actual.includes(expected) || expected.includes(actual); }); return { title, retained: Boolean(retainedRef), matchedTitle: retainedRef?.sourceTitle || null, excluded: exclusions.find(item => { const actual = normalizeTitle(item.sourceTitle); return Boolean(actual) && (actual === expected || actual.includes(expected) || expected.includes(actual)); }) || null }; });
const finalAssignedCount = groups.reduce((total, group) => total + group.referenceCount, 0);
const audit = { version: 'phase-a-v3-global-click-reason', source: 'delf_xhs_notes_20260914.csv', rawReferenceCount: refs.length + exclusions.length, excludedReferenceCount: exclusions.length, retainedReferenceCount: refs.length, exclusionStats, excludedReferences: exclusions, clickReasonGroupCount: groups.length, singletonGroupCount: groups.filter(group => group.referenceCount === 1).length, oversizedGroupCount: groups.filter(group => group.referenceCount > 20).length, largestGroups: groups.slice().sort((a, b) => b.referenceCount - a.referenceCount).slice(0, 10), groups, unassignedReferenceCount: refs.length - finalAssignedCount, excludedHighValueRegressionCheck: regressionCheck, usage: grouping.usage };
await writeFile(path.join(outDir, 'audit-v3.json'), JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ output: path.join(outDir, 'audit-v3.json'), rawReferenceCount: audit.rawReferenceCount, excludedReferenceCount: audit.excludedReferenceCount, retainedReferenceCount: audit.retainedReferenceCount, exclusionStats, clickReasonGroupCount: audit.clickReasonGroupCount, singletonGroupCount: audit.singletonGroupCount, oversizedGroupCount: audit.oversizedGroupCount, unassignedReferenceCount: audit.unassignedReferenceCount, excludedHighValueRegressionCheck: regressionCheck, largestGroups: audit.largestGroups.map(group => ({ reason: group.reason, referenceCount: group.referenceCount, representativeTitles: group.representativeReferences.map(ref => ref.sourceTitle) })) }, null, 2));
