// Viral note corpus loader
// 爆款笔记语料库 - 用于让 LLM 模仿真实爆款笔记的标题/正文节奏
import fs from 'node:fs';
import path from 'node:path';
import type { ProductId } from '@/types/data';

export interface ViralNote {
  id: string;
  track: string;             // 来源赛道（delf_b2_writing / ielts / kaoyan / jp_jlpt ...）
  title: string;             // 完整标题（用于标题模仿）
  caption_opening: string;   // 正文开头 60 字（用于正文节奏模仿）
  opening_usable: boolean;   // opening 是否可用（非 hashtag 堆砌）
  cover_type: string;        // 推断的封面类型
  collected: number;         // 收藏数（质量信号）
  liked: number;             // 点赞数
  user: string;              // 作者昵称
}

/**
 * 模仿阶段标识。区分"首次生成"和"返修"——返修阶段会换 prompt 思路
 * （从"学节奏"改成"整段重写、不要小修小补"），并且 pick 时用带 -repair-N
 * 后缀的 seed，让 LLM 看到不同的爆款，避免被首次的版本 anchor 住。
 */
export type ImitationStage =
  | 'first_core'        // 首次生成 brief / 标题候选 / 封面
  | 'first_editorial'   // 首次生成正文 / 内页
  | 'repair_editorial'  // 正文返修
  | 'repair_core'       // 标题/封面返修
  | 'repair_title';     // 标题二次返修（polish 阶段）

// __dirname 在 Next.js bundle 后会变成 D:\ROOT\... 这种路径，
// 必须用 process.cwd() 锚定项目根目录。corpus 文件固定在
// <project>/src/lib/viral-corpus/notes.json。
const CORPUS_PATH = path.join(process.cwd(), 'src', 'lib', 'viral-corpus', 'notes.json');

let cached: ViralNote[] | null = null;

export function loadViralCorpus(): ViralNote[] {
  if (cached) return cached;
  const txt = fs.readFileSync(CORPUS_PATH, 'utf8');
  cached = JSON.parse(txt);
  return cached!;
}

// 随机选 2 篇语料给 LLM 模仿（按 cover_type 过滤更精准）
export function pickImitationRefs(opts?: {
  cover_type?: string;
  prefer_track?: string;
  count?: number;
  seed?: string;
}): ViralNote[] {
  const corpus = loadViralCorpus();
  const count = opts?.count ?? 2;
  let pool = corpus;

  // 优先选 opening_usable 的
  const usable = pool.filter(n => n.opening_usable);
  if (usable.length >= count) pool = usable;

  // 按 track 过滤（优先同赛道，但保留多样性）
  if (opts?.prefer_track) {
    const sameTrack = pool.filter(n => n.track === opts.prefer_track);
    const otherTrack = pool.filter(n => n.track !== opts.prefer_track);
    // 一半同赛道一半跨赛道（保证多样性）
    if (sameTrack.length >= Math.ceil(count / 2)) {
      const half = Math.ceil(count / 2);
      const picked = [
        ...pickRandom(sameTrack, half, opts?.seed),
        ...pickRandom(otherTrack, count - half, opts?.seed + '-other'),
      ];
      return picked;
    }
  }

  return pickRandom(pool, count, opts?.seed);
}

