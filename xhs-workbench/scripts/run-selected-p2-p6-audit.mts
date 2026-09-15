/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { loadProductFacts } from '@/lib/product-facts-loader';
import { resolveProductEvidence } from '@/lib/product-fact-retrieval';
import { generateContentPackage } from '@/lib/v2/content-stage';
import { buildLockedProductionBrief } from '@/lib/v2/content-brief';
import { getCapabilityFallback } from '@/lib/v2/topic-stage';
import type { TopicOption } from '@/lib/v2/contracts';
import type { MigratedTopic } from '@/types/reference-workflow';
import source from '../.tmp-mother-topic-real-result.json' with { type: 'json' };

const selectedIds = [
  'batch_resource_01_grammar_parchment_red_1',
  'batch_resource_01_grammar_parchment_red_2',
  'batch_resource_02_grammar_white_green_1',
  'batch_resource_02_grammar_white_green_2',
  'batch_resource_03_chalkboard_course_1',
  'batch_resource_03_chalkboard_course_2',
  'batch_resource_04_chalkboard_phrase_list_2',
  'batch_resource_05_grammar_clean_purple_1',
  'batch_resource_06_notes_course_offer_1',
];

const holdId = 'batch_resource_05_grammar_clean_purple_2';
const rows = (source.rows as any[]).filter(row => selectedIds.includes(row.id) && row.id !== holdId);

const report: any = {
  generatedAt: new Date().toISOString(),
  model: process.env.MODEL_NAME || process.env.AI_MODEL || 'qwen3.7-flash',
  heldOut: { id: holdId, reason: '无效法语示例：utiliser → utiliser / commencer → commencer' },
  preflightAdjustments: [
    '06-1 finalPublicTopic 改回 DELF B2 写作语境',
    '万能例子/万能模板 → 常用例子/可复用句型',
  ],
  jobs: [],
};

for (const row of rows) {
  const cardId = row.id.replace(/^batch_/, '').replace(/_\d+$/, '');
  const card = getCompetitorCreativeCard(cardId);
  if (!card) throw new Error(`找不到创作卡：${cardId}`);
  const facts = await loadProductFacts('delf_b2_writing');
  const capability = getCapabilityFallback(card);
  const finalTopic = row.id === 'batch_resource_06_notes_course_offer_1'
    ? 'DELF B2写作高频话题观点梳理：环保 / 科技 / 社会'
    : String(row.finalPublicTopic || row.motherTopic).replace(/万能例子/g, '常用例子').replace(/万能模板/g, '可复用句型');
  const migrated: MigratedTopic = {
    id: row.id,
    topic: finalTopic,
    topic_type: 'search_pain',
    audience: 'DELF B2写作考生',
    scene: row.scene || '备考与写作练习',
    pain: row.painOrDesire || '需要一份可以直接使用的写作材料',
    content_promise: row.specificAsset || '拿到具体的法语写作材料、对照和练习方式',
    why_this_reference_fits: row.contentAngle || row.motherTopic,
    product_bridge: 'DELF B2写作知识库中的对应模块',
    search_terms: ['DELF B2', '法语写作', 'DELF B2写作'],
    dynamic_fact_terms: [row.specificAsset, ...(row.expandContents || [])].filter(Boolean),
    anchor_fact_ids: [],
    title_trigger_types: [],
    novelty: row.id,
    content_source_plan: {
      knowledge_base: '按 DELF B2 写作相关 factTerms 检索并核对',
      ai_original: '允许原创组织表达与示例，但不改变写作语境',
    },
    v2_topic: undefined,
  } as MigratedTopic;
  const topic = {
    ...migrated,
    v2_topic: undefined,
  } as any;
  const optionBase: TopicOption = {
    id: row.id,
    productId: 'delf_b2_writing',
    templateId: card.renderer_id,
    primaryGoal: 'save',
    topicLane: 'result_need',
    topic: finalTopic,
    audienceState: migrated.audience,
    scene: migrated.scene,
    painOrDesire: migrated.pain,
    promise: migrated.content_promise,
    contentAngle: migrated.why_this_reference_fits,
    productBridge: migrated.product_bridge,
    seo: { primary: 'DELF B2写作', related: ['法语写作', 'B2写作'] },
    knowledgeMode: 'mixed',
    factTerms: migrated.dynamic_fact_terms || [],
    seedSignals: [],
    noveltyFingerprint: row.id,
    valueType: row.valueType,
    specificAsset: row.specificAsset,
    userGain: row.userGain || '拿到可直接学习和练习的写作材料',
    demandType: row.demandType,
    expandContents: row.expandContents,
    motherTopicRationale: row.motherTopicRationale,
    proposedSubtopics: row.proposedSubtopics,
    productionBrief: undefined,
  };
  optionBase.productionBrief = buildLockedProductionBrief(optionBase);
  const evidence = await resolveProductEvidence('delf_b2_writing', facts, migrated, 8);
  console.log(`[p2-p6] start ${row.id}`);
  try {
    const artifact = await generateContentPackage({ topic: optionBase, capability, evidence });
    report.jobs.push({
      id: row.id,
      sourceMotherTopic: row.motherTopic,
      finalPublicTopic: finalTopic,
      specificAsset: row.specificAsset,
      pages: artifact.data.innerPages,
      coverBlocks: artifact.data.coverBlocks,
      frenchSegments: artifact.data.frenchSegments,
      warnings: artifact.warnings,
      usage: artifact.usage,
    });
    console.log(`[p2-p6] PASS ${row.id} pages=${artifact.data.innerPages.length}`);
  } catch (error) {
    report.jobs.push({ id: row.id, sourceMotherTopic: row.motherTopic, finalPublicTopic: finalTopic, status: 'FAIL', error: String(error) });
    console.log(`[p2-p6] FAIL ${row.id} ${String(error)}`);
  }
}

await fs.writeFile('.tmp-selected-p2-p6-audit.json', JSON.stringify(report, null, 2), 'utf8');
console.log(`P2_P6_RESULT_WRITTEN ${report.jobs.length}`);
