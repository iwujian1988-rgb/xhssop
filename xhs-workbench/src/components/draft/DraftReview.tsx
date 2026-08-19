'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { downloadImageUrl, exportAllAsZip, exportNodeAsPng, type ExportItem } from '@/lib/export-image';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';
import type { CompetitorCreativeCard, GeneratedInnerPage, ReferenceDrivenDraft } from '@/types/reference-workflow';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';
import { applyDraftTitleSelection, findSelectedTitleIndex, getDraftTitleSelection, type DraftTitleSelection } from '@/lib/draft-title-selection';
import { getCoverSkins, normalizeCoverSkin } from '@/lib/cover-skins';

export function DraftReview({ draft, card, presetCoverImageUrl, initialTitleSelection, onTitleSelectionChange, initialSkinId, onSkinChange }: {
  draft: ReferenceDrivenDraft;
  card?: CompetitorCreativeCard;
  presetCoverImageUrl?: string | null;
  initialTitleSelection?: DraftTitleSelection | null;
  onTitleSelectionChange?: (selection: DraftTitleSelection) => void;
  initialSkinId?: string | null;
  onSkinChange?: (skinId: string) => void;
}) {
  const coverNodeRef = useRef<HTMLDivElement | null>(null);
  const innerRefs = useRef(new Map<number, HTMLElement>());
  const [generatedCoverImageUrl, setGeneratedCoverImageUrl] = useState<string | null>(null);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(() => initialTitleSelection?.candidateIndex ?? findSelectedTitleIndex(draft));
  const [selectedSkinId, setSelectedSkinId] = useState(() => normalizeCoverSkin(card?.renderer_id, initialSkinId));
  const [exportBusy, setExportBusy] = useState<'' | 'cover' | 'all'>('');
  const [exportMsg, setExportMsg] = useState('');

  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  const isImageCover = !!card && spec?.renderMode === 'image_to_image';
  const coverSkins = getCoverSkins(card?.renderer_id);
  const titleSelection = useMemo(
    () => getDraftTitleSelection(draft, selectedCandidateIndex),
    [draft, selectedCandidateIndex],
  );
  const effectiveDraft = useMemo(
    () => applyDraftTitleSelection(draft, isImageCover ? null : titleSelection),
    [draft, isImageCover, titleSelection],
  );
  // When the cover image is pre-generated (batch runner server-side generation),
  // use it directly instead of showing the manual generate button.
  const coverImageUrl = presetCoverImageUrl ?? generatedCoverImageUrl;
  useEffect(() => {
    setSelectedCandidateIndex(initialTitleSelection?.candidateIndex ?? findSelectedTitleIndex(draft));
  }, [draft, initialTitleSelection?.candidateIndex]);
  useEffect(() => {
    setSelectedSkinId(normalizeCoverSkin(card?.renderer_id, initialSkinId));
  }, [card?.renderer_id, initialSkinId]);

  const safeTitle = (effectiveDraft.selected_title || '小红书笔记').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);

  function selectCandidate(index: number) {
    if (isImageCover) return;
    const selection = getDraftTitleSelection(draft, index);
    setSelectedCandidateIndex(selection.candidateIndex);
    onTitleSelectionChange?.(selection);
    setExportMsg('已临时换用这组标题，导出时会使用当前选择');
  }

  function selectSkin(skinId: string) {
    setSelectedSkinId(skinId);
    onSkinChange?.(skinId);
    setExportMsg('已临时换用这张底图，导出时会使用当前选择');
  }

  async function handleExportCover() {
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
    setExportBusy('all');
    setExportMsg('');
    try {
      const items: ExportItem[] = [];
      if (isImageCover && coverImageUrl) items.push({ filename: '00-封面.png', url: coverImageUrl });
      else if (coverNodeRef.current) items.push({ filename: '00-封面.png', node: coverNodeRef.current });
      effectiveDraft.inner_pages.forEach(page => {
        const node = innerRefs.current.get(page.page_no);
        if (node) items.push({ filename: `${String(page.page_no).padStart(2, '0')}-内页.png`, node });
      });
      if (!items.length) { setExportMsg('还没有可导出的素材'); return; }
      const { failures } = await exportAllAsZip(items, `${safeTitle}-素材包`);
      setExportMsg(failures.length ? `打包完成，但 ${failures.join('、')} 导出失败（可能是外链图片跨域，可单独下载封面重试）` : `打包完成：共 ${items.length} 张图，已下载 zip`);
    } catch (cause) {
      setExportMsg(cause instanceof Error ? cause.message : '打包失败');
    } finally {
      setExportBusy('');
    }
  }

  return <div className="space-y-5">
    <section className="grid gap-5 xl:grid-cols-[minmax(420px,680px)_minmax(0,1fr)]">
      <div className="border border-neutral-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-black">3. 动态封面成品</h2><span className="text-xs text-neutral-500">复用参考视觉母版</span></div>
        <div ref={coverNodeRef}><DynamicDirectoryCover draft={effectiveDraft} card={card} presetImageUrl={presetCoverImageUrl} onImageReady={setGeneratedCoverImageUrl} skinId={selectedSkinId} /></div>
        <div className="mt-3 flex items-center gap-2">
          <button className="flex-1 border border-neutral-900 bg-neutral-900 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-400 disabled:border-neutral-400" disabled={!!exportBusy} onClick={handleExportCover}>{exportBusy === 'cover' ? '导出中...' : '导出封面'}</button>
          <button className="flex-1 border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 disabled:opacity-50" disabled={!!exportBusy} onClick={handleExportAll}>{exportBusy === 'all' ? '打包中...' : '打包下载全部（封面+内页）'}</button>
        </div>
        {exportMsg ? <p className="mt-2 text-xs font-semibold text-neutral-600">{exportMsg}</p> : null}
      </div>
      <div className="space-y-4">
        <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">统一内容任务单</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><BriefFact label="人群" value={draft.brief.audience} /><BriefFact label="场景" value={draft.brief.scene} /><BriefFact label="痛点" value={draft.brief.pain} /><BriefFact label="内容价值" value={draft.brief.content_value} /><BriefFact label="商品卖点" value={draft.brief.selling_point} /><BriefFact label="购买理由" value={draft.brief.buying_reason} /></div></section>
        <section className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-black">导出前临时换标题</div><div className="mt-1 text-xs text-neutral-500">文字标题、封面标题和副标题成组切换，避免错配</div></div><div className="text-xs font-bold text-neutral-500">当前第 {selectedCandidateIndex + 1} 组</div></div>{isImageCover ? <div className="mt-3 border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">该封面已经由 AI 生成，临时换标题需要重新生图，因此这里保持锁定。</div> : <div className="mt-3 space-y-2">{draft.title_candidates.map((title, index) => { const coverTitle = draft.cover_title_candidates?.[index]; const active = index === selectedCandidateIndex; return <button type="button" className={`block w-full border px-3 py-3 text-left ${active ? 'border-red-400 bg-red-50' : 'border-neutral-200 hover:border-neutral-400'}`} key={`${title.title}-${index}`} onClick={() => selectCandidate(index)}><div className="flex items-center justify-between gap-2"><span className="bg-neutral-100 px-2 py-0.5 text-xs font-black text-neutral-600">{title.trigger_type || '标题'}</span><span className="text-xs font-bold text-neutral-400">第 {index + 1} 组</span></div><div className="mt-2 font-bold">文字标题：{title.title}</div><div className="mt-1 text-sm font-black text-red-800">封面标题：{coverTitle?.title || draft.cover.title}</div>{coverTitle?.subtitle ? <div className="mt-1 text-xs font-semibold text-neutral-600">副标题：{coverTitle.subtitle}</div> : null}</button>; })}</div>}</section>
        {coverSkins.length > 1 && !isImageCover ? <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">导出前临时换底图</div><div className="mt-1 text-xs text-neutral-500">只改变纸张或黑板质感，不改变现有排版</div><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{coverSkins.map(skin => <button type="button" key={skin.id} onClick={() => selectSkin(skin.id)} className={`border p-2 text-left text-xs font-bold ${selectedSkinId === skin.id ? 'border-red-400 bg-red-50' : 'border-neutral-200 bg-white hover:border-neutral-400'}`}><span className="mb-2 block h-8 w-full border border-black/10" style={{ background: skin.swatch }} /><span>{skin.label}</span></button>)}</div></section> : null}
        <section className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between"><div className="text-sm font-black">自动检查</div><span className={`px-2 py-1 text-xs font-bold ${draft.checks.issues.length ? 'bg-red-100 text-red-700' : draft.checks.warnings?.length ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'}`}>{draft.checks.issues.length ? '需要调整' : draft.checks.warnings?.length ? '通过，有提醒' : '通过'}</span></div><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><Check label="标题与封面一致" ok={draft.checks.title_cover_consistent} /><Check label="模板容量正常" ok={draft.checks.template_capacity_ok} /><Check label="商品事实有依据" ok={draft.checks.product_claims_grounded} /><Check label="内容密度达标" ok={draft.checks.content_density_ok} /></div>{draft.checks.warnings?.length ? <ul className="mt-3 space-y-1 text-xs leading-relaxed text-amber-800">{draft.checks.warnings.map(issue => <li key={issue}>提醒 · {formatWarning(issue)}</li>)}</ul> : null}</section>
        <section className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between"><div className="text-sm font-black">法语与考试事实审校</div><span className={`px-2 py-1 text-xs font-bold ${draft.accuracy_audit.approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{draft.accuracy_audit.approved ? '通过' : '已修正/需留意'}</span></div><p className="mt-2 text-xs text-neutral-500">自动修正 {draft.accuracy_audit.corrected_count} 处</p>{draft.accuracy_audit.issues.length ? <ul className="mt-3 space-y-1 text-xs leading-relaxed text-amber-900">{draft.accuracy_audit.issues.map(issue => <li key={issue}>· {issue}</li>)}</ul> : null}</section>
        {card ? <a className="block border border-neutral-300 bg-white px-4 py-3 text-center text-sm font-bold" href={card.reference_image}>查看参考原图</a> : null}
      </div>
    </section>
    <section className="border border-neutral-200 bg-white p-5"><h2 className="font-black">4. 内页实际内容</h2><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{draft.inner_pages.map(page => <InnerPagePreview page={page} key={page.page_no} registerNode={node => { if (node) innerRefs.current.set(page.page_no, node); else innerRefs.current.delete(page.page_no); }} />)}</div></section>
    <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]"><div className="border border-neutral-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-black">5. 正文</h2><span className="text-xs text-neutral-500">{draft.caption.length} 字符</span></div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-7 text-neutral-700">{draft.caption}</pre><div className="mt-5 border-t border-neutral-200 pt-4"><div className="text-xs font-bold text-neutral-400">搜索关键词</div><div className="mt-2 flex flex-wrap gap-2">{draft.seo_keywords.map(keyword => <span className="bg-amber-50 px-2 py-1 text-xs font-bold text-amber-900" key={keyword}>{keyword}</span>)}</div><div className="mt-4 text-sm font-semibold leading-7 text-red-700">{draft.tags.join(' ')}</div></div></div><div className="border border-neutral-200 bg-white p-5"><h2 className="font-black">知识库依据</h2><div className="mt-3 space-y-3">{draft.evidence.map(item => <div className="border-b border-neutral-100 pb-3 text-xs leading-relaxed" key={item.id}><div className="font-bold">{item.text}</div><div className="mt-1 text-neutral-500">{item.source_file} · {item.source_section}</div></div>)}</div></div></section>
  </div>;
}

