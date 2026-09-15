import { jsonrepair } from 'jsonrepair';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mergeModelUsage, type ModelUsage } from './token-usage';

export interface AiMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AiCallOptions {
  /** Preserve a native Skill's Markdown response without JSON repair. */
  responseMode?: 'json' | 'text';
  model?: string;
  stage?: string;
  maxTokens?: number;
  retries?: number;
  temperature?: number;
  thinking?: boolean;
  onResponseTrace?: (trace: AiResponseTrace) => void | Promise<void>;
}

export interface AiRequestContext { jobId?: string }
let aiRequestContext: AiRequestContext = {};
export function setAiRequestContext(context: AiRequestContext = {}) { aiRequestContext = context; }

export interface AiResponseTrace {
  requestId: string;
  model: string;
  messages: AiMessage[];
  temperature: number;
  maxTokens: number;
  retries: number;
  providerRawContent: string;
  parsedJson: unknown;
}

export interface AiUsageSummary {
  /** Provider-reported text usage, grouped by the requested model. */
  by_model?: Record<string, ModelUsage>;
  stage_calls?: Record<string, number>;
  technical_retries?: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  autofix_count: number;
  autofix_events: string[];
}

export interface AiResult<T> {
  data: T;
  usage: AiUsageSummary;
  requestId: string;
}

export function emptyAiUsage(): AiUsageSummary {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
}

export function mergeAiUsage(...values: AiUsageSummary[]): AiUsageSummary {
  return values.reduce<AiUsageSummary>((sum, value) => ({
    by_model: mergeModelUsage(sum.by_model, value.by_model),
    stage_calls: Object.fromEntries(Array.from(new Set([...Object.keys(sum.stage_calls || {}), ...Object.keys(value.stage_calls || {})]))
      .map(key => [key, (sum.stage_calls?.[key] || 0) + (value.stage_calls?.[key] || 0)])),
    technical_retries: (sum.technical_retries || 0) + (value.technical_retries || 0),
    prompt_tokens: sum.prompt_tokens + value.prompt_tokens,
    completion_tokens: sum.completion_tokens + value.completion_tokens,
    total_tokens: sum.total_tokens + value.total_tokens,
    calls: sum.calls + value.calls,
    autofix_count: sum.autofix_count + value.autofix_count,
    autofix_events: [...sum.autofix_events, ...value.autofix_events],
  }), emptyAiUsage());
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
  const result = await callOpenAICompatibleJsonWithUsage<unknown>(messages, options);
  recentUsage = mergeAiUsage(recentUsage, result.usage);
  return result.data;
}

