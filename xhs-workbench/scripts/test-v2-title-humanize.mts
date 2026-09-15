/* eslint-disable no-console */
// 最终标题创作节点离线验收：
// - 不读取旧候选，按当前封面模板独立创作最多6组三件套；
// - 程序不改字、不排序，单条硬错误只丢该条；
// - 整批0条可用时才技术返写一次；再次全灭回退上游候选；
// - legacy 路径不调用终审节点。
import { generateTitlePackage, TITLE_FINAL_EDITOR_PROMPT_VERSION, TITLE_TEXT_HUMANIZER_PROMPT_VERSION } from '../src/lib/v2/title-stage';
import { setTitleHumanizerPairsForTest, type TitleHumanizerPair } from '../src/lib/v2/title-humanizer-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { buildLockedProductionBrief } from '../src/lib/v2/content-brief';
import type { ContentPackage, TitlePair, TopicOption } from '../src/lib/v2/contracts';
import type { CompetitorCreativeCard } from '../src/types/reference-workflow';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) console.log(`  ok: ${message}`);
  else {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
delete process.env.AI_BRIDGE_DIR;
const realFetch = globalThis.fetch;
interface CapturedAiRequest { system: string; user: string; maxTokens?: number }
const captured: CapturedAiRequest[] = [];
const cannedQueue: unknown[] = [];
// 既有 v7 契约默认关闭新增节点；§5 单独打开并验证其窄输入/输出与回退行为。
setTitleHumanizerPairsForTest([]);
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
  const body = JSON.parse(init?.body || '{}') as { messages: Array<{ role: string; content: string }>; max_tokens?: number };
  captured.push({
    system: body.messages.find(message => message.role === 'system')?.content || '',
    user: body.messages.find(message => message.role === 'user')?.content || '',
    maxTokens: body.max_tokens,
  });
  const canned = cannedQueue.length > 1 ? cannedQueue.shift() : cannedQueue[0];
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(canned ?? {}) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    id: 'test-title-final-editor',
  }), { status: 200, headers: { 'Content-Type': 'application/json', 'x-request-id': 'test-title-final-editor' } });
}) as typeof fetch;

const card: CompetitorCreativeCard = {
  id: 'card_test_directory',
  name: '羊皮纸高密度资料目录',
  renderer_id: 'parchment_dense_directory',
  content_mechanism: '多分组知识体系',
  click_mechanism: '资料整理完整感',
} as CompetitorCreativeCard;
const capability = getCapabilityFallback(card);
const safeGoal = capability.allowedGoals.includes('search') ? 'search' : capability.allowedGoals[0];

function topic(overrides: Partial<TopicOption> = {}): TopicOption {
  return {
    id: 't-title-final',
    productId: 'delf_b2_writing',
    templateId: card.renderer_id,
    primaryGoal: safeGoal,
    topicLane: 'broad_pain',
    topic: 'DELF B2写作考场草稿怎么打才不浪费时间',
    audienceState: '正在准备DELF B2写作、考场时间紧的人',
    scene: '模拟考和真考动笔前',
    painOrDesire: '怕打草稿来不及写正文',
    promise: '有一套不打满全文的提纲写法',
    contentAngle: '多分组知识体系',
    plannedBlockKind: capability.acceptedBlockKinds[0],
    productBridge: '对应资料包中的对照整理模块',
    seo: { primary: 'DELF B2写作', related: ['DELF B2写作'] },
    knowledgeMode: 'educational_original',
    factTerms: ['DELF B2'],
    seedSignals: [],
    noveltyFingerprint: 'title-final-editor-fp-1',
    expandContents: ['草稿只写提示词', '列每段观点和例子提示', '把时间留给正式正文'],
    ...overrides,
  } as TopicOption;
}

