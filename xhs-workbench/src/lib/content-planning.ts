import {
  ContentPlanningResult,
  AudienceCluster,
  CreativeAsset,
  EvidenceAsset,
  FactCategory,
  HardGateResult,
  NoteCandidate,
  PainCluster,
  SellingCluster,
  ProductFactItem,
  ProductFacts,
} from '@/types/content-planning';
import { CoverTemplateId, TitleTemplateId } from '@/types/data';
import { recommendNoteFormats, routeTitleFormulas } from './title-formula-router';
import { buildNoteFormatPlans } from './note-format-router';

const FACT_CATEGORIES: FactCategory[] = [
  'audiences',
  'use_cases',
  'raw_pain_points',
  'raw_selling_points',
  'knowledge_assets',
  'content_modules',
  'displayable_assets',
];

const TAG_RULES: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'delf_b2', patterns: [/DELF|B2|production écrite|production ecrite/i] },
  { tag: 'tef_tcf', patterns: [/TEF|TCF|CLB7|Canada/i] },
  { tag: 'writing', patterns: [/写作|作文|范文|lettre|essai|forum|argumentatif/i] },
  { tag: 'exam_choice', patterns: [/TEF.*TCF|TCF.*TEF|考试选择|TEF|TCF|CLB7/] },
  { tag: 'planning', patterns: [/路径|计划|阶段|30天|4周|8周|时间|安排|冲刺/] },
  { tag: 'checklist', patterns: [/清单|检查|自查|勾选|checklist/i] },
  { tag: 'table', patterns: [/表|对照|矩阵|维度|评分/] },
  { tag: 'mistake', patterns: [/错误|错题|扣分|不规范|混用|直译|低级/] },
  { tag: 'sentence', patterns: [/句型|句法|结构|虚拟式|条件式|连接词|开头|结尾/] },
  { tag: 'vocabulary', patterns: [/词汇|表达|替换|高频|主题词/] },
  { tag: 'sample', patterns: [/样张|截图|范文片段|完整.*句|例子|案例/] },
  { tag: 'rescue', patterns: [/考前|临考|救命|冲刺|最后|急救/] },
  { tag: 'self_test', patterns: [/诊断|自测|自评|差距/] },
  { tag: 'document_pack', patterns: [/资料|知识库|模块|目录|素材|条|篇|库/] },
];

const COVER_BY_TAG: Record<string, CoverTemplateId[]> = {
  checklist: ['list_poster', 'document_sample'],
  table: ['table_compare', 'mistake_compare'],
  mistake: ['mistake_compare', 'table_compare', 'white_blue_pain'],
  sentence: ['list_poster', 'document_sample', 'white_blue_pain'],
  vocabulary: ['list_poster', 'table_compare', 'document_sample'],
  sample: ['document_sample', 'list_poster'],
  planning: ['plan_table', 'list_poster'],
  rescue: ['plan_table', 'list_poster', 'white_blue_pain'],
  exam_choice: ['table_compare', 'list_poster'],
  self_test: ['list_poster', 'document_sample'],
  document_pack: ['list_poster', 'document_sample'],
};

const TITLE_BY_TAG: Record<string, TitleTemplateId[]> = {
  checklist: ['checklist_ready', 'exam_rescue'],
  table: ['compare_choice', 'checklist_ready'],
  mistake: ['mistake_warning', 'dont_only', 'not_a_but_b'],
  sentence: ['checklist_ready', 'dont_only', 'exam_rescue'],
  vocabulary: ['checklist_ready', 'dont_only'],
  planning: ['roadmap_planning', 'exam_rescue'],
  rescue: ['exam_rescue', 'checklist_ready'],
  exam_choice: ['compare_choice', 'checklist_ready'],
  self_test: ['checklist_ready', 'not_a_but_b'],
  writing: ['effort_failed', 'not_a_but_b', 'dont_only'],
};

