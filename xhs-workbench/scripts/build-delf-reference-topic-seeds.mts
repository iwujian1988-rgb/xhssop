import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, mergeAiUsage } from '../src/lib/ai-client';

type SourceReference = {
  referenceId: number;
  sourceTitle: string;
  sourceSummary?: string;
  date?: string;
  likes?: number;
  favorites?: number;
  comments?: number;
  shares?: number;
};
type PoolGroup = {
  id: string;
  reason: string;
  allReferenceIds: number[];
};
type ReferenceSeed = SourceReference & {
  clickReasonId: string;
  clickReason: string;
  referenceTopicCoreSeed: string;
  delfWritingTopicCoreSeed: string;
  referenceTitleSkeleton: string;
  transferable: boolean;
  nonTransferableReason?: string;
};

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += char;
  }
  cells.push(cell);
  return cells;
}

async function loadSourceReferences() {
  const csvPath = path.join(process.cwd(), 'data', 'market', 'delf_xhs_notes_20260914.csv');
  const rows = (await readFile(csvPath, 'utf8')).split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headers = rows[0].map(value => value.trim());
  const at = (name: string) => headers.indexOf(name);
  const value = (row: string[], name: string) => row[at(name)]?.trim() || undefined;
  const number = (row: string[], name: string) => { const parsed = Number(value(row, name)); return Number.isFinite(parsed) ? parsed : undefined; };
  return rows.slice(1).reduce<Map<number, SourceReference>>((map, row, referenceId) => {
    const sourceTitle = value(row, '标题');
    if (sourceTitle) map.set(referenceId, {
      referenceId,
      sourceTitle,
      sourceSummary: value(row, '正文摘要'),
      date: value(row, '日期'),
      likes: number(row, '点赞'),
      favorites: number(row, '收藏'),
      comments: number(row, '评论'),
      shares: number(row, '分享'),
    });
    return map;
  }, new Map());
}

const root = process.cwd();
const poolPath = path.join(root, 'artifacts', 'delf-click-reason-pool-experiment-20260914', 'audit-v3-1.json');
const outputPath = path.join(root, 'data', 'market', 'delf-reference-topic-seeds.json');
const pool = JSON.parse(await readFile(poolPath, 'utf8')) as { groups: PoolGroup[] };
const sourceReferences = await loadSourceReferences();
const prior = await readFile(outputPath, 'utf8').then(text => JSON.parse(text) as { seeds?: ReferenceSeed[] }).catch(() => ({ seeds: [] }));
const existing = new Map((prior.seeds || []).map(seed => [seed.referenceId, seed]));
const groupByReferenceId = new Map<number, PoolGroup>();
for (const group of pool.groups) for (const referenceId of group.allReferenceIds) groupByReferenceId.set(referenceId, group);
const pending = [...groupByReferenceId.entries()].filter(([referenceId]) => !existing.has(referenceId)).map(([referenceId, group]) => ({
  ...sourceReferences.get(referenceId)!,
  clickReasonId: group.id,
  clickReason: group.reason,
})).filter(item => item.sourceTitle);

let usage = emptyAiUsage();
for (let offset = 0; offset < pending.length; offset += 24) {
  const batch = pending.slice(offset, offset + 24);
  const result = await callOpenAICompatibleJsonWithUsage<{ seeds?: Array<Partial<ReferenceSeed>> }>([
    { role: 'system', content: [
      '你在为冻结的DELF B2真实市场Reference建立一次性Topic Seed。逐条分析具体原标题和摘要，不要从Click Reason泛化发明选题。',
      'referenceTopicCoreSeed必须准确概括原Reference具体在讲什么；delfWritingTopicCoreSeed必须把同一个具体母题自然迁移到DELF B2写作，不能退化成泛泛的“备考方法”。',
      'referenceTitleSkeleton只保留原标题句型、节奏和信息顺序，用XX/X替换不可复用的身份、成绩、数字或个人经历。',
      '如果该Reference无法安全迁移到DELF B2写作，或只能依赖实时考情、未验证成绩案例、广告服务、外部资源清单，transferable=false并说明原因。',
      '不要伪造个人经历，不要把写作单项描述成通过考试。每个referenceId必须返回一次。',
      '只返回JSON：{"seeds":[{"referenceId":1,"referenceTopicCoreSeed":"...","delfWritingTopicCoreSeed":"...","referenceTitleSkeleton":"...","transferable":true,"nonTransferableReason":""}]}。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify({ contentBoundary: 'DELF B2写作', references: batch.map(item => ({
      referenceId: item.referenceId,
      clickReasonId: item.clickReasonId,
      clickReason: item.clickReason,
      sourceTitle: item.sourceTitle,
      sourceSummary: (item.sourceSummary || '').slice(0, 500),
    })) }) },
  ], { stage: 'delf-reference-topic-seed-build', model: 'deepseek-flash', temperature: 0.15, maxTokens: 12000, retries: 1 });
  usage = mergeAiUsage(usage, result.usage);
  const returned = new Map((result.data.seeds || []).map(seed => [Number(seed.referenceId), seed]));
  for (const source of batch) {
    const generated = returned.get(source.referenceId);
    if (!generated?.referenceTopicCoreSeed || !generated.delfWritingTopicCoreSeed || !generated.referenceTitleSkeleton || typeof generated.transferable !== 'boolean') {
      throw new Error(`Reference seed incomplete: ${source.referenceId} ${source.sourceTitle}`);
    }
    existing.set(source.referenceId, {
      ...source,
      referenceTopicCoreSeed: generated.referenceTopicCoreSeed,
      delfWritingTopicCoreSeed: generated.delfWritingTopicCoreSeed,
      referenceTitleSkeleton: generated.referenceTitleSkeleton,
      transferable: generated.transferable,
      nonTransferableReason: generated.nonTransferableReason || undefined,
    });
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({
    version: 'delf-reference-topic-seeds-v1',
    source: 'audit-v3-1.json + delf_xhs_notes_20260914.csv',
    generatedAt: new Date().toISOString(),
    seedCount: existing.size,
    seeds: [...existing.values()].sort((a, b) => a.referenceId - b.referenceId),
  }, null, 2), 'utf8');
  console.log(`seeded ${Math.min(offset + batch.length, pending.length)}/${pending.length}`);
}

console.log(JSON.stringify({ outputPath, existingSeedCount: prior.seeds?.length || 0, generatedSeedCount: pending.length, totalSeedCount: existing.size, usage }, null, 2));