const content: ContentPackage = {
  coverBlocks: [
    { id: 'b1', kind: capability.acceptedBlockKinds[0], heading: '草稿只写提示词', items: [{ primary: '不要在草稿里写完整句' }, { primary: '列每段观点词和例子词' }], priority: 1, sourceMode: 'general_advice', sourceIds: [] },
    { id: 'b2', kind: capability.acceptedBlockKinds[0], heading: '把时间留给正文', items: [{ primary: '超时就转正式书写' }, { primary: '最后留词数检查位' }], priority: 2, sourceMode: 'general_advice', sourceIds: [] },
  ],
  innerPages: [{ page_type: 'knowledge_list', page_title: '草稿提纲', lead: '提示词足够撑起正文。', bullets: ['先看题目要求', '再列观点提示', '最后留检查位'] }],
  captionParts: {
    opening: '考场上一打草稿就停不下来。',
    value: ['草稿只写提示词，不写完整句，把时间留给正文。'],
    productBridge: '整理好的资料可以按问题直接查。',
    cta: '',
  },
  tagMaterial: ['法语写作'],
  factualClaims: [],
  frenchSegments: [],
} as unknown as ContentPackage;

function initialCandidates(identity = 'DELF B2'): TitlePair[] {
  return [
    { textTitle: `${identity}写作草稿只写提示词不写整句`, coverTitle: `${identity}考场草稿打法`, coverSubtitle: '提示词代替完整句', mechanism: 'fast_path', userRelation: '考场时间紧的考生', seoKeyword: `${identity}写作草稿`, noveltyFingerprint: 'n1' },
    { textTitle: `${identity}写作打草稿总怕来不及写完`, coverTitle: `${identity}草稿来不及怎么办`, coverSubtitle: '草稿瘦身留时间', mechanism: 'pain', userRelation: '怕来不及写完的考生', seoKeyword: `${identity}草稿`, noveltyFingerprint: 'n2' },
    { textTitle: `${identity}写作提纲模板考前直接套用`, coverTitle: `${identity}写作提纲速查`, coverSubtitle: '提纲模板照关键词列', mechanism: 'material', userRelation: '考前想直接练提纲的考生', seoKeyword: `${identity}提纲`, noveltyFingerprint: 'n3' },
    { textTitle: `${identity}写作别再打满全文草稿`, coverTitle: `${identity}草稿不用写全文`, coverSubtitle: '提示词足够撑起正文', mechanism: 'counter', userRelation: '习惯打满全文草稿的考生', seoKeyword: `${identity}写作草稿`, noveltyFingerprint: 'n4' },
  ];
}

const finalGood = [
  { clickReasonType: '错误做法', clickReason: '把草稿写成完整句会挤占正式正文时间', textTitle: '拜托🙏 B2写作草稿别再抄整句了', coverTitle: 'DELF B2考场草稿打法', coverSubtitle: '提示词就能撑起正文' },
  { clickReasonType: '结果焦虑', clickReason: '草稿阶段没有停止点会导致正文时间被耗光', textTitle: '你的B2写作草稿总把正文时间耗光', coverTitle: 'DELF B2草稿瘦身法', coverSubtitle: '只留观点词和例子词' },
  { clickReasonType: '被说中场景', clickReason: '一开始打草稿就不断补句子而停不下来', textTitle: 'B2写作一打草稿就停不下来的人', coverTitle: 'DELF B2草稿怎么打', coverSubtitle: '超时就转正式书写' },
  { clickReasonType: '考场失控', clickReason: '草稿写得越满会让正式正文越赶', textTitle: '考场草稿写得越满，B2正文越赶', coverTitle: 'DELF B2草稿别写全文', coverSubtitle: '最后还要留检查位' },
];

const humanizerPairs: TitleHumanizerPair[] = [{
  before: 'B2作文没少写，为什么分数就是不涨？',
  after: '你的B2作文没少写，为什么分数就是不涨？',
  clickReason: '投入了大量练习但分数没有变化',
  voiceTags: ['直接对用户说', '被说中'],
  topicKeywords: ['B2', '作文'],
  track: 'delf_b2_writing',
}];

function reset(...responses: unknown[]) {
  captured.length = 0;
  cannedQueue.length = 0;
  cannedQueue.push(...responses);
}

async function run(inputTopic = topic(), candidateCount?: number, inputCapability = capability) {
  const productionBrief = buildLockedProductionBrief(inputTopic);
  return generateTitlePackage({
    topic: { ...inputTopic, productionBrief },
    capability: inputCapability,
    content: { ...content, productionBriefHash: productionBrief.briefHash },
    candidateCount,
  });
}

