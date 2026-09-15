/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { diagnoseTitlePair, selectTitleCandidateForTest } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentPackage, TitlePair, TopicOption } from '../src/lib/v2/contracts';

const tefCandidates: TitlePair[] = [
  {
    textTitle: 'TEF还是TCF？先看目标项目再选',
    coverTitle: 'TEF/TCF报名前先看项目',
    coverSubtitle: '两种考试都获认可，题型结构逐项对照',
    mechanism: '目标项目优先',
    userRelation: '担心选错考试的加拿大法语考生',
    seoKeyword: 'TEF还是TCF',
    noveltyFingerprint: '目标项目|选考依据',
  },
  {
    textTitle: 'TEF和TCF怎么选？一张表看完再决定',
    coverTitle: 'TEF/TCF选考别选错',
    coverSubtitle: '结构题型逐项对照，再按目标项目决定',
    mechanism: '对照决策',
    userRelation: '正在纠结两种考试的考生',
    seoKeyword: 'TEF和TCF怎么选',
    noveltyFingerprint: '一张表|选考依据',
  },
];
const delfCandidates: TitlePair[] = [
  {
    textTitle: 'DELF B2写作总差几十词？先补这3层',
    coverTitle: 'DELF B2写作考前别硬凑字数',
    coverSubtitle: '观点、例证、让步逐层展开，写够250词',
    mechanism: '考前痛点拦截',
    userRelation: '写作结构完整但总写不够250词的考生',
    seoKeyword: 'DELF B2写作字数',
    noveltyFingerprint: '字数不足|三层展开',
  },
  {
    textTitle: 'DELF B2写作字数不够？这3层最该补',
    coverTitle: 'DELF B2考前写不够250词',
    coverSubtitle: '不靠重复句，把论证真正展开',
    mechanism: '结果型自查',
    userRelation: '计时练习总差一点字数的考生',
    seoKeyword: 'DELF B2写作250词',
    noveltyFingerprint: '写不够|展开顺序',
  },
];

const cases = [
  { source: 'v2-real-smoke-tef-publishable.json', product: 'tef_tcf_canada', candidates: tefCandidates },
  { source: 'v2-real-smoke-latest.json', product: 'delf_b2_writing', candidates: delfCandidates },
];
const results = [];
const rejectedResults = [];
const rankingResults = [];
for (const testCase of cases) {
  const source = JSON.parse(await fs.readFile(testCase.source, 'utf8')) as Array<Record<string, any>>;
  const item = source.find(entry => entry.product_id === testCase.product && entry.artifacts?.content?.data && entry.topic?.v2_topic);
  if (!item) throw new Error(`缺少可复用内容产物：${testCase.product}`);
  const card = getCompetitorCreativeCard(item.reference_card_id);
  if (!card) throw new Error(`缺少竞品创作卡：${item.reference_card_id}`);
  const input = {
    topic: item.topic.v2_topic as TopicOption,
    capability: getCapabilityFallback(card),
    content: item.artifacts.content.data as ContentPackage,
  };
  results.push(...testCase.candidates.map(candidate => ({ product: testCase.product, candidate, failures: diagnoseTitlePair(candidate, input) })));
  if (testCase.product === 'delf_b2_writing') {
    const awkward: TitlePair = {
      textTitle: 'DELF B2写作语法错9类',
      coverTitle: 'DELF B2写作36项清单查短板',
      coverSubtitle: '覆盖5个评分维度',
      mechanism: '清单',
      userRelation: '不知道短板的考生',
      seoKeyword: 'DELF B2写作清单',
      noveltyFingerprint: '清单|短板',
    };
    rejectedResults.push({ candidate: awkward, failures: diagnoseTitlePair(awkward, input) });
    const repeated: TitlePair = {
      textTitle: 'DELF B2写作练完没底？36项自查',
      coverTitle: 'DELF B2写作没底？36项自查',
      coverSubtitle: '逐项核对写作问题',
      mechanism: 'search_utility',
      userRelation: '写完作文心里没底的考生',
      seoKeyword: 'DELF B2写作自查',
      noveltyFingerprint: '没底|自查',
    };
    const fresh: TitlePair = {
      textTitle: 'DELF B2写作评分要点都在这页',
      coverTitle: 'DELF B2写作评分要点速查',
      coverSubtitle: '交卷前按评分维度逐项核对',
      mechanism: 'search_utility',
      userRelation: '准备按评分要求检查作文的考生',
      seoKeyword: 'DELF B2写作评分',
      noveltyFingerprint: '评分|速查',
    };
    const recentRecords = Array.from({ length: 5 }, (_, index) => ({
      title: index % 2 ? 'DELF B2写作写完心里没底？' : 'DELF B2写作总没把握？',
      cover_title: index % 2 ? 'DELF B2写作短板自查' : 'DELF B2写作没底先自查',
    }));
    const selected = selectTitleCandidateForTest([repeated, fresh], input, recentRecords);
    rankingResults.push({ selected, expected: fresh.textTitle });
  }
}
if (
  results.some(result => result.failures.length > 0)
  || rejectedResults.some(result => result.failures.length === 0)
  || rankingResults.some(result => result.selected.textTitle !== result.expected)
) {
  console.error(JSON.stringify({ ok: false, results, rejectedResults, rankingResults }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, results, rejectedResults, rankingResults }, null, 2));
}