function BriefFact({ label, value }: { label: string; value: string }) { return <div className="border-l-2 border-neutral-900 pl-3"><div className="text-xs font-bold text-neutral-400">{label}</div><div className="mt-1 text-sm leading-relaxed">{value}</div></div>; }
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

function DynamicDirectoryCover({ draft, card, presetImageUrl, onImageReady, skinId }: { draft: ReferenceDrivenDraft; card?: CompetitorCreativeCard; presetImageUrl?: string | null; onImageReady?: (url: string | null) => void; skinId?: string | null }) {
  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  if (card && spec?.renderMode === 'image_to_image') {
    if (presetImageUrl) {
      return <div><img className="aspect-[3/4] w-full object-cover shadow-xl" src={presetImageUrl} alt={draft.cover.title} /><div className="mt-3 text-xs font-bold text-green-700">服务端已生成封面（请核对文字准确性）</div></div>;
    }
    return <ReferenceImageGenerator draft={draft} card={card} onImageReady={onImageReady} />;
  }
  return <ReferenceCoverRenderer renderer={card?.renderer_id || 'parchment_dense_directory'} payload={draft.cover} referenceImage={card?.reference_image} skinId={skinId} />;
}

type GeneratedImageState = { taskId?: string; status?: string; progress?: number; url?: string; error?: string };

