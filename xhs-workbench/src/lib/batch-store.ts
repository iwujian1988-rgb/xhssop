import fs from 'node:fs/promises';
import path from 'node:path';
import {displayInnerPages} from '@/lib/readable-inner-layout';

import type { AiUsageSummary } from '@/lib/ai-client';
import type { ComposeFailure, ComposeFailureStage } from '@/lib/compose-with-retry';
import type { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import type { ProductId } from '@/types/data';
import type { MigratedTopic, ReferenceDrivenDraft } from '@/types/reference-workflow';
import { stableHash, type PipelineArtifacts, type PipelineStage, type StageFailure } from '@/lib/v2/contracts';
import { COVER_MANIFEST_PAGE_ID, manifestPageIdForInnerOrdinal } from '@/lib/page-manifest-ids';
import { isTextTitleDeliveryReady } from '@/lib/canonical-title-package';

// 极简 promise-based 互斥锁。batch-runner 并发跑多个 job 时，每个 job 会调
// saveJob → loadBatch → 改 jobs 摘要 → writeJsonAtomic(batch.json)。如果两
// 个 job 同时进入这个临界区，后写的会覆盖前写的 jobs 摘要，导致 batch.json
// 里某个 job 的状态/计数被回滚。activeRunner 是单例（同一时间只跑一个
// batch），所以一个全局 mutex 就够；按 batchId 分桶纯属未来扩展位。
class Mutex {
  private queue: Array<() => void> = [];
  private locked = false;
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => {
        this.locked = true;
        resolve();
      });
    });
  }
  private release(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) next();
  }
}

const batchMutexes = new Map<string, Mutex>();
function getBatchMutex(batchId: string): Mutex {
  let mutex = batchMutexes.get(batchId);
  if (!mutex) {
    mutex = new Mutex();
    batchMutexes.set(batchId, mutex);
  }
  return mutex;
}

export type BatchJobCard = NonNullable<ReturnType<typeof getCompetitorCreativeCard>>;

export type BatchJobStatus = 'pending' | 'running' | 'success' | 'failed' | 'awaiting_review' | 'dropped';
export type ContentMode = 'standard' | 'product_showcase';
export type NoteMode = 'content_note' | 'product_note';

export type CommercialStageName = 'coordinate' | 'motherTopic' | 'execution' | 'content' | 'frenchQA' | 'titles' | 'pages' | 'render' | 'export';
export type CommercialStageStatus = 'pending' | 'running' | 'pass' | 'needs_repair' | 'failed' | 'skipped';
export type CommercialJobStatus = 'READY' | 'NEEDS_REPAIR' | 'FAILED';

export interface CommercialPageState {
  contentStatus: CommercialStageStatus;
  densityStatus: 'pending' | 'pass' | 'needs_repair' | 'failed';
  frenchQaStatus: CommercialStageStatus;
  renderStatus: CommercialStageStatus;
  exportStatus: CommercialStageStatus;
  purpose?: string;
  problems?: string[];
  artifactPath?: string;
}

export interface CommercialPageManifest {
  expectedPageIds: string[];
  contentReadyPageIds: string[];
  renderedPageIds: string[];
  exportedPageIds: string[];
  pages: Record<string, CommercialPageState>;
  updatedAt: string;
}

export interface CommercialProductionState {
  jobId: string;
  currentStage: CommercialStageName;
  stageStatus: Record<CommercialStageName, CommercialStageStatus>;
  artifacts: Record<string, string>;
  status: CommercialJobStatus;
  failedStage?: CommercialStageName;
  failedTarget?: string;
  failedReason?: string;
  repairAttempts: Partial<Record<CommercialStageName, number>>;
  pageManifest?: CommercialPageManifest;
  updatedAt: string;
}

