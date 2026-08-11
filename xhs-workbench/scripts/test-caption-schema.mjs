/* eslint-disable no-console */
/**
 * Caption schema 单测：
 *  1. assembleCaption 稳定性：同一 seed 多次跑输出一致
 *  2. assembleCaption 多样性：15 个不同 seed 至少出现 2-3 种 step 样式
 *  3. normalizeCaptionParts 兜底：空对象/部分缺失字段不抛错
 */
import { assembleCaption, normalizeCaptionParts } from '../src/lib/caption-schema.ts';

const SAMPLE = {
  hook: 'B2 写作开头结尾还在临时拼？这5个表达直接套',
  scenario: '我自己考前一周才发现，开头结尾的固定表达其实就那么几类',
  steps: [
    '正式信开头：Madame, Monsieur + Je me permets de vous écrire',
    '回复广告：Suite à votre annonce',
    '投诉：J\'ai l\'honneur de vous adresser',
  ],
  french_example: { fr: 'Je me permets de vous écrire pour...', zh: '我写信是想...' },
  cta: '考前1周过一遍这些表达',
};

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass += 1; console.log(`✅ ${name}`); }
  else { fail += 1; console.log(`❌ ${name}`); }
}

// 测试 1：稳定性
const seed = 'resource_01_grammar_parchment_red';
const out1 = assembleCaption(SAMPLE, seed);
const out2 = assembleCaption(SAMPLE, seed);
const out3 = assembleCaption(SAMPLE, seed);
check('稳定性：同 seed 3 次输出完全一致', out1 === out2 && out2 === out3);
check('稳定性：输出非空', out1.length > 100);
console.log(`\n样本输出（seed=${seed}）：\n${out1}\n`);

// 测试 2：多样性
const cards = [
  'resource_01_grammar_parchment_red',
  'resource_02_grammar_white_green',
  'resource_03_chalkboard_course',
  'resource_04_chalkboard_phrase_list',
  'resource_05_grammar_clean_purple',
  'resource_06_notes_course_offer',
  'resource_07_question_words_parchment',
  'resource_08_book_cover_fle',
  'resource_09_notebook_warning',
  'resource_10_plain_text_experience',
  'resource_11_delf_doc_analysis',
  'resource_12_delf_vocab_table_overlay',
  'resource_13_course_roadmap_blue',
  'resource_14_collocation_dense_green',
  'resource_15_grammar_grid_purple',
];
const prefixes = new Set();
for (const c of cards) {
  const out = assembleCaption(SAMPLE, c);
  // 抓第 3 行（steps 第一项）的前缀
  const line3 = out.split('\n')[2];
  const prefix = line3.match(/^[^a-zA-Z一-鿿]+/)?.[0] || '';
  prefixes.add(prefix);
}
console.log(`\n15 个 seed 产生的 step 前缀集合：${[...prefixes].map(p => `"${p}"`).join(', ')}`);
check('多样性：15 个 seed 至少出现 2 种 step 样式', prefixes.size >= 2);
check('多样性：理想是 3-4 种（4 种全部命中）', prefixes.size >= 3);

// 测试 3：normalizeCaptionParts 兜底
const fallback = { productId: 'delf_b2_writing', cardId: 'resource_01_grammar_parchment_red', coverTitle: 'DELF B2 写作语法大全' };

// 3a：完全空对象
const empty = normalizeCaptionParts({}, fallback);
check('兜底：空对象不抛错', !!empty.hook && !!empty.scenario && empty.steps.length >= 3 && !!empty.french_example.fr && !!empty.cta);
check('兜底：空对象 hook 用 coverTitle', empty.hook.includes('DELF'));
console.log(`\n空对象兜底结果：\n${JSON.stringify(empty, null, 2)}\n`);

// 3b：部分缺失
const partial = normalizeCaptionParts({ hook: '太短', steps: ['只一项'] }, fallback);
check('兜底：hook 太短退回 coverTitle', empty.hook.includes('DELF'));
check('兜底：steps 不足 3 项补齐到 3', partial.steps.length >= 3);
check('兜底：补齐后 steps 都非空', partial.steps.every(s => s && s.length > 0));

// 3c：french_example 缺失
const noExample = normalizeCaptionParts({ hook: 'B2 写作语法别再乱背了，按场景分组', scenario: '考前一周我才发现，语法点按场景记比死记硬背强', steps: ['env+ 定义', '虚拟式触发', '连接词分组'], cta: '考前过一遍' }, fallback);
check('兜底：french_example 缺失走 fallback', !!noExample.french_example.fr && !!noExample.french_example.zh);

// 3d：全部字段齐全（LLM 正常路径）
const full = normalizeCaptionParts(SAMPLE, fallback);
check('正常：全字段齐全时维持原值', full.hook === SAMPLE.hook && full.scenario === SAMPLE.scenario && full.steps.length === 3);

console.log(`\n========== `);
console.log(`总计：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