const COVER_CONFLICTS: Partial<Record<CoverTemplateId, string[]>> = {
  table_compare: ['sample'],
  mistake_compare: ['exam_choice', 'planning'],
  plan_table: ['mistake', 'sample'],
  case_review: ['table', 'checklist', 'exam_choice'],
};

export function buildContentPlanningFromFacts(facts: ProductFacts): ContentPlanningResult {
  const audiences = toCreativeAssets('audiences', facts.audiences);
  const pains = toCreativeAssets('raw_pain_points', facts.raw_pain_points);
  const sellingPoints = toCreativeAssets('raw_selling_points', facts.raw_selling_points);
  const knowledgeAssets = toCreativeAssets('knowledge_assets', facts.knowledge_assets);
  const displayableAssets = toCreativeAssets('displayable_assets', facts.displayable_assets);
  const evidenceAssets = buildEvidenceAssets(displayableAssets, sellingPoints, pains);
  const painClusters = buildPainClusters(pains);
  const sellingClusters = buildSellingClusters(sellingPoints);
  const audienceClusters = buildAudienceClusters(audiences);
  const { candidates, rejectedCount } = buildCandidates(
    audiences,
    audienceClusters,
    pains,
    painClusters,
    sellingPoints,
    sellingClusters,
    knowledgeAssets,
    evidenceAssets,
  );

  return {
    facts_summary: summarizeFacts(facts),
    audiences,
    pains,
    selling_points: sellingPoints,
    knowledge_assets: knowledgeAssets,
    evidence_assets: evidenceAssets,
    pain_clusters: painClusters,
    selling_clusters: sellingClusters,
    audience_clusters: audienceClusters,
    candidates,
    rejected_count: rejectedCount,
  };
}

function summarizeFacts(facts: ProductFacts): Record<FactCategory, number> {
  return Object.fromEntries(
    FACT_CATEGORIES.map(category => [category, facts[category]?.length ?? 0]),
  ) as Record<FactCategory, number>;
}

function toCreativeAssets(category: FactCategory, items: ProductFactItem[] = []): CreativeAsset[] {
  return items.map(item => ({
    id: item.id,
    source_id: item.id,
    source_category: category,
    text: item.text,
    source_file: item.source_file,
    evidence: item.evidence,
    tags: inferTags(item),
  }));
}

function buildEvidenceAssets(
  displayableAssets: CreativeAsset[],
  sellingPoints: CreativeAsset[],
  pains: CreativeAsset[],
): EvidenceAsset[] {
  return displayableAssets.map(asset => {
    const relatedSellingPoints = sellingPoints
      .filter(point => relationScore(asset, point) >= 2)
      .map(point => point.id);
    const supportPains = pains
      .filter(pain => relationScore(asset, pain) >= 1.5)
      .map(pain => pain.id);
    const allowedCoverTypes = allowedCovers(asset.tags);

    return {
      id: `evidence_${asset.id.toLowerCase()}`,
      text: asset.text,
      source_file: asset.source_file,
      source_section: '',
      evidence: asset.evidence,
      tags: asset.tags,
      asset_type: inferAssetType(asset),
      related_selling_point_ids: relatedSellingPoints,
      can_support_pain_ids: supportPains,
      can_be_visualized_as: visualForms(asset.tags),
      allowed_cover_types: allowedCoverTypes,
      forbidden_cover_types: forbiddenCovers(asset.tags, allowedCoverTypes),
      can_be_cover: allowedCoverTypes.length > 0,
      can_be_inner_page: true,
      can_be_purchase_reason: relatedSellingPoints.length > 0,
    };
  });
}

