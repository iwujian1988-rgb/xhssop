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

  const images = await Promise.all((input.referenceImages || []).slice(0, 4).map(toImageInput));
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
        ...(validImages.length ? { images: validImages } : {}),
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
