'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { competitorCreativeCards } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { DraftReview } from '@/components/draft/DraftReview';
import type { ProductId } from '@/types/data';
import type { CompetitorCreativeCard, MigratedTopic, ReferenceDrivenDraft } from '@/types/reference-workflow';

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
