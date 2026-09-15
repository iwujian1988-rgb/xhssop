// 自动验收工具：对一个已完成的 batch 目录统计质量 + 成本指标。
// 用法：
//   npx tsx scripts/audit-batch.mts data/batches/batch_XXXX
//   npx tsx scripts/audit-batch.mts                                # 默认取最新的 batch
//
// 输出指标（与 plan happy-watching-sunset.md 的验收线对照）：
//   - 通过率 / 失败原因分布
//   - 文字标题重复率（跨 job）
//   - 候选池跨 seed 通用率（候选指纹出现在 ≥2 个不同 seed 的比例）
//   - AI 味封面占比（命中 isUnnaturalTitle 黑名单）
//   - 单 job 平均 token、平均 LLM 调用次数
//   - 通过率安全阀（<53% 时提示降级）

import fs from 'node:fs/promises';
import path from 'node:path';

import { isTitleAnchoredToSeed } from '../src/lib/seed-topic-anchor';
import { fingerprintTitle } from '../src/lib/title-usage-store';

interface BatchJobFile {
  id: string;
  status: 'success' | 'failed' | 'pending' | 'running';
  attempts?: number;
  failure?: { stage: string; message: string; attempts: number };
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    calls: number;
    autofix_count: number;
  };
  draft?: {
    selected_title: string;
    cover: { title: string; subtitle?: string };
    title_candidates?: Array<{ title: string }>;
    brief?: { seed_id?: string };
  };
  topic?: { seed_id?: string };
}

const AI_FLAVOR_PATTERNS = /资料太散|正在拖后腿|拖后腿|正在白背|白背|写作任务|你的DELF\s*B2|你的法语B2|卡住/;

async function resolveBatchDir(arg: string | undefined): Promise<string> {
  if (arg) return path.resolve(arg);
  const root = path.resolve('data/batches');
  const entries = await fs.readdir(root);
  const sorted = (await Promise.all(
    entries.map(async name => {
      const stat = await fs.stat(path.join(root, name));
      return { name, mtime: stat.mtimeMs };
    }),
  )).sort((a, b) => b.mtime - a.mtime);
  if (!sorted[0]) throw new Error('未找到任何 batch 目录');
  return path.join(root, sorted[0].name);
}

async function loadJobs(batchDir: string): Promise<BatchJobFile[]> {
  const jobsDir = path.join(batchDir, 'jobs');
  const files = (await fs.readdir(jobsDir)).filter(f => f.endsWith('.json'));
  return Promise.all(files.map(async f => JSON.parse(await fs.readFile(path.join(jobsDir, f), 'utf8')) as BatchJobFile));
}

