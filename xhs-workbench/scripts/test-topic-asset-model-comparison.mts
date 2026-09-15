import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import nextEnv from '@next/env';

const root = process.cwd();
nextEnv.loadEnvConfig(root);

const outputDir = path.join(root, 'data', 'topic-asset-model-comparison-20260908');
await fs.mkdir(outputDir, { recursive: true });

const system = [
  '你只策划小红书 DELF B2 写作笔记的选题，不写正文、Page Plan、标题或封面文案。',
  '本次只生成3个“大资产型”选题。大资产必须覆盖一整类长期、反复出现的用户需求，而不是一个局部语言点。',
  '正确方向包括完整的议论文论证支持、正式信函表达支持、写作自查、改写训练或备考练习体系；这些只是范围示意，不是要求照抄。',
  '单个连接词、单个法语词、单一句型、单一语法结构、单个段落或单一题型，即使堆成10条、20条、40条，也不算大资产。不得用“大全、矩阵、素材库、高分”给小知识点换包装。',
  '每篇最终最多只有5个内页。promise必须能在5页内真实交付：大来自覆盖完整需求，不来自堆几十条；可用分类、代表性材料和一份代表性应用完成交付。',
  '选题不得被固定的3个、5个社会主题圈死；具体主题只能作为正文代表性示例。',
  'topic写公开选题；audienceState写用户处境；painOrDesire写用户要解决的完整需求；promise只列5页内真正交付的资产，不写具体法语答案。',
  '不得发明官方时长、评分规则、考官偏好、必考、高频或效果保证。',
  '只返回严格JSON：{"topics":[{"topic":"...","audienceState":"...","painOrDesire":"...","promise":"..."}]}。topics必须恰好3条。',
].join('\n');

const userPayload = {
  product: 'DELF B2 写作学习资料',
  task: '生成3个彼此不同、能够独立成为一篇最多5个内页笔记的大资产型选题',
};

const models = [process.env.OPENAI_MODEL || 'qwen3.7-flash', 'qwen3.8-max-0902'];
const baseUrl = (process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
const apiKey = process.env.OPENAI_API_KEY;
assert.ok(apiKey, 'OPENAI_API_KEY is required');

const commonRequest = {
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(userPayload) },
  ],
  temperature: 0.85,
  max_tokens: 2200,
  enable_thinking: false,
  response_format: { type: 'json_object' },
};

const results: unknown[] = [];
let calls = 0;
for (const [index, model] of models.entries()) {
  const label = index === 0 ? 'current' : 'alternative';
  const dir = path.join(outputDir, label);
  await fs.mkdir(dir, { recursive: true });
  const request = { model, ...commonRequest };
  await fs.writeFile(path.join(dir, 'request.json'), JSON.stringify(request, null, 2));
  calls += 1;
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(300000),
  });
  const body = await response.text();
  await fs.writeFile(path.join(dir, 'provider-response.json'), body);
  if (!response.ok) throw new Error(`${label}:${model}:HTTP_${response.status}`);
  const provider = JSON.parse(body);
  const raw = provider.choices?.[0]?.message?.content || '';
  await fs.writeFile(path.join(dir, 'raw.txt'), raw);
  const parsed = JSON.parse(raw);
  await fs.writeFile(path.join(dir, 'parsed.json'), JSON.stringify(parsed, null, 2));
  await fs.writeFile(path.join(dir, 'usage.json'), JSON.stringify(provider.usage || null, null, 2));
  results.push({ label, model, topics: parsed.topics, usage: provider.usage || null });
}

await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ calls, sameInputExceptModel: true, results }, null, 2));
console.log(JSON.stringify({ calls, models, outputDir, results }, null, 2));
