import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

type Ref = { sourceTitle: string; sourceSummary?: string; likes?: number; favorites?: number; comments?: number; shares?: number };
type Group = { id: string; reason: string; referenceCount: number; representativeReferences: Ref[] };
type Candidate = { clickReasonId?: string; clickReason?: string; representativeReferenceTitles?: string[]; transferMode?: string; finalTopic?: string; topicCore?: string; status?: string };
const root = path.join(process.cwd(), 'artifacts', 'delf-click-reason-pool-experiment-20260914');
const pool = JSON.parse(await readFile(path.join(root, 'audit-v3-1.json'), 'utf8')) as { groups: Group[] };
const prior = JSON.parse(await readFile(path.join(process.cwd(), 'artifacts', 'delf-market-transfer-experiment-20260914', 'result.json'), 'utf8')) as { result?: { data?: { results?: Candidate[] } } };
const historicalTopics = (prior.result?.data?.results || []).map(item => item.finalTopic).filter(Boolean) as string[];
const unsupportedReason = /课程|教学服务|同伴|招募|成绩|出分|播客|电影|博主|最新考情|题目趋势|资源合集|资料推荐/i;
const selected = pool.groups.filter(group => !unsupportedReason.test(group.reason)).slice().sort((a, b) => b.referenceCount - a.referenceCount).slice(0, 20);
const plan = selected.flatMap((group, index) => { const item = { clickReasonId: group.id, clickReason: group.reason, references: group.representativeReferences.slice(0, 3).map(ref => ({ title: ref.sourceTitle, summary: (ref.sourceSummary || '').slice(0, 280), likes: ref.likes, favorites: ref.favorites, comments: ref.comments, shares: ref.shares })) }; return index < 8 ? [item, item] : [item]; });

const generated = await callOpenAICompatibleJsonWithUsage<{ results?: Candidate[] }>([
  { role: 'system', content: [
    '你是小红书原生选题编辑，执行DELF Click Reason Pool Phase B v2。',
    'Click Reason已经冻结。你只能依据提供的真实Reference和点击理由写Topic，不得把Topic写成课程目录、SEO标题、商品栏目或知识库模块。',
    'DELF的最终内容边界是DELF B2写作，但Reference可以来自整体备考、听说读等市场入口；迁移时保留用户为什么会点，再自然落到写作。',
    'Topic必须是一句完整、有人味、可直接做封面的中文话，优先使用疑问、提醒、反差、困惑或口语化表达。禁止默认使用“主题｜解释”“攻略”“指南”“全规划”“合集”“策略”；除非Reference本身就这样自然。',
    '参考Reference的句型感觉，但不能复制个人经历、分数、通过结果。可以使用中性时间场景，如“只剩20天还能怎么救”“在职备考时间到底怎么挤”，不能写“我3个月通过”。',
    '如果该Click Reason必须依赖当前没有的成绩案例、用户评价、社群/招募、外部资源清单、实时考情或未验证数据，返回status为SKIP_THIS_REASON，不要硬写Topic。',
    '不要生成：单个语法点、词汇分类、某段写法、文体流程、模块清单。每个计划项默认生成1条；重复的前8项各生成2条，但同一Reason的两条必须是不同的大入口。',
    '只返回JSON：{"results":[{"clickReasonId":"...","clickReason":"...","representativeReferenceTitles":["..."],"transferMode":"DIRECT_TRANSFER或CLICK_REASON_TRANSFER","finalTopic":"...","topicCore":"..."}]}；跳过时只保留clickReasonId、clickReason、status:"SKIP_THIS_REASON"。',
  ].join('\n') },
  { role: 'user', content: JSON.stringify({ contentBoundary: 'DELF B2写作', plan }) },
], { stage: 'delf-click-reason-topic-phase-b-v2-generate', model: 'deepseek-flash', temperature: 0.35, maxTokens: 14000, retries: 1 });
const raw = generated.data.results || [];
const usable = raw.filter(item => item.status !== 'SKIP_THIS_REASON' && item.finalTopic);
const skippedUnsupportedReasonCount = raw.filter(item => item.status === 'SKIP_THIS_REASON').length;

const deduped = await callOpenAICompatibleJsonWithUsage<{ keepIndexes?: number[] }>([
  { role: 'system', content: [
    '你是小红书选题终审编辑。对DELF B2写作Topic做语义去重，判断实际正文会讲什么，不只比较字面。',
    '删除与历史Topic重复的候选；删除候选之间同一个核心内容的候选。三个月/五个月/半年同属一篇普通周期规划时算重复；长期规划、在职、日常打卡、短期求生、避坑等确实不同可以保留。',
    '优先保留完整人话、市场感强、能直接做封面的Topic。不要保留课程目录式、资源服务式或无法由现有DELF写作内容支撑的Topic。最多保留20条。只返回JSON：{"keepIndexes":[0,1]}。',
  ].join('\n') },
  { role: 'user', content: JSON.stringify({ historicalTopics, candidates: usable.map((item, index) => ({ index, ...item })) }) },
], { stage: 'delf-click-reason-topic-phase-b-v2-dedupe', model: 'deepseek-flash', temperature: 0.1, maxTokens: 4000, retries: 1 });
const keep = [...new Set((deduped.data.keepIndexes || []).filter(index => Number.isInteger(index) && index >= 0 && index < usable.length))];
const final = keep.map(index => usable[index]).filter(Boolean).slice(0, 20);
const pipeStructureCount = final.filter(item => (item.finalTopic || '').includes('｜')).length;
const chapterLike = /攻略|指南|全规划|合集|策略|模块|知识点|分类整理|句法|语法知识|每种文体|某段|单句/i;
const personal = /我(?:的|在|用了|花了|拿了|考了|上岸)|我的|亲测|实录|一次通过|拿满分|从\d+分到\d+分/i;
const audit = { version: 'phase-b-click-reason-topic-experiment-v2', requestedTopicCount: 20, generatedCandidateCount: raw.length, finalRetainedCount: final.length, skippedUnsupportedReasonCount, duplicateDroppedCount: usable.length - final.length, pipeStructureCount, chapterLikeTopicCount: final.filter(item => chapterLike.test(item.finalTopic || '')).length, unsupportedPersonalClaimCount: final.filter(item => personal.test(item.finalTopic || '')).length, currentAssetBoundary: 'DELF B2写作知识内容；不假设成绩案例、社群服务、外部资源清单或实时考情', fullHistoryStatus: 'FULL_HISTORY_DEDUPE_NOT_YET_CONNECTED', historicalTopics, results: final, usage: { generation: generated.usage, dedupe: deduped.usage } };
await mkdir(root, { recursive: true });
await writeFile(path.join(root, 'phase-b-v2-result.json'), JSON.stringify(audit, null, 2), 'utf8');
console.log(JSON.stringify({ output: path.join(root, 'phase-b-v2-result.json'), requestedTopicCount: audit.requestedTopicCount, generatedCandidateCount: audit.generatedCandidateCount, finalRetainedCount: audit.finalRetainedCount, skippedUnsupportedReasonCount: audit.skippedUnsupportedReasonCount, duplicateDroppedCount: audit.duplicateDroppedCount, pipeStructureCount: audit.pipeStructureCount, chapterLikeTopicCount: audit.chapterLikeTopicCount, unsupportedPersonalClaimCount: audit.unsupportedPersonalClaimCount, fullHistoryStatus: audit.fullHistoryStatus, results: final }, null, 2));
