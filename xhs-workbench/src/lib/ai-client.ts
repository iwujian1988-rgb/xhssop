import { jsonrepair } from 'jsonrepair';

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

interface AiCallOptions {
  maxTokens?: number;
  retries?: number;
  temperature?: number;
  thinking?: boolean;
}

export interface AiUsageSummary {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
}

let recentUsage: AiUsageSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };

export function resetRecentAiUsage() {
  recentUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 };
}

export function getRecentAiUsage(): AiUsageSummary {
  return { ...recentUsage };
}

export async function callOpenAICompatibleJson(messages: AiMessage[], options: AiCallOptions = {}): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'deepseek-v4-pro';
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');

  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY。请复制 .env.example 为 .env.local 并填入 key。');
  }

  let lastError: Error | null = null;
  const retries = options.retries ?? 2;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.65,
          max_tokens: options.maxTokens ?? 6000,
          thinking: { type: options.thinking === true ? 'enabled' : 'disabled' },
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        const error = new Error(`AI API 请求失败：${res.status} ${body.slice(0, 500)}`);
        if (res.status < 500) throw error;
        lastError = error;
        continue;
      }

      const json = await res.json();
      const usage = json?.usage;
      if (usage) {
        recentUsage.prompt_tokens += Number(usage.prompt_tokens) || 0;
        recentUsage.completion_tokens += Number(usage.completion_tokens) || 0;
        recentUsage.total_tokens += Number(usage.total_tokens) || 0;
        recentUsage.calls += 1;
        console.info('[AI usage]', JSON.stringify({ model, ...usage }));
      }
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        const finishReason = json?.choices?.[0]?.finish_reason || 'unknown';
        const reasoningLength = json?.choices?.[0]?.message?.reasoning_content?.length || 0;
        lastError = new Error(`AI API 没有返回内容（finish_reason=${finishReason}, reasoning_length=${reasoningLength}）`);
        continue;
      }
      return parseJsonContent(content);
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error('AI调用失败');
      if (/请求失败：4\d\d/.test(lastError.message)) throw lastError;
    }
  }
  throw lastError || new Error('AI调用失败');
}

function parseJsonContent(content: string) {
  const unwrapped = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(unwrapped);
  } catch (originalError) {
    try {
      return JSON.parse(jsonrepair(unwrapped));
    } catch {
      const detail = originalError instanceof Error ? originalError.message : '未知JSON错误';
      throw new Error(`AI返回的JSON无法修复：${detail}`);
    }
  }
}
