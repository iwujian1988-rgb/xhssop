'use client';

import { countVisibleUnits } from '@/lib/v2/contracts';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { downloadImageUrl, exportAllAsZip, exportNodeAsPng, type ExportItem } from '@/lib/export-image';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';
import type { CompetitorCreativeCard, GeneratedInnerPage, MigratedTopic, ReferenceDrivenDraft } from '@/types/reference-workflow';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';
import { applyDraftTitleSelection, findSelectedTitleIndex, getDraftTitleSelection, type DraftTitleSelection } from '@/lib/draft-title-selection';
import { getCoverSkins, normalizeCoverSkin } from '@/lib/cover-skins';
import { buildDraftTxt, assertDraftTitleReadyForExport } from '@/lib/batch-export';
import { CoverTextEditor } from '@/components/draft/CoverTextEditor';
import { createDefaultCoverBlocks, type CoverEditableBlock } from '@/lib/cover-editor';
import { resolveCanonicalTitlePackage, withCanonicalTitlePackage, hasHumanTitleSelection, hasHumanCoverTitleSelection, isTextTitleDeliveryReady } from '@/lib/canonical-title-package';
import { teachingPages } from '@/lib/manual-inner-review';
import { stableHash } from '@/lib/v2/contracts';
import type { ContentPackage } from '@/lib/v2/contracts';
import { CoverCandidatePicker } from './CoverCandidatePicker';
import {useReadableInnerPages} from './useReadableInnerPages';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import type { ExamScope, ProductId } from '@/types/data';
import { pickXhsDazibaoReference } from '@/lib/xhs-dazibao-reference-pool';