function pickRandom<T>(arr: T[], n: number, seed?: string): T[] {
  if (arr.length <= n) return [...arr];
  if (seed) {
    // 用 seed 做确定性采样，保证可复现
    const indices = stableHashSample(arr.length, n, seed);
    return indices.map(i => arr[i]);
  }
  // 真随机
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function stableHashSample(max: number, n: number, seed: string): number[] {
  const picked = new Set<number>();
  let i = 0;
  while (picked.size < n && picked.size < max) {
    const h = hashStr(seed + '-' + i);
    picked.add(h % max);
    i++;
  }
  return Array.from(picked);
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * 按 stage 挑爆款参考。stage 决定 seed 后缀（首次无后缀；返修加 -repair-N），
 * 这样同一个 job 在首次和返修时拿到不同的爆款，避免 LLM 被首次的版本锚定。
 *
 * prefer_track：商品1 → delf_b2_writing，商品2 → tef_tcf_canada。
 * 两个赛道 corpus 都已有 30+ 条真实爆款，优先同赛道采样（保留 1 篇跨赛道做
 * 节奏多样性）。商品2 corpus 来源：XHS 实时 top 25（上岸经验/EE政策）+
 * 学法语的艾拉 12 条（TCF CA T1-T9 分科技巧）。
 */
export function pickImitationRefsForStage(
  stage: ImitationStage,
  opts: { productId: ProductId; cardId: string; topicId: string; attempt?: number },
): ViralNote[] {
  const preferTrack = opts.productId === 'delf_b2_writing'
    ? 'delf_b2_writing'
    : opts.productId === 'tef_tcf_canada'
      ? 'tef_tcf_canada'
      : undefined;
  const attemptSuffix = opts.attempt ? `-${opts.attempt}` : '';
  const seed = `${opts.cardId}|${opts.topicId}|${stage}${attemptSuffix}`;
  return pickImitationRefs({ prefer_track: preferTrack, count: 2, seed });
}

/**
 * 把"模仿爆款"的 prompt 片段统一抽出来。所有调用 LLM 的地方都用这个，
 * 避免首次/返修接入不一致——之前返修函数完全漏接 viral_references 就是
 * 因为这逻辑是手动拼的。
 *
 * stage 决定 prompt 措辞：首次是"学节奏"，返修是"整段重写、不要议论文味"。
 * 返回的文本应该塞进 system prompt，配合 user payload 里的 viral_references 字段。
 */
export function buildImitationPromptText(stage: ImitationStage): string {
  switch (stage) {
    case 'first_core':
      return '用户消息里 viral_references 是 2 篇真实爆款笔记。学标题的钩子结构（反差/数字/痛点前置/具体场景）和正文开头的节奏（第一人称、具体时间地点、真实自嘲），但必须用本选题的 DELF/法语内容，不要照抄爆款的具体话题。';
    case 'first_editorial':
      return '用户消息里 viral_references 给了 2 篇真实爆款笔记的正文开头。学的是节奏：开头用第一人称 + 具体场景（参考 viral_references 里 2 篇爆款 caption_opening 的实际起法，不要用固定套话），自然带出痛点，不要写硬前缀（"DELF B2 备考时，"）。注意：爆款可能讲其他考试（雅思/考研/JLPT），不要抄它们的具体内容，只学开头的句子节奏。每篇爆款的开头都不一样，你也不要用同一个开头模板。';
    case 'repair_editorial':
      return [
        '【返修重写指令】你刚才的版本被检测出 AI 议论文味。',
        '请参考 viral_references 的真实爆款节奏，整段重写——不要在原版上小修小补：',
        '1. 开头第一句用第一人称 + 具体场景（仔细看 viral_references 里 2 篇爆款的 caption_opening 字段是怎么起句的，学它们的节奏，不要套用任何固定开头模板，也不要照抄爆款原话）',
        '2. 句子要短、要松，不要写"不是X而是Y""问题出在""关键在于"这种议论文句式',
        '3. 不要做总结段（"综上所述""首先...其次...最后"），写完最后一个具体内容就结束',
        '4. 用本选题的 DELF/法语内容，不要抄爆款的具体话题',
      ].join('\n');
    case 'repair_core':
      return [
        '【返修重写指令】你刚才的标题/封面被检测出问题。',
        '请参考 viral_references 的真实爆款标题钩子，整组重写——不要在原版上小修小补：',
        '1. 标题学爆款的具体场景/反差/数字钩子结构，但用本选题 DELF 内容',
        '2. 不要写"资料大全""全面解析"这种平淡说明书标题',
        '3. 封面标题要让用户一眼觉得和自己有关，再给资料感或结果感',
      ].join('\n');
    case 'repair_title':
      return [
        '【返修重写指令】上一次标题太平或错配。',
        '请参考 viral_references 明显加大冲突、损失、反常识或资料稀缺感，但保持和内容一致：',
        '1. 标题学爆款的具体起法（如"DELF 格式分老丢的人先看"），不要写"DELF B2 写作技巧大全"',
        '2. 14-20 字最佳，允许搜索词和爆款钩子结合',
      ].join('\n');
  }
}
