'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { DraftReview } from '@/components/draft/DraftReview';
import { competitorCreativeCards, getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import type { ProductId } from '@/types/data';
import type { CompetitorCreativeCard } from '@/types/reference-workflow';
import type { Batch, BatchJob } from '@/lib/batch-store';
import type { AiUsageSummary } from '@/lib/ai-client';

const supportedCards = competitorCreativeCards.filter(card => card.supported);

type PlanResponse = { batch: Batch; usage: AiUsageSummary };
type BatchQueryResponse = { batch: Batch; jobs: BatchJob[]; active_runner: string | null };

export default function BatchPage() {
  const [productId, setProductId] = useState<ProductId>('delf_b2_writing');
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(() => initialCardSelection());
  const [direction, setDirection] = useState('');
  const [topicsPerCard, setTopicsPerCard] = useState(2);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [planUsage, setPlanUsage] = useState<AiUsageSummary | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [activeRunner, setActiveRunner] = useState<string | null>(null);
  const [tab, setTab] = useState<'success' | 'failed'>('success');
  const [expandedJobIds, setExpandedJobIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    const batchDone = batch.status === 'done' && !activeRunner;
    if (batchDone) return;
    pollRef.current = setTimeout(() => {
      fetchBatchState(batch.id).catch(console.error);
    }, 5000);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [batch, activeRunner, fetchBatchState]);

  async function handlePlan() {
    setPlanning(true);
    setPlanError('');
    setPlanUsage(null);
    setBatch(null);
    setJobs([]);
    setActiveRunner(null);
    setExpandedJobIds(new Set());
    try {
      const cardIds = supportedCards.filter(c => selectedCardIds.has(c.id)).map(c => c.id);
      if (!cardIds.length) {
        setPlanError('请至少选择一个模板');
        return;
      }
      const response = await fetch('/api/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'plan',
          product_id: productId,
          card_ids: cardIds,
          direction,
          topics_per_card: topicsPerCard,
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
  const runningJob = planJobs.find(job => job.status === 'running');
  const summary = summarize(planJobs);
  const totalUsage = useMemo(() => aggregateUsage(planJobs), [planJobs]);

  return (
    <main className="min-h-screen bg-[#f4f5f6] text-neutral-950">
      <header className="border-b border-neutral-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-[1500px] items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-black">批量生成工作台</h1>
            <p className="mt-1 text-sm text-neutral-500">选题池 × 模板矩阵 → 批量生成 → 成品池 / 尸体池</p>
          </div>
          <div className="flex gap-4 text-sm font-bold underline">
            <Link href="/">单篇工作台</Link>
            <Link href="/template-matrix">模板总览</Link>
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
            direction={direction}
            setDirection={setDirection}
            topicsPerCard={topicsPerCard}
            setTopicsPerCard={setTopicsPerCard}
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

            {batch.status === 'planned' ? (
              <section className="border border-neutral-200 bg-white p-5">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="font-black">计划确认（{planJobs.length} 个 job）</h2>
                    <p className="mt-1 text-sm text-neutral-500">可单独移除；移除后 run 时不会跑（仍占用磁盘，但不参与本次执行）。</p>
                  </div>
                  <div className="flex gap-2">
                    <button className="border border-neutral-300 bg-white px-4 py-2 text-sm font-bold" onClick={() => setBatch(null)}>放弃计划</button>
                    <button className="bg-neutral-950 px-4 py-2 text-sm font-bold text-white disabled:bg-neutral-400" disabled={!planJobs.length} onClick={handleRun}>开始运行</button>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {planJobs.map(job => (
                    <div key={job.id} className="flex items-start justify-between gap-3 border border-neutral-200 p-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-bold">{cardName(job.reference_card_id)}</div>
                        <div className="mt-1 text-xs text-neutral-500">{job.topic.topic}</div>
                      </div>
                      <button className="text-xs text-red-600 underline" onClick={() => handleDeleteJob(job.id)}>移除</button>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {batch.status !== 'planned' ? (
              <>
                <section className="border border-neutral-200 bg-white p-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 className="font-black">进度</h2>
                      <p className="mt-1 text-sm text-neutral-500">
                        完成 {summary.success + summary.failed} / {summary.total}
                        {summary.pending ? ` · 待跑 ${summary.pending}` : ''}
                        {runningJob ? ` · 正在跑 ${runningJob.reference_card_id}` : ''}
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
                  <TabButton active={tab === 'success'} onClick={() => setTab('success')}>成品池（{successJobs.length}）</TabButton>
                  <TabButton active={tab === 'failed'} onClick={() => setTab('failed')}>尸体池（{failedJobs.length}）</TabButton>
                </div>

                {tab === 'success' ? (
                  <section className="space-y-3">
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
                              <div className="mt-1 font-bold">{card.name}</div>
                              <div className="mt-1 text-sm text-neutral-600">{job.topic.topic}</div>
                            </div>
                            <button className="border border-neutral-300 bg-white px-3 py-1.5 text-xs font-bold" onClick={() => toggleExpand(job.id)}>{expanded ? '收起' : '展开预览'}</button>
                          </div>
                          {expanded ? <div className="mt-4 border-t border-neutral-200 pt-4"><DraftReview draft={job.draft} card={card} presetCoverImageUrl={job.cover_image_url} /></div> : null}
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
    </main>
  );
}

function PlanForm({
  productId,
  setProductId,
  selectedCardIds,
  toggleCard,
  direction,
  setDirection,
  topicsPerCard,
  setTopicsPerCard,
  planning,
  onPlan,
}: {
  productId: ProductId;
  setProductId: (value: ProductId) => void;
  selectedCardIds: Set<string>;
  toggleCard: (id: string) => void;
  direction: string;
  setDirection: (value: string) => void;
  topicsPerCard: number;
  setTopicsPerCard: (value: number) => void;
  planning: boolean;
  onPlan: () => void;
}) {
  return (
    <section className="border border-neutral-200 bg-white p-5">
      <h2 className="font-black">发起批量</h2>
      <p className="mt-1 text-sm text-neutral-500">勾选模板后生成批量计划。选题串行生成（每张卡 1 次 LLM 调用），约 30-60 秒/卡。</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_3fr]">
        <div>
          <label className="block text-xs font-bold text-neutral-500">商品</label>
          <select className="field mt-1" value={productId} onChange={event => setProductId(event.target.value as ProductId)}>
            <option value="delf_b2_writing">商品1：DELF B2写作资料库</option>
            <option value="tef_tcf_canada">商品2：TEF/TCF Canada资料库</option>
          </select>
          <label className="mt-4 block text-xs font-bold text-neutral-500">每卡选题数</label>
          <input type="number" min={1} max={3} className="field mt-1" value={topicsPerCard} onChange={event => setTopicsPerCard(Number(event.target.value) || 2)} />
          <label className="mt-4 block text-xs font-bold text-neutral-500">可选方向</label>
          <textarea className="field mt-1 min-h-20 resize-y" placeholder="例如：更偏考前急救；留空让AI判断" value={direction} onChange={event => setDirection(event.target.value)} />
          <button className="mt-4 w-full bg-neutral-950 px-4 py-2.5 text-sm font-bold text-white disabled:bg-neutral-400" disabled={planning} onClick={onPlan}>
            {planning ? '正在串行生成选题...' : '生成批量计划'}
          </button>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-neutral-500">模板（{selectedCardIds.size}/{supportedCards.length}）</label>
            <div className="flex gap-2 text-xs">
              <button className="underline" onClick={() => toggleAll(true)}>全选</button>
              <button className="underline" onClick={() => toggleAll(false)}>全不选</button>
              <button className="underline" onClick={() => selectByMode('code')}>只选 code/hybrid</button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {supportedCards.map(card => (
              <CardCheckbox key={card.id} card={card} checked={selectedCardIds.has(card.id)} onToggle={() => toggleCard(card.id)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );

  function toggleAll(value: boolean) {
    supportedCards.forEach(card => {
      const inSet = selectedCardIds.has(card.id);
      if (value && !inSet) toggleCard(card.id);
      if (!value && inSet) toggleCard(card.id);
    });
  }

  function selectByMode(mode: 'code') {
    supportedCards.forEach(card => {
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
