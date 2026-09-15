'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DraftReview } from '@/components/draft/DraftReview';
import { BatchExportSlot, type ExportNodes } from '@/components/batch/BatchExportSlot';
import { getCompetitorCreativeCard, standardCreativeCards } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { nodeToPngBlob } from '@/lib/export-image';
import { assertDraftTitleReadyForExport, buildBatchTxt, fetchUrlAsBlobOrNull, seqFolderName, type CoverStatus } from '@/lib/batch-export';
import type { ExamScope, ProductId } from '@/types/data';
import type { CompetitorCreativeCard } from '@/types/reference-workflow';
import type { Batch, BatchJob, KnowledgeMode } from '@/lib/batch-store';
import { COVER_MANIFEST_PAGE_ID, manifestPageIdForInnerOrdinal } from '@/lib/page-manifest-ids';
import type { AiUsageSummary } from '@/lib/ai-client';
import { applyDraftTitleSelection, getDraftTitleSelection, type DraftTitleSelection } from '@/lib/draft-title-selection';
import { resolveCanonicalTitlePackage } from '@/lib/canonical-title-package';
import { repaginateDraftForOverflow } from '@/lib/render-repagination';
import {measureReadablePagePlan} from '@/lib/readable-inner-layout';
import { BatchUsagePanel } from '@/components/batch/BatchUsagePanel';
import { summarizeTokenUsage } from '@/lib/token-usage';
import { usesStandardEducationalAutoPlan } from '@/lib/v2/pipeline-features';

const supportedCards = standardCreativeCards.filter(card => card.supported);

type PlanResponse = { batch: Batch; usage: AiUsageSummary };
type BatchQueryResponse = { batch: Batch; jobs: BatchJob[]; active_runner: string | null };

export default function BatchPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#f4f5f6] p-6 text-sm text-neutral-500">正在加载批量工作台...</main>}>
      <BatchPageContent />
    </Suspense>
  );
}

