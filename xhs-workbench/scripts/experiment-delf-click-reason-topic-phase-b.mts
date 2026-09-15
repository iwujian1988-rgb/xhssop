import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

type Ref = { sourceTitle: string; sourceSummary?: string; likes?: number; favorites?: number; comments?: number; shares?: number };
type Group = { id: string; reason: string; referenceCount: number; representativeReferences: Ref[] };
type Candidate = { clickReasonId?: string; clickReason?: string; representativeReferenceTitles?: string[]; transferMode?: string; finalTopic?: string; topicCore?: string; whyThisTopic?: string };
const score = (ref: Ref) => 2 * (ref.favorites || 0) + (ref.likes || 0) + 1.5 * (ref.comments || 0) + 2 * (ref.shares || 0);
const normalize = (value: string) => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

const root = path.join(process.cwd(), 'artifacts', 'delf-click-reason-pool-experiment-20260914');
const pool = JSON.parse(await readFile(path.join(root, 'audit-v3-1.json'), 'utf8')) as { groups: Group[] };
const previous = JSON.parse(await readFile(path.join(process.cwd(), 'artifacts', 'delf-market-transfer-experiment-20260914', 'result.json'), 'utf8')) as { result?: { data?: { results?: Candidate[] } } };
const historicalTopics = (previous.result?.data?.results || []).map(item => item.finalTopic).filter(Boolean) as string[];

// Deterministic diverse sampling: one representative from 20 distinct reasons,
// then a second candidate from the four strongest selected reasons.
const selected = pool.groups.slice().sort((a, b) => Math.max(...a.representativeReferences.map(score), 0) - Math.max(...b.representativeReferences.map(score), 0)).reverse().slice(0, 20);
const plan = selected.flatMap((group, index) => {
  const item = { clickReasonId: group.id, clickReason: group.reason, references: group.representativeReferences.slice().sort((a, b) => score(b) - score(a)).slice(0, 3).map(ref => ({ title: ref.sourceTitle, summary: (ref.sourceSummary || '').slice(0, 280), likes: ref.likes, favorites: ref.favorites, comments: ref.comments, shares: ref.shares })) };
  return index < 4 ? [item, item] : [item];
});

const generated = await callOpenAICompatibleJsonWithUsage<{ results?: Candidate[] }>([
  { role: 'system', content: [
    '你是小红书市场编辑，正在做独立的DELF Click Reason Pool Phase B实验。',
    '请根据每条Click Reason和其真实高表现Reference，生成一个或两个DELF B2写作大入口Topic。最终落点必须是DELF B2写作，但不要读取或推测任何知识库章节。',
    '如果Reference本身能自然落到写作，使用DIRECT_TRANSFER；否则保留用户点击理由，把它迁移到DELF B2写作场景，使用CLICK_REASON_TRANSFER。',
    'Topic要像可以直接放封面的自然小红书选题：真实市场感、可整篇展开，不要课程章节、知识点、单个语法、单个段落技巧。不要虚构第一人称、分数、通过结果或个人经历。Reference中的月份/天数只有在它构成点击场景且Topic是中性计划/问题时才可保留。',
    '相同Click Reason的两条Topic必须是不同的大入口，不要只是替换月份或换同义词。topicCore用“领域/场景/真正要解决的事”短语表示，便于语义去重。',
    '只返回JSON：{"results":[{"clickReasonId":"...","clickReason":"...","representativeReferenceTitles":["..."],"transferMode":"DIRECT_TRANSFER或CLICK_REASON_TRANSFER","finalTopic":"...","topicCore":"...","whyThisTopic":"..."}]}。',
  ].join('\n') },
  { role: 'user', content: JSON.stringify({ contentBoundary: 'DELF B2写作', instruction: '按输入顺序，每个计划项生成1条；重复出现的前4个计划项各生成2条。', plan }) },
], { stage: 'delf-click-reason-topic-phase-b-generate', model: 'deepseek-flash', temperature: 0.25, maxTokens: 12000, retries: 1 });
const candidates = generated.data.results || [];

const deduped = await callOpenAICompatibleJsonWithUsage<{ keepIndexes?: number[]; droppedIndexes?: number[] }>([
  { role: 'system', content: [
    '你是小红书选题编辑，负责对DELF B2写作Market Topic候选做最终语义去重。',
    '先删除与已有Topic历史实质重复的候选，再删除候选之间topicCore表达同一个核心内容的候选。三个月/五个月/半年只是同一备考路线时算重复；合理不同场景如在职、暑假、临考求生可以保留。',
    '保留数量尽量接近20；如果候选确实不足，不要用章节题或伪个人经历凑数。只返回JSON：{"keepIndexes":[0,1],"droppedIndexes":[2]}。',
  ].join('\n') },
  { role: 'user', content: JSON.stringify({ historicalTopics, candidates: candidates.map((item, index) => ({ index, ...item })) }) },
], { stage: 'delf-click-reason-topic-phase-b-dedupe', model: 'deepseek-flash', temperature: 0.1, maxTokens: 5000, retries: 1 });
const keep = [...new Set((deduped.data.keepIndexes || []).filter(index => Number.isInteger(index) && index >= 0 && index < candidates.length))];
const dropped = new Set((deduped.data.droppedIndexes || []).filter(index => Number.isInteger(index)));
const final = keep.map(index => candidates[index]).filter(Boolean).slice(0, 20);
const writingViolation = /\b(?:TCF|TEF|DALF|B1|A1|A2|C1|C2)\b|听力|阅读|口语(?!表达|答题)|语法点|虚拟式|单句|开头段|结尾段|某一段/i;
const chapterLike = /模块|知识点|分类整理|句法|语法知识|每种文体|某段|单句|具体写法|技巧清单/i;
const personalClaim = /我(?:的|在|用了|花了|拿了|考了|上岸)|我的|亲测|实录|一次通过|拿满分|从\d+分到\d+分/i;
const uniqueReasonIds = new Set(final.map(item => item.clickReasonId).filter(Boolean));
const audit = {
  version: 'phase-b-click-reason-topic-experiment', requestedTopicCount: 20, generatedCandidateCount: candidates.length, finalRetainedCount: final.length,
  uniqueClickReasonCount: uniqueReasonIds.size, duplicateDroppedCount: candidates.length - final.length,
  writingScopeViolationCount: final.filter(item => writingViolation.test(item.finalTopic || '')).length,
  chapterLikeTopicCount: final.filter(item => chapterLike.test(item.finalTopic || '')).length,
  unsupportedPersonalClaimCount: final.filter(item => personalClaim.test(item.finalTopic || '')).length,
  fullHistoryStatus: 'FULL_HISTORY_DEDUPE_NOT_YET_CONNECTED', historicalTopics, results: final,
  droppedCandidateIndexes: [...dropped], usage: { generation: generated.usage, dedupe: deduped.usage },
};
await mkdir(root, { recursive: true });
await writeFile(path.join(root, 'phase-b-result.json'), JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ output: path.join(root, 'phase-b-result.json'), requestedTopicCount: audit.requestedTopicCount, generatedCandidateCount: audit.generatedCandidateCount, finalRetainedCount: audit.finalRetainedCount, uniqueClickReasonCount: audit.uniqueClickReasonCount, duplicateDroppedCount: audit.duplicateDroppedCount, writingScopeViolationCount: audit.writingScopeViolationCount, chapterLikeTopicCount: audit.chapterLikeTopicCount, unsupportedPersonalClaimCount: audit.unsupportedPersonalClaimCount, fullHistoryStatus: audit.fullHistoryStatus, results: final }, null, 2));
