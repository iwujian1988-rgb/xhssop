/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { inspectForPublish, isReleaseBlockingIssue } from '../src/lib/v2/publish-guard';

const evidence = [
  {
    id: 'OFF-TEF-CANADA-001', category: 'official_exam_fact',
    text: 'TEF Canada 听力 40 题 40 分钟。', evidence: '40 questions, 40 minutes',
    source_file: 'official', source_section: 'TEF Canada 科目', score: 50,
  },
  {
    id: 'OFF-TCF-CANADA-001', category: 'official_exam_fact',
    text: 'TCF Canada 听力 39 题 35 分钟。', evidence: '39 questions, 35 minutes',
    source_file: 'official', source_section: 'TCF Canada 科目', score: 50,
  },
  {
    id: 'OFF-TEF-CANADA-003', category: 'official_exam_fact',
    text: 'TEF Canada 口语A部分获取信息，B部分说服对方，总时长15分钟。', evidence: 'obtain information; persuade; 15 minutes',
    source_file: 'official', source_section: 'TEF Canada 口语', score: 50,
  },
  {
    id: 'OFF-TEF-CANADA-002', category: 'official_exam_fact',
    text: 'TEF Canada 写作共2部分，A部分至少80词，B部分至少200词。', evidence: '2 sections; 80 words; 200 words',
    source_file: 'official', source_section: 'TEF Canada 写作', score: 50,
  },
  {
    id: 'OFF-TCF-CANADA-002', category: 'official_exam_fact',
    text: 'TCF Canada口语共3道题，总时长12分钟；第3题为无准备地表达观点。', evidence: '3 tasks; 12 minutes; task 3 express an opinion without preparation',
    source_file: 'official', source_section: 'TCF Canada 口语', score: 50,
  },
  {
    id: 'TS-001', category: 'raw_selling_points',
    text: '12份资料按备考旅程组织。', evidence: '01到12共12个主题文件。',
    source_file: 'product', source_section: '12份资料', score: 50,
  },
] as any;

const capability = {
  acceptedBlockKinds: ['directory_group'],
  densityTiers: [{ sectionRange: [1, 2], itemRange: [1, 4], primaryVisualLength: [2, 20], secondaryVisualLength: [0, 30] }],
} as any;
const topic = {
  seo: { primary: 'TEF还是TCF', related: [] },
  topic: 'TEF还是TCF', promise: '看懂两种考试结构',
} as any;

function content(bullet: string, productBridge = '这套资料把选考和练习路径整理到一起，复习时按当前问题查找即可。') {
  return {
    coverBlocks: [{ id: 'b1', kind: 'directory_group', heading: '考试对比', priority: 1, sourceMode: 'ai_original', sourceIds: [], items: [{ primary: '结构', secondary: '先看科目和时长', note: '' }] }],
    innerPages: [
      { page_type: 'knowledge_list', page_title: 'TCF Canada 科目', lead: '先核对官方结构。', bullets: [bullet], source_ids: [] },
      { page_type: 'knowledge_list', page_title: '选择步骤', lead: '再结合目标项目判断。', bullets: ['先查项目要求', '再做官方样题', '最后比较任务形式'], source_ids: [] },
    ],
    captionParts: {
      opening: 'TEF还是TCF，先别凭别人一句推荐做决定。两种考试都能用于加拿大法语成绩证明，具体仍要看目标项目。',
      value: [
        '先把阅读、听力、写作和口语的题量与时长列在一张表里，再标出自己最不适应的任务形式。这样比较的是实际考试体验。',
        '接着分别做一套官方样题。记录读题速度、临场组织和口语互动感受，比只看网上一句哪个更简单更有参考价值。',
        '最后核对申请项目认可的考试和所需等级，再决定报名。目标要求、题型体验和当前基础三项放在一起，选择会清楚很多。',
      ],
      productBridge,
      cta: '完整内容已经放在商品里，需要的话可以点小黄车看详情。',
    },
    tagMaterial: [], factualClaims: [], frenchSegments: [],
  } as any;
}

