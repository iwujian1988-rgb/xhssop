'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { competitorCreativeCards } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { buildReferenceImagePrompt, referenceImageNegativePrompt } from '@/lib/reference-image-prompt';
import { downloadImageUrl, exportAllAsZip, exportNodeAsPng, type ExportItem } from '@/lib/export-image';
import { useAutoFitScale } from '@/components/templates/useAutoFitScale';
import type { ProductId } from '@/types/data';
import type { CompetitorCreativeCard, GeneratedInnerPage, MigratedTopic, ReferenceDrivenDraft } from '@/types/reference-workflow';

interface UsageSummary { prompt_tokens: number; completion_tokens: number; total_tokens: number; calls: number }

const supportedCards = competitorCreativeCards.filter(card => card.supported);

export default function StudioPage() {
  const [productId, setProductId] = useState<ProductId>('delf_b2_writing');
  const [cardId, setCardId] = useState(supportedCards[0]?.id || '');
  const [direction, setDirection] = useState('');
  const [topics, setTopics] = useState<MigratedTopic[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [draft, setDraft] = useState<ReferenceDrivenDraft | null>(null);
  const [loading, setLoading] = useState<'topics' | 'compose' | ''>('');
  const [error, setError] = useState('');
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const card = useMemo(() => supportedCards.find(item => item.id === cardId) || supportedCards[0], [cardId]);
  const selectedTopic = topics.find(topic => topic.id === selectedTopicId) || topics[0];

  function selectCard(nextCardId: string) {
    setCardId(nextCardId);
    setTopics([]);
    setSelectedTopicId('');
    setDraft(null);
    setUsage(null);
    setError('');
  }

  async function requestWorkflow(action: 'topics' | 'compose') {
    if (!card || (action === 'compose' && !selectedTopic)) return;
    setLoading(action);
    setError('');
    if (action === 'topics') setDraft(null);
    try {
      const response = await fetch('/api/reference-studio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          product_id: productId,
          reference_card_id: card.id,
          direction,
          topic: action === 'compose' ? selectedTopic : undefined,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || '生成失败');
      setUsage(json.usage || null);
      if (action === 'topics') {
        const nextTopics = json.topics as MigratedTopic[];
        setTopics(nextTopics);
        setSelectedTopicId(nextTopics[0]?.id || '');
      } else {
        setDraft(json.draft as ReferenceDrivenDraft);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成失败');
    } finally {
      setLoading('');
    }
  }

  return (
    <main className="min-h-screen bg-[#f4f5f6] text-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-[1500px] items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-black">小红书笔记台</h1>
            <p className="mt-1 text-sm text-neutral-500">选参考封面 → 迁移选题 → 生成标题、封面、内页和正文</p>
          </div>
          <Link href="/template-matrix" className="text-sm font-bold underline">封面模板总览</Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1500px] gap-5 p-5 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="border border-neutral-200 bg-white p-4">
            <div className="text-sm font-black">1. 选择商品和参考</div>
            <label className="mt-4 block text-xs font-bold text-neutral-500">商品</label>
            <select className="field mt-1" value={productId} onChange={event => setProductId(event.target.value as ProductId)}>
              <option value="delf_b2_writing">商品1：DELF B2写作资料库</option>
              <option value="tef_tcf_canada">商品2：TEF/TCF Canada资料库</option>
            </select>
            <div className="mt-4 space-y-2">{supportedCards.map(item => <ReferenceChoice key={item.id} card={item} active={item.id === cardId} onClick={() => selectCard(item.id)} />)}</div>
            <label className="mt-4 block text-xs font-bold text-neutral-500">可选方向</label>
            <textarea className="field mt-1 min-h-20 resize-y" placeholder="例如：更偏考前急救；留空让AI判断" value={direction} onChange={event => setDirection(event.target.value)} />
            <button className="mt-3 w-full bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white disabled:bg-neutral-400" disabled={!!loading} onClick={() => requestWorkflow('topics')}>
              {loading === 'topics' ? '正在结合商品迁移选题...' : '生成3个迁移选题'}
            </button>
          </section>
          {card ? <section className="border border-neutral-200 bg-white p-4 text-sm leading-relaxed"><div className="font-black">这张参考为什么成立</div><dl className="mt-3 space-y-3"><CardFact label="内容机制" value={card.content_mechanism} /><CardFact label="点击机制" value={card.click_mechanism} /><CardFact label="视觉机制" value={card.visual_mechanism} /></dl></section> : null}
        </aside>

        <section className="min-w-0 space-y-5">
          {error ? <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
          {usage ? <div className="border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-600">本次 AI 用量：<b className="text-neutral-950">{usage.total_tokens.toLocaleString()} tokens</b> · 输入 {usage.prompt_tokens.toLocaleString()} · 输出 {usage.completion_tokens.toLocaleString()} · {usage.calls} 次调用</div> : null}
          {!topics.length ? <EmptyState card={card} /> : (
            <section className="border border-neutral-200 bg-white p-5">
              <div className="flex items-end justify-between gap-3">
                <div><h2 className="font-black">2. 选择迁移选题</h2><p className="mt-1 text-sm text-neutral-500">人群、痛点、内容价值和商品承接已经放进同一条关系。</p></div>
                <button className="bg-[#c82d3e] px-4 py-2.5 text-sm font-bold text-white disabled:bg-neutral-400" disabled={!selectedTopic || !!loading} onClick={() => requestWorkflow('compose')}>
                  {loading === 'compose' ? '正在检索并生成完整笔记...' : '用这个选题生成完整笔记'}
                </button>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">{topics.map((topic, index) => <TopicChoice key={topic.id} index={index + 1} topic={topic} active={topic.id === selectedTopic?.id} onClick={() => setSelectedTopicId(topic.id)} />)}</div>
            </section>
          )}
          {draft ? <DraftReview draft={draft} card={card} /> : null}
        </section>
      </div>
    </main>
  );
}

function ReferenceChoice({ card, active, onClick }: { card: CompetitorCreativeCard; active: boolean; onClick: () => void }) {
  const mode = getCoverTemplateSpec(card.renderer_id)?.renderMode;
  const modeName = mode === 'image_to_image' ? '模板文生图' : mode === 'hybrid' ? '真实底图+程序排字' : '程序精排';
  return <button className={`grid w-full grid-cols-[72px_1fr] gap-3 border p-2 text-left ${active ? 'border-red-500 bg-red-50' : 'border-neutral-200 hover:border-neutral-400'}`} onClick={onClick}><img className="aspect-[3/4] w-full object-cover" src={card.reference_image} alt={card.name} /><span className="min-w-0 py-1"><span className="block text-sm font-black">{card.name}</span><span className="mt-1 block text-xs text-neutral-500">{card.density} density · {modeName}</span></span></button>;
}

function CardFact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold text-neutral-400">{label}</dt><dd className="mt-1 text-neutral-700">{value}</dd></div>; }

function EmptyState({ card }: { card?: CompetitorCreativeCard }) {
  return <section className="border border-dashed border-neutral-300 bg-white p-8"><div className="mx-auto grid max-w-4xl items-center gap-8 md:grid-cols-[260px_1fr]">{card ? <img className="aspect-[3/4] w-full object-cover shadow-xl" src={card.reference_image} alt={card.name} /> : null}<div><div className="text-2xl font-black">先从参考封面的成功机制出发</div><p className="mt-3 max-w-xl text-sm leading-7 text-neutral-600">系统读取参考卡，再结合商品事实提出3个可迁移选题。确认后才检索知识库并生成完整内容。</p></div></div></section>;
}

function TopicChoice({ topic, index, active, onClick }: { topic: MigratedTopic; index: number; active: boolean; onClick: () => void }) {
  return <button className={`min-h-[320px] border p-4 text-left ${active ? 'border-red-500 bg-red-50' : 'border-neutral-200 hover:border-neutral-400'}`} onClick={onClick}><div className="text-xs font-black text-red-600">方案 {index}</div><h3 className="mt-2 text-lg font-black leading-snug">{topic.topic}</h3><div className="mt-4 space-y-3 text-sm leading-relaxed text-neutral-600"><TopicFact label="给谁" value={topic.audience} /><TopicFact label="痛点" value={topic.pain} /><TopicFact label="给什么" value={topic.content_promise} /><TopicFact label="商品承接" value={topic.product_bridge} /><TopicFact label="为什么适合" value={topic.why_this_reference_fits} /></div></button>;
}

function TopicFact({ label, value }: { label: string; value: string }) { return <div><span className="font-bold text-neutral-950">{label}：</span>{value}</div>; }

function DraftReview({ draft, card }: { draft: ReferenceDrivenDraft; card?: CompetitorCreativeCard }) {
  const coverNodeRef = useRef<HTMLDivElement | null>(null);
  const innerRefs = useRef(new Map<number, HTMLElement>());
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<'' | 'cover' | 'all'>('');
  const [exportMsg, setExportMsg] = useState('');

  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  const isImageCover = !!card && spec?.renderMode === 'image_to_image';
  const safeTitle = (draft.selected_title || '小红书笔记').replace(/[\\/:*?"<>|]/g, '').slice(0, 40);

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
        <div ref={coverNodeRef}><DynamicDirectoryCover draft={draft} card={card} onImageReady={setCoverImageUrl} /></div>
        <div className="mt-3 flex items-center gap-2">
          <button className="flex-1 border border-neutral-900 bg-neutral-900 px-3 py-2 text-xs font-bold text-white disabled:bg-neutral-400 disabled:border-neutral-400" disabled={!!exportBusy} onClick={handleExportCover}>{exportBusy === 'cover' ? '导出中...' : '导出封面'}</button>
          <button className="flex-1 border border-neutral-300 bg-white px-3 py-2 text-xs font-bold text-neutral-900 disabled:opacity-50" disabled={!!exportBusy} onClick={handleExportAll}>{exportBusy === 'all' ? '打包中...' : '打包下载全部（封面+内页）'}</button>
        </div>
        {exportMsg ? <p className="mt-2 text-xs font-semibold text-neutral-600">{exportMsg}</p> : null}
      </div>
      <div className="space-y-4">
        <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">统一内容任务单</div><div className="mt-3 grid gap-3 sm:grid-cols-2"><BriefFact label="人群" value={draft.brief.audience} /><BriefFact label="场景" value={draft.brief.scene} /><BriefFact label="痛点" value={draft.brief.pain} /><BriefFact label="内容价值" value={draft.brief.content_value} /><BriefFact label="商品卖点" value={draft.brief.selling_point} /><BriefFact label="购买理由" value={draft.brief.buying_reason} /></div></section>
        <section className="border border-neutral-200 bg-white p-4"><div className="text-sm font-black">标题候选</div><div className="mt-3 space-y-2">{draft.title_candidates.map((title, index) => <div className={`border px-3 py-2 ${title.title === draft.selected_title ? 'border-red-400 bg-red-50' : 'border-neutral-200'}`} key={`${title.title}-${index}`}><div className="font-bold">{title.title}</div><div className="mt-1 text-xs text-neutral-500">公式 #{title.formula_id} · {title.trigger_type} · {title.reason}</div></div>)}</div></section>
        <section className="border border-neutral-200 bg-white p-4"><div className="flex items-center justify-between"><div className="text-sm font-black">自动检查</div><span className={`px-2 py-1 text-xs font-bold ${draft.checks.issues.length ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{draft.checks.issues.length ? '需要调整' : '通过'}</span></div><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><Check label="标题与封面一致" ok={draft.checks.title_cover_consistent} /><Check label="模板容量正常" ok={draft.checks.template_capacity_ok} /><Check label="商品事实有依据" ok={draft.checks.product_claims_grounded} /><Check label="内容密度达标" ok={draft.checks.content_density_ok} /></div></section>
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

function DynamicDirectoryCover({ draft, card, onImageReady }: { draft: ReferenceDrivenDraft; card?: CompetitorCreativeCard; onImageReady?: (url: string | null) => void }) {
  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  if (card && spec?.renderMode === 'image_to_image') return <ReferenceImageGenerator draft={draft} card={card} onImageReady={onImageReady} />;
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

function InnerPagePreview({ page, registerNode }: { page: GeneratedInnerPage; registerNode?: (node: HTMLElement | null) => void }) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  // Real bug caught by browser testing: a character-count-tier heuristic for
  // font size (like the old per-template heuristics) still let bullets-heavy
  // pages overflow the fixed aspect-ratio card by up to 200px, hidden by
  // overflow-hidden. Replaced with the same measure-and-shrink loop used by
  // the cover templates, applied directly to this fixed-height card.
  const fingerprint = `${page.page_title}|${page.lead}|${page.bullets.join('|')}`;
  // Floor is lower than cover templates because inner pages can be denser
  // (6 long bullets + lead + title in a fixed 3:4 card). Spacing must also
  // ride --fit-scale; Tailwind mt-* / space-y-* stay fixed and defeat the fit.
  const fitRef = useAutoFitScale<HTMLElement>([fingerprint], { min: 0.4, max: 1, step: 0.025 });

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
    <article
      ref={node => { nodeRef.current = node; fitRef.current = node; registerNode?.(node); }}
      className="aspect-[3/4] overflow-hidden border border-neutral-200 bg-[#fffefb] shadow-sm flex flex-col"
      style={{ containerType: 'inline-size', padding: 'calc(8% * var(--fit-scale, 1))' } as React.CSSProperties}
    >
      <div className="flex flex-shrink-0 items-center justify-between font-bold text-neutral-400" style={{ fontSize: 'clamp(9px, calc(2.4cqw * var(--fit-scale, 1)), 11px)' }}><span>P{page.page_no}</span><span>{page.page_type}</span></div>
      <h3 className="flex-shrink-0 font-black leading-tight" style={{ marginTop: 'calc(1.25rem * var(--fit-scale, 1))', fontSize: 'clamp(14px, calc(6.2cqw * var(--fit-scale, 1)), 38px)' }}>{page.page_title}</h3>
      <div className="h-px flex-shrink-0 bg-neutral-900" style={{ marginTop: 'calc(0.75rem * var(--fit-scale, 1))' }} />
      <p className="flex-shrink-0 font-semibold leading-relaxed text-neutral-700" style={{ marginTop: 'calc(1rem * var(--fit-scale, 1))', fontSize: 'clamp(10px, calc(4.05cqw * var(--fit-scale, 1)), 21px)' }}>{page.lead}</p>
      <ul className="flex-shrink-0 leading-relaxed text-neutral-800" style={{ marginTop: 'calc(1.25rem * var(--fit-scale, 1))', fontSize: 'clamp(10px, calc(4.05cqw * var(--fit-scale, 1)), 21px)' }}>{page.bullets.slice(0, 6).map((bullet, index) => <li className="grid grid-cols-[24px_1fr] gap-2" style={{ marginBottom: 'calc(0.75rem * var(--fit-scale, 1))' }} key={`${bullet}-${index}`}><span className="font-black text-red-600">{String(index + 1).padStart(2, '0')}</span><span>{bullet}</span></li>)}</ul>
    </article>
    <button className="mt-2 w-full border border-neutral-300 bg-white px-2 py-1.5 text-xs font-bold text-neutral-700 disabled:opacity-50" disabled={busy} onClick={handleExport}>{busy ? '导出中...' : '单独导出这张'}</button>
  </div>;
}
