import fs from 'node:fs';
import path from 'node:path';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';
import type { GeneratedInnerPage } from '@/types/reference-workflow';
import { semanticLayoutTypeFromAssetType } from '@/lib/v2/semantic-layout';

type AuditJob = {
  id: string;
  sourceMotherTopic: string;
  finalPublicTopic: string;
  pages: GeneratedInnerPage[];
};

type AuditData = AuditJob & { expandContentPlans?: Array<{ assetType?: string }> };

function loadData(): { jobs: AuditData[]; contentVersion?: string; editorialQaVersion?: string; frenchQaVersion?: string; renderSource?: string; frenchQaMergeValidation?: { assertions?: string } } {
  const file = path.join(process.cwd(), '.tmp-selected-p2-p6-french-qa.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ReturnType<typeof loadData>;
  const motherFile = path.join(process.cwd(), '.tmp-mother-topic-real-result.json');
  const mother = JSON.parse(fs.readFileSync(motherFile, 'utf8')) as { rows?: Array<{ id: string; expandContentPlans?: Array<{ assetType?: string }> }> };
  const plans = new Map((mother.rows || []).map(row => [row.id, row.expandContentPlans]));
  return { ...parsed, jobs: parsed.jobs.map(job => ({ ...job, expandContentPlans: plans.get(job.id) })) };
}

function renderPage(job: AuditData, page: GeneratedInnerPage): GeneratedInnerPage {
  if (page.semanticLayoutType) return page;
  // QA adapter only: the production pipeline will persist this field from the
  // execution plan. This keeps the renderer from inferring semantics from copy.
  const plan = job.expandContentPlans?.[Math.min(Math.max(page.page_no - 2, 0), 2)];
  const semanticLayoutType = plan?.assetType
    ? semanticLayoutTypeFromAssetType(plan.assetType)
    : page.page_type === 'steps' ? 'steps' : 'knowledge_list';
  return { ...page, semanticLayoutType };
}

export default function RenderQaPage() {
  const data = loadData();
  const sourceReady = data.renderSource === 'final_french_qa'
    && data.frenchQaMergeValidation?.assertions === 'PASS'
    && data.frenchQaVersion === 'final-french-qa-v2-id-merge';
  if (!sourceReady) return <main className="min-h-screen bg-[#e7e6e2] p-8"><div className="mx-auto max-w-[760px] border border-red-300 bg-red-50 p-6 text-red-900"><p className="text-xs font-black tracking-[0.12em]">RENDER QA STOPPED</p><h1 className="mt-2 text-xl font-black">渲染已停止：不是 FINAL_FRENCH_QA 数据</h1><p className="mt-3 text-sm">请先完成 French QA 的稳定 ID 合并和版本断言。</p></div></main>;
  const jobs = data.jobs;
  return (
    <main className="min-h-screen bg-[#e7e6e2] p-6 text-[#2f2f2f]">
      <header className="mx-auto mb-8 max-w-[1200px] rounded border border-[#d8d5cf] bg-[#f5f5f0] p-5">
        <p className="text-xs font-bold tracking-[0.12em] text-[#888]">P2–P6 REAL RENDER QA · 45 PAGES</p>
        <h1 className="mt-2 text-2xl font-black">冻结内容正式渲染检查</h1>
        <p className="mt-2 text-sm text-[#66635f]">仅加载最终法语 QA 数据，并复用生产内页渲染器；本页不调用模型。</p>
        <p className="mt-3 text-xs font-black text-[#A64B4B]">SOURCE = FINAL_FRENCH_QA · {data.frenchQaVersion}</p>
      </header>
      <div className="mx-auto space-y-10 max-w-[1200px]">
        {jobs.map(job => (
          <section key={job.id} data-job-id={job.id}>
            <div className="mb-3 rounded border border-[#d8d5cf] bg-[#f5f5f0] p-4">
              <p className="text-xs font-bold text-[#888]">{job.id}</p>
              <h2 className="mt-1 text-lg font-black">{job.finalPublicTopic}</h2>
              <p className="mt-1 text-xs text-[#66635f]">Mother：{job.sourceMotherTopic}</p>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {job.pages.map(page => (
                <div key={`${job.id}-${page.page_no}`} data-page-no={page.page_no}>
                  <InnerPageRenderer page={renderPage(job, page)} />
                  <p className="mt-2 text-center text-xs font-bold text-[#66635f]">{job.id} · P{page.page_no}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
