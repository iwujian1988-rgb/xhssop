import { assessStandardKnowledgeBundleIntentForTest } from '../src/lib/v2/title-stage';
import type { TitlePair } from '../src/lib/v2/contracts';

function pair(overrides: Partial<TitlePair>): TitlePair {
  return {
    textTitle: '',
    coverTitle: '',
    coverSubtitle: '',
    mechanism: 'test',
    userRelation: 'test',
    noveltyFingerprint: 'test',
    ...overrides,
  };
}

const cases = [
  {
    name: 'argument_bank_complementary_fields',
    expectedPass: true,
    value: pair({
      bundleIntent: '环保题没有观点，通过现成论据库获得可调用素材',
      textTitle: '环保题一看到就没观点？',
      coverTitle: 'B2写作万能论据库',
      coverSubtitle: '5大高频话题｜正反观点｜通用案例',
    }),
  },
  {
    name: 'precise_wording_complementary_fields',
    expectedPass: true,
    value: pair({
      bundleIntent: '高级词堆砌导致表达生硬，精准选词更重要',
      textTitle: '高级词一写就很硬，问题可能不在词汇量',
      coverTitle: 'B2写作别堆砌大词！',
      coverSubtitle: '按表达功能选词｜口语到书面对照',
    }),
  },
  {
    name: 'semantic_switch_is_not_faked_by_local_keywords',
    expectedPass: true,
    value: pair({
      bundleIntent: '精准用词比生僻词重要',
      textTitle: 'B2写作精准用词才重要',
      coverTitle: 'B2投诉信像微信聊天？',
      coverSubtitle: '投诉信语气与称呼整理',
    }),
  },
];

const results = cases.map(item => {
  const failures = assessStandardKnowledgeBundleIntentForTest(item.value);
  const pass = failures.length === 0;
  return { name: item.name, expectedPass: item.expectedPass, pass, failures };
});

console.log(JSON.stringify(results, null, 2));
if (results.some(item => item.pass !== item.expectedPass)) process.exitCode = 1;
