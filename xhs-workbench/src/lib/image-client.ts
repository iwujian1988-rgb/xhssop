import fs from 'node:fs/promises';
import path from 'node:path';

export interface SubmitImageTaskInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  referenceImages?: string[];
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
  const validImages = images.filter(Boolean);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/v1/videos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt: input.negativePrompt?.trim()
          ? `${input.prompt}\n\n【硬性禁止】\n${input.negativePrompt.trim()}`
          : input.prompt,
        aspect_ratio: input.aspectRatio || '3:4',
        // 图生图参考图走 metadata.urls（官方文档：/v1/videos 复用视频接口，
        // 图片参数放 metadata；urls 为完整 data URL 或 http URL，最多 5 张；
        // 空/不传 = 文生图）。之前放顶层 images 字段是图生视频的参数位，
        // gpt-image-2 会报 "doc is missing key: /message/content/text" 上游错。
        ...(validImages.length ? { metadata: { urls: validImages } } : {}),
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.message}${'cause' in error && error.cause instanceof Error ? ` / ${error.cause.message}` : ''}`
      : String(error);
    throw new Error(`生图任务提交网络失败：${detail}`);
  }

  const body = await res.text();
  if (!res.ok) throw new Error(`生图任务提交失败：${res.status} ${body.slice(0, 500)}`);
  return JSON.parse(body) as ImageTaskResult;
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
      signal: AbortSignal.timeout(60000),
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