function BatchPageContent() {
  const [productId, setProductId] = useState<ProductId>('delf_b2_writing');
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => initialCardSelection());
  const [direction, setDirection] = useState('');
  const [examScope, setExamScope] = useState<ExamScope>('common');
  const [topicScope, setTopicScope] = useState<'large' | 'medium'>('large');
  const contentMode = 'standard' as const;
  const [noteMode, setNoteMode] = useState<'content_note' | 'product_note'>('content_note');
  const [productNoteAngles, setProductNoteAngles] = useState<string[]>(['overview', 'pain', 'use_case']);
  const knowledgeMode: KnowledgeMode = 'educational_original';
  const [topicsPerCard, setTopicsPerCard] = useState(2);
  const [jobCount, setJobCount] = useState('1');
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planUsage, setPlanUsage] = useState<AiUsageSummary | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [activeRunner, setActiveRunner] = useState<string | null>(null);
  const [tab, setTab] = useState<'running' | 'review' | 'success' | 'failed'>('review');
  const [reviewStep, setReviewStep] = useState<'title' | 'cover'>('title');
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const [exportState, setExportState] = useState<{ running: boolean; current: number; total: number; title: string; failures: string[] } | null>(null);
  const [slotJob, setSlotJob] = useState<{ job: BatchJob; card: CompetitorCreativeCard; skinId?: string; revision: number } | null>(null);
  const [titleSelections, setTitleSelections] = useState<Record<string, DraftTitleSelection>>({});
  const [skinSelections, setSkinSelections] = useState<Record<string, string>>({});
  const [workflowSelectedJobIds, setWorkflowSelectedJobIds] = useState<Set<string>>(new Set());
  const manuallyUnselectedWorkflowIdsRef = useRef(new Set<string>());
  const workflowSelectionBatchRef = useRef('');
  const slotReadyRef = useRef<((nodes: ExportNodes) => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const IMAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const searchParams = useSearchParams();
  const cardsForMode = supportedCards;
  const autoCoverPlan = usesStandardEducationalAutoPlan(productId, contentMode, knowledgeMode);
  const isProductNote = noteMode === 'product_note';
  const batchAutoCoverPlan = batch
    ? usesStandardEducationalAutoPlan(batch.product_id, batch.content_mode, batch.knowledge_mode)
    : autoCoverPlan;

  const fetchBatchState = useCallback(async (batchId: string) => {
    const response = await fetch(`/api/batch?batch_id=${encodeURIComponent(batchId)}`);
    if (!response.ok) throw new Error('查询批量状态失败');
    const data = (await response.json()) as BatchQueryResponse;
    setBatch(data.batch);
    setJobs(data.jobs);
    setActiveRunner(data.active_runner);
  }, []);

  useEffect(() => {
    if (!batch) return;
    const pendingImageJobs = jobs.some(job => Boolean(job.image_task_id) && job.status === 'running');
    const batchDone = batch.status === 'done' && !activeRunner;
    if (batchDone && !pendingImageJobs) return;
    // 正常运行中的批次仍保持快速刷新；只有批次表面已结束、但仍有
    // task_id 未完成的生图任务时，才使用用户要求的5分钟后台刷新。
    const refreshDelay = batchDone && pendingImageJobs ? IMAGE_REFRESH_INTERVAL_MS : 5000;
    pollRef.current = setTimeout(() => {
      fetchBatchState(batch.id).catch(console.error);
    }, refreshDelay);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [batch, jobs, activeRunner, fetchBatchState]);

  // 从首页 / 外部带 ?batch_id= 跳进来时，自动加载该 batch（含 single_<ts> 单条存档）。
  useEffect(() => {
    if (batch) return;
    const batchId = searchParams?.get('batch_id');
    if (!batchId) return;
    fetchBatchState(batchId).catch(error => {
      console.error('load batch by query failed:', error);
      setPlanError(`找不到或读取失败：${batchId}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function handlePlan() {
    setPlanning(true);
    setPlanError('');
    setPlanUsage(null);
    setBatch(null);
    setJobs([]);
    setActiveRunner(null);
    setReviewStep('title');
    setExpandedJobIds(new Set());
    setTitleSelections({});
    setSkinSelections({});
    setWorkflowSelectedJobIds(new Set());
    manuallyUnselectedWorkflowIdsRef.current.clear();
    try {
      const cardIds = cardsForMode.filter(c => selectedCardIds.has(c.id)).map(c => c.id);
      if (isProductNote && (productId !== 'delf_b2_writing' || !productNoteAngles.length)) {
        setPlanError('商品笔记 Phase 1B 当前请选择商品1和至少一个Selling Angle');
        return;
      }
      if (!isProductNote && autoCoverPlan && (!Number.isInteger(Number(jobCount)) || Number(jobCount) < 1 || Number(jobCount) > 20)) {
        setPlanError('生成篇数必须是1至20的整数');
        return;
      }
      if (!isProductNote && !autoCoverPlan && !cardIds.length) {
        setPlanError('请至少选择一个模板');
        return;
      }
      const response = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          product_id: productId,
          ...(autoCoverPlan ? { job_count: Number(jobCount) } : { card_ids: cardIds, topics_per_card: topicsPerCard }),
          direction,
          ...(productId === 'tef_tcf_canada' ? { exam_scope: examScope } : {}),
          topic_scope: topicScope,
          content_mode: contentMode,
          knowledge_mode: knowledgeMode,
          note_mode: noteMode,
          ...(isProductNote ? { product_note_angles: productNoteAngles } : {}),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '生成批量计划失败');
      const data = json as PlanResponse;
      setBatch(data.batch);
      setJobs(await loadJobs(data.batch.id));
      setPlanUsage(data.usage);
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : '生成批量计划失败');
    } finally {
      setPlanning(false);
    }
  }

  async function handleRun() {
    if (!batch) return;
    try {
      const response = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', batch_id: batch.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '启动批量失败');
      setTab('running');
      await fetchBatchState(batch.id);
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : '启动批量失败');
    }
  }

  async function handleRetryFailed() {
    if (!batch) return;
    try {
      const response = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry_failed', batch_id: batch.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '重试尸体失败');
      setTab('running');
      await fetchBatchState(batch.id);
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : '重试尸体失败');
    }
  }

  async function handleDeleteJob(jobId: string) {
    if (!batch) return;
    try {
      const response = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_job', batch_id: batch.id, job_id: jobId }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '删除失败');
      await fetchBatchState(batch.id);
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : '删除失败');
    }
  }

  async function handleRetryJob(jobId: string) {
    if (!batch || activeRunner) return;
    try {
      const response = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry_failed', batch_id: batch.id, job_ids: [jobId] }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || `${jobId} 重试失败`);
      setTab('running');
      await fetchBatchState(batch.id);
    } catch (cause) {
      setPlanError(cause instanceof Error ? cause.message : `${jobId} 重试失败`);
    }
  }

  const handleDraftPersisted = useCallback((jobId: string, draft: NonNullable<BatchJob['draft']>) => {
    setJobs(current => current.map(job => job.id === jobId ? { ...job, draft } : job));
    if (batch) void fetchBatchState(batch.id);
  }, [batch, fetchBatchState]);

  const handleResumeStarted = useCallback(async () => {
    if (!batch) return;
    // A successful resume response has no draft. Wake polling even from a done batch.
    setActiveRunner(batch.id);
    await fetchBatchState(batch.id);
  }, [batch, fetchBatchState]);

  async function advanceSelectedJobs(stage: 'title' | 'cover', stageJobs: BatchJob[]) {
    if (!batch) return;
    const jobIds = stageJobs.filter(job => workflowSelectedJobIds.has(job.id) && job.status !== 'running' && job.status !== 'failed').map(job => job.id);
    if (!jobIds.length) { setPlanError('请至少勾选一篇可继续的 Job'); return; }
    setPlanError('');
    try {
      const response = await fetch('/api/batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume_selected_jobs', batch_id: batch.id, job_ids: jobIds }),
      });
      const json = await response.json();
      if (!response.ok || json.started === false) throw new Error(json.error || json.reason || '批量推进失败');
      setActiveRunner(batch.id);
      setTab('running');
      if (stage === 'title') setReviewStep('cover');
      await fetchBatchState(batch.id);
    } catch (cause) { setPlanError(cause instanceof Error ? cause.message : '批量推进失败'); }
  }

  async function handleExportAll() {
    if (!batch || !successJobs.length || exportState?.running) return;
    // READY requires a successful validation export, so the export pass must
    // begin with content-ready jobs rather than only jobs already marked READY.
    const exportableJobs = successJobs.filter(job => {
      const manifest = job.commercial?.pageManifest;
      return Boolean(manifest?.expectedPageIds.length)
        && manifest!.expectedPageIds.every(id => {
          const page = manifest!.pages[id];
          return page?.contentStatus === 'pass' && page.densityStatus === 'pass' && page.frenchQaStatus === 'pass';
        });
    });
    if (!exportableJobs.length) {
      setExportState({ running: false, current: 0, total: 0, title: '没有可验证成品', failures: ['没有同时通过内容、密度和法语检查的 Job。'] });
      return;
    }
    const total = exportableJobs.length;
    setExportState({ running: true, current: 0, total, title: '', failures: [] });

    let sessionId = '';
    const expectedFiles: string[] = [];
    const readyJobIds: string[] = [];
    try {
      const initResponse = await fetch('/api/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'init', batch_id: batch.id }),
      });
      const initJson = await initResponse.json() as { session_id?: string; error?: string };
      if (!initResponse.ok || !initJson.session_id) throw new Error(initJson.error || '无法创建导出会话');
      sessionId = initJson.session_id;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : '无法创建导出会话';
      setExportState({ running: false, current: 0, total, title: '导出未开始', failures: [msg] });
      return;
    }

    async function upload(relativePath: string, blob: Blob) {
      const form = new FormData();
      form.set('session_id', sessionId);
      form.set('relative_path', relativePath);
      form.set('file', blob, relativePath.split('/').pop() || 'file');
      const response = await fetch('/api/batch-export', { method: 'POST', body: form });
      if (!response.ok) {
        const json = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(json.error || `上传失败：${relativePath}`);
      }
    }

    for (let i = 0; i < exportableJobs.length; i++) {
      const job = exportableJobs[i];
      const card = getCompetitorCreativeCard(job.reference_card_id);
      if (!job.draft || !card || job.draft.downstreamStale || job.draft.manualInnerReview?.status === 'needs_review') {
        setExportState(prev => prev ? { ...prev, failures: [...prev.failures, `${job.id}: 缺少 draft 或 card`] } : prev);
        continue;
      }

      let savedSelection = titleSelections[job.id];
      const canonicalPackage = resolveCanonicalTitlePackage(job.draft);
      try {
        // Use the same mode-aware production contract as single-note and ZIP
        // export. Text-only intentionally leaves the legacy bundle ID null.
        assertDraftTitleReadyForExport(job.draft);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : '标题或封面尚未完成';
        setExportState(prev => prev ? { ...prev, failures: [...prev.failures, `${job.id}: ${message}`] } : prev);
        continue;
      }
      if (!savedSelection && canonicalPackage.selectedBundleId) {
        const savedIndex = canonicalPackage.bundles.findIndex(bundle => bundle.id === canonicalPackage.selectedBundleId);
        if (savedIndex >= 0) savedSelection = getDraftTitleSelection(job.draft, savedIndex);
      }
      let effectiveJob: BatchJob = savedSelection && job.draft
        ? { ...job, draft: applyDraftTitleSelection(job.draft, savedSelection) }
        : job;
      if (effectiveJob.draft) {
        const bundleId = resolveCanonicalTitlePackage(effectiveJob.draft).selectedBundleId || savedSelection?.bundleId || 'default';
        try {
          const persistedBlocks = effectiveJob.draft.coverEditStates?.[bundleId]?.blocks;
          const rawCoverState = localStorage.getItem(`xhs-cover-edit:v5:${effectiveJob.draft.id}:${bundleId}`);
          const parsed = persistedBlocks?.length
            ? { blocks: persistedBlocks as Array<{ id: string; text: string }> }
            : rawCoverState ? JSON.parse(rawCoverState) as { blocks?: Array<{ id: string; text: string }> } : null;
          if (parsed?.blocks?.length) {
            const title = parsed.blocks.find(block => block.id === 'coverTitle')?.text ?? effectiveJob.draft.cover.title;
            const subtitle = parsed.blocks.find(block => block.id === 'coverSubtitle')?.text ?? effectiveJob.draft.cover.subtitle;
            effectiveJob = { ...effectiveJob, draft: { ...effectiveJob.draft, cover: { ...effectiveJob.draft.cover, title, subtitle }, cover_edit_meta: { edited: true, bundleId, editedBlocks: parsed.blocks.map(block => block.id), blocks: parsed.blocks } } };
          }
        } catch { /* invalid local editor state falls back to the selected Bundle */ }
      }
      setExportState(prev => prev ? { ...prev, current: i + 1, title: effectiveJob.topic.topic } : prev);

      try {
        let nodes: ExportNodes | undefined;
        if (effectiveJob.draft) assertDraftTitleReadyForExport(effectiveJob.draft);
        await document.fonts.ready;
        const readablePagePlan=measureReadablePagePlan(effectiveJob.draft!.inner_pages);
        const layoutResponse=await fetch('/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          action:'update_draft_state',batch_id:batch.id,job_id:effectiveJob.id,readable_page_plan:readablePagePlan,
        })});
        const layoutResult=await layoutResponse.json();
        if(!layoutResponse.ok || !layoutResult.job?.draft)throw new Error(layoutResult.error || '易读分页保存失败');
        effectiveJob={...effectiveJob,draft:{...effectiveJob.draft!,readablePagePlan}};
        let coverBlob: Blob | undefined;
        let coverStatus: CoverStatus | undefined;
        let innerBlobs = new Map<number, Blob>();
        for (let renderAttempt = 0; renderAttempt <= 2; renderAttempt += 1) {
          nodes = await new Promise<ExportNodes>(resolve => {
            slotReadyRef.current = resolve;
            setSlotJob({ job: effectiveJob, card, skinId: skinSelections[job.id], revision: renderAttempt });
          });
          innerBlobs = new Map<number, Blob>();
          if (job.cover_image_url) {
            coverBlob = await fetchUrlAsBlobOrNull(job.cover_image_url) || undefined;
            if (!coverBlob) throw new Error('封面图片下载失败');
            coverStatus = { kind: 'image', url: job.cover_image_url, downloaded: true };
          } else if (nodes.coverNode) {
            coverBlob = await nodeToPngBlob(nodes.coverNode);
            coverStatus = { kind: 'dom' };
          } else {
            throw new Error('缺少可导出的封面');
          }

          let overflowPageNo: number | undefined;
          let validationError: unknown;
          for (const [pageNo, node] of nodes.innerNodes) {
            try {
              innerBlobs.set(pageNo, await nodeToPngBlob(node));
            } catch (cause) {
              validationError = cause;
              if (cause instanceof Error && cause.message.includes('未解决溢出')) overflowPageNo = pageNo;
              break;
            }
          }
          if (!validationError) break;
          if (overflowPageNo === undefined || renderAttempt >= 2 || !effectiveJob.draft || effectiveJob.draft.readablePagePlan) throw validationError;
          const repaginated = repaginateDraftForOverflow(effectiveJob.draft, overflowPageNo);
          if (!repaginated) throw validationError;
          const persistResponse = await fetch('/api/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update_draft_state', batch_id: batch.id, job_id: effectiveJob.id, render_overflow_page_no: overflowPageNo }),
          });
          const persisted = await persistResponse.json() as { job?: BatchJob; error?: string };
          if (!persistResponse.ok || !persisted.job?.draft) throw new Error(persisted.error || '分页结果落盘失败');
          effectiveJob = { ...persisted.job, draft: repaginated };
          setJobs(current => current.map(item => item.id === effectiveJob.id ? effectiveJob : item));
        }
        if (!nodes || !coverBlob || !coverStatus || innerBlobs.size !== nodes.innerNodes.size) throw new Error('Validation Render 未完整通过');

        const folderName = seqFolderName(i, total, effectiveJob.draft!.selected_title);
        await upload(`${folderName}/封面.png`, coverBlob);
        for (const [pageNo, blob] of innerBlobs) {
          await upload(`${folderName}/内页${String(pageNo).padStart(2, '0')}.png`, blob);
        }
        await upload(`${folderName}/内容.txt`, new Blob([buildBatchTxt(effectiveJob, { coverStatus })], { type: 'text/plain;charset=utf-8' }));
        const renderedInnerPages = Array.from(nodes.innerNodes.keys());
        const deliveredPageIds = [
          COVER_MANIFEST_PAGE_ID,
          ...renderedInnerPages.map((_, index) => manifestPageIdForInnerOrdinal(index)),
        ];
        const artifactPaths = Object.fromEntries([
          [COVER_MANIFEST_PAGE_ID, `${folderName}/封面.png`],
          ...renderedInnerPages.map((pageNo, index) => [
            manifestPageIdForInnerOrdinal(index),
            `${folderName}/内页${String(pageNo).padStart(2, '0')}.png`,
          ]),
        ]);
        const deliveryResponse = await fetch('/api/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_commercial_delivery',
            batch_id: batch.id,
            job_id: effectiveJob.id,
            delivered_page_ids: deliveredPageIds,
            artifact_paths: artifactPaths,
          }),
        });
        const deliveryJson = await deliveryResponse.json().catch(() => ({})) as { error?: string; status?: string; job?: BatchJob };
        if (!deliveryResponse.ok || deliveryJson.status !== 'READY') {
          throw new Error(deliveryJson.error || 'Page Manifest 更新失败');
        }
        if (deliveryJson.job) setJobs(current => current.map(item => item.id === deliveryJson.job!.id ? deliveryJson.job! : item));
        readyJobIds.push(effectiveJob.id);
        expectedFiles.push(
          `${folderName}/封面.png`,
          ...Array.from(nodes.innerNodes.keys()).map(pageNo => `${folderName}/内页${String(pageNo).padStart(2, '0')}.png`),
          `${folderName}/内容.txt`,
        );
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : '未知错误';
        setExportState(prev => prev ? { ...prev, failures: [...prev.failures, `${job.id}: ${msg}`] } : prev);
      }
    }

    setSlotJob(null);
    slotReadyRef.current = null;

    if (!readyJobIds.length) {
      setExportState(prev => prev ? { ...prev, running: false, title: '没有通过 Validation Render 的 READY Job' } : prev);
      return;
    }
    try {
      setExportState(prev => prev ? { ...prev, title: '正在生成总 ZIP…' } : prev);
      const response = await fetch('/api/batch-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finalize', session_id: sessionId, expected_files: expectedFiles, ready_job_ids: readyJobIds }),
      });
      const json = await response.json() as { download_url?: string; error?: string; file_count?: number; zip_size?: number };
      if (!response.ok || !json.download_url) throw new Error(json.error || '总 ZIP 生成失败');
      setExportState(prev => prev ? { ...prev, title: '正在接收并校验 ZIP…' } : prev);
      const downloadResponse = await fetch(json.download_url, { cache: 'no-store' });
      if (!downloadResponse.ok) throw new Error('ZIP下载失败，请重试');
      const downloadType = downloadResponse.headers.get('content-type') || '';
      if (!/application\/(zip|octet-stream)/i.test(downloadType)) throw new Error('下载响应不是ZIP文件，已停止保存');
      const zipBlob = await downloadResponse.blob();
      if (!zipBlob.size) throw new Error('下载到的ZIP为空，已停止保存');
      if (json.zip_size && zipBlob.size !== json.zip_size) throw new Error(`ZIP下载不完整：应为${json.zip_size}字节，实际${zipBlob.size}字节`);
      const downloadUrl = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      // A stable filename makes browsers append (1)/(2), which easily leads
      // users to reopen an older broken archive. Every export is a new,
      // auditable artifact, so give it a unique timestamped name.
      const exportStamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      anchor.download = `批量_${batch.id}_${exportStamp}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
      const sizeMb = (zipBlob.size / 1024 / 1024).toFixed(1);
      setExportState(prev => prev ? { ...prev, running: false, current: total, title: `导出完成：${json.file_count || expectedFiles.length}个文件，${sizeMb} MB` } : prev);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : '打包失败';
      setExportState(prev => prev ? { ...prev, running: false, failures: [...prev.failures, `zip 打包: ${msg}`] } : prev);
    }
  }

  function toggleCard(cardId: string) {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  function toggleExpand(jobId: string) {
    setExpandedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }

  const planJobs = jobs;
  const visibleJobs = useMemo(() => planJobs.filter(job => job.status !== 'pending' || batch?.status === 'planned'), [planJobs, batch]);
  const successJobs = useMemo(() => planJobs.filter(job => job.status === 'success' && job.draft), [planJobs]);
  const failedJobs = useMemo(() => planJobs.filter(job => job.status === 'failed'), [planJobs]);
  // A Job has one user-facing state. Failed Jobs belong only to the corpse
  // pool; a preserved draft is retry context, not an active review item.
  const reviewJobs = useMemo(() => planJobs.filter(job => job.draft && (job.status === 'awaiting_review' || job.status === 'dropped')), [planJobs]);
  const titleStageJobs = useMemo(() => reviewJobs.filter(job => !job.draft?.coverCopy && job.status !== 'dropped'), [reviewJobs]);
  const coverStageJobs = useMemo(() => reviewJobs.filter(job => Boolean(job.draft?.coverCopy && job.artifacts?.content?.data.coverCandidates?.some(candidate => !candidate.rejectionReason)) && job.status !== 'dropped'), [reviewJobs]);
  const runningJobs = useMemo(() => planJobs.filter(job => job.status === 'running'), [planJobs]);
  const selectableWorkflowIds = useMemo(() => [...titleStageJobs, ...coverStageJobs]
    .filter(job => job.status !== 'failed' && job.status !== 'running')
    .map(job => job.id), [titleStageJobs, coverStageJobs]);
  useEffect(() => {
    if (titleStageJobs.length && !coverStageJobs.length) setReviewStep('title');
    else if (coverStageJobs.length && !titleStageJobs.length) setReviewStep('cover');
  }, [titleStageJobs.length, coverStageJobs.length]);
  useEffect(() => {
    const batchId = batch?.id || '';
    if (workflowSelectionBatchRef.current === batchId) return;
    workflowSelectionBatchRef.current = batchId;
    manuallyUnselectedWorkflowIdsRef.current.clear();
    setWorkflowSelectedJobIds(new Set());
  }, [batch?.id]);
  useEffect(() => {
    const currentIds = new Set(selectableWorkflowIds);
    setWorkflowSelectedJobIds(previous => {
      const next = new Set([...previous].filter(id => currentIds.has(id)));
      for (const id of selectableWorkflowIds) {
        if (!manuallyUnselectedWorkflowIdsRef.current.has(id)) next.add(id);
      }
      return next;
    });
  }, [selectableWorkflowIds.join('|')]);
  function toggleWorkflowJob(jobId: string) {
    setWorkflowSelectedJobIds(previous => {
      const next = new Set(previous);
      if (next.has(jobId)) {
        next.delete(jobId);
        manuallyUnselectedWorkflowIdsRef.current.add(jobId);
      } else {
        next.add(jobId);
        manuallyUnselectedWorkflowIdsRef.current.delete(jobId);
      }
      return next;
    });
  }
  const renderBatchAdvance = (stage: 'title' | 'cover', stageJobs: BatchJob[]) => {
    const selected = stageJobs.filter(job => job.status !== 'failed' && job.status !== 'running' && workflowSelectedJobIds.has(job.id));
    const ready = stage === 'title'
      ? selected.filter(job => {
          if (!job.draft) return false;
          const titlePackage = resolveCanonicalTitlePackage(job.draft);
          return Boolean(titlePackage.humanSelectedTextTitleId && titlePackage.humanSelectedCoverTitleId);
        })
      : selected.filter(job => Boolean(job.draft?.coverSelection?.confirmedTemplateId));
    const label = stage === 'title' ? '一键进入封面匹配' : '一键生成成品';
    return <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-neutral-900 bg-white p-4" data-testid={`batch-${stage}-advance`}>
      <div><div className="font-black">{stage === 'title' ? '选好每篇文字标题和封面标题后，批量进入封面' : '选好每篇封面后，批量生成成品'}</div><div className="mt-1 text-xs text-neutral-600">已勾选 {selected.length} 篇 · 已准备 {ready.length} 篇{stageJobs.some(job=>job.status==='failed')?' · 失败Job不阻塞其他篇':''}</div></div>
      <button type="button" disabled={!selected.length || ready.length !== selected.length || Boolean(activeRunner)} onClick={() => advanceSelectedJobs(stage, stageJobs)} className="min-h-12 bg-neutral-950 px-5 py-3 text-sm font-black text-white disabled:bg-neutral-300">{activeRunner ? '生成中，请稍候…' : `${label}（${selected.length}篇）`}</button>
    </div>;
  };
  const runningJob = planJobs.find(job => job.status === 'running');
  const summary = summarize(planJobs);
  const totalUsage = useMemo(() => summarizeTokenUsage([batch?.planning_usage, ...planJobs.map(job => job.usage)]), [planJobs, batch?.planning_usage]);

  return (
    <main className="min-h-screen bg-[#f4f5f6] text-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-[1500px] items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-black">批量生成工作台</h1>
            <p className="mt-1 text-sm text-neutral-500">{autoCoverPlan ? '生成正文（默认通过）→ 选择文字标题 → 自动匹配封面 → 选择封面 → 批量生成与导出' : '选题与模板 → 批量生成 → 选择标题与封面 → 验收导出'}</p>
          </div>
          <div className="flex gap-4 text-sm font-bold underline">
            <Link href="/">单篇工作台</Link>
            <Link href="/template-matrix">模板总览</Link>
            <Link href="/product-assets">商品1素材确认</Link>
            <Link href="/product-assets">商品1素材确认</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-5 p-5">
        {planError ? <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{planError}</div> : null}

        {!batch ? (
          <PlanForm
            productId={productId}
            setProductId={setProductId}
            selectedCardIds={selectedCardIds}
            toggleCard={toggleCard}
            setSelectedCardIds={setSelectedCardIds}
            direction={direction}
            examScope={examScope}
            setExamScope={setExamScope}
            topicScope={topicScope}
            setTopicScope={setTopicScope}
            setDirection={setDirection}
            contentMode={contentMode}
            noteMode={noteMode}
            setNoteMode={setNoteMode}
            productNoteAngles={productNoteAngles}
            setProductNoteAngles={setProductNoteAngles}
            knowledgeMode={knowledgeMode}
            cardsForMode={cardsForMode}
            topicsPerCard={topicsPerCard}
            setTopicsPerCard={setTopicsPerCard}
            jobCount={jobCount}
            setJobCount={setJobCount}
            planning={planning}
            onPlan={handlePlan}
          />
        ) : null}

        {batch ? (
          <>
            <section className="border border-neutral-200 bg-white p-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-neutral-400">批量</div>
                  <div className="mt-1 font-mono text-sm">{batch.id}</div>
                  <div className="mt-1 text-xs text-neutral-500">状态：{batch.status} · 创建于 {batch.created_at}</div>
                </div>
                {planUsage ? <div className="text-xs text-neutral-500">选题阶段用量：{planUsage.total_tokens.toLocaleString()} tokens · {planUsage.calls} 次调用</div> : null}
              </div>
            </section>

            {batch.plan_meta && (batch.plan_meta.candidate_pool || batch.plan_meta.needs_manual_review || batch.plan_meta.unselected_candidates?.length || batch.plan_meta.warnings?.length) ? (
              <section className="border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                <div className="font-black">选题计划提醒</div>
                {batch.plan_meta.candidate_pool ? (
                  <div className="mt-2">
                    本次请求 {batch.plan_meta.candidate_pool.requested_jobs} 篇；AI 返回 {batch.plan_meta.candidate_pool.generated_candidates} 个候选；已保留 {batch.plan_meta.candidate_pool.production_jobs} 篇可继续。
                  </div>
                ) : null}
                {batch.plan_meta.needs_manual_review ? <div className="mt-2 font-bold">本批含程序兜底选题，需人工复核后再发布。</div> : null}
                {batch.plan_meta.warnings?.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {batch.plan_meta.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                  </ul>
                ) : null}
                {batch.plan_meta.unselected_candidates?.length ? (
                  <div className="mt-3">
                    <div className="font-bold">未选中的候选（{batch.plan_meta.unselected_candidates.length}）</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5">
                      {batch.plan_meta.unselected_candidates.map((candidate, index) => (
                        <li key={index}>{cardName(candidate.card_id)}：{candidate.topic} —— {candidate.reason}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ) : null}

            {batch.status === 'planned' ? (
              <section className="border border-neutral-200 bg-white p-5">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="font-black">计划确认（{planJobs.length} 篇笔记）</h2>
                    <p className="mt-1 text-sm text-neutral-500">{batchAutoCoverPlan ? '确认选题后开始生成正文；正文完成后自动匹配封面，不需要的笔记可单独移除。' : '可单独移除不需要的笔记；移除后不参与本次执行。'}</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="border border-neutral-300 bg-white px-4 py-2 text-sm font-bold" onClick={() => setBatch(null)}>放弃计划</button>
                    <button className="bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-400" disabled={!planJobs.length} onClick={handleRun}>{batchAutoCoverPlan ? '确认选题，生成正文' : '开始运行'}</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {planJobs.map(job => (
                    <div key={job.id} className="flex items-start justify-between gap-3 border border-neutral-200 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-bold">{batchAutoCoverPlan ? '封面待自动匹配' : cardName(job.reference_card_id)}</div>
                        <div className="mt-1 text-xs text-neutral-500">{job.topic.topic}</div>
                      </div>
                      <button className="text-xs text-red-600 underline" onClick={() => handleDeleteJob(job.id)}>移除</button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <BatchUsagePanel key={batch.id} values={[batch.planning_usage, ...planJobs.map(job => job.usage)]} missingPlanning={!batch.planning_usage} />
            {batch.status !== 'planned' ? (
              <>
                <section className="border border-neutral-200 bg-white p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="font-black">进度</h2>
                      <p className="mt-1 text-sm text-neutral-500">
                        完成 {summary.success + summary.failed} / {summary.total}
                        {summary.pending ? ` · 待跑 ${summary.pending}` : ''}
                        {runningJob ? ` · 正在处理第 ${runningJob.seq} 篇` : ''}
                        {activeRunner ? ` · runner=${activeRunner}` : ''}
                      </p>
                      <div className="mt-3 h-2 w-full bg-neutral-200">
                        <div className="h-full bg-neutral-900" style={{ width: `${summary.total ? ((summary.success + summary.failed) / summary.total) * 100 : 0}%` }} />
                      </div>
                    </div>
                    <div className="text-right text-xs text-neutral-500">
                      <div>累计 token</div>
                      <div className="font-bold text-neutral-900">{totalUsage.total_tokens.toLocaleString()}</div>
                      <div>{totalUsage.calls} 次调用</div>
                    </div>
                  </div>
                </section>

                <div className="flex gap-2">
                  <TabButton active={tab === 'running'} onClick={() => setTab('running')}>进行中（{runningJobs.length}）</TabButton>
                  <TabButton active={tab === 'review'} onClick={() => setTab('review')}>待人工选择（{reviewJobs.length}）</TabButton>
                  <TabButton active={tab === 'success'} onClick={() => setTab('success')}>成品池（{successJobs.length}）</TabButton>
                  <TabButton active={tab === 'failed'} onClick={() => setTab('failed')}>尸体池（{failedJobs.length}）</TabButton>
                </div>

                {tab === 'running' && <section className="space-y-4" data-testid="batch-running-stage">
                  <div className="border-2 border-cyan-800 bg-cyan-50 p-4"><h2 className="text-lg font-black text-cyan-950">正在处理中的 Job</h2><p className="mt-1 text-sm text-cyan-900">这些 Job 正在等待模型或图片服务返回结果，当前不可选择、编辑、确认封面或导出。完成后会自动回到对应的人工选择或成品区。</p></div>
                  {!runningJobs.length && <div className="border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">当前没有正在处理的 Job</div>}
                  {runningJobs.map(job => <article key={job.id} className="border-2 border-cyan-700 bg-white p-4" data-testid={`running-${job.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-xs font-black tracking-wide text-cyan-800">{job.id} · 正在处理</div><h3 className="mt-1 text-lg font-black leading-snug">{job.topic.topic}</h3></div><span className="border border-cyan-700 bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-900">{job.current_stage || '处理中'}</span></div>
                    <p className="mt-3 text-sm text-neutral-600">系统会继续处理，本篇暂不需要人工确认。请勿重复点击或刷新提交；页面会自动更新状态。</p>
                  </article>)}
                </section>}

                {tab === 'review' && <section className="space-y-7">
                  {!reviewJobs.length && <div className="bg-white p-6 text-sm text-neutral-500">暂无待选择内容</div>}
                  {titleStageJobs.length > 0 && coverStageJobs.length > 0 && <div role="tablist" aria-label="当前人工操作阶段" className="grid grid-cols-2 gap-2 border border-neutral-200 bg-white p-2">
                    <button type="button" role="tab" aria-selected={reviewStep === 'title'} onClick={()=>setReviewStep('title')} className={`min-h-12 px-4 py-3 text-sm font-black ${reviewStep === 'title' ? 'bg-neutral-950 text-white' : 'bg-neutral-100 text-neutral-600'}`}>选文字标题（{titleStageJobs.length}）</button>
                    <button type="button" role="tab" aria-selected={reviewStep === 'cover'} onClick={()=>setReviewStep('cover')} className={`min-h-12 px-4 py-3 text-sm font-black ${reviewStep === 'cover' ? 'bg-neutral-950 text-white' : 'bg-neutral-100 text-neutral-600'}`}>选封面（{coverStageJobs.length}）</button>
                  </div>}
                  {reviewStep === 'title' && titleStageJobs.length > 0 && <section className="space-y-4" data-testid="batch-title-stage">
                    <div><h2 className="text-lg font-black">第1步：每篇分别选择文字标题和封面标题</h2><p className="text-sm text-neutral-600">两个标题来自同一候选池，可以相同也可以不同；正文已默认通过并收起。</p></div>
                    {renderBatchAdvance('title', titleStageJobs)}
                    {titleStageJobs.map(job => {
                      const card = getCompetitorCreativeCard(job.reference_card_id);
                      if (!job.draft || !card) return null;
                      return <article key={job.id} data-testid={`review-${job.id}`} className="border border-neutral-200 bg-white p-4">
                        <label className="mb-4 flex cursor-pointer items-start gap-3 font-bold"><input type="checkbox" className="mt-1 h-5 w-5" disabled={job.status==='failed'||job.status==='running'} checked={workflowSelectedJobIds.has(job.id)} onChange={() => toggleWorkflowJob(job.id)} /> <span>{job.id} · {job.topic.topic}{job.status==='failed'?' · 本篇失败，不影响其他篇继续':''} · {workflowSelectedJobIds.has(job.id)?'已加入批量处理':'未加入批量处理'}</span></label>
                        <DraftReview batchAdvanceMode draft={job.draft} topic={job.topic} card={card} productId={job.product_id} examScope={job.topic.exam_scope} coverCandidates={job.artifacts?.content?.data.coverCandidates} batchId={batch?.id} jobId={job.id} jobStatus={job.status} currentStage={job.current_stage} onDraftPersisted={draft => handleDraftPersisted(job.id, draft)} onResumeStarted={handleResumeStarted} />
                      </article>;
                    })}
                    {renderBatchAdvance('title', titleStageJobs)}
                  </section>}
                  {reviewStep === 'cover' && coverStageJobs.length > 0 && <section className="space-y-4" data-testid="batch-cover-stage">
                    <div><h2 className="text-lg font-black">第2步：每篇选择一个封面</h2><p className="text-sm text-neutral-600">可采用自动推荐，也可手动换选；确认完后统一生成。</p></div>
                    {renderBatchAdvance('cover', coverStageJobs)}
                    {coverStageJobs.map(job => {
                      const card = getCompetitorCreativeCard(job.reference_card_id);
                      if (!job.draft || !card) return null;
                      return <article key={job.id} data-testid={`review-${job.id}`} className="border border-neutral-200 bg-white p-4">
                        <label className="mb-4 flex cursor-pointer items-start gap-3 font-bold"><input type="checkbox" className="mt-1 h-5 w-5" disabled={job.status==='failed'||job.status==='running'} checked={workflowSelectedJobIds.has(job.id)} onChange={() => toggleWorkflowJob(job.id)} /> <span>{job.id} · {job.topic.topic}{job.status==='failed'?' · 本篇失败，不影响其他篇继续':''} · {workflowSelectedJobIds.has(job.id)?'已加入批量处理':'未加入批量处理'}</span></label>
                        <DraftReview batchAdvanceMode draft={job.draft} topic={job.topic} card={card} productId={job.product_id} examScope={job.topic.exam_scope} coverCandidates={job.artifacts?.content?.data.coverCandidates} batchId={batch?.id} jobId={job.id} jobStatus={job.status} currentStage={job.current_stage} onDraftPersisted={draft => handleDraftPersisted(job.id, draft)} onResumeStarted={handleResumeStarted} />
                      </article>;
                    })}
                    {renderBatchAdvance('cover', coverStageJobs)}
                  </section>}
                </section>}

                {tab === 'success' ? (
                  <section className="space-y-3">
                    {successJobs.length ? (
                      <div className="flex items-center justify-between border border-neutral-200 bg-white px-4 py-2">
                        <div className="text-sm font-bold">共 {successJobs.length} 篇成品</div>
                        <button
                          className="bg-neutral-950 px-4 py-2 text-xs font-bold text-white disabled:bg-neutral-400"
                          disabled={!!exportState?.running}
                          onClick={handleExportAll}
                        >
                          {exportState?.running ? `导出中 ${exportState.current}/${exportState.total}` : '一键导出全部（zip）'}
                        </button>
                      </div>
                    ) : null}
                    {!successJobs.length ? <div className="border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">还没有成品</div> : null}
                    {successJobs.map(job => {
                      const card = getCompetitorCreativeCard(job.reference_card_id);
                      if (!job.draft || !card) return null;
                      const expanded = expandedJobIds.has(job.id);
                      return (
                        <div key={job.id} className="border border-neutral-200 bg-white p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-neutral-400">{job.id} · 尝试 {job.attempts} 次</div>
                              <div className="mt-1 text-lg font-black leading-snug">{job.draft.selected_title}</div>
                              <div className="mt-1 text-xs text-neutral-500">{card.name} · {job.topic.topic}</div>
                              {job.warnings?.length ? (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-xs font-bold text-amber-700">生成提醒（{job.warnings.length}）</summary>
                                  <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-amber-800">
                                    {job.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
                                  </ul>
                                </details>
                              ) : null}
                            </div>
                            <button className="border border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-600" onClick={() => toggleExpand(job.id)}>{expanded ? '收起成品' : '查看成品'}</button>
                          </div>
                          {expanded ? <div className="mt-4 border-t border-neutral-200 pt-4"><DraftReview draft={job.draft} topic={job.topic} card={card} productId={job.product_id} examScope={job.topic.exam_scope} coverCandidates={job.artifacts?.content?.data.coverCandidates} presetCoverImageUrl={job.cover_image_url} batchId={batch?.id} jobId={job.id} jobStatus={job.status} currentStage={job.current_stage} draftUpdatedAt={job.finished_at} draftSchemaVersion={job.artifacts?.compiledDraft?.schema_version} initialTitleSelection={titleSelections[job.id]} onTitleSelectionChange={selection => setTitleSelections(current => ({ ...current, [job.id]: selection }))} onDraftPersisted={persistedDraft => handleDraftPersisted(job.id, persistedDraft)} onResumeStarted={handleResumeStarted} initialSkinId={skinSelections[job.id]} onSkinChange={skinId => setSkinSelections(current => ({ ...current, [job.id]: skinId }))} /></div> : null}
                        </div>
                      );
                    })}
                  </section>
                ) : null}

                {tab === 'failed' ? (
                  <section className="space-y-3">
                    {!failedJobs.length ? <div className="border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">没有尸体</div> : (
                      <div className="border border-neutral-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-black">一键重试全部尸体</div>
                          <button className="bg-[#c82d3e] px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-400" disabled={!!activeRunner} onClick={handleRetryFailed}>{activeRunner ? '已有 runner 在跑' : '重试全部'}</button>
                        </div>
                      </div>
                    )}
                    {failedJobs.map(job => (
                      <div key={job.id} className="border border-red-200 bg-red-50 p-4 text-sm">
                        <div className="text-xs font-bold text-red-700">{job.id} · 阶段 {job.failure?.stage ?? 'unknown'} · 尝试 {job.attempts} 次</div>
                        <div className="mt-1 font-bold">{cardName(job.reference_card_id)}</div>
                        <div className="mt-1 text-neutral-700">{job.topic.topic}</div>
                        <div className="mt-2 whitespace-pre-wrap font-mono text-xs text-red-900">{job.failure?.message}</div>
                        {job.usage ? <div className="mt-2 text-xs text-neutral-500">消耗 {job.usage.total_tokens.toLocaleString()} tokens · {job.usage.calls} 次</div> : null}
                        <button type="button" className="mt-3 border border-red-700 bg-white px-3 py-2 text-xs font-black text-red-800 disabled:opacity-40" disabled={!!activeRunner} onClick={() => handleRetryJob(job.id)}>{activeRunner ? '已有任务运行中' : '只重试本篇'}</button>
                      </div>
                    ))}
                  </section>
                ) : null}

                {visibleJobs.length ? (
                  <section className="border border-neutral-200 bg-white p-4">
                    <div className="text-sm font-black">所有 job 状态</div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {planJobs.map(job => (
                        <div key={job.id} className="border border-neutral-200 p-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold">{cardName(job.reference_card_id)}</span>
                            <StatusBadge status={job.status} />
                          </div>
                          <div className="mt-1 text-neutral-500">{job.topic.topic}</div>
                          <div className="mt-1 text-neutral-400">{job.id} · 尝试 {job.attempts}</div>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {slotJob ? (
        <BatchExportSlot
          key={`${slotJob.job.id}:${slotJob.revision}`}
          job={slotJob.job}
          card={slotJob.card}
          skinId={slotJob.skinId}
          onReady={nodes => {
            const resolve = slotReadyRef.current;
            slotReadyRef.current = null;
            resolve?.(nodes);
          }}
        />
      ) : null}

      {exportState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-neutral-300 bg-white p-6">
            <div className="text-sm font-black">批量导出</div>
            <div className="mt-2 text-xs text-neutral-500">{exportState.current} / {exportState.total}</div>
            <div className="mt-1 truncate text-sm font-bold text-neutral-900">{exportState.title || '准备中...'}</div>
            <div className="mt-3 h-2 w-full bg-neutral-200">
              <div
                className="h-full bg-neutral-900 transition-all duration-150"
                style={{ width: `${(exportState.current / Math.max(exportState.total, 1)) * 100}%` }}
              />
            </div>
            {exportState.failures.length ? (
              <div className="mt-3 max-h-32 overflow-auto border-t border-neutral-200 pt-3 text-xs leading-relaxed text-red-700">
                <div className="font-bold">失败 {exportState.failures.length} 项：</div>
                <ul className="mt-1 space-y-0.5">
                  {exportState.failures.map((f, idx) => <li key={idx}>· {f}</li>)}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 text-center text-xs text-neutral-500">
              {exportState.running ? '正在逐篇落盘并流式打包，请勿关闭页面' : '导出过程已结束；已完成的文件不会因弹窗关闭而丢失'}
            </div>
            {!exportState.running ? (
              <button
                className="mt-4 w-full border border-neutral-300 bg-white px-3 py-2 text-xs font-bold"
                onClick={() => setExportState(null)}
              >
                关闭
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PlanForm({
  topicScope,
  setTopicScope,
  productId,
  setProductId,
  selectedCardIds,
  toggleCard,
  setSelectedCardIds,
  direction,
  setDirection,
  examScope,
  setExamScope,
  contentMode,
  noteMode,
  setNoteMode,
  productNoteAngles,
  setProductNoteAngles,
  knowledgeMode,
  cardsForMode,
  topicsPerCard,
  setTopicsPerCard,
  jobCount,
  setJobCount,
  planning,
  onPlan,
}: {
  topicScope: 'large' | 'medium';
  setTopicScope: (value:'large' | 'medium')=>void;
  productId: ProductId;
  setProductId: (value: ProductId) => void;
  selectedCardIds: Set<string>;
  toggleCard: (id: string) => void;
  setSelectedCardIds: (value: Set<string>) => void;
  direction: string;
  setDirection: (value: string) => void;
  examScope: ExamScope;
  setExamScope: (value: ExamScope) => void;
  contentMode: 'standard' | 'product_showcase';
  noteMode: 'content_note' | 'product_note';
  setNoteMode: (value: 'content_note' | 'product_note') => void;
  productNoteAngles: string[];
  setProductNoteAngles: (value: string[]) => void;
  knowledgeMode: KnowledgeMode;
  cardsForMode: CompetitorCreativeCard[];
  topicsPerCard: number;
  setTopicsPerCard: (value: number) => void;
  jobCount: string;
  setJobCount: (value: string) => void;
  planning: boolean;
  onPlan: () => void;
}) {
  const autoCoverPlan = usesStandardEducationalAutoPlan(productId, contentMode, knowledgeMode);
  const isProductNote = noteMode === 'product_note';
  const validJobCount = Number.isInteger(Number(jobCount)) && Number(jobCount) >= 1 && Number(jobCount) <= 20;
  return (
    <section className="border border-neutral-200 bg-white p-5">
      <h2 className="font-black">{autoCoverPlan ? '新建笔记' : '发起批量'}</h2>
      <p className="mt-1 text-sm text-neutral-500">{autoCoverPlan ? '先确定篇数和方向，不需要选择封面。首次验收建议生成1篇。' : '勾选模板后生成批量计划；每篇笔记独立生成。'}</p>
      <div className={`mt-4 grid gap-6 ${autoCoverPlan ? 'md:grid-cols-2' : 'md:grid-cols-[1fr_3fr]'}`}>
        <div>
          <label htmlFor="plan-product" className="block text-xs font-bold text-neutral-500">商品</label>
          <select id="plan-product" className="field mt-1" value={productId} onChange={event => setProductId(event.target.value as ProductId)}>
            <option value="delf_b2_writing">商品1：DELF B2写作资料库</option>
            <option value="tef_tcf_canada">商品2：TEF/TCF Canada</option>
            <option value="tcf_canada_writing_7day">商品3：TCF Canada写作7天急救</option>
          </select>
          <label htmlFor="plan-count" className="mt-4 block text-xs font-bold text-neutral-500">{autoCoverPlan ? '生成篇数' : '每张封面最终生成几篇'}</label>
          <input id="plan-count" type="number" min={1} max={autoCoverPlan ? 20 : 3} step={1} className="field mt-1" value={autoCoverPlan ? jobCount : topicsPerCard} aria-invalid={autoCoverPlan && !validJobCount} aria-describedby="plan-count-help" onChange={event => autoCoverPlan ? setJobCount(event.target.value) : setTopicsPerCard(Number(event.target.value) || 2)} />
          <p id="plan-count-help" className="mt-1 text-xs leading-relaxed text-neutral-500">{autoCoverPlan ? (validJobCount ? `本次请求 ${jobCount} 篇独立笔记，不按封面数量倍增。支持1–20篇，篇数越多调用和等待越多。` : '请输入1至20的整数，留空不会提交。') : '每个选中模板生成1–3篇独立笔记。'}</p>
          <select id="plan-note-mode" className="field mt-1" value={noteMode} onChange={event => setNoteMode(event.target.value as 'content_note' | 'product_note')}>
            <option value="content_note">普通内容笔记</option>
            <option value="product_note">商品笔记（Phase 1B）</option>
          </select>
          {isProductNote ? <fieldset className="mt-3 border border-neutral-200 p-3" disabled={planning}>
            <legend className="px-1 text-xs font-bold text-neutral-500">Selling Angle（用户先选，素材只负责证明）</legend>
            {[['overview','商品全貌型'],['pain','痛点对应商品型'],['use_case','使用场景型']].map(([id,label]) => <label key={id} className="mt-2 block text-sm"><input type="checkbox" checked={productNoteAngles.includes(id)} onChange={event => setProductNoteAngles(event.target.checked ? [...productNoteAngles, id] : productNoteAngles.filter(item => item !== id))} /> <span className="ml-2">{label}</span></label>)}
            <p className="mt-2 text-xs text-neutral-500">选中的每个角度生成1篇；每篇由一次策划调用选择4–6张真实PDF截图。</p>
          </fieldset> : null}
          {!isProductNote ? <div className="mt-4 border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-5 text-neutral-600">普通内容笔记 · AI原创，不读取商品知识库</div> : null}
          {autoCoverPlan && <fieldset className="mt-4" disabled={planning}>
            <legend className="text-xs font-bold text-neutral-500">选题范围（整批统一）</legend>
            <div className="mt-2 flex gap-4">
              <label className="cursor-pointer"><input type="radio" name="topic-scope" value="large" checked={topicScope==='large'} onChange={()=>setTopicScope('large')} /> 市场选题</label>
              <label className="cursor-pointer"><input type="radio" name="topic-scope" value="medium" checked={topicScope==='medium'} onChange={()=>setTopicScope('medium')} /> 长尾选题</label>
            </div>
            <p className="mt-1 text-xs text-neutral-500">{topicScope==='large'?'面向更广泛备考需求的市场入口，围绕一个完整主题展开。':'面向已有具体卡点的长尾入口，聚焦一个完整能力块或任务。'} 具体选题由AI策划，整批统一。</p>
          </fieldset>}
          {productId === 'tef_tcf_canada' && contentMode === 'standard' ? (
            <fieldset className="mt-4" disabled={planning}>
              <legend className="text-xs font-bold text-neutral-500">商品2考试范围（整批统一）</legend>
              <select className="field mt-1" value={examScope} onChange={event => setExamScope(event.target.value as ExamScope)}>
                <option value="common">选考 / 移民政策 / 两场共同方法</option>
                <option value="tef_canada">TEF Canada写作（只讲TEF）</option>
                <option value="tcf_canada">TCF Canada写作（只讲TCF）</option>
              </select>
              <p className="mt-1 text-xs leading-relaxed text-neutral-500">写作专题请选择TEF或TCF；只有选考、政策和共同适用的方法才选“共同”。避免把“TEF/TCF写作”拼成一个考试。</p>
            </fieldset>
          ) : null}
          <label htmlFor="plan-direction" className="mt-4 block text-xs font-bold text-neutral-500">方向（可选）</label>
          <textarea id="plan-direction" className="field mt-1 min-h-20 resize-y" placeholder={isProductNote ? 'Selling Angle 已由上方选择' : autoCoverPlan ? '例如：正式信的语气选择；留空由AI决定选题' : '例如：更偏考前急救'} value={direction} onChange={event => setDirection(event.target.value)} />
          <button className="mt-4 w-full bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white disabled:bg-neutral-400" disabled={planning || (!isProductNote && autoCoverPlan && !validJobCount)} onClick={onPlan}>
            {planning ? '正在生成计划...' : isProductNote ? `生成商品笔记（${productNoteAngles.length}篇）` : autoCoverPlan ? `生成选题计划（${validJobCount ? jobCount : '—'}篇）` : '生成批量计划'}
          </button>
          {autoCoverPlan && <p className="mt-2 text-xs text-neutral-500">此按钮只生成选题，会调用AI；确认计划后才生成正文。</p>}
        </div>
        {autoCoverPlan ? <aside className="self-start border border-neutral-200 bg-neutral-50 p-5" aria-label="生成流程">
          <h3 className="font-bold">封面自动匹配，不用提前选</h3>
          <ol className="mt-4 list-decimal space-y-4 pl-5 text-sm leading-relaxed">
            <li>确认选题，生成正文。</li>
            <li>正文默认通过，标题按原始 Skill 默认生成12条候选；通过客观校验的候选全部展示，至少4条即可继续。</li>
            <li>你为每篇选择1条标题，再一键进入封面匹配。</li>
            <li>为每篇选择并确认封面后，一键批量生成成品；系统再生成发布正文、标签并检查。</li>
            <li>验收实际图片和发布文字，导出成品。</li>
          </ol>
          <p className="mt-5 border-t border-neutral-200 pt-4 text-xs leading-relaxed text-neutral-600">匹配到生图模板时，会调用图片模型并产生额外费用；匹配到排版模板时直接渲染。生成完成不等于内容已通过人工验收。</p>
        </aside> : <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-neutral-500">模板（{selectedCardIds.size}/{cardsForMode.length}）</label>
            <div className="flex gap-2 text-xs">
              <button className="underline" onClick={() => toggleAll(true)}>全选</button>
              <button className="underline" onClick={() => toggleAll(false)}>全不选</button>
              <button className="underline" onClick={() => selectByMode('code')}>只选 code/hybrid</button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {cardsForMode.map(card => (
              <CardCheckbox key={card.id} card={card} checked={selectedCardIds.has(card.id)} onToggle={() => toggleCard(card.id)} />
            ))}
          </div>
        </div>}
      </div>
    </section>
  );

  function toggleAll(value: boolean) {
    cardsForMode.forEach(card => {
      const inSet = selectedCardIds.has(card.id);
      if (value && !inSet) toggleCard(card.id);
      if (!value && inSet) toggleCard(card.id);
    });
  }

  function selectByMode(mode: 'code') {
    cardsForMode.forEach(card => {
      const spec = getCoverTemplateSpec(card.renderer_id);
      const isCodeLike = spec?.renderMode !== 'image_to_image';
      const inSet = selectedCardIds.has(card.id);
      if (mode === 'code' && isCodeLike && !inSet) toggleCard(card.id);
      if (mode === 'code' && !isCodeLike && inSet) toggleCard(card.id);
    });
  }
}

function CardCheckbox({ card, checked, onToggle }: { card: CompetitorCreativeCard; checked: boolean; onToggle: () => void }) {
  const mode = getCoverTemplateSpec(card.renderer_id)?.renderMode;
  const badge = mode === 'image_to_image' ? '需出图' : mode === 'hybrid' ? 'hybrid' : 'code';
  return (
    <label className={`grid cursor-pointer grid-cols-[64px_1fr_auto] items-center gap-2 border p-2 text-xs ${checked ? 'border-red-500 bg-red-50' : 'border-neutral-200'}`}>
      <img className="aspect-[3/4] w-full object-cover" src={card.reference_image} alt={card.name} />
      <span className="min-w-0">
        <span className="block font-bold">{card.name}</span>
        <span className="mt-0.5 block text-neutral-500">{card.id}</span>
      </span>
      <span className="text-[10px] font-bold text-neutral-500">{badge}</span>
      <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
    </label>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button className={`border-b-2 px-4 py-2 text-sm font-bold ${active ? 'border-red-500 text-red-700' : 'border-transparent text-neutral-500 hover:text-neutral-900'}`} onClick={onClick}>{children}</button>;
}

function StatusBadge({ status }: { status: BatchJob['status'] }) {
  const map: Record<BatchJob['status'], { label: string; cls: string }> = {
    pending: { label: '⏳ 待跑', cls: 'text-neutral-500' },
    running: { label: '🔄 跑中', cls: 'text-amber-700' },
    success: { label: '✅ 成功', cls: 'text-green-700' },
    failed: { label: '❌ 失败', cls: 'text-red-700' },
    awaiting_review: { label: '待选择', cls: 'text-amber-700' },
    dropped: { label: '已放弃', cls: 'text-neutral-500' },
  };
  const info = map[status];
  return <span className={`font-bold ${info.cls}`}>{info.label}</span>;
}

function cardName(cardId: string) {
  return getCompetitorCreativeCard(cardId)?.name || cardId;
}

async function loadJobs(batchId: string): Promise<BatchJob[]> {
  const response = await fetch(`/api/batch?batch_id=${encodeURIComponent(batchId)}`);
  if (!response.ok) return [];
  const data = (await response.json()) as BatchQueryResponse;
  return data.jobs;
}

function summarize(jobs: BatchJob[]) {
  const total = jobs.length;
  const success = jobs.filter(j => j.status === 'success').length;
  const failed = jobs.filter(j => j.status === 'failed').length;
  const pending = jobs.filter(j => j.status === 'pending').length;
  const running = jobs.filter(j => j.status === 'running').length;
  return { total, success, failed, pending, running };
}

function aggregateUsage(jobs: BatchJob[]): AiUsageSummary {
  const result: AiUsageSummary = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] };
  for (const job of jobs) {
    if (!job.usage) continue;
    result.prompt_tokens += job.usage.prompt_tokens;
    result.completion_tokens += job.usage.completion_tokens;
    result.total_tokens += job.usage.total_tokens;
    result.calls += job.usage.calls;
    result.autofix_count += job.usage.autofix_count || 0;
    if (job.usage.autofix_events?.length) result.autofix_events.push(...job.usage.autofix_events);
  }
  return result;
}

function initialCardSelection(): Set<string> {
  const result = new Set<string>();
  for (const card of supportedCards) {
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (spec && spec.renderMode !== 'image_to_image') result.add(card.id);
  }
  return result;
}
