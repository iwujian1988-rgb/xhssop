'use client';

import { useEffect, useRef, useState } from 'react';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { downloadImageUrl, exportAllAsZip, exportNodeAsPng, type ExportItem } from '@/lib/export-image';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';
import type { CompetitorCreativeCard, GeneratedInnerPage, ReferenceDrivenDraft } from '@/types/reference-workflow';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';

export function DraftReview({ draft, card, presetCoverImageUrl }: { draft: ReferenceDrivenDraft; card?: CompetitorCreativeCard; presetCoverImageUrl?: string | null }) {
  const coverNodeRef = useRef<HTMLDivElement | null>(null);
  const innerRefs = useRef(new Map<number, HTMLElement>());
  const [generatedCoverImageUrl, setGeneratedCoverImageUrl] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState(draft.selected_title);
  const [exportBusy, setExportBusy] = useState<'' | 'cover' | 'all'>('');
  const [exportMsg, setExportMsg] = useState('');

  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  const isImageCover = !!card && spec?.renderMode === 'image_to_image';
  // When the cover image is pre-generated (batch runner server-side generation),
  // use it directly instead of showing the manual generate button.
  const coverImageUrl = presetCoverImageUrl ?? generatedCoverImageUrl;
  useEffect(() => {
    setSelectedTitle(draft.selected_title);
  }, [draft.selected_title]);

  const safeTitle = (selectedTitle || draft.selected_title || '小红书笔记').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);

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
      draft.inner_pages.forEach(page => {
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
        <div ref={coverNodeRef}><DynamicDirectoryCover draft={draft} card={card} presetImageUrl={presetCoverImageUrl} onImageReady={setGeneratedCoverImageUrl} /></div>
        <div className="mt-3 flex items-center gap-2">
          <button className="flex-1 border border-neutral-900 bg-neutral-900 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-400 disabled:border-neutral-400" disabled={!!exportBusy} onClick={handleExportCover}>{exportBusy === 'cover' ? '导出中...' : '导出封面'}</button>
          <button className="flex-1 border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 disabled:opacity-50" disabled={!!exportBusy} onClick={handleExportAll}>{exportBusy === 'all' ? '打包中...' : '打包下载全部（封面+内页）'}</button>
        </div>
        {exportMsg ? <p className="mt-2 text-xs font-semibold text-neutral-600">{exportMsg}</p> : null}
      </div>
      <div className="space-y-4">
        <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">统一内容任务单</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><BriefFact label="人群" value={draft.brief.audience} /><BriefFact label="场景" value={draft.brief.scene} /><BriefFact label="痛点" value={draft.brief.pain} /><BriefFact label="内容价值" value={draft.brief.content_value} /><BriefFact label="商品卖点" value={draft.brief.selling_point} /><BriefFact label="购买理由" value={draft.brief.buying_reason} /></div></section>
        <section className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div className="text-sm font-black">标题候选</div><div className="text-xs font-bold text-neutral-500">当前：{selectedTitle}</div></div><div className="mt-3 space-y-2">{draft.title_candidates.map((title, index) => <button type="button" className={`block w-full border px-3 py-2 text-left ${title.title === selectedTitle ? 'border-red-400 bg-red-50' : 'border-neutral-200 hover:border-neutral-400'}`} key={`${title.title}-${index}`} onClick={() => setSelectedTitle(title.title)}><div className="flex items-center gap-2"><span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-black text-neutral-600">{title.trigger_type || '标题'}</span><span className="font-bold">{title.title}</span></div><div className="mt-1 text-xs text-neutral-500">公式 #{title.formula_id} · {title.reason}</div></button>)}</div></section>
        {draft.cover_title_candidates?.length ? <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">备用封面标题</div><div className="mt-3 space-y-2">{draft.cover_title_candidates.map((item, index) => <div className={`border px-3 py-2 text-xs ${item.template_id === card?.renderer_id ? 'border-red-300 bg-red-50' : 'border-neutral-200 bg-white'}`} key={`${item.template_id}-${item.title}-${index}`}><div className="font-black text-neutral-500">{item.template_id} · {item.title_type || '封面'}</div><div className="mt-1 text-base font-black text-neutral-900">{item.title}</div>{item.subtitle ? <div className="mt-1 font-semibold text-neutral-600">{item.subtitle}</div> : null}{item.reason ? <div className="mt-1 text-neutral-400">{item.reason}</div> : null}</div>)}</div></section> : null}
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
  };
  return labels[issue] || issue;
}

function DynamicDirectoryCover({ draft, card, presetImageUrl, onImageReady }: { draft: ReferenceDrivenDraft; card?: CompetitorCreativeCard; presetImageUrl?: string | null; onImageReady?: (url: string | null) => void }) {
  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  if (card && spec?.renderMode === 'image_to_image') {
    if (presetImageUrl) {
      return <div><img className="aspect-[3/4] w-full object-cover shadow-xl" src={presetImageUrl} alt={draft.cover.title} /><div className="mt-3 text-xs font-bold text-green-700">服务端已生成封面（请核对文字准确性）</div></div>;
    }
    return <ReferenceImageGenerator draft={draft} card={card} onImageReady={onImageReady} />;
  }
  return <ReferenceCoverRenderer renderer={card?.renderer_id || 'parchment_dense_directory'} payload={draft.cover} referenceImage={card?.reference_image} />;
}

type GeneratedImageState = { taskId?: string; status?: string; progress?: number; url?: string; error?: string };

function ReferenceImageGenerator({ draft, card, onImageReady }: { draft: ReferenceDrivenDraft; card: CompetitorCreativeCard; onImageReady?: (url: string | null) => void }) {
  const [imageState, setImageState] = useState<GeneratedImageState>({});

  async function generate() {
    onImageReady?.(null);
    setImageState({ status: '正在提交文生图...' });
    try {
      const response = await fetch('/api/image-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: buildReferenceImagePrompt(card, draft.cover),
          negative_prompt: referenceImageNegativePrompt,
          aspect_ratio: '3:4',
        }),
      });
      let task = await response.json();
      if (!response.ok) throw new Error(task.error || '文生图任务提交失败');
      setImageState({ taskId: task.id, status: task.status, progress: task.progress, url: task.url });
      for (let attempt = 0; task.id && task.status !== 'completed' && task.status !== 'failed' && attempt < 80; attempt += 1) {
        await new Promise(resolve => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/image-task?task_id=${encodeURIComponent(task.id)}`);
        task = await poll.json();
        if (!poll.ok) throw new Error(task.error || '文生图任务查询失败');
        setImageState({ taskId: task.id, status: task.status, progress: task.progress, url: task.url, error: task.error?.message });
      }
      if (task.url) onImageReady?.(task.url);
    } catch (error) {
      setImageState(current => ({ ...current, status: 'failed', error: error instanceof Error ? error.message : '文生图失败' }));
    }
  }

  if (imageState.url) return <div><img className="aspect-[3/4] w-full object-cover shadow-xl" src={imageState.url} alt={draft.cover.title} /><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-bold text-green-700">文生图已完成，请核对文字是否准确</span><button className="border border-neutral-300 px-3 py-1.5 font-bold" onClick={generate}>重新生成</button></div></div>;

  return <div><div className="relative"><img className="aspect-[3/4] w-full object-cover shadow-xl" src={card.reference_image} alt={`${card.name}参考图`} /><span className="absolute left-3 top-3 bg-black px-2 py-1 text-xs font-black text-white">风格参考（仅示意）</span></div><div className="mt-3 border border-fuchsia-200 bg-fuchsia-50 p-3 text-sm leading-relaxed text-fuchsia-950"><b>这类封面用文生图。</b>模板构图提示词已提前写好，生成时只把本篇标题和内容塞进去，不再上传参考图做图生图。</div><button className="mt-3 w-full bg-fuchsia-700 px-4 py-2.5 text-sm font-black text-white disabled:bg-neutral-400" disabled={imageState.status !== undefined && imageState.status !== 'failed'} onClick={generate}>{imageState.status && imageState.status !== 'failed' ? `生成中 ${imageState.progress ?? 0}%` : '按本篇内容文生图'}</button>{imageState.error ? <div className="mt-2 text-sm font-semibold text-red-700">{imageState.error}</div> : null}</div>;
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
