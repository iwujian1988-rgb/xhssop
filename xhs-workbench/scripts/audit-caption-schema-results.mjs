/* eslint-disable no-console */
/**
 * 审计最新 batch 的 14 个 success jobs：
 *  - caption 是否符合 schema 拼装特征（例：+step number+translation）
 *  - AI 套话命中率（含旧 8 类 + 新 7 类模板化句式）
 */
import fs from 'node:fs';
import path from 'node:path';

const BATCH_DIR = process.argv[2] || 'data/batches';

// 找最新 batch
const batches = fs.readdirSync(BATCH_DIR).filter(d => d.startsWith('batch_')).sort();
const latestBatch = batches[batches.length - 1];
const jobsDir = path.join(BATCH_DIR, latestBatch, 'jobs');
const allJobs = fs.readdirSync(jobsDir).filter(f => f.endsWith('.json'));
const successJobs = allJobs.map(f => JSON.parse(fs.readFileSync(path.join(jobsDir, f), 'utf8')))
  .filter(j => j.status === 'success');

console.log(`batch=${latestBatch}`);
console.log(`success jobs=${successJobs.length}/${allJobs.length}\n`);

const SCHEMA_Cliche_RE = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|不仅仅是.{1,18}.{0,4}更是|在.{1,18}的过程中|才是.{1,12}(?:关键|核心|根本)|通过.{1,18}[，,].{1,12}才能|让.{1,12}不再|重要性不言而喻|是一个需要.{1,18}的过程|综上所述|^总而言之|^总的来说|首先[，,][^。]{0,80}其次[，,][^。]{0,80}最后[，,]/;
const NEW_TEMPLATE_RE = /使用时可以先看封面总览|这样复盘会更具体|备考会更有条理|帮你[^，。]{0,15}(?:快速|高效|轻松|省)|这套(?:整理好的|系统|完整)(?:的)?(?:资料|资料库|范文)|按部就班|即查即用|问题在于|考前过一遍就行/;

let schemaOk = 0;
let clicheHit = 0;
let newTemplateHit = 0;
let totalLen = 0;
const issues = [];

for (const job of successJobs) {
  const c = job.draft.caption || '';
  totalLen += c.length;
  const hasExample = /\n例：/.test(c);
  const hasStepNumber = /\n\d+[.)]\s/.test(c) || /\n·\s/.test(c) || /\n→\s/.test(c);
  const hasTranslation = /\n（[^）]{4,40}）/.test(c);
  if (hasExample && hasStepNumber && hasTranslation) {
    schemaOk += 1;
  } else {
    issues.push(`${job.reference_card_id}: example=${hasExample} step=${hasStepNumber} translation=${hasTranslation}`);
  }
  if (SCHEMA_Cliche_RE.test(c)) {
    clicheHit += 1;
    console.log(`⚠️ ${job.reference_card_id} 命中旧 AI 套话：${c.match(SCHEMA_Cliche_RE)?.[0]?.slice(0, 30)}`);
  }
  if (NEW_TEMPLATE_RE.test(c)) {
    newTemplateHit += 1;
    console.log(`⚠️ ${job.reference_card_id} 命中新模板套话：${c.match(NEW_TEMPLATE_RE)?.[0]?.slice(0, 30)}`);
  }
}

console.log(`\n========== schema 拼装特征审计 ==========`);
console.log(`schema 特征完整：${schemaOk}/${successJobs.length}（${Math.round(schemaOk / successJobs.length * 100)}%）`);
console.log(`旧 AI 套话命中：${clicheHit}/${successJobs.length}`);
console.log(`新模板套话命中：${newTemplateHit}/${successJobs.length}`);
console.log(`caption 平均字数：${Math.round(totalLen / successJobs.length)}`);

if (issues.length) {
  console.log(`\n不符合 schema 特征的篇目：`);
  for (const i of issues) console.log(`  ${i}`);
}

// 抽样展示 3 个 caption
console.log(`\n========== 3 个 caption 抽样 ==========\n`);
for (const idx of [0, Math.floor(successJobs.length / 2), successJobs.length - 1]) {
  const job = successJobs[idx];
  console.log(`--- ${job.reference_card_id} (len=${job.draft.caption.length}) ---`);
  console.log(job.draft.caption);
  console.log('');
}
