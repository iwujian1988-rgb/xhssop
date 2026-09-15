import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const sessionDir = path.resolve(process.argv[2] || '');
const batchId = process.argv[3];
if (!sessionDir || !batchId) throw new Error('usage: node scripts/package-final-commercial-output.mjs <export-session-dir> <batch-id>');

const outputRoot = path.resolve('outputs', `final-commercial-output-${Date.now()}`);
const pagesRoot = path.join(outputRoot, 'all-png');
await fs.mkdir(pagesRoot, { recursive: true });

const jobsDir = path.resolve('data', 'batches', batchId, 'jobs');
const jobFiles = (await fs.readdir(jobsDir)).filter(name => name.endsWith('.json')).sort();
const batchJobs = await Promise.all(jobFiles.map(async name => JSON.parse(await fs.readFile(path.join(jobsDir, name), 'utf8'))));
const readyJobs = batchJobs.filter(job => job.commercial?.status === 'READY');
const sourceRoot = path.join(sessionDir, 'files');
const sourceNoteDirs = (await fs.readdir(sourceRoot, { withFileTypes: true })).filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
for (const job of readyJobs) {
  const source = sourceNoteDirs[job.seq - 1];
  if (!source) throw new Error(`READY Job缺少导出目录：${job.id}`);
  await fs.cp(path.join(sourceRoot, source.name), path.join(pagesRoot, source.name), { recursive: true });
}
if (!readyJobs.length) throw new Error('没有READY Job可进入最终商用包');

const commercialZip = path.join(outputRoot, 'full-commercial-content-test.zip');
await execFileAsync('tar.exe', ['-a', '-c', '-f', commercialZip, '-C', pagesRoot, '.'], { windowsHide: true });
await fs.copyFile(path.join(sessionDir, 'page-manifest.json'), path.join(outputRoot, 'page-manifest.json'));

const noteDirs = (await fs.readdir(pagesRoot, { withFileTypes: true })).filter(entry => entry.isDirectory());
const report = { batchId, sourceSession: sessionDir, outputRoot, notes: [] };
const sheetPaths = [];

for (let noteIndex = 0; noteIndex < noteDirs.length; noteIndex += 1) {
  const note = noteDirs[noteIndex];
  const noteDir = path.join(pagesRoot, note.name);
  const pngs = (await fs.readdir(noteDir)).filter(name => name.endsWith('.png')).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const dimensions = [];
  const composites = [];
  const thumbWidth = 270;
  const thumbHeight = 360;
  const gap = 18;
  const columns = 4;
  const rows = Math.ceil(pngs.length / columns);
  for (let index = 0; index < pngs.length; index += 1) {
    const input = path.join(noteDir, pngs[index]);
    const metadata = await sharp(input).metadata();
    dimensions.push({ file: pngs[index], width: metadata.width, height: metadata.height });
    const buffer = await sharp(input).resize(thumbWidth, thumbHeight, { fit: 'contain', background: '#eeeeee' }).png().toBuffer();
    composites.push({ input: buffer, left: gap + (index % columns) * (thumbWidth + gap), top: gap + Math.floor(index / columns) * (thumbHeight + gap) });
  }
  const sheetPath = path.join(outputRoot, `note-${noteIndex + 1}-contact-sheet.png`);
  await sharp({
    create: {
      width: columns * thumbWidth + (columns + 1) * gap,
      height: rows * thumbHeight + (rows + 1) * gap,
      channels: 3,
      background: '#d9d9d9',
    },
  }).composite(composites).png().toFile(sheetPath);
  sheetPaths.push(sheetPath);

  const contentFile = (await fs.readdir(noteDir)).find(name => name.endsWith('.txt'));
  const contentText = contentFile ? await fs.readFile(path.join(noteDir, contentFile), 'utf8') : '';
  const job = readyJobs[noteIndex];
  const jobId = job.id;
  report.notes.push({
    jobId,
    folder: note.name,
    selectedTitle: job.draft?.selected_title,
    titleBundles: job.draft?.title_bundles || [],
    caption: job.draft?.caption || '',
    bridge: job.artifacts?.content?.data?.bridgePlan || null,
    pngCount: pngs.length,
    dimensions,
    contentTextFile: contentFile || null,
    contentTextLength: contentText.length,
    contactSheet: sheetPath,
  });
}

const overviewBuffers = [];
for (let index = 0; index < sheetPaths.length; index += 1) {
  overviewBuffers.push({
    input: await sharp(sheetPaths[index]).resize({ width: 700, fit: 'inside' }).png().toBuffer(),
    left: 20,
    top: 20 + index * 980,
  });
}
await sharp({ create: { width: 740, height: sheetPaths.length * 980 + 20, channels: 3, background: '#eeeeee' } })
  .composite(overviewBuffers)
  .png()
  .toFile(path.join(outputRoot, 'all-notes-contact-sheet.png'));

await fs.writeFile(path.join(outputRoot, 'delivery-report.json'), JSON.stringify(report, null, 2), 'utf8');
process.stdout.write(JSON.stringify(report, null, 2));
