// seed 发牌验证：① 收敛判定校准（惯犯 seed 应被压、无关 seed 不误伤）
// ② 17 卡批内重发牌（seed 不重复、type 分布合理）。
// 用法：npx tsx scripts/test-seed-deal.mts
import { getEditorialSeeds, planSeededTopics, seedKnowledgeText } from '../src/lib/editorial-seed-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
const seeds = getEditorialSeeds('delf_b2_writing');
const byId = new Map(seeds.map(s => [s.seed_id, s]));

// ── 1. 惯犯场景：批内已有"段落过渡"确认选题（真实 batch job_005 文本），三个收敛 seed 必须被压 ──
const convergedTopicTexts = [
  'DELF B2写作段落间无过渡：3类连接词帮你理顺逻辑 根据原因、结果、让步、对比和总结选择衔接表达 连接词 原因 结果 让步 对比 总结',
];
// ── 2. 时间分配选题在前时，任何 seed 都不该被误压（time_allocation 本身走 batchPenalty 管）──
const controlTopicTexts = [
  'DELF B2写作时间怎么分配？考场节奏这样排 分配写作时间完成两篇任务 时间分配 考场节奏 审题 提纲 检查',
];
const facts = await loadProductFacts('delf_b2_writing');
const card = getCompetitorCreativeCard('resource_15_grammar_grid_purple')!;

const dealWith = (texts: string[], exclude: string[]) => {
  // 用固定卡各发一次牌，看返回的首选 seed 是谁（不需要断言内部 penalty，
  // 直接看惯犯是否还出现在结果里更接近真实行为）
  return planSeededTopics({
    productId: 'delf_b2_writing', card, facts, limit: 4,
    date: new Date('2026-08-15T00:00:00Z'),
    batchUsedSeedIds: exclude,
    batchUsedTopicTexts: texts,
  }).map(t => t.seed_id);
};

console.log('== 已发"段落过渡"选题后再发牌（惯犯应被压）==');
console.log('首选 4 个 seed:', dealWith(convergedTopicTexts, []).join(', '));
const offenders = ['delf_connectors', 'delf_pain_logic_jump', 'delf_paragraph_structure'];
// 惯犯不应该排进前 4；单独验证：把其它 seed 全排除掉，惯犯之间互相也不该首选
const others = seeds.map(s => s.seed_id).filter(id => !offenders.includes(id));
const forced = dealWith(convergedTopicTexts, others);
console.log('排除全部无关 seed 后仍首选:', forced.join(', '), '(应不含三惯犯，除非池子耗尽)');

console.log('\n== 已发"时间分配"选题后再发牌（对照组）==');
const t = dealWith(controlTopicTexts, ['delf_time_allocation']);
console.log('首选 4 个 seed:', t.join(', '));

// ── 3. 17 卡批内重发牌 ──
const cardIds = [
  'resource_01_grammar_parchment_red', 'resource_02_grammar_white_green', 'resource_03_chalkboard_course',
  'resource_04_chalkboard_phrase_list', 'resource_05_grammar_clean_purple', 'resource_06_notes_course_offer',
  'resource_07_question_words_parchment', 'resource_08_book_cover_fle', 'resource_09_notebook_warning',
  'resource_10_plain_text_experience', 'resource_11_delf_doc_analysis', 'resource_12_delf_vocab_table_overlay',
  'resource_13_course_roadmap_blue', 'resource_14_collocation_dense_green', 'resource_15_grammar_grid_purple',
  'resource_16_official_notice', 'resource_17_pain_quote',
];
const batchUsedSeedIds: string[] = [];
const batchUsedTopicTexts: string[] = [];
const result: string[] = [];
const typeDist: Record<string, number> = {};
for (const cardId of cardIds) {
  const c = getCompetitorCreativeCard(cardId);
  if (!c) { result.push(`${cardId}: NO CARD`); continue; }
  const topics = planSeededTopics({
    productId: 'delf_b2_writing', card: c, facts, limit: 1,
    date: new Date('2026-08-15T00:00:00Z'),
    batchUsedSeedIds, batchUsedTopicTexts,
  });
  for (const t of topics) {
    batchUsedSeedIds.push(t.seed_id!);
    batchUsedTopicTexts.push(`${t.topic} ${t.content_promise} ${(t.dynamic_fact_terms || []).join(' ')}`);
    typeDist[t.topic_type || '-'] = (typeDist[t.topic_type || '-'] || 0) + 1;
    result.push(`${cardId.slice(9, 25).padEnd(17)} ${(t.topic_type || '').padEnd(14)} ${t.seed_id}`);
  }
}
console.log('\n== 17 卡重发牌（limit=1）==');
result.forEach(r => console.log(r));
const seedCounts = new Map<string, number>();
for (const id of batchUsedSeedIds) seedCounts.set(id, (seedCounts.get(id) || 0) + 1);
const dupes = [...seedCounts.entries()].filter(([, c]) => c > 1);
console.log('重复 seed:', dupes.length ? dupes.map(([id, c]) => `${id}×${c}`).join(', ') : '无');
console.log('topic_type 分布:', JSON.stringify(typeDist));