function buildPainClusters(pains: CreativeAsset[]): PainCluster[] {
  const clusters: Array<Omit<PainCluster, 'detail_pain_ids'>> = [
    {
      id: 'pain_b2_not_like_b2',
      name: '写出来不像 B2',
      user_facing_pain: '学了很多语法和表达，但作文读起来还是不像 B2。',
      tags: ['delf_b2', 'writing', 'sentence', 'vocabulary', 'mistake'],
    },
    {
      id: 'pain_cannot_reuse_material',
      name: '资料背了但不会迁移',
      user_facing_pain: '范文、句型、表达都看过，但一换题就不知道怎么用。',
      tags: ['delf_b2', 'writing', 'sample', 'sentence', 'document_pack'],
    },
    {
      id: 'pain_no_self_check',
      name: '写完不知道错在哪',
      user_facing_pain: '作文写完只能凭感觉改，不知道哪些地方会扣分。',
      tags: ['delf_b2', 'writing', 'mistake', 'checklist', 'table'],
    },
    {
      id: 'pain_no_exam_priority',
      name: '考前不知道先抓什么',
      user_facing_pain: '时间不多了，但不知道哪些模块最值得先补。',
      tags: ['delf_b2', 'writing', 'rescue', 'planning', 'checklist'],
    },
    {
      id: 'pain_material_messy',
      name: '资料很多但不成体系',
      user_facing_pain: '资料越攒越多，但没有整理成能直接复习和调用的结构。',
      tags: ['delf_b2', 'writing', 'document_pack', 'planning', 'checklist'],
    },
    {
      id: 'pain_chinese_french',
      name: '总像中文翻译成法语',
      user_facing_pain: '句子能写出来，但表达很中式，正式度和自然度不够。',
      tags: ['delf_b2', 'writing', 'vocabulary', 'sentence', 'mistake'],
    },
  ];

  return clusters.map(cluster => ({
    ...cluster,
    detail_pain_ids: pains
      .filter(pain => relationScoreByTags(cluster.tags, pain.tags) >= 1)
      .map(pain => pain.id),
  }));
}

function buildSellingClusters(sellingPoints: CreativeAsset[]): SellingCluster[] {
  const clusters: Array<Omit<SellingCluster, 'raw_selling_point_ids'>> = [
    {
      id: 'sell_executable_path',
      name: '把备考拆成可执行路径',
      user_facing_value: '不用自己乱摸索，直接按阶段知道先做什么、后做什么。',
      tags: ['delf_b2', 'writing', 'planning', 'self_test', 'checklist'],
    },
    {
      id: 'sell_self_check',
      name: '知道作文到底扣在哪',
      user_facing_value: '写完不是凭感觉改，而是按评分维度和清单逐项自查。',
      tags: ['delf_b2', 'writing', 'mistake', 'checklist', 'table'],
    },
    {
      id: 'sell_reuse_samples',
      name: '把范文拆成能迁移的表达',
      user_facing_value: '不是整篇硬背，而是把范文里的结构和表达拆出来换题复用。',
      tags: ['delf_b2', 'writing', 'sample', 'sentence', 'document_pack'],
    },
    {
      id: 'sell_b2_expression',
      name: '把普通表达换成更像 B2 的写法',
      user_facing_value: '把低级、重复、中式的表达换成更正式、更自然的写法。',
      tags: ['delf_b2', 'writing', 'vocabulary', 'sentence', 'mistake'],
    },
    {
      id: 'sell_exam_priority',
      name: '考前优先抓最该补的东西',
      user_facing_value: '时间不多时，先抓高频命题、检查清单和最容易扣分的地方。',
      tags: ['delf_b2', 'writing', 'rescue', 'planning', 'checklist'],
    },
    {
      id: 'sell_system_pack',
      name: '把零散资料整理成一个复习系统',
      user_facing_value: '范文、词汇、句法、观点、错题和清单放在同一套结构里调用。',
      tags: ['delf_b2', 'writing', 'document_pack', 'planning', 'checklist'],
    },
  ];

  return clusters.map(cluster => ({
    ...cluster,
    raw_selling_point_ids: sellingPoints
      .filter(point => relationScoreByTags(cluster.tags, point.tags) >= 1)
      .map(point => point.id),
  }));
}

