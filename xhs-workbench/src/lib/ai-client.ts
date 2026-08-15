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
  autofix_count: number;
  autofix_events: string[];
}

let recentUsage: AiUsageSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };

export function resetRecentAiUsage() {
  recentUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
}

export function getRecentAiUsage(): AiUsageSummary {
  return { ...recentUsage, autofix_events: [...recentUsage.autofix_events] };
}

// autofix 是 composeDraft 内部的确定性容量修复（截断/合并），不走 LLM。
// 但和 LLM usage 一样属于「这次 compose 的消耗」，挂进 AiUsageSummary 方便
// 上层（benchmark / 尸体池）一并读取。
export function recordAutofixEvents(events: string[]) {
  if (!events.length) return;
  recentUsage.autofix_count += events.length;
  recentUsage.autofix_events.push(...events);
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
      // 单次 fetch 必须有上限：DeepSeek/OpenAI 服务端通常 60-120s 会主动断开，
      // 但 TCP 半挂 / 流式响应中途卡死会让裸 fetch 永远 hang，连锁锁死整个
      // batch-runner（activeRunner 永不释放）。每 attempt 重建 signal，避免
      // 上一轮的 timeout 影响下一轮重试。
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
        // 300s：compose 是非流式 maxTokens 5000-6000 的长生成，服务端拥堵时
        // 100-200s 很常见，120s 会把正常慢请求错杀成 timeout（实测 batch_1786721806516
        // job_007 连续两次全 attempts 超时）。仍保留上限防半挂 fetch 锁死 runner。
        signal: AbortSignal.timeout(300000),
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
