/* eslint-disable no-console */
import fs from 'node:fs/promises';

const base = process.env.TEST_BASE_URL || 'http://localhost:4077';
const cases = [
  { product_id: 'delf_b2_writing', reference_card_id: 'resource_01_grammar_parchment_red' },
  { product_id: 'tef_tcf_canada', reference_card_id: 'resource_02_grammar_white_green' },
] as const;

const caseFilter = process.env.TEST_PRODUCT_ID;
const selectedCases = caseFilter ? cases.filter(item => item.product_id === caseFilter) : cases;
const output: Array<Record<string, unknown>> = [];
const outputPath = process.env.TEST_OUTPUT || 'v2-real-smoke-latest.json';
const reuseSource = process.env.TEST_REUSE_TOPICS
  ? JSON.parse(await fs.readFile(process.env.TEST_REUSE_TOPICS, 'utf8')) as Array<Record<string, any>>
  : [];
for (const testCase of selectedCases) {
  const started = Date.now();
  try {
    const reusable = reuseSource.find(item => item.product_id === testCase.product_id && item.reference_card_id === testCase.reference_card_id && item.topic);
    const topics = reusable
      ? { topics: [reusable.topic], usage: reusable.topic_usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 } }
      : await post('/api/reference-studio', { action: 'topics', ...testCase, direction: '' });
    const selected = topics.topics[0];
    const progress = { ...testCase, status: 'topics_ready', topic_usage: topics.usage, topic: selected };
    output.push(progress);
    await persist();
    const composed = await post('/api/reference-studio', { action: 'compose', ...testCase, topic: selected });
    output[output.length - 1] = {
      ...testCase,
      status: 'success',
      elapsed_ms: Date.now() - started,
      topic_usage: topics.usage,
      usage: composed.usage,
      topic: selected,
      draft: composed.draft,
      artifacts: composed.artifacts,
      warnings: composed.warnings,
    };
    await persist();
    console.log(`[v2-real] ${testCase.product_id} ${Math.round((Date.now() - started) / 1000)}s ${composed.draft.selected_title}`);
  } catch (cause) {
    const current = output[output.length - 1];
    output[output.length - 1] = {
      ...(current?.product_id === testCase.product_id ? current : testCase),
      status: 'failed',
      elapsed_ms: Date.now() - started,
      error: cause instanceof Error ? cause.message : String(cause),
    };
    await persist();
    console.error(`[v2-real] ${testCase.product_id} failed:`, cause);
  }
}
console.log(`[v2-real] wrote ${outputPath}`);

async function persist() {
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
}

async function post(path: string, body: unknown) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
