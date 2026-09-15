import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  listDelfB2InnerEvidenceCards,
  matchDelfB2InnerEvidenceCards,
} from '../src/lib/v2/evidence-card-matcher';
import type { UserVisiblePagePlan } from '../src/lib/v2/contracts';

const root = process.cwd();

async function historicalPlan(jobId: '001' | '005' | '009') {
  const file = path.join(root, 'data', 'inner-pro-historical-20260910', jobId, 'historical-request.json');
  const request = JSON.parse(await readFile(file, 'utf8')) as { messages: Array<{ role: string; content: string }> };
  const user = request.messages.find(message => message.role === 'user');
  assert(user, `${jobId}: missing historical user payload`);
  const payload = JSON.parse(user.content) as { canonical_page_plan: UserVisiblePagePlan[] };
  return payload.canonical_page_plan;
}

function idsForPage(matches: ReturnType<typeof matchDelfB2InnerEvidenceCards>, pageId: string) {
  return matches.filter(match => match.applicablePageIds.includes(pageId)).map(match => match.id);
}

const cards = listDelfB2InnerEvidenceCards();
assert(cards.length >= 20 && cards.length <= 25, `V1 card count out of range: ${cards.length}`);
assert.equal(new Set(cards.map(card => card.id)).size, cards.length, 'card ids must be unique');
for (const card of cards) {
  assert(card.fact.trim(), `${card.id}: fact missing`);
  assert(card.boundary.trim(), `${card.id}: boundary missing`);
  assert(card.exactTriggers.length || card.triggerGroups.length, `${card.id}: activating triggers missing`);
  assert(/^https:\/\//.test(card.source.url), `${card.id}: source URL missing`);
  assert(card.source.verifiedBasis?.trim(), `${card.id}: verified basis missing`);
}

const plans = {
  '001': await historicalPlan('001'),
  '005': await historicalPlan('005'),
  '009': await historicalPlan('009'),
};
const matches = {
  '001': matchDelfB2InnerEvidenceCards(plans['001']),
  '005': matchDelfB2InnerEvidenceCards(plans['005']),
  '009': matchDelfB2InnerEvidenceCards(plans['009']),
};

assert(idsForPage(matches['001'], 'p1').includes('PRONOUN-JE-TASK-DEPENDENT-01'), '001/p1 must receive je boundary');
assert(idsForPage(matches['001'], 'p1').includes('REGISTER-AUDIENCE-PURPOSE-01'), '001/p1 must receive register boundary');

const page005p5 = idsForPage(matches['005'], 'p5');
assert(page005p5.includes('GRAMMAR-MOOD-FORM-01'), '005/p5 must receive mood/form boundary');
assert(page005p5.includes('PRAGMATICS-NOT-GRAMMAR-01'), '005/p5 must receive pragmatics boundary');
assert(!page005p5.includes('GRAMMAR-SE-PERMETTRE-01'), '005/p5 must not guess an unplanned Je me permets example');
assert(!page005p5.includes('GRAMMAR-DEVOIR-INDICATIVE-01'), '005/p5 must not guess an unplanned Vous devez example');

const page009p5 = idsForPage(matches['009'], 'p5');
assert(page009p5.includes('COHESION-EXPLICIT-CONNECTOR-01'), '009/p5 must receive connector/cohesion boundary');
assert(!page009p5.includes('PARAPHRASE-MEANING-BOUNDARY-01'), '009/p5 must not depend on a generalized rewrite-policy card');

for (const [jobId, jobMatches] of Object.entries(matches)) {
  assert(jobMatches.length <= 10, `${jobId}: total evidence exceeds cap`);
  for (const page of plans[jobId as keyof typeof plans]) {
    assert(idsForPage(jobMatches, page.pageId).length <= 4, `${jobId}/${page.pageId}: per-page evidence exceeds cap`);
  }
  assert.deepEqual(
    jobMatches,
    matchDelfB2InnerEvidenceCards(plans[jobId as keyof typeof plans]),
    `${jobId}: matcher must be deterministic`,
  );
}

const noMatchPlan: UserVisiblePagePlan[] = [{
  pageId: 'p1',
  pageGoal: '交付一个假设场景',
  userGets: '一个例子',
  pageContentPlan: '用中性语言说明场景背景',
}];
assert.deepEqual(matchDelfB2InnerEvidenceCards(noMatchPlan), [], 'irrelevant page must receive no evidence');

function page(text: string): UserVisiblePagePlan[] {
  return [{ pageId: 'p1', pageGoal: text, userGets: text, pageContentPlan: text }];
}

function matchIds(text: string) {
  return matchDelfB2InnerEvidenceCards(page(text)).map(item => item.id);
}

const positiveCases: Array<{ name: string; text: string; expected: string[] }> = [
  { name: 'bien-que', text: '讲清 bien que 的让步关系和动词形式', expected: ['SUBJONCTIF-BIEN-QUE-01'] },
  { name: 'meme-si', text: '对比 même si 的让步结构', expected: ['INDICATIF-MEME-SI-01'] },
  { name: 'malgre', text: '说明 malgré 后接名词时如何表达让步', expected: ['PREPOSITION-MALGRE-01'] },
  { name: 'falloir', text: '对比 il faut 和 il faudrait 的语气', expected: ['FALLOIR-IL-FAUT-FAUDRAIT-01'] },
  { name: 'car', text: '解释 car 与 parce que 的差别', expected: ['CAUSE-CAR-PARCE-QUE-01', 'CAUSE-PARCE-QUE-PUISQUE-01'] },
  { name: 'puisque', text: '解释 parce que 与 puisque 的原因信息差别', expected: ['CAUSE-CAR-PARCE-QUE-01', 'CAUSE-PARCE-QUE-PUISQUE-01'] },
  { name: 'savoir-gre', text: '正式请求使用 je vous saurais gré de', expected: ['FORMAL-SAVOIR-GRE-01'] },
  { name: 'je-vous-prie', text: "正式信收尾使用 je vous prie d'agréer", expected: ['FORMAL-JE-VOUS-PRIE-01', 'REGISTER-AUDIENCE-PURPOSE-01'] },
  { name: 'imperative', text: '区分 impératif 命令式形式与请求功能', expected: ['IMPERATIVE-FORM-FUNCTION-01', 'GRAMMAR-MOOD-FORM-01'] },
  { name: 'minimum-words', text: '说明 DELF B2 写作最低篇幅 250 mots', expected: ['DELF-B2-MINIMUM-WORDS-01'] },
];

let expectedHits = 0;
let returnedHits = 0;
let correctHits = 0;
const positiveResults = positiveCases.map(testCase => {
  const actual = matchIds(testCase.text);
  expectedHits += testCase.expected.length;
  returnedHits += actual.length;
  correctHits += actual.filter(id => testCase.expected.includes(id)).length;
  testCase.expected.forEach(id => assert(actual.includes(id), `${testCase.name}: missing ${id}`));
  return { ...testCase, actual };
});

const negativeCases = [
  '整理五个环保主题的正反论据', '给出一个远程办公假设场景', '说明如何积累词汇', '安排三页练习',
  '写一段自然的小红书开场', '比较城市与乡村生活', '展示一篇范文', '列出学习计划',
  '介绍资料包含哪些模块', '解释用户如何使用检查清单',
];
negativeCases.forEach((text, index) => assert.deepEqual(matchIds(text), [], `negative-${index + 1}: false match`));

const broadCases = ['只讨论逻辑', '只出现正式', '只说语气', '只提阅卷人', '只写高分'];
broadCases.forEach((text, index) => assert.deepEqual(matchIds(text), [], `broad-${index + 1}: broad word activated cards`));

const vetoCases = [
  { text: '数学条件与 conditionnel、politesse 的术语翻译', absent: 'CONDITIONNEL-POLITENESS-01' },
  { text: '英文car表示汽车，不讲法语连接词', absent: 'CAUSE-CAR-PARCE-QUE-01' },
  { text: '纠正错误写法 je vous serais gré', absent: 'FORMAL-SAVOIR-GRE-01' },
  { text: '间接疑问中讨论 même si 的文本片段', absent: 'INDICATIF-MEME-SI-01' },
  { text: '解释 comme il faut 这个固定表达', absent: 'FALLOIR-IL-FAUT-FAUDRAIT-01' },
];
vetoCases.forEach((testCase, index) => assert(!matchIds(testCase.text).includes(testCase.absent), `veto-${index + 1}: negative trigger failed`));

const precision = returnedHits ? correctHits / returnedHits : 0;
const recall = expectedHits ? correctHits / expectedHits : 0;
console.log(JSON.stringify({ precision, recall, positiveResults }, null, 2));
assert(precision >= 0.9, `matcher precision below 90%: ${precision}`);
assert(recall >= 0.9, `matcher recall below 90%: ${recall}`);

console.log(JSON.stringify({
  status: 'PASS',
  cardCount: cards.length,
  precision,
  recall,
  negativeCaseFalsePositives: 0,
  broadCaseFalsePositives: 0,
  negativeTriggerFailures: 0,
  positiveResults,
  matches: Object.fromEntries(Object.entries(matches).map(([jobId, jobMatches]) => [
    jobId,
    jobMatches.map(match => ({ id: match.id, applicablePageIds: match.applicablePageIds, matchedTriggers: match.matchedTriggers })),
  ])),
}, null, 2));
