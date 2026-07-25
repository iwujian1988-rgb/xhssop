/* eslint-disable no-console */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';
const DEFAULT_CARDS = [
  'resource_06_notes_course_offer',
  'resource_11_delf_doc_analysis',
  'resource_10_plain_text_experience',
  'resource_09_notebook_warning',
];

interface UsageSummary { prompt_tokens: number; completion_tokens: number; total_tokens: number; calls: number }
interface Topic { id: string; topic: string; [key: string]: unknown }

interface SampleResult {
  sample: number;
  ok: boolean;
  stage: string;
  attempts: number;
  totalTokens: number;
  durationMs: number;
  errorMessage?: string;
}

interface BenchmarkReport {
  cardId: string;
  maxAttempts: number;
  samples: SampleResult[];
  successCount: number;
  failureCount: number;
  successRate: number;
  stageBreakdown: Record<string, number>;
  avgTokens: number;
  avgDurationMs: number;
}

async function postJson(body: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: any }> {
  const response = await fetch(`${BASE_URL}/api/reference-studio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

async function fetchTopics(cardId: string, direction = ''): Promise<Topic[]> {
  const result = await postJson({
    action: 'topics',
    product_id: 'delf_b2_writing',
    reference_card_id: cardId,
    direction,
  });
  if (!result.ok) throw new Error(`topics 失败：${result.json?.error || result.status}`);
  return (result.json.topics || []) as Topic[];
}

async function composeOnce(cardId: string, topic: Topic, maxAttempts: number): Promise<SampleResult> {
  const start = Date.now();
  const result = await postJson({
    action: 'compose',
    product_id: 'delf_b2_writing',
    reference_card_id: cardId,
    topic,
    max_attempts: maxAttempts,
  });
  const durationMs = Date.now() - start;
  const usage: UsageSummary | undefined = result.json?.usage;
  const totalTokens = usage?.total_tokens || 0;

  if (result.ok) {
    return {
      sample: 0,
      ok: true,
      stage: 'success',
      attempts: 1, // server doesn't return attempts yet; infer below
      totalTokens,
      durationMs,
    };
  }
  const errorMessage: string = result.json?.error || '未知错误';
  const stageMatch = errorMessage.match(/阶段：(\w+)/);
  const attemptsMatch = errorMessage.match(/已自动重试(\d+)次/);
  return {
    sample: 0,
    ok: false,
    stage: stageMatch ? stageMatch[1] : 'unknown',
    attempts: attemptsMatch ? Number(attemptsMatch[1]) + 1 : 1,
    totalTokens,
    durationMs,
    errorMessage: errorMessage.slice(0, 240),
  };
}

function aggregate(cardId: string, maxAttempts: number, samples: SampleResult[]): BenchmarkReport {
  const successCount = samples.filter(s => s.ok).length;
  const stageBreakdown: Record<string, number> = {};
  for (const sample of samples) {
    const key = sample.ok ? 'success' : sample.stage;
    stageBreakdown[key] = (stageBreakdown[key] || 0) + 1;
  }
  const totalTokens = samples.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalDuration = samples.reduce((sum, s) => sum + s.durationMs, 0);
  return {
    cardId,
    maxAttempts,
    samples,
    successCount,
    failureCount: samples.length - successCount,
    successRate: samples.length ? successCount / samples.length : 0,
    stageBreakdown,
    avgTokens: samples.length ? Math.round(totalTokens / samples.length) : 0,
    avgDurationMs: samples.length ? Math.round(totalDuration / samples.length) : 0,
  };
}

function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`### ${report.cardId} (maxAttempts=${report.maxAttempts})`);
  lines.push(`  成功率: ${report.successCount}/${report.samples.length} = ${(report.successRate * 100).toFixed(1)}%`);
  lines.push(`  阶段分布: ${Object.entries(report.stageBreakdown).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push(`  平均 token: ${report.avgTokens.toLocaleString()}`);
  lines.push(`  平均耗时: ${(report.avgDurationMs / 1000).toFixed(1)}s`);
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const cardIds = args[0] ? args[0].split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_CARDS;
  const samplesPerCard = Number(args[1] || 5);
  const attemptSettings: number[] = args[2]
    ? args[2].split(',').map(s => Number(s.trim())).filter(Number.isFinite)
    : [1, 3];

  console.log(`[benchmark] base=${BASE_URL} cards=${cardIds.join(',')} samples=${samplesPerCard} attempts=${attemptSettings.join(',')}`);

  // Warm-up ping
  try {
    const res = await fetch(`${BASE_URL}/api/reference-studio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'topics', product_id: 'delf_b2_writing', reference_card_id: cardIds[0], direction: '' }),
    }).catch(cause => {
      throw new Error(`无法连接到 ${BASE_URL}：${cause instanceof Error ? cause.message : 'unknown'}。请先启动 dev server（npx next dev -p 4000）`);
    });
    if (!res.ok) console.log(`[benchmark] warm-up ping returned ${res.status}`);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exit(1);
  }

  const reports: BenchmarkReport[] = [];

  for (const cardId of cardIds) {
    // Build a topics pool sized to samplesPerCard (one topics call yields 3)
    const topicsPool: Topic[] = [];
    while (topicsPool.length < samplesPerCard) {
      const topics = await fetchTopics(cardId).catch(cause => {
        console.log(`[benchmark] topics failed for ${cardId}: ${cause instanceof Error ? cause.message : 'unknown'}`);
        return [] as Topic[];
      });
      if (!topics.length) break;
      topicsPool.push(...topics);
    }
    if (topicsPool.length < samplesPerCard) {
      console.log(`[benchmark] ${cardId}: 仅获得 ${topicsPool.length} 个选题，跳过`);
      continue;
    }
    console.log(`[benchmark] ${cardId}: 已获取 ${topicsPool.length} 个选题`);

    for (const maxAttempts of attemptSettings) {
      const samples: SampleResult[] = [];
      console.log(`[benchmark] === ${cardId} maxAttempts=${maxAttempts} ===`);
      for (let i = 0; i < samplesPerCard; i += 1) {
        const topic = topicsPool[i % topicsPool.length];
        const result = await composeOnce(cardId, topic, maxAttempts);
        result.sample = i + 1;
        samples.push(result);
        if (result.ok) {
          console.log(`[benchmark] sample ${i + 1}: ✅ tokens=${result.totalTokens} ms=${result.durationMs}`);
        } else {
          console.log(`[benchmark] sample ${i + 1}: ❌ stage=${result.stage} attempts=${result.attempts} tokens=${result.totalTokens} ms=${result.durationMs} msg=${result.errorMessage?.slice(0, 120)}`);
        }
      }
      reports.push(aggregate(cardId, maxAttempts, samples));
    }
  }

  console.log('\n========== BENCHMARK REPORT ==========\n');
  for (const report of reports) {
    console.log(formatReport(report));
    console.log('');
  }
  console.log('========== END REPORT ==========');

  const fs = await import('node:fs/promises');
  const outPath = `benchmark-result-${Date.now()}.json`;
  await fs.writeFile(outPath, JSON.stringify(reports, null, 2));
  console.log(`Report written to ${outPath}`);
}

main().catch(error => {
  console.error('benchmark crashed:', error);
  process.exit(1);
});
