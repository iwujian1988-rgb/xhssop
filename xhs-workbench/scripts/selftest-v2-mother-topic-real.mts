import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]!.replace(/^['"]|['"]$/g, '');
}

import { standardCreativeCards } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { planBatchTopicMap } from '../src/lib/v2/batch-topic-map';
import { matchTopicCoordinatesToCoverSlots } from '../src/lib/v2/cover-topic-matcher';
import { BATCH_TOPIC_EXPRESSIONS, planBatchEditorialTasks } from '../src/lib/v2/batch-editorial-plan';
import { generateMotherTopics, MOTHER_PROBLEM_FAMILY_LABELS } from '../src/lib/v2/mother-topic-stage';
import { demandTypeForBatchIndex, granularityForBatchIndex, valueTypeForBatchIndex } from '../src/lib/v2/topic-value';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

const count = Number(process.env.SELFTEST_COUNT || 12);

function redactEndpoint(value: string) {
  try { const url = new URL(value); return `${url.protocol}//${url.host}${url.pathname}`; } catch { return '[invalid-url]'; }
}

function errorDetails(error: unknown) {
  const item = error instanceof Error ? error : new Error(String(error));
  const cause = item.cause && typeof item.cause === 'object' ? item.cause as Record<string, unknown> : undefined;
  return { name: item.name, message: item.message, cause: cause?.message || String(item.cause || ''), causeCode: cause?.code || '', stack: item.stack || '' };
}

async function realModelPreflight() {
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  const model = process.env.OPENAI_MODEL || 'qwen3.7-flash';
  console.error(JSON.stringify({
    REAL_MODEL_PREFLIGHT: 'START', node: process.execPath, nodeVersion: process.version,
    shell: process.env.ComSpec || process.env.SHELL || '', model,
    endpoint: redactEndpoint(baseUrl), OPENAI_API_KEY_PRESENT: Boolean(process.env.OPENAI_API_KEY),
    OPENAI_BASE_URL_PRESENT: Boolean(process.env.OPENAI_BASE_URL), AI_BRIDGE_DIR_PRESENT: Boolean(process.env.AI_BRIDGE_DIR),
    HTTP_PROXY_PRESENT: Boolean(process.env.HTTP_PROXY || process.env.http_proxy),
    HTTPS_PROXY_PRESENT: Boolean(process.env.HTTPS_PROXY || process.env.https_proxy),
    NO_PROXY_PRESENT: Boolean(process.env.NO_PROXY || process.env.no_proxy),
  }));
  const started = Date.now();
  try {
    const result = await callOpenAICompatibleJsonWithUsage<{ ok?: boolean }>([
      { role: 'system', content: '只返回 JSON：{"ok":true}' },
      { role: 'user', content: '返回最小 JSON。' },
    ], { maxTokens: 16, retries: 1, temperature: 0 });
    console.error(JSON.stringify({ REAL_MODEL_PREFLIGHT: 'PASS', model, latency_ms: Date.now() - started, usage: result.usage }));
  } catch (error) {
    const details = errorDetails(error);
    const haystack = `${details.name} ${details.message} ${details.cause} ${details.causeCode}`.toLowerCase();
    const errorType = /enotfound|eai_again|dns/.test(haystack) ? 'DNS' : /proxy/.test(haystack) ? 'PROXY' : /tls|certificate|ssl/.test(haystack) ? 'TLS' : /eacces|eperm|permission|access denied|forbidden|401|403/.test(haystack) ? 'PERMISSION_OR_AUTH' : /timeout|abort/.test(haystack) ? 'TIMEOUT' : /fetch failed|network|socket|connect/.test(haystack) ? 'NETWORK' : 'UNKNOWN';
    console.error(JSON.stringify({ REAL_MODEL_PREFLIGHT: 'FAIL', errorType, ...details }));
    throw new Error(`REAL_MODEL_PREFLIGHT failed (${errorType}): ${details.name}: ${details.message}`);
  }
}

function normalizeTopic(value: string) { return value.toLocaleLowerCase().replace(/[\s，。！？、：；,.!?:;“”‘’]/g, ''); }

function executionCollapse(task: { topic: string; specificAsset: string; expandContents: string[] }, motherTopic: string, proposedSubtopics: string[]) {
  if (normalizeTopic(task.topic) !== normalizeTopic(motherTopic)) return { collapse: true, reason: '执行阶段公开Topic未逐字保留母题' };
  const executionText = normalizeTopic(`${task.specificAsset} ${task.expandContents.join(' ')}`);
  const matchedSubtopics = proposedSubtopics.filter(subtopic => topicSignals(subtopic).some(signal => executionText.includes(signal)));
  if (matchedSubtopics.length <= 1) return { collapse: true, reason: '执行资产只覆盖母题中的一个局部子题' };
  return { collapse: false, reason: '' };
}

function topicSignals(value: string): string[] {
  const normalized = normalizeTopic(value).replace(/[与和及]/g, '');
  const cjk = Array.from(normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)).flatMap(match => {
    const text = match[0]!;
    const grams = Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2));
    return [...grams, text.length > 4 ? text.slice(0, 4) : text];
  });
  const latin = normalized.match(/[a-z]{3,}/g) || [];
  const stop = new Set(['如何', '怎么', '什么', '正确', '完整', '高效', '方法', '技巧', '路径', '步骤', '建立', '真实', '不同', '核心', '深入', '一个', '多个']);
  return [...new Set([...cjk, ...latin])].filter(signal => signal.length >= 2 && !stop.has(signal));
}

