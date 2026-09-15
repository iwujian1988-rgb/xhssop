import type { AiUsageSummary } from './ai-client';

export interface ModelUsage {
  cached_tokens?: number;
  cache_reported_calls?: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  calls: number;
  unreported_calls: number;
}

export function mergeModelUsage(...maps: Array<Record<string, ModelUsage> | undefined>) {
  const result: Record<string, ModelUsage> = {};
  for (const map of maps) for (const [model, usage] of Object.entries(map || {})) {
    const row = result[model] ||= { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, unreported_calls: 0, cached_tokens: 0, cache_reported_calls: 0 };
    for (const key of Object.keys(row) as Array<keyof ModelUsage>) row[key] = (row[key] || 0) + (usage[key] || 0);
  }
  return result;
}

export function summarizeTokenUsage(values: Array<AiUsageSummary | undefined>) {
  const rows = values.filter((v): v is AiUsageSummary => Boolean(v));
  return {
    prompt_tokens: rows.reduce((sum, v) => sum + v.prompt_tokens, 0),
    completion_tokens: rows.reduce((sum, v) => sum + v.completion_tokens, 0),
    total_tokens: rows.reduce((sum, v) => sum + v.total_tokens, 0),
    calls: rows.reduce((sum, v) => sum + v.calls, 0),
    by_model: mergeModelUsage(...rows.map(v => v.by_model)),
  };
}

export const DEFAULT_MODEL_RATES = {
  'qwen3.8-max-0902': { input: '12', output: '36', cached: '' },
  'qwen3.8-flash': { input: '0.8', output: '2.7', cached: '' },
  // 阿里云百炼华北2（北京）标准价，元/百万 Token。
  'deepseek-v4-flash': { input: '1', output: '2', cached: '0.2' },
  'deepseek-flash': { input: '1', output: '2', cached: '0.2' },
};
// Verified 2026-09-10: https://help.aliyun.com/zh/model-studio/model-pricing (Beijing).
// Qwen 3.8 cache rates are console-only; never assume the generic 20% discount.
export function estimateTokenCost(usage: ModelUsage, input: string, output: string, cached = ''): number | null {
  if (!input.trim() || !output.trim()) return null;
  const rates = [Number(input), Number(output)];
  if (rates.some(rate => !Number.isFinite(rate) || rate < 0)) return null;
  const hit = Math.min(usage.prompt_tokens, Math.max(0, usage.cached_tokens || 0));
  const cacheRate = cached.trim() && Number.isFinite(Number(cached)) && Number(cached) >= 0 ? Number(cached) : rates[0];
  return ((usage.prompt_tokens - hit) * rates[0] + hit * cacheRate + usage.completion_tokens * rates[1]) / 1_000_000;
}
