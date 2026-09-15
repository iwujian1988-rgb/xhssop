import fs from 'node:fs';
import path from 'node:path';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';
import type { GeneratedInnerPage } from '@/types/reference-workflow';

type Result = {
  id: string;
  status: string;
  finalPublicTopic?: string;
  pages?: GeneratedInnerPage[];
  payloadValid?: number;
  totalPages?: number;
  usage?: Record<string, number>;
  error?: string;
};

export default function NewPipelineRenderQaPage() {
  const file = path.join(process.cwd(), 'new-pipeline-render-payload-validation.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { results: Result[] };
  return (
    <main className="min-h-screen bg-[#ececeb] p-6 text-[#2F2F2F]">
      <header className="mx-auto mb-6 max-w-[1200px]">
        <p className="text-xs font-semibold tracking-[0.14em] text-[#888888]">SOURCE = NEW_V2_PIPELINE</p>
        <h1 className="mt-2 text-2xl font-bold">P2–P6 新链路真实渲染预览</h1>
        <p className="mt-2 text-sm text-[#66635F]">当前允许 renderPayload 不足时安全回退 knowledge_list；这里只查看真实返回页面的手机比例渲染。</p>
      </header>
      <div className="mx-auto max-w-[1200px] space-y-8">
        {data.results.map((result) => (
          <section key={result.id} className="border border-[#D8D5CF] bg-[#F5F5F0] p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <h2 className="font-bold">{result.id}</h2>
                <p className="mt-1 text-sm text-[#66635F]">{result.finalPublicTopic || result.error || result.status}</p>
              </div>
              <span className="text-xs text-[#888888]">pages={result.totalPages || result.pages?.length || 0} · payload={result.payloadValid || 0}</span>
            </div>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {(result.pages || []).map((page) => (
                <div key={`${result.id}-${page.page_no}`} className="mx-auto w-full max-w-[390px]">
                  <InnerPageRenderer page={page} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
