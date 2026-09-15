import fs from 'node:fs';
import path from 'node:path';
import ReferenceCoverRenderer from '@/components/templates/ReferenceCoverRenderer';
import type { CreativeCardRenderer, DenseDirectoryCoverPayload } from '@/types/reference-workflow';

type Regression = {
  newCoverBlocks: Array<{
    id: string;
    heading?: string;
    items: Array<{ primary: string; secondary?: string; note?: string }>;
    sourceIds?: string[];
  }>;
  titleBundles: Array<{ id?: string; slotId?: string; textTitle: string; coverTitle: string; coverSubtitle?: string }>;
};

const renderers: Array<{ renderer: CreativeCardRenderer; label: string }> = [
  { renderer: 'memo_offer', label: 'memo_offer · no dynamic kicker' },
  { renderer: 'parchment_dense_directory', label: 'parchment_dense_directory · directory' },
  { renderer: 'plain_experience', label: 'plain_experience · static EXAM NOTE only' },
];

export default function CoverTitleHierarchyQaPage() {
  const file = path.join(process.cwd(), '.tmp-cover-title-hierarchy-regression.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Regression;
  const bundle = data.titleBundles[0];
  if (!bundle) throw new Error('回归结果没有可渲染标题');
  const payload: DenseDirectoryCoverPayload = {
    kind: 'dense_directory',
    title: bundle.coverTitle,
    subtitle: bundle.coverSubtitle || '',
    sections: data.newCoverBlocks.map((block, index) => ({
      side_label: `0${index + 1}`,
      heading: block.heading || `分组${index + 1}`,
      columns: 2,
      items: block.items,
      source_type: 'mixed',
      source_ids: block.sourceIds || [],
    })),
  };
  return (
    <main className="min-h-screen bg-neutral-100 p-6 text-neutral-950">
      <header className="mx-auto mb-6 max-w-[1400px]">
        <p className="text-xs font-bold tracking-[0.12em] text-neutral-500">ISOLATED REGRESSION FIXTURE · NO SOURCE JOB MUTATION</p>
        <h1 className="mt-2 text-2xl font-black">Cover Title Hierarchy QA</h1>
        <p className="mt-2 text-sm text-neutral-600">同一组 H1 / Subtitle / H2 / Items，交给正式 ReferenceCoverRenderer 渲染。</p>
      </header>
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-8 lg:grid-cols-3">
        {renderers.map(({ renderer, label }) => (
          <section key={renderer} className="bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-bold">{label}</h2>
            <ReferenceCoverRenderer renderer={renderer} payload={payload} previewMode="code" />
          </section>
        ))}
      </div>
    </main>
  );
}