function buildAudienceClusters(audiences: CreativeAsset[]): AudienceCluster[] {
  const clusters: Array<Omit<AudienceCluster, 'raw_audience_ids'>> = [
    {
      id: 'audience_system_preparer',
      name: 'B2系统备考生',
      user_state: '还有一段时间，想把写作按模块系统补起来。',
      tags: ['delf_b2', 'writing', 'planning', 'document_pack'],
    },
    {
      id: 'audience_exam_sprint',
      name: '考前冲刺生',
      user_state: '时间不多，需要快速知道优先抓什么。',
      tags: ['delf_b2', 'writing', 'rescue', 'checklist'],
    },
    {
      id: 'audience_retake_failed',
      name: '写作没过的复考生',
      user_state: '已经考过或练过，但不知道到底卡在哪里。',
      tags: ['delf_b2', 'writing', 'mistake', 'self_test'],
    },
    {
      id: 'audience_weak_output',
      name: '写作输出薄弱的人',
      user_state: '词汇、句式、论证都知道一点，但写出来不稳定。',
      tags: ['delf_b2', 'writing', 'vocabulary', 'sentence', 'mistake'],
    },
    {
      id: 'audience_template_learner',
      name: '想要模板和例句的人',
      user_state: '更需要可套用、可替换、可仿写的材料。',
      tags: ['delf_b2', 'writing', 'sample', 'sentence', 'document_pack'],
    },
  ];

  return clusters.map(cluster => ({
    ...cluster,
    raw_audience_ids: audiences
      .filter(audience => relationScoreByTags(cluster.tags, audience.tags) >= 1)
      .map(audience => audience.id),
  }));
}

function buildCandidates(
  audiences: CreativeAsset[],
  audienceClusters: AudienceCluster[],
  pains: CreativeAsset[],
  painClusters: PainCluster[],
  sellingPoints: CreativeAsset[],
  sellingClusters: SellingCluster[],
  knowledgeAssets: CreativeAsset[],
  evidenceAssets: EvidenceAsset[],
): { candidates: NoteCandidate[]; rejectedCount: number } {
  const candidates: NoteCandidate[] = [];
  let rejectedCount = 0;

  for (const pain of pains) {
    const painCluster = bestPainCluster(painClusters, pain);
    for (const sellingPoint of sellingPoints) {
      const sellingCluster = bestSellingCluster(sellingClusters, sellingPoint, painCluster);
      if (relationScore(pain, sellingPoint) < 1.5) {
        rejectedCount += 1;
        continue;
      }
      for (const knowledgeAsset of topRelated(knowledgeAssets, sellingPoint, 5)) {
        for (const evidenceAsset of topEvidence(evidenceAssets, sellingPoint, pain, 4)) {
          const hardGate = evaluateHardGate(pain, sellingPoint, knowledgeAsset, evidenceAsset);
          if (!hardGate.passed) {
            rejectedCount += 1;
            continue;
          }

          const tags = uniqueTags([
            ...pain.tags,
            ...sellingPoint.tags,
            ...knowledgeAsset.tags,
            ...evidenceAsset.tags,
          ]);
          const allowedCoverTemplates = intersection(
            allowedCovers(tags),
            evidenceAsset.allowed_cover_types,
          );
          if (allowedCoverTemplates.length === 0) {
            rejectedCount += 1;
            continue;
          }

          const allowedTitleTemplates = allowedTitles(tags);
          const noteFormats = recommendNoteFormats(tags);
          const titleOptions = routeTitleFormulas({
            audience: bestAudienceCluster(audienceClusters, tags),
            painCluster,
            sellingCluster,
            detailPain: pain,
            evidenceAsset,
            tags,
          }, noteFormats);
          const audienceCluster = bestAudienceCluster(audienceClusters, tags);
          candidates.push({
            id: `candidate_${candidates.length + 1}`,
            audience_cluster: audienceCluster,
            audience: bestAudience(audiences, tags),
            pain_cluster: painCluster,
            pain,
            selling_cluster: sellingCluster,
            selling_point: sellingPoint,
            knowledge_asset: knowledgeAsset,
            evidence_asset: evidenceAsset,
            tags,
            allowed_title_templates: allowedTitleTemplates,
            allowed_cover_templates: allowedCoverTemplates,
            hard_gate: hardGate,
            score: scoreCandidate(
              painCluster,
              sellingCluster,
              pain,
              sellingPoint,
              knowledgeAsset,
              evidenceAsset,
              allowedTitleTemplates,
              allowedCoverTemplates,
            ),
            creative_brief: {
              audience_state: audienceCluster?.user_state ?? '正在准备 DELF B2 写作，需要更明确的复习抓手。',
              user_pain: painCluster.user_facing_pain,
              user_value: sellingCluster.user_facing_value,
              proof_asset: evidenceAsset.text,
              detail_example: pain.text,
              note_angle: `${painCluster.name}，用「${evidenceAsset.text}」证明「${sellingCluster.name}」。`,
              product_claim_limit: '只能承诺提供复习路径、资料整理、检查依据和表达参考，不能承诺提分、保过或替代真实训练。',
            },
            recommended_note_formats: noteFormats,
            title_options: titleOptions,
            format_plans: buildNoteFormatPlans({
              audience: audienceCluster,
              painCluster,
              sellingCluster,
              detailPain: pain,
              evidenceAsset,
              titleOptions,
            }),
          });
        }
      }
    }
  }

  candidates.sort((a, b) => b.score.total - a.score.total);
  return { candidates: diversifyCandidates(dedupeCandidates(candidates)).slice(0, 80), rejectedCount };
}

