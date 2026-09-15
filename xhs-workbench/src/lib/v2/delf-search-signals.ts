/**
 * 话题池来自用户于 2026-08-31 从小红书创作服务平台复制的 12 组下拉结果。
 * 原始数据：data/xhs-tag-research/2026-08-31-creator-suggestions.json。
 * 只保留实测存在、并与 DELF B2 写作相关的标签。
 */
type TagCandidate = { tag: string; views: number };
import realPool from '../../../data/xhs-tag-research/2026-08-31-creator-suggestions.json';
import type { ContentPackage } from './contracts';
import { currentNoteBoundary } from './note-fact-boundary';

export function tagSemanticFamily(tag: string): string {
  const normalized = tag.toLowerCase().replace(/模版/g, '模板');
  if (/模板/.test(normalized)) return '模板';
  if (/(?:写作|作文)素材|素材积累/.test(normalized)) return '写作素材';
  if (/词汇积累/.test(normalized)) return '词汇积累';
  return normalized;
}

/** All candidates come from the recorded creator suggestions, never generated tag names. */
export function selectReviewedDelfTags(finalPublicTopic: string, content: Pick<ContentPackage, 'innerPages' | 'tagMaterial' | 'autoFactBrief'>, recent = new Map<string, number>()) {
  const primary = currentNoteBoundary(content)?.noteCore || finalPublicTopic;
  const material = content.tagMaterial.join(' ');
  const letterPattern = /正式信|信函|写信|书信|lettre formelle/i;
  const multiGenre = (/议论文|论坛/.test(primary) && letterPattern.test(primary))
    || (/文体|题型/.test(primary) && /对照|区别|不同|各自|三种|多种/.test(primary));
  const letter = letterPattern.test(primary) && !multiGenre;
  const lexical = /词汇|替换|改写|Before.{0,4}After/i.test(finalPublicTopic) && !letter;
  const argument = /论据|论点|议题|观点|论证/.test(primary) && !letter && !lexical;
  const contexts = [
    { on: letter, tag: /信件|信函|邮件|礼貌|建议信/, query: /DELFB2|句型|表达|写作/ },
    { on: argument, tag: /观点|素材/, query: /作文|写作|表达/ },
    { on: lexical, tag: /替换|辨析|区别|词汇积累|词汇搭配/, query: /词汇|表达|写作/ },
    { on: /句型|句式/.test(primary) && !lexical, tag: /写作句型|实用句型|常用句型/, query: /句型|写作/ },
    { on: /模板|开场|结尾/.test(primary) && !lexical && !argument, tag: /作文模板|写作模板|写作模版/, query: /作文|写作/ },
  ];
  const candidates = realPool.groups.flatMap(group => group.suggestions.flatMap(item => {
    const tag = item.tag;
    if (!isStrictDelfWritingTag(tag)) return [];
    const matches = contexts.filter(c => c.on && c.tag.test(tag));
    const identity = /^(?:#DELFB2写作|#delfb2作文|#法语b2写作|#法语DELFB2写作|#法语写作|#法语作文)$/i.test(tag);
    const support = /^#法语(?:写作|作文)(?:素材|积累|训练|练习|表达)$/.test(tag);
    const direction = matches.some(c => c.query.test(group.query));
    const bare = tag.replace(/^#/, '');
    // Relevance dominates query, which dominates popularity. AI keywords only break close ties.
    const specific = (letter && /信件|信函|建议信/.test(tag)) || (argument && /观点/.test(tag)) || (lexical && /替换|辨析|区别/.test(tag));
    const score = (matches.length ? 100 + Math.min(matches.length, 2) * 10 : identity ? 55 : 40) + (specific ? 25 : 0)
      + (direction ? 8 : 0) + (material.includes(bare) ? 1 : 0)
      + Math.log10(1 + item.views) / 10 - item.rank / 1000 - Math.min(recent.get(tag) || 0, 5) * 0.7;
    return [{ tag, source: 'data/xhs-tag-research/2026-08-31-creator-suggestions.json', sourceQuery: group.query, rank: item.rank, views: item.views, tag_id: item.tag_id, score, identity }];
  })).sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
  const selectedTags = new Set<string>();
  const identity = realPool.groups.flatMap(group => group.suggestions.flatMap(item => {
    if (!isDelfIdentityTag(item.tag)) return [];
    return [toHotEvidence(item, group.query, stableTagRank(`${finalPublicTopic}|identity|${item.tag}`))];
  })).sort((a, b) => (b.score || 0) - (a.score || 0) || (a.rotation || 0) - (b.rotation || 0));
  const identityTags = uniqueHot(identity, selectedTags).slice(0, 2);

  // Content matches rank first, but all qualifying writing tags may fill the
  // three writing slots. Heat is only a tie-breaker, never a hard gate.
  const matched = uniqueHot(candidates, selectedTags).slice(0, 3);

  // Long-tail tags are sampled from the broader, high-heat pool. They remain
  // subject-adjacent by default; the two user-approved exceptions are allowed
  // explicitly. Stable rotation avoids changing tags on every refresh.
  const supplementalSeen = new Set<string>();
  const supplemental = realPool.groups.flatMap(group => group.suggestions.flatMap(item => {
    const tagKey = item.tag.toLowerCase();
    if (!isLongTailDelfTag(item.tag) || item.views < 100_000
      || selectedTags.has(tagKey) || supplementalSeen.has(tagKey)) return [];
    supplementalSeen.add(tagKey);
    return [toHotEvidence(item, group.query, stableTagRank(`${finalPublicTopic}|tail|${item.tag}`))];
  })).sort((a, b) => tagUsage(a.tag, recent) - tagUsage(b.tag, recent)
    || a.rotation - b.rotation || b.views - a.views);
  const selected = [...identityTags, ...matched, ...supplemental.slice(0, 2)]
    .map(({ tag, source, sourceQuery, rank, views, tag_id }) => ({ tag, source, sourceQuery, rank, views, tag_id }));
  return selected;
}

function toHotEvidence(item: { tag: string; views: number; rank: number; tag_id: string }, sourceQuery: string, rotation: number) {
  return { tag: item.tag, source: 'data/xhs-tag-research/2026-08-31-creator-suggestions.json', sourceQuery,
    rank: item.rank, views: item.views, tag_id: item.tag_id, score: item.views, rotation };
}

function uniqueHot<T extends { tag: string }>(items: T[], selected: Set<string>) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.tag.toLowerCase();
    if (seen.has(key) || selected.has(key)) return false;
    seen.add(key); selected.add(key); return true;
  });
}

