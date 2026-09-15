import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';
import { buildNativeTitlePrompt, extractNativeTitleCandidates } from '../src/lib/v2/native-title-skill';

const root = process.cwd();
nextEnv.loadEnvConfig(root);
const batchId = 'batch_1789049177326';
const ids = ['job_019', 'job_020'];
const out = path.join(root, 'data', 'title-preview-latest-two-20260911.json');
const results: unknown[] = [];
for (const id of ids) {
  const job = JSON.parse(await fs.readFile(path.join(root, 'data', 'batches', batchId, 'jobs', `${id}.json`), 'utf8'));
  const topic = job.artifacts.selectedTopic.data;
  const skillPath = path.join(process.env.USERPROFILE || '', '.codex', 'skills', 'space-xhs-title', 'SKILL.md');
  const systemPrompt = await fs.readFile(skillPath, 'utf8');
  const userPrompt = [
    '请按 Skill 原始标准，仅根据下面这一条 Topic 生成标题预览。保留内容标题简报、候选标题矩阵、Top 5推荐和A/B测试建议；按Skill默认标准生成12个候选，覆盖至少6种方法。',
    '这是一个仅用选题的预览测试，不要假设正文未提供的具体数量、模块、案例或效果。',
    JSON.stringify({ topic }, null, 2),
  ].join('\n\n');
  const result = await callOpenAICompatibleJsonWithUsage<string>([
    { role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt },
  ], { stage: 'title', model: 'deepseek-flash', maxTokens: 10000, temperature: 0.72, retries: 0, thinking: false, responseMode: 'text' });
  results.push({ jobId: id, topic: topic.topic, candidates: extractNativeTitleCandidates(result.data), skillReport: result.data, usage: result.usage });
}
await fs.writeFile(out, JSON.stringify({ batchId, model: 'deepseek-flash', inputScope: 'topic_only', aiCalls: 2, results }, null, 2));
console.log(JSON.stringify({ out, aiCalls: 2, inputScope: 'topic_only', results: results.map((item: any) => ({ jobId: item.jobId, topic: item.topic, titles: item.candidates, skillReport: item.skillReport })) }, null, 2));
