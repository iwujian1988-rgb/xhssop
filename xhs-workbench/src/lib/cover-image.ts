import { getImageTask, submitImageTask, type ImageTaskResult } from '@/lib/image-client';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';
import type { CompetitorCreativeCard, DenseDirectoryCoverPayload } from '@/types/reference-workflow';

export interface GenerateCoverImageOptions {
  maxAttempts?: number;
  pollIntervalMs?: number;
  maxPolls?: number;
}

export type CoverImageOutcome = { ok: true; url: string } | { ok: false; error: string };

export async function generateCoverImageWithRetry(
  card: CompetitorCreativeCard,
  cover: DenseDirectoryCoverPayload,
  options: GenerateCoverImageOptions = {},
): Promise<CoverImageOutcome> {
  const maxAttempts = options.maxAttempts ?? 2;
  const pollIntervalMs = options.pollIntervalMs ?? 4000;
  const maxPolls = options.maxPolls ?? 90;
  const prompt = buildReferenceImagePrompt(card, cover);

  let lastError = '文生图多次尝试后仍失败';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const task = await submitImageTask({
        prompt,
        negativePrompt: referenceImageNegativePrompt,
        aspectRatio: '3:4',
      });
      const result = await pollUntilDone(task.id, pollIntervalMs, maxPolls);
      if (result.status === 'completed' && result.url) return { ok: true, url: result.url };
      lastError = result.status === 'failed'
        ? (result.error?.message || '文生图任务失败')
        : '文生图轮询超时';
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : '文生图失败';
    }
    if (attempt < maxAttempts) await sleep(3000 * attempt);
  }
  return { ok: false, error: lastError };
}

async function pollUntilDone(taskId: string, intervalMs: number, maxPolls: number): Promise<ImageTaskResult> {
  for (let i = 0; i < maxPolls; i += 1) {
    await sleep(intervalMs);
    const task = await getImageTask(taskId);
    if (task.status === 'completed' || task.status === 'failed') return task;
  }
  return { id: taskId, status: 'failed', error: { message: '轮询超时（task 未在预期时间内完成）' } };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
