import fs from 'node:fs/promises';
import path from 'node:path';

const files = await fs.readdir('.');
const latest = files.filter(f => f.startsWith('product2-all-cards-') && f.endsWith('.json'))
  .map(f => ({ f, mtime: fs.stat(f).then(s => s.mtimeMs) }))
  .sort((a, b) => 0); // sort not needed; we'll await mtimes below

let latestFile = '';
let latestMtime = 0;
for (const f of files.filter(f => f.startsWith('product2-all-cards-') && f.endsWith('.json'))) {
  const s = await fs.stat(f);
  if (s.mtimeMs > latestMtime) { latestMtime = s.mtimeMs; latestFile = f; }
}
if (!latestFile) { console.error('no product2-all-cards-*.json found'); process.exit(1); }

const data = JSON.parse(await fs.readFile(latestFile, 'utf8')) as any[];

const informationals = new Set([
  'template_capacity_invalid',
  'cover_density_too_low',
  'title_cover_topic_mismatch',
  'product_claim_without_evidence',
]);

let clean = 0;
let warn = 0;
let fail = 0;
const rows: any[] = [];

for (const item of data) {
  if (item.stage === 'topics' || item.stage === 'compose' || item.stage === 'topic-empty') {
    fail += 1;
    rows.push({ ...item, verdict: 'CRASH' });
    continue;
  }
  const blocks = (item.blocks || []).filter((b: string) => !informationals.has(b));
  const warnings = (item.warnings || []).concat((item.blocks || []).filter((b: string) => informationals.has(b)));
  const verdict = !item.has_forbidden && item.has_required && blocks.length === 0
    ? (warnings.length ? 'OK(warn)' : 'OK')
    : 'FAIL';
  if (verdict === 'OK' || verdict === 'OK(warn)') clean += 1;
  else if (verdict === 'FAIL') fail += 1;
  rows.push({
    card_id: item.card_id,
    renderer: item.renderer_id,
    verdict,
    cover_title: item.cover_title,
    seed_id: item.seed_id,
    has_forbidden: item.has_forbidden,
    has_required: item.has_required,
    blocks,
    warnings,
    accuracy_approved: item.accuracy_audit?.approved,
    accuracy_corrected: item.accuracy_audit?.corrected_count,
  });
}

console.log(`source: ${latestFile}`);
console.log(`clean (OK / OK+warn): ${clean}/${data.length}`);
console.log(`fail: ${fail}/${data.length}`);
console.log('');
console.table(rows, ['card_id', 'renderer', 'verdict', 'has_forbidden', 'has_required', 'blocks', 'warnings', 'accuracy_approved']);