export async function callOpenAICompatibleJsonWithUsage<T>(messages: AiMessage[], options: AiCallOptions = {}): Promise<AiResult<T>> {
  const effectiveMessages = options.responseMode === 'text' ? messages : ensureJsonContract(messages);
  // 桥接模式：AI_BRIDGE_DIR 指定时完全不碰远程 API（不消耗用户 token），
  // 把每次调用的完整 prompt 落盘，等待同目录下出现对应 .resp 文件后返回。
  // 用于让真实管线/真实 prompt/真实闸门在"外部模型"（Claude 子代理）驱动下
  // 端到端跑通。响应文件内容为纯文本（JSON 字符串），走同一个 parseJsonContent。
  if (process.env.AI_BRIDGE_DIR) {
    return callBridgeJson<T>(process.env.AI_BRIDGE_DIR, effectiveMessages, options);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = options.model || process.env.OPENAI_MODEL || 'deepseek-flash';
  const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const isQwenProvider = /^qwen/i.test(model) || /(?:dashscope|maas\.aliyuncs\.com)/i.test(baseUrl);

  if (!apiKey) {
    throw new Error('缺少 OPENAI_API_KEY。请复制 .env.example 为 .env.local 并填入 key。');
  }

  let lastError: Error | null = null;
  const retries = Math.max(1, Math.min(2, options.retries ?? 2));
  let usage = emptyAiUsage();
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    usage.calls += 1;
    usage.by_model = mergeModelUsage(usage.by_model, { [model]: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 1, unreported_calls: 1 } });
    usage.stage_calls = { [options.stage || 'legacy']: attempt };
    usage.technical_retries = attempt - 1;
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
          messages: effectiveMessages,
          temperature: options.temperature ?? 0.65,
          max_tokens: options.maxTokens ?? 6000,
          ...(isQwenProvider
            ? { enable_thinking: options.thinking === true }
            : { thinking: { type: options.thinking === true ? 'enabled' : 'disabled' } }),
          ...(options.responseMode === 'text' ? {} : { response_format: { type: 'json_object' } }),
        }),
        // 300s：compose 是非流式 maxTokens 5000-6000 的长生成，服务端拥堵时
        // 100-200s 很常见，120s 会把正常慢请求错杀成 timeout（实测 batch_1786721806516
        // job_007 连续两次全 attempts 超时）。仍保留上限防半挂 fetch 锁死 runner。
        signal: AbortSignal.timeout(300000),
      });

      if (!res.ok) {
        const body = await res.text();
        const failureRequestId = String(res.headers.get('x-request-id') || `local-failure-${Date.now()}-${attempt}`);
        try {
          const failureDir = path.join(process.cwd(), 'data', 'ai-failure-traces');
          await mkdir(failureDir, { recursive: true });
          await writeFile(path.join(failureDir, `${failureRequestId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`), JSON.stringify({
            jobId: aiRequestContext.jobId, stage: options.stage || 'legacy',
            callPurpose: options.stage?.includes('missing') ? 'missing_slot' : options.stage === 'targeted_repair' ? 'qa_repair' : options.stage?.includes('repair') ? 'repair' : 'main',
            model, provider: baseUrl, requestId: failureRequestId,
            response_format: options.responseMode === 'text' ? undefined : { type: 'json_object' },
            promptContainsJson: effectiveMessages.some(message => /json/i.test(message.content)), messages: effectiveMessages,
            error: { status: res.status, body: body.slice(0, 2000) },
          }, null, 2), 'utf8');
        } catch (traceError) { console.warn('[AI failure trace skipped]', traceError instanceof Error ? traceError.message : String(traceError)); }
        const error = new Error(`AI API 请求失败：${res.status} ${body.slice(0, 500)}`);
        if (res.status < 500) throw error;
        lastError = error;
        continue;
      }

      const json = await res.json();
      const reported = usageFromResponse(json?.usage);
      const modelRow = usage.by_model![model];
      modelRow.prompt_tokens += reported.prompt_tokens;
      modelRow.completion_tokens += reported.completion_tokens;
      modelRow.total_tokens += reported.total_tokens;
      const cachedTokens = json?.usage?.prompt_tokens_details?.cached_tokens ?? json?.usage?.cached_tokens;
      if (Number.isFinite(cachedTokens) && cachedTokens >= 0) {
        modelRow.cached_tokens = (modelRow.cached_tokens || 0) + Math.min(reported.prompt_tokens, cachedTokens);
        modelRow.cache_reported_calls = (modelRow.cache_reported_calls || 0) + 1;
      }
      if (Number.isFinite(json?.usage?.prompt_tokens) && Number.isFinite(json?.usage?.completion_tokens)) modelRow.unreported_calls -= 1;
      usage = mergeAiUsage(usage, { ...reported, calls: 0 });
      console.info('[AI usage]', JSON.stringify({ model, stage: options.stage || 'legacy', attempt, ...usage }));
      if (json?.choices?.[0]?.finish_reason === 'length') {
        lastError = new Error('AI_RESPONSE_TRUNCATED:provider token limit; do not accept a repaired partial JSON');
        continue;
      }
      const content = json?.choices?.[0]?.message?.content;
      if (!content) {
        const finishReason = json?.choices?.[0]?.finish_reason || 'unknown';
        const reasoningLength = json?.choices?.[0]?.message?.reasoning_content?.length || 0;
        lastError = new Error(`AI API 没有返回内容（finish_reason=${finishReason}, reasoning_length=${reasoningLength}）`);
        continue;
      }
      const requestId = String(res.headers.get('x-request-id') || json?.id || `local-${Date.now()}`);
      const parsedJson = options.responseMode === 'text' ? content : parseJsonContent(content, Boolean(options.stage));
      try {
        await options.onResponseTrace?.({
          requestId,
          model,
          messages: effectiveMessages,
          temperature: options.temperature ?? 0.65,
          maxTokens: options.maxTokens ?? 6000,
          retries,
          providerRawContent: content,
          parsedJson,
        });
      } catch (traceError) {
        console.warn('[AI response trace skipped]', traceError instanceof Error ? traceError.message : String(traceError));
      }
      return {
        data: parsedJson as T,
        usage,
        requestId,
      };
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error('AI调用失败');
      if (/请求失败：4\d\d/.test(lastError.message)) throw Object.assign(lastError, { usage });
    }
  }
  throw Object.assign(lastError || new Error('AI调用失败'), { usage });
}

