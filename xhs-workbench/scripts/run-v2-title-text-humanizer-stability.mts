/* eslint-disable no-console */
import fs from 'node:fs';
import nextEnv from '@next/env';
import {
  humanizeFinalTextTitlesForTest,
  type TitleStageInput,
} from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentPackage, TitlePair, TopicOption } from '../src/lib/v2/contracts';
import type { CompetitorCreativeCard } from '../src/types/reference-workflow';

nextEnv.loadEnvConfig(process.cwd());

type RawCandidate = {
  clickReasonType?: string;
  clickReason?: string;
  textTitle?: string;
  coverTitle?: string;
  coverSubtitle?: string;
};

type SavedRun = {
  theme: string;
  repeat: number;
  raw: RawCandidate[];
  accepted: TitlePair[];
};

const source = JSON.parse(fs.readFileSync('final-title-v7-stability-results.json', 'utf8')) as { runs: SavedRun[] };
const card: CompetitorCreativeCard = {
  id: 'humanizer_stability_card',
  name: '羊皮纸高密度资料目录',
  renderer_id: 'parchment_dense_directory',
  content_mechanism: '多分组知识体系',
  click_mechanism: '资料整理完整感',
} as CompetitorCreativeCard;
const capability = getCapabilityFallback(card);

const fixtures: Record<string, {
  topic: string;
  pain: string;
  promise: string;
  scene: string;
  blocks: Array<{ heading: string; items: string[] }>;
}> = {
  'vocab-table': {
    topic: 'DELF B2写作高级词不能按中文意思机械替换',
    pain: '高级词背了不少，写进作文却像硬塞的',
    promise: '按表达意图选择penser、dire等常用词的自然替换',
    scene: '写完作文回看用词时',
    blocks: [{ heading: '按表达意图替换', items: ['表达观点时选择estimer或considérer', '引出信息时选择préciser或annoncer'] }],
  },
  'three-step-method': {
    topic: 'DELF B2正式信范文三步迁移法',
    pain: '范文背得很熟，换一道题却不知道怎么开始',
    promise: '圈任务、搭段落功能、填入本题内容',
    scene: '模拟考遇到没见过的正式信题目时',
    blocks: [{ heading: '正式信三步迁移', items: ['先圈题目任务', '再搭段落功能', '最后填入本题内容'] }],
  },
  'sample-breakdown': {
    topic: 'DELF B2写作范文段落功能拆解',
    pain: '范文每句都看懂，轮到自己写还是卡住',
    promise: '标出每段功能，再把观点和内容迁移到新题',
    scene: '看完范文后自己面对新题时',
    blocks: [{ heading: '范文段落功能', items: ['标出开头、主体和结尾的任务', '替换观点和例子内容'] }],
  },
};

function buildInput(theme: string): TitleStageInput {
  const fixture = fixtures[theme]!;
  const topic: TopicOption = {
    id: `humanizer-${theme}`,
    productId: 'delf_b2_writing',
    templateId: card.renderer_id,
    primaryGoal: capability.allowedGoals.includes('search') ? 'search' : capability.allowedGoals[0],
    topicLane: 'broad_pain',
    topic: fixture.topic,
    audienceState: '正在准备DELF B2写作的人',
    scene: fixture.scene,
    painOrDesire: fixture.pain,
    promise: fixture.promise,
    contentAngle: '具体方法拆解',
    plannedBlockKind: capability.acceptedBlockKinds[0],
    productBridge: '',
    seo: { primary: 'DELF B2写作', related: ['B2作文'] },
    knowledgeMode: 'educational_original',
    factTerms: ['DELF B2'],
    seedSignals: [],
    noveltyFingerprint: `humanizer-${theme}`,
    expandContents: fixture.blocks.flatMap(block => block.items),
  } as TopicOption;
  const content: ContentPackage = {
    coverBlocks: fixture.blocks.map((block, index) => ({
      id: `b${index + 1}`,
      kind: capability.acceptedBlockKinds[0],
      heading: block.heading,
      items: block.items.map(primary => ({ primary })),
      priority: index + 1,
      sourceMode: 'general_advice',
      sourceIds: [],
    })),
    innerPages: [{
      page_type: 'knowledge_list',
      page_title: fixture.topic,
      lead: fixture.promise,
      bullets: fixture.blocks.flatMap(block => block.items),
    }],
    captionParts: {
      opening: fixture.pain,
      value: [fixture.promise],
      productBridge: '',
      cta: '',
    },
    tagMaterial: [],
    factualClaims: [],
    frenchSegments: [],
  } as unknown as ContentPackage;
  return { topic, capability, content };
}

const outputRuns: Array<Record<string, unknown>> = [];
const themeRuns = process.env.HUMANIZER_THEME ? source.runs.filter(run => run.theme === process.env.HUMANIZER_THEME) : source.runs;
const selectedRuns = process.env.HUMANIZER_SINGLE_RUN === '1' ? themeRuns.slice(0, 1) : themeRuns;
for (const run of selectedRuns) {
  const inputs = run.accepted.map(pair => {
    const raw = run.raw.find(candidate => candidate.textTitle === pair.textTitle);
    return {
      pair,
      clickReason: raw?.clickReason || '',
      clickReasonType: raw?.clickReasonType || '',
    };
  });
  const result = await humanizeFinalTextTitlesForTest(inputs, buildInput(run.theme));
  const comparisons = inputs.map((item, index) => ({
    before: item.pair.textTitle,
    after: result.candidates[index]!.textTitle,
    proposed: result.audit[index]?.proposed || item.pair.textTitle,
    changed: item.pair.textTitle !== result.candidates[index]!.textTitle,
    clickReason: item.clickReason,
    coverFrozen: item.pair.coverTitle === result.candidates[index]!.coverTitle,
    subtitleFrozen: item.pair.coverSubtitle === result.candidates[index]!.coverSubtitle,
  }));
  outputRuns.push({
    theme: run.theme,
    repeat: run.repeat,
    comparisons,
    warnings: result.warnings,
  });
  console.log(`\n${run.theme} #${run.repeat}`);
  comparisons.forEach(row => console.log(`${row.changed ? 'CHANGED' : 'KEPT'} ${row.before} -> ${row.after}${row.proposed !== row.after ? ` (PROPOSED ${row.proposed})` : ''}`));
}

const output = {
  generated_at: new Date().toISOString(),
  source: 'final-title-v7-stability-results.json',
  experiment: 'v7 accepted candidates + narrow textTitle humanizer',
  runs: outputRuns,
};
fs.writeFileSync('final-title-humanizer-v2-stability-results.json', `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log('\nSaved final-title-humanizer-v2-stability-results.json');
