/* eslint-disable no-console */
/**
 * 把 success job 整理成可直接复制粘贴到小红书发布框的纯文本。
 * 输出 .txt 文件，每个 job 一段：标题 + 正文 + 标签。
 *
 * 用法：node scripts/build-xhs-copy.mjs [BATCH_DIR] [OUT_TXT]
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

async function main() {
  const batchDir = await resolveBatchDir(process.argv[2]);
  const outPath = process.argv[3] || 'xhs-ready-to-publish.txt';
  const jobsDir = path.join(batchDir, 'jobs');
  const files = (await fs.promises.readdir(jobsDir)).filter(f => f.endsWith('.json'));
  const jobs = await Promise.all(files.map(async f => JSON.parse(await fs.promises.readFile(path.join(jobsDir, f), 'utf8'))));
  jobs.sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const success = jobs.filter(j => j.status === 'success');

  const lines = [];
  lines.push('=== 小红书可发布文案（已人工核对+修补）===');
  lines.push(`来源 batch: ${path.basename(batchDir)}`);
  lines.push(`可发布篇数: ${success.length}`);
  lines.push('');
  lines.push('说明：');
  lines.push('- 每篇含【标题】【正文】【标签】三段，直接复制粘贴到小红书发布框');
  lines.push('- 封面图需要另外渲染：双击 selftest-preview.html 查看，截图保存');
  lines.push('- 内页图同上，逐页截图作为后续图片');
  lines.push('');
  lines.push('═'.repeat(60));

  for (const [i, job] of success.entries()) {
    const d = job.draft;
    lines.push('');
    lines.push(`【篇 ${i + 1}】 ${job.reference_card_id}`);
    lines.push('─'.repeat(60));
    lines.push('');
    lines.push('▼ 标题（复制到小红书标题框，≤20字）');
    lines.push(d.selected_title);
    lines.push('');
    lines.push('▼ 正文（复制到小红书正文框）');
    lines.push(d.caption);
    lines.push('');
    lines.push('▼ 标签（复制到正文末尾或标签框）');
    lines.push((d.tags || []).join(' '));
    lines.push('');
    lines.push('▼ 封面信息（仅供参考）');
    lines.push(`主标题: ${d.cover.title}`);
    if (d.cover.subtitle) lines.push(`副标题: ${d.cover.subtitle}`);
    lines.push(`内页数: ${d.inner_pages.length} 张（截图前先打开 selftest-preview.html）`);
    lines.push('');
    lines.push('─'.repeat(60));
  }

  await fs.promises.writeFile(outPath, lines.join('\n'), 'utf8');
  console.log(`写入 ${outPath}`);
  console.log(`总计 ${success.length} 篇可发布`);
}

main().catch(e => { console.error(e); process.exit(1); });