function evaluateHardGate(
  pain: CreativeAsset,
  sellingPoint: CreativeAsset,
  knowledgeAsset: CreativeAsset,
  evidenceAsset: EvidenceAsset,
): HardGateResult {
  const reasons: string[] = [];
  if (relationScore(pain, sellingPoint) < 1.5) reasons.push('买点不能覆盖当前痛点');
  if (relationScore(sellingPoint, knowledgeAsset) < 1) reasons.push('知识点不能证明买点');
  if (!evidenceAsset.related_selling_point_ids.includes(sellingPoint.id) && relationScoreToEvidence(sellingPoint, evidenceAsset) < 2) {
    reasons.push('买点缺少证据资产支撑');
  }
  if (!evidenceAsset.can_be_cover && !evidenceAsset.can_be_inner_page) reasons.push('证据资产不可视觉化');
  if (hasProductConflict(pain.tags, sellingPoint.tags, knowledgeAsset.tags)) reasons.push('内容核心和商品方向冲突');
  return { passed: reasons.length === 0, reasons };
}

function scoreCandidate(
  painCluster: PainCluster,
  sellingCluster: SellingCluster,
  pain: CreativeAsset,
  sellingPoint: CreativeAsset,
  knowledgeAsset: CreativeAsset,
  evidenceAsset: EvidenceAsset,
  titles: TitleTemplateId[],
  covers: CoverTemplateId[],
) {
  const clusterFit = relationScoreByTags(painCluster.tags, sellingCluster.tags);
  const painStrength = clamp01((painCluster.tags.length + keywordDensity(painCluster.user_facing_pain, ['不会', '不知道', '乱', '扣分', '考前', '时间'])) / 8);
  const solutionFit = clamp01((clusterFit + relationScore(pain, sellingPoint)) / 7);
  const evidenceSupport = clamp01((relationScoreToEvidence(sellingPoint, evidenceAsset) + relationScoreToEvidence(knowledgeAsset, evidenceAsset)) / 6);
  const visualDisplay = clamp01((evidenceAsset.can_be_cover ? 0.45 : 0) + (evidenceAsset.can_be_inner_page ? 0.25 : 0) + evidenceAsset.allowed_cover_types.length / 10);
  const titleClick = clamp01(titles.length / 4 + (pain.tags.includes('mistake') || pain.tags.includes('exam_choice') ? 0.25 : 0));
  const productFit = clamp01((clusterFit + relationScore(sellingPoint, knowledgeAsset) + relationScoreToEvidence(sellingPoint, evidenceAsset)) / 9);
  const freshness = 0.75;

  const total =
    painStrength * 20 +
    solutionFit * 20 +
    evidenceSupport * 20 +
    visualDisplay * 15 +
    titleClick * 10 +
    productFit * 10 +
    freshness * 5;

  return {
    total: Math.round(total),
    pain_strength: roundScore(painStrength),
    selling_solution_fit: roundScore(solutionFit),
    evidence_support: roundScore(evidenceSupport),
    visual_display: roundScore(visualDisplay),
    title_click_potential: roundScore(titleClick),
    product_fit: roundScore(productFit),
    freshness: roundScore(freshness),
  };
}