// 生图 API 是异步任务制：submit 返回 task_id 那一刻已经扣款。task_id 存进
// localStorage，页面刷新/查询报错后凭它继续轮询旧任务，绝不重新提交。
const IMAGE_POLL_INTERVAL_MS = 4000;
const IMAGE_MAX_POLLS = 75; // 75 × 4s = 5 分钟（生图模型异步，5 分钟才算超时）
const IMAGE_MAX_POLL_ERRORS = 8;

function ReferenceImageGenerator({ draft, card, onImageReady }: { draft: ReferenceDrivenDraft; card: CompetitorCreativeCard; onImageReady?: (url: string | null) => void }) {
  const [imageState, setImageState] = useState<GeneratedImageState>({});
  const taskStorageKey = `xhs-image-task:${card.id}:${draft.id}`;

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
        if (consecutiveErrors >= IMAGE_MAX_POLL_ERRORS) {
          setImageState(current => ({ ...current, status: 'timeout', error: `连续查询失败（${error instanceof Error ? error.message : '网络错误'}）。任务可能仍在处理，task_id 已保留，可点击"继续查询"。` }));
          return;
        }
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
    setImageState(current => ({ ...current, status: 'timeout', error: '已等待5分钟任务仍未完成。task_id 已保留，可点击"继续查询"，不要急着重新生成（旧任务已扣款）。' }));
  }

  async function generate() {
    onImageReady?.(null);
    setImageState({ status: '正在提交文生图...' });
    try {
      // 先确认参考图文件真的存在（HEAD 同源静态文件），再决定用图生图还是
      // 文生图 prompt——两半必须同时定，缺图时 prompt 却说"已附带参考图"
      // 会让模型追随一张不存在的图。
      let hasReference = false;
      if (card.reference_image) {
        try { hasReference = (await fetch(card.reference_image, { method: 'HEAD' })).ok; } catch { hasReference = false; }
      }
      const response = await fetch('/api/image-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildReferenceImagePrompt(card, draft.cover, hasReference),
          negative_prompt: referenceImageNegativePrompt,
          aspect_ratio: '3:4',
          reference_images: hasReference ? [card.reference_image] : [],
        }),
      });
      const task = await response.json();
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

  if (imageState.url) return <div><img className="aspect-[3/4] w-full object-cover shadow-xl" src={imageState.url} alt={draft.cover.title} /><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-bold text-green-700">文生图已完成，请核对文字是否准确</span><button className="border border-neutral-300 px-3 py-1.5 font-bold" onClick={generate}>重新生成</button></div></div>;

  const polling = imageState.status !== undefined && imageState.status !== 'failed' && imageState.status !== 'timeout';
  return <div><div className="relative"><img className="aspect-[3/4] w-full object-cover shadow-xl" src={card.reference_image} alt={`${card.name}参考图`} /><span className="absolute left-3 top-3 bg-black px-2 py-1 text-xs font-black text-white">风格参考（仅示意）</span></div><div className="mt-3 border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm leading-relaxed text-fuchsia-950"><b>这类封面用图生图。</b>上方参考图会随本篇标题和内容一起发给模型，风格、配色、版式以参考图为准。</div>{imageState.status === 'timeout' && imageState.taskId ? <div className="mt-3 flex gap-2"><button className="flex-1 bg-fuchsia-700 px-4 py-2.5 text-sm font-black text-white" onClick={resumeTask}>继续查询此任务（不重复扣款）</button><button className="border border-neutral-300 px-4 py-2.5 text-sm font-bold" onClick={generate}>放弃并重新生成</button></div> : <button className="mt-3 w-full bg-fuchsia-700 px-4 py-2.5 text-sm font-black text-white disabled:bg-neutral-400" disabled={polling} onClick={generate}>{polling ? `生成中 ${imageState.progress ?? 0}%` : '按本篇内容文生图'}</button>}{imageState.error ? <div className="mt-2 text-sm font-semibold text-red-700">{imageState.error}</div> : null}</div>;
}

export function InnerPagePreview({ page, registerNode }: { page: GeneratedInnerPage; registerNode?: (node: HTMLElement | null) => void }) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleExport() {
    if (!nodeRef.current) return;
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
    <button className="mt-2 w-full border border-neutral-300 bg-white px-2 py-1.5 text-xs font-bold text-neutral-700 disabled:opacity-50" disabled={busy} onClick={handleExport}>{busy ? '导出中...' : '单独导出这张'}</button>
  </div>;
}