function humanPct(n: number, total: number) {
  if (!total) return '0%';
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  const batchDir = await resolveBatchDir(process.argv[2]);
  console.log(`\n=== Audit: ${batchDir} ===\n`);
  const jobs = await loadJobs(batchDir);
  const total = jobs.length;
  const success = jobs.filter(j => j.status === 'success');
  const failed = jobs.filter(j => j.status === 'failed');

  // 1. 通过率 + 失败原因
  console.log(`[1] 通过率：${success.length}/${total} = ${humanPct(success.length, total)}`);
  const failStages = new Map<string, number>();
  for (const f of failed) {
    const stage = f.failure?.stage || 'unknown';
    failStages.set(stage, (failStages.get(stage) || 0) + 1);
  }
  if (failed.length) {
    console.log('    失败 stage 分布：');
    for (const [stage, count] of Array.from(failStages.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${stage}: ${count} (${humanPct(count, failed.length)})`);
    }
  }
  // 身份词错（product_identity_mismatch）占比
  const identityFails = failed.filter(f => (f.failure?.message || '').includes('identity') || (f.failure?.message || '').includes('身份'));
  console.log(`    失败里身份词错占比：${identityFails.length}/${failed.length} = ${humanPct(identityFails.length, failed.length)}`);

  // 2. 文字标题重复率（success job 之间）
  const selectedTitles = success.map(j => j.draft?.selected_title || '').filter(Boolean);
  const selectedFps = selectedTitles.map(fingerprintTitle);
  const selectedDups = selectedFps.length - new Set(selectedFps).size;
  console.log(`\n[2] 文字标题重复率：${selectedDups}/${selectedFps.length} = ${humanPct(selectedDups, selectedFps.length)}`);
  // 列出重复的具体标题
  const fpCount = new Map<string, number>();
  for (const fp of selectedFps) fpCount.set(fp, (fpCount.get(fp) || 0) + 1);
  const dups = Array.from(fpCount.entries()).filter(([, n]) => n > 1);
  if (dups.length) {
    console.log('    重复标题：');
    for (const [fp, n] of dups) {
      const sample = selectedTitles[selectedFps.indexOf(fp)];
      console.log(`      ×${n}: ${sample}`);
    }
  }

  // 3. 候选池跨 seed 通用率
  // 每条候选指纹 → 出现在多少个不同 seed 的候选池里
  const fpToSeeds = new Map<string, Set<string>>();
  for (const j of success) {
    const seedId = j.draft?.brief?.seed_id || j.topic?.seed_id || '';
    const candidates = j.draft?.title_candidates || [];
    for (const c of candidates) {
      const fp = fingerprintTitle(c.title);
      if (!fpToSeeds.has(fp)) fpToSeeds.set(fp, new Set());
      if (seedId) fpToSeeds.get(fp)!.add(seedId);
    }
  }
  const allCandidateFps = Array.from(fpToSeeds.keys());
  const crossSeedFps = allCandidateFps.filter(fp => (fpToSeeds.get(fp)?.size || 0) >= 2);
  console.log(`\n[3] 候选池跨 seed 通用率：${crossSeedFps.length}/${allCandidateFps.length} = ${humanPct(crossSeedFps.length, allCandidateFps.length)}`);
  // 列出最严重的几条
  const worst = crossSeedFps
    .map(fp => ({ fp, seeds: fpToSeeds.get(fp)!.size }))
    .sort((a, b) => b.seeds - a.seeds)
    .slice(0, 5);
  if (worst.length) {
    console.log('    跨 seed 最严重的候选：');
    for (const w of worst) {
      console.log(`      ×${w.seeds} seeds: ${worst.length ? '' : ''}${w.fp}`);
    }
  }

  // 4. AI 味封面占比
  const aiFlavorCovers = success.filter(j => AI_FLAVOR_PATTERNS.test(j.draft?.cover.title || ''));
  console.log(`\n[4] AI 味封面占比：${aiFlavorCovers.length}/${success.length} = ${humanPct(aiFlavorCovers.length, success.length)}`);
  for (const j of aiFlavorCovers) {
    console.log(`      AI 味: ${j.draft?.cover.title}`);
  }

  // 5. 主题锚定命中率（success job 的 selected title 是否命中本 seed 关键词）
  const anchoredHits = success.filter(j => {
    const seedId = j.draft?.brief?.seed_id || j.topic?.seed_id || '';
    const title = j.draft?.selected_title || '';
    return isTitleAnchoredToSeed(title, seedId);
  });
  console.log(`\n[5] 主题锚定命中率：${anchoredHits.length}/${success.length} = ${humanPct(anchoredHits.length, success.length)}`);
  const unanchored = success.filter(j => !anchoredHits.includes(j));
  for (const j of unanchored.slice(0, 8)) {
    const seedId = j.draft?.brief?.seed_id || j.topic?.seed_id || '';
    console.log(`      未锚定 [${seedId}]: ${j.draft?.selected_title}`);
  }

  // 6. token + LLM call 平均
  const totals = success.reduce((acc, j) => {
    const u = j.usage;
    if (!u) return acc;
    acc.tokens += u.total_tokens;
    acc.calls += u.calls;
    acc.autofix += u.autofix_count;
    return acc;
  }, { tokens: 0, calls: 0, autofix: 0 });
  console.log(`\n[6] 单 job 平均 token：${Math.round(totals.tokens / Math.max(success.length, 1))}`);
  console.log(`    单 job 平均 LLM 调用：${(totals.calls / Math.max(success.length, 1)).toFixed(1)}`);
  console.log(`    单 job 平均 autofix 次数：${(totals.autofix / Math.max(success.length, 1)).toFixed(1)}`);

  // 7. 通过率安全阀
  const passRate = success.length / Math.max(total, 1);
  console.log(`\n[7] 通过率安全阀：${passRate < 0.53 ? '⚠️ 已跌至 53% 以下，建议降级主题锚定严格度' : '✓ 未触发'}`);

  // 8. 验收总结
  console.log('\n=== 验收线对照 ===');
  const checks: Array<[string, number, string, boolean?]> = [
    ['通过率', passRate, '≥85%', passRate >= 0.85],
    ['文字标题重复率', selectedDups / Math.max(selectedFps.length, 1), '<5%', (selectedDups / Math.max(selectedFps.length, 1)) < 0.05],
    ['候选池跨 seed 通用率', crossSeedFps.length / Math.max(allCandidateFps.length, 1), '<10%', (crossSeedFps.length / Math.max(allCandidateFps.length, 1)) < 0.10],
    ['AI 味封面占比', aiFlavorCovers.length / Math.max(success.length, 1), '<3%', (aiFlavorCovers.length / Math.max(success.length, 1)) < 0.03],
    ['主题锚定命中率', anchoredHits.length / Math.max(success.length, 1), '≥80%', (anchoredHits.length / Math.max(success.length, 1)) >= 0.80],
    ['单 job 平均 token', Math.round(totals.tokens / Math.max(success.length, 1)), '≤20000', Math.round(totals.tokens / Math.max(success.length, 1)) <= 20000],
    ['单 job 平均 LLM 调用', totals.calls / Math.max(success.length, 1), '≤3', (totals.calls / Math.max(success.length, 1)) <= 3],
  ];
  for (const [name, value, target, pass] of checks) {
    const pct = typeof value === 'number' && value <= 1 && (name.includes('率') || name.includes('比')) ? `${(value * 100).toFixed(1)}%` : Math.round(value).toString();
    console.log(`  ${pass ? '✓' : '✗'} ${name}: ${pct}  (验收线 ${target})`);
  }
  const allPass = checks.every(([, , , pass]) => pass);
  console.log(`\n${allPass ? '✓ 全部达标' : '✗ 存在不达标项'}`);
}

main().catch(error => {
  console.error('audit failed:', error);
  process.exit(1);
});