export function DraftReview({ draft, topic, card, presetCoverImageUrl, initialTitleSelection, onTitleSelectionChange, initialSkinId, onSkinChange, batchId, jobId, jobStatus, currentStage, draftUpdatedAt, draftSchemaVersion, onDraftPersisted, onResumeStarted, coverCandidates, batchAdvanceMode=false, productId, examScope }: {
  draft: ReferenceDrivenDraft;
  topic?: MigratedTopic;
  card?: CompetitorCreativeCard;
  presetCoverImageUrl?: string | null;
  initialTitleSelection?: DraftTitleSelection | null;
  onTitleSelectionChange?: (selection: DraftTitleSelection) => void;
  initialSkinId?: string | null;
  onSkinChange?: (skinId: string) => void;
  batchId?: string;
  jobId?: string;
  jobStatus?: string;
  currentStage?: string;
  draftUpdatedAt?: string;
  draftSchemaVersion?: string;
  onDraftPersisted?: (draft: ReferenceDrivenDraft) => void;
  onResumeStarted?: () => Promise<void>;
  coverCandidates?: ContentPackage['coverCandidates'];
  batchAdvanceMode?: boolean;
  productId?: ProductId;
  examScope?: ExamScope;
}) {
  const coverNodeRef = useRef<HTMLDivElement | null>(null);
  const innerRefs = useRef(new Map<number, HTMLElement>());
  const [generatedCoverImageUrl, setGeneratedCoverImageUrl] = useState<string | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(() => initialTitleSelection?.candidateIndex ?? findSelectedTitleIndex(draft));
  const [selectedSkinId, setSelectedSkinId] = useState(() => normalizeCoverSkin(card?.renderer_id, initialSkinId));
  const [exportBusy, setExportBusy] = useState<'' | 'cover' | 'all'>('');
  const [exportMsg, setExportMsg] = useState('');
  const [coverEditBlocks, setCoverEditBlocks] = useState<Record<string, CoverEditableBlock[]>>(() => {
    const entries = Object.entries(draft.coverEditStates || {}).map(([bundleId, state]) => [bundleId, state.blocks as CoverEditableBlock[]]);
    return Object.fromEntries(entries);
  });
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [innerEditor, setInnerEditor] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [finalCoverToolsOpen, setFinalCoverToolsOpen] = useState(false);
  const [finalCoverPickerOpen, setFinalCoverPickerOpen] = useState(false);
  const [manualCoverCopy, setManualCoverCopy] = useState({ title: draft.cover.title, subtitle: draft.cover.subtitle });
  const [reviewDraft, setReviewDraft] = useState<ReferenceDrivenDraft | null>(null);
  const reviewSource = reviewDraft || draft;
  // A manual template confirmation updates the persisted draft before the
  // parent job/card refresh completes. Always render from the draft's current
  // template id so the user sees the newly adapted cover immediately instead
  // of briefly (or indefinitely) editing the previous template.
  const activeCard = getCompetitorCreativeCard(reviewSource.selectedCoverTemplateId || '') || card;
  const readable = useReadableInnerPages(reviewSource);
  const dropped = reviewSource.manualInnerReview?.status === 'dropped';
  const locked = reviewSource.manualInnerReview?.status === 'locked';
  const validCoverCandidates = coverCandidates?.filter(candidate => !candidate.rejectionReason) || [];
  const alternativeCoverCount = Math.max(0, validCoverCandidates.length - 1);
  const coverDecisionVisible = Boolean(resolveCanonicalTitlePackage(reviewSource).mode==='text_only' && validCoverCandidates.length && reviewSource.coverCopy);
  const previousCoverTemplate = useRef(draft.selectedCoverTemplateId);
  useEffect(()=>{
    if (previousCoverTemplate.current !== reviewSource.selectedCoverTemplateId) {
      previousCoverTemplate.current=reviewSource.selectedCoverTemplateId;
      setGeneratedCoverImageUrl(null);setCoverEditBlocks({});
      setManualCoverCopy({title:reviewSource.cover.title,subtitle:reviewSource.cover.subtitle});
      setCoverEditorOpen(true);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    }
  },[reviewSource.cover.subtitle,reviewSource.cover.title,reviewSource.selectedCoverTemplateId]);
  useEffect(() => {
    setReviewDraft(null); setInnerEditor(''); setCoverEditorOpen(false); setFinalCoverToolsOpen(false); setFinalCoverPickerOpen(false);
    setManualCoverCopy({ title: draft.cover.title, subtitle: draft.cover.subtitle });
  }, [draft.id,draft.titlePackage?.contentSnapshotHash]);
  async function reviewAction(kind: 'save' | 'save_rerun' | 'lock' | 'resume' | 'drop') {
    setReviewBusy(true);
    setExportMsg(kind === 'resume' ? '正在提交生成请求，请勿重复点击…' : '正在保存…');
    try {
      const response = await fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: kind === 'resume' ? 'resume_reviewed_inner' : 'update_draft_state', batch_id: batchId, job_id: jobId,
        ...(kind === 'resume' ? {} : { expected_inner_hash: stableHash(teachingPages(reviewSource.inner_pages)) }),
        ...(kind === 'save' || kind === 'save_rerun' ? { inner_pages: JSON.parse(innerEditor), rerun_downstream: kind === 'save_rerun' } : kind === 'lock' ? { confirm_inner_review: true } : kind === 'drop' ? { drop_inner_review: true } : {}),
      }) });
      const result = await response.json();
      if (!response.ok || result.started === false) throw new Error(result.error || result.reason || '操作失败');
      if (result.job?.draft) { setReviewDraft(result.job.draft); onDraftPersisted?.(result.job.draft); setInnerEditor(''); }
      setConfirmDrop(false);
      setExportMsg(kind === 'drop' ? '已放弃，历史内容保留，只能查看。' : kind === 'save' ? '修改已保存，现有标题、封面和发布文字已保留（基于修改前正文）。' : kind === 'save_rerun' ? '修改已保存，正在从标题重新生成后续内容…' : kind === 'lock' ? '正文已通过并锁定，可以生成文字标题候选。' : draft.titlePackage?.mode === 'text_only' ? '封面生成已开始，完成后页面会自动更新。' : '已开始生成文字标题候选，页面会自动更新。');
      if (kind === 'save_rerun') {
        setInnerEditor('');
        try { await onResumeStarted?.(); }
        catch { setExportMsg('重跑请求已受理，但页面刷新失败。请刷新页面查看进度，不要重复提交。'); }
      }
      if (kind === 'resume') {
        try { await onResumeStarted?.(); }
        catch { setExportMsg('生成请求已受理，但页面刷新失败。请刷新页面查看进度，不要重复提交。'); }
      }
    } catch (cause) { setExportMsg(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setReviewBusy(false); }
  }
  const hydratedDraftRef = useRef('');

  const spec = activeCard ? getCoverTemplateSpec(activeCard.renderer_id) : undefined;
  const isImageCover = !!activeCard && spec?.renderMode === 'image_to_image';
  const coverSkins = getCoverSkins(activeCard?.renderer_id);
  const canonicalTitlePackage = useMemo(() => resolveCanonicalTitlePackage(reviewSource), [reviewSource]);
  const titleSelection = useMemo(
    () => getDraftTitleSelection(reviewSource, selectedCandidateIndex),
    [reviewSource, selectedCandidateIndex],
  );
  const effectiveDraft = useMemo(
    () => {
      const selected = applyDraftTitleSelection(reviewSource, titleSelection);
      const bundleId = titleSelection.bundleId || `index_${selectedCandidateIndex}`;
      const blocks = coverEditBlocks[bundleId];
      if (!blocks) return selected;
      const title = blocks.find(block => block.id === 'coverTitle')?.text ?? selected.cover.title;
      const subtitle = blocks.find(block => block.id === 'coverSubtitle')?.text ?? selected.cover.subtitle;
      const kicker = blocks.find(block => block.id === 'coverKicker')?.text;
      return withCanonicalTitlePackage({ ...selected, cover: { ...selected.cover, title, subtitle }, coverEditStates: { ...(selected.coverEditStates || {}), [bundleId]: { edited: true, blocks } }, cover_edit_meta: { edited: true, bundleId, editedBlocks: blocks.map(block => block.id), blocks } });
    },
    [reviewSource, titleSelection, selectedCandidateIndex, coverEditBlocks],
  );
  // When the cover image is pre-generated (batch runner server-side generation),
  // use it directly instead of showing the manual generate button.
  const coverImageUrl = presetCoverImageUrl ?? generatedCoverImageUrl;
  useEffect(() => {
    const desiredIndex = initialTitleSelection?.candidateIndex ?? findSelectedTitleIndex(draft);
    setSelectedCandidateIndex(current => {
      const currentStillValid = current >= 0 && current < canonicalTitlePackage.bundles.length;
      if (hydratedDraftRef.current === draft.id && currentStillValid) return current;
      hydratedDraftRef.current = draft.id;
      return desiredIndex;
    });
  }, [draft, initialTitleSelection?.candidateIndex, canonicalTitlePackage.bundles.length]);
  useEffect(() => {
    const persisted = Object.fromEntries(Object.entries(draft.coverEditStates || {}).map(([bundleId, state]) => [bundleId, state.blocks as CoverEditableBlock[]]));
    setCoverEditBlocks(current => ({ ...persisted, ...current }));
  }, [draft.id, draft.coverEditStates]);
  useEffect(() => {
    console.info('TITLE_BUNDLE_SOURCE_TRACE', {
      draftId: draft.id,
      batchId,
      jobId,
      draftSchemaVersion,
      titlePackageVersion: draft.titlePackage?.titlePackageVersion,
      contentSnapshotHash: canonicalTitlePackage.contentSnapshotHash,
      productionBriefHash: canonicalTitlePackage.productionBriefHash,
      titleBundleSource: canonicalTitlePackage.source,
      titleBundlesLength: canonicalTitlePackage.bundles.length,
      candidatesLength: draft.title_candidates.length,
      recommendedBundleId: canonicalTitlePackage.recommendedBundleId,
      selectedBundleId: canonicalTitlePackage.selectedBundleId,
      draftUpdatedAt,
      storage: 'GET /api/batch -> data/batches/<batchId>/jobs/<jobId>.json',
      fromLocalStorage: false,
      fromOldCache: canonicalTitlePackage.source !== 'current_title_bundles',
      fromTestFixture: false,
      bundles: canonicalTitlePackage.bundles.map(bundle => ({ id: bundle.id, slotId: bundle.slotId, textTitle: bundle.textTitle })),
    });
  }, [batchId, canonicalTitlePackage, draft.id, draft.titlePackage?.titlePackageVersion, draft.title_candidates.length, draftSchemaVersion, draftUpdatedAt, jobId]);
  useEffect(() => {
    setSelectedSkinId(normalizeCoverSkin(activeCard?.renderer_id, initialSkinId));
  }, [activeCard?.renderer_id, initialSkinId]);

  const safeTitle = (effectiveDraft.selected_title || '小红书笔记').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);

  async function persistDraftState(payload: { selected_bundle_id?: string; selected_cover_title_id?: string; cover_edit_state?: { bundleId: string; blocks: CoverEditableBlock[] } }) {
    if (!batchId || !jobId) return;
    const response = await fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_draft_state', batch_id: batchId, job_id: jobId, ...payload }) });
    const json = await response.json() as { job?: { draft?: ReferenceDrivenDraft }; error?: string };
    if (!response.ok || !json.job?.draft) throw new Error(json.error || 'Draft 状态保存失败');
    setReviewDraft(json.job.draft);
    onDraftPersisted?.(json.job.draft);
    return json.job.draft;
  }

  async function selectCandidate(index: number, role: 'text' | 'cover') {
    const selection = getDraftTitleSelection(reviewSource, index);
    if (role === 'text') {
      setSelectedCandidateIndex(selection.candidateIndex);
      if (selection.bundleId) localStorage.setItem(`xhs-selected-title-bundle:${draft.id}`, selection.bundleId);
      onTitleSelectionChange?.(selection);
    }
    if (!selection.bundleId) return;
    setSelectionBusy(true);
    setExportMsg(role === 'text' ? '正在保存文字标题…' : '正在保存封面标题…');
    try {
      const defaultCoverToSameCandidate = role === 'text' && canonicalTitlePackage.mode === 'text_only'
        && !canonicalTitlePackage.fixedCoverTitle && !canonicalTitlePackage.humanSelectedCoverTitleId;
      await persistDraftState(role === 'text'
        ? { selected_bundle_id: selection.bundleId, ...(defaultCoverToSameCandidate ? {selected_cover_title_id:selection.bundleId} : {}) }
        : { selected_cover_title_id: selection.bundleId });
      setExportMsg(role === 'text'
        ? (defaultCoverToSameCandidate ? '文字标题已选定；封面标题先默认使用同一条，可在下方另选。' : '文字标题已选定。')
        : '封面标题已选定；文字标题与封面标题可以相同，也可以不同。');
    } catch (cause) {
      setExportMsg(cause instanceof Error ? cause.message : '标题选择保存失败');
    } finally { setSelectionBusy(false); }
  }

  const handleCoverEditState = useCallback((blocks: CoverEditableBlock[]) => {
    const bundleId = titleSelection.bundleId || `index_${selectedCandidateIndex}`;
    setCoverEditBlocks(current => ({ ...current, [bundleId]: blocks }));
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistDraftState({ cover_edit_state: { bundleId, blocks } }).catch(cause => setExportMsg(cause instanceof Error ? cause.message : '封面编辑状态保存失败'));
    }, 350);
    setExportMsg('封面文字已修改，预览和导出将使用当前版本');
  }, [titleSelection.bundleId, selectedCandidateIndex]);

  async function saveManualImageCoverCopy() {
    if (!activeCard) return;
    const bundleId = titleSelection.bundleId || `index_${selectedCandidateIndex}`;
    const blocks = createDefaultCoverBlocks({ renderer: activeCard.renderer_id, kicker: titleSelection.coverKicker,
      title: manualCoverCopy.title, subtitle: manualCoverCopy.subtitle });
    setSelectionBusy(true); setExportMsg('正在保存封面修改…');
    try {
      setCoverEditBlocks(current => ({ ...current, [bundleId]: blocks }));
      await persistDraftState({ cover_edit_state: { bundleId, blocks } });
      setExportMsg('封面文字修改已保存，生成图片时会使用这版文案。');
    } catch (cause) { setExportMsg(cause instanceof Error ? cause.message : '封面修改保存失败'); }
    finally { setSelectionBusy(false); }
  }

  function selectSkin(skinId: string) {
    setSelectedSkinId(skinId);
    onSkinChange?.(skinId);
    setExportMsg('已临时换用这张底图，导出时会使用当前选择');
  }

  async function handleExportCover() {
    try { assertDraftTitleReadyForExport(draft); } catch(cause) { setExportMsg((cause as Error).message); return; }
    if (reviewSource.downstreamStale || innerEditor) { setExportMsg('正文正在审校或已有结果已过期，请先保存并锁定正文，再重新生成封面'); return; }
    setExportBusy('cover');
    setExportMsg('');
    try {
      if (isImageCover) {
        if (!coverImageUrl) { setExportMsg('请先完成文生图，再导出封面'); return; }
        const outcome = await downloadImageUrl(coverImageUrl, `${safeTitle}-封面`);
        setExportMsg(outcome === 'downloaded' ? '封面已下载' : '该图跨域无法直接下载，已在新标签页打开，请长按/右键另存为');
      } else if (coverNodeRef.current) {
        await exportNodeAsPng(coverNodeRef.current, `${safeTitle}-封面`);
        setExportMsg('封面已下载');
      }
    } catch (cause) {
      setExportMsg(cause instanceof Error ? cause.message : '封面导出失败');
    } finally {
      setExportBusy('');
    }
  }

  async function handleExportAll() {
    if(!readable.ready){setExportMsg(readable.error || '正在计算易读分页，请稍候');return;}
    try { assertDraftTitleReadyForExport(draft); } catch(cause) { setExportMsg((cause as Error).message); return; }
    if (reviewSource.downstreamStale || innerEditor) { setExportMsg('正文正在审校或已有结果已过期，请先保存并锁定正文，再重新生成封面'); return; }
    setExportBusy('all');
    setExportMsg('');
    try {
      const items: ExportItem[] = [];
      if (isImageCover && coverImageUrl) items.push({ filename: '00-封面.png', url: coverImageUrl });
      else if (coverNodeRef.current) items.push({ filename: '00-封面.png', node: coverNodeRef.current });
      readable.pages.forEach(page => {
        const node = innerRefs.current.get(page.page_no);
        if (!node) throw new Error(`第 ${page.page_no} 页尚未完成渲染，请稍后重试`);
        if (node) items.push({ filename: `${String(page.page_no).padStart(2, '0')}-内页.png`, node });
      });
      items.push({ filename: '文字内容.txt', text: buildDraftTxt(effectiveDraft, isImageCover
        ? (coverImageUrl ? { kind: 'image', url: coverImageUrl, downloaded: true } : { kind: 'image_missing' })
        : { kind: 'dom' }) });
      if (!items.length) { setExportMsg('还没有可导出的素材'); return; }
      const { failures } = await exportAllAsZip(items, `${safeTitle}-素材包`);
      const imageCount = items.filter(item => item.node || item.url).length;
      setExportMsg(failures.length ? `打包完成，但 ${failures.join('、')} 导出失败（可能是外链图片跨域，可单独下载封面重试）` : `打包完成：${imageCount} 张图 + 1 份文字内容，已下载 zip`);
    } catch (cause) {
      setExportMsg(cause instanceof Error ? cause.message : '打包失败');
    } finally {
      setExportBusy('');
    }
  }

  const workflowRunning = reviewBusy || jobStatus === 'running';
  // A freshly locked Inner has no titlePackage yet. Treat that exact state as the
  // start of the text-title flow instead of letting legacy delivery semantics hide
  // the primary action.
  const preTitlePending = locked && canonicalTitlePackage.bundles.length === 0 && !reviewSource.selected_title.trim();
  const textTitleFlow = canonicalTitlePackage.mode === 'text_only' || preTitlePending;
  const titleCandidatesReady = textTitleFlow && canonicalTitlePackage.bundles.length > 0;
  const humanTitleSelected = hasHumanTitleSelection(reviewSource);
  const humanCoverTitleSelected = hasHumanCoverTitleSelection(reviewSource);
  const stagedHumanReviewFlow = Boolean(reviewSource.manualInnerReview);
  const stalePreview = Boolean(reviewSource.downstreamStale && reviewSource.downstreamPreservedAfterInnerEdit);
  const deliveryReady = stalePreview || (stagedHumanReviewFlow
    ? canonicalTitlePackage.mode === 'text_only' && isTextTitleDeliveryReady(reviewSource)
    : true);
  const workflowAdvanced = workflowRunning || titleCandidatesReady || Boolean(reviewSource.coverCopy);
  const runningLabel = titleCandidatesReady && humanTitleSelected
    ? (coverDecisionVisible ? '正在生成封面及后续成品…' : '正在自动匹配封面并生成封面文案…')
    : '正在生成文字标题…';

  return <div className="space-y-5">
    {stalePreview && <section className="border-2 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950"><b>旧版本预览。</b> 当前 Inner 已修改；标题、封面、发布正文和渲染仍基于旧 Inner，默认不能作为当前成品导出。若要使用它，请在导出时明确选择“导出旧版本”。</section>}
    {locked && !deliveryReady && <section className="border-2 border-neutral-900 bg-white p-4" data-testid="workflow-next-action">
      <div className="text-xs font-bold tracking-wide text-neutral-500">当前步骤 · {currentStage === 'title_ready' || titleCandidatesReady ? '标题与封面' : '文字标题'}</div>
      {workflowRunning ? <div role="status" aria-live="polite" className="mt-2 flex items-center gap-3 font-black"><span className="h-4 w-4 animate-pulse rounded-full bg-neutral-900" />{runningLabel}</div>
        : !titleCandidatesReady ? <><h2 className="mt-2 text-lg font-black">正文默认通过，正在准备标题</h2>{batchAdvanceMode?<p className="mt-1 text-sm text-neutral-600">无需确认内页，标题生成完成后会自动出现在这里。</p>:<button type="button" disabled={reviewBusy || !!innerEditor} onClick={() => reviewAction('resume')} className="mt-3 min-h-12 w-full bg-neutral-950 px-4 py-3 font-black text-white disabled:bg-neutral-400">生成文字标题</button>}</>
          : !humanTitleSelected ? <><h2 className="mt-2 text-lg font-black">请从下方选择1个文字标题</h2><p className="mt-1 text-sm text-neutral-600">选中后，封面标题会先默认使用同一条，你也可以另选。</p></>
            : !humanCoverTitleSelected ? <><h2 className="mt-2 text-lg font-black">请再选择1个封面标题</h2><p className="mt-1 text-sm text-neutral-600">仍从同一组候选中选择；可以和文字标题相同。</p></>
            : !coverDecisionVisible ? <><h2 className="mt-2 text-lg font-black">文字标题和封面标题已选定</h2><p className="mt-1 text-sm text-neutral-600">{batchAdvanceMode?'本篇已准备好。全部选完后使用批量按钮进入封面匹配。':'系统会自动匹配适合的封面，并用你选中的封面标题生成预览。'}</p>{!batchAdvanceMode&&<button type="button" disabled={selectionBusy || reviewBusy} onClick={() => reviewAction('resume')} className="mt-3 min-h-12 w-full bg-neutral-950 px-4 py-3 font-black text-white disabled:bg-neutral-400">{selectionBusy ? '正在保存标题…' : '生成封面'}</button>}</>
              : <p className="mt-2 font-bold">封面方案已生成，请在下方采用推荐或手动换选。</p>}
      {exportMsg && <p role="status" aria-live="polite" className="mt-3 text-sm font-semibold text-neutral-700">{exportMsg}</p>}
    </section>}
    {deliveryReady && <section className="border border-neutral-200 bg-white p-5" data-testid="final-product-summary">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0"><div className="text-xs font-black tracking-[0.16em] text-green-700">最终成品</div><h1 className="mt-2 text-xl font-black leading-snug text-neutral-950">{effectiveDraft.selected_title}</h1><div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-500"><span>封面模板：{activeCard?.name || '已确认模板'}</span><span>内页：{readable.ready ? readable.pages.length : reviewSource.inner_pages.length} 页</span></div></div>
        <div className="flex flex-wrap gap-2">{!finalCoverToolsOpen && <button type="button" aria-expanded={false} aria-controls="final-cover-tools" onClick={()=>{setFinalCoverToolsOpen(true);setFinalCoverPickerOpen(false);}} className="min-h-9 border border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-600 hover:border-neutral-700 hover:text-neutral-950">修改当前封面文字</button>}<button type="button" aria-expanded={finalCoverPickerOpen} aria-controls="final-cover-picker" onClick={()=>{setFinalCoverPickerOpen(value=>!value);setFinalCoverToolsOpen(false);}} className="min-h-11 border-2 border-neutral-900 bg-white px-4 py-2 text-sm font-black text-neutral-950 hover:bg-neutral-100">{finalCoverPickerOpen?'收起其他封面':alternativeCoverCount>0?`更换封面（另有${alternativeCoverCount}个）`:'查看封面方案'}</button></div>
      </div>
      {finalCoverToolsOpen && <p id="final-cover-tools" className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-600">已进入文字编辑模式。点击封面中的文字块，即可修改文字、字号、位置和行距；不会重写正文。</p>}
      {finalCoverPickerOpen && <p id="final-cover-picker" className="mt-4 border-t border-neutral-100 pt-3 text-xs text-neutral-600">下方显示其他可用模板。换模板后需要重新确认并生成封面成品。</p>}
    </section>}
    {batchId && jobId && coverCandidates?.some(c=>!c.rejectionReason) && reviewSource.coverCopy && locked && !reviewSource.downstreamStale && !innerEditor && !deliveryReady && <CoverCandidatePicker draft={reviewSource} candidates={coverCandidates} batchId={batchId} jobId={jobId} continueBusy={reviewBusy} batchAdvanceMode={batchAdvanceMode} onContinue={()=>reviewAction('resume')} onSaved={saved=>{setReviewDraft(saved);setCoverEditorOpen(true);onDraftPersisted?.(saved);}}/>}
    {coverDecisionVisible && reviewSource.coverSelection?.confirmedTemplateId && !deliveryReady && <section className="border-2 border-cyan-700 bg-white p-4" data-testid="manual-cover-editor-entry">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">人工修改封面（可选）</h2><p className="mt-1 text-xs text-neutral-600">模板已经选好；可在批量生成前修改文字、字号、位置和行距。</p></div><button type="button" className="min-h-11 border border-cyan-800 px-4 py-2 text-sm font-black text-cyan-900" onClick={()=>setCoverEditorOpen(value=>!value)}>{coverEditorOpen?'收起修改工具':'打开修改工具'}</button></div>
      {isImageCover && coverEditorOpen ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold">封面主标题<input className="mt-1 w-full border p-2 font-normal" value={manualCoverCopy.title} onChange={event=>setManualCoverCopy(value=>({...value,title:event.target.value}))}/></label>
        <label className="text-sm font-bold">封面副标题<input className="mt-1 w-full border p-2 font-normal" value={manualCoverCopy.subtitle} onChange={event=>setManualCoverCopy(value=>({...value,subtitle:event.target.value}))}/></label>
        <button type="button" disabled={selectionBusy} onClick={saveManualImageCoverCopy} className="min-h-11 bg-cyan-800 px-4 py-2 text-sm font-black text-white disabled:opacity-50">{selectionBusy?'保存中…':'保存封面文字'}</button>
        <p className="self-center text-xs text-neutral-600">图生图模板可先改最终文字；图片构图在生成后确认。</p>
      </div> : null}
      {/* Image-to-image covers must never render the HTML editor: it is only a reference/status view. */}
      {!isImageCover && <div className="mt-4"><CoverTextEditor key={`preflight:${reviewSource.id}:${reviewSource.selectedCoverTemplateId}`} draftId={reviewSource.id} bundleId={titleSelection.bundleId || `index_${selectedCandidateIndex}`} renderer={activeCard?.renderer_id || 'parchment_dense_directory'} payload={reviewSource.cover} kicker={titleSelection.coverKicker} referenceImage={activeCard?.reference_image} skinId={selectedSkinId} initialBlocks={coverEditBlocks[titleSelection.bundleId || `index_${selectedCandidateIndex}`]} legacyBundleIndex={selectedCandidateIndex} registerCanvas={node=>{coverNodeRef.current=node;}} onStateChange={handleCoverEditState} readOnly={!coverEditorOpen}/></div>}
      {exportMsg && <p role="status" className="mt-3 text-sm font-semibold">{exportMsg}</p>}
    </section>}
    {dropped || innerEditor || (!locked && reviewSource.downstreamStale) ? <div className="border border-amber-300 bg-amber-50 p-4">{dropped ? '已放弃。这篇不再生成，历史内容保留。' : '请先审核正文并锁定；锁定后才能生成文字标题和封面。'}{exportMsg && <p role="status">{exportMsg}</p>}</div> : workflowRunning || (locked && !titleCandidatesReady) || (coverDecisionVisible && !reviewSource.coverSelection?.confirmedTemplateId && !deliveryReady && humanTitleSelected && humanCoverTitleSelected) ? null : canonicalTitlePackage.mode==='text_only' && !deliveryReady ? <section>
      <TitleBundlePicker draft={reviewSource} selectedCandidateIndex={selectedCandidateIndex} isImageCover={false} disabled={selectionBusy} onSelectText={index=>selectCandidate(index,'text')} onSelectCover={index=>selectCandidate(index,'cover')} />
      <p role="status">{humanTitleSelected&&humanCoverTitleSelected
        ? (batchAdvanceMode?(canonicalTitlePackage.fixedCoverTitle?'发布标题已选定，等待批量进入封面匹配。':'两个标题均已选定，等待批量进入封面匹配。'):(canonicalTitlePackage.fixedCoverTitle?'发布标题已选定，请点击上方“生成封面”。':'两个标题均已选定，请点击上方“生成封面”。'))
        : canonicalTitlePackage.fixedCoverTitle?`封面标题已由 Market Topic 固定；请从下方 ${canonicalTitlePackage.bundles.length} 条候选中选择发布文字标题。`:`请从下方 ${canonicalTitlePackage.bundles.length} 条候选中分别确定文字标题和封面标题。`}</p>
      {exportMsg && <p role="status">{exportMsg}</p>}
    </section> : <section className={finalCoverToolsOpen && !isImageCover ? 'grid gap-5' : 'grid gap-5 xl:grid-cols-[minmax(420px,680px)_minmax(0,1fr)]'}>
      <div className="border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-black">最终封面</h2><span className="text-xs text-neutral-500">{finalCoverToolsOpen?'修改模式':'成品预览'}</span></div>
        {isImageCover ? <div ref={coverNodeRef}><DynamicDirectoryCover draft={effectiveDraft} topic={topic} card={activeCard} presetImageUrl={activeCard?.id === card?.id ? presetCoverImageUrl : null} onImageReady={setGeneratedCoverImageUrl} onDraftPersisted={saved => { setReviewDraft(saved); onDraftPersisted?.(saved); }} batchId={batchId} jobId={jobId} skinId={selectedSkinId} productId={productId} examScope={examScope} /></div> : <CoverTextEditor key={`${reviewSource.id}:${reviewSource.selectedCoverTemplateId || activeCard?.id}:${titleSelection.bundleId || selectedCandidateIndex}:${selectedSkinId}`} draftId={reviewSource.id} bundleId={titleSelection.bundleId || `index_${selectedCandidateIndex}`} renderer={activeCard?.renderer_id || 'parchment_dense_directory'} payload={applyDraftTitleSelection(reviewSource, titleSelection).cover} kicker={titleSelection.coverKicker} referenceImage={activeCard?.reference_image} skinId={selectedSkinId} initialBlocks={coverEditBlocks[titleSelection.bundleId || `index_${selectedCandidateIndex}`]} legacyBundleIndex={selectedCandidateIndex} registerCanvas={node => { coverNodeRef.current = node; }} onStateChange={handleCoverEditState} readOnly={!finalCoverToolsOpen} />}
        <div className="mt-3 flex items-center gap-2">
          <button className="flex-1 border border-neutral-900 bg-neutral-900 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-400 disabled:border-neutral-400" disabled={!!exportBusy} onClick={handleExportCover}>{exportBusy === 'cover' ? '导出中...' : '导出封面'}</button>
          <button className="flex-1 border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 disabled:opacity-50" disabled={!!exportBusy} onClick={handleExportAll}>{exportBusy === 'all' ? '打包中...' : '打包下载全部（封面+内页）'}</button>
        </div>
        {exportMsg ? <p className="mt-2 text-xs font-semibold text-neutral-600">{exportMsg}</p> : null}
      </div>
      <div className="space-y-4">
        <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">成品文字</div><dl className="mt-3 space-y-3 text-sm"><div><dt className="text-xs font-bold text-neutral-400">小红书文字标题</dt><dd className="mt-1 font-black leading-relaxed">{effectiveDraft.selected_title}</dd></div><div><dt className="text-xs font-bold text-neutral-400">封面主标题</dt><dd className="mt-1 font-bold leading-relaxed">{effectiveDraft.cover.title}</dd></div>{effectiveDraft.cover.subtitle && <div><dt className="text-xs font-bold text-neutral-400">封面副标题</dt><dd className="mt-1 leading-relaxed text-neutral-700">{effectiveDraft.cover.subtitle}</dd></div>}</dl></section>
        {finalCoverToolsOpen && coverSkins.length > 1 && !isImageCover ? <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">更换封面底图</div><div className="mt-1 text-xs text-neutral-500">只改变纸张或黑板质感，不改变现有排版</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{coverSkins.map(skin => <button type="button" key={skin.id} onClick={() => selectSkin(skin.id)} className={`border p-2 text-left text-xs font-bold ${selectedSkinId === skin.id ? 'border-red-400 bg-red-50' : 'border-neutral-200 bg-white hover:border-neutral-400'}`}><span className="mb-2 block h-8 w-full border border-black/10" style={{ background: skin.swatch }} /><span>{skin.label}</span></button>)}</div></section> : null}
        <details className="border border-neutral-200 bg-white p-4"><summary className="cursor-pointer text-sm font-black">查看自动检查</summary><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><Check label="标题与封面一致" ok={draft.checks.title_cover_consistent} /><Check label="模板容量正常" ok={draft.checks.template_capacity_ok} /><Check label="商品事实有依据" ok={draft.checks.product_claims_grounded} /><Check label="内容密度达标" ok={draft.checks.content_density_ok} /></div>{draft.checks.warnings?.length ? <ul className="mt-3 space-y-1 text-xs leading-relaxed text-amber-800">{draft.checks.warnings.map(issue => <li key={issue}>提醒 · {formatWarning(issue)}</li>)}</ul> : null}</details>
        <section className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between"><div className="text-sm font-black">法语与考试事实审校</div><span className={`px-2 py-1 text-xs font-bold ${draft.accuracy_audit.approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{draft.accuracy_audit.approved ? '通过' : '已修正/需留意'}</span></div><p className="mt-2 text-xs text-neutral-500">自动修正 {draft.accuracy_audit.corrected_count} 处</p>{draft.accuracy_audit.issues.length ? <ul className="mt-3 space-y-1 text-xs leading-relaxed text-amber-900">{draft.accuracy_audit.issues.map(issue => <li key={issue}>· {issue}</li>)}</ul> : null}</section>
        {activeCard ? <a className="block border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-bold" href={activeCard.reference_image}>查看参考原图</a> : null}
      </div>
    </section>}
    {deliveryReady && finalCoverPickerOpen && batchId && jobId && coverCandidates?.some(c=>!c.rejectionReason) && reviewSource.coverCopy && locked && !reviewSource.downstreamStale && !innerEditor && <section className="border border-neutral-200 bg-neutral-50 p-3"><CoverCandidatePicker draft={reviewSource} candidates={coverCandidates} batchId={batchId} jobId={jobId} continueBusy={reviewBusy} batchAdvanceMode={batchAdvanceMode} onContinue={()=>reviewAction('resume')} onSaved={saved=>{setReviewDraft(saved);setCoverEditorOpen(true);onDraftPersisted?.(saved);}}/></section>}
    <details open={deliveryReady} className="border border-neutral-200 bg-white p-5"><summary className="cursor-pointer font-black">{deliveryReady?'最终内页':'查看内页（默认已通过，可选编辑）'}</summary>
      {batchId && jobId ? <div className="my-3 space-y-2">
        <p className="text-sm" data-testid="review-status">{dropped ? '已放弃。这篇只能查看。' : `${innerEditor ? '人工修改中' : locked ? '正文已默认通过' : '正文待处理'}。如需修改，可编辑教学页；固定商品页由系统追加。`}</p>
        {!dropped && <div className="flex flex-wrap gap-3 [&>button]:border [&>button]:px-3 [&>button]:py-2 [&>button:disabled]:opacity-40">
          <button disabled={reviewBusy || !!innerEditor} onClick={() => { setReviewDraft(reviewSource); setInnerEditor(JSON.stringify(teachingPages(reviewSource.inner_pages), null, 2)); }}>编辑正文</button>
          {innerEditor && <div className="w-full border border-amber-200 bg-amber-50 p-3 text-sm"><div className="font-black text-amber-950">保存前请选择后续处理方式</div><p className="mt-1 text-xs leading-relaxed text-amber-900">只改标点或小措辞，可以保留现有标题和封面；改了主题、要点、数字或事实，建议重新生成后续内容。</p><div className="mt-3 flex flex-wrap gap-3"><button disabled={reviewBusy} onClick={() => reviewAction('save')} className="border border-neutral-400 bg-white px-3 py-2 font-bold">保存并保留现有结果</button><button disabled={reviewBusy} onClick={() => reviewAction('save_rerun')} className="bg-neutral-950 px-3 py-2 font-bold text-white">保存并重新生成后续</button></div></div>}
          {!locked && <button disabled={reviewBusy || !!innerEditor} onClick={() => reviewAction('lock')}>通过并锁定</button>}
          {!locked && <button disabled={reviewBusy} onClick={() => setConfirmDrop(true)}>放弃这篇</button>}
        </div>}
        {exportMsg && <p role="status" aria-live="polite" className="text-sm font-semibold text-neutral-700" data-testid="review-action-feedback">{exportMsg}</p>}
        {confirmDrop && !dropped && <div role="alert" className="border border-red-200 bg-red-50 p-3 text-sm">确定放弃这篇？历史内容会保留，但不能再继续生成。{innerEditor ? '尚未保存的修改不会保留。' : ''}<div className="mt-2 flex gap-4"><button disabled={reviewBusy} onClick={() => reviewAction('drop')}>确定放弃</button><button disabled={reviewBusy} onClick={() => setConfirmDrop(false)}>取消</button></div></div>}
        {innerEditor ? <><p className="text-xs">修改 page_title、lead、bullets 的正文文字，保留JSON结构。保存不等于确认。</p><textarea aria-label="人工审校正文JSON" className="h-96 w-full border p-2 font-mono text-sm" value={innerEditor} onChange={event => setInnerEditor(event.target.value)} /></> : null}
      </div> : null}
      <p role="status" className="mt-3 text-sm text-neutral-600">{readable.error || (readable.ready?`原始 ${reviewSource.inner_pages.length} 页 → 易读展示 ${readable.pages.length} 页；原文不删改，长材料续页。`:'正在按易读字号计算分页…')}</p>
      {readable.ready && readable.pages.filter(page=>page.page_type!=='product_bridge'&&!page.showcase_asset_id).length>5 && <p role="status" className="mt-2 text-sm text-amber-700">内容偏长：教学内页超过5页目标。仅提醒，不影响审核、继续生成或导出，不自动重试。</p>}
      {readable.ready && <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{readable.pages.map(page => <InnerPagePreview page={page} exportDisabled={!!reviewSource.downstreamStale || !!innerEditor} key={page.page_no} registerNode={node => { if (node) innerRefs.current.set(page.page_no, node); else innerRefs.current.delete(page.page_no); }} />)}</div>}</details>
    {deliveryReady && <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]"><div className="border border-neutral-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-black">5. 发布正文</h2><span className="text-xs text-neutral-500">{draft.caption.length} 字符</span></div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7 text-neutral-700">{draft.caption}</pre><div className="mt-5 border-t border-neutral-200 pt-4"><div className="text-xs font-bold text-neutral-400">搜索关键词</div><div className="mt-2 flex flex-wrap gap-2">{draft.seo_keywords.map(keyword => <span className="bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900" key={keyword}>{keyword}</span>)}</div><div className="mt-4 text-sm font-semibold leading-7 text-red-700">{draft.tags.join(' ')}</div></div></div><div className="border border-neutral-200 bg-white p-5"><h2 className="font-black">知识库依据</h2><div className="mt-3 space-y-3">{draft.evidence.map(item => <div className="border-b border-neutral-100 pb-3 text-xs leading-relaxed" key={item.id}><div className="font-bold">{item.text}</div><div className="mt-1 text-neutral-500">{item.source_file} · {item.source_section}</div></div>)}</div></div></section>}
  </div>;
}

