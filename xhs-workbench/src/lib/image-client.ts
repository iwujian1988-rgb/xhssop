import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export interface SubmitImageTaskInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  referenceImages?: string[];
  /** Stable key used to prevent accidental duplicate paid submissions. */
  idempotencyKey?: string;
}

export interface ImageTaskResult {
  id: string;
  object?: string;
  model?: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed' | string;
  progress?: number;
  created_at?: number;
  completed_at?: number;
  url?: string;
  error?: { message?: string; code?: string };
}

/**
 * The submit request may time out after the provider has already enqueued the
 * async task. This is deliberately distinct from a confirmed submission
 * failure so callers never retry and accidentally create a second paid task.
 */
export class ImageSubmissionUncertainError extends Error {
  readonly code = 'image_submission_uncertain' as const;
  readonly requestHash?: string;

  constructor(message: string, requestHash?: string) {
    super(message);
    this.name = 'ImageSubmissionUncertainError';
    this.requestHash = requestHash;
  }
}

export function buildImageRequestHash(input: {
  productId?: string;
  posterTitle?: string;
  prompt: string;
  referenceImageIds: string[];
}): string {
  return createHash('sha256').update(JSON.stringify({
    productId: input.productId || '',
    posterTitle: input.posterTitle || '',
    prompt: input.prompt,
    referenceImageIds: input.referenceImageIds,
  })).digest('hex');
}

async function writeSubmitAudit(entry: Record<string, unknown>): Promise<void> {
  try {
    const directory = path.resolve(process.cwd(), 'data', 'image-submit-audit');
    await fs.mkdir(directory, { recursive: true });
    await fs.appendFile(
      path.join(directory, `${new Date().toISOString().slice(0, 10)}.jsonl`),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      'utf8',
    );
  } catch (error) {
    console.warn('[image-client] 提交审计落盘失败：', error instanceof Error ? error.message : error);
  }
}

