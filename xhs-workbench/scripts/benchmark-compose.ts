/* eslint-disable no-console */
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

import { composeWithRetry, type ComposeOutcome } from '../src/lib/compose-with-retry';
import { generateTopics } from '../src/lib/reference-compose';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { compactProductContext, retrieveProductFacts } from '../src/lib/product-fact-retrieval';
import type { ProductId } from '../src/types/data';
import type { MigratedTopic } from '../src/types/reference-workflow';

interface SampleResult {
  sample: number;
  ok: boolean;
  stage: string;
  attempts: number;
  totalTokens: number;
  durationMs: number;
  autofixCount: number;
  autofixEvents: string[];
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
  autofixHitRate: number;
  autofixTotalEvents: number;
}

const DEFAULT_CARDS = [
  'resource_06_notes_course_offer',
  'resource_11_delf_doc_analysis',
  'resource_10_plain_text_experience',
  'resource_09_notebook_warning',
];

const PRODUCT_ID: ProductId = 'delf_b2_writing';

async function main() {
  const args = process.argv.slice(2);
  const cardIds = args[0] ? args[0].split(',').map(s => s.trim()).filter(Boolean) : DEFAULT_CARDS;
  const samplesPerCard = Number(args[1] || 5);
  const maxAttemptsList = args[2] ? Number(args[2].split(',').map(s => s.trim()).filter(Boolean)[0]) : null;

  const attemptSettings = maxAttemptsList ? [maxAttemptsList] : [1, 3];
  console.log(`[benchmark] cards=${cardIds.join(',')} samples=${samplesPerCard} attemptSettings=${attemptSettings.join(',')}`);

  const facts = await loadProductFacts(PRODUCT_ID);
  const productContext = compactProductContext(facts);

  const reports: BenchmarkReport[] = [];

  for (const cardId of cardIds) {
    const card = getCompetitorCreativeCard(cardId);
    if (!card || !card.supported) {
      console.log(`[benchmark] skip ${cardId} (unsupported card)`);
      continue;
    }
    const spec = getCoverTemplateSpec(card.renderer_id);
    console.log(`[benchmark] card=${cardId} renderer=${card.renderer_id} family=${spec?.family} renderMode=${spec?.renderMode}`);

    // Pre-fetch topics - one batched call gives us enough topics to feed all
    // samples, so we measure compose specifically rather than topics latency.
    const topicsPool: MigratedTopic[] = [];
    while (topicsPool.length < samplesPerCard) {
      const topics = await generateTopics({
        productId: PRODUCT_ID,
        card,
        productContext,
        direction: '',
      }).catch(cause => {
        console.log(`[benchmark] topics call failed: ${cause instanceof Error ? cause.message : 'unknown'}`);
        return [] as MigratedTopic[];
      });
      if (!topics.length) break;
      topicsPool.push(...topics);
    }
    if (topicsPool.length < samplesPerCard) {
      console.log(`[benchmark] ${cardId}: only got ${topicsPool.length} topics, need ${samplesPerCard}; skipping`);
      continue;
    }

    for (const maxAttempts of attemptSettings) {
      const samples: SampleResult[] = [];
      console.log(`[benchmark] === ${cardId} maxAttempts=${maxAttempts} ===`);

      for (let i = 0; i < samplesPerCard; i += 1) {
        const topic = topicsPool[i % topicsPool.length];
        const evidence = retrieveProductFacts(facts, topic);
        const autofixEvents: string[] = [];
        const autofixCapture = (text: string) => {
          if (text.startsWith('[autofix-summary]')) {
            const match = text.match(/count=(\d+)/);
            const count = match ? Number(match[1]) : 0;
            const eventsMatch = text.match(/events=(.+)$/);
            autofixEvents.push(`count=${count}`);
            if (eventsMatch) autofixEvents.push(eventsMatch[1]);
          }
        };
        const originalInfo = console.info;
        console.info = (msg: string) => {
          if (typeof msg === 'string') autofixCapture(msg);
          originalInfo(msg);
        };

        const start = Date.now();
        let outcome: ComposeOutcome;
        try {
          outcome = await composeWithRetry(
            { productId: PRODUCT_ID, card, topic, evidence },
            { maxAttempts },
          );
        } catch (cause) {
          outcome = {
            ok: false,
            failure: {
              stage: 'unknown',
              message: cause instanceof Error ? cause.message : 'compose 抛出异常',
              attempts: 0,
              usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 },
            },
          };
        }
        console.info = originalInfo;
        const durationMs = Date.now() - start;

        if (outcome.ok) {
          samples.push({
            sample: i + 1,
            ok: true,
            stage: 'success',
            attempts: outcome.attempts,
            totalTokens: outcome.usage.total_tokens,
            durationMs,
            autofixCount: autofixEvents.filter(e => e.startsWith('count=')).reduce((sum, e) => sum + Number(e.replace('count=', '')) || 0, 0),
            autofixEvents,
          });
          console.log(`[benchmark] sample ${i + 1}: ✅ attempts=${outcome.attempts} tokens=${outcome.usage.total_tokens} ms=${durationMs} autofix=${autofixEvents.length ? autofixEvents.join(' | ') : '0'}`);
        } else {
          samples.push({
            sample: i + 1,
            ok: false,
            stage: outcome.failure.stage,
            attempts: outcome.failure.attempts,
            totalTokens: outcome.failure.usage.total_tokens,
            durationMs,
            autofixCount: 0,
            autofixEvents,
            errorMessage: outcome.failure.message.slice(0, 200),
          });
          console.log(`[benchmark] sample ${i + 1}: ❌ stage=${outcome.failure.stage} attempts=${outcome.failure.attempts} tokens=${outcome.failure.usage.total_tokens} ms=${durationMs} msg=${outcome.failure.message.slice(0, 120)}`);
        }
      }

      reports.push(aggregateReport(cardId, maxAttempts, samples));
    }
  }

  console.log('\n========== BENCHMARK REPORT ==========\n');
  for (const report of reports) {
    console.log(formatReport(report));
  }
  console.log('========== END REPORT ==========');

  // Write JSON for later parsing
  const fs = await import('node:fs/promises');
  const outPath = `benchmark-result-${Date.now()}.json`;
  await fs.writeFile(outPath, JSON.stringify(reports, null, 2));
  console.log(`Report written to ${outPath}`);
}

