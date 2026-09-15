import fs from 'node:fs';
import path from 'node:path';

const sources = [
  ['DELF', 'C:/Users/imwuj/.codex/attachments/f8973469-8749-4902-9278-aba3c734d705/pasted-text.txt'],
  ['法语', 'C:/Users/imwuj/.codex/attachments/9633c2de-a78c-4699-b4a8-9828d342e4ec/pasted-text.txt'],
  ['法语写作', 'C:/Users/imwuj/.codex/attachments/81798584-3f65-4ad4-a332-5c449bf4ae4b/pasted-text.txt'],
  ['法语考试', 'C:/Users/imwuj/.codex/attachments/e1e3bcb3-3f8e-4310-a040-81ca34ffe2c0/pasted-text.txt'],
  ['法语学习', 'C:/Users/imwuj/.codex/attachments/7291488a-0eef-4d5c-a774-42f8a0758a77/pasted-text.txt'],
  ['法语备考', 'C:/Users/imwuj/.codex/attachments/315bc2e4-09f1-4f8a-98c9-28fcd237d5b6/pasted-text.txt'],
  ['法语语法', 'C:/Users/imwuj/.codex/attachments/e842e227-5213-4ca4-afe2-9d6986f664fe/pasted-text.txt'],
  ['法语词汇', 'C:/Users/imwuj/.codex/attachments/6f158500-bbc2-492b-a336-729d7febb27a/pasted-text.txt'],
  ['DELFB2', 'C:/Users/imwuj/.codex/attachments/5b68376b-fe78-43ac-bbc8-5507599e0cf8/pasted-text.txt'],
  ['法语作文', 'C:/Users/imwuj/.codex/attachments/d621f8ae-f3ec-422f-934f-3d56dec39f77/pasted-text.txt'],
  ['法语表达', 'C:/Users/imwuj/.codex/attachments/1ebe900c-c390-4038-abb6-03e15d090b4b/pasted-text.txt'],
  ['法语句型', 'C:/Users/imwuj/.codex/attachments/ebf02b22-328c-451a-b25a-967f8c826500/pasted-text.txt'],
];

function parseViews(label) {
  const match = label.match(/([\d.]+)(亿|万)?浏览/u);
  if (!match) return 0;
  const multiplier = match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function parseSuggestions(html) {
  const itemPattern = /class="item(?: is-selected)?"[^>]*data-impression="([^"]+)"[^>]*>[\s\S]*?class="name">([^<]+)<\/span>[\s\S]*?class="num">([^<]+)<\/span>/gu;
  return [...html.matchAll(itemPattern)].map((match, index) => {
    const impression = match[1].replaceAll('&quot;', '"');
    const tagId = impression.match(/"tagId":"([^"]+)"/u)?.[1] || '';
    return {
      rank: index + 1,
      tag: match[2],
      views_label: match[3],
      views: parseViews(match[3]),
      tag_id: tagId,
    };
  });
}

const groups = sources.map(([query, sourcePath]) => ({
  query,
  source_file: sourcePath,
  suggestions: parseSuggestions(fs.readFileSync(sourcePath, 'utf8')),
}));

const aggregate = new Map();
for (const group of groups) {
  for (const item of group.suggestions) {
    const existing = aggregate.get(item.tag);
    if (!existing || item.views > existing.views) {
      aggregate.set(item.tag, { ...item, queries: [group.query] });
    } else if (!existing.queries.includes(group.query)) {
      existing.queries.push(group.query);
    }
  }
}

const output = {
  schema_version: 1,
  collected_at: '2026-08-31',
  source: '小红书创作服务平台话题下拉框，由用户手工复制HTML',
  group_count: groups.length,
  groups,
  unique_tags: [...aggregate.values()].sort((a, b) => b.views - a.views),
};

const outputPath = path.resolve('data/xhs-tag-research/2026-08-31-creator-suggestions.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`saved ${groups.length} groups / ${output.unique_tags.length} unique tags -> ${outputPath}`);
