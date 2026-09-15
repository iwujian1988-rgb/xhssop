import { loadBatch, loadJob, saveJob } from '../src/lib/batch-store';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { pickProductShowcasePlan } from '../src/lib/product-showcase-library';
import { compileDraft } from '../src/lib/v2/pipeline';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const batchId = process.argv[2];
if (!batchId) throw new Error('用法：recompile-content-root-fix-drafts.mts <batchId>');
const batch = await loadBatch(batchId);

for (const summary of batch.jobs) {
  const job = await loadJob(batchId, summary.id);
  const selectedTopic = job.artifacts?.selectedTopic;
  const content = job.artifacts?.content;
  const titles = job.artifacts?.titles;
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!job.draft || !selectedTopic || !content || !titles || !card) {
    process.stderr.write(`[recompile] SKIP ${job.id}: artifacts incomplete\n`);
    continue;
  }
  const facts = await loadProductFacts(job.product_id);
  const draft = compileDraft({
    productId: job.product_id,
    card,
    topic: selectedTopic.data,
    capability: getCapabilityFallback(card),
    content: content.data,
    titles: titles.data,
    evidence: job.draft.evidence,
    auditWarnings: content.warnings,
    prebuiltTags: job.draft.tags,
    endingShowcasePlan: pickProductShowcasePlan(job.product_id, facts, `content-root-recompile|${job.id}`),
  });
  await saveJob(batchId, { ...job, draft, current_stage: 'compiled' });
  process.stderr.write(`[recompile] PASS ${job.id} pages=${draft.inner_pages.length}\n`);
}
