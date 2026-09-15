import fs from 'node:fs';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, mergeAiUsage, type AiUsageSummary } from '../src/lib/ai-client';
import { semanticLayoutTypeFromAssetType } from '../src/lib/v2/semantic-layout';
import type { GeneratedInnerPage, StructuredRenderPayload } from '../src/types/reference-workflow';

type Plan = { assetType?: string; title?: string; concreteDeliverable?: string; mustContain?: string[]; exampleRequirement?: string; languageMaterialRequirement?: string; cardStructure?: string };
type Job = { id: string; pages: GeneratedInnerPage[]; expandContentPlans?: Plan[] };
type Source = { jobs: Job[]; [key: string]: unknown };
const root = process.cwd();
const dataFile = path.join(root, '.tmp-selected-p2-p6-french-qa.json');
const motherFile = path.join(root, '.tmp-mother-topic-real-result.json');
const traceFile = path.join(root, '.tmp-render-payload-representatives-trace.json');
if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(root, '.env.local'));
const ids = ['batch_resource_01_grammar_parchment_red_1', 'batch_resource_02_grammar_white_green_1', 'batch_resource_03_chalkboard_course_2'];
const allowed = new Set(['knowledge_list', 'comparison', 'checklist', 'expression_bank', 'mistake', 'before_after', 'timeline', 'steps', 'category_cards', 'dense_reference', 'example_breakdown']);
const schema = 'comparison:{left:{label,items:[{text,note}]},right:{label,items:[{text,note}]},dimensions:[],takeaway}; checklist:{items:[{check,criterion,actionIfFail,example}]}; expression_bank:{groups:[{label,context,items:[{fr,zh,note}]}]}; mistake:{cases:[{wrong,why,better,note}]}; before_after:{before,after,changes:[],takeaway}; timeline:{items:[{time,action,note}]}; steps:{steps:[{step,title,action,example}]}; category_cards:{categories:[{title,items:[]}]}; dense_reference/example_breakdown/knowledge_list:{items:[]}';
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const leaves = (value: unknown, result: string[] = []) => { if (typeof value === 'string' && value.trim()) result.push(value.trim()); else if (Array.isArray(value)) value.forEach(item => leaves(item, result)); else if (value && typeof value === 'object') Object.values(value).forEach(item => leaves(item, result)); return result; };
function grounded(payload: unknown, page: GeneratedInnerPage, plan: Plan) {
  const source = JSON.stringify({ title: page.page_title, lead: page.lead, bullets: page.bullets, plan }).replace(/\s+/g, '');
  const structural = new Set(['B1', 'B2', 'A', 'B', '检查项', '检查动作', 'comparison', 'checklist', 'expression_bank', 'mistake', 'before_after', 'timeline', 'steps', 'category_cards', 'dense_reference', 'example_breakdown', 'knowledge_list']);
  return leaves(payload).every(value => structural.has(value) || value.length < 2 || source.includes(value.replace(/\s+/g, '')));
}
async function runJob(job: Job) {
  const plans = job.expandContentPlans || [];
  const input = job.pages.map(page => ({ pageNo: page.page_no, pageTitle: page.page_title, lead: page.lead, bullets: page.bullets, originalLayoutType: semanticLayoutTypeFromAssetType(plans[page.page_no - 2]?.assetType), expandContentPlan: plans[page.page_no - 2] || null }));
  const result = await callOpenAICompatibleJsonWithUsage<{ pages?: Array<Record<string, unknown>> }>([
    { role: 'system', content: `你只做 STRUCTURED RENDER PAYLOAD MATERIALIZATION，不是内容创作。只能把输入已存在的文本映射到结构字段，禁止新增任何法语、知识、数字、事实、规则、观点或示例。无法安全映射就返回 INSUFFICIENT_STRUCTURED_CONTENT 并退回 knowledge_list。每个页面保留pageNo。允许结构：${schema}。Return valid json only，不能输出markdown。只返回 {"pages":[{"pageNo":2,"semanticLayoutType":"...","renderPayload":{},"renderPayloadStatus":"VALID|INSUFFICIENT_STRUCTURED_CONTENT","layoutChangeReason":""}]}` },
    { role: 'user', content: JSON.stringify({ jobId: job.id, pages: input }) },
  ], { maxTokens: 5000, temperature: 0.1, retries: 2, thinking: false });
  const returned = Array.isArray(result.data.pages) ? result.data.pages : [];
  const pages = job.pages.map((page, index) => {
    const raw = returned.find(item => Number(item.pageNo) === page.page_no) || returned[index] || {};
    const plan = plans[page.page_no - 2] || {};
    const original = semanticLayoutTypeFromAssetType(plan.assetType);
    const candidate = String(raw.semanticLayoutType || original) as GeneratedInnerPage['semanticLayoutType'];
    const payload = raw.renderPayload && typeof raw.renderPayload === 'object' ? { ...(raw.renderPayload as object), semanticLayoutType: candidate } as StructuredRenderPayload : undefined;
    const valid = allowed.has(candidate || '') && String(raw.renderPayloadStatus || '').toUpperCase() === 'VALID' && !!payload && grounded(payload, page, plan);
    const finalLayout: GeneratedInnerPage['semanticLayoutType'] = valid && candidate ? candidate : 'knowledge_list';
    return { ...page, originalLayoutType: original, finalLayoutType: finalLayout, semanticLayoutType: finalLayout, renderPayload: valid ? payload : undefined, renderPayloadStatus: (valid ? 'VALID' : 'INSUFFICIENT_STRUCTURED_CONTENT') as GeneratedInnerPage['renderPayloadStatus'], layoutChangeReason: valid ? clean(raw.layoutChangeReason) || undefined : '无法证明结构化字段来自最终页面内容，安全回退 knowledge_list' };
  });
  return { jobId: job.id, pages, usage: result.usage };
}
const source = JSON.parse(fs.readFileSync(dataFile, 'utf8')) as Source;
const mother = JSON.parse(fs.readFileSync(motherFile, 'utf8')) as { rows?: Array<{ id: string; expandContentPlans?: Plan[] }> };
const planMap = new Map((mother.rows || []).map(row => [row.id, row.expandContentPlans || []]));
const targetJobs = ids.map(id => source.jobs.find(job => job.id === id)).filter((job): job is Job => !!job).map(job => ({ ...job, expandContentPlans: planMap.get(job.id) || [] }));
const traces: Array<{ jobId: string; pages: GeneratedInnerPage[]; usage: AiUsageSummary }> = [];
let totalUsage = emptyAiUsage();
for (const job of targetJobs) {
  const result = await runJob(job);
  traces.push(result);
  totalUsage = mergeAiUsage(totalUsage, result.usage);
  const updated = { ...source, jobs: source.jobs.map(item => item.id === job.id ? { ...item, pages: result.pages } : item) };
  fs.writeFileSync(dataFile, JSON.stringify(updated, null, 2), 'utf8');
  fs.writeFileSync(traceFile, JSON.stringify({ generatedAt: new Date().toISOString(), traces, totalUsage }, null, 2), 'utf8');
  console.log(`[REPRESENTATIVE_BACKFILL] ${job.id} valid=${result.pages.filter(page => page.renderPayloadStatus === 'VALID').length}/${result.pages.length}`);
}
console.log(JSON.stringify({ jobs: traces.length, totalUsage }, null, 2));
