import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { pickXhsDazibaoReference } from '@/lib/xhs-dazibao-reference-pool';
import { submitCoverImageTask, waitForCoverImageTask } from '@/lib/cover-image';
import { buildReferenceImagePrompt } from '@/lib/reference-image-prompt';
import type { DenseDirectoryCoverPayload } from '@/types/reference-workflow';

nextEnv.loadEnvConfig(process.cwd());
const root = process.cwd();
const out = path.join(root, 'artifacts', 'content-note-dazibao-img2img-smoke-20260914');
const chosen = ['sample_03'];
const forcedReferences: Record<string, string> = { sample_03: '/cover-style-refs/xhs-dazibao/ref_02.png' };
const lines: Record<string, string[]> = {
  sample_01: ['TCF Canada', '备考周期', '怎么留？'], sample_02: ['上班族备考TCF', '每天', '这样排'],
  sample_07: ['正式信', '写得好', '为什么没人理？'], sample_08: ['DELF B2写作', '这4件事', '分开练'],
};
const titleLines = (id: string, title: string) => lines[id] || title.split(/[｜|：:，,。！？?!]/u).filter(Boolean).slice(0, 3);
async function main() {
  await mkdir(out, { recursive: true });
  const all = JSON.parse(await readFile(path.join(root, 'artifacts', 'cover-samples-20260914', 'formal-results.json'), 'utf8')) as any[];
  const card = getCompetitorCreativeCard('content_note_dazibao'); if (!card) throw new Error('content_note_dazibao card missing');
  const jobs = chosen.map(id => { const source = all.find(item => item.id === id); if (!source) throw new Error(`missing ${id}`); const reference = forcedReferences[id] || pickXhsDazibaoReference(); const cover: DenseDirectoryCoverPayload = { kind:'dense_directory', productIdentity:source.exam, title:source.title.coverTitle, subtitle:source.title.coverSubtitle || '', sections:[] }; return { id, source, reference, cover }; });
  const results: any[] = [];
  for (const job of jobs) {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const generationCard = { ...card, reference_image: job.reference };
    const handle = await submitCoverImageTask(generationCard, job.cover, job.source.topic.productId, job.source.topic.examScope);
    const submittedAt = new Date().toISOString();
    const result = await waitForCoverImageTask(handle.taskId);
    if (!result.ok) throw new Error(`${job.id}:${result.error}`);
    const completedAt = new Date().toISOString();
    const item = { id:job.id, exam:job.source.exam, topic:job.source.topic.topic, publishTitle:job.source.title.textTitle, coverTitle:job.source.title.coverTitle, posterTitle:titleLines(job.id,job.source.title.coverTitle), referenceImage:job.reference, requestHash:handle.requestHash, taskId:handle.taskId, imageUrl:result.url, startedAt, submittedAt, completedAt, submitMs: Date.parse(submittedAt) - Date.parse(startedAt), totalMs: Date.now() - startedMs };
    results.push(item);
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ version:'content-note-dazibao-img2img-smoke-v1', count:results.length, items:results }, null, 2), 'utf8');
  }
  await writeFile(path.join(out, 'manifest.json'), JSON.stringify({ version:'content-note-dazibao-img2img-smoke-v1', count:results.length, items:results }, null, 2), 'utf8');
  for (const item of results) { const res = await fetch(item.imageUrl); if (!res.ok) throw new Error(`download ${item.id}:${res.status}`); await writeFile(path.join(out, `${item.id}.png`), Buffer.from(await res.arrayBuffer())); }
  console.log(JSON.stringify({ ok:true, count:results.length, output:out, items:results.map(item=>({id:item.id,exam:item.exam,referenceImage:item.referenceImage,posterTitle:item.posterTitle,taskId:item.taskId})) }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
