// CaptionParts：caption schema 重构的核心模块。
//
// 多模板架构：caption 走 3 种结构形态（list / story / contrast），按 seed hash 分发。
// 每种模板有自己的字段集合、拼装逻辑、prompt 约束、few-shot。
// 目的：让 15 篇笔记的 caption 结构上不一样，避免「读起来像同一篇」的机械感。

import type { ProductId } from '@/types/data';

// ============ 类型定义 ============

export type CaptionTemplate = 'list' | 'story' | 'contrast';

interface CaptionPartsBase {
  template: CaptionTemplate;
  hook: string;
  french_example: { fr: string; zh: string };
  cta: string;
}

export interface ListCaptionParts extends CaptionPartsBase {
  template: 'list';
  scenario: string;
  steps: string[];
}

export interface StoryCaptionParts extends CaptionPartsBase {
  template: 'story';
  story: string;
  takeaways: string[];
}

export interface ContrastCaptionParts extends CaptionPartsBase {
  template: 'contrast';
  wrong: string;
  right: string;
  transitions: string[];
}

export type CaptionParts = ListCaptionParts | StoryCaptionParts | ContrastCaptionParts;

// ============ Hash 工具 ============

export function stableHash(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// 按 seed 从数组里抽 n 个不同元素。用于 tag/样式分布。
export function pickBySeedN<T>(arr: T[], seed: string, n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const result: T[] = [];
  const used = new Set<number>();
  let h = stableHash(seed);
  while (result.length < n && used.size < arr.length) {
    h = stableHash(`${seed}-${h}`);
    const idx = h % arr.length;
    if (!used.has(idx)) {
      used.add(idx);
      result.push(arr[idx]);
    }
  }
  return result;
}

export function pickBySeed<T>(arr: T[], seed: string): T {
  return arr[stableHash(seed) % arr.length];
}

export function pickCaptionTemplate(seed: string): CaptionTemplate {
  const idx = stableHash(seed) % 3;
  return (['list', 'story', 'contrast'][idx]) as CaptionTemplate;
}

// ============ 拼装 ============

const LIST_STEP_STYLES: Array<(index: number) => string> = [
  (i) => `${i}. `,
  (i) => `${i}) `,
  () => '· ',
  () => '→ ',
];

export function assembleCaption(parts: CaptionParts, seed: string): string {
  switch (parts.template) {
    case 'list': return assembleList(parts, seed);
    case 'story': return assembleStory(parts);
    case 'contrast': return assembleContrast(parts);
  }
}

function assembleList(parts: ListCaptionParts, seed: string): string {
  const styleIdx = stableHash(`${seed}-list`) % LIST_STEP_STYLES.length;
  const prefix = LIST_STEP_STYLES[styleIdx];
  return [
    parts.hook,
    parts.scenario,
    ...parts.steps.map((step, i) => `${prefix(i + 1)}${step}`),
    `例：${parts.french_example.fr}`,
    `（${parts.french_example.zh}）`,
    parts.cta,
  ].join('\n');
}

function assembleStory(parts: StoryCaptionParts): string {
  return [
    parts.story,
    parts.hook,
    '整理出来这几点：',
    ...parts.takeaways.map(t => `→ ${t}`),
    `例：${parts.french_example.fr}`,
    `（${parts.french_example.zh}）`,
    parts.cta,
  ].join('\n');
}

function assembleContrast(parts: ContrastCaptionParts): string {
  return [
    parts.hook,
    `常见错误：${parts.wrong}`,
    `正确做法：${parts.right}`,
    '关键差别：',
    ...parts.transitions.map(t => `→ ${t}`),
    `例：${parts.french_example.fr}`,
    `（${parts.french_example.zh}）`,
    parts.cta,
  ].join('\n');
}

// ============ 兜底默认值（仅当 LLM 字段缺失时启用）============

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

const FALLBACK_STORIES = [
  '上次模考我卡在 50 分钟还没写完开头，后来发现是开头结尾的固定表达没背熟，临时拼凑反而耽误时间。',
  '考前一周我整理笔记才发现，之前练的题其实就那么几类，按文体分好之后复习效率直接翻倍。',
  '我自己写作文总是写到一半才发现跑题，后来用题干关键词反推文体，再没出过这种错。',
];

const FALLBACK_STORY_HOOKS = [
  '现在回头看，问题不在词汇量',
  '理清楚之后，效率真的不一样',
  '考前这样过一遍比硬刷题强',
];

const FALLBACK_TAKEAWAYS = [
  '先识别文体信号词',
  '固定 5 套开头结尾',
  '主题词按场景分组',
  '写前 30 秒列提纲',
];

const FALLBACK_WRONGS = [
  '看到题目直接写，没有先判断文体',
  '开头结尾临时拼，每篇都不一样',
  '主题词靠临场想，常常卡壳',
];

const FALLBACK_RIGHTS = [
  '先看题干关键词，30 秒判断文体再下笔',
  '固定 3-5 套开头结尾按场景套用',
  '考前按 5 大话题整理主题词，写时直接调用',
];

const FALLBACK_TRANSITIONS = [
  '看题干 signal word 比直接动笔快',
  '固定开头比临场拼节省 5 分钟',
  '主题词分组比硬背单词记得牢',
];

const FALLBACK_EXAMPLES: Array<{ fr: string; zh: string }> = [
  { fr: 'Je me permets de vous écrire pour...', zh: '我写信是想...' },
  { fr: 'Il est important de noter que...', zh: '需要注意的是...' },
  { fr: "À mon avis, nous devrions...", zh: '在我看来，我们应该...' },
];

// ============ Normalize（按模板分发）============

export function normalizeCaptionParts(
  raw: unknown,
  fallback: { productId: ProductId; cardId: string; topicId?: string; coverTitle: string },
): CaptionParts {
  const obj = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const seed = fallback.cardId || fallback.coverTitle || 'default';
  const templateSeed = fallback.topicId ? `${fallback.cardId}|${fallback.topicId}` : seed;
  const forcedTemplate = pickCaptionTemplate(templateSeed);

  // LLM 漏返/错返 template → 用 forced（不让 LLM 自由选，保证 3 模板均匀分布）。
  const rawTemplate = obj.template;
  const template: CaptionTemplate = (
    typeof rawTemplate === 'string'
    && ['list', 'story', 'contrast'].includes(rawTemplate)
  ) ? rawTemplate as CaptionTemplate : forcedTemplate;

  // 共通字段
  const hook = clampLength(asString(obj.hook), 8, 28)
    || clampLength(fallback.coverTitle, 8, 28)
    || pickBySeed(FALLBACK_STORY_HOOKS, seed);
  const french_example = normalizeExample(obj.french_example, seed);
  const cta = clampLength(asString(obj.cta), 4, 16)
    || pickBySeed(FALLBACK_CTAS, seed);

  switch (template) {
    case 'list':
      return {
        template: 'list',
        hook,
        scenario: clampLength(asString(obj.scenario), 16, 48) || pickBySeed(FALLBACK_SCENARIOS, seed),
        steps: normalizeSteps(obj.steps, seed, fallback.coverTitle),
        french_example,
        cta,
      };
    case 'story':
      return {
        template: 'story',
        hook: clampLength(asString(obj.hook), 8, 22) || pickBySeed(FALLBACK_STORY_HOOKS, seed),
        story: clampLength(asString(obj.story), 60, 120) || pickBySeed(FALLBACK_STORIES, seed),
        takeaways: normalizeItems(obj.takeaways, seed, FALLBACK_TAKEAWAYS, 2, 3, 8, 24),
        french_example,
        cta,
      };
    case 'contrast':
      return {
        template: 'contrast',
        hook: clampLength(asString(obj.hook), 8, 24) || pickBySeed(FALLBACK_STORY_HOOKS, seed),
        wrong: clampLength(asString(obj.wrong), 20, 50) || pickBySeed(FALLBACK_WRONGS, seed),
        right: clampLength(asString(obj.right), 20, 50) || pickBySeed(FALLBACK_RIGHTS, seed),
        transitions: normalizeItems(obj.transitions, seed, FALLBACK_TRANSITIONS, 2, 3, 6, 24),
        french_example,
        cta,
      };
  }
}

function normalizeExample(raw: unknown, seed: string): { fr: string; zh: string } {
  const exampleRaw = (raw && typeof raw === 'object')
    ? raw as Record<string, unknown>
    : {};
  const fr = clampLength(asString(exampleRaw.fr), 4, 80) || pickBySeed(FALLBACK_EXAMPLES, seed).fr;
  const zh = clampLength(asString(exampleRaw.zh), 4, 40) || pickBySeed(FALLBACK_EXAMPLES, seed).zh;
  return { fr, zh };
}

function normalizeSteps(raw: unknown, seed: string, coverTitle: string): string[] {
  return normalizeItems(raw, seed, FALLBACK_STEPS_EXTRA, 3, 5, 6, 36, coverTitle);
}

// list/stories/contrast 共用：3-5 项的步骤/要点数组归一化。
function normalizeItems(
  raw: unknown,
  seed: string,
  fallbackPool: string[],
  min: number,
  max: number,
  itemMin: number,
  itemMax: number,
  coverTitle?: string,
): string[] {
  const arr = Array.isArray(raw)
    ? raw.map(item => asString(item)).filter(Boolean).map(s => clampLength(s, itemMin, itemMax)).filter(Boolean)
    : [];
  if (arr.length >= min && arr.length <= max) return arr.slice(0, max);
  if (arr.length > max) return arr.slice(0, max);
  // 不够 min 项，补齐
  const base = arr.length > 0
    ? arr
    : [coverTitle?.slice(0, 24) || fallbackPool[0]];
  while (base.length < min) {
    const extra = fallbackPool[(stableHash(seed) + base.length) % fallbackPool.length];
    base.push(extra);
  }
  return base.slice(0, max);
}

// ============ 字符串工具 ============

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

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return (obj.text as string).trim();
  }
  return '';
}
