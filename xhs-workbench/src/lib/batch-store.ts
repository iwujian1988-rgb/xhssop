import fs from 'node:fs/promises';
import path from 'node:path';

import type { AiUsageSummary } from '@/lib/ai-client';
import type { ComposeFailure, ComposeFailureStage } from '@/lib/compose-with-retry';
import type { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import type { ProductId } from '@/types/data';
import type { MigratedTopic, ReferenceDrivenDraft } from '@/types/reference-workflow';

export type BatchJobCard = NonNullable<ReturnType<typeof getCompetitorCreativeCard>>;

export type BatchJobStatus = 'pending' | 'running' | 'success' | 'failed';

export type BatchJobFailureStage = ComposeFailureStage | 'topics' | 'image';

export interface BatchJobFailure {
  stage: BatchJobFailureStage;
  message: string;
  attempts: number;
  usage: AiUsageSummary;
}

export interface BatchJob {
  id: string;
  seq: number;
  product_id: ProductId;
  reference_card_id: string;
  topic: MigratedTopic;
  status: BatchJobStatus;
  attempts: number;
  draft?: ReferenceDrivenDraft;
  cover_image_url?: string;
  failure?: BatchJobFailure;
  usage?: AiUsageSummary;
  started_at?: string;
  finished_at?: string;
}

export type BatchStatus = 'planned' | 'running' | 'done';

export interface Batch {
  id: string;
  product_id: ProductId;
  direction: string;
  created_at: string;
  status: BatchStatus;
  jobs: Array<Pick<BatchJob, 'id' | 'seq' | 'reference_card_id' | 'topic' | 'status'>>;
}

const BATCHES_DIR = path.resolve(process.cwd(), 'data/batches');

function batchDir(batchId: string) {
  return path.join(BATCHES_DIR, batchId);
}

function batchFilePath(batchId: string) {
  return path.join(batchDir(batchId), 'batch.json');
}

function jobsDir(batchId: string) {
  return path.join(batchDir(batchId), 'jobs');
}

function jobFilePath(batchId: string, jobId: string) {
  return path.join(jobsDir(batchId), `${jobId}.json`);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function formatJobId(seq: number) {
  return `job_${String(seq).padStart(3, '0')}`;
}

export function formatBatchId() {
  return `batch_${Date.now()}`;
}

export async function createBatch(batch: Batch): Promise<void> {
  await writeJsonAtomic(batchFilePath(batch.id), batch);
}

export async function loadBatch(batchId: string): Promise<Batch> {
  const raw = await fs.readFile(batchFilePath(batchId), 'utf8');
  return JSON.parse(raw) as Batch;
}

export async function listBatches(): Promise<Batch[]> {
  let names: string[];
  try {
    names = await fs.readdir(BATCHES_DIR, { encoding: 'utf8' });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  const batches: Batch[] = [];
  for (const name of names) {
    if (!name.startsWith('batch_')) continue;
    const stat = await fs.stat(path.join(BATCHES_DIR, name)).catch(() => null);
    if (!stat?.isDirectory()) continue;
    try {
      batches.push(await loadBatch(name));
    } catch {
      // skip unreadable batch dirs - they might be mid-write or corrupted
    }
  }
  return batches.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function updateBatchStatus(batchId: string, status: BatchStatus): Promise<void> {
  const batch = await loadBatch(batchId);
  batch.status = status;
  await writeJsonAtomic(batchFilePath(batchId), batch);
}

export async function saveJob(batchId: string, job: BatchJob): Promise<void> {
  await writeJsonAtomic(jobFilePath(batchId, job.id), job);
  const batch = await loadBatch(batchId);
  const index = batch.jobs.findIndex(item => item.id === job.id);
  const summary: Batch['jobs'][number] = {
    id: job.id,
    seq: job.seq,
    reference_card_id: job.reference_card_id,
    topic: job.topic,
    status: job.status,
  };
  if (index >= 0) batch.jobs[index] = summary;
  else batch.jobs.push(summary);
  await writeJsonAtomic(batchFilePath(batchId), batch);
}

export async function loadJob(batchId: string, jobId: string): Promise<BatchJob> {
  const raw = await fs.readFile(jobFilePath(batchId, jobId), 'utf8');
  return JSON.parse(raw) as BatchJob;
}

export async function loadAllJobs(batchId: string): Promise<BatchJob[]> {
  let names: string[];
  try {
    names = await fs.readdir(jobsDir(batchId), { encoding: 'utf8' });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  const jobs: BatchJob[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      jobs.push(await loadJob(batchId, name.replace(/\.json$/, '')));
    } catch {
      // skip unreadable job files
    }
  }
  return jobs.sort((a, b) => a.seq - b.seq);
}