export async function submitImageTask(input: SubmitImageTaskInput): Promise<ImageTaskResult> {
  const apiKey = process.env.IMAGE_API_KEY;
  const baseUrl = (process.env.IMAGE_API_BASE_URL || 'https://zexapi.com').replace(/\/$/, '');
  const model = process.env.IMAGE_API_MODEL || 'gpt-image-2';

  if (!apiKey) throw new Error('缺少 IMAGE_API_KEY');
  if (!input.prompt.trim()) throw new Error('缺少生图提示词');

  // 单张参考图读失败（文件缺失/路径问题）不能炸掉整个提交——降级为不带该图，
  // 提交照常走。之前 Promise.all 里的 throw 会让 resource_16 这类缺图卡直接提交失败。
  const images = await Promise.all((input.referenceImages || []).slice(0, 4).map(async (value) => {
    try {
      return await toImageInput(value);
    } catch (error) {
      console.warn('[image-client] 参考图加载失败，已跳过：', value, error instanceof Error ? error.message : error);
      return null;
    }
  }));
  const validImages = images.filter((value): value is string => Boolean(value));
  const requestHash = input.idempotencyKey;
  const requestBody = {
    model,
    prompt: input.negativePrompt?.trim()
      ? `${input.prompt}\n\n【硬性禁止】\n${input.negativePrompt.trim()}`
      : input.prompt,
    aspect_ratio: input.aspectRatio || '3:4',
    // zexapi 文档规定图生图参考图是顶层 images 字段，不是 metadata.urls。
    ...(validImages.length ? { images: validImages } : {}),
  };
  const auditBase = {
    requestHash,
    url: `${baseUrl}/v1/videos`,
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: '[REDACTED]', ...(requestHash ? { 'idempotency-key': requestHash } : {}) },
    requestBody: { ...requestBody, images: validImages.map((value, index) => ({ index, kind: value.startsWith('data:') ? 'data_url' : 'url', length: value.length })) },
    timeoutMs: 5 * 60 * 1000,
  };
  await writeSubmitAudit({ type: 'submit_start', ...auditBase });

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(requestHash ? { 'Idempotency-Key': requestHash } : {}),
      },
      body: JSON.stringify(requestBody),
      // 上游是异步任务接口，但排队/返回 task_id 也可能超过 60 秒；
      // 不能在 task_id 返回前过早中断。拿到 task_id 后由 cover-image.ts
      // 单独负责最长 10 分钟的状态轮询。
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}${'cause' in error && error.cause instanceof Error ? ` / ${error.cause.message}` : ''}`
      : String(error);
    const timedOut = error instanceof Error && (
      error.name === 'AbortError'
      || error.name === 'TimeoutError'
      || /timeout|timed out|network timeout/i.test(detail)
    );
    if (timedOut) {
      await writeSubmitAudit({ type: 'submit_network_error', ...auditBase, errorType: error instanceof Error ? error.name : 'unknown', error: detail });
      throw new ImageSubmissionUncertainError(
        `生图提交响应超时：任务可能已经入队，请先在服务商任务列表核对，不要重复提交（${detail}）`,
        requestHash,
      );
    }
    await writeSubmitAudit({ type: 'submit_network_error', ...auditBase, errorType: error instanceof Error ? error.name : 'unknown', error: detail });
    throw new Error(`生图任务提交网络失败：${detail}`);
  }

  const body = await res.text();
  await writeSubmitAudit({
    type: 'submit_response',
    ...auditBase,
    response: { status: res.status, headers: Object.fromEntries(['x-request-id', 'x-trace-id', 'cf-ray', 'retry-after'].flatMap(name => res.headers.has(name) ? [[name, res.headers.get(name)]] : [])), rawBody: body.slice(0, 2000) },
  });
  if (!res.ok) {
    // 524/502/504 can be emitted by the proxy after the upstream accepted the
    // task. Treat them as uncertain, not as permission to submit again.
    if ([502, 504, 524].includes(res.status)) {
      throw new ImageSubmissionUncertainError(
        `生图提交网关超时（HTTP ${res.status}）：任务可能已经入队，请先在服务商任务列表核对，不要重复提交`,
        requestHash,
      );
    }
    throw new Error(`生图任务提交失败：${res.status} ${body.slice(0, 500)}`);
  }
  try {
    const parsed = JSON.parse(body) as ImageTaskResult;
    await writeSubmitAudit({ type: 'submit_parsed', requestHash, taskId: parsed.id || null, status: parsed.status || null });
    return parsed;
  } catch (error) {
    await writeSubmitAudit({ type: 'submit_parse_error', requestHash, errorType: error instanceof Error ? error.name : 'unknown', error: error instanceof Error ? error.message : String(error), rawBody: body.slice(0, 2000) });
    throw new Error(`生图任务回执解析失败：${body.slice(0, 500)}`);
  }
}

export async function getImageTask(taskId: string): Promise<ImageTaskResult> {
  const apiKey = process.env.IMAGE_API_KEY;
  const baseUrl = (process.env.IMAGE_API_BASE_URL || 'https://zexapi.com').replace(/\/$/, '');

  if (!apiKey) throw new Error('缺少 IMAGE_API_KEY');
  if (!/^task_[\w-]+$/.test(taskId)) throw new Error('task_id 格式不正确');

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      // 上游是异步任务接口，但排队/返回 task_id 也可能超过 60 秒；
      // 不能在 task_id 返回前过早中断。拿到 task_id 后由 cover-image.ts
      // 单独负责最长 10 分钟的状态轮询。
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}${'cause' in error && error.cause instanceof Error ? ` / ${error.cause.message}` : ''}`
      : String(error);
    throw new Error(`生图任务查询网络失败：${detail}`);
  }
  const body = await res.text();
  if (!res.ok) throw new Error(`生图任务查询失败：${res.status} ${body.slice(0, 500)}`);
  return JSON.parse(body) as ImageTaskResult;
}

// 给调用方在提交前判断"参考图到底能不能带上"用：读得出来返回 data URL / 原样
// http URL，读不出来返回 null（不 throw）。调用方据此决定用图生图 prompt 还是
// 文生图 prompt——两边必须同时定，只定一边就会出现"prompt 说有参考图但请求里
// 没有"或反过来。
export async function loadReferenceImage(value: string): Promise<string | null> {
  try {
    return await toImageInput(value);
  } catch (error) {
    console.warn('[image-client] 参考图加载失败，本任务按无参考图处理：', value, error instanceof Error ? error.message : error);
    return null;
  }
}

async function toImageInput(value: string): Promise<string> {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  if (!value.startsWith('/')) throw new Error(`参考图路径不支持：${value}`);

  const relative = value.replace(/^\/+/, '').replace(/\//g, path.sep);
  const publicRoot = path.resolve(process.cwd(), 'public');
  const filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(publicRoot + path.sep)) throw new Error('参考图路径越界');

  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg'
    ? 'image/jpeg'
    : ext === '.webp'
      ? 'image/webp'
      : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