function isSafeDelfTag(tag: string) {
  if (DELF_B2_USER_ALLOWED_TAGS.has(tag.toLowerCase())) return true;
  return !/TCF|TEF|DALF|高考|四级|六级|专四|专八|考研|A1|A2|B1|C1|C2|零基础|口语|听力|阅读|日常|生活|课程|辅导|老师|批改|网站|高级|高阶|加分|高分|万能|满分|押题|delft|delfi|delfonics|delfjunior|delfprim/i.test(tag)
    && /(?:DELF|delfb2|法语B2|法语写作|法语作文|delf写作)/i.test(tag);
}

function isStrictDelfWritingTag(tag: string) {
  return !/TCF|TEF|DALF|高考|四级|六级|专四|专八|考研|A1|A2|B1|C1|C2|二外|全国卷/i.test(tag)
    && /(?:DELF.*(?:写作|作文)|法语(?:写作|作文)|delf写作|delfb2作文)/i.test(tag);
}

function isDelfIdentityTag(tag: string) {
  return !/A1|A2|B1|C1|C2|TCF|TEF|DALF|口语|听力|阅读/i.test(tag)
    && /^#?(?:DELF|DELFB2|法语B2|DELF备考|DELFB2备考|法语B2备考)$/i.test(tag);
}

function isLongTailDelfTag(tag: string) {
  if (DELF_B2_USER_ALLOWED_TAGS.has(tag.toLowerCase())) return true;
  return !/TCF|TEF|DALF|高考|四级|六级|专四|专八|考研|A1|A2|B1|C1|C2|二外|全国卷|加拿大|预签证|成都|南京|北京|上海|广州|杭州|月份|娜姐|代写|批改|老师|课程|教程|电子版|参考书|词汇书|书籍|下载|网课|辅导|培训|押题|学习班|搭子|软件|零基础|入门|寒假|暑假|每日|打卡|日常|分享|必备|音乐|歌曲|求职|职场|美食|美甲|租房|delfi|delfonics|delfjunior|delfprim/i.test(tag)
    && /(?:DELF|delfb2|法语B2|法语写作|法语作文|delf写作|法语备考|法语考试|法语语法|法语词汇|法语句型|法语表达|法语素材|法语学习)/i.test(tag);
}

