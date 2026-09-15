import nextEnv from '@next/env';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage, type AiResponseTrace } from '../src/lib/ai-client';

const root = process.cwd();
nextEnv.loadEnvConfig(root);

const batchId = process.argv[2] || 'batch_1788935408912';
const model = process.argv[3] || 'qwen3.8-max-0902';
const batchDir = path.join(root, 'data', 'batches', batchId, 'jobs');
const outputDir = path.join(root, 'data', 'creator-buddy-title-comparison', batchId, model);
const skillPath = path.join(process.env.USERPROFILE || '', '.codex', 'skills', 'space-xhs-title', 'SKILL.md');
const skill = await readFile(skillPath, 'utf8');

type Candidate = {
  title?: string;
  charCount?: number;
  method?: string;
  hookOrSearchTerm?: string;
  score?: number;
  risk?: string;
  riskReason?: string;
};

type SkillResult = {
  brief?: Record<string, unknown>;
  candidates?: Candidate[];
  top5?: Array<{ role?: string; title?: string; reason?: string }>;
  abTests?: Array<Record<string, unknown>>;
  missingInputs?: string[];
};

function visibleUnits(value: unknown) {
  return Array.from(String(value || '').replace(/\s/g, '')).length;
}

function compactJobInput(job: any) {
  const topic = job.artifacts?.selectedTopic?.data || job.topic?.v2_topic || job.topic || {};
  const content = job.artifacts?.content?.data || {};
  const auto = content.autoFactBrief || {};
  return {
    batchId,
    jobId: job.id,
    productIdentity: 'DELF B2 写作中文学习资料',
    contentType: '知识科普 / 写作干货 / 可收藏资料',
    timeliness: '常青长尾',
    topic: topic.topic || job.topic?.topic || '',
    targetAudience: topic.audienceState || job.topic?.audience || '',
    userPainOrDesire: topic.painOrDesire || job.topic?.pain || '',
    promisedDelivery: topic.promise || job.topic?.content_promise || '',
    knownSearchTerms: [
      topic.seo?.primary,
      ...(Array.isArray(topic.seo?.related) ? topic.seo.related : []),
      ...(Array.isArray(job.topic?.search_terms) ? job.topic.search_terms : []),
    ].filter(Boolean),
    autoFactBrief: auto.factBrief || '',
    userTask: auto.userTask || '',
    supportedCounts: Array.isArray(auto.supportedCounts) ? auto.supportedCounts : [],
    scopeNotes: Array.isArray(auto.scopeNotes) ? auto.scopeNotes : [],
    canonicalLockedInner: (content.innerPages || []).map((page: any) => ({
      pageNo: page.page_no,
      pageTitle: page.page_title,
      lead: page.lead,
      bullets: page.bullets,
    })),
    evidenceBoundary: {
      personalExperienceProvided: false,
      priceProvided: false,
      outcomeGuaranteeProvided: false,
      officialExamFrequencyProvided: false,
      note: '只允许使用正文明确支持的数量和事实；不得编造亲测经历、提分效果、高频/必考、考官偏好。',
    },
  };
}

const adapter = `

你正在执行上面的 space-xhs-title Skill。现在接收的是一个已有生产工作流的事实输入，不是现成标题改写任务。
必须先按 Skill 第1步建立内容标题简报，再按至少6种方法生成默认12条候选并评分。
只允许使用 WORKFLOW_INPUT 中的事实。缺失的真实经历、价格、时长、效果、官方考试频率必须标记缺失，不能补写。
标题适用于小红书 DELF B2 写作中文学习内容，必须逐条控制在20个可见字符以内；目标13~18字符。
为便于离线对照，只返回一个合法 JSON 对象，不要 Markdown，不要代码围栏：
{
  "brief": {
    "targetAudience": "...",
    "searchTerms": ["3到5个"],
    "coreObject": "...",
    "deliverableResult": "...",
    "evidenceAssets": ["..."],
    "emotionalTone": "...",
    "saveReason": "...",
    "timeliness": "...",
    "factBoundaries": ["..."],
    "complianceRisks": ["..."]
  },
  "candidates": [
    {"title":"...","charCount":0,"method":"Skill中的标准方法名","hookOrSearchTerm":"...","score":0,"risk":"低/中/高","riskReason":"..."}
  ],
  "top5": [
    {"role":"综合首选/搜索版/爆点版/收藏版/稳健版","title":"必须逐字来自candidates","reason":"..."}
  ],
  "abTests": [{"pair":["标题A","标题B"],"singleVariable":"...","metric":"..."}],
  "missingInputs": ["缺失但限制标题强度的输入；没有则空数组"]
}
候选必须恰好12条，至少覆盖6种方法。不要把已有 production title 当参考，因为输入中没有提供它们。
`;

await mkdir(outputDir, { recursive: true });
const jobFiles = Array.from({ length: 10 }, (_, index) => `job_${String(index + 1).padStart(3, '0')}.json`);
const summaries: any[] = [];

for (const file of jobFiles) {
  const job = JSON.parse(await readFile(path.join(batchDir, file), 'utf8'));
  const input = compactJobInput(job);
  const jobOut = path.join(outputDir, job.id);
  await mkdir(jobOut, { recursive: true });
  await writeFile(path.join(jobOut, 'workflow-input.json'), JSON.stringify(input, null, 2), 'utf8');
  let responseTrace: AiResponseTrace | undefined;
  try {
    const result = await callOpenAICompatibleJsonWithUsage<SkillResult>([
      { role: 'system', content: skill + adapter },
      { role: 'user', content: `WORKFLOW_INPUT\n${JSON.stringify(input)}` },
    ], {
      stage: 'creator_buddy_space_xhs_title',
      model,
      temperature: 0.72,
      maxTokens: 6200,
      retries: 1,
      thinking: false,
      onResponseTrace: trace => { responseTrace = trace; },
    });
    const candidates = (Array.isArray(result.data?.candidates) ? result.data.candidates : []).map(item => ({
      ...item,
      reportedCharCount: item.charCount,
      actualVisibleUnits: visibleUnits(item.title),
      within20: visibleUnits(item.title) <= 20,
    }));
    const normalized = { ...result.data, candidates };
    await writeFile(path.join(jobOut, 'result.json'), JSON.stringify(normalized, null, 2), 'utf8');
    await writeFile(path.join(jobOut, 'usage.json'), JSON.stringify(result.usage, null, 2), 'utf8');
    if (responseTrace) await writeFile(path.join(jobOut, 'response-trace.json'), JSON.stringify(responseTrace, null, 2), 'utf8');
    summaries.push({
      jobId: job.id,
      topic: input.topic,
      candidateCount: candidates.length,
      within20: candidates.filter(item => item.within20).length,
      top5: result.data.top5 || [],
      missingInputs: result.data.missingInputs || [],
      usage: result.usage,
    });
    console.log(JSON.stringify({ jobId: job.id, status: 'ok', candidates: candidates.length, within20: candidates.filter(item => item.within20).length }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(path.join(jobOut, 'error.txt'), message, 'utf8');
    summaries.push({ jobId: job.id, topic: input.topic, error: message });
    console.error(JSON.stringify({ jobId: job.id, status: 'error', error: message }));
  }
}

await writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ batchId, model, skill: 'space-xhs-title', jobs: summaries }, null, 2), 'utf8');
console.log(`CREATOR_BUDDY_TITLE_OUTPUT=${outputDir}`);