function executionCoverage(task: { specificAsset: string; expandContents: string[] }, proposedSubtopics: string[]) {
  const executionText = normalizeTopic(`${task.specificAsset} ${task.expandContents.join(' ')}`);
  const covered = proposedSubtopics.filter(subtopic => topicSignals(subtopic).some(signal => executionText.includes(signal)));
  const ratio = proposedSubtopics.length ? covered.length / proposedSubtopics.length : 0;
  const coverage = ratio >= 0.75 ? 'full' : ratio >= 0.5 ? 'partial' : 'narrow';
  return { coverage, reason: `覆盖${covered.length}/${proposedSubtopics.length}个母题二级模块` } as const;
}

async function main() {
  await realModelPreflight();
  console.error('[mother-regression] 1/4 生成12个coordinate');
  const slots = standardCreativeCards.filter(card => card.supported).slice(0, 6)
    .flatMap(card => Array.from({ length: 2 }, (_, index) => ({ slotId: `${card.id}:${index}`, card, capability: getCapabilityFallback(card) })));
  const coordinatePlan = await planBatchTopicMap({ productId: 'delf_b2_writing', count, usageHints: [] });
  console.error('[mother-regression] 2/4 coordinate完成，匹配封面槽位');
  const matched = matchTopicCoordinatesToCoverSlots(coordinatePlan.coordinates, slots);
  const entries = matched.matches.map((match, index) => ({
    coordinate: match.coordinate, cardId: match.card.id, cardName: match.card.name, capability: match.capability,
    topicIndex: Number(match.slotId.slice(match.slotId.lastIndexOf(':') + 1)),
    topicExpression: BATCH_TOPIC_EXPRESSIONS[index % BATCH_TOPIC_EXPRESSIONS.length]!,
    valueType: valueTypeForBatchIndex(index), demandType: demandTypeForBatchIndex(index), topicGranularity: granularityForBatchIndex(index),
  }));
  const lockedMothers = await generateMotherTopics('delf_b2_writing', entries.map(entry => ({
    taskId: `batch_${entry.cardId}_${entry.topicIndex + 1}`,
    domainId: entry.coordinate.domainId,
    demandType: entry.demandType,
  })), { acceptBelowThreshold: true });
  console.error('[mother-regression] 3/4 生成Mother Topic和Execution');
  const result = await planBatchEditorialTasks({ productId: 'delf_b2_writing', entries, lockedMotherTopics: lockedMothers.topics });
  console.error('[mother-regression] 4/4 整理并落盘');
  const rows = result.tasks.map(task => {
    const collapse = executionCollapse(task, task.lockedMotherTopic, task.proposedSubtopics);
    const coverage = executionCoverage(task, task.proposedSubtopics);
    return {
      id: task.taskId, status: 'PASS', failureStage: null, failureReason: null, repairStats: {}, domain: task.coordinate.domainId, problemFamily: MOTHER_PROBLEM_FAMILY_LABELS[task.coordinate.domainId],
      demandType: task.demandType, valueType: task.valueType,
      motherTopic: task.lockedMotherTopic, motherTopicRationale: task.motherTopicRationale, proposedSubtopics: task.proposedSubtopics,
      motherTopicScore: task.motherTopicScore, finalPublicTopic: task.topic, specificAsset: task.specificAsset,
      contentAngle: task.contentAngle, expandContents: task.expandContents, expandContentPlans: task.expandContentPlans,
      scene: task.userScene, mechanism: task.coordinate.mechanismId, object: task.coordinate.objectId,
      motherTopicScoreBand: task.motherTopicScore >= 80 ? '80-100' : task.motherTopicScore >= 60 ? '60-79' : '0-59',
      executionCollapse: collapse.collapse, collapseReason: collapse.reason,
      executionCoverage: coverage.coverage, coverageReason: coverage.reason,
      motherTopicPreserved: normalizeTopic(task.topic) === normalizeTopic(task.lockedMotherTopic), subpointRisk: task.subpointRisk,
    };
  });
  const failedRows = (result.failedJobs || []).map((failure: any) => ({
    id: failure.jobId,
    status: failure.status,
    failureStage: failure.failureStage,
    failureReason: failure.failureReason,
    repairStats: failure.repairStats || {},
    result: null,
  }));
  const allRows = [...rows, ...failedRows];
  const report = {
    total: allRows.length, rows: allRows,
    stats: {
      sample_total: count,
      completed_jobs: rows.length,
      pass_jobs: rows.length,
      metadata_unrecoverable: failedRows.filter(row => row.status === 'METADATA_UNRECOVERABLE').length,
      content_block_unrecoverable: failedRows.filter(row => row.status === 'CONTENT_BLOCK_UNRECOVERABLE').length,
      other_error: failedRows.filter(row => row.status === 'OTHER_ERROR').length,
      batch_fatal: 0,
      job_success_rate: rows.length / count,
      mother_80_100: rows.filter(row => row.motherTopicScore >= 80).length,
      mother_60_79: rows.filter(row => row.motherTopicScore >= 60 && row.motherTopicScore < 80).length,
      mother_0_59: rows.filter(row => row.motherTopicScore < 60).length,
      mother_execution_collapse: rows.filter(row => row.executionCollapse).length,
      executionCoverage_full: rows.filter(row => row.executionCoverage === 'full').length,
      executionCoverage_partial: rows.filter(row => row.executionCoverage === 'partial').length,
      executionCoverage_narrow: rows.filter(row => row.executionCoverage === 'narrow').length,
      motherTopicPreserved: rows.filter(row => row.motherTopicPreserved).length,
      finalPublicTopic_downward: rows.filter(row => row.executionCollapse || row.executionCoverage === 'narrow').length,
      subpointRisk_high: rows.filter(row => row.subpointRisk === 'high').length,
      model_calls: coordinatePlan.usage.calls + lockedMothers.usage.calls + result.usage.calls,
      total_tokens: coordinatePlan.usage.total_tokens + lockedMothers.usage.total_tokens + result.usage.total_tokens,
      abnormal_calls: 0,
      ...(result.diagnostics || {}),
    },
    warnings: [...coordinatePlan.warnings, ...matched.warnings.map(item => item.message), ...result.warnings],
    repairTraces: result.repairTraces || [],
    usage: { coordinate: coordinatePlan.usage, editorial: result.usage },
  };
  await writeFile('.tmp-mother-topic-real-result.json', JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`MOTHER_RESULT_WRITTEN ${report.total}\n`);
}