export type BatchJobFailureStage = ComposeFailureStage | 'topics' | 'image' | 'topic' | 'content' | 'audit' | 'title' | 'compile';

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
  /** composeV2 的 result.warnings（含补页警告/法语返修提醒），B2 起随 job 落盘供前台展示。 */
  warnings?: string[];
  pipeline_version?: 'v1' | 'v2';
  current_stage?: PipelineStage;
  artifacts?: PipelineArtifacts;
  stage_failures?: StageFailure[];
  draft?: ReferenceDrivenDraft;
  cover_image_url?: string;
  // 生图 API 是异步任务制：task_id 一旦提交就已完成扣款。落盘之后，无论轮询
  // 网络抖动、进程重启还是 batch 重跑，都能凭它找回结果，不必重新提交。
  image_task_id?: string;
  /** Submit response timed out after the provider may already have accepted the task. */
  image_submission_uncertain?: boolean;
  image_request_hash?: string;
  failure?: BatchJobFailure;
  usage?: AiUsageSummary;
  started_at?: string;
  finished_at?: string;
  /** Commercial Production Controller V1: per-job resumable delivery state. */
  commercial?: CommercialProductionState;
  /** Product Note planner output; immutable input for downstream stages. */
  product_note_plan?: import('@/lib/product-note').ProductNotePlan;
}

export type BatchStatus = 'planned' | 'running' | 'done';
export type KnowledgeMode = 'product_grounded' | 'educational_original' | 'mixed';

/** 批计划元数据（B2，仅商品1普通模式共识挑选路径写入；其他路径不带该字段）。 */
export interface BatchPlanMeta {
  /** 每张卡未选中的候选 + 淘汰原因（§3.4-5 / §8.1-9）。 */
  unselected_candidates?: Array<{ card_id: string; topic: string; reason: string }>;
  /** 撞题/降级/兜底等警告（§3.4-3 / §8.1-10）。 */
  warnings?: string[];
  /** 兜底选题标记：需人工复核（§8.1-10）。 */
  needs_manual_review?: boolean;
  status?: 'PASS' | 'PARTIAL_SUCCESS';
  failed_jobs?: Array<{ job_id: string; status: string; reason: string }>;
  candidate_pool?: { requested_jobs: number; generated_candidates: number; production_jobs: number; reserve_candidates: number };
  /** 需求优先补齐仍未成功生成的槽位；不把缺口伪装成普通“重复”。 */
  unfilled_demand_archetypes?: string[];
  /** DELF Market Reference-first planning audit; absent for every other route. */
  delf_reference_first?: {
    requested: number;
    reference_slots_prepared: number;
    recent_core_window_size: number;
    pre_generation_recent_core_skipped: number;
    ai_topic_call_count: number;
    raw_generated: number;
    final_retained: number;
    refill_call_count: number;
    unique_reference_count: number;
    unique_click_reason_count: number;
    unique_topic_core_count: number;
    recent_core_duplicate_dropped: number;
    full_history_title_duplicate_dropped: number;
    reused_old_reference_count: number;
    reused_old_topic_family_count: number;
  };
  /** Shared Reference-first Market planning audit for the three content_note products. */
  market_reference_first?: {
    requested: number;
    reference_slots_prepared: number;
    recent_core_window_size: number;
    pre_generation_recent_core_skipped: number;
    ai_topic_call_count: number;
    raw_generated: number;
    final_retained: number;
    refill_call_count: number;
    unique_reference_count: number;
    unique_click_reason_count: number;
    unique_topic_core_count: number;
    recent_core_duplicate_dropped: number;
    full_history_title_duplicate_dropped: number;
    reused_old_reference_count: number;
    reused_old_topic_family_count: number;
  };
}

export interface Batch {
  planning_usage?: AiUsageSummary;
  topic_scope?: 'large' | 'medium';
  id: string;
  product_id: ProductId;
  exam_scope?: import('@/types/data').ExamScope;
  direction: string;
  content_mode?: ContentMode;
  note_mode?: NoteMode;
  product_note_angles?: string[];
  knowledge_mode?: KnowledgeMode;
  created_at: string;
  status: BatchStatus;
  pipeline_version?: 'v1' | 'v2';
  plan_meta?: BatchPlanMeta;
  jobs: Array<Pick<BatchJob, 'id' | 'seq' | 'reference_card_id' | 'topic' | 'status' | 'pipeline_version' | 'current_stage'>>;
}

