import { jsonrepair } from 'jsonrepair';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  // 桥接模式：AI_BRIDGE_DIR 指定时完全不碰远程 API（不消耗用户 token），
  // 把每次调用的完整 prompt 落盘，等待同目录下出现对应 .resp 文件后返回。
  // 用于让真实管线/真实 prompt/真实闸门在"外部模型"（Claude 子代理）驱动下
  // 端到端跑通。响应文件内容为纯文本（JSON 字符串），走同一个 parseJsonContent。
  if (process.env.AI_BRIDGE_DIR) {
    return callBridgeJson(process.env.AI_BRIDGE_DIR, messages, options);
  }

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

let bridgeSeq = 0;

async function callBridgeJson(dir: string, messages: AiMessage[], options: AiCallOptions): Promise<unknown> {
  bridgeSeq += 1;
  const id = `${Date.now()}-${bridgeSeq}`;
  const base = path.join(dir, `req-${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(`${base}.json`, JSON.stringify({
    id,
    created_at: new Date().toISOString(),
    temperature: options.temperature ?? 0.65,
    max_tokens: options.maxTokens ?? 6000,
    messages,
  }, null, 2), 'utf8');
  console.info(`[AI bridge] 等待响应 ${base}.resp.json`);

  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    let raw: string | undefined;
    try {
      raw = await readFile(`${base}.resp.json`, 'utf8');
    } catch {
      raw = undefined;
    }
    if (raw) {
      const content = raw.trim();
      if (content.length === 0) continue;
      recentUsage.calls += 1;
      console.info(`[AI bridge] 收到响应 ${base}.resp.json (${content.length} chars)`);
      return parseJsonContent(content);
    }
    let errRaw: string | undefined;
    try {
      errRaw = await readFile(`${base}.error.json`, 'utf8');
    } catch {
      errRaw = undefined;
    }
    if (errRaw) throw new Error(`AI bridge 收到错误响应：${errRaw.slice(0, 500)}`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`AI bridge 等待响应超时（30 分钟）：${base}.json`);
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
