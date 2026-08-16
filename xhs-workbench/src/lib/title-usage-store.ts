// 跨 batch 标题去重库。
// 模板参考 seed-usage-store.ts：writeQueue 串行写 + 临时文件 + rename 原子写。
// 存最近 1000 条，按 product_id 维度查询；可选按 seed_id 缩小范围。
//
// 两种指纹比对：
//   1. selectedTitles —— 历次选中的文字标题指纹（强约束：不允许重复）
//   2. allCandidates   —— 历次候选池里所有候选的指纹（软约束：score 扣分，不直接砍）
//
// fingerprint 实现：仅去标点 + 空格 + 转小写。
// 故意不剥"法语/B2/写作/模板/范文"等领域词——
// 历史版本曾用 titleMeaningKey 做指纹，但那个函数把领域词全剥掉，
// 导致"DELF B2 写作模板"和"DELF B2 口语模板"被误判为同义。

import fs from 'node:fs/promises';
import path from 'node:path';

import type { ProductId } from '@/types/data';

interface TitleUsageRecord {
  product_id: ProductId;
  seed_id: string;
  card_id: string;
  title: string;
  candidates: string[];
  cover_title: string;
  cover_subtitle?: string;
  // Phase 5 新增：跨 batch 选题文本相似度兜底。
  // 之前只有 selected_title / cover_title 指纹去重，但同样语义不同措辞的选题
  // 会绕过指纹检查（"DELF B2正式信开头"和"DELF B2正式信怎么开头"指纹不同）。
  // 现在把原始 topic 文本也存下来，composeDraft 入口能做 jaccard 相似度检查。
  topic?: string;
  // 本篇最终发布的 tag。用于统计近 7 天 tag 使用频率——身份大词（#DELFB2 等）
  // 篇篇都出现就是撞款，生成时把频率喂给 LLM 让它主动避开。
  tags?: string[];
  // 本篇全部内页标题。跨 job 内页标题去重用——"常见错误这样检查""写完之后
  // 这样复盘"这类通用收尾页标题 LLM 会反复写（batch_1786754651839 里分别
  // 出现 3 次），生成时喂回历史让它写贴本篇主题的具体标题。
  page_titles?: string[];
  // 本篇 caption 叙事骨架 id（failure_recovery 等 5 种）。喂回下一批：
  // pickNarrativeSkeleton 把近期已用 ≥2 次的骨架沉底。
  narrative_skeleton?: string;
  // caption 结尾一句（最后 40 字）。承接句写法跨 job 撞款检测用——
  // "我把它整理成了X资料的Y部分"句式曾在 11 篇模拟里出现 9 次。
  caption_ending?: string;
  fingerprint: string;
  used_at: string;
}

const STORE_PATH = path.resolve(process.cwd(), 'data/title-usage.json');
const MAX_RECORDS = 1000;
let writeQueue: Promise<void> = Promise.resolve();

export interface RecentTitleFingerprints {
  /** 历次被选中的文字标题指纹集合（强约束去重用） */
  selectedTitles: Set<string>;
  /** 历次候选池所有候选指纹集合（软约束：扣分但不砍） */
  allCandidates: Set<string>;
  /** 历次封面主标题指纹集合（强约束：跨 job 不允许同款 cover.title） */
  coverTitles: Set<string>;
  /** 历次封面副标题指纹集合（软约束：扣分，避免"别把能拿的分丢掉"反复用） */
  coverSubtitles: Set<string>;
  /** 历次 selected_title 的句式模板 → 出现次数（治"别再 X""X 直接扣分"等同质化） */
  selectedTitleTemplates: Map<string, number>;
  /** 历次 confirmed topic 文本（Phase 5：跨 batch 选题兜底） */
  recentTopics: string[];
  /** 近期已发布 tag → 使用次数（治"#DELFB2 篇篇都有"型 tag 撞款） */
  recentTagCounts: Map<string, number>;
  /** 近期已用内页标题指纹集合（治通用收尾页标题跨 job 逐字复读） */
  recentPageTitleFingerprints: Set<string>;
  /** 近期已用内页标题原文（喂 prompt 用，保留最近一批） */
  recentPageTitles: string[];
  /** 近期 caption 叙事骨架 id 列表（骨架轮换沉底用） */
  recentSkeletons: string[];
  /** 近期 caption 结尾一句（承接句写法去重用） */
  recentCaptionEndings: string[];
  /** 原始记录，调试/审计用 */
  records: TitleUsageRecord[];
}

