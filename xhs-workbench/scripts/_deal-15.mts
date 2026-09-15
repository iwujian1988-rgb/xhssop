// 为 5-agent 验证生成确定性发牌：15 卡 × 1 题 + 每篇叙事骨架。
import { planSeededTopics, getEditorialSeeds, seedKnowledgeText } from '../src/lib/editorial-seed-library';
import { stableHash } from '../src/lib/caption-schema';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import fs from 'node:fs';

// reference-compose 依赖链有 dictionary-fr 顶层 await，CJS 下跑不了；
// 骨架分配逻辑在此本地复刻（与 pickNarrativeSkeleton 保持一致）。
const NARRATIVE_SKELETONS = [
  { id: 'failure_recovery', spec: '失败复盘——第一人称，从一次具体的失败经历（某次模考/练习/被批改的瞬间）切入，自然带出方法；结尾落在方法生效后的具体变化' },
  { id: 'direct_delivery', spec: '直给清单——开头一两句说清本篇解决什么问题、给出什么交付，直接进入条目展开；不讲故事、不铺情绪' },
  { id: 'myth_busting', spec: '误区纠偏——开头指出一个多数考生都在用的普遍做法，点破它为什么吃亏，再给正确做法和正误对照' },
  { id: 'qa_walkthrough', spec: '自问自答——开头抛出读者最可能问的一个问题，正文每段回答一个子问题，层层拆完' },
  { id: 'scene_timeline', spec: '场景时间线——开头把读者放进具体场景（发卷后十分钟/写正文前五分钟），按时间顺序走每一步该做什么' },
];
function pickNarrativeSkeleton(seedKey: string, recentSkeletons: string[]) {
  const ordered = [...NARRATIVE_SKELETONS];
  const useCount = (id: string) => recentSkeletons.filter(s => s === id).length;
  ordered.sort((a, b) => useCount(a.id) - useCount(b.id));
  return ordered[stableHash(`${seedKey}-skeleton`) % ordered.length];
}

const cardIds = [
  'resource_01_grammar_parchment_red', 'resource_02_grammar_white_green', 'resource_03_chalkboard_course',
  'resource_04_chalkboard_phrase_list', 'resource_05_grammar_clean_purple', 'resource_06_notes_course_offer',
  'resource_07_question_words_parchment', 'resource_08_book_cover_fle', 'resource_09_notebook_warning',
  'resource_10_plain_text_experience', 'resource_11_delf_doc_analysis', 'resource_12_delf_vocab_table_overlay',
  'resource_13_course_roadmap_blue', 'resource_14_collocation_dense_green', 'resource_15_grammar_grid_purple',
];
const facts = await loadProductFacts('delf_b2_writing');
const seeds = new Map(getEditorialSeeds('delf_b2_writing').map(s => [s.seed_id, s]));
const batchUsedSeedIds: string[] = [];
const batchUsedTopicTexts: string[] = [];
const recentSkeletons: string[] = [];
const out: unknown[] = [];
for (const cardId of cardIds) {
  const card = getCompetitorCreativeCard(cardId);
  if (!card) continue;
  const topics = planSeededTopics({
    productId: 'delf_b2_writing', card, facts, limit: 1,
    date: new Date('2026-08-15T00:00:00Z'),
    batchUsedSeedIds, batchUsedTopicTexts,
  });
  for (const t of topics) {
    batchUsedSeedIds.push(t.seed_id!);
    batchUsedTopicTexts.push(`${t.topic} ${t.content_promise} ${(t.dynamic_fact_terms || []).join(' ')}`);
    const skeleton = pickNarrativeSkeleton(`${card.id}|${t.seed_id}`, recentSkeletons);
    recentSkeletons.push(skeleton.id);
    const seed = seeds.get(t.seed_id!)!;
    out.push({
      card_id: cardId, renderer: card.renderer_id,
      seed_id: t.seed_id, topic_type: t.topic_type,
      topic_seed_text: seed.topic,
      audience: seed.audience, scene: seed.use_scenario, pain: seed.user_pain,
      content_promise: seed.user_need, pay_trigger: seed.pay_trigger,
      keyword_candidates: seed.keyword_candidates, dynamic_fact_terms: seed.dynamic_fact_terms,
      ai_original_scope: seed.ai_original_scope, page_plan: seed.page_plan,
      narrative_skeleton: skeleton.id, narrative_skeleton_spec: skeleton.spec,
    });
  }
}
fs.writeFileSync('.tmp-deal-15.json', JSON.stringify(out, null, 2));
console.log('dealt', out.length, 'notes');
console.log('skeleton 分布:', JSON.stringify(out.reduce((acc: Record<string, number>, n: any) => { acc[n.narrative_skeleton] = (acc[n.narrative_skeleton] || 0) + 1; return acc; }, {})));
console.log(out.map((n: any) => `${n.card_id.slice(9, 24)} ${n.narrative_skeleton.padEnd(18)} ${n.seed_id}`).join('\n'));
