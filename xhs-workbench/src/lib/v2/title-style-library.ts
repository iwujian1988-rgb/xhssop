// 用户认可标题风格库。数据来源只有 data/title-style-user-approved.json（用户 2026-08-22
// 逐条确认的 30 条原样样本）。约束：
// - 禁止读取 notes.json 等爆款语料：那不是用户认可的改写基准；
// - 文件缺失/损坏返回空数组，调用方走通用风格规则，绝不伪造样本；
// - 样本只作正向参考（节奏/口语词/情绪/获得感），不是固定公式；
// - DELF B2 / DELFB2 等身份词以「去空白归一」统一处理，写法差异不算独特内容；
// - 强承诺词（速成/必备/高分/两周…）按用户口径不属于禁止复制内容；
//   防照抄只看独特短语残留，共用通用词/数字不算照抄，且仅作辅助信号。
// 注意：本文件只是样本读取与防照抄辅助，不做任何改写。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countVisibleUnits } from './contracts';

const USER_APPROVED_FILENAME = 'data/title-style-user-approved.json';
const MIN_COPY_SPAN_CODEPOINTS = 6;
const MIN_DISTINCTIVE_RESIDUE = 2;

export interface TitleStyleReference {
  title: string;
  styleTags: string[];
  track: string;
}

export interface StylePlagiarismHit {
  matchedTitle: string;
  span: string;
}

let testOverride: TitleStyleReference[] | null = null;

export function setTitleStyleReferencesForTest(references: TitleStyleReference[] | null): void {
  testOverride = references;
}

interface RawStyleSample {
  title?: unknown;
  style_tags?: unknown;
  track?: unknown;
}

// cwd 优先（正常 dev/batch 启动都在应用根目录），模块相对路径兜底：
// 服务从其他目录启动时（pm2/standalone 等），cwd 读不到就退回 src/lib/v2 向上三级。
function resolveUserApprovedPath(): string {
  const cwdCandidate = path.resolve(process.cwd(), USER_APPROVED_FILENAME);
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const moduleCandidate = path.resolve(moduleDir, '../../../', USER_APPROVED_FILENAME);
    if (fs.existsSync(moduleCandidate)) return moduleCandidate;
  } catch {
    // 打包环境下 import.meta.url 不可用，忽略
  }
  return cwdCandidate;
}

export function getTitleStyleReferences(productId: string, limit = 8): TitleStyleReference[] {
  if (testOverride) return spreadSample(testOverride, limit);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolveUserApprovedPath(), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const all: TitleStyleReference[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as RawStyleSample;
    if (typeof raw.title !== 'string' || raw.title.trim().length === 0) continue;
    all.push({
      title: raw.title.trim(),
      styleTags: Array.isArray(raw.style_tags)
        ? raw.style_tags.filter((tag): tag is string => typeof tag === 'string')
        : [],
      track: typeof raw.track === 'string' ? raw.track.trim() : '',
    });
  }
  const matched = all.filter((item) => item.track === productId || item.track === '');
  return spreadSample(matched, limit);
}

/** 全部认可样本保持文件顺序；不抽样、不规定风格配额。 */
export function getDelfB2HumanStyleReferences(): TitleStyleReference[] {
  return getTitleStyleReferences('delf_b2_writing', Number.MAX_SAFE_INTEGER);
}

/** The original approval evidence stays separate and never gets overwritten. */
export function getDelfB2ShortStyleReferences(): Array<{id:string;title:string;whenToUse:string}> {
  const filename = path.join(path.dirname(resolveUserApprovedPath()), 'title-style-short-approved.json');
  const parsed = JSON.parse(fs.readFileSync(filename, 'utf8')) as {references:Array<{id:string;title:string;whenToUse:string}>};
  if (!Array.isArray(parsed.references) || parsed.references.length !== 31
    || parsed.references.some((r,i) => r.id !== `A${String(i+1).padStart(2,'0')}` || typeof r.title !== 'string' || !r.title.trim() || countVisibleUnits(r.title)>20)) {
    throw new Error('INVALID_SHORT_APPROVED_LIBRARY');
  }
  return parsed.references.map(({id,title,whenToUse})=>({id,title,whenToUse}));
}

// 等距抽样：样本文件按风格家族分段排列，取前 N 条会偏向单一家族，等距取才能覆盖四类风格。
function spreadSample(pool: TitleStyleReference[], limit: number): TitleStyleReference[] {
  if (pool.length <= limit) return pool.slice();
  const stride = pool.length / limit;
  const picked: TitleStyleReference[] = [];
  for (let i = 0; i < limit; i += 1) {
    picked.push(pool[Math.min(pool.length - 1, Math.floor(i * stride))]);
  }
  return picked;
}

