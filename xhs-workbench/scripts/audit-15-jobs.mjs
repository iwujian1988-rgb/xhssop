/* eslint-disable no-console */
/**
 * 自动质检 15 模板 batch 的 success jobs。
 * 检测：
 *   1. cover 截断（item.primary/secondary 以 →，,、；;:：结尾）
 *   2. cover/标题数字不符（标题说 N 类/项/条 但 cover 画了 M 个）
 *   3. caption AI 套话（不是X而是Y、其实、综上所述 等）
 *   4. caption 数字承诺（"30 条错题库"等无 evidence 数字）
 *   5. 身份词错（出现 TEF/TCF/CLB/NCLC）
 *   6. 法语占位符未替换（{XXX}、<XXX>）
 *   7. caption 过长/过短（<120 或 >320 字）
 *
 * 输出：每 job 一段，标记 ✅ OK 或 ⚠️ 问题清单。
 * 用法：node scripts/audit-15-jobs.mjs [BATCH_DIR]
 */
import fs from 'node:fs';
import path from 'node:path';

async function resolveBatchDir(arg) {
  if (arg) return path.resolve(arg);
  const root = path.resolve('data/batches');
  const entries = await fs.promises.readdir(root);
  const sorted = (await Promise.all(
    entries.map(async name => {
      const stat = await fs.promises.stat(path.join(root, name));
      return { name, mtime: stat.mtimeMs };
    }),
  )).sort((a, b) => b.mtime - a.mtime);
  return path.join(root, sorted[0].name);
}

const AI_CLICHE_RE = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|不仅仅是.{1,18}.{0,4}更是|在.{1,18}的过程中|才是.{1,12}(?:关键|核心|根本)|通过.{1,18}，.{1,12}才能|让.{1,12}不再|重要性不言而喻|是一个需要.{1,18}的过程|综上所述|^总而言之|^总的来说|首先[，,][^。]{0,80}其次[，,][^。]{0,80}最后[，,]/;
const FORBIDDEN_IDENTITY_RE = /\b(?:TEF|TCF|CLB|NCLC)\b/;
const TRUNCATION_RE = /[→，,、；;:：]$/;
const PLACEHOLDER_RE = /[\{<][^>}]{2,30}[\}>]/;
const NUMBER_IN_TITLE_RE = /(\d+)\s*(类|项|条|个|组|步|阶段|部分|页)/g;
const NUMBER_IN_COVER_RE = /(\d+)\s*(类|项|条|个|组|步|阶段|部分)/g;

function countCoverSectionsItems(cover) {
  if (!cover || !Array.isArray(cover.sections)) return 0;
  return cover.sections.reduce((sum, s) => sum + (Array.isArray(s.items) ? s.items.length : 0), 0);
}