async function main() {
  console.log('\n== 1. 首轮直出：多候选、当前模板定向、原序保留 ==');
  assert(TITLE_FINAL_EDITOR_PROMPT_VERSION === 'v2-title-final-editor-8', '最终创作节点版本升级到有依据的情绪候选版');
  reset({ candidates: initialCandidates() }, { candidates: finalGood });
  const direct = await run();
  assert(captured.length === 2, `只有生成+最终创作两次调用（实际 ${captured.length}）`);
  const finalRequest = captured[1]!;
  const finalUser = JSON.parse(finalRequest.user) as Record<string, unknown>;
  assert(finalRequest.system.includes('可以独立创作') && finalRequest.system.includes('程序不会替你补语感、截字、改词或排序'), 'LLM 明知自己是独立创作的最后节点');
  assert(!('candidates' in finalUser) && !finalRequest.user.includes(initialCandidates()[0]!.textTitle), '终审入参不含旧候选，不背润色包袱');
  const template = finalUser.current_cover_template as Record<string, unknown>;
  assert(finalUser.candidate_count_max === 4 && template.renderer === 'parchment_dense_directory' && template.family === 'directory', '默认返回上限4组，且只注入当前封面模板');
  assert(finalRequest.system.includes('资料/知识资产型封面') && finalRequest.system.includes('不能写成平淡目录名'), '资料型封面同时要求具体资产和点击张力');
  assert(!finalRequest.system.includes('这是痛点大字封面') && !finalRequest.system.includes('封面保持当前模板要求的通知体裁'), '当前请求不携带其他封面类型的分支要求');
  assert(finalRequest.system.includes('最常见的旧认知、错误做法或具体困境') && finalRequest.system.includes('每个textTitle都必须触发一个清晰的用户心理反应'), 'prompt 固化认知落差到心理反应的创作链');
  assert(finalRequest.system.includes('本批至少写1组') && finalRequest.system.includes('禁止“DELF B2写作破防”'), '情绪候选有配额但禁止孤立贴情绪标签');
  assert(finalRequest.system.includes('clickReasonType只是表达角度') && finalRequest.system.includes('具体、完整、可由正文支持的因果或需求命题'), '终审区分角度标签与具体点击命题');
  assert(finalRequest.system.includes('同一个因果理由') && finalRequest.system.includes('语义上不同') && finalRequest.system.includes('正文只支持少数理由时宁可少返回'), '终审要求底层理由不同，不接受换标签冒充多样性');
  assert(finalRequest.system.includes('封面命名前必须先读取cover_asset_contract'), '终审先识别具体资产再命名封面');
  assert((finalUser.cover_asset_contract as Record<string, string>).required_cover_identity.includes('coverTitle 本身必须自然出现') && finalRequest.system.includes('这不是SEO软目标'), '封面身份作为独立必填契约注入，不依赖模型从长提示里自行找规则');
  assert(JSON.stringify(finalUser.actual_content).includes('草稿只写提示词') && JSON.stringify(finalUser.actual_content).includes('把时间留给正文'), '终审拿到正文事实与 caption，不靠旧标题猜内容');
  assert(JSON.stringify(finalUser.cover_asset_contract).includes('草稿只写提示词') && JSON.stringify(finalUser.cover_asset_contract).includes('观点词和例子词'), '资产契约包含正文对象、组成与场景，不由程序代写封面');
  assert(JSON.stringify(finalUser.cover_asset_contract).includes('信息流里只看到封面') && JSON.stringify(finalUser.cover_asset_contract).includes('离开上下文就不知所云'), '资产契约要求封面在小红书信息流中能单独看懂');
  assert(JSON.stringify(finalUser.click_reason_evidence).includes('怕打草稿来不及写正文') && JSON.stringify(finalUser.click_reason_evidence).includes('超时就转正式书写'), '点击理由证据显式带入主痛点与次级动作');
  assert(Array.isArray(finalUser.style_references) && finalUser.style_references.length === 6, '只放6条认可样本，减少注意力分散');
  assert(direct.data.candidates.length === 4 && direct.data.candidates.map(pair => pair.textTitle).join('|') === finalGood.map(pair => pair.textTitle).join('|'), '全部合格候选按LLM原始顺序进入产物');
  assert(direct.data.selected.textTitle === finalGood[0]!.textTitle, '首条仅作为现有UI默认选中，不进行程序评分重排');
  assert(direct.warnings.some(warning => warning.includes('首轮返回4组') && warning.includes('程序未改字')), 'warning 记录多候选直出且程序未改字');

  console.log('\n== 1.1 上游零候选：独立终审仍可直接救活 ==');
  reset({ candidates: [] }, { candidates: finalGood.slice(0, 2) });
  const independent = await run(topic({ noveltyFingerprint: 'title-final-editor-empty-upstream' }));
  assert(captured.length === 2, '上游返回零候选时仍直接调用独立终审，不先要求候选存在');
  assert(independent.data.selected.textTitle === finalGood[0]!.textTitle && independent.data.candidates.length === 2, '零候选不阻断终审多组终稿上线');
  assert(independent.warnings.some(warning => warning.includes('上游标题候选未通过') && warning.includes('独立标题终审')), 'warning 说明由独立终审救活');

  console.log('\n== 1.2 模板分流：痛点封面只拿痛点规则 ==');
  const painCard = {
    id: 'card_test_pain', name: '手写本痛点大字', renderer_id: 'notebook_big_words',
    content_mechanism: '痛点递进', click_mechanism: '具体场景共鸣',
  } as CompetitorCreativeCard;
  const painCapability = getCapabilityFallback(painCard);
  const painTopic = topic({
    templateId: painCard.renderer_id,
    plannedBlockKind: painCapability.acceptedBlockKinds[0],
    noveltyFingerprint: 'title-final-editor-pain-template',
  });
  reset({ candidates: initialCandidates() }, { candidates: finalGood.slice(0, 2) });
  await run(painTopic, undefined, painCapability);
  const painRequest = captured.find(request => request.system.includes('可以独立创作的小红书标题编辑'))!;
  const painUser = JSON.parse(painRequest.user) as { current_cover_template: { renderer?: string } };
  assert(painUser.current_cover_template.renderer === 'notebook_big_words' && painRequest.system.includes('这是痛点大字封面'), '痛点 renderer 注入自己的模板契约和分工');
  assert(!painRequest.system.includes('这是资料/知识资产型封面') && !painRequest.system.includes('封面保持当前模板要求的通知体裁'), '痛点请求不携带资料型或通知型规则');

  console.log('\n== 2. 部分坏项：只丢坏项，不整批返写 ==');
  const missingSubtitle = { ...finalGood[1], coverSubtitle: '' };
  const contextlessCover = { ...finalGood[2], coverTitle: '观点和例子之间要补一座桥', coverSubtitle: '加一句分析，论证才完整' };
  reset({ candidates: initialCandidates() }, { candidates: [finalGood[0], missingSubtitle, contextlessCover, finalGood[3]] });
  const partial = await run(topic({ noveltyFingerprint: 'title-final-editor-partial' }));
  assert(captured.length === 2, '只要有合格候选就不触发技术返写');
  assert(partial.data.candidates.length === 2 && partial.data.candidates[0]!.textTitle === finalGood[0]!.textTitle && partial.data.candidates[1]!.textTitle === finalGood[3]!.textTitle, '只丢客观硬错误项，其余候选保持原序');
  assert(partial.warnings.some(warning => warning.includes('2组因客观硬错误被丢弃') && warning.includes('未触发整批返写')), '空字段与脱离正文不知领域的封面均只丢单项，warning 如实记录');

  console.log('\n== 2.1 具体 clickReason 重复：即使类型不同也只保留首条 ==');
  reset({ candidates: initialCandidates() }, { candidates: [finalGood[0], { ...finalGood[1], clickReasonType: '即时收益', clickReason: finalGood[0]!.clickReason }, finalGood[2]] });
  const dedupedReason = await run(topic({ noveltyFingerprint: 'title-final-editor-click-reason-dedupe' }));
  assert(dedupedReason.data.candidates.length === 2 && dedupedReason.data.candidates[0]!.textTitle === finalGood[0]!.textTitle && dedupedReason.data.candidates[1]!.textTitle === finalGood[2]!.textTitle, '相同clickReason只保留首条，程序不改标题也不重排');
  assert(dedupedReason.warnings.some(warning => warning.includes('具体clickReason完全重复') && warning.includes('未进入用户候选')), '重复具体命题按少返回口径记录 warning');

  console.log('\n== 2.2 「来不及」完整口语：最终技术验收放行 ==');
  const naturalTail = { clickReason: '结果焦虑', textTitle: 'B2写作草稿写太满，正文来不及', coverTitle: 'DELF B2考场草稿法', coverSubtitle: '只写提示词，把时间留给正文' };
  reset({ candidates: initialCandidates() }, { candidates: [naturalTail] });
  const naturalTailResult = await run(topic({ noveltyFingerprint: 'title-final-editor-natural-tail' }));
  assert(naturalTailResult.data.candidates.length === 1 && naturalTailResult.data.selected.textTitle === naturalTail.textTitle, '「来不及」不再被“及”尾规则误删');

  console.log('\n== 2.3 「这一步」是指代，不作为无来源数量1误杀 ==');
  const demonstrativeStep = { clickReasonType: '具体方法', clickReason: '给草稿设置停止点可以避免正文时间被耗光', textTitle: 'B2写作草稿卡住？你缺这一步', coverTitle: 'DELF B2考场草稿法', coverSubtitle: '超时就转正式书写' };
  reset({ candidates: initialCandidates() }, { candidates: [demonstrativeStep] });
  const demonstrativeStepResult = await run(topic({ noveltyFingerprint: 'title-final-editor-demonstrative-step' }));
  assert(demonstrativeStepResult.data.candidates.length === 1 && demonstrativeStepResult.data.selected.textTitle === demonstrativeStep.textTitle, '「这一步」不再被归一化为未经支持的数量1');

  console.log('\n== 3. 整批全灭：只技术返写一次；再次失败回退上游 ==');
  const allBad = [{ ...finalGood[0], coverSubtitle: '' }, { ...finalGood[1], coverTitle: 'DELF B2草稿只写提示词不要写完整句把时间留给正式正文' }];
  reset({ candidates: initialCandidates() }, { candidates: allBad }, { candidates: finalGood.slice(0, 3) });
  const rewritten = await run(topic({ noveltyFingerprint: 'title-final-editor-retry' }));
  assert(captured.length === 3, '整批0条可用时才增加一次技术返写');
  const retryUser = JSON.parse(captured[2]!.user) as Record<string, unknown>;
  assert(Array.isArray(retryUser.rejected_candidates) && JSON.stringify(retryUser.rejected_candidates).includes('非空字符串') && JSON.stringify(retryUser.rejected_candidates).includes('物理上限'), '返写只携带客观硬错误及原始拒收项');
  assert(rewritten.data.candidates.length === 3 && rewritten.data.selected.textTitle === finalGood[0]!.textTitle, '技术返写合格后按原序返回全部可用项');

  reset({ candidates: initialCandidates() }, { candidates: allBad }, { candidates: allBad });
  const fallback = await run(topic({ noveltyFingerprint: 'title-final-editor-fp-3' }));
  assert(captured.length === 3, '最终创作最多首轮加一次技术返写，不无限调用');
  assert(fallback.data.candidates.length > 0 && fallback.data.candidates.every(pair => !allBad.some(bad => bad.textTitle === pair.textTitle)), '两轮全灭后完整回退上游候选，不制造截断版终稿');
  assert(fallback.warnings.some(warning => warning.includes('首轮与一次技术返写均为0组可用') && warning.includes('转人工复核')), '两轮失败明确回退并转人工');

  console.log('\n== 4. legacy 隔离：商品2不调用最终终审 ==');
  const legacyTopic = topic({
    id: 't-title-final-legacy',
    productId: 'tef_tcf_canada',
    topic: 'TEF/TCF写作考场草稿怎么打',
    seo: { primary: 'TEF/TCF写作', related: ['TEF写作', 'TCF写作'] },
    noveltyFingerprint: 'title-final-editor-legacy',
  });
  reset({ candidates: initialCandidates('TEF/TCF') });
  await run(legacyTopic);
  assert(captured.length === 1, 'legacy 全程仍只有原生成调用');
  assert(!captured.some(request => request.system.includes('可以独立创作的小红书标题编辑')), 'legacy 不进入新终审节点');

  console.log('\n== 5. 极窄 textTitle Humanizer：冻结封面/理由，部分失败逐条回退 ==');
  setTitleHumanizerPairsForTest(humanizerPairs);
  const humanizedOne = '拜托🙏 B2写作草稿别抄整句了';
  reset(
    { candidates: initialCandidates() },
    { candidates: finalGood.slice(0, 3) },
    { candidates: [
      { id: 'c1', textTitle: humanizedOne },
      { id: 'c2', textTitle: 'B2写作草稿3分钟搞定正文' },
      // c3 缺失：也必须只回退该条，不能拖累 c1。
    ] },
  );
  const humanized = await run(topic({ noveltyFingerprint: 'title-text-humanizer-partial' }));
  assert(TITLE_TEXT_HUMANIZER_PROMPT_VERSION === 'v2-title-text-humanizer-2', 'Humanizer 使用独立版本号（自然身份关键词软目标）');
  assert(captured.length === 3, `生成+v7终审+Humanizer 共3次调用（实际 ${captured.length}）`);
  const humanizerRequest = captured[2]!;
  const humanizerUser = JSON.parse(humanizerRequest.user) as Record<string, any>;
  assert(humanizerRequest.system.includes('极窄的textTitle口语化编辑') && humanizerRequest.system.includes('不是标题策划'), 'Humanizer 任务边界只负责 social voice');
  assert(Array.isArray(humanizerUser.approved_before_after_pairs) && humanizerUser.approved_before_after_pairs[0].editor_voice && humanizerUser.approved_before_after_pairs[0].human_voice, 'Humanizer 使用用户认可的同语义前后对照样本');
  assert(JSON.stringify(humanizerUser.preferred_identity_keywords) === JSON.stringify(['B2写作', 'B2作文', 'DELF B2写作']), 'Humanizer 收到当前商品的自然身份关键词候选');
  assert(Array.isArray(humanizerUser.preferred_topic_search_phrases), 'Humanizer 的小红书相关搜索词按正文动态路由');
  assert(!humanizerUser.preferred_topic_search_phrases.some((value: string) => value.includes('真题') || value.includes('招聘会')), '正文未支持的搜索联想词不进入 Humanizer');
  assert(humanizerRequest.system.includes('关键词是软目标，不是硬任务') && humanizerRequest.system.includes('就宁可不加'), '关键词只作软目标，不因SEO牺牲语感');
  assert(humanizerUser.candidates.every((item: any) => item.id && item.clickReason && item.originalTextTitle && item.frozenCoverTitle && item.frozenCoverSubtitle), '输入显式携带冻结理由、封面与副题');
  assert(humanizerRequest.system.includes('不得输出封面字段'), '输出 schema 不允许模型重写封面');
  assert(humanized.data.candidates[0]!.textTitle === humanizedOne, '客观验收通过的 textTitle 改写被采用');
  assert(humanized.data.candidates[1]!.textTitle === 'B2写作草稿3分钟搞定正文', '新增无来源数字的改写不回退，只保留并进入人工核验');
  assert(humanized.warnings.some(warning => warning.includes('正文未明确支撑的数字')), '无来源数字保留后给出人工核验警告');
  assert(humanized.data.candidates[2]!.textTitle === finalGood[2]!.textTitle, '模型漏返回的槽位逐条回退 v7 原文');
  assert(humanized.data.candidates.every((pair, index) => pair.coverTitle === finalGood[index]!.coverTitle && pair.coverSubtitle === finalGood[index]!.coverSubtitle), 'coverTitle 与 coverSubtitle 由程序冻结，改写前后逐字一致');
  assert(humanized.warnings.some(warning => warning.includes('2/3条采用改写') && warning.includes('逐条回退v7原文')), 'warning 如实记录采用率与结构性逐条回退');

  console.log('\n== 5.1 Humanizer 无有效返回：整批保持 v7 原文 ==');
  reset(
    { candidates: initialCandidates() },
    { candidates: finalGood.slice(0, 2) },
    { nope: true },
  );
  const unchanged = await run(topic({ noveltyFingerprint: 'title-text-humanizer-fallback' }));
  assert(unchanged.data.candidates.map(pair => pair.textTitle).join('|') === finalGood.slice(0, 2).map(item => item.textTitle).join('|'), 'Humanizer 无有效返回时整批保持 v7 原文');
  assert(unchanged.warnings.some(warning => warning.includes('0/2条采用改写') && warning.includes('逐条回退v7原文')), '无有效槽位时 warning 不伪称已活人化');

  globalThis.fetch = realFetch;
  setTitleHumanizerPairsForTest(null);
  if (failures) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exitCode = 1;
  } else {
    console.log('\nAll final title editor assertions passed.');
  }
}

main().catch(error => {
  globalThis.fetch = realFetch;
  setTitleHumanizerPairsForTest(null);
  console.error(error);
  process.exitCode = 1;
});