export function formatStyleReferenceForPrompt(reference: TitleStyleReference): string {
  const tags = reference.styleTags.length > 0 ? `（${reference.styleTags.join('/')}）` : '';
  return `「${reference.title}」${tags}`;
}

// 通用词表：考试/科目身份词、备考名词、强承诺词、功能词、量词单位。
// 这些词在任何同赛道标题里都会出现，共用不算照抄；数字另行剥离（数字允许复用）。
// 表内可写「DELF B2写作」带空格形式，匹配前统一去空白，DELFB2/DELF B2 两种写法等效。
const GENERIC_TITLE_WORDS = [
  'DELF B2写作', '法语B2写作', 'DELF写作', '备考锦囊', '写作攻略', '短期提分', '神仙方法',
  '进步最快', '人手一个', 'DELFB2', 'TEFTCF', 'DELF', 'TEF', 'TCF', 'B2', '写作', '法语',
  '考试', '考生', '备考', '资料库', '范文库', '观点库', '检查表', '自查表', '资料', '范文',
  '攻略', '锦囊', '套路', '句型', '模板', '题库', '刷题', '自查', '提分', '焦虑', '没思路',
  '心慌', '考前', '交卷', '最新', '最全', '速成', '高分', '加分点', '必备', '两周', '拿捏',
  '拉满', '实用值', '真的', '这么', '这件事', '我们', '就是', '不是', '关于', '怎么', '什么',
  '其实', '原来', '准备', '开始', '一下', '早点', '的', '了', '吗', '啊', '吧', '呢', '嘛',
  '我', '你', '这', '那', '别', '先', '再', '都', '也', '还', '就', '才', '要', '有', '没',
  '把', '让', '从', '到', '用', '在', '是', '对', '和', '跟', '看', '写', '背', '练', '刷',
  '啃', '篇', '个', '项', '步', '套', '份', '遍', '天', '周', '分钟', '月', '年',
];

const GENERIC_WORDS_NORMALIZED: string[] = [...new Set(
  GENERIC_TITLE_WORDS.map((word) => word.replace(/\s+/g, '')),
)]
  .filter((word) => word.length > 0)
  .sort((a, b) => b.length - a.length);

// 剥离通用词与数字/符号后剩下的独特字符（只留汉字和字母；数字属允许复用，不计数）。
function distinctiveResidue(span: string): string {
  let rest = span.replace(/\s+/g, '');
  for (const word of GENERIC_WORDS_NORMALIZED) {
    if (rest.includes(word)) rest = rest.split(word).join('');
  }
  return Array.from(rest)
    .filter((ch) => /[一-鿿A-Za-z]/.test(ch))
    .join('');
}

export function longestCommonSubstring(a: string, b: string): string {
  const charsA = Array.from(a);
  const charsB = Array.from(b);
  if (charsA.length === 0 || charsB.length === 0) return '';
  let prev = new Uint32Array(charsB.length + 1);
  let bestLen = 0;
  let bestEnd = 0;
  for (let i = 1; i <= charsA.length; i += 1) {
    const curr = new Uint32Array(charsB.length + 1);
    for (let j = 1; j <= charsB.length; j += 1) {
      if (charsA[i - 1] === charsB[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > bestLen) {
          bestLen = curr[j];
          bestEnd = i;
        }
      }
    }
    prev = curr;
  }
  return charsA.slice(bestEnd - bestLen, bestEnd).join('');
}

function stripSpaces(text: string): string {
  return text.replace(/\s+/g, '');
}

// 防照抄辅助检查：整句相同，或与某样本存在 ≥6 码点的连续公共片段且剥通用词后仍有
// ≥2 个独特字符。只返回命中事实，不决定拦截——调用方以此回退该槽或记 warning。
export function findStylePlagiarism(
  candidateTitle: string,
  references: TitleStyleReference[],
): StylePlagiarismHit[] {
  const candidate = stripSpaces(candidateTitle);
  if (candidate.length === 0) return [];
  const hits: StylePlagiarismHit[] = [];
  for (const reference of references) {
    const sample = stripSpaces(reference.title);
    if (sample.length === 0) continue;
    if (candidate === sample) {
      hits.push({ matchedTitle: reference.title, span: '整句相同' });
      continue;
    }
    const span = longestCommonSubstring(candidate, sample);
    if (Array.from(span).length < MIN_COPY_SPAN_CODEPOINTS) continue;
    if (distinctiveResidue(span).length >= MIN_DISTINCTIVE_RESIDUE) {
      hits.push({ matchedTitle: reference.title, span });
    }
  }
  return hits;
}
