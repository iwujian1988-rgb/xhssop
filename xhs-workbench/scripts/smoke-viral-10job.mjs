/* eslint-disable no-console */
// 爆款语料库接入后的 2-job smoke
// 验证：
//   1. composeDraft 不报错（viral-corpus 加载/调用 OK）
//   2. caption 不再统一以 "DELF B2备考时" 开头
//   3. 标题不再集中走同 1 个公式
//   4. 选题 seed_id 不重复（delf seed 50 条池生效）
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

async function postJson(body) {
  const r = await fetch(`${BASE_URL}/api/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

async function getBatch(batchId) {
  const r = await fetch(`${BASE_URL}/api/batch?batch_id=${encodeURIComponent(batchId)}`);
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, json };
}

function firstSentence(caption) {
  const t = (caption || '').trim();
  const stop = t.search(/[，。；！？\n]/);
  return stop > 0 ? t.slice(0, stop) : t.slice(0, 40);
}

async function main() {
  console.log(`[smoke-viral-10] base=${BASE_URL} 10 jobs across 5 cards (2 topics each)`);
  const t0 = Date.now();
  const plan = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: [
      'resource_01_grammar_parchment_red',
      'resource_02_grammar_white_green',
      'resource_05_grammar_clean_purple',
      'resource_09_notebook_warning',
      'resource_10_plain_text_experience',
    ],
    topics_per_card: 2,
    direction: '',
  });
  if (!plan.ok) {
    console.error(`plan failed: ${plan.json?.error || plan.status}`);
    process.exit(1);
  }
  const batch = plan.json.batch;
  console.log(`plan: batch=${batch.id} jobs=${batch.jobs.length} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);

  console.log('\n========== Phase 1: topics ==========');
  for (const j of batch.jobs) {
    console.log(`  #${j.seq} seed=${j.topic.seed_id} type=${j.topic.topic_type}`);
    console.log(`     topic: ${j.topic.topic}`);
  }

  await postJson({ action: 'run', batch_id: batch.id });
  const runT0 = Date.now();
  let poll = 0;
  let jobs = [];
  while (true) {
    poll += 1;
    const r = await getBatch(batch.id);
    if (!r.ok) break;
    jobs = r.json.jobs;
    const done = jobs.filter(j => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - runT0) / 1000).toFixed(0);
    console.log(`  [poll ${poll}] done=${done}/${jobs.length} elapsed=${elapsed}s`);
    if (done >= jobs.length) break;
    await new Promise(res => setTimeout(res, 4000));
    if (poll > 180) { console.error('timeout'); break; }
  }

  console.log('\n========== Phase 2: results ==========');
  const success = jobs.filter(j => j.status === 'success');
  console.log(`success: ${success.length}/${jobs.length}`);
  for (const j of success) {
    const d = j.draft;
    console.log(`\n--- #${j.seq} seed=${j.topic.seed_id} ---`);
    console.log(`  topic: ${j.topic.topic.slice(0, 60)}`);
    console.log(`  title: ${d.selected_title}`);
    console.log(`  cover: ${d.cover.title}`);
    console.log(`  caption opening: "${firstSentence(d.caption)}"`);
    console.log(`  tags[0..3]: ${(d.tags || []).slice(0, 4).join(' / ')}`);
    const sel = (d.title_candidates || []).find(c => c.title === d.selected_title);
    console.log(`  title formula: ${sel?.formula_id || '?'} (${sel?.trigger_type || ''})`);
    // Look for viral references in AI call logs (if available in checks)
    const checks = d.checks?.warnings || [];
    if (checks.length) console.log(`  warnings: ${checks.slice(0, 3).join(' | ')}`);
  }

  // Diversity stats
  console.log('\n========== Phase 3: diversity ==========');
  const openings = new Set(success.map(j => firstSentence(j.draft.caption)));
  console.log(`caption openings: ${openings.size}/${success.length} unique`);
  const formulas = new Set(success.map(j => {
    const sel = (j.draft.title_candidates || []).find(c => c.title === j.draft.selected_title);
    return sel?.formula_id;
  }));
  console.log(`title formulas: ${formulas.size}/${success.length} unique`);
  const seedIds = new Set(success.map(j => j.topic.seed_id));
  console.log(`seed_ids: ${seedIds.size}/${success.length} unique`);
  console.log(`total elapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
