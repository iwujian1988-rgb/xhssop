import fs from 'node:fs';
import path from 'node:path';

type Sample = { id:string; exam:string; topic:string; publishTitle:string; coverTitle:string; posterTitle:string[]; template:string; templateName:string; png:string; width:number; height:number; overflowCheck:string; pngCheck:string; font:string };
type SmokeItem = { id:string; exam:string; topic:string; publishTitle:string; coverTitle:string; posterTitle:string[]; referenceImage:string; taskId:string; imageUrl:string; requestHash?:string };

function readSmokeEvidence(): { item?: SmokeItem; prompt?: string; response?: Record<string, unknown>; requestHash?: string } {
  try {
    const manifestPath = path.join(process.cwd(), 'artifacts', 'content-note-dazibao-img2img-smoke-20260914', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { items?: SmokeItem[] };
    const item = manifest.items?.[0];
    if (!item) return {};
    const auditPath = path.join(process.cwd(), 'data', 'image-submit-audit', '2026-09-14.jsonl');
    const events = fs.readFileSync(auditPath, 'utf8').split(/\r?\n/u).filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>);
    const response = [...events].reverse().find(event => event.type === 'submit_response' && event.taskId === undefined && (event.requestHash === item.requestHash || event.response && (event.response as Record<string, unknown>).rawBody?.toString().includes(item.taskId)));
    const request = [...events].reverse().find(event => event.type === 'submit_start' && event.requestHash === (item.requestHash || response?.requestHash));
    const requestBody = request?.requestBody as { prompt?: string } | undefined;
    return { item, prompt: requestBody?.prompt, response: response?.response as Record<string, unknown> | undefined, requestHash: item.requestHash || (request?.requestHash as string | undefined) };
  } catch {
    return {};
  }
}

export default function CoverReviewPage() {
  const file = path.join(process.cwd(), 'public', 'cover-review', 'manifest.json');
  const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as { items:Sample[]; width:number; height:number } : { items:[], width:1080, height:1440 };
  const smoke = readSmokeEvidence();
  return <main className="min-h-screen bg-[#f4f1eb] px-4 py-8 text-[#171717] sm:px-8">
    <header className="mx-auto mb-8 max-w-[1500px]"><p className="text-xs font-black tracking-[.18em] text-neutral-500">CONTENT NOTE · DAZIBAO TEMPLATE ADAPTATION</p><h1 className="mt-2 text-3xl font-black">大字报 Cover 真实 PNG 样张</h1><p className="mt-2 text-sm text-neutral-600">真实 TCF / DELF Topic → 正式 Title → posterTitle → 两套固定大字模板。{data.items.length} 张 · {data.width}×{data.height} · 3:4</p></header>
    {smoke.item ? <section className="mx-auto mb-8 max-w-[1500px] rounded-3xl border border-neutral-300 bg-white p-4 shadow-sm sm:p-6"><div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-black tracking-[.16em] text-fuchsia-700">REAL IMG2IMG EVIDENCE · SAMPLE_01</p><h2 className="mt-1 text-2xl font-black">真实生成样本核对</h2></div><span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">不重新提交 · 已完成</span></div><div className="grid grid-cols-1 gap-5 lg:grid-cols-[180px_minmax(0,1fr)_minmax(260px,360px)]"><div><p className="mb-2 text-xs font-black text-neutral-500">1 · 原始参考图</p><img src={smoke.item.referenceImage} alt="原始参考图" className="w-full rounded-xl border border-neutral-200 object-cover" /><p className="mt-2 break-all text-[10px] text-neutral-500">{smoke.item.referenceImage}</p></div><div><p className="mb-2 text-xs font-black text-neutral-500">2 · 裁剪后的参考图展示</p><div className="aspect-[3/4] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100"><img src={smoke.item.referenceImage} alt="裁剪后的参考图" className="h-full w-full scale-[1.08] object-cover object-center" /></div><p className="mt-2 text-[10px] text-neutral-500">前台仅裁掉边缘黑线/边框，未修改原始素材。</p></div><div className="min-w-0"><p className="mb-2 text-xs font-black text-neutral-500">3 · 输入证据</p><dl className="space-y-2 text-xs leading-5"><div><dt className="font-black text-neutral-500">Topic</dt><dd>{smoke.item.topic}</dd></div><div><dt className="font-black text-neutral-500">publishTitle</dt><dd>{smoke.item.publishTitle}</dd></div><div><dt className="font-black text-neutral-500">posterTitle</dt><dd>{smoke.item.posterTitle.join(' / ')}</dd></div><div><dt className="font-black text-neutral-500">task_id</dt><dd className="break-all font-mono text-[10px]">{smoke.item.taskId}</dd></div><div><dt className="font-black text-neutral-500">request hash</dt><dd className="break-all font-mono text-[10px]">{smoke.requestHash || '—'}</dd></div></dl></div><div className="min-w-0 lg:col-span-2"><p className="mb-2 text-xs font-black text-neutral-500">4 · 实际发送给 zexapi 的最终 prompt</p><pre className="max-h-[440px] overflow-auto whitespace-pre-wrap rounded-xl bg-neutral-950 p-4 text-[11px] leading-5 text-neutral-100">{smoke.prompt || '未找到对应审计 prompt'}</pre></div><div><p className="mb-2 text-xs font-black text-neutral-500">5 · 最终生成 PNG</p><img src={`/artifacts/content-note-dazibao-img2img-smoke-20260914/${smoke.item.id}.png`} alt="最终生成 PNG" className="w-full rounded-xl border border-neutral-200 bg-neutral-100" /><p className="mt-2 text-[10px] text-emerald-700">864×1152 · 3:4 · task 已完成</p></div></div></section> : null}
    <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">{data.items.map(item => <article key={`${item.id}-${item.template}`} className="overflow-hidden rounded-2xl bg-white p-3 shadow-sm"><div className="mb-3 flex items-center justify-between text-xs font-bold text-neutral-500"><span>Template {item.template} · {item.templateName}</span><span>{item.exam} · {item.id}</span></div><img src={item.png} alt={item.posterTitle.join(' / ')} className="block w-full rounded-xl bg-neutral-100" /><div className="px-1 pb-1 pt-3"><p className="text-lg font-black leading-tight">{item.posterTitle.map((line,index)=><span key={index} className="mr-1 inline-block">{line}</span>)}</p><p className="mt-2 text-xs font-bold text-neutral-500">发布标题：{item.publishTitle}</p><p className="mt-1 text-xs leading-5 text-neutral-500">Topic：{item.topic}</p><p className="mt-2 text-[11px] font-bold text-emerald-700">尺寸 {item.width}×{item.height} · 溢出检查 {item.overflowCheck}</p></div></article>)}</div>
  </main>;
}