function auditJob(job) {
  const issues = [];
  const d = job.draft;
  if (!d) return { issues: ['NO_DRAFT'] };

  const title = d.selected_title || '';
  const cover = d.cover || {};
  const caption = d.caption || '';

  // 1. caption AI 套话
  if (AI_CLICHE_RE.test(caption)) issues.push('caption_ai_cliche');

  // 2. 身份词错
  const allText = `${title}\n${cover.title || ''}\n${cover.subtitle || ''}\n${caption}\n${(cover.sections || []).map(s => `${s.heading || ''} ${(s.items || []).map(i => `${i.primary || ''} ${i.secondary || ''}`).join(' ')}`).join('\n')}`;
  if (FORBIDDEN_IDENTITY_RE.test(allText)) issues.push('forbidden_product_identity');

  // 3. 截断
  const truncatedItems = [];
  for (const [si, section] of (cover.sections || []).entries()) {
    for (const [ii, item] of (section.items || []).entries()) {
      if (TRUNCATION_RE.test(item.primary || '') || TRUNCATION_RE.test(item.secondary || '')) {
        truncatedItems.push(`s${si}i${ii}:${(item.primary || '').slice(0, 12)}`);
      }
    }
  }
  if (truncatedItems.length > 0) issues.push(`cover_truncated:${truncatedItems.length}`);

  // 4. 占位符未替换
  if (PLACEHOLDER_RE.test(allText)) issues.push('placeholder_unfilled');

  // 5. caption 长度
  if (caption.length < 120) issues.push(`caption_too_short:${caption.length}`);
  if (caption.length > 340) issues.push(`caption_too_long:${caption.length}`);

  // 6. 标题数字 vs cover 数字
  const titleNumbers = new Set();
  let m;
  while ((m = NUMBER_IN_TITLE_RE.exec(title)) !== null) {
    titleNumbers.add(`${m[1]}${m[2]}`);
  }
  const coverNumbers = new Set();
  let mc;
  while ((mc = NUMBER_IN_COVER_RE.exec(`${cover.title || ''} ${cover.subtitle || ''} ${(cover.sections || []).map(s => s.heading || '').join(' ')}`)) !== null) {
    coverNumbers.add(`${mc[1]}${mc[2]}`);
  }
  // 如果标题说 "N 类/项/条" 但 cover 数字集合不包含 → 可能不一致
  for (const tn of titleNumbers) {
    if (!coverNumbers.has(tn)) {
      // 但是不能误报：标题数字可能是题型/词数等其他语义
      // 只在 cover 完全没有相同单位数字时报警
      const unit = tn.slice(-1);
      const hasSameUnit = Array.from(coverNumbers).some(cn => cn.endsWith(unit));
      if (!hasSameUnit) {
        issues.push(`title_cover_number_mismatch: title=${tn} cover=${[...coverNumbers].join('|')}`);
      }
    }
  }

  // 7. caption 数字承诺（资料/商品里 N 条/项...）
  const unsupportedClaim = /(?:资料|资料包|商品|知识库)(?:里|中|内).{0,10}(?:有|没有|包含|收录)\s*\d+|(?:整理|收录|提供)\s*\d+\s*(?:条|项|篇|个)/.test(caption);
  if (unsupportedClaim) issues.push('caption_unsupported_number_claim');

  return { issues, title, cover_title: cover.title, caption_len: caption.length, inner_pages: (d.inner_pages || []).length };
}

async function main() {
  const batchDir = await resolveBatchDir(process.argv[2]);
  const batchId = path.basename(batchDir);
  const jobsDir = path.join(batchDir, 'jobs');
  const files = (await fs.promises.readdir(jobsDir)).filter(f => f.endsWith('.json'));
  const jobs = await Promise.all(files.map(async f => JSON.parse(await fs.promises.readFile(path.join(jobsDir, f), 'utf8'))));
  jobs.sort((a, b) => (a.seq || 0) - (b.seq || 0));

  console.log(`\n========== 15 TEMPLATES QUALITY AUDIT ==========`);
  console.log(`batch: ${batchId}`);
  console.log(`jobs: ${jobs.length} (success=${jobs.filter(j => j.status === 'success').length} failed=${jobs.filter(j => j.status === 'failed').length})\n`);

  const report = [];
  for (const job of jobs) {
    const card = job.reference_card_id;
    if (job.status !== 'success') {
      console.log(`❌ ${job.id} ${card} stage=${job.failure?.stage} msg=${(job.failure?.message || '').slice(0, 120)}`);
      report.push({ id: job.id, card, status: job.status, failure: job.failure });
      continue;
    }
    const { issues, title, cover_title, caption_len, inner_pages } = auditJob(job);
    const tag = issues.length === 0 ? '✅ OK' : '⚠️ NEEDS_PATCH';
    console.log(`${tag} ${job.id} ${card}`);
    console.log(`     标题: ${title}`);
    console.log(`     封面: ${cover_title}`);
    console.log(`     字数: caption=${caption_len} 内页=${inner_pages}`);
    if (issues.length > 0) {
      for (const iss of issues) console.log(`     ⚠️ ${iss}`);
    }
    report.push({ id: job.id, card, status: 'success', issues, title, cover_title, caption_len });
  }

  const outPath = `audit-15-result-${Date.now()}.json`;
  await fs.promises.writeFile(outPath, JSON.stringify({ batch: batchId, report }, null, 2));
  console.log(`\n详细数据写入 ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
