import assert from 'node:assert/strict';
import { getPublicEditorialRiskIssues, hasUnsupportedProductNumberClaim, normalizeTitleIdentity } from '../src/lib/editorial-quality';
import {
  hasForbiddenProductIdentity,
  hasRequiredProductIdentity,
} from '../src/lib/product-prompt-profiles';

// Cross-product contamination is semantic, not cosmetic. Replacing DELF with
// TCF/TCF would keep an already-wrong task looking plausible. Drop the title
// so the product-specific fallback can rebuild it.
assert.equal(
  normalizeTitleIdentity('TEF/TCF写作：按目的选正式信开头', 'delf_b2_writing'),
  '',
);
assert.equal(
  normalizeTitleIdentity('看完这个，你的法语B25句式会不再相同', 'delf_b2_writing'),
  '看完这个，你的法语B2：5句式会不再相同',
);

// Product 1 identity guards.
assert.equal(hasRequiredProductIdentity('delf_b2_writing', 'DELF B2写作范文'), true);
assert.equal(hasRequiredProductIdentity('delf_b2_writing', '法语B2作文怎么练'), true);
assert.equal(hasForbiddenProductIdentity('delf_b2_writing', 'TEF Canada备考'), true);
assert.equal(hasForbiddenProductIdentity('delf_b2_writing', 'CLB7自测'), true);

// Product 2 identity guards.
assert.equal(hasRequiredProductIdentity('tef_tcf_canada', 'TEF还是TCF'), true);
assert.equal(hasRequiredProductIdentity('tef_tcf_canada', 'CLB7四科差距'), true);
assert.equal(hasForbiddenProductIdentity('tef_tcf_canada', 'DELF B2范文'), true);
assert.equal(hasForbiddenProductIdentity('tef_tcf_canada', 'DALF C1写作'), true);

const riskyCaption = [
  '5分钟自查能挽回至少5-10分。',
  '用 bien que 代替 mais。',
  '正式信严禁使用感叹号。',
  '我的DELF B2资料里整理了36项清单。',
  '字数控制在230-280词，每段开头有一个连接词，至少1个虚拟式。',
  '正式信全程用vous，避免泛指on。',
  '环保主题词一换，就能直接套用到健康题。',
  '这是DELF B2写作提分的关键。',
  '用22篇范文直接调取表达，效率翻倍，考前两周就能写顺。',
].join(' ');
const issues = getPublicEditorialRiskIssues(riskyCaption);
assert(issues.includes('unsupported_score_or_time_claim'));
assert(issues.includes('unsafe_mechanical_language_replacement'));
assert(issues.includes('overabsolute_public_rule'));
assert(issues.includes('public_inventory_relation_claim'));
assert(issues.includes('invented_exam_quantity_rule'));
assert(issues.includes('overabsolute_register_rule'));
assert(issues.includes('overmechanical_content_method'));
assert(issues.includes('unsupported_outcome_claim'));

assert.deepEqual(
  getPublicEditorialRiskIssues('写完后按任务完成、连贯性、词汇句法和语体逐项检查。'),
  [],
);
assert.equal(hasUnsupportedProductNumberClaim('资料提供句法库50+结构。', ['句法库100条结构']), true);
assert.equal(hasUnsupportedProductNumberClaim('资料提供句法库100条结构。', ['句法库100条结构']), false);

console.log(JSON.stringify({ title_identity: 'ok', editorial_risk_guards: issues }, null, 2));
