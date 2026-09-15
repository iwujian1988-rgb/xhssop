import fs from 'node:fs';
import path from 'node:path';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';
import { composeRepresentativePage } from '@/lib/v2/page-composition';
import type { GeneratedInnerPage } from '@/types/reference-workflow';

export const dynamic = 'force-dynamic';

type Job = { id: string; sourceMotherTopic: string; finalPublicTopic: string; pages: GeneratedInnerPage[]; expandContentPlans?: Array<{ assetType?: string }> };

function loadJobs(): { jobs: Job[]; frenchQaVersion?: string; renderSource?: string; assertions?: string } {
  const qa = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.tmp-selected-p2-p6-french-qa.json'), 'utf8')) as { jobs: Job[]; frenchQaVersion?: string; renderSource?: string; frenchQaMergeValidation?: { assertions?: string } };
  const mother = JSON.parse(fs.readFileSync(path.join(process.cwd(), '.tmp-mother-topic-real-result.json'), 'utf8')) as { rows?: Array<{ id: string; expandContentPlans?: Array<{ assetType?: string }> }> };
  const plans = new Map((mother.rows || []).map((row) => [row.id, row.expandContentPlans || []]));
  return { jobs: qa.jobs.map((job) => ({ ...job, expandContentPlans: plans.get(job.id) })), frenchQaVersion: qa.frenchQaVersion, renderSource: qa.renderSource, assertions: qa.frenchQaMergeValidation?.assertions };
}

const CASES = [
  { id: 'formal-letter', jobId: 'batch_resource_01_grammar_parchment_red_1', pageNo: 2, label: 'A · 正式信：称呼与落款' },
  { id: 'comparison', jobId: 'batch_resource_02_grammar_white_green_1', pageNo: 2, label: 'B · B1 vs B2' },
  { id: 'checklist', jobId: 'batch_resource_03_chalkboard_course_2', pageNo: 3, label: 'C · 语法自查' },
];

export default function RepresentativeRenderQaPage() {
  const data = loadJobs();
  const sourceReady = data.renderSource === 'final_french_qa' && data.assertions === 'PASS' && data.frenchQaVersion === 'final-french-qa-v2-id-merge';
  if (!sourceReady) return <main className="min-h-screen p-8 text-red-900">RENDER QA STOPPED: source is not FINAL_FRENCH_QA.</main>;
  const composed = CASES.map((item) => {
    const job = data.jobs.find((candidate) => candidate.id === item.jobId);
    const page = job?.pages.find((candidate) => candidate.page_no === item.pageNo);
    const assetType = job?.expandContentPlans?.[item.pageNo - 2]?.assetType || '';
    return { ...item, job, result: page ? composeRepresentativePage(page, assetType) : undefined };
  });
  return <main className="min-h-screen bg-[#e7e6e2] p-6 text-[#2f2f2f]">
    <header className="mx-auto mb-8 max-w-[1100px] border border-[#d8d5cf] bg-[#f5f5f0] p-5">
      <p className="text-xs font-black tracking-[0.12em] text-[#A64B4B]">SOURCE = FINAL_FRENCH_QA · {data.frenchQaVersion}</p>
      <h1 className="mt-2 text-2xl font-black">P2–P6 页面构成代表测试</h1>
      <p className="mt-2 text-sm text-[#66635f]">只验证三类页面；没有结构化 payload 的页面不进入假布局。</p>
    </header>
    <div className="mx-auto max-w-[1100px] space-y-8">
      {composed.map(({ id, label, job, result }) => <section key={id} data-case-id={id} className="border border-[#d8d5cf] bg-[#f5f5f0] p-5">
        <div className="mb-4"><p className="text-xs font-bold text-[#888]">{label}</p><h2 className="mt-1 text-lg font-black">{job?.finalPublicTopic}</h2><p className="text-xs text-[#66635f]">Mother：{job?.sourceMotherTopic}</p></div>
        {result ? <>
          <div className="mb-4 grid grid-cols-2 gap-2 text-xs"><div>originalAssetType：<b>{result.originalAssetType}</b></div><div>finalSemanticLayoutType：<b>{result.finalSemanticLayoutType}</b></div><div>layoutPayloadFit：<b>{result.layoutPayloadFit}</b></div><div>pageContentSufficiency：<b>{result.pageContentSufficiency}</b></div><div>verticalOccupancy：<b>{result.verticalOccupancy === null ? '待浏览器实测' : result.verticalOccupancy}</b></div><div>renderResult：<b>{result.layoutPayloadFit === 'PASS' ? 'SPECIAL_LAYOUT' : result.pageContentSufficiency !== 'insufficient' ? 'FALLBACK_KNOWLEDGE_LIST' : 'BLOCKED'}</b></div></div>
          {result.structuredRenderPayload ? <pre className="mb-4 max-h-64 overflow-auto whitespace-pre-wrap border border-[#e0ddd5] bg-white p-3 text-[11px]">{JSON.stringify(result.structuredRenderPayload, null, 2)}</pre> : <div className="mb-4 border border-[#A64B4B] bg-[#fff8f5] p-3 text-sm text-[#A64B4B]"><b>{result.failureReason}</b></div>}
          {result.pageContentSufficiency !== 'insufficient' ? <div className="mx-auto max-w-[390px]" data-render-result={result.layoutPayloadFit === 'PASS' ? 'rendered-special-layout' : 'rendered-fallback-knowledge-list'}><InnerPageRenderer page={result.page} /></div> : <div data-render-result="blocked" className="border-t border-[#d8d5cf] pt-3 text-xs text-[#66635f]">此页信息不足，暂不进入成品页。</div>}
        </> : <p>找不到代表页。</p>}
      </section>)}
    </div>
  </main>;
}
