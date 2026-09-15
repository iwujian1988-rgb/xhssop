import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProductId } from '@/types/data';

export interface MarketTopicReference {
  sourceTitle: string;
  sourceSummary?: string;
  sourceNoteUrl?: string;
  sourceCoverUrl?: string;
  noteId?: string;
  date?: string;
  likes?: number;
  favorites?: number;
  comments?: number;
  shares?: number;
  sourceExam: string;
}

const FALLBACK: Record<string, MarketTopicReference[]> = {
  tef_tcf_canada: [
    { sourceTitle: 'TCF Canada备考工具｜网站篇', sourceExam: 'TCF' },
    { sourceTitle: '零基础一年时间攻克TCF Canada 全过程记录', sourceExam: 'TCF' },
    { sourceTitle: 'TCF Canada｜掏心窝子零基础到B2经验分享', sourceExam: 'TCF' },
    { sourceTitle: 'TCF CA快速刷题方法', sourceExam: 'TCF' },
    { sourceTitle: 'TCF报名考位和刷题题库', sourceExam: 'TCF' },
  ],
  tcf_canada_writing_7day: [
    { sourceTitle: 'TCF Canada备考工具｜网站篇', sourceExam: 'TCF' },
    { sourceTitle: 'TCF CA快速刷题方法', sourceExam: 'TCF' },
    { sourceTitle: 'TCF报名考位和刷题题库', sourceExam: 'TCF' },
  ],
  delf_b2_writing: [
    { sourceTitle: 'DELF B2高分通过，3个月自主备考经验分享', sourceExam: 'DELF B2' },
    { sourceTitle: '法语B2一次上岸，我的5个月作息', sourceExam: 'DELF B2' },
    { sourceTitle: '法语B2实际不是考试而是记忆力大赛', sourceExam: 'DELF B2' },
    { sourceTitle: '法语B2，浪费时间行为belike', sourceExam: 'DELF B2' },
    { sourceTitle: '严肃避雷我考法语b2时做的无用功', sourceExam: 'DELF B2' },
    { sourceTitle: 'DELF B2短期备考怎么做？经验贴来啦', sourceExam: 'DELF B2' },
  ],
};

function parseCsvLine(line: string) {
  const cells: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (char === '"') { if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; } else if (char === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += char; }
  cells.push(cell); return cells;
}

async function readCsv(file: string, sourceExam: string): Promise<MarketTopicReference[]> {
  try {
    const rows = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map(parseCsvLine);
    if (rows.length < 2) return [];
    const headers = rows[0].map(value => value.trim().toLowerCase());
    const index = (names: string[]) => headers.findIndex(header => names.includes(header));
    const title = index(['title', 'source_title', '笔记标题', '标题']);
    if (title < 0) return [];
    const value = (row: string[], names: string[]) => row[index(names)]?.trim() || undefined;
    const number = (row: string[], names: string[]) => { const n = Number(value(row, names)); return Number.isFinite(n) ? n : undefined; };
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6);
    const examPattern = sourceExam === 'DELF B2' ? /delf|法语b2|b2/i : /tcf(?!\s*与?\s*tef)/i;
    const otherExamPattern = sourceExam === 'DELF B2' ? /\btcf\b|\btef\b|clb|nclc/i : /delf|法语b2|\bb2\b/i;
    return rows.slice(1).map(row => ({ sourceTitle: row[title]?.trim(), sourceSummary: value(row, ['summary', 'source_summary', '摘要', '正文摘要']), sourceCoverUrl: value(row, ['cover_url', 'source_cover_url', '封面图url', '封面图 URL', '封面图URL']), noteId: value(row, ['note_id', '笔记id', '笔记ID']), sourceNoteUrl: value(row, ['note_url', 'source_note_url', '链接', '笔记链接']), date: value(row, ['date', 'publish_date', '发布时间', '日期']), likes: number(row, ['likes', '点赞']), favorites: number(row, ['favorites', '收藏']), comments: number(row, ['comments', '评论']), shares: number(row, ['shares', '分享']), sourceExam })).filter(item => item.sourceTitle)
      .filter(item => examPattern.test(`${item.sourceTitle} ${item.sourceSummary || ''}`))
      .filter(item => !otherExamPattern.test(`${item.sourceTitle} ${item.sourceSummary || ''}`))
      .filter(item => !item.date || Number.isNaN(Date.parse(item.date)) || new Date(item.date) >= cutoff)
      .sort((a, b) => (2 * (b.favorites || 0) + (b.likes || 0) + 1.5 * (b.comments || 0) + 2 * (b.shares || 0)) - (2 * (a.favorites || 0) + (a.likes || 0) + 1.5 * (a.comments || 0) + 2 * (a.shares || 0)));
  } catch { return []; }
}

export async function getMarketTopicReferences(productId: ProductId, limit = 20): Promise<MarketTopicReference[]> {
  const exam = productId === 'delf_b2_writing' ? 'DELF B2' : 'TCF';
  const configured = productId === 'delf_b2_writing' ? 'delf_xhs_notes_20260914.csv' : 'tcf_xhs_notes_20260912_v2.csv';
  const files = [path.join(process.cwd(), 'data', 'market', configured), path.join(process.cwd(), configured), path.resolve(process.cwd(), '..', 'taolun', configured)];
  for (const file of files) { const rows = await readCsv(file, exam); if (rows.length) return rows.slice(0, limit); }
  return (FALLBACK[productId] || []).slice(0, limit);
}
