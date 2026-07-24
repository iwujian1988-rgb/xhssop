'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import type { ProductId } from '@/types/data';
import type { GeneratedInnerPage, MigratedTopic, ReferenceDrivenDraft } from '@/types/reference-workflow';

type Phase = 'loading_topics' | 'loading_draft' | 'done' | 'error';

export default function QaCardPage() {
  const params = useParams<{ cardId: string }>();
  const searchParams = useSearchParams();
  const cardId = params.cardId;
  const productId = (searchParams.get('product') as ProductId) || 'delf_b2_writing';
  const card = getCompetitorCreativeCard(cardId);
  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;

  const [phase, setPhase] = useState<Phase>('loading_topics');
  const [error, setError] = useState('');
  const [topic, setTopic] = useState<MigratedTopic | null>(null);
  const [draft, setDraft] = useState<ReferenceDrivenDraft | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !card) return;
    started.current = true;
    run();

    async function run() {
      try {
        setPhase('loading_topics');
        const topicsResponse = await fetch('/api/reference-studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'topics', product_id: productId, reference_card_id: cardId, direction: '' }),
        });
        const topicsJson = await topicsResponse.json();
        if (!topicsResponse.ok) throw new Error(topicsJson.error || '选题生成失败');
        const firstTopic = (topicsJson.topics as MigratedTopic[])[0];
        setTopic(firstTopic);

        setPhase('loading_draft');
        const draftResponse = await fetch('/api/reference-studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'compose', product_id: productId, reference_card_id: cardId, topic: firstTopic }),
        });
        const draftJson = await draftResponse.json();
        if (!draftResponse.ok) throw new Error(draftJson.error || '笔记生成失败');
        setDraft(draftJson.draft as ReferenceDrivenDraft);
        setPhase('done');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '生成失败');
        setPhase('error');
      }
    }
  }, [card, cardId, productId]);

  if (!card) return <main className="p-8 text-sm font-bold text-red-700">找不到参考卡：{cardId}</main>;

  return (
    <main className="min-h-screen bg-[#f4f5f6] p-6 text-neutral-950" data-qa-status={phase}>
      <div className="mx-auto max-w-[1400px] space-y-5">
        <header className="border border-neutral-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-black">{card.name}</h1>
              <p className="mt-1 text-xs text-neutral-500">renderer: {card.renderer_id} · mode: {spec?.renderMode} · id: {card.id}</p>
            </div>
            <span className={`px-2 py-1 text-xs font-black ${phase === 'done' ? 'bg-green-100 text-green-700' : phase === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{phase}</span>
          </div>
        </header>

        {error ? <div className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

        {topic ? (
          <section className="border border-neutral-200 bg-white p-4 text-sm leading-relaxed">
            <div className="font-black">选题</div>
            <div className="mt-2"><b>{topic.topic}</b></div>
            <div className="mt-1 text-neutral-600">人群：{topic.audience} · 痛点：{topic.pain}</div>
          </section>
        ) : null}

        {draft ? (
          <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
            <div className="border border-neutral-200 bg-white p-4">
              <div className="mb-3 text-sm font-black">封面成品</div>
              <ReferenceCoverRenderer renderer={card.renderer_id} payload={draft.cover} referenceImage={card.reference_image} />
            </div>
            <div className="space-y-4">
              <section className="border border-neutral-200 bg-white p-4 text-sm">
                <div className="font-black">标题</div>
                <div className="mt-2 font-bold">笔记标题：{draft.selected_title}</div>
                <div className="mt-1 text-neutral-600">封面标题：{draft.cover.title}</div>
                <div className="mt-1 text-neutral-600">副标题：{draft.cover.subtitle}</div>
                <div className="mt-1 text-xs text-neutral-500">封面条目数：{draft.cover.sections.reduce((sum, s) => sum + s.items.length, 0)} · 分组数：{draft.cover.sections.length}</div>
              </section>
              <section className="border border-neutral-200 bg-white p-4 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-black">自动检查</div>
                  <span className={`px-2 py-1 text-xs font-black ${draft.checks.issues.length ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{draft.checks.issues.length ? '需要调整' : '通过'}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="font-black">法语/事实审校</div>
                  <span className={`px-2 py-1 text-xs font-black ${draft.accuracy_audit.approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>{draft.accuracy_audit.approved ? '通过' : '未通过'} · 修正{draft.accuracy_audit.corrected_count}处</span>
                </div>
                {draft.accuracy_audit.issues.length ? <ul className="mt-2 space-y-1 text-xs text-amber-900">{draft.accuracy_audit.issues.map(issue => <li key={issue}>· {issue}</li>)}</ul> : null}
              </section>
              <section className="border border-neutral-200 bg-white p-4 text-sm">
                <div className="flex items-center justify-between"><div className="font-black">正文</div><span className="text-xs text-neutral-500">{draft.caption.length} 字</span></div>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6">{draft.caption}</pre>
                <div className="mt-3 text-sm font-semibold text-red-700">{draft.tags.join(' ')}</div>
              </section>
              <section className="border border-neutral-200 bg-white p-4">
                <div className="text-sm font-black">内页（{draft.inner_pages.length}）</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">{draft.inner_pages.map(page => <InnerPageCard page={page} key={page.page_no} />)}</div>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function InnerPageCard({ page }: { page: GeneratedInnerPage }) {
  return <div className="border border-neutral-200 p-3 text-xs leading-relaxed">
    <div className="flex justify-between font-bold"><span>P{page.page_no}</span><span className="text-neutral-400">{page.page_type}</span></div>
    <div className="mt-1 font-black">{page.page_title}</div>
    <p className="mt-1 text-neutral-600">{page.lead}</p>
    <ul className="mt-2 space-y-1">{page.bullets.map((bullet, index) => <li key={index}>{index + 1}. {bullet}</li>)}</ul>
  </div>;
}
