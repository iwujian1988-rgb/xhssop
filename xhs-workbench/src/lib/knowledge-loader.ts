import fs from 'node:fs/promises';
import path from 'node:path';
import { ProductId } from '@/types/data';

const DELF_ROOT = 'D:\\claude_work\\xunixiangmu\\deliverables\\feishu_pages';
const TEF_ROOT = 'D:\\claude_work\\taolun\\法语付费资料';

export async function loadKnowledgeSnippets(productId: ProductId, query: string, maxChars = 9000): Promise<string> {
  const files = productId === 'delf_b2_writing'
    ? await listMarkdownFiles(DELF_ROOT, 80)
    : await listTefFiles();

  const keywords = extractKeywords(query);
  const scored: Array<{ file: string; text: string; score: number }> = [];

  for (const file of files) {
    try {
      const text = await fs.readFile(file, 'utf8');
      const compact = compactMarkdown(text);
      scored.push({ file, text: compact, score: scoreText(compact, keywords) });
    } catch {
      // Ignore unreadable local files; the API can still work with other snippets.
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(item => `【来源】${item.file}\n${item.text.slice(0, Math.ceil(maxChars / 8))}`)
    .join('\n\n---\n\n')
    .slice(0, maxChars);
}

async function listMarkdownFiles(root: string, limit: number): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string) {
    if (out.length >= limit) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(full);
      if (out.length >= limit) return;
    }
  }
  await walk(root);
  return out;
}

async function listTefFiles(): Promise<string[]> {
  const entries = await fs.readdir(TEF_ROOT, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile() && /^\d+_.+_v1\.md$/i.test(entry.name))
    .map(entry => path.join(TEF_ROOT, entry.name));
}

function compactMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\[[^\]]+]\([^)]*\)/g, match => match.replace(/^\[|\]\([^)]*\)$/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractKeywords(text: string): string[] {
  const base = ['DELF', 'B2', 'TEF', 'TCF', 'CLB7', '写作', '范文', '句型', '词汇', '计划', '错题', '考前'];
  const custom = text
    .split(/[\s,，。；;、：:\n\r]+/)
    .map(word => word.trim())
    .filter(word => word.length >= 2 && word.length <= 18);
  return Array.from(new Set([...custom, ...base]));
}

function scoreText(text: string, keywords: string[]): number {
  return keywords.reduce((score, keyword) => score + (text.includes(keyword) ? 1 : 0), 0);
}