// User-approved exceptions. They remain supplemental candidates only; they are
// not forced into every note and do not disable the general safety filters.
const DELF_B2_USER_ALLOWED_TAGS = new Set(['#delfb2口语', '#delft']);

type TagRoute = { pattern: RegExp; phrases: string[]; tags: TagCandidate[] };

const LANGUAGE_POOL: TagCandidate[] = [
  { tag: '#法语', views: 1_530_000_000 },
  { tag: '#学习法语', views: 11_614_000 },
];
const WRITING_POOL: TagCandidate[] = [
  { tag: '#法语写作', views: 2_464_000 },
  { tag: '#法语作文', views: 951_000 },
];
const IDENTITY_POOL: TagCandidate[] = [
  { tag: '#法语考试', views: 29_761_000 }, { tag: '#法语DELF', views: 5_691_000 },
  { tag: '#法语B2', views: 4_689_000 }, { tag: '#DELF', views: 2_992_000 },
  { tag: '#法语Delf考试', views: 1_322_000 }, { tag: '#DELFB2', views: 473_000 },
  { tag: '#法语delfb2', views: 248_000 },
];
const LEARNING_POOL: TagCandidate[] = [
  { tag: '#法语学习笔记', views: 5_404_000 }, { tag: '#法语备考', views: 4_311_000 },
  { tag: '#法语学习方法', views: 967_000 }, { tag: '#法语学习资料', views: 537_000 },
];
const PREP_POOL: TagCandidate[] = [
  { tag: '#法语备考', views: 4_311_000 }, { tag: '#法语Delf考试', views: 1_322_000 },
  { tag: '#法语备考冲刺', views: 500_000 }, { tag: '#法语考试等级', views: 423_000 },
];
const GENERAL_POOL: TagCandidate[] = [
  { tag: '#法语词汇', views: 18_890_000 }, { tag: '#法语表达', views: 15_329_000 },
  { tag: '#法语语法', views: 10_227_000 }, { tag: '#法语学习笔记', views: 5_404_000 },
];
const DELF_B2_SEARCH_ROUTES: TagRoute[] = [
  {
    pattern: /语法|句型|句式|从句|时态|变位|虚拟式|直陈式|条件式|连接词|衔接词|逻辑词|connecteur/u,
    phrases: ['法语语法', '法语语法学习', '法语语法干货', '法语常用句型'],
    tags: [{ tag: '#法语语法', views: 10_227_000 }, { tag: '#法语语法学习', views: 4_712_000 }, { tag: '#法语语法干货', views: 485_000 }, { tag: '#法语常用句型', views: 43_000 }],
  },
  {
    pattern: /词汇|单词|搭配|同义词|替换词|词组|高频词/u,
    phrases: ['法语词汇', '法语词汇学习', '法语词汇积累', '法语高频词汇'],
    tags: [{ tag: '#法语词汇', views: 18_890_000 }, { tag: '#法语词汇学习', views: 1_316_000 }, { tag: '#法语词汇积累', views: 631_000 }, { tag: '#法语高频词汇', views: 77_000 }],
  },
  {
    pattern: /表达|地道|措辞|口语化|自然|观点|论证|论点|论据|argument/u,
    phrases: ['法语表达', '法语地道表达', '法语实用表达', '用法语表达观点'],
    tags: [{ tag: '#法语表达', views: 15_329_000 }, { tag: '#法语地道表达', views: 1_858_000 }, { tag: '#法语实用表达', views: 1_131_000 }, { tag: '#用法语表达观点', views: 13_000 }],
  },
  {
    pattern: /素材|主题|例子|论据库|观点库/u,
    phrases: ['法语作文素材积累', '法语写作素材', '法语写作训练'],
    tags: [{ tag: '#法语写作训练', views: 59_000 }, { tag: '#法语写作素材', views: 43_000 }, { tag: '#法语作文素材积累', views: 39_000 }],
  },
  {
    pattern: /模板|框架|结构|范文|正式信|建议信|投诉信|书信|开头|结尾|格式/u,
    phrases: ['法语写作', '法语作文', '法语作文模板', 'delfb2作文'],
    tags: [{ tag: '#delfb2作文', views: 102_000 }, { tag: '#法语写作训练', views: 59_000 }, { tag: '#法语写作素材', views: 43_000 }, { tag: '#法语作文模板', views: 23_000 }],
  },
  {
    pattern: /批改|纠错|评分|自查|检查|练习|题库|真题|词数|250/u,
    phrases: ['法语考试', '法语备考冲刺', 'delfb2题库', '法语作文批改'],
    tags: [{ tag: '#法语备考冲刺', views: 500_000 }, { tag: '#delfb2题库', views: 126_000 }, { tag: '#法语语法练习800题', views: 70_000 }, { tag: '#法语作文批改', views: 6_269 }],
  },
];
const PREP_PATTERN = /备考|考前|冲刺|考试|真题|题库|评分|自查|检查|词数|250/u;