async function recheckExisting() {
  const report = JSON.parse(readFileSync('.tmp-mother-topic-real-result.json', 'utf8')) as { rows: any[]; stats: Record<string, number>; [key: string]: unknown };
  report.rows = report.rows.map(row => {
    const collapse = executionCollapse({ topic: row.finalPublicTopic, specificAsset: row.specificAsset, expandContents: row.expandContents }, row.motherTopic, row.proposedSubtopics);
    const coverage = executionCoverage({ specificAsset: row.specificAsset, expandContents: row.expandContents }, row.proposedSubtopics);
    return { ...row, executionCollapse: collapse.collapse, collapseReason: collapse.reason, executionCoverage: coverage.coverage, coverageReason: coverage.reason, motherTopicPreserved: normalizeTopic(row.finalPublicTopic) === normalizeTopic(row.motherTopic) };
  });
  report.stats = { ...report.stats,
    mother_execution_collapse: report.rows.filter(row => row.executionCollapse).length,
    executionCoverage_full: report.rows.filter(row => row.executionCoverage === 'full').length,
    executionCoverage_partial: report.rows.filter(row => row.executionCoverage === 'partial').length,
    executionCoverage_narrow: report.rows.filter(row => row.executionCoverage === 'narrow').length,
    motherTopicPreserved: report.rows.filter(row => row.motherTopicPreserved).length,
    finalPublicTopic_downward: report.rows.filter(row => row.executionCollapse || row.executionCoverage === 'narrow').length,
  };
  await writeFile('.tmp-mother-topic-real-result.json', JSON.stringify(report, null, 2), 'utf8');
  process.stdout.write(`MOTHER_RESULT_RECHECKED ${report.rows.length}\n`);
}

(process.argv.includes('--recheck') ? recheckExisting() : main()).catch(async error => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  await writeFile('.tmp-mother-topic-real-error.json', message, 'utf8').catch(() => undefined);
  console.error('[mother-regression] FAILED\n' + message);
  process.exitCode = 1;
});
