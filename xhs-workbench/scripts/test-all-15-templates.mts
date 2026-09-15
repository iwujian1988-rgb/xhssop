/* eslint-disable no-console */
/**
 * 全模板自测：21 张 resource card × 1 topic = 21 jobs。
 * 覆盖所有 cover template，验收 pipeline 在每个模板上的稳定性。
 *
 * 用法：npx tsx scripts/test-all-15-templates.mts
 * 前置：dev server 在 :4000 上跑（flash 模型）。
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

// 全部 21 张 resource 卡，按 renderer 分组便于读结果
const ALL_CARDS = [
  // code 模板（7）
  { id: 'resource_01_grammar_parchment_red', renderer: 'parchment_dense_directory' },
  { id: 'resource_02_grammar_white_green', renderer: 'white_green_directory' },
  { id: 'resource_05_grammar_clean_purple', renderer: 'clean_purple_directory' },
  { id: 'resource_15_grammar_grid_purple', renderer: 'grid_purple_directory' },
  { id: 'resource_06_notes_course_offer', renderer: 'memo_offer' },
  { id: 'resource_10_plain_text_experience', renderer: 'plain_experience' },
  { id: 'resource_17_pain_quote', renderer: 'pain_quote_big' },
  { id: 'production_user_toc_dense', renderer: 'ielts_speaking_toc' },
  { id: 'production_user_formula_sheet', renderer: 'criminal_law_formula' },
  { id: 'production_user_three_column_phrase', renderer: 'english_grammar_grid' },
  { id: 'production_user_vocab_table', renderer: 'french_gender_vocab' },
  { id: 'production_user_handwritten_history', renderer: 'mao_article_notes' },
  { id: 'production_user_handwritten_grammar', renderer: 'english_grammar_notebook' },
  { id: 'production_user_question_bank', renderer: 'french_oral_question_bank' },
  { id: 'production_user_practice_sheet', renderer: 'french_a1_practice_sheet' },
  { id: 'production_user_dictionary_dense', renderer: 'sat_vocab_dictionary' },
  { id: 'production_user_roadmap_four_steps', renderer: 'ielts_task1_four_part' },
  // hybrid 模板（5）
  { id: 'resource_04_chalkboard_phrase_list', renderer: 'blackboard_phrase' },
  { id: 'resource_03_chalkboard_course', renderer: 'blackboard_offer' },
  { id: 'resource_07_question_words_parchment', renderer: 'word_flashcard' },
  { id: 'resource_09_notebook_warning', renderer: 'notebook_big_words' },
  { id: 'resource_11_delf_doc_analysis', renderer: 'document_analysis' },
  // image_to_image 模板（5）
  { id: 'resource_08_book_cover_fle', renderer: 'book_cover' },
  { id: 'resource_12_delf_vocab_table_overlay', renderer: 'vocab_table' },
  { id: 'resource_13_course_roadmap_blue', renderer: 'course_roadmap' },
  { id: 'resource_14_collocation_dense_green', renderer: 'collocation_dense' },
  { id: 'resource_16_official_notice', renderer: 'official_notice' },
];

async function postJson(body: Record<string, unknown>) {
  const response = await fetch(`${BASE_URL}/api/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, json };
}

async function getBatch(batchId: string) {
  const response = await fetch(`${BASE_URL}/api/batch?batch_id=${encodeURIComponent(batchId)}`);
  const json = await response.json().catch(() => ({}));
  return { ok: response.ok, json };
}

async function main() {
  console.log(`[all-17-test] base=${BASE_URL} cards=${ALL_CARDS.length}`);

  const t0 = Date.now();
  console.log('[all-17-test] === plan ===');
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: ALL_CARDS.map(c => c.id),
    topics_per_card: 1,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`[all-17-test] plan 失败：${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch;
  const planElapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`[all-17-test] plan: batch=${batch.id} jobs=${batch.jobs.length} 耗时=${planElapsed}s`);

  const runResult = await postJson({ action: 'run', batch_id: batch.id });
  console.log(`[all-17-test] runner: ${JSON.stringify(runResult.json)}`);

  const runStartedAt = Date.now();
  let lastSummary: any = null;
  let lastJobs: any[] = [];
  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) {
      console.error(`[all-17-test] poll 失败`);
      break;
    }
    lastSummary = result.json.batch;
    lastJobs = result.json.jobs;
    const done = lastJobs.filter((j: any) => j.status === 'success' || j.status === 'failed').length;
    const ok = lastJobs.filter((j: any) => j.status === 'success').length;
    const fail = lastJobs.filter((j: any) => j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    const running = lastJobs.find((j: any) => j.status === 'running');
    console.log(`[all-17-test] poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length} ✅${ok} ❌${fail} running=${running?.reference_card_id || '-'}`);
    if (lastSummary.status === 'done') break;
    if (pollCount > 360) break; // 60 min cap
    await sleep(10000);
  }

  console.log('\n========== ALL 17 TEMPLATES REPORT ==========\n');
  let ok = 0, fail = 0;
  let totalTokens = 0;
  const byRenderer: Record<string, { status: string; card: string; msg?: string; tokens?: number }> = {};
  for (const job of lastJobs) {
    const card = ALL_CARDS.find(c => c.id === job.reference_card_id);
    const renderer = card?.renderer || job.reference_card_id;
    const tag = job.status === 'success' ? '✅' : '❌';
    const stage = job.status === 'success' ? '' : ` stage=${job.failure?.stage}`;
    const img = job.cover_image_url ? ' [image]' : '';
    console.log(`${tag} ${job.id} ${job.reference_card_id} (${renderer})${img}${stage} tokens=${job.usage?.total_tokens || 0}`);
    byRenderer[renderer] = {
      status: job.status,
      card: job.reference_card_id,
      msg: job.failure?.message?.slice(0, 200),
      tokens: job.usage?.total_tokens || 0,
    };
    if (job.status === 'success') ok += 1;
    else {
      fail += 1;
      console.log(`     msg: ${job.failure?.message?.slice(0, 200)}`);
    }
    totalTokens += job.usage?.total_tokens || 0;
  }
  console.log(`\n通过率：${ok}/${lastJobs.length} = ${((ok / lastJobs.length) * 100).toFixed(0)}%`);
  console.log(`累计 token：${totalTokens.toLocaleString()}`);

  // 落盘汇总
  const fs = await import('node:fs/promises');
  await fs.writeFile(`all-15-result-${Date.now()}.json`, JSON.stringify({
    batch: lastSummary,
    jobs: lastJobs,
    byRenderer,
  }, null, 2));
  console.log(`详细数据写入 all-15-result-*.json`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error('all-15-test crashed:', error);
  process.exit(1);
});
