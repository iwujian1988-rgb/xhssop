import fs from 'node:fs';
import path from 'node:path';

type Row = Record<string, any>;
const root = process.cwd();
const mother = JSON.parse(fs.readFileSync(path.join(root, '.tmp-mother-topic-real-result.json'), 'utf8')) as { rows: Row[] };
const cases = [
  { id: 'batch_resource_01_grammar_parchment_red_1', card: 'resource_01_grammar_parchment_red' },
  { id: 'batch_resource_02_grammar_white_green_1', card: 'resource_02_grammar_white_green' },
  { id: 'batch_resource_03_chalkboard_course_2', card: 'resource_03_chalkboard_course' },
];
const requestedCase = process.env.ONLY_CASE;
const selectedCases = requestedCase ? cases.filter(item => item.id === requestedCase) : cases;
const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:4100';
const output = path.join(root, 'new-pipeline-render-payload-validation.json');
const results: any[] = [];

function toLockedTopic(row: Row, id: string) {
  return {
    id: `fresh_${id}`,
    scope_level: 'broad',
    topic_type: 'search_pain',
    topic: row.motherTopic,
    audience: '准备 DELF B2 production écrite 的中文学习者',
    scene: row.scene || 'independent_study',
    pain: row.problemFamily || '不知道如何把内容写得具体',
    content_promise: row.specificAsset || row.finalPublicTopic,
    product_bridge: row.specificAsset || '',
    why_this_reference_fits: row.contentAngle || '把一篇可收藏的写作资料卡做成手机页面',
    novelty: `fresh-render-payload-${id}`,
    search_terms: ['DELF B2写作', '法语写作', row.finalPublicTopic].filter(Boolean),
    content_source_plan: { knowledge_base: '使用已锁定的DELF B2写作知识库事实', ai_original: '允许原创组织，但不改变写作语境' },
    dynamic_fact_terms: ['DELF B2写作'],
    title_trigger_types: ['资料价值', '明确结果'],
  };
}

for (const item of selectedCases) {
  const row = mother.rows.find(candidate => candidate.id === item.id);
  if (!row) throw new Error(`找不到锁定 Mother：${item.id}`);
  console.log(`[new-pipeline] start ${item.id}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/reference-studio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'compose', product_id: 'delf_b2_writing', reference_card_id: item.card, topic: toLockedTopic(row, item.id), direction: '新版正式链路验收：页面必须从源头同时生成pageCopy和renderPayload；不得新增输入中不存在的法语、事实、数字或规则。' }),
    signal: AbortSignal.timeout(20 * 60 * 1000),
    });
  } catch (error) {
    results.push({ id: item.id, status: 'OTHER_ERROR', error: error instanceof Error ? error.message : String(error) });
    fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
    console.log(`[new-pipeline] error ${item.id} ${results.at(-1).error}`);
    continue;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    results.push({ id: item.id, status: 'OTHER_ERROR', httpStatus: response.status, error: body.error || JSON.stringify(body).slice(0, 1200) });
    fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
    console.log(`[new-pipeline] error ${item.id} ${results.at(-1).error}`);
    continue;
  }
  const pages = body.draft?.inner_pages || body.artifacts?.compiledDraft?.data?.innerPages || body.artifacts?.content?.data?.innerPages || [];
  const contentPages = body.artifacts?.content?.data?.innerPages || [];
  const compiledPages = body.artifacts?.compiledDraft?.data?.innerPages || [];
  const payloadPages = pages.filter((page: Row) => page.renderPayloadStatus === 'VALID' && page.renderPayload);
  results.push({ id: item.id, status: 'PASS', finalPublicTopic: body.draft?.selected_title || row.finalPublicTopic, pages, payloadValid: payloadPages.length, totalPages: pages.length, contentPayloadValid: contentPages.filter((page: Row) => page.renderPayloadStatus === 'VALID' && page.renderPayload).length, compiledPayloadValid: compiledPages.filter((page: Row) => page.renderPayloadStatus === 'VALID' && page.renderPayload).length, usage: body.usage || {}, pipelineVersion: body.pipeline_version || 'v2' });
  fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2), 'utf8');
  console.log(`[new-pipeline] done ${item.id} payload=${payloadPages.length}/${pages.length}`);
}
console.log(JSON.stringify({ jobs: results.length, totalPages: results.reduce((sum, item) => sum + Number(item.totalPages || 0), 0), validPayloadPages: results.reduce((sum, item) => sum + Number(item.payloadValid || 0), 0), totalUsage: results.reduce((sum, item) => ({ prompt_tokens: sum.prompt_tokens + Number(item.usage?.prompt_tokens || 0), completion_tokens: sum.completion_tokens + Number(item.usage?.completion_tokens || 0), total_tokens: sum.total_tokens + Number(item.usage?.total_tokens || 0), calls: sum.calls + Number(item.usage?.calls || 0) }), { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0 }) }, null, 2));
