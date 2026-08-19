import { getImageTask, loadReferenceImage, submitImageTask, type ImageTaskResult } from '@/lib/image-client';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';
import type { CompetitorCreativeCard, DenseDirectoryCoverPayload } from '@/types/reference-workflow';
import type { ProductId } from '@/types/data';

// 生图 API 是异步任务制：submit 拿到 task_id 的那一刻就已经扣款。
// 所以这里刻意把"提交"和"等待"拆成两个函数——调用方必须先把 task_id 持久化
// （batch job 落盘 / 前端 localStorage），再慢慢等终态。等待过程容忍网络抖动：
// 任何一次查询失败都不算任务失败，只有 completed / failed / 超过总预算才结束。
// 旧版 generateCoverImageWithRetry 的问题：一次网络抖动就整个 attempt 作废并
// 重新提交新任务 = 再扣一次款，旧任务就算 3 秒后成功也永远找不回来。

export interface CoverImageTaskHandle {
  taskId: string;
}

export async function submitCoverImageTask(
  card: CompetitorCreativeCard,
  cover: DenseDirectoryCoverPayload,
  productId: ProductId,
): Promise<CoverImageTaskHandle> {
  // 先把参考图真正读出来（缺文件会得到 null），再决定用哪种 prompt——
  // 图生图 prompt 声称"已附带参考图"，图没传上去时模型会被命令追随一张
  // 不存在的图（resource_16 缺文件时就是这个坑）。
  const referenceImage = card.reference_image ? await loadReferenceImage(card.reference_image) : null;
  const prompt = buildReferenceImagePrompt(card, cover, Boolean(referenceImage), productId);
  const task = await submitImageTask({
    prompt,
    negativePrompt: referenceImageNegativePrompt,
    aspectRatio: '3:4',
    referenceImages: referenceImage ? [referenceImage] : [],
  });
  if (!task.id) throw new Error('生图任务提交成功但接口没有返回 task_id');
  return { taskId: task.id };
}

export type CoverImageWaitResult =
  // 任务结束，拿到图片
  | { ok: true; url: string }
  // 供应商已判死（status=failed 或 completed 但无 url）：重新提交新任务不会白扣款
  | { ok: false; terminal: true; error: string }
  // 超时/持续查询失败：任务可能还活着，task_id 保留即可稍后恢复，不要重新提交
  | { ok: false; terminal: false; error: string };

const POLL_INTERVAL_MS = 4000;
// 生图模型是异步的：实测图生图任务可跑 5.5 分钟，预算留到 8 分钟。
const MAX_POLL_MS = 8 * 60 * 1000;
// 连续 8 次查询失败（约 32 秒完全不可达）才放弃；零星抖动只重试不判死。
const MAX_CONSECUTIVE_ERRORS = 8;

export async function waitForCoverImageTask(
  taskId: string,
  options: { startedAt?: number } = {},
): Promise<CoverImageWaitResult> {
  const deadline = (options.startedAt || Date.now()) + MAX_POLL_MS;
  let consecutiveErrors = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    if (Date.now() >= deadline) {
      return { ok: false, terminal: false, error: `生图任务 ${taskId} 超过8分钟未完成（任务可能仍在处理，凭 task_id 可恢复查询，不要重新提交）` };
    }
    let task: ImageTaskResult;
    try {
      task = await getImageTask(taskId);
      consecutiveErrors = 0;
    } catch (cause) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        return { ok: false, terminal: false, error: `生图任务 ${taskId} 连续${MAX_CONSECUTIVE_ERRORS}次查询失败：${detail}（任务可能仍在处理，凭 task_id 可恢复查询）` };
      }
      continue;
    }
    if (task.status === 'completed') {
      return task.url
        ? { ok: true, url: task.url }
        : { ok: false, terminal: true, error: `生图任务 ${taskId} 标记完成但没有返回图片 url` };
    }
    if (task.status === 'failed') {
      return { ok: false, terminal: true, error: task.error?.message || `生图任务 ${taskId} 失败` };
    }
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