export async function getRecentTitleFingerprints(
  productId: ProductId,
  options: { seedId?: string; days?: number } = {},
): Promise<RecentTitleFingerprints> {
  const records = await loadRecords();
  const cutoff = options.days
    ? Date.now() - options.days * 24 * 60 * 60 * 1000
    : -Infinity;
  const filtered = records.filter(record => {
    if (record.product_id !== productId) return false;
    if (options.seedId && record.seed_id !== options.seedId) return false;
    if (cutoff !== -Infinity && Date.parse(record.used_at) < cutoff) return false;
    return true;
  });
  const selectedTitles = new Set<string>();
  const allCandidates = new Set<string>();
  const coverTitles = new Set<string>();
  const coverSubtitles = new Set<string>();
  const selectedTitleTemplates = new Map<string, number>();
  const recentTopics: string[] = [];
  const recentTagCounts = new Map<string, number>();
  const recentPageTitleFingerprints = new Set<string>();
  const recentPageTitles: string[] = [];
  const recentSkeletons: string[] = [];
  const recentCaptionEndings: string[] = [];
  for (const record of filtered) {
    selectedTitles.add(record.fingerprint);
    if (record.cover_title) coverTitles.add(fingerprintTitle(record.cover_title));
    if (record.cover_subtitle) coverSubtitles.add(fingerprintTitle(record.cover_subtitle));
    if (record.topic) recentTopics.push(record.topic);
    if (record.narrative_skeleton) recentSkeletons.push(record.narrative_skeleton);
    if (record.caption_ending) recentCaptionEndings.push(record.caption_ending);
    for (const pageTitle of record.page_titles || []) {
      if (!pageTitle) continue;
      recentPageTitleFingerprints.add(fingerprintTitle(pageTitle));
      recentPageTitles.push(pageTitle);
    }
    // tag 计数移到主循环外（见下方）：只数最近 8 篇带 tag 的记录。
    // 模板指纹合并：selected_title / cover.title / cover.subtitle 都进同一个 map。
    // 这样"X 直接扣分"在 selected 出现 2 次后，cover.subtitle 再写"别把能拿的分丢掉"
    // 也会被同模板扣分（虽然指纹不同，但套路相同，整 batch 看着仍像复读机）。
    for (const text of [record.title, record.cover_title, record.cover_subtitle]) {
      if (!text) continue;
      const tpl = titleTemplateFingerprint(text);
      if (!tpl) continue;
      selectedTitleTemplates.set(tpl, (selectedTitleTemplates.get(tpl) || 0) + 1);
    }
    for (const candidate of record.candidates) {
      allCandidates.add(fingerprintTitle(candidate));
    }
  }
  // tag 频率窗口（2026-08-16）：只数最近 8 篇带 tag 的记录。旧版按 14 天全量
  // 计数，测试节奏（14 天 325 条）会把所有内容 tag 刷到 ≥3 封顶线，tag 被砍
  // 到只剩身份词；复读只对"读者连刷能看到的最近几篇"有意义。键统一剥 # 前缀
  // （旧版记录带 #、normalizeTags 查询不带 #，永远 miss，封顶从未生效过）。
  const taggedRecent = filtered
    .filter(record => (record.tags || []).length > 0)
    .sort((a, b) => Date.parse(b.used_at) - Date.parse(a.used_at))
    .slice(0, 8);
  for (const record of taggedRecent) {
    for (const tag of record.tags || []) {
      const bare = tag.replace(/^#+/, '');
      recentTagCounts.set(bare, (recentTagCounts.get(bare) || 0) + 1);
    }
  }
  return { selectedTitles, allCandidates, coverTitles, coverSubtitles, selectedTitleTemplates, recentTopics, recentTagCounts, recentPageTitleFingerprints, recentPageTitles, recentSkeletons, recentCaptionEndings, records: filtered };
}

export async function recordTitleUsage(input: {
  productId: ProductId;
  seedId: string;
  cardId: string;
  title: string;
  candidates: string[];
  coverTitle: string;
  coverSubtitle?: string;
  topic?: string;
  tags?: string[];
  pageTitles?: string[];
  narrativeSkeleton?: string;
  caption?: string;
}) {
  if (!input.title) return;
  const record: TitleUsageRecord = {
    product_id: input.productId,
    seed_id: input.seedId,
    card_id: input.cardId,
    title: input.title,
    candidates: Array.from(new Set(input.candidates.filter(Boolean))),
    cover_title: input.coverTitle || '',
    cover_subtitle: input.coverSubtitle || '',
    topic: input.topic || undefined,
    tags: input.tags?.filter(Boolean).length ? input.tags.filter(Boolean) : undefined,
    page_titles: input.pageTitles?.filter(Boolean).length ? input.pageTitles.filter(Boolean) : undefined,
    narrative_skeleton: input.narrativeSkeleton || undefined,
    caption_ending: input.caption ? input.caption.slice(-40) : undefined,
    fingerprint: fingerprintTitle(input.title),
    used_at: new Date().toISOString(),
  };
  writeQueue = writeQueue.then(async () => {
    const records = await loadRecords();
    const next = [...records, record].slice(-MAX_RECORDS);
    await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
    const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8');
    await fs.rename(tempPath, STORE_PATH);
  });
  await writeQueue;
}

export async function clearTitleUsage(productId?: ProductId, days?: number) {
  await writeQueue;
  const records = await loadRecords();
  const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : -Infinity;
  const next = records.filter(record => {
    if (productId && record.product_id !== productId) return true;
    if (cutoff !== -Infinity && Date.parse(record.used_at) >= cutoff) return true;
    return false;
  });
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), 'utf8');
  await fs.rename(tempPath, STORE_PATH);
}

