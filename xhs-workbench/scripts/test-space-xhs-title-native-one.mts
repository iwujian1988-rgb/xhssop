import nextEnv from '@next/env';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
nextEnv.loadEnvConfig(root);

const batchId = process.argv[2] || 'batch_1788970269058';
const jobId = process.argv[3] || 'job_001';
const model = process.argv[4] || 'qwen3.8-flash';
const skillPath = path.join(process.env.USERPROFILE || '', '.codex', 'skills', 'space-xhs-title', 'SKILL.md');
const skill = await readFile(skillPath, 'utf8');
const jobPath = path.join(root, 'data', 'batches', batchId, 'jobs', `${jobId}.json`);
const job = JSON.parse(await readFile(jobPath, 'utf8'));
const pages = job.artifacts?.content?.data?.innerPages;

if (!Array.isArray(pages) || pages.length === 0) {
  throw new Error(`LOCKED_INNER_NOT_FOUND:${batchId}/${jobId}`);
}

function bulletText(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const item = value as Record<string, unknown>;
  return String(item.content || item.text || item.label || '').trim();
}

const note = pages.map((page: any) => {
  const bullets = Array.isArray(page.bullets)
    ? page.bullets.map(bulletText).filter(Boolean).map((text: string) => `- ${text}`).join('\n')
    : '';
  return [`## 第${page.page_no}页：${page.page_title}`, page.lead || '', bullets].filter(Boolean).join('\n');
}).join('\n\n');

const userPrompt = `请严格按照已加载的 space-xhs-title Skill 完整执行，为下面这篇准备发布的小红书笔记生成标题。不要参考任何历史标题，也不要省略Skill规定的内容标题简报、候选标题矩阵、Top 5推荐和A/B测试建议。\n\n以下是人工锁定后的完整笔记正文：\n\n${note}`;
const apiKey = process.env.OPENAI_API_KEY;
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');

const response = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
  body: JSON.stringify({
    model,
    messages: [
      {role: 'system', content: skill},
      {role: 'user', content: userPrompt},
    ],
    temperature: 0.72,
    max_tokens: 6200,
    enable_thinking: false,
  }),
  signal: AbortSignal.timeout(300_000),
});

const provider = await response.json();
if (!response.ok) throw new Error(`AI_API_ERROR:${response.status}:${JSON.stringify(provider).slice(0, 500)}`);
const raw = String(provider?.choices?.[0]?.message?.content || '');
if (!raw) throw new Error('EMPTY_NATIVE_SKILL_RESPONSE');

const outputDir = path.join(root, 'data', 'creator-buddy-native-one', batchId, jobId);
await mkdir(outputDir, {recursive: true});
await writeFile(path.join(outputDir, 'locked-inner.md'), note, 'utf8');
await writeFile(path.join(outputDir, 'request.json'), JSON.stringify({model, systemSkillPath: skillPath, systemSkillUnmodified: true, userPrompt}, null, 2), 'utf8');
await writeFile(path.join(outputDir, 'raw.md'), raw, 'utf8');
await writeFile(path.join(outputDir, 'usage.json'), JSON.stringify(provider.usage || {}, null, 2), 'utf8');
await writeFile(path.join(outputDir, 'provider-response.json'), JSON.stringify(provider, null, 2), 'utf8');

console.log(JSON.stringify({status: 'ok', batchId, jobId, model, outputDir, usage: provider.usage || {}, rawPreview: raw.slice(0, 1000)}, null, 2));
