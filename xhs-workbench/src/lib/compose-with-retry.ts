import {
  type AiUsageSummary,
  getRecentAiUsage,
  resetRecentAiUsage,
} from '@/lib/ai-client';
import {
  type ComposeDraftInput,
  type ComposeFailureStage,
  classifyComposeError,
  composeDraft,
  isRetryableComposeError,
} from '@/lib/reference-compose';
import type { ReferenceDrivenDraft } from '@/types/reference-workflow';

export type { ComposeFailureStage } from '@/lib/reference-compose';

export interface ComposeFailure {
  stage: ComposeFailureStage;
  message: string;
  attempts: number;
  usage: AiUsageSummary;
}

export type ComposeOutcome =
  | { ok: true; draft: ReferenceDrivenDraft; attempts: number; usage: AiUsageSummary }
  | { ok: false; failure: ComposeFailure };

const EMPTY_USAGE: AiUsageSummary = {
  prompt_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
  calls: 0,
  autofix_count: 0,
  autofix_events: [],
};

function addUsage(a: AiUsageSummary, b: AiUsageSummary): AiUsageSummary {
  return {
    prompt_tokens: a.prompt_tokens + b.prompt_tokens,
    completion_tokens: a.completion_tokens + b.completion_tokens,
    total_tokens: a.total_tokens + b.total_tokens,
    calls: a.calls + b.calls,
    autofix_count: a.autofix_count + b.autofix_count,
    autofix_events: [...a.autofix_events, ...b.autofix_events],
  };
}

export async function composeWithRetry(
  input: ComposeDraftInput,
  options: { maxAttempts?: number } = {},
): Promise<ComposeOutcome> {
  const maxAttempts = options.maxAttempts ?? 3;
  let totalUsage: AiUsageSummary = { ...EMPTY_USAGE };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    resetRecentAiUsage();
    try {
      const draft = await composeDraft(input);
      const usage = getRecentAiUsage();
      totalUsage = addUsage(totalUsage, usage);
      return { ok: true, draft, attempts: attempt, usage: totalUsage };
    } catch (cause) {
      const usage = getRecentAiUsage();
      totalUsage = addUsage(totalUsage, usage);
      lastError = cause instanceof Error ? cause : new Error('compose 失败');
      if (!isRetryableComposeError(lastError)) break;
    }
  }

  return {
    ok: false,
    failure: {
      stage: classifyComposeError(lastError),
      message: lastError?.message || 'compose 失败',
      attempts: maxAttempts,
      usage: totalUsage,
    },
  };
}
