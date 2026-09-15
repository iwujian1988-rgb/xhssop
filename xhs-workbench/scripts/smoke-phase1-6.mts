/* eslint-disable no-console */
/**
 * Phase 1-6 smoke test: 5-job batch on same card
 * Verifies:
 *   - caption openings vary (no more 100% "DELF B2 prep time")
 *   - story template no longer starts with "last mock exam"
 *   - topics no longer have "database / organized" meta-pain
 *   - title formulas spread out
 *   - tags have no emoji
 *   - cross-batch topic similarity warning triggers
 *
 * Usage: npx tsx scripts/smoke-phase1-6.mts
 */
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import fs from 'node:fs';

const BASE_URL = process.env.BENCHMARK_BASE_URL || 'http://localhost:4000';

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

function firstSentence(caption: string): string {
  const trimmed = caption.trim();
  const stop = trimmed.search(/[，。；！？\n]/);
  return stop > 0 ? trimmed.slice(0, stop) : trimmed.slice(0, 40);
}

async function main() {
  console.log(`[smoke] base=${BASE_URL} 5 jobs on card=resource_02_grammar_white_green`);
  const t0 = Date.now();
  const planResult = await postJson({
    action: 'plan',
    product_id: 'delf_b2_writing',
    card_ids: ['resource_02_grammar_white_green'],
    topics_per_card: 5,
    direction: '',
  });
  if (!planResult.ok) {
    console.error(`plan failed: ${planResult.json?.error || planResult.status}`);
    process.exit(1);
  }
  const batch = planResult.json.batch;
  console.log(`plan: batch=${batch.id} jobs=${batch.jobs.length} elapsed=${((Date.now() - t0) / 1000).toFixed(0)}s`);

  console.log('\n========== Phase 2: topic text ==========');
  for (const job of batch.jobs) {
    console.log(`  #${job.seq} seed=${job.topic.seed_id} type=${job.topic.topic_type}`);
    console.log(`     topic: ${job.topic.topic}`);
  }
  const metaPainRe = /资料库|整理好的|系统|省时间|资料太[乱散]|高效备考/;
  const metaHits = batch.jobs.filter((j: any) => metaPainRe.test(j.topic.topic) || metaPainRe.test(j.topic.pain || ''));
  console.log(`  meta-pain hits: ${metaHits.length}/${batch.jobs.length}`);

  await postJson({ action: 'run', batch_id: batch.id });
  const runStartedAt = Date.now();
  let pollCount = 0;
  let lastJobs: any[] = [];
  while (true) {
    pollCount += 1;
    const result = await getBatch(batch.id);
    if (!result.ok) break;
    lastJobs = result.json.jobs;
    const done = lastJobs.filter((j: any) => j.status === 'success' || j.status === 'failed').length;
    const elapsed = ((Date.now() - runStartedAt) / 1000).toFixed(0);
    console.log(`poll #${pollCount} elapsed=${elapsed}s done=${done}/${lastJobs.length}`);
    if (result.json.batch.status === 'done') break;
    if (pollCount > 60) break;
    await sleep(10000);
  }

  console.log('\n========== Phase 1: caption opening ==========');
  const openingCounts: Record<string, number> = {};
  let storyWithShangci = 0;
  let storyCount = 0;
  for (const job of lastJobs) {
    if (job.status !== 'success') continue;
    const c = job.draft?.caption || '';
    const opening = firstSentence(c);
    console.log(`  #${job.seq}: ${opening}`);
    openingCounts[opening] = (openingCounts[opening] || 0) + 1;
    if (/整理出来这几点|所以整理出来这几点/.test(c)) {
      storyCount += 1;
      if (/上次模考/.test(c)) storyWithShangci += 1;
    }
  }
  const successJobs = lastJobs.filter((j: any) => j.status === 'success');
  const uniqueOpenings = Object.keys(openingCounts).length;
  console.log(`  unique openings: ${uniqueOpenings}/${successJobs.length}`);
  console.log(`  story "last mock" hits: ${storyWithShangci}/${storyCount}`);

  console.log('\n========== Phase 3: title formula ==========');
  const formulaCounts: Record<string, number> = {};
  for (const job of lastJobs) {
    if (job.status !== 'success') continue;
    const selected = job.draft?.selected_title || '';
    const candidates = job.draft?.title_candidates || [];
    const selectedCandidate = candidates.find((c: any) => c.title === selected);
    const fid = selectedCandidate?.formula_id || 'unknown';
    formulaCounts[fid] = (formulaCounts[fid] || 0) + 1;
    console.log(`  #${job.seq} formula=${fid} trigger=${selectedCandidate?.trigger_type || ''} title="${selected}"`);
  }
  const uniqueFormulas = Object.keys(formulaCounts).length;
  console.log(`  unique formulas: ${uniqueFormulas}/${successJobs.length}`);

  console.log('\n========== Phase 1: tag emoji ==========');
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  let emojiHit = 0;
  for (const job of lastJobs) {
    if (job.status !== 'success') continue;
    const tags = job.draft?.tags || [];
    const hits = tags.filter((t: string) => emojiRe.test(t));
    if (hits.length) {
      emojiHit += 1;
      console.log(`  #${job.seq} emoji tags: ${hits.join(', ')}`);
    }
  }
  console.log(`  emoji hits: ${emojiHit}/${successJobs.length}`);

  console.log('\n========== Phase 5/6: warnings ==========');
  for (const job of lastJobs) {
    if (job.status !== 'success') continue;
    const ws = job.draft?.checks?.warnings || [];
    if (ws.length) console.log(`  #${job.seq} warnings: ${ws.join(', ')}`);
  }

  const success = successJobs.length;
  console.log('\n========== summary ==========');
  console.log('success rate: ' + success + '/' + lastJobs.length);

  fs.writeFileSync(`smoke-phase1-6-${Date.now()}.json`, JSON.stringify({
    generated_at: new Date().toISOString(),
    batch_id: batch.id,
    jobs: lastJobs.map((j: any) => ({
      id: j.id, status: j.status, seed: j.topic.seed_id, topic_type: j.topic.topic_type,
      topic: j.topic.topic,
      caption_opening: j.status === 'success' ? firstSentence(j.draft?.caption || '') : null,
      selected_title: j.draft?.selected_title,
      cover_title: j.draft?.cover?.title,
      cover_subtitle: j.draft?.cover?.subtitle,
      tags: j.draft?.tags,
      formula_id: (j.draft?.title_candidates || []).find((c: any) => c.title === j.draft?.selected_title)?.formula_id,
      warnings: j.draft?.checks?.warnings,
      failure: j.failure?.message,
    })),
  }, null, 2));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => { console.error('crashed:', error); process.exit(1); });