function inferTags(item: ProductFactItem | CreativeAsset): string[] {
  const text = `${item.text}\n${'evidence' in item ? item.evidence : ''}\n${'raw_keywords' in item ? item.raw_keywords.join('\n') : ''}`;
  return TAG_RULES
    .filter(rule => rule.patterns.some(pattern => pattern.test(text)))
    .map(rule => rule.tag);
}

function inferAssetType(asset: CreativeAsset): string {
  if (asset.tags.includes('table')) return 'table';
  if (asset.tags.includes('checklist')) return 'checklist';
  if (asset.tags.includes('planning')) return 'plan';
  if (asset.tags.includes('mistake')) return 'mistake_compare';
  if (asset.tags.includes('sample')) return 'sample';
  return 'document';
}

function visualForms(tags: string[]): string[] {
  const forms = new Set<string>();
  if (tags.includes('table')) forms.add('table');
  if (tags.includes('checklist')) forms.add('checklist');
  if (tags.includes('planning')) forms.add('calendar_or_roadmap');
  if (tags.includes('mistake')) forms.add('wrong_right_compare');
  if (tags.includes('sample')) forms.add('document_screenshot');
  if (tags.includes('document_pack')) forms.add('directory');
  if (forms.size === 0) forms.add('document_card');
  return Array.from(forms);
}

function allowedCovers(tags: string[]): CoverTemplateId[] {
  const covers = new Set<CoverTemplateId>();
  for (const tag of tags) {
    for (const cover of COVER_BY_TAG[tag] ?? []) covers.add(cover);
  }
  return Array.from(covers).filter(cover => !(COVER_CONFLICTS[cover] ?? []).some(tag => tags.includes(tag)));
}

function forbiddenCovers(tags: string[], allowed: CoverTemplateId[]): CoverTemplateId[] {
  const all: CoverTemplateId[] = [
    'white_blue_pain',
    'list_poster',
    'table_compare',
    'document_sample',
    'case_review',
    'mistake_compare',
    'plan_table',
  ];
  return all.filter(cover => !allowed.includes(cover) || (COVER_CONFLICTS[cover] ?? []).some(tag => tags.includes(tag)));
}

function allowedTitles(tags: string[]): TitleTemplateId[] {
  const titles = new Set<TitleTemplateId>();
  for (const tag of tags) {
    for (const title of TITLE_BY_TAG[tag] ?? []) titles.add(title);
  }
  return Array.from(titles);
}

function topRelated<T extends CreativeAsset>(items: T[], target: CreativeAsset, limit: number): T[] {
  return [...items]
    .sort((a, b) => relationScore(b, target) - relationScore(a, target))
    .slice(0, limit);
}

function topEvidence(items: EvidenceAsset[], sellingPoint: CreativeAsset, pain: CreativeAsset, limit: number): EvidenceAsset[] {
  return [...items]
    .sort((a, b) => (relationScoreToEvidence(sellingPoint, b) + relationScoreToEvidence(pain, b)) - (relationScoreToEvidence(sellingPoint, a) + relationScoreToEvidence(pain, a)))
    .slice(0, limit);
}

function bestAudience(audiences: CreativeAsset[], tags: string[]): CreativeAsset | undefined {
  return [...audiences].sort((a, b) => sharedCount(b.tags, tags) - sharedCount(a.tags, tags))[0];
}

