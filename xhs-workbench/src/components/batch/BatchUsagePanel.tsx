'use client';

import { useEffect, useState } from 'react';
import type { AiUsageSummary } from '@/lib/ai-client';
import { DEFAULT_MODEL_RATES, estimateTokenCost, summarizeTokenUsage } from '@/lib/token-usage';

type Rates = Record<string, { input: string; output: string; cached?: string }>;
const storageKey = 'batch-model-rates-cny-v1';

export function BatchUsagePanel({ values, missingPlanning }: { values: Array<AiUsageSummary | undefined>; missingPlanning: boolean }) {
  const [rates, setRates] = useState<Rates>(DEFAULT_MODEL_RATES);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) setRates({ ...DEFAULT_MODEL_RATES, ...saved });
    } catch { setStorageError(true); }
  }, []);
  const usage = summarizeTokenUsage(values);
  const rows = Object.entries(usage.by_model);
  const knownTotal = rows.reduce((s, [, row]) => s + row.total_tokens, 0);
  const knownCalls = rows.reduce((s, [, row]) => s + row.calls, 0);
  const legacy = knownTotal < usage.total_tokens || knownCalls < usage.calls;
  const costs = rows.map(([model, row]) => estimateTokenCost(row, String(rates[model]?.input ?? ''), String(rates[model]?.output ?? ''), String(rates[model]?.cached ?? '')));
  const priced = costs.filter((v): v is number => v !== null);
  const incomplete = legacy || missingPlanning || costs.some(v => v === null) || rows.some(([, row]) => row.unreported_calls > 0);
  function changeRate(model: string, field: 'input' | 'output' | 'cached', value: string) {
    const next = { ...rates, [model]: { input: rates[model]?.input || '', output: rates[model]?.output || '', cached: rates[model]?.cached || '', [field]: value } };
    setRates(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
  }
  return <section className="border border-neutral-200 bg-white p-5 text-sm" aria-label="批次模型用量与费用">
    <h2 className="font-black">本批用量与成本估价</h2>
    <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
      <span>总 Token <strong>{usage.total_tokens.toLocaleString()}</strong></span>
      <span>输入 {usage.prompt_tokens.toLocaleString()}</span><span>输出 {usage.completion_tokens.toLocaleString()}</span>
      <span>{usage.calls} 次文本调用</span>
      <span>{incomplete ? '已知部分估价' : '文本估价'}：<strong>{priced.length ? `¥${priced.reduce((a, b) => a + b, 0).toFixed(4)}` : '待设置单价'}</strong></span>
    </div>
    <details className="mt-3">
      <summary className="cursor-pointer font-semibold">分模型明细 / 设置估算单价</summary>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
        <thead><tr>{['模型', '输入 Token', '输出 Token', '总 Token', '调用', '输入单价', '输出单价', '估价（元）'].map(h => <th className="p-2 whitespace-nowrap" key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(([model, row], i) => <tr className="border-t" key={model}>
          <td className="p-2">{model}{row.unreported_calls > 0 && <div className="text-amber-700">{row.unreported_calls} 次未返回用量</div>}<div>已记录缓存命中：{row.cache_reported_calls ? (row.cached_tokens || 0).toLocaleString() : '未记录'}{(row.cache_reported_calls || 0) < row.calls && '（缓存记录不完整）'}</div><label>缓存输入单价 <input aria-label={`${model} 缓存输入单价，元每百万Token`} className="w-24 border p-1" type="number" min="0" step="any" placeholder="控制台价格" value={rates[model]?.cached ?? ''} onChange={e => changeRate(model, 'cached', e.target.value)} /></label></td>
          <td className="p-2">{row.prompt_tokens.toLocaleString()}</td><td className="p-2">{row.completion_tokens.toLocaleString()}</td><td className="p-2">{row.total_tokens.toLocaleString()}</td><td className="p-2">{row.calls}</td>
          {(['input', 'output'] as const).map(field => <td className="p-2" key={field}><input aria-label={`${model} ${field === 'input' ? '输入' : '输出'}单价，元每百万Token`} className="w-24 border p-2" type="number" min="0" step="any" placeholder="待填写" value={rates[model]?.[field] ?? ''} onChange={e => changeRate(model, field, e.target.value)} /></td>)}
          <td className="p-2">{costs[i] === null ? '未配置' : costs[i]!.toFixed(4)}</td>
        </tr>)}
        {legacy && <tr className="border-t"><td className="p-2" colSpan={8}>历史未记录模型：{Math.max(0, usage.total_tokens - knownTotal).toLocaleString()} Token / {Math.max(0, usage.calls - knownCalls)} 次调用，不能准确拆分或估价。</td></tr>}
        {!rows.length && !legacy && <tr><td className="p-2" colSpan={8}>暂无分模型记录。</td></tr>}
        </tbody></table></div>
      <p className="mt-3 text-xs text-neutral-500">已预填阿里云北京区标准价（元 / 百万Token），可手动覆盖。<a className="underline" href="https://help.aliyun.com/zh/model-studio/deepseek-v4-flash" target="_blank" rel="noreferrer">DeepSeek V4 Flash官方价格</a>。估价不扣免费额度、不含图片费用。本系统批量任务不是阿里云Batch API，不享自动半价。</p>
      <p className="mt-2 text-xs text-neutral-500">缓存命中属于输入Token的一部分，不重复计费。Qwen3.8缓存单价需查控制台；未填单价或历史未记录缓存时，按标准输入价估算，不推定缓存未命中。填入缓存单价后，仅对已记录命中量计折扣，以实际账单为准。</p>
      {storageError && <p className="text-amber-700">浏览器无法保存单价，本次修改仍可用于估算。</p>}
    </details>
    {missingPlanning && <p className="mt-2 text-xs text-amber-700">旧批次未保存选题用量，以上为已记录部分；新批次包含选题阶段。</p>}
    {incomplete && <p className="mt-2 text-xs text-neutral-500">存在缺失记录或未配置价格，不能作为完整账单。运行中用量在节点保存后更新。</p>}
  </section>;
}