function friendlyClickMode(mode?: string) {
  return ({ SELF_TEST_AVOIDANCE: '自查避坑', COLLECTION_ASSET: '资料收藏', EMOTIONAL_CURIOSITY: '情绪好奇', VOICE_EXPERIENCE: '真人经验', PAIN_QUESTION: '痛点提问', INSIGHT_CONTRARIAN: '反常识', COMPARISON_GAP: '对比差距', URGENT_EXAM: '考前急救' } as Record<string, string>)[mode || ''] || '标题方案';
}
function TitleBundlePicker({ draft, selectedCandidateIndex, isImageCover, disabled=false, onSelectText, onSelectCover }: { draft: ReferenceDrivenDraft; selectedCandidateIndex: number; isImageCover: boolean; disabled?: boolean; onSelectText: (index: number) => void | Promise<void>; onSelectCover: (index: number) => void | Promise<void> }) {
  const titlePackage = resolveCanonicalTitlePackage(draft);
  const bundles = titlePackage.bundles;
  const fixedCoverTitle = titlePackage.fixedCoverTitle;
  const humanId = titlePackage.mode==='text_only' ? titlePackage.humanSelectedTextTitleId : titlePackage.humanSelectedCandidateId;
  const humanCoverId = titlePackage.mode==='text_only' ? titlePackage.humanSelectedCoverTitleId : titlePackage.humanSelectedCandidateId;
  return <section className="border border-neutral-200 bg-white p-4">
    <div className="text-sm font-black">{fixedCoverTitle?`选择发布文字标题（共 ${bundles.length} 条）`:`从同一组候选中选择两个标题（共 ${bundles.length} 条）`}</div>
    {fixedCoverTitle && <div className="mt-3 border border-red-200 bg-red-50 p-3"><div className="text-xs font-bold text-red-700">封面标题 · Market Topic 已固定</div><div className="mt-1 font-black leading-relaxed text-neutral-950">{fixedCoverTitle}</div></div>}
    {draft.titlePackage?.nativeSkillReport && <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-neutral-600">查看 Skill 副产物（简报、评分、Top 5、A/B；默认不影响选择）</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs">{draft.titlePackage.nativeSkillReport}</pre>
    </details>}
    {draft.titlePackage?.semanticBoundaryReview && <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-neutral-600">查看标题语义边界检查（审查 {draft.titlePackage.semanticBoundaryReview.reviewedCandidateCount} 条，拦截 {draft.titlePackage.semanticBoundaryReview.rejectedCandidates.length} 条）</summary>
      <div className="mt-2 space-y-2 text-xs text-neutral-700">{draft.titlePackage.semanticBoundaryReview.rejectedCandidates.length ? draft.titlePackage.semanticBoundaryReview.rejectedCandidates.map(item=><div key={item.id} className="border border-amber-200 bg-amber-50 p-2"><div className="font-bold">{item.textTitle}</div><div>原因：{item.reason}</div>{item.evidence ? <div>依据：{item.evidence}</div> : null}</div>) : '没有发现明确改义；不代表标题点击力已被评分。'}</div>
    </details>}
    <div className="mt-1 text-xs text-neutral-500">{fixedCoverTitle?'Native Title 只负责发布文字标题；封面继续使用上方 finalTopic。':'同一组候选分别用于两个位置。先选发布文字标题，再确认封面主标题；两者允许相同。'}</div>
    <div role="status" className="mt-2 text-xs font-bold">文字标题：{humanId?'已选':'待选'} · 封面标题：{fixedCoverTitle?'已固定':humanCoverId?'已选':'待选'}</div>
    {isImageCover ? <div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">当前是 AI 生图封面。更换标题不会自动改写已有图片。</div> : null}
    <div className="mt-3 space-y-2">{bundles.map((bundle,index) => <div className={`block w-full border px-3 py-3 text-left ${humanId === bundle.id || humanCoverId === bundle.id ? 'border-red-400 bg-red-50' : 'border-neutral-200'}`} key={bundle.id}>
      <div className="text-xs font-bold text-neutral-500">候选 {index+1}{humanId === bundle.id ? ' · 文字标题' : ''}{humanCoverId === bundle.id ? ' · 封面标题' : ''}</div>
      <div className="mt-2 font-bold">文字标题：{bundle.textTitle}</div>
      {countVisibleUnits(bundle.textTitle) > 20 && <div className="mt-1 text-xs text-amber-700">当前 {countVisibleUnits(bundle.textTitle)} 字符，超过建议20字符；仍可选择，发布前可人工缩短。</div>}
      {bundle.coverKicker && <div className="mt-1 text-xs">封面身份：{bundle.coverKicker}</div>}
      {titlePackage.mode!=='text_only' && <div className="mt-1 text-sm font-black text-red-800">封面标题：{bundle.coverTitle}</div>}
      {bundle.coverSubtitle && <div className="mt-1 text-xs">副标题：{bundle.coverSubtitle}</div>}
      {bundle.clickReason && <div className="mt-1 text-xs text-neutral-500">点击理由：{bundle.clickReason}</div>}
      <div className={`mt-3 grid gap-2 ${fixedCoverTitle?'grid-cols-1':'grid-cols-2'}`}>
        <button type="button" disabled={disabled} aria-pressed={humanId===bundle.id} onClick={()=>onSelectText(index)} className={`min-h-11 border px-3 py-2 text-xs font-black disabled:opacity-50 ${humanId===bundle.id?'border-neutral-950 bg-neutral-950 text-white':'border-neutral-300 bg-white'}`}>{humanId===bundle.id?'已用作文字标题':'用作文字标题'}</button>
        {!fixedCoverTitle && <button type="button" disabled={disabled} aria-pressed={humanCoverId===bundle.id} onClick={()=>onSelectCover(index)} className={`min-h-11 border px-3 py-2 text-xs font-black disabled:opacity-50 ${humanCoverId===bundle.id?'border-red-700 bg-red-700 text-white':'border-red-300 bg-white text-red-800'}`}>{humanCoverId===bundle.id?'已用作封面标题':'用作封面标题'}</button>}
      </div>
    </div>)}</div>
  </section>;
}
function Check({ label, ok }: { label: string; ok: boolean }) { return <div className={ok ? 'text-green-700' : 'text-red-700'}>{ok ? '通过' : '未通过'} · {label}</div>; }
function formatWarning(issue: string) {
  const labels: Record<string, string> = {
    core_keyword_missing_from_opening: '正文开头没有明显出现核心搜索词，建议开头补“DELF B2写作/法语写作”等身份词。',
    overabsolute_register_rule: '语体建议可能说得太绝对，可以把“必须/一律/不能”改成“更稳/建议/通常”。',
    overabsolute_public_rule: '公开文案里有偏绝对的规则表达，发布前建议降调。',
    unsupported_product_quantity_claim: '文案写了商品数量，但本次检索证据没命中；商品详情页能兜底时可保留。',
    public_inventory_relation_claim: '文案提到“资料里/商品里”的关系，带货可以用，但发布前核对商品详情页。',
    caption_ai_cliche: '正文有一点AI套话，建议人工顺一下口语感。',
    unsafe_mechanical_language_replacement: '有“直接替换/套用”的倾向，建议改成“按语境选择/改写”。',
    overmechanical_content_method: '方法说得过于机械，建议补充语境条件。',
    unsupported_fixed_time_advice: '出现固定时间建议，注意别写成考试官方规则。',
    editorial_low_quality_phrase: '有廉价营销词，建议发布前换成更具体的表达。',
    free_original_title_missing: '标题候选缺少自然原创版本。',
    reference_migration_title_missing: '标题候选缺少竞品机制迁移版本。',
    formula_title_missing: '标题候选缺少爆款公式仿写版本。',
    title_candidate_mix_incomplete: '标题候选类型不够完整。',
    cover_items_semantic_duplicate: '封面条目有少量重复，发布前可以人工删改。',
    topic_similar_to_recent: '本篇选题和最近 7 天某篇相似度较高，发布前可以人工调整角度。',
    brief_product_fields_missing: 'brief 里商品卖点或购买理由为空，建议补一下再发布。',
    product_bridge_page_missing: '内页里没有"如何承接商品"的过渡页，发布前可以人工补一页。',
    caption_product_bridge_missing: '正文缺商品承接句（已自动补写：整理成了什么 + 购买理由 + 评论区/下方链接）。',
  };
  return labels[issue] || issue;
}

function DynamicDirectoryCover({ draft, topic, card, presetImageUrl, onImageReady, onDraftPersisted, batchId, jobId, skinId, productId, examScope }: { draft: ReferenceDrivenDraft; topic?: MigratedTopic; card?: CompetitorCreativeCard; presetImageUrl?: string | null; onImageReady?: (url: string | null) => void; onDraftPersisted?: (draft: ReferenceDrivenDraft) => void; batchId?: string; jobId?: string; skinId?: string | null; productId?: ProductId; examScope?: ExamScope }) {
  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  if (card && spec?.renderMode === 'image_to_image') {
    if (presetImageUrl) {
      return <div><img className="aspect-[3/4] w-full object-cover shadow-xl" src={presetImageUrl} alt={draft.cover.title} /><div className="mt-3 text-xs font-bold text-green-700">服务端已生成封面（请核对文字准确性）</div></div>;
    }
    return <ReferenceImageGenerator draft={draft} topic={topic} card={card} onImageReady={onImageReady} onDraftPersisted={onDraftPersisted} batchId={batchId} jobId={jobId} productId={productId} examScope={examScope} />;
  }
  return <ReferenceCoverRenderer renderer={card?.renderer_id || 'parchment_dense_directory'} payload={draft.cover} referenceImage={card?.reference_image} skinId={skinId} />;
}

type GeneratedImageState = { taskId?: string; status?: string; progress?: number; url?: string; error?: string };

// 生图 API 是异步任务制：submit 返回 task_id 那一刻已经扣款。task_id 存进
// localStorage，页面刷新/查询报错后凭它继续轮询旧任务，绝不重新提交。
const IMAGE_POLL_INTERVAL_MS = 4000;
const IMAGE_MAX_POLLS = 150; // 150 × 4s = 10 分钟，和批量工作流保持一致

function ReferenceImageGenerator({ draft, topic, card, onImageReady, onDraftPersisted, batchId, jobId, productId, examScope }: { draft: ReferenceDrivenDraft; topic?: MigratedTopic; card: CompetitorCreativeCard; onImageReady?: (url: string | null) => void; onDraftPersisted?: (draft: ReferenceDrivenDraft) => void; batchId?: string; jobId?: string; productId?: ProductId; examScope?: ExamScope }) {
  const [imageState, setImageState] = useState<GeneratedImageState>({});
  const marketReference = topic?.topicSource === 'market' ? topic.marketReference : undefined;
  const isMarketContentNote = draft.content_mode === 'standard' && topic?.topicSource === 'market' && Boolean(marketReference?.sourceTitle);
  const marketCoverUrl = marketReference?.sourceCoverUrl;
  const [coverRoute, setCoverRoute] = useState<'MARKET_REFERENCE_COVER' | 'DAZIBAO'>(() => draft.coverRoute === 'MARKET_REFERENCE_COVER' && marketCoverUrl ? 'MARKET_REFERENCE_COVER' : 'DAZIBAO');
  const [marketCoverPreviewOpen, setMarketCoverPreviewOpen] = useState(false);
  const [marketCoverLoadFailed, setMarketCoverLoadFailed] = useState(false);
  const [dazibaoReference] = useState(() => draft.selectedDazibaoReferenceId || pickXhsDazibaoReference());
  const [referencePath, setReferencePath] = useState(() => coverRoute === 'MARKET_REFERENCE_COVER' ? marketCoverUrl || dazibaoReference : dazibaoReference);
  const taskStorageKey = `xhs-image-task:${card.id}:${draft.id}`;

  async function chooseCoverRoute(nextRoute: 'MARKET_REFERENCE_COVER' | 'DAZIBAO') {
    if (nextRoute === 'MARKET_REFERENCE_COVER' && !marketCoverUrl) return;
    setCoverRoute(nextRoute);
    setReferencePath(nextRoute === 'MARKET_REFERENCE_COVER' ? marketCoverUrl! : dazibaoReference);
    if (!batchId || !jobId) return;
    try {
      const response = await fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'update_draft_state', batch_id: batchId, job_id: jobId,
        cover_route: nextRoute,
        ...(nextRoute === 'MARKET_REFERENCE_COVER' && typeof topic?.referenceId === 'number' ? { selected_market_reference_id: topic.referenceId } : {}),
        ...(nextRoute === 'DAZIBAO' ? { selected_dazibao_reference_id: dazibaoReference } : {}),
      }) });
      const result = await response.json() as { job?: { draft?: ReferenceDrivenDraft }; error?: string };
      if (!response.ok || !result.job?.draft) throw new Error(result.error || '封面方案保存失败');
      onDraftPersisted?.(result.job.draft);
    } catch (error) {
      setImageState(current => ({ ...current, error: error instanceof Error ? error.message : '封面方案保存失败' }));
    }
  }

  async function pollTask(taskId: string) {
    let consecutiveErrors = 0;
    for (let attempt = 0; attempt < IMAGE_MAX_POLLS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, IMAGE_POLL_INTERVAL_MS));
      let task: { id?: string; status?: string; progress?: number; url?: string; error?: { message?: string } };
      try {
        const poll = await fetch(`/api/image-task?task_id=${encodeURIComponent(taskId)}`);
        const parsed = await poll.json();
        task = typeof parsed?.error === 'string' ? { error: { message: parsed.error } } : parsed;
        if (!poll.ok) throw new Error(task.error?.message || '文生图任务查询失败');
      } catch (error) {
        // 零星网络抖动不算任务失败：任务在服务端可能还在跑，继续查。
        consecutiveErrors += 1;
        // 查询短暂失败不提前结束，继续到10分钟统一截止；task_id始终保留。
        continue;
      }
      consecutiveErrors = 0;
      setImageState({ taskId, status: task.status, progress: task.progress, url: task.url, error: task.error?.message });
      if (task.status === 'completed') {
        localStorage.removeItem(taskStorageKey);
        if (task.url) onImageReady?.(task.url);
        return;
      }
      if (task.status === 'failed') {
        localStorage.removeItem(taskStorageKey);
        return;
      }
    }
    setImageState(current => ({ ...current, status: 'timeout', error: '已等待10分钟任务仍未完成。task_id 已保留，可点击"继续查询"，不要急着重新生成（旧任务已扣款）。' }));
  }

  async function generate() {
    onImageReady?.(null);
    setImageState({ status: '正在提交文生图...' });
    try {
      const selectedReference = coverRoute === 'MARKET_REFERENCE_COVER' ? marketCoverUrl : dazibaoReference;
      if (!selectedReference) throw new Error('当前封面参考图不可用，请切换到原生大字报');
      setReferencePath(selectedReference);
      const generationCard = selectedReference === card.reference_image ? card : { ...card, reference_image: selectedReference };
      // 先确认参考图文件真的存在（HEAD 同源静态文件），再决定用图生图还是
      // 文生图 prompt——两半必须同时定，缺图时 prompt 却说"已附带参考图"
      // 会让模型追随一张不存在的图。
      let hasReference = false;
      if (selectedReference) {
        // Remote CSV covers are intentionally not HEAD-probed in the browser:
        // their CDN may disallow CORS for HEAD even though zexapi can receive
        // the URL. Local Dazibao assets still get the same existence check.
        if (/^https?:\/\//i.test(selectedReference)) hasReference = true;
        else { try { hasReference = (await fetch(selectedReference, { method: 'HEAD' })).ok; } catch { hasReference = false; } }
      }
      if (!hasReference) throw new Error('图生图参考图缺失，不能提交无参考图生成');
      const response = await fetch('/api/image-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildReferenceImagePrompt(generationCard, draft.cover, hasReference, productId, examScope, coverRoute === 'MARKET_REFERENCE_COVER' ? 'market_reference' : 'dazibao_pool'),
          negative_prompt: referenceImageNegativePrompt,
          aspect_ratio: '3:4',
          reference_images: hasReference ? [selectedReference] : [],
          product_id: productId,
          poster_title: draft.cover.title,
        }),
      });
      const task = await response.json();
      if (task.code === 'image_submission_uncertain') {
        setImageState({ status: 'submission_uncertain', error: task.error || '提交状态不确定，请先核对服务商任务列表，不要重复提交' });
        return;
      }
      if (!response.ok) throw new Error(task.error || '文生图任务提交失败');
      localStorage.setItem(taskStorageKey, task.id);
      setImageState({ taskId: task.id, status: task.status, progress: task.progress, url: task.url });
      await pollTask(task.id);
    } catch (error) {
      setImageState(current => ({ ...current, status: 'failed', error: error instanceof Error ? error.message : '文生图失败' }));
    }
  }

  function resumeTask() {
    const saved = imageState.taskId;
    if (!saved) return;
    setImageState(current => ({ ...current, status: 'polling', error: undefined }));
    void pollTask(saved);
  }

  useEffect(() => {
    // 恢复：上次提交的任务还没到终态就离开/刷新了——凭 localStorage 里的 task_id
    // 继续查旧任务（它已经扣款），不重新提交。
    const saved = localStorage.getItem(taskStorageKey);
    if (saved && /^task_[\w-]+$/.test(saved)) {
      setImageState({ taskId: saved, status: 'polling' });
      void pollTask(saved);
    }
  }, [taskStorageKey]);

  if (imageState.url) return <div><img className="aspect-[3/4] w-full object-cover shadow-xl" src={imageState.url} alt={draft.cover.title} /><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-bold text-green-700">文生图已完成，请核对文字是否准确</span><button className="border border-neutral-300 px-3 py-1.5 font-bold" onClick={generate}>重新生成</button></div><p className="mt-2 text-[11px] text-neutral-500">参考图：{coverRoute === 'MARKET_REFERENCE_COVER' ? '市场原笔记封面' : referencePath}</p></div>;

  const polling = imageState.status !== undefined && !['failed', 'timeout', 'submission_uncertain'].includes(imageState.status);
  return <div>
    {isMarketContentNote ? <section className="mb-4 border-2 border-violet-200 bg-violet-50 p-4" aria-label="市场原笔记封面选择">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-violet-950">封面参考方式</h3><p className="mt-1 text-xs leading-relaxed text-violet-900">这篇选题来自市场原笔记，可以借它的封面；不想用时仍可切回原生大字报。</p></div><span className="text-xs font-bold text-violet-700">只在点击时查看原封面</span></div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button type="button" disabled={polling || !marketCoverUrl || marketCoverLoadFailed} onClick={() => void chooseCoverRoute('MARKET_REFERENCE_COVER')} className={`min-h-12 border-2 px-3 py-2 text-left text-sm font-black ${coverRoute === 'MARKET_REFERENCE_COVER' ? 'border-violet-800 bg-violet-800 text-white' : 'border-violet-300 bg-white text-violet-950'} disabled:cursor-not-allowed disabled:opacity-50`}>参考市场原笔记封面<span className="mt-1 block text-xs font-normal">保留构图和节奏，替换成本文案</span></button>
        <button type="button" disabled={polling} onClick={() => void chooseCoverRoute('DAZIBAO')} className={`min-h-12 border-2 px-3 py-2 text-left text-sm font-black ${coverRoute === 'DAZIBAO' ? 'border-fuchsia-800 bg-fuchsia-800 text-white' : 'border-fuchsia-300 bg-white text-fuchsia-950'} disabled:cursor-not-allowed disabled:opacity-50`}>使用原生大字报<span className="mt-1 block text-xs font-normal">从当前 7 张大字报参考图中取 1 张</span></button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><button type="button" disabled={!marketCoverUrl} onClick={() => setMarketCoverPreviewOpen(value => !value)} className="font-black text-violet-800 underline disabled:text-neutral-400">{marketCoverPreviewOpen ? '收起原笔记封面' : '查看原笔记封面'}</button>{marketReference?.sourceNoteUrl ? <a className="font-bold text-violet-800 underline" href={marketReference.sourceNoteUrl} target="_blank" rel="noreferrer">打开原笔记</a> : null}<span className="text-neutral-500">当前：{coverRoute === 'MARKET_REFERENCE_COVER' ? '市场原笔记' : '原生大字报'}</span></div>
      {marketCoverPreviewOpen && marketCoverUrl && !marketCoverLoadFailed ? <img className="mt-3 max-h-[420px] w-full object-contain bg-white" src={marketCoverUrl} alt={`${marketReference?.sourceTitle || '市场原笔记'}封面`} loading="lazy" onError={() => setMarketCoverLoadFailed(true)} /> : null}
      {marketCoverLoadFailed ? <p className="mt-3 text-sm font-semibold text-amber-900">暂时无法获取这条原笔记封面。你仍可以使用原生大字报继续生成。</p> : null}
      {!marketCoverUrl ? <p className="mt-3 text-xs font-semibold text-amber-900">暂时没有这条原笔记的封面地址，你仍可以使用原生大字报继续生成。</p> : null}
    </section> : null}
    <div className="relative"><img className="aspect-[3/4] w-full object-cover shadow-xl" src={referencePath} alt={`${coverRoute === 'MARKET_REFERENCE_COVER' ? '市场原笔记' : card.name}参考图`} /><span className="absolute left-3 top-3 bg-black px-2 py-1 text-xs font-black text-white">{coverRoute === 'MARKET_REFERENCE_COVER' ? '市场原笔记参考' : '大字报风格参考（仅示意）'}</span></div><div className="mt-3 border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm leading-relaxed text-fuchsia-950"><b>这类封面用图生图。</b>上方参考图会随本篇标题和内容一起发给模型，风格、配色、版式以参考图为准。</div>{imageState.status === 'timeout' && imageState.taskId ? <div className="mt-3 flex gap-2"><button className="flex-1 bg-fuchsia-700 px-4 py-2.5 text-sm font-black text-white" onClick={resumeTask}>继续查询此任务（不重复扣款）</button><button className="border border-neutral-300 px-4 py-2.5 text-sm font-bold" onClick={generate}>放弃并重新生成</button></div> : imageState.status === 'submission_uncertain' ? <div className="mt-3 border border-amber-300 bg-amber-50 p-3 text-sm font-semibold text-amber-900">服务商可能已经接收任务。请先到服务商任务列表核对 task_id；当前不会自动重复提交。</div> : <button className="mt-3 w-full bg-fuchsia-700 px-4 py-2.5 text-sm font-black text-white disabled:bg-neutral-400" disabled={polling} onClick={generate}>{polling ? `生成中 ${imageState.progress ?? 0}%` : '生成图片封面'}</button>}{imageState.error ? <div className="mt-2 text-sm font-semibold text-red-700">{imageState.error}</div> : null}</div>;
}

export function InnerPagePreview({ page, registerNode, exportDisabled }: { page: GeneratedInnerPage; registerNode?: (node: HTMLElement | null) => void; exportDisabled?: boolean }) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (!nodeRef.current || exportDisabled) return;
    setBusy(true);
    try {
      await exportNodeAsPng(nodeRef.current, `内页${String(page.page_no).padStart(2, '0')}`);
    } finally {
      setBusy(false);
    }
  }

  return <div>
    <InnerPageRenderer
      page={page}
      registerNode={(node) => { nodeRef.current = node; registerNode?.(node); }}
    />
    <button className="mt-2 w-full border border-neutral-300 bg-white px-2 py-1.5 text-xs font-bold text-neutral-700 disabled:opacity-50" disabled={busy || exportDisabled} onClick={handleExport}>{busy ? '导出中...' : '单独导出这张'}</button>
  </div>;
}