// fingerprint：归一化标题用于跨 batch 比对。
// 故意保留所有领域词（法语/B2/写作/模板等），只去标点 + 空格 + 转小写。
// 这样"DELF B2 写作模板"和"DELF B2 口语模板"的指纹不同，不会被误判为重复。
export function fingerprintTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s，。；：、！？!?·《》「」“”"'（）()【】\[\]{}|/\\]/g, '')
    .trim();
}

// Phase 5：跨 batch 选题相似度检查。
// 用 token jaccard 相似度（粗粒度但够用）：token = 去标点后按 2-3 字滑窗切。
// 故意不用 semantic embedding——避免额外 LLM 调用，也不引入向量库依赖。
// 阈值 0.6 经验值：相同知识点不同措辞通常 ≤ 0.5；同主题换皮通常 ≥ 0.7。
const STOP_CHARS = /[\s，。；：、！？!?·《》「」“”"'（）()【】\[\]{}|/\\\-]/g;

export function tokenizeTopic(text: string): Set<string> {
  const cleaned = text.toLowerCase().replace(STOP_CHARS, '');
  const tokens = new Set<string>();
  // 2-3 字滑窗：覆盖中文为主、夹杂数字/英文的情况。
  for (let i = 0; i < cleaned.length - 1; i += 1) {
    tokens.add(cleaned.slice(i, i + 2));
    if (i < cleaned.length - 2) tokens.add(cleaned.slice(i, i + 3));
  }
  return tokens;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const tok of smaller) if (larger.has(tok)) intersect += 1;
  return intersect / (a.size + b.size - intersect);
}

export function findSimilarTopic(
  topic: string,
  recentTopics: readonly string[],
  threshold = 0.6,
): { similar: string; score: number } | null {
  if (!topic || recentTopics.length === 0) return null;
  const topicTokens = tokenizeTopic(topic);
  let best: { similar: string; score: number } | null = null;
  for (const recent of recentTopics) {
    if (!recent) continue;
    const score = jaccardSimilarity(topicTokens, tokenizeTopic(recent));
    if (score >= threshold && (!best || score > best.score)) {
      best = { similar: recent, score };
    }
  }
  return best;
}

// titleTemplateFingerprint：句式模板指纹。
// 只在标题命中"通用功能词套路"时返回非空字符串，否则返回 ''（不参与模板去重）。
// 按优先级返回**单个最显著的特征**——这样所有"别再 X"归 "别再"，所有"X 直接扣分"归 "直接扣分"。
//
//   "DELF B2写作别再按字母背主题词了" → "别再"
//   "B2写作别再凭感觉改，评分维度先看清" → "别再" ← 与上面撞
//   "DELF B2交卷前漏查，直接扣分" → "直接扣分"
//   "B2写作环境词块用错，直接扣分！" → "直接扣分" ← 与上面撞
//   "DELF B2教育词块大全，考前速查搭配" → ""（不参与模板去重）
//
// 21 条 hook 覆盖：
//   - selected_title 套路：别再 / 别硬背 / 直接扣分 / 用错 / 漏查 / 跑题 等
//   - cover.title 套路：词别硬背 / 先查这 / 老丢分 等
//   - cover.subtitle 套路：别把 X 丢掉 / 先 X 再 Y / 比 X 有用 / 才像 B2 等
const TEMPLATE_PRIORITY = [
  // 高优先级：动作 + 后果型（最容易被反复用的"加压式"套路）
  '直接扣分', '白练', '白丢', '白考', '白背', '白费',
  // 情绪/设问开头型（用户实测点名：救命/为什么/疑问句整批刷屏）
  '救命', '为什么', '停止', '先停',
  // 禁止命令型
  '别硬背', '别再', '别乱', '别硬', '别只', '别拿', '别把', '别瞎', '别平均',
  '词别乱用', '词别硬背', '句型别乱',
  // 用错/疏漏型
  '用错', '漏查', '跑题',
  // "先看 / 先查"导引型（cover.title/subtitle 高频）
  '先看清', '先看这', '先查这', '先看', '先查', '先练', '先判', '先找', '先排',
  // 结果导向型
  '怎么才像B2', '才像B2',
  // "丢分"型（cover.subtitle 高频）
  '丢分', '老丢', '拖后腿', '拖分', '差一点', '差在哪',
];

export function titleTemplateFingerprint(title: string): string {
  const stripped = title
    .replace(/DELF\s*B2|TEF\s*\/\s*TCF|TEF|TCF|CLB\s*7|Canada/gi, '')
    .replace(/[0-9]+/g, 'N');
  for (const feature of TEMPLATE_PRIORITY) {
    if (stripped.includes(feature)) return feature;
  }
  // 疑问句式兜底：不含上述功能词但带问号的（"XXX？YYY"格式）也归成同一
  // 模板，防止整批标题全是问句。
  if (/[？?]/.test(title)) return '疑问句式';
  return '';
}

async function loadRecords(): Promise<TitleUsageRecord[]> {
  const raw = await fs.readFile(STORE_PATH, 'utf8').catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return '[]';
    throw cause;
  });
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as TitleUsageRecord[] : [];
  } catch {
    return [];
  }
}