function bestPainCluster(clusters: PainCluster[], pain: CreativeAsset): PainCluster {
  return [...clusters].sort((a, b) => relationScoreByTags(b.tags, pain.tags) - relationScoreByTags(a.tags, pain.tags))[0];
}

function bestSellingCluster(
  clusters: SellingCluster[],
  sellingPoint: CreativeAsset,
  painCluster: PainCluster,
): SellingCluster {
  return [...clusters].sort((a, b) => {
    const scoreB = relationScoreByTags(b.tags, sellingPoint.tags) + relationScoreByTags(b.tags, painCluster.tags);
    const scoreA = relationScoreByTags(a.tags, sellingPoint.tags) + relationScoreByTags(a.tags, painCluster.tags);
    return scoreB - scoreA;
  })[0];
}

function bestAudienceCluster(clusters: AudienceCluster[], tags: string[]): AudienceCluster | undefined {
  return [...clusters].sort((a, b) => relationScoreByTags(b.tags, tags) - relationScoreByTags(a.tags, tags))[0];
}

function dedupeCandidates(candidates: NoteCandidate[]): NoteCandidate[] {
  const seen = new Set<string>();
  const result: NoteCandidate[] = [];

  for (const candidate of candidates) {
    const key = [
      candidate.pain_cluster.id,
      candidate.selling_cluster.id,
      candidate.pain.id,
      candidate.evidence_asset.id,
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }

  return result;
}

function diversifyCandidates(candidates: NoteCandidate[]): NoteCandidate[] {
  const firstByTitle: NoteCandidate[] = [];
  const repeatedTitle: NoteCandidate[] = [];
  const seenTitles = new Set<string>();

  for (const candidate of candidates) {
    const title = candidate.title_options[0]?.title || candidate.creative_brief.note_angle;
    if (seenTitles.has(title)) {
      repeatedTitle.push(candidate);
      continue;
    }
    seenTitles.add(title);
    firstByTitle.push(candidate);
  }

  return [...firstByTitle, ...repeatedTitle];
}

function relationScore(a: CreativeAsset, b: CreativeAsset): number {
  return sharedCount(a.tags, b.tags) + sourceOverlap(a.source_file, b.source_file) + keywordOverlap(a.text, b.text);
}

function relationScoreByTags(a: string[], b: string[]): number {
  return sharedCount(a, b);
}

function relationScoreToEvidence(asset: CreativeAsset, evidence: EvidenceAsset): number {
  return sharedCount(asset.tags, evidence.tags) + sourceOverlap(asset.source_file, evidence.source_file) + keywordOverlap(asset.text, evidence.text);
}

function sharedCount(a: string[], b: string[]): number {
  return a.filter(tag => b.includes(tag)).length;
}

function sourceOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const left = new Set(a.split(/[,\s]+/).map(item => item.trim()).filter(Boolean));
  const right = b.split(/[,\s]+/).map(item => item.trim()).filter(Boolean);
  return right.some(item => left.has(item)) ? 1 : 0;
}

function keywordOverlap(a: string, b: string): number {
  const tokens = tokenize(a);
  const other = tokenize(b);
  return Math.min(2, tokens.filter(token => other.includes(token)).length * 0.5);
}

function tokenize(text: string): string[] {
  return Array.from(new Set(text.split(/[\s,，。；;、：:（）()【】[\]/+]+/).filter(token => token.length >= 2 && token.length <= 16)));
}

function hasProductConflict(...tagLists: string[][]): boolean {
  const tags = uniqueTags(tagLists.flat());
  return tags.includes('delf_b2') && tags.includes('tef_tcf');
}

function intersection<T>(a: T[], b: T[]): T[] {
  return a.filter(item => b.includes(item));
}

function uniqueTags(tags: string[]): string[] {
  return Array.from(new Set(tags));
}

function keywordDensity(text: string, keywords: string[]): number {
  return keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Math.round(value * 100);
}