function aggregateReport(cardId: string, maxAttempts: number, samples: SampleResult[]): BenchmarkReport {
  const successCount = samples.filter(s => s.ok).length;
  const failureCount = samples.length - successCount;
  const stageBreakdown: Record<string, number> = {};
  for (const sample of samples) {
    const key = sample.ok ? 'success' : sample.stage;
    stageBreakdown[key] = (stageBreakdown[key] || 0) + 1;
  }
  const totalTokens = samples.reduce((sum, s) => sum + s.totalTokens, 0);
  const totalDuration = samples.reduce((sum, s) => sum + s.durationMs, 0);
  const autofixTotalEvents = samples.reduce((sum, s) => sum + s.autofixCount, 0);
  const samplesWithAutofix = samples.filter(s => s.autofixCount > 0).length;
  return {
    cardId,
    maxAttempts,
    samples,
    successCount,
    failureCount,
    successRate: samples.length ? successCount / samples.length : 0,
    stageBreakdown,
    avgTokens: samples.length ? Math.round(totalTokens / samples.length) : 0,
    avgDurationMs: samples.length ? Math.round(totalDuration / samples.length) : 0,
    autofixHitRate: samples.length ? samplesWithAutofix / samples.length : 0,
    autofixTotalEvents,
  };
}

function formatReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`### ${report.cardId} (maxAttempts=${report.maxAttempts})`);
  lines.push(`  成功率: ${report.successCount}/${report.samples.length} = ${(report.successRate * 100).toFixed(1)}%`);
  lines.push(`  阶段分布: ${Object.entries(report.stageBreakdown).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  lines.push(`  平均 token: ${report.avgTokens.toLocaleString()}`);
  lines.push(`  平均耗时: ${(report.avgDurationMs / 1000).toFixed(1)}s`);
  lines.push(`  autofix 命中率: ${(report.autofixHitRate * 100).toFixed(1)}% (累计 ${report.autofixTotalEvents} 个修复事件)`);
  return lines.join('\n');
}

main().catch(error => {
  console.error('benchmark crashed:', error);
  process.exit(1);
});