function ensureJsonContract(messages: AiMessage[]): AiMessage[] {
  const contract = 'Return only a valid json object.';
  const systemIndex = messages.findIndex(message => message.role === 'system');
  if (systemIndex < 0 || messages.some(message => /return only a valid json object/i.test(message.content))) return messages;
  return messages.map((message, index) => index === systemIndex
    ? { ...message, content: `${message.content}\n${contract}` }
    : message);
}

let bridgeSeq = 0;

async function callBridgeJson<T>(dir: string, messages: AiMessage[], options: AiCallOptions): Promise<AiResult<T>> {
  bridgeSeq += 1;
  const id = `${Date.now()}-${bridgeSeq}`;
  const base = path.join(dir, `req-${id}`);
  await mkdir(dir, { recursive: true });
  await writeFile(`${base}.json`, JSON.stringify({
    id,
    created_at: new Date().toISOString(),
    model: options.model || process.env.OPENAI_MODEL,
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
      console.info(`[AI bridge] 收到响应 ${base}.resp.json (${content.length} chars)`);
      const parsedJson = options.responseMode === 'text' ? content : parseJsonContent(content);
      try {
        await options.onResponseTrace?.({
          requestId: id,
          model: options.model || process.env.OPENAI_MODEL || 'bridge',
          messages,
          temperature: options.temperature ?? 0.65,
          maxTokens: options.maxTokens ?? 6000,
          retries: options.retries ?? 2,
          providerRawContent: content,
          parsedJson,
        });
      } catch (traceError) {
        console.warn('[AI response trace skipped]', traceError instanceof Error ? traceError.message : String(traceError));
      }
      return { data: parsedJson as T, usage: { ...emptyAiUsage(), calls: 1 }, requestId: id };
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

function usageFromResponse(value: unknown): AiUsageSummary {
  const usage = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    prompt_tokens: Number(usage.prompt_tokens) || 0,
    completion_tokens: Number(usage.completion_tokens) || 0,
    total_tokens: Number(usage.total_tokens) || 0,
    calls: 1,
    autofix_count: 0,
    autofix_events: [],
  };
}

function parseWithoutDuplicateKeys(text: string): unknown {
  const value: unknown = JSON.parse(text);
  const scopes: Array<Set<string> | null> = [];
  const tokens = /"(?:\\.|[^"\\])*"|[{}\[\]]/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (token === '{') scopes.push(new Set());
    else if (token === '[') scopes.push(null);
    else if (token === '}' || token === ']') scopes.pop();
    else if (/^\s*:/.test(text.slice(match.index! + token.length))) {
      const keys = scopes.at(-1);
      const key: string = JSON.parse(token);
      if (keys?.has(key)) throw new Error(`AI_JSON_DUPLICATE_KEY:${key}`);
      keys?.add(key);
    }
  }
  return value;
}

function parseJsonContent(content: string, strict = false) {
  const unwrapped = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return unwrapJsonPayload(parseWithoutDuplicateKeys(unwrapped));
  } catch (originalError) {
    if (strict) throw originalError;
    try {
      return unwrapJsonPayload(parseWithoutDuplicateKeys(jsonrepair(unwrapped)));
    } catch {
      const detail = originalError instanceof Error ? originalError.message : '未知JSON错误';
      throw new Error(`AI返回的JSON无法修复：${detail}`);
    }
  }
}

function unwrapJsonPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const directContent = record.content;
  if (typeof directContent === 'string' && !record.brief && !record.cover && !record.title_candidates) {
    return parseJsonContent(directContent);
  }
  const choiceContent = (record.choices as any)?.[0]?.message?.content;
  if (typeof choiceContent === 'string' && !record.brief && !record.cover && !record.title_candidates) {
    return parseJsonContent(choiceContent);
  }
  return value;
}
