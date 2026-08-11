// CaptionParts：caption schema 重构的核心模块。
//
// 背景：之前 caption 是 LLM 自由生成的 280-420 字字符串，事后用正则洗，
//   永远洗不干净——LLM 训练分布就是 AI 味长文。
//
// 改造：LLM 只填 5 个结构化字段（hook/scenario/steps/french_example/cta），
//   我们用确定性代码拼成最终 caption。AI 套话空间被结构性消除。
//
// 拼装样式：4 种 step prefix（"1. " / "1) " / "· " / "→ "），用 seed 做
//   稳定 hash 选 1 种——保证同一 job 多次跑结果一致，不同 job 视觉差异。

import type { ProductId } from '@/types/data';

export interface CaptionParts {
  hook: string;
  scenario: string;
  steps: string[];
  french_example: { fr: string; zh: string };
  cta: string;
}

const STEP_STYLES: Array<(index: number) => string> = [
  (i) => `${i}. `,
  (i) => `${i}) `,
  () => '· ',
  () => '→ ',
];

function stableHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function clip(value: string, max: number): string {
  if (!value) return '';
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  return chars.slice(0, max).join('');
}

function clampLength(value: string, min: number, max: number): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length < min) return '';
  return clip(trimmed, max);
}

export function assembleCaption(parts: CaptionParts, seed: string): string {
  const styleIdx = stableHash(seed) % STEP_STYLES.length;
  const prefix = STEP_STYLES[styleIdx];
  return [
    parts.hook,
    parts.scenario,
    ...parts.steps.map((step, i) => `${prefix(i + 1)}${step}`),
    `例：${parts.french_example.fr}`,
    `（${parts.french_example.zh}）`,
    parts.cta,
  ].join('\n');
}

// 兜底默认值：按 seed hash 选不同套，避免 15 篇兜底都一样。
// 这些默认值仅当 LLM 字段缺失时启用，schema 跑稳后理论上不应该被命中。
const FALLBACK_SCENARIOS = [
  '考前一周集中整理，比平时零散积累管用',
  '上次写作文卡在表达，回头看其实是基础没分好类',
  '我自己练了几次才发现，按场景分组记得最牢',
  '考前翻笔记太花时间，把高频项直接列出来更省事',
];

const FALLBACK_CTAS = [
  '考前过一遍就行',
  '写之前先看一眼',
  '考前1周过一遍这些',
  '直接拿去用',
];

const FALLBACK_STEPS_EXTRA = [
  '先判断文体，再选开头结尾',
  '按场景分组记，比硬背强',
  '考前重点过一遍高频项',
];

const FALLBACK_EXAMPLES: Array<{ fr: string; zh: string }> = [
  { fr: 'Je me permets de vous écrire pour...', zh: '我写信是想...' },
  { fr: 'Il est important de noter que...', zh: '需要注意的是...' },
  { fr: "À mon avis, nous devrions...", zh: '在我看来，我们应该...' },
];

function pickBySeed<T>(arr: T[], seed: string): T {
  return arr[stableHash(seed) % arr.length];
}

export function normalizeCaptionParts(
  raw: unknown,
  fallback: { productId: ProductId; cardId: string; coverTitle: string },
): CaptionParts {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const seed = fallback.cardId || fallback.coverTitle || 'default';

  const hook = clampLength(asString(obj.hook), 8, 28)
    || clampLength(fallback.coverTitle, 8, 28)
    || 'DELF B2 写作备考要点';

  const scenario = clampLength(asString(obj.scenario), 16, 48)
    || pickBySeed(FALLBACK_SCENARIOS, seed);

  const steps = normalizeSteps(obj.steps, seed, fallback.coverTitle);

  const exampleRaw = (obj.french_example && typeof obj.french_example === 'object')
    ? obj.french_example as Record<string, unknown>
    : {};
  const fr = clampLength(asString(exampleRaw.fr), 4, 80) || pickBySeed(FALLBACK_EXAMPLES, seed).fr;
  const zh = clampLength(asString(exampleRaw.zh), 4, 40) || pickBySeed(FALLBACK_EXAMPLES, seed).zh;
  const french_example = { fr, zh };

  const cta = clampLength(asString(obj.cta), 4, 16)
    || pickBySeed(FALLBACK_CTAS, seed);

  return { hook, scenario, steps, french_example, cta };
}

function normalizeSteps(raw: unknown, seed: string, coverTitle: string): string[] {
  const arr = Array.isArray(raw) ? raw.map(item => asString(item)).filter(Boolean).map(s => clampLength(s, 6, 36)).filter(Boolean) : [];
  if (arr.length >= 3 && arr.length <= 6) return arr.slice(0, 5);
  if (arr.length > 5) return arr.slice(0, 5);
  // 不够 3 项，补齐到 3 项
  const base = arr.length > 0 ? arr : [coverTitle.slice(0, 24) || '按场景分组整理'];
  while (base.length < 3) {
    const extra = FALLBACK_STEPS_EXTRA[(stableHash(seed) + base.length) % FALLBACK_STEPS_EXTRA.length];
    base.push(extra);
  }
  return base.slice(0, 5);
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return (obj.text as string).trim();
  }
  return '';
}