const BATCHES_DIR = path.resolve(process.env.INNER_REVIEW_TEST_DATA_DIR || path.join(process.cwd(), 'data/batches'));

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
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  // Windows antivirus/readers may briefly hold the destination. Retry the same
  // atomic rename, never delete the previous artifact or restart model work.
  for (let attempt = 0; ; attempt++) {
    try { await fs.rename(tempPath, filePath); break; }
    catch (cause) {
      if (attempt >= 4 || !['EPERM','EBUSY','EACCES'].includes((cause as NodeJS.ErrnoException).code || '')) throw cause;
      await new Promise(resolve => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
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

/**
 * 规划阶段的原子提交：先在同级临时目录写齐 batch + 全部 job，最后一次 rename。
 * 任一写入失败时正式 batch 目录都不存在，避免 planned 半批污染后续选题占位。
 */
export async function createPlannedBatchAtomic(batch: Batch, jobs: BatchJob[]): Promise<void> {
  const tempDir = path.join(BATCHES_DIR, `.planning-${batch.id}-${process.pid}-${Date.now()}`);
  const committedBatch: Batch = {
    ...batch,
    jobs: jobs.map(job => ({
      id: job.id,
      seq: job.seq,
      reference_card_id: job.reference_card_id,
      topic: job.topic,
      status: job.status,
      pipeline_version: job.pipeline_version,
      current_stage: job.current_stage,
    })),
  };
  await ensureDir(path.join(tempDir, 'jobs'));
  await Promise.all([
    fs.writeFile(path.join(tempDir, 'batch.json'), JSON.stringify(committedBatch, null, 2), 'utf8'),
    ...jobs.map(job => fs.writeFile(
      path.join(tempDir, 'jobs', `${job.id}.json`),
      JSON.stringify(job, null, 2),
      'utf8',
    )),
  ]);
  await ensureDir(BATCHES_DIR);
  await fs.rename(tempDir, batchDir(batch.id));
}

export async function appendBatchWarning(batchId: string, message: string): Promise<void> {
  await getBatchMutex(batchId).runExclusive(async () => {
    const batch = await loadBatch(batchId);
    const warnings = batch.plan_meta?.warnings || [];
    if (warnings.includes(message)) return;
    batch.plan_meta = { ...(batch.plan_meta || {}), warnings: [...warnings, message] };
    await writeJsonAtomic(batchFilePath(batchId), batch);
  });
}

export async function loadBatch(batchId: string): Promise<Batch> {
  const raw = await fs.readFile(batchFilePath(batchId), 'utf8');
  return JSON.parse(raw) as Batch;
}

export async function listBatches(options?: { recentLimit: number }): Promise<Batch[]> {
  let names: string[];
  try {
    names = await fs.readdir(BATCHES_DIR, { encoding: 'utf8' });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
  const batches: Batch[] = [];
  // Topic context reads a bounded recent window, not every historical JSON.
  if (options) names = names.filter(name=>/^batch_\d+$/.test(name))
    .sort((a,b)=>Number(b.slice(6))-Number(a.slice(6)))
    .slice(0,Math.max(1,Math.min(20,options.recentLimit)));
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
  const persistedJob = withCommercialProductionState(job);
  // job_<id>.json 是 per-job 独立文件，无并发风险。
  await writeJsonAtomic(jobFilePath(batchId, persistedJob.id), persistedJob);
  // batch.json 的 jobs 摘要数组是共享状态：loadBatch → 修改单条 → write 这套
  // 读改写序列在并发下会产生 lost-update（后写覆盖前写）。用 per-batch mutex
  // 把这个临界区串起来，job_<id>.json 的写盘仍然并行，性能不受影响。
  await getBatchMutex(batchId).runExclusive(async () => {
    const batch = await loadBatch(batchId);
    const index = batch.jobs.findIndex(item => item.id === persistedJob.id);
    const summary: Batch['jobs'][number] = {
      id: persistedJob.id,
      seq: persistedJob.seq,
      reference_card_id: persistedJob.reference_card_id,
      topic: persistedJob.topic,
      status: persistedJob.status,
      pipeline_version: persistedJob.pipeline_version,
      current_stage: persistedJob.current_stage,
    };
    if (index >= 0) batch.jobs[index] = summary;
    else batch.jobs.push(summary);
    await writeJsonAtomic(batchFilePath(batchId), batch);
  });
}

export async function updateCommercialPageDelivery(
  batchId: string,
  jobId: string,
  deliveredPageIds: string[],
  artifactPaths: Record<string, string> = {},
): Promise<BatchJob> {
  const job = await loadJob(batchId, jobId);
  if (!job.draft) throw new Error(`Job没有可交付页面：${jobId}`);
  const base = withCommercialProductionState(job);
  const manifest = base.commercial?.pageManifest;
  if (!manifest) throw new Error(`Job缺少Page Manifest：${jobId}`);
  const allowed = new Set(manifest.expectedPageIds);
  const delivered = new Set(deliveredPageIds.filter(id => allowed.has(id)));
  const pages = Object.fromEntries(Object.entries(manifest.pages).map(([id, page]) => [id, delivered.has(id) ? {
    ...page,
    renderStatus: 'pass' as const,
    exportStatus: 'pass' as const,
    artifactPath: artifactPaths[id] || page.artifactPath,
  } : page]));
  const contentReadyPageIds = manifest.expectedPageIds.filter(id => pages[id]?.contentStatus === 'pass'
    && pages[id]?.densityStatus === 'pass'
    && pages[id]?.frenchQaStatus === 'pass');
  const renderedPageIds = manifest.expectedPageIds.filter(id => pages[id]?.renderStatus === 'pass');
  const exportedPageIds = manifest.expectedPageIds.filter(id => pages[id]?.exportStatus === 'pass');
  const allDelivered = manifest.expectedPageIds.every(id => pages[id]?.exportStatus === 'pass');
  const allContentReady = manifest.expectedPageIds.every(id => pages[id]?.contentStatus === 'pass'
    && pages[id]?.densityStatus === 'pass'
    && pages[id]?.frenchQaStatus === 'pass');
  const deliveryReady = allDelivered && allContentReady;
  const commercial: CommercialProductionState = {
    ...base.commercial!,
    currentStage: allDelivered ? 'export' : 'render',
    stageStatus: {
      ...base.commercial!.stageStatus,
      render: allDelivered ? 'pass' : 'needs_repair',
      export: allDelivered ? 'pass' : 'needs_repair',
    },
    status: deliveryReady ? 'READY' : 'NEEDS_REPAIR',
    failedStage: deliveryReady ? undefined : allDelivered ? base.commercial?.failedStage : 'export',
    failedReason: deliveryReady ? undefined : allDelivered ? base.commercial?.failedReason : '部分页面尚未成功导出',
    pageManifest: { ...manifest, pages, contentReadyPageIds, renderedPageIds, exportedPageIds, updatedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
  const updated = { ...base, commercial };
  await saveJob(batchId, updated);
  return loadJob(batchId, jobId);
}

const COMMERCIAL_STAGES: CommercialStageName[] = ['coordinate', 'motherTopic', 'execution', 'content', 'frenchQA', 'titles', 'pages', 'render', 'export'];

function withCommercialProductionState(job: BatchJob): BatchJob {
  const now = new Date().toISOString();
  const previous = job.commercial;
  const stageStatus = Object.fromEntries(COMMERCIAL_STAGES.map(stage => [stage, previous?.stageStatus?.[stage] || 'pending'])) as CommercialProductionState['stageStatus'];
  const topic = (job.topic as BatchJob['topic'] & { v2_topic?: { batchEditorialTask?: unknown; motherTopicScore?: number } }).v2_topic;
  if (topic?.batchEditorialTask) stageStatus.coordinate = 'pass';
  if (topic?.motherTopicScore || topic?.batchEditorialTask) stageStatus.motherTopic = 'pass';
  if (job.artifacts?.selectedTopic) stageStatus.execution = 'pass';
  if (job.artifacts?.content) {
    stageStatus.content = 'pass';
    stageStatus.frenchQA = job.artifacts.content.data.finalTeachingQa?.status === 'PASS' ? 'pass' : 'needs_repair';
  }
  const titlesStale = Boolean(job.artifacts?.content && job.artifacts?.titles
    && job.artifacts.titles.data.contentSnapshotHash !== stableHash(job.artifacts.titles.data.mode==='text_only' ? job.artifacts.content.data.innerPages : job.artifacts.content.data));
  if (job.artifacts?.titles) stageStatus.titles = titlesStale ? 'needs_repair' : 'pass';
  if (job.draft) stageStatus.pages = 'pass';
  if (job.status === 'running') stageStatus[commercialStageForJob(job)] = 'running';
  if (job.status === 'failed') stageStatus[commercialStageForJob(job)] = 'needs_repair';

  const pageManifest = job.draft ? mergePageManifest(job, previous?.pageManifest, now) : previous?.pageManifest;
  const pageNeedsRepair = pageManifest?.expectedPageIds.some(id => {
    const page = pageManifest.pages[id];
    return page.contentStatus !== 'pass' || page.densityStatus !== 'pass' || page.frenchQaStatus !== 'pass';
  }) || false;
  const allExported = Boolean(pageManifest?.expectedPageIds.length)
    && pageManifest!.expectedPageIds.every(id => pageManifest!.pages[id]?.exportStatus === 'pass');
  const ready = job.status === 'success' && Boolean(job.draft && isTextTitleDeliveryReady(job.draft)) && !job.draft?.downstreamStale && job.artifacts?.content?.data.manualInnerReview?.status !== 'needs_review' && !titlesStale && !pageNeedsRepair && allExported;
  const failedStageForStatus = job.failure ? commercialStageForJob(job) : undefined;
  const exhaustedRepair = Boolean(failedStageForStatus && (previous?.repairAttempts?.[failedStageForStatus] || 0) >= 2);
  const status: CommercialJobStatus = ready ? 'READY' : job.status === 'failed' ? 'FAILED' : 'NEEDS_REPAIR';
  const failedStage = job.failure ? commercialStageForJob(job) : titlesStale ? 'titles' : pageNeedsRepair ? 'pages' : previous?.failedStage;
  return {
    ...job,
    commercial: {
      jobId: job.id,
      currentStage: ready ? 'export' : failedStage || commercialStageForJob(job),
      stageStatus,
      artifacts: {
        ...(previous?.artifacts || {}),
        ...(job.draft ? { draft: `data/batches/{batchId}/jobs/${job.id}.json` } : {}),
      },
      status,
      failedStage,
      failedTarget: previous?.failedTarget,
      failedReason: job.failure?.message || (titlesStale
        ? '最终页面内容已变化，标题工件必须基于最新内容快照重新生成'
        : pageNeedsRepair ? '页面内容、密度或法语状态未达到最低交付标准' : previous?.failedReason),
      repairAttempts: previous?.repairAttempts || {},
      pageManifest,
      updatedAt: now,
    },
  };
}

function commercialStageForJob(job: BatchJob): CommercialStageName {
  if (job.failure?.stage === 'image') return 'render';
  if (job.failure?.stage === 'title') return 'titles';
  if (job.failure?.stage === 'audit') return 'frenchQA';
  if (job.failure?.stage === 'compile') return 'pages';
  if (job.failure?.stage === 'topic' || job.failure?.stage === 'topics') return 'motherTopic';
  if (job.artifacts?.titles && !job.draft) return 'pages';
  if (job.artifacts?.content && !job.artifacts?.titles) return 'titles';
  if (job.artifacts?.selectedTopic && !job.artifacts?.content) return 'content';
  return job.draft ? 'render' : 'execution';
}

function mergePageManifest(job: BatchJob, previous: CommercialPageManifest | undefined, now: string): CommercialPageManifest {
  const pages = job.draft ? displayInnerPages(job.draft) : [];
  const finalTeachingQaPassed = job.artifacts?.content?.data.finalTeachingQa?.status === 'PASS'
    && job.artifacts.content.data.finalTeachingQa.approved
    && job.artifacts.content.data.finalTeachingQa.unresolvedBlockingIssues.length === 0;
  const expectedPageIds = [COVER_MANIFEST_PAGE_ID, ...pages.map((_, index) => manifestPageIdForInnerOrdinal(index))];
  const nextPages: Record<string, CommercialPageState> = {};
  nextPages.P1 = {
    ...previous?.pages.P1,
    contentStatus: 'pass', densityStatus: 'pass', frenchQaStatus: finalTeachingQaPassed ? 'pass' : 'needs_repair',
    renderStatus: previous?.pages.P1?.renderStatus || 'pending',
    exportStatus: previous?.pages.P1?.exportStatus || 'pending', purpose: '封面', problems: [],
  };
  pages.forEach((page, index) => {
    const id = `P${index + 2}`;
    const prior = previous?.pages[id];
    const bullets = (page.bullets || []).map(item => item.trim()).filter(Boolean);
    const structuredAsset = Boolean(page.renderPayload && Object.keys(page.renderPayload).length);
    const enoughInformation = Boolean(page.page_title?.trim() || page.lead?.trim() || bullets.length || structuredAsset);
    const problems = enoughInformation ? [] : ['页面没有真实用户可见内容'];
    nextPages[id] = {
      contentStatus: enoughInformation ? 'pass' : 'needs_repair',
      densityStatus: enoughInformation ? 'pass' : 'needs_repair',
      frenchQaStatus: finalTeachingQaPassed ? 'pass' : 'needs_repair',
      renderStatus: prior?.renderStatus || 'pending',
      exportStatus: prior?.exportStatus || 'pending',
      purpose: page.page_title,
      problems,
      artifactPath: prior?.artifactPath,
    };
  });
  return {
    expectedPageIds,
    contentReadyPageIds: expectedPageIds.filter(id => nextPages[id]?.contentStatus === 'pass'
      && nextPages[id]?.densityStatus === 'pass'
      && nextPages[id]?.frenchQaStatus === 'pass'),
    renderedPageIds: expectedPageIds.filter(id => nextPages[id]?.renderStatus === 'pass'),
    exportedPageIds: expectedPageIds.filter(id => nextPages[id]?.exportStatus === 'pass'),
    pages: nextPages,
    updatedAt: now,
  };
}

export async function loadJob(batchId: string, jobId: string): Promise<BatchJob> {
  const raw = await fs.readFile(jobFilePath(batchId, jobId), 'utf8');
  // QA and choice are canonical; historical derived manifest flags must not
  // permanently block a completed job. Read-only refresh also covers old files.
  return withCommercialProductionState(withRequiredProductEnding(JSON.parse(raw) as BatchJob));
}

/**
 * 旧批次也必须与当前生产规则一致：每个 job 只保留一个固定商品承接页，
 * 并且该页永远位于最后。这里只做读取时迁移，不覆写历史 JSON。
 */
function withRequiredProductEnding(job: BatchJob): BatchJob {
  if (!job.draft) return job;
  if (job.artifacts?.content?.data.selectedCoverTemplateId) return job;

  if (job.draft.manualInnerReview) return job;
  const contentPages = job.draft.inner_pages.filter(page => page.page_type !== 'product_bridge');
  const endingSourceIds = job.draft.evidence.slice(0, 3).map(item => item.id);
  const product2 = job.product_id === 'tef_tcf_canada';
  const product3 = job.product_id === 'tcf_canada_writing_7day';

  return {
    ...job,
    draft: {
      ...job.draft,
      inner_pages: [
        ...contentPages.map((page, index) => ({ ...page, page_no: index + 1 })),
        {
          page_no: contentPages.length + 1,
          page_type: 'product_bridge',
          style_variant: 'draft-paper',
          page_title: product2 ? 'TEF/TCF CA CLB冲刺实战笔记' : product3 ? 'TCF Canada写作7天急救锦囊' : 'DELF B2 写作模板库',
          lead: product2 ? '从选考判断到四科训练，12份资料按备考阶段整理。' : product3 ? '7天、7套原创训练，把T1/T2/T3最容易丢分的动作逐个纠正。' : '范文、句型词汇、主题观点、评分自查和练习路径集中整理。备考时按问题查，写作时按场景用，写完还能继续复盘。',
          bullets: [
            ...(product2 ? ['先确认更适合 TEF 还是 TCF，再按听、读、说、写找到对应方法、题型、表达和练习计划', '不用再四处拼资料，也不会把两场考试混成一场'] : product3 ? ['从任务拆解、考生作答页到T3示范和90秒检查，每天只集中改一个关键动作', '不是背模板，而是用改前改后对照，看清自己到底错在哪'] : ['不再四处拼资料：常用内容放在同一套体系里', '从看懂到写出：每个模块对应真实写作动作', '从完成到改进：写完可以继续检查和复盘']),
          ],
          source_ids: endingSourceIds,
          showcase_asset_label: product2 ? 'TEF/TCF CA CLB冲刺实战笔记总览' : product3 ? 'TCF Canada写作7天急救锦囊总览' : 'DELF B2 写作资料总览',
          showcase_asset_image: product2 ? '/generated-cover-backgrounds/tef-tcf-product-library-collage.png' : product3 ? '/generated-cover-backgrounds/tcf-writing-7day-product-library-collage.png' : '/generated-cover-backgrounds/delf-b2-product-library-collage.png',
        },
      ],
    },
  };
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

export async function deleteJob(batchId: string, jobId: string): Promise<void> {
  await getBatchMutex(batchId).runExclusive(async () => {
    const batch = await loadBatch(batchId);
    batch.jobs = batch.jobs.filter(job => job.id !== jobId);
    await writeJsonAtomic(batchFilePath(batchId), batch);
  });
  await fs.unlink(jobFilePath(batchId, jobId)).catch((cause: unknown) => {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  });
}