export function getDelfB2RelatedSearchPhrases(contentContext: string): string[] {
  const phrases = DELF_B2_SEARCH_ROUTES
    .filter(route => route.pattern.test(contentContext))
    .flatMap(route => route.phrases);
  return unique(phrases.length ? phrases : ['法语写作', '法语考试', '法语B2']);
}

export function buildDelfB2SearchTags(
  contentContext: string,
  tagMaterial: string[] = [],
  recentTagCounts?: Map<string, number>,
  seed = contentContext,
): string[] {
  // tagMaterial 里可能有工作流内部模块名（如“观点库”），不能让它把内容
  // 错路由到“表达/论证”。真实选题、标题和正文摘要已包含在 contentContext。
  const context = contentContext;
  const matched = DELF_B2_SEARCH_ROUTES.filter(route => route.pattern.test(context));
  const primary = matched[0]?.tags || GENERAL_POOL;
  const secondary = matched[1]?.tags || primary;
  const intent = PREP_PATTERN.test(context) ? PREP_POOL : LEARNING_POOL;
  const selected = [
    pickOne(LANGUAGE_POOL, recentTagCounts, `${seed}|language`),
    pickOne(WRITING_POOL, recentTagCounts, `${seed}|writing`),
    pickOne(IDENTITY_POOL, recentTagCounts, `${seed}|identity`),
    pickOne(intent, recentTagCounts, `${seed}|intent`),
    pickOne(primary, recentTagCounts, `${seed}|primary`),
    pickOne(secondary, recentTagCounts, `${seed}|secondary`),
  ];
  const uniqueSelected = unique(selected);
  if (uniqueSelected.length === 6) return uniqueSelected;
  for (const pool of [primary, secondary, GENERAL_POOL]) {
    const fallback = pool.filter(candidate => !uniqueSelected.includes(candidate.tag));
    if (fallback.length) return [...uniqueSelected, pickOne(fallback, recentTagCounts, `${seed}|fallback`)].slice(0, 6);
  }
  return uniqueSelected;
}

function pickOne(pool: TagCandidate[], counts: Map<string, number> | undefined, seed: string) {
  return [...pool].sort((a, b) => {
    const usageDelta = tagUsage(a.tag, counts) - tagUsage(b.tag, counts);
    if (usageDelta) return usageDelta;
    const trafficDelta = b.views - a.views;
    if (trafficDelta) return trafficDelta;
    return stableTagRank(`${seed}|${a.tag}`) - stableTagRank(`${seed}|${b.tag}`);
  })[0].tag;
}

function tagUsage(tag: string, counts?: Map<string, number>) {
  const bare = tag.replace(/^#+/u, '');
  return counts?.get(bare) || counts?.get(tag) || 0;
}

function unique(values: string[]) {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function stableTagRank(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
