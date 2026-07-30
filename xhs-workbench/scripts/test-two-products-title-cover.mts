/* eslint-disable no-console */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4000';

const cases = [
  {
    product_id: 'delf_b2_writing',
    label: '商品1 DELF B2写作',
    card_id: 'resource_01_grammar_parchment_red',
  },
  {
    product_id: 'tef_tcf_canada',
    label: '商品2 TEF/TCF Canada',
    card_id: 'resource_13_course_roadmap_blue',
  },
] as const;

const productFilter = process.env.TEST_PRODUCT_ID;
const selectedCases = productFilter
  ? cases.filter(testCase => testCase.product_id === productFilter)
  : cases;

const priority = ['search_pain', 'selling_point', 'product_showcase', 'narrow_knowledge'];
const results: unknown[] = [];

for (const testCase of selectedCases) {
  console.log(`\n=== ${testCase.label} / ${testCase.card_id} ===`);

  const topicsResponse = await post({
    action: 'topics',
    product_id: testCase.product_id,
    reference_card_id: testCase.card_id,
    direction: '',
  });
  const topics = Array.isArray(topicsResponse.topics) ? topicsResponse.topics : [];
  console.log(`topics=${topics.length} usage=${JSON.stringify(topicsResponse.usage || {})}`);
  topics.forEach((topic: any, index: number) => {
    console.log(`  ${index + 1}. [${topic.topic_type}/${topic.scope_level}] ${topic.topic}`);
  });

  const topic = topics.slice().sort((a: any, b: any) => {
    const ai = priority.indexOf(a.topic_type);
    const bi = priority.indexOf(b.topic_type);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  })[0];
  if (!topic) throw new Error(`${testCase.label}: no topic`);

  const composeResponse = await post({
    action: 'compose',
    product_id: testCase.product_id,
    reference_card_id: testCase.card_id,
    topic,
    max_attempts: 1,
  });
  const draft = composeResponse.draft;
  const summary = {
    label: testCase.label,
    product_id: testCase.product_id,
    card_id: testCase.card_id,
    topic: {
      type: topic.topic_type,
      scope: topic.scope_level,
      seed_id: topic.seed_id,
      topic: topic.topic,
      pain: topic.pain,
      promise: topic.content_promise,
      search_terms: topic.search_terms,
    },
    selected_title: draft?.selected_title,
    title_candidates: draft?.title_candidates?.map((item: any) => ({
      title: item.title,
      title_type: item.title_type,
      formula_id: item.formula_id,
      trigger_type: item.trigger_type,
    })),
    cover_title: draft?.cover?.title,
    cover_subtitle: draft?.cover?.subtitle,
    cover_item_count: draft?.cover?.sections?.reduce((sum: number, section: any) => sum + (section.items?.length || 0), 0),
    cover_sections: draft?.cover?.sections?.map((section: any) => ({
      side_label: section.side_label,
      heading: section.heading,
      items: section.items?.slice(0, 3),
    })),
    inner_pages: draft?.inner_pages?.map((page: any) => ({
      title: page.page_title,
      lead: page.lead,
      bullets: page.bullets?.slice(0, 3),
    })),
    caption: draft?.caption,
    caption_length: draft?.caption?.length,
    tags: draft?.tags,
    checks: draft?.checks,
    accuracy_audit: draft?.accuracy_audit,
    usage: composeResponse.usage,
  };
  results.push(summary);
  console.log(JSON.stringify({
    selected_title: summary.selected_title,
    title_candidates: summary.title_candidates,
    cover_title: summary.cover_title,
    cover_subtitle: summary.cover_subtitle,
    caption_length: summary.caption_length,
    tags: summary.tags,
    checks: summary.checks,
    usage: summary.usage,
  }, null, 2));
}

const outPath = `two-products-title-cover-${Date.now()}.json`;
await fs.writeFile(outPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`\nsaved ${outPath}`);

async function post(body: unknown): Promise<any> {
  const bodyPath = path.join(os.tmpdir(), `xhs-reference-post-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(bodyPath, JSON.stringify(body), 'utf8');
  let text = '';
  let status = 0;
  try {
    const result = await execFileAsync('curl.exe', [
      '-sS',
      '--max-time',
      '900',
      '-H',
      'Content-Type: application/json',
      '--data-binary',
      `@${bodyPath}`,
      '-w',
      '\nHTTP_STATUS:%{http_code}',
      `${baseUrl}/api/reference-studio`,
    ], { maxBuffer: 1024 * 1024 * 16, timeout: 16 * 60 * 1000 });
    const output = result.stdout;
    const match = output.match(/\nHTTP_STATUS:(\d{3})\s*$/);
    status = match ? Number(match[1]) : 0;
    text = match ? output.slice(0, match.index) : output;
  } finally {
    await fs.unlink(bodyPath).catch(() => {});
  }
  let json: any;
  try { json = JSON.parse(text); } catch { throw new Error(`invalid JSON: ${text.slice(0, 500)}`); }
  if (status < 200 || status >= 300) throw new Error(`${status}: ${json.error || text.slice(0, 500)}`);
  return json;
}