const correct = inspectForPublish(content('TCF Canada 听力39题35分钟。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(correct.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(correct.hardIssues));

const practiceStructure = inspectForPublish(content('练习示例：针对TEF口语B部分，可先陈述立场，再用两个论据支撑。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(practiceStructure.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, '练习示例中的论据数量不能被误判成官方考试数字');

const wrong = inspectForPublish(content('TCF Canada 听力39题40分钟。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(wrong.hardIssues.some(item => item.code === 'unsupported_exam_fact'), true, 'TCF 40分钟必须被拦截，不能借用TEF的40分钟');

const productFact = inspectForPublish(content('TCF Canada 听力39题35分钟。', '这套12份资料按备考旅程整理，复习时按当前问题查找即可。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(productFact.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(productFact.hardIssues));
assert.equal(productFact.hardIssues.some(item => item.code === 'product_bridge_not_grounded'), false, JSON.stringify(productFact.hardIssues));

const weakBridge = inspectForPublish(content('TCF Canada 听力39题35分钟。', '资料已经整理好了，需要的话可以看看。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(weakBridge.hardIssues.some(item => item.code === 'product_bridge_not_grounded'), false, '有真实商品证据时，空泛承接应自动落到具体资料资产');
assert.equal(weakBridge.content.captionParts.productBridge.includes('12份资料'), true, '自动承接必须直接引用真实资料资产');

const missingSeoContent = content('TCF Canada 听力39题35分钟。');
missingSeoContent.captionParts.opening = '选考试前先查目标项目，再看题型是否适合自己。';
const missingSeo = inspectForPublish(missingSeoContent, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(missingSeo.hardIssues.some(item => item.code === 'seo_missing_from_opening'), false, '正文开头漏SEO词时应复用已审核选题自然补齐，不得只提醒');
assert.match(missingSeo.content.captionParts.opening, /TEF还是TCF/, '修复后的开头必须包含主搜索词');

const incompleteEnumerationContent = content('TCF Canada 听力39题35分钟。');
incompleteEnumerationContent.innerPages[0].page_title = '9类常见错误自查';
incompleteEnumerationContent.innerPages[0].lead = '下面逐类检查。';
incompleteEnumerationContent.innerPages[0].bullets = Array.from({ length: 8 }, (_, index) => `第${index + 1}类错误`);
const incompleteEnumeration = inspectForPublish(incompleteEnumerationContent, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(incompleteEnumeration.hardIssues.some(item => item.code === 'inner_page_enumeration_incomplete'), false, '页面数量未列全时应本地移除数量承诺，不得浪费模型返修');
assert.equal(incompleteEnumeration.content.innerPages[0].page_title.includes('9类'), false, '本地降级后不得继续声称列全9类');
assert.equal(incompleteEnumeration.warnings.some(item => item.includes('已移除未兑现')), true, '本地降级必须留下可见提醒');

const clicheContent = content('TCF Canada 听力39题35分钟。');
clicheContent.captionParts.value[0] = '选考试不是看别人选什么，而是要看自己的目标项目和任务适应度。';
const cliche = inspectForPublish(clicheContent, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(cliche.hardIssues.some(item => item.code === 'ai_cliche_visible'), false, '已知AI套话应本地清理，不应浪费一次模型返修');
assert.equal(cliche.content.captionParts.value[0].includes('不是'), false, '本地清理后不得残留“不是…而是…”句式');

const disclaimer = inspectForPublish(content('这是练习示例，不代表官方评分标准。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(disclaimer.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(disclaimer.hardIssues));

const shortDisclaimerContent = content('先核对目标项目，再体验官方样题。');
shortDisclaimerContent.innerPages[0].page_title = '备考练习自查清单（非官方评分标准）';
const shortDisclaimer = inspectForPublish(shortDisclaimerContent, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(shortDisclaimer.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, '“非官方评分标准”是免责声明，不得触发事实返修');

const incompleteTransformationContent = content('先补理由，再补例子。');
incompleteTransformationContent.innerPages[0].page_title = '从150词扩到250词';
const incompleteTransformation = inspectForPublish(incompleteTransformationContent, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(incompleteTransformation.hardIssues.some(item => item.code === 'word_count_transformation_without_full_example'), true, '没有250词完整示例时不得承诺从150词扩到250词');

const paddingContent = content('先补理由，再补例子。');
paddingContent.innerPages[0].lead = '用不同表达方式展开同一观点，每换一个说法就能增加内容。';
const padding = inspectForPublish(paddingContent, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(padding.hardIssues.some(item => item.code === 'content_padding_by_paraphrase'), true, '不得把重复改写同一观点当成扩写方法');

const correctOral = inspectForPublish(content('TEF Canada口语A部分获取信息，B部分说服对方。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(correctOral.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(correctOral.hardIssues));

const correctOralPractice = inspectForPublish(content('练习示例：模拟TEF口语B部分，论证一个观点并说服对方，持续10分钟。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(correctOralPractice.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(correctOralPractice.hardIssues));

const unsupportedPracticeTime = inspectForPublish(content('练习示例：模拟TCF口语第3题，无准备表达个人观点，限时3分钟。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(unsupportedPracticeTime.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(unsupportedPracticeTime.hardIssues));
assert.equal(unsupportedPracticeTime.content.innerPages[0].bullets[0].includes('3分钟'), false, '练习示例中的无依据时长必须本地删除');
assert.match(unsupportedPracticeTime.content.innerPages[0].bullets[0], /表达个人观点/, '删除无依据数字后必须保留练习动作');

const wrongOral = inspectForPublish(content('TEF Canada口语第一部分自我介绍和日常话题，第二部分表达观点。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(wrongOral.hardIssues.some(item => item.code === 'unsupported_exam_fact'), true, 'TEF口语不得被写成自我介绍和日常话题');

const correctUnit = inspectForPublish(content('TEF Canada写作共2部分。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(correctUnit.hardIssues.some(item => item.code === 'risky_fact_not_registered'), false, JSON.stringify(correctUnit.hardIssues));

const wrongUnit = inspectForPublish(content('TEF Canada写作共2题。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(wrongUnit.hardIssues.some(item => item.code === 'unsupported_exam_fact'), true, '官方2部分不能给2题兜底');

const simplisticChoice = inspectForPublish(content('如果擅长写长文，TEF更适合你。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(simplisticChoice.hardIssues.some(item => item.code === 'oversimplified_exam_choice'), true, '不得用单一强项武断推荐考试');

const simplisticBridge = inspectForPublish(content('TCF Canada 听力39题35分钟。', '这套12份资料按备考旅程整理，喜欢长篇论证就选TEF，更适合你。'), { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(simplisticBridge.hardIssues.some(item => item.code === 'oversimplified_exam_choice'), false, '商品承接不得因为武断选考建议导致整篇失败，应自动改成中性决策动作');
assert.match(simplisticBridge.content.captionParts.productBridge, /目标项目认可范围和官方样题/, '自动承接必须保留可靠的选考决策动作');

const oneLongCoverCandidate = content('TCF Canada 听力39题35分钟。');
oneLongCoverCandidate.coverBlocks[0].items.push({ primary: '短条目', secondary: '先看目标项目，再分别体验两种考试的官方样题和真实任务形式后决定', note: '' });
const compiledCoverCandidate = inspectForPublish(oneLongCoverCandidate, { productId: 'tef_tcf_canada', topic, capability, evidence });
assert.equal(compiledCoverCandidate.hardIssues.some(item => item.code === 'cover_secondary_too_long'), false, '候选池中的长解释应由编译器转入内页，不能直接判整篇失败');
assert.equal(compiledCoverCandidate.warnings.some(item => item.includes('封面长副条目将转入内页')), true, '长解释转内页必须留下可见提醒');

assert.equal(wrong.hardIssues.filter(isReleaseBlockingIssue).some(item => item.code === 'unsupported_exam_fact'), true, '考试事实错误必须始终拦截');

console.log(JSON.stringify({ ok: true, assertions: 31 }, null, 2));
