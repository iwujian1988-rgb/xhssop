import { standardCreativeCards } from '@/lib/creative-card-library';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, mergeAiUsage, type AiResponseTrace, type AiUsageSummary } from '@/lib/ai-client';
import { coverCapacityFailure, coverVisualDensity, coverVisualFullnessFailure, getCoverTemplateSpec, minimumAverageCoverItemUnits, type CoverTemplateSpec, type CoverVisualDensity } from '@/lib/cover-template-specs';
import { getProductPromptProfile, hasForbiddenProductIdentity } from '@/lib/product-prompt-profiles';
import type { EvidenceSnippet, GeneratedInnerPage } from '@/types/reference-workflow';
import { stableHash, type BridgePlan, type ContentBlock, type ContentBlockKind, type ContentPackage, type TemplateCapability, type TopicOption, type UserVisiblePagePlan, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { assertLockedProductionBrief, buildConsensusBriefBlock, resolveContentBriefActive } from './content-brief';
import type { PublishIssue } from './publish-guard';
import type { ProductShowcasePlan } from '@/lib/product-showcase-library';
import { semanticLayoutTypeFromAssetType } from './semantic-layout';
import { CAPTION_LINK_CTA, resolveConversionMode, singleCaptionCta, ensureCaptionSeo, type ConversionMode } from './conversion';
import { selectProductPromo } from './product-promo';
import { currentNoteBoundary, NOTE_DELIVERY_RULE } from './note-fact-boundary';
import { matchProductInnerEvidenceCards } from './product-evidence-matcher';
import type { EvidenceCardMatch } from './evidence-card-matcher';
import { PRODUCTION_TEXT_MODEL } from './production-models';
import { examScopeContext } from '@/lib/product-exam-context';

export const CONTENT_PROMPT_VERSION = 'v2-content-12-evidence-card-boundary';
export const AUDIT_PROMPT_VERSION = 'v2-audit-3-objective-french-only';

async function writeFinalContentTrace(requestId: string, fileName: string, value: unknown) {
  try {
    const safeRequestId = requestId.replace(/[^a-zA-Z0-9._-]/gu, '_');
    const directory = path.join(process.cwd(), 'data', 'final-content-traces', safeRequestId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, fileName), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } catch (traceError) {
    console.warn('[FINAL CONTENT TRACE skipped]', traceError instanceof Error ? traceError.message : String(traceError));
  }
}

interface ContentStageInput {
  topic: TopicOption;
  capability: TemplateCapability;
  evidence: EvidenceSnippet[];
  recentAngles?: string[];
  recentCoverTemplateIds?: string[];
  /** 已发布/同批次刚完成的正文收尾，供 CTA 避免复读。 */
  recentCaptionEndings?: string[];
  showcasePlan?: ProductShowcasePlan;
}

interface RawContentResponse {
  pagePlan?: unknown[];
  coverBlocks?: Array<Partial<ContentBlock> & Record<string, unknown>>;
  innerPages?: unknown[];
  inner_pages?: unknown[];
  pages?: unknown[];
  captionParts?: ContentPackage['captionParts'] | Array<{ text?: string }>;
  tagMaterial?: unknown;
  factualClaims?: Array<Partial<ContentPackage['factualClaims'][number]> & { claim?: string }>;
  frenchSegments?: Array<Partial<ContentPackage['frenchSegments'][number]> & { original?: string }>;
  bridgePlan?: Partial<BridgePlan>;
}

interface RawPagePlanResponse {
  pages?: unknown[];
}

function buildWholeNoteCore(input: Pick<ContentStageInput, 'topic'>) {
  const scope = examScopeContext(input.topic.productId, input.topic.examScope);
  const identity = scope?.displayIdentity || getProductPromptProfile(input.topic.productId).shortIdentity;
  const topic = input.topic.topic.trim();
  const promise = input.topic.promise?.trim();
  return `${identity}：${promise || topic}`;
}

interface RawWholeNoteEditorialResponse {
  issues?: string[];
  deletePageIds?: string[];
  pageRepairs?: Array<{
    pageId?: string;
    pageGoal?: string;
    userGets?: string;
    pageContentPlan?: string;
    page_title?: string;
    lead?: string;
    bullets?: string[];
    semanticLayoutType?: string;
    renderPayload?: GeneratedInnerPage['renderPayload'];
    renderPayloadStatus?: GeneratedInnerPage['renderPayloadStatus'];
  }>;
}

interface RawFinalCaptionBridgeResponse {
  // Preserve the old response fields; CTA/transition are ignored in production.
  transitionText?: string;
  captionParts?: ContentPackage['captionParts'];
  bridgePlan?: Partial<BridgePlan>;
  tagMaterial?: unknown;
  factualClaims?: RawContentResponse['factualClaims'];
}

interface RawFinalCoverBlocksResponse {
  coverBlocks?: RawContentResponse['coverBlocks'];
}

interface ConsensusCaptionContract {
  valueRange: [number, number];
  paragraphRange: [number, number];
  instruction: string;
}

function getConsensusCaptionContract(family: TemplateCapability['family']): ConsensusCaptionContract {
  switch (family) {
    case 'experience':
      return {
        valueRange: [2, 4],
        paragraphRange: [35, 105],
        instruction: '正文以2到4段自然短段完成：先落到一个备考现场，再写判断和下一步；允许停顿、犹豫或轻微吐槽，不强行拆成“事实、方法、练习、提醒”四格。',
      };
    case 'pain':
      return {
        valueRange: [2, 4],
        paragraphRange: [35, 105],
        instruction: '正文以2到4段完成：先把一个具体卡点或错误动作说清，再给一个能执行的转向，最后按需要补一个例子或提醒；不要把同一痛点拆成多段鸡汤。',
      };
    case 'phrase':
    case 'flashcard':
    case 'table':
      return {
        valueRange: [2, 4],
        paragraphRange: [28, 90],
        instruction: '正文以2到4段短段或短组完成：围绕词、搭配或句型给出使用场景、对比和一个练习动作；信息密度优先，避免硬凑成长段。',
      };
    case 'offer':
    case 'roadmap':
      return {
        valueRange: [2, 4],
        paragraphRange: [40, 110],
        instruction: '正文以2到4段完成：先说明适用场景或路径，再写一两个具体使用动作，最后自然接到商品能承接的缺口；不要把正文写成固定四拍广告词。',
      };
    case 'book':
      return {
        valueRange: [2, 4],
        paragraphRange: [40, 110],
        instruction: '正文以2到4段完成：从一个阅读或备考问题切入，给出核心解释和使用动作，按需要补充资料承接；段落数量服务叙述，不为凑格式拆段。',
      };
    case 'document':
    case 'directory':
    default:
      return {
        valueRange: [3, 5],
        paragraphRange: [45, 120],
        instruction: '正文以3到5段完成：按本篇选题自然安排事实或判断、具体解释/对比、练习或使用提醒；段落数量和职能以内容完整为准，不强行固定四段。',
      };
  }
}

/** Inner-only copy: literal teaching labels, never persisted back into Page Plan. */
function reduceInnerPlanNoise(pages: UserVisiblePagePlan[]): UserVisiblePagePlan[] {
  const replacements = [
    ['DELF B2高分句式', '适合本页任务的句式'],
    ['B2高分句式', '适合本页任务的句式'],
    ['高分句式', '句式'], ['高阶表达', '表达'], ['高级表达', '表达'],
    ['低级表达', '原表达'], ['基础表达', '原表达'], ['基础句式', '原句式'],
    ['高级词汇', '词汇'], ['词汇升级', '词汇修改'], ['语法升级', '语法修改'],
    ['句式升级', '句式修改'], ['表达升级', '表达修改'],
  ];
  const replaceLabels = (text: string) => replacements.reduce(
    (value, [from, to]) => value.split(from).join(to), text,
  );
  return pages.map(page => ({
    ...page,
    pageGoal: replaceLabels(page.pageGoal),
    userGets: replaceLabels(page.userGets),
    pageContentPlan: replaceLabels(page.pageContentPlan),
  }));
}

export async function generateContentPackage(input: ContentStageInput): Promise<VersionedArtifact<ContentPackage>> {
  const lockedBrief = assertLockedProductionBrief(input.topic);
  const profile = getProductPromptProfile(input.topic.productId);
  const examContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const isProductShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  const isEducationalOriginal = input.topic.knowledgeMode === 'educational_original';
  // Product knowledge remains isolated in educational_original mode, but verified
  // exam facts are still allowed when the topic needs them. Product 1 keeps its
  // former topic-keyword gate; Product 2/3 need their own official facts for
  // topics about task shape, timing, scoring, or exam requirements.
  const availableEvidence = input.evidence.filter(item => {
    if (isProductShowcase) return true;
    if (item.category !== 'official_exam_fact') return false;
    if (input.topic.productId === 'delf_b2_writing') {
      return /字数|评分|考试要求|考试规则/.test(input.topic.topic);
    }
    return isEducationalOriginal || /字数|评分|考试要求|考试规则|题型|时长|任务|科目|分数|考试/.test(input.topic.topic);
  });
  const standardPagePlan = !isProductShowcase
    ? await generateStandardKnowledgePagePlan(input)
    : undefined;
  const consensusBrief = resolveContentBriefActive(input.topic.productId, isProductShowcase)
    ? buildConsensusBriefBlock(input.topic)
    : undefined;
  const evidenceCardMatches: EvidenceCardMatch[] = !isProductShowcase
    ? matchProductInnerEvidenceCards(input.topic.productId, standardPagePlan!.data, availableEvidence)
    : [];
  const effectiveInnerEvidence = evidenceCardMatches.slice(0, 10);
  const evidence = effectiveInnerEvidence.map(item => ({
    id: item.id,
    category: item.category,
    text: item.text,
    evidence: item.evidence,
    caution: item.usage_caution,
    applicablePageIds: item.applicablePageIds || [],
  }));
  const canonicalTopic = !isProductShowcase ? {
    finalPublicTopic: input.topic.topic,
    promise: input.topic.promise,
    wholeNoteCore: buildWholeNoteCore(input),
    ...(examContext ? { examScope: examContext.scope, examScopeContext: examContext.rule, targetAudience: examContext.audience } : {}),
  } : input.topic;
  const promptInput = !isProductShowcase ? {
    topic: canonicalTopic,
    canonical_page_plan: reduceInnerPlanNoise(standardPagePlan!.data.map(page => ({
      pageId: page.pageId,
      pageGoal: page.pageGoal,
      userGets: page.userGets,
      pageContentPlan: page.pageContentPlan,
      pageRole: page.pageRole,
      contributionToCore: page.contributionToCore,
    }))),
    ...(consensusBrief ? { consensus_brief: consensusBrief.block } : {}),
    evidence,
  } : {
    product: { id: input.topic.productId, identity: profile.noteIdentity },
    topic: canonicalTopic,
    ...(standardPagePlan ? { canonical_page_plan: standardPagePlan.data } : {}),
    evidence,
    writingInstruction: '请直接交付本篇的法语材料及简短中文解释。不插入英文标签。计划如果含基础词变高级词、保证分数或无证据的考试规则，忽略该错误前提。普通连接词可正常使用；按逻辑关系说明用法，不做等级升级表。用具体场景和完整例句代替抽象理论，不编研究数据、官方评分结论。',
    recent_angles_to_avoid: (input.recentAngles || []).slice(0, 10),
    ...(isProductShowcase ? { product_showcase_inner_pages: {
      enabled: true,
      inner_pages: ['这套资料解决什么备考问题', '里面具体有什么模块/目录', '展示1到2个真实样张或使用方法', '适合谁、什么时候用、如何使用'],
      forbidden: ['把商品写成课程、老师服务或一对一辅导', '只说“资料很全/整理好了”而不展示具体内容', '用一个知识点冒充整套商品介绍'],
      selected_angle: input.showcasePlan?.angle,
      selected_inner_assets: input.showcasePlan?.innerAssets,
    } } : {}),
  };
  const inputHash = stableHash(promptInput);
  let finalContentResponseTrace: AiResponseTrace | undefined;
  const result = await callOpenAICompatibleJsonWithUsage<RawContentResponse>([
    {
      role: 'system',
      content: [
        input.topic.productId === 'delf_b2_writing'
          ? '根据topic的finalPublicTopic、promise、canonical_page_plan和evidence，创作能直接使用、值得收藏的小红书DELF B2内页。交齐核心类别、数量和配套案例，优先给完整表达、论据、对照、应用或速查材料，不用空泛学习建议代替交付。成品要像一个懂B2的真人把好用内容整理给朋友，不是课程教案、评分报告或论文摘要。'
          : `根据topic的finalPublicTopic、promise、canonical_page_plan和evidence，创作能直接使用、值得收藏的小红书${profile.noteIdentity}内页。交齐核心类别、数量和配套案例，优先给完整表达、对照、应用或速查材料，不用空泛学习建议代替交付。${profile.contentScopePrompt}`,
        ...(examContext ? [`考试范围边界：${examContext.rule} 目标读者：${examContext.audience}`] : []),
        `整篇唯一主线是：${buildWholeNoteCore(input)}。每一页只能作为这条主线的一部分，不得把某个局部练习另起成另一篇选题。`,
        ...(consensusBrief ? [`consensus_brief 是本篇已锁定的说话动作、承诺范围和表达边界：必须遵守标题可承诺范围，且不得把其中的内部字段名或说明句写进内页。${isEducationalOriginal ? '本篇为AI原创，严禁输出bridgePlan或任何商品承接。' : '如任务单要求bridgePlan，按其字段输出。'}`] : []),
        '形式由选题决定，可用清单、对比、表格内容、改写、句库、段落、案例、步骤或混合形式。最多输出5个教学JSON页面（不含封面和商品页）；计划模块较多时合并相近模块，不减少promise里的类别、数量和必要案例。当前排版540×720，正文20px、行高32px、边距32px，并需预留标题、导语和条目间距；每页约14～16行正文、纯中文每行约22字仅作容量参考，法语/混排以实际换行为准。不要减小字号或截断；极少数确实无法在5页交齐的完整范文可以自然超页，超过5页不得让Job失败。',
        '选题、promise和计划交付的类别、场景、数量与必要案例保持不变。canonical_page_plan中的数量既是交付目标也是输出上限，不得多送同义句、附加练习、额外案例或重复总结；计划未写数量时，每个模块只选1个代表性素材。普通内容页每页最多3个bullets，优先2个；合并多个模块的页面按每个模块1个bullet交付。lead只写1句、优先不超过38个中法可见字符；每个bullet只做一件事，优先45至90个中法可见字符；普通页的lead与bullets合计优先160至230个可见字符。除完整范文/完整段落外，任一bullet不得把规则、推导、两个案例和总结全塞在一条里。每个普通bullet最多给1句法语素材和极短中文意思/使用条件；禁止附赠第二句替代表达。完整范文按canonical_page_plan跨页连续呈现；promise未要求全文翻译时，只用极短中文标注段落功能。全篇普通教学内容优先控制在约900至1200个中法可见字符；输出JSON前先删重复解释、背景铺垫和总结句，不把超长初稿交给前端再缩。',
        '页标题用人话说清“这页能帮你做什么”，避免连续堆“定位/维度/逻辑锚定/策略/特征/修正动作”等教研词。lead优先用1句具体写作场景、常见犹态或直接提示切入，不先下定义、不重复标题。bullet先给可执行结论，再给必要例句；可自然用“你”、“先看”、“写到这里”、“对照一下”等表达，但不虚构个人经历，不强塞emoji或爆款口癖。',
        '法语准确自然。上游的高分、高级、基础、B2等词不是教学依据；无针对性证据，不谈词句等级、考试必用、考官偏好或得分。改写保留原意，只改善语法、自然度、清晰度、衔接或语境，不增加事实、理由、因果、数据或更强立场。',
        '中文翻译与说明只对应实际出现的法语，引用原词，不讲另一个相似表达。正文使用中文和法语，不夹内部英语。evidence为空时，任何真实机构名+研究/报告/统计、百分比、年份数据或“据……”引用都禁止出现，不得为了举例伪造ADEME、INSEE等来源。自拟案例明确标为假设或练习，有证据也只用其支持的事实。',
        `evidence仅用于核对applicablePageIds所标页面的相关事实边界，不是写作模板。${isEducationalOriginal ? '当前是AI原创内容：商品资料只作为隔离边界，不得把商品目录、卖点或购买承接写入正文；考试硬事实没有证据就不要断言。' : ''}无需逐条展示，不模仿其措辞、结构或例子；只有页面实际使用某条事实时才填写该证据ID。明确标作错误示范的句子可以保留，但对其语法形式、语用效果和错误原因的解释必须符合相关evidence。`,
        '只返回严格JSON对象，唯一顶层innerPages。每页用现有字段：pageId（唯一）、page_type（knowledge_list/example_explain/wrong_right/steps）、page_title、lead、bullets（完整材料字符串数组）、source_ids（实际引用证据ID，无则[]）。可选semanticLayoutType：knowledge_list/comparison/checklist/expression_bank/mistake/before_after/timeline/steps/category_cards/example_breakdown/dense_reference。教学正文只在page_title/lead/bullets，不写renderPayload、HTML、Caption、Bridge、Cover、Title、CTA、商品页或转化页。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(promptInput) },
  ], {
    stage: 'inner', model: PRODUCTION_TEXT_MODEL, maxTokens: 4600,
    temperature: 0.35,
    retries: 2,
    onResponseTrace: trace => { finalContentResponseTrace = trace; },
  }).catch(error => { throw attachStageContext(error, 'content', mergeAiUsage(standardPagePlan?.usage || emptyAiUsage(), error.usage || emptyAiUsage())); });

  if (finalContentResponseTrace) {
    await writeFinalContentTrace(result.requestId, '00_REQUEST_PAYLOAD.json', {
      requestId: result.requestId,
      promptVersion: CONTENT_PROMPT_VERSION,
      model: finalContentResponseTrace.model,
      temperature: finalContentResponseTrace.temperature,
      maxTokens: finalContentResponseTrace.maxTokens,
      retries: finalContentResponseTrace.retries,
      systemPrompt: finalContentResponseTrace.messages.find(message => message.role === 'system')?.content || '',
      userPayload: promptInput,
    });
    await writeFinalContentTrace(result.requestId, '01_PROVIDER_RAW.json', {
      requestId: result.requestId,
      messageContent: finalContentResponseTrace.providerRawContent,
    });
    await writeFinalContentTrace(result.requestId, '02_PARSED_JSON.json', {
      requestId: result.requestId,
      parsedJson: finalContentResponseTrace.parsedJson,
    });
    await writeFinalContentTrace(result.requestId, '00_MATCHED_EVIDENCE_CARDS.json', {
      requestId: result.requestId,
      matches: evidenceCardMatches,
    });
  }

  let content: ContentPackage;
  const normalizationWarnings: string[] = [];
  try {
    content = normalizeInitialInnerPageContent(result.data, input, standardPagePlan?.data, effectiveInnerEvidence);
  } catch (cause) {
    throw attachStageContext(cause, 'content', result.usage);
  }
  await writeFinalContentTrace(result.requestId, '03_NORMALIZED_PAGES.json', {
    requestId: result.requestId,
    pages: content.innerPages,
  });
  const warnings = [...normalizationWarnings];
  return artifact(content, inputHash, mergeAiUsage(standardPagePlan?.usage || emptyAiUsage(), result.usage), result.requestId, warnings);
}

export async function generateStandardKnowledgePagePlan(input: ContentStageInput): Promise<VersionedArtifact<UserVisiblePagePlan[]>> {
  const lockedBrief = assertLockedProductionBrief(input.topic);
  const examContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const planInput = {
    finalPublicTopic: input.topic.topic,
    promise: input.topic.promise,
    wholeNoteCore: buildWholeNoteCore(input),
    ...(examContext ? { examScope: examContext.scope, examScopeRule: examContext.rule, targetAudience: examContext.audience } : {}),
  };
  const result = await callOpenAICompatibleJsonWithUsage<RawPagePlanResponse>([
    {
      role: 'system',
      content: [
        '你只分配每页交付的资产，不写正文。finalPublicTopic仅用于识别主题与内容方向，其中的点击或营销措辞不是新增交付要求；promise才是交付清单。不换题，不把局部内容扩大成整篇。',
        'Page Plan只安排交付什么、数量、场景和呈现形式。不评价表达高级/低级，不推导得分规则、考试要求或考官偏好。',
        ...(examContext ? [`考试范围边界：${examContext.rule} 目标读者：${examContext.audience}`] : []),
        '整篇必须规划为1至5个内页，优先3至5页；不得输出第6页。当前内页按540×720、正文20px、行高32px、边距32px排版，每页正文约14至16行。每页只承担一个主要内容职能，宁可压缩重复说明，也不要把每个类别都扩成多套例句、练习、改写和总结。',
        '保持promise明确承诺的核心资产、类别和数量，但不要自行增加promise之外的材料、数量或例子。promise没有明确数字时，不得擅自规划大批量内容；每个模块只安排1个有代表性的素材，普通内容页最多3个原子素材。数量必须用可直接计数的原子单位（句、条、个、段），除非promise本身明确使用“组”，否则禁止用“组”制造组内继续扩写的空间。promise同时要求完整文章/范文/信函和3个以上模块时，模块合并到前2页且每模块只给1个代表素材，完整应用固定占后3页并按段落连续安排。promise未明确要求全文翻译时，不安排逐段中文复写，只安排极短的结构功能标注。全部内容仍须在最多5页内完成，多主题可在同页用紧凑清单或对照组织。',
        '每页写六个字段：pageId是唯一页面标识；pageGoal写本页的一个核心职能；pageRole写本页在整篇主线中的角色；contributionToCore用一句话说明本页如何帮助完成整篇主线；userGets写具体资产与数量；pageContentPlan用一个简短中文字符串说明必要交付组件，不写正文答案。pageContentPlan必须是string，禁止数组、对象、components或其他嵌套结构。页面可以分别讲不同子任务，但不能因为子任务有用就脱离整篇主线。',
        '你没有evidence输入。案例统一规划明确标注的假设情境、练习情境或日常通用场景，不指定真实法律、报告、机构、企业事实、统计、评分权重、考官结论或所谓高频错误。全部计划用中文写材料安排。',
        '只返回严格JSON：{"pages":[{"pageId":"p1","pageGoal":"本页一个核心内容职能","pageRole":"本页在整篇中的角色","contributionToCore":"本页如何服务整篇主线","userGets":"资产与数量","pageContentPlan":"必要组件的简短安排"}]}。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(planInput) },
  ], { stage: 'page_plan', model: PRODUCTION_TEXT_MODEL, maxTokens: 2600, temperature: 0.45, retries: 1,
    onResponseTrace: trace => writeFinalContentTrace(trace.requestId, '00_PAGE_PLAN_REQUEST_RAW_PARSED.json', trace),
  }).catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    const prefixed = message.includes('AI_RESPONSE_TRUNCATED')
      ? new Error(`PAGE_PLAN_TRUNCATED:${message}`)
      : error;
    throw attachStageContext(prefixed, 'content', error?.usage || emptyAiUsage());
  });
  const normalizedPages = normalizePagePlan(result.data.pages);
  const pages = normalizedPages;
  const warnings = normalizedPages.length > 5
    ? [`PAGE_PLAN_OVER_FIVE_NON_BLOCKING:${normalizedPages.length}`]
    : [];
  await writeFinalContentTrace(result.requestId, '01_PAGE_PLAN_NORMALIZED.json', {
    requestId: result.requestId,
    pages,
    originalNormalizedPageCount: normalizedPages.length,
    warnings,
    usage: result.usage,
  });
  if (!pages.length) {
    const rawPages = result.data.pages;
    const code = Array.isArray(rawPages) && rawPages.length > 0
      ? 'PAGE_PLAN_SCHEMA_INVALID'
      : 'PAGE_PLAN_EMPTY';
    throw attachStageContext(new Error(`${code}:页面计划为空或字段不符合既有四字段合同`), 'content', result.usage);
  }
  return {
    data: pages,
    schema_version: V2_SCHEMA_VERSION,
    prompt_version: `${CONTENT_PROMPT_VERSION}+page-plan-2-capacity`,
    input_hash: stableHash(planInput),
    created_at: new Date().toISOString(),
    usage: result.usage,
    warnings,
    request_id: result.requestId,
  };
}

function normalizePagePlan(value: unknown): UserVisiblePagePlan[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map((raw, index) => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const rawId = clean(item.pageId) || `content_${index + 1}`;
    const pageId = seen.has(rawId) ? `${rawId}_${index + 1}` : rawId;
    seen.add(pageId);
    return {
      pageId,
      pageGoal: clean(item.pageGoal),
      pageRole: clean(item.pageRole) || clean(item.pageGoal),
      contributionToCore: clean(item.contributionToCore) || `服务整篇核心：${clean(item.pageGoal)}`,
      userGets: clean(item.userGets),
      pageContentPlan: typeof item.pageContentPlan === 'string'
        ? item.pageContentPlan.trim()
        : Array.isArray(item.pageContentPlan) && item.pageContentPlan.every(part => typeof part === 'string')
          ? item.pageContentPlan.map(part => part.trim()).filter(Boolean).join('；')
          : '',
    };
  }).filter(item => item.pageGoal && item.userGets && item.pageContentPlan);
}

/**
 * STANDARD KNOWLEDGE 的整篇终审。一次看完全部用户可见页面，只返回删除项和坏页补丁；
 * 未点名页面逐字保留，避免“修一页重写整篇”。
 */
export async function auditWholeNoteEditorialPackage(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: Pick<ContentStageInput, 'topic'>,
): Promise<VersionedArtifact<ContentPackage>> {
  const isProductShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  if (isProductShowcase) return artifactInput;
  const content = structuredClone(artifactInput.data);
  const editorialInput = {
    finalPublicTopic: input.topic.topic,
    audienceState: input.topic.audienceState,
    painOrDesire: input.topic.painOrDesire,
    promise: input.topic.promise,
    pagePlan: content.pagePlan,
    finalVisiblePages: content.innerPages,
  };
  const result = await callOpenAICompatibleJsonWithUsage<RawWholeNoteEditorialResponse>([
    {
      role: 'system',
      content: [
        '你是小红书知识笔记整篇终审，只检查最终用户可见内页。不要改选题、封面、标题、Caption、商品承接或已经正确的页面。',
        '整篇只重点判断：是否有明显无价值或过空页面；是否重复；是否像长文档、课件或PDF而不适合手机阅读；是否主题跑散；是否有明显教学错误或前后矛盾。不要按固定字数、bullet数量或页面类型打分。',
        '明显错误包括页标题步骤数与正文明确列出的步骤数相反、中文语法术语与例句形态不符。区分语法形式与礼貌/命令效果：礼貌表达不自动是条件式，表达要求不自动是命令式。保留明确标注的错误示例，不为措辞不完美改写正确内容。',
        '薄弱但有独立用途的页面只返回该页pageRepairs；完全重复或无独立价值的页面放deletePageIds。不得生成新选题，不得改变正确法语，不得重写未点名页面。',
        '修复页必须保留原pageId和原页面职责，只补具体信息、例句、对照、清单或完整动作；不能用“提升、掌握、加强、灵活运用”等空建议填充。',
        '只返回JSON：{issues,deletePageIds,pageRepairs:[{pageId,pageGoal,userGets,pageContentPlan,page_title,lead,bullets,semanticLayoutType,renderPayload,renderPayloadStatus}]}。没有问题时数组为空。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(editorialInput) },
  ], { maxTokens: 3600, temperature: 0.2, retries: 1 });

  const existingById = new Map(content.innerPages.map((page, index) => [page.pageId || `content_${index + 1}`, { page, index }]));
  const deleteIds = new Set(unique(result.data.deletePageIds).filter(id => existingById.has(id)));
  if (content.innerPages.length - deleteIds.size < 3) deleteIds.clear();
  const repairById = new Map(
    (Array.isArray(result.data.pageRepairs) ? result.data.pageRepairs : [])
      .map(item => [clean(item.pageId), item] as const)
      .filter(([id]) => id && existingById.has(id) && !deleteIds.has(id)),
  );
  content.innerPages = content.innerPages
    .filter((page, index) => !deleteIds.has(page.pageId || `content_${index + 1}`))
    .map((page, index) => {
      const pageId = page.pageId || `content_${index + 1}`;
      const patch = repairById.get(pageId);
      if (!patch) return page;
      const patched = normalizePages([{
        ...page,
        ...patch,
        pageId,
        bullets: Array.isArray(patch.bullets) ? patch.bullets : page.bullets,
        renderPayload: patch.renderPayload || page.renderPayload,
        renderPayloadStatus: patch.renderPayloadStatus || page.renderPayloadStatus,
      }])[0];
      return patched || page;
    })
    .map((page, index) => ({ ...page, page_no: index + 2 }));
  const duplicatePageIds = new Set<string>();
  const seenPageBodies = new Set<string>();
  content.innerPages = content.innerPages.filter((page, index) => {
    const pageId = page.pageId || `content_${index + 1}`;
    const fingerprint = clean(`${page.page_title}|${page.lead}|${page.bullets.join('|')}`).toLocaleLowerCase('zh-CN').replace(/[\s\p{P}\p{S}]/gu, '');
    if (seenPageBodies.has(fingerprint)) {
      duplicatePageIds.add(pageId);
      return false;
    }
    seenPageBodies.add(fingerprint);
    return true;
  }).map((page, index) => ({ ...page, page_no: index + 2 }));
  if (content.pagePlan?.length) {
    content.pagePlan = content.pagePlan
      .filter(plan => !deleteIds.has(plan.pageId) && !duplicatePageIds.has(plan.pageId))
      .map(plan => {
        const patch = repairById.get(plan.pageId);
        return patch ? {
          pageId: plan.pageId,
          pageGoal: clean(patch.pageGoal) || plan.pageGoal,
          userGets: clean(patch.userGets) || plan.userGets,
          pageContentPlan: clean(patch.pageContentPlan) || plan.pageContentPlan,
        } : plan;
      });
  }
  const issues = Array.isArray(result.data.issues) ? result.data.issues.map(formatAuditIssue).filter(Boolean) : [];
  return {
    ...artifactInput,
    data: normalizeFinalPageItems(content),
    prompt_version: `${artifactInput.prompt_version}+whole-note-editorial-1`,
    input_hash: stableHash({ previous: artifactInput.input_hash, editorialInput }),
    created_at: new Date().toISOString(),
    usage: mergeAiUsage(artifactInput.usage, result.usage),
    warnings: unique([
      ...artifactInput.warnings,
      ...issues.map(issue => `整篇终审：${issue}`),
      ...(deleteIds.size ? [`整篇终审删除${deleteIds.size}个重复/无独立价值页面`] : []),
      ...(repairById.size ? [`整篇终审局部修复${repairById.size}个页面`] : []),
    ]),
    request_id: result.requestId,
  };
}

/** Directory identifiers are not CEFR language levels. Remove before copy generation. */
export function publicProductFact(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\b(?:[A-Z]{1,4}-\d{2,4}|B[1-7](?=\s*[、：:.]?\s*表达))\b/gu, '').trim()
    : '';
}

/** Caption gets inventory facts, not teaching excerpts or usage cautions. */
export function captionProductFacts(items: ContentStageInput['evidence']) {
  const allowed = new Set(['knowledge_assets', 'displayable_assets', 'product_facts', 'product_info', 'access_info']);
  const forbidden = /扣分|得分|评分|考官|等级|高级|低级|高阶|低阶|频率|低频|高频|必须|应当|语法|虚拟式|直陈式|替换建议|照搬|步骤.*min|\d\s*min|%|％/i;
  const inventory = (value: unknown) => publicProductFact(value)
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/\b[A-Z]{1,4}-?\d+(?:\s*[-~～]\s*(?:[A-Z]{1,4}-?)?\d+)?\b/gu, '')
    .replace(/[~～]/gu, '').split(/[；;]/u)[0].trim();
  return items.slice(0, 12).flatMap((item, index) => {
    if (!allowed.has(item.category)) return [];
    const text = inventory(item.text);
    if (!text || forbidden.test(text)) return [];
    const detail = inventory(item.evidence);
    // A detailed teaching excerpt is omitted wholesale, never rewritten into a fact.
    const evidence = detail && !forbidden.test(detail) && !/[a-z]/i.test(detail) ? detail : '';
    return [{ id: `fact_${index + 1}`, category: item.category, text, ...(evidence ? { evidence } : {}) }];
  });
}

/** Caption-only surface mappings. Never infer titles from teaching text. */
export function neutralCaptionLabel(value: string, fallback = ''): string {
  const exact: Record<string, string> = {
    'B2词汇误区：越难=越高？': 'B2词汇选择与使用',
    '从基础表达升级到高分句式': '表达改写对照',
  };
  let text = exact[value.trim()] ?? value.trim();
  const mappings: Array<[RegExp, string]> = [
    [/B2词汇不是越难越好[！!]?/gu, 'B2词汇：'],
    [/告别模板脸[！!]?/gu, ''], [/（Lettre formelle）/giu, ''],
    [/低级词/gu, '常用词'], [/(?:高级|高阶)表达/gu, '表达'],
    [/档次(?:瞬间)?提升/gu, '表达调整'], [/高分句式/gu, '句式素材'],
    [/高分/gu, ''], [/升级/gu, '改写'], [/扣分避坑/gu, '自查'],
    [/考官(?:最爱|最喜欢|喜欢)/gu, ''], [/(?:稳过|满分)/gu, ''],
    [/弹药库/gu, '素材库'], [/常考/gu, '常见'], [/高密度/gu, ''],
    [/精准拿捏/gu, '场景'], [/替换掉这/gu, ''],
  ];
  for (const [pattern, replacement] of mappings) text = text.replace(pattern, replacement);
  const latin = text.replace(/DELF|B2|Before\s*[/／-]?\s*After|checklist/giu, '');
  if (!text || /考官|扣分|得分|评分|高级|低级|高阶|低阶|档次|更正式|更地道|必须|要求|虚拟式|越难|越高|语法|→|=>/u.test(text) || /[a-zà-ÿ]/iu.test(latin)) return fallback;
  return text.replace(/\s+/gu, ' ').trim();
}

export function captionPageInventory(pages: ContentPackage['innerPages']) {
  return pages.map(page => {
    const rawTitle = page.page_title || '';
    const title = rawTitle === 'B2词汇误区：越难=越高？' ? rawTitle
      : rawTitle.replace(/^替换(\d+)[：:].*$/u, '改写对照$1').split(/[：:]/u)[0];
    // Read only the array length, never the bullet strings.
    return { ...(page.page_no !== undefined ? { pageNo: page.page_no } : {}),
      pageTitleNeutral: neutralCaptionLabel(title),
      ...(page.page_type ? { pageType: page.page_type } : {}),
      ...(page.semanticLayoutType ? { semanticLayoutType: page.semanticLayoutType } : {}),
      ...(Array.isArray(page.bullets) ? { itemCount: page.bullets.length } : {}) };
  });
}

export function buildCommercialCaptionInput(topic: string, identity: string, innerPages: ContentPackage['innerPages'], _legacyFacts: ReturnType<typeof captionProductFacts> = [], autoFactBrief?: ContentPackage['autoFactBrief'], examRule?: string, examAudience?: string) {
  const neutralTopic = neutralCaptionLabel(topic, `${identity}资料`);
  const pages = captionPageInventory(innerPages);
  return {
    payload: {neutralTopic,neutralPageInventory:pages,
      factBoundary:currentNoteBoundary({innerPages,autoFactBrief}),
      // Legacy content without a cached brief still has actual source, not guessed counts.
      ...(!currentNoteBoundary({innerPages,autoFactBrief}) ? {canonicalInner:innerPages} : {}),
      ...(examRule ? { examScopeRule: examRule, targetAudience: examAudience } : {}),
      seoKeywords:['法语写作', identity]},
    seoSources: [],
  };
}

/** Caption sees neutral inventory only; canonical teaching remains untouched. */
import { assertReviewedInner, assertInnerRepairAllowed } from '@/lib/manual-inner-review';
import { countVisibleUnits } from './contracts';

export async function generateFinalCaptionAndBridge(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: Pick<ContentStageInput, 'topic' | 'evidence' | 'recentCaptionEndings'> & { conversionMode?: ConversionMode; jobId?: string; recentProductPromos?: string[] },
): Promise<VersionedArtifact<ContentPackage>> {
  assertReviewedInner(artifactInput.data);
  const conversionMode = resolveConversionMode(input.conversionMode ?? artifactInput.data.conversionMode);
  const profile = getProductPromptProfile(input.topic.productId);
  const examContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const captionIdentity = examContext?.displayIdentity || profile.noteIdentity;
  const {payload:captionInput,seoSources} = buildCommercialCaptionInput(input.topic.topic, captionIdentity, artifactInput.data.innerPages, [], artifactInput.data.autoFactBrief, examContext?.rule, examContext?.audience);
  const promoSeed = input.jobId || artifactInput.input_hash;
  const selectedPromo = selectProductPromo(input.topic.productId, promoSeed, artifactInput.data.captionParts.productBridge, input.recentProductPromos || input.recentCaptionEndings || []);
  const result = await callOpenAICompatibleJsonWithUsage<RawFinalCaptionBridgeResponse>([
    {
      role: 'system',
      content: [
        '你负责小红书图文笔记下方的本篇正文，约120到220个中文字，不硬凑字数。根据neutralTopic和neutralPageInventory，让没仔细看图片的人知道本篇讲什么、有什么用，并给一个符合内容形态的简单使用场景。允许概括整篇，不机械逐页罗列。自然使用至少1到2个seoKeywords，不列关键词表。',
        '根据factBoundary中的实际交付和内容摘要介绍本篇，旧数据则根据canonicalInner。目录和itemCount仅辅助定位，不代表框架/主题数量。只使用正文可支持的数字及其真实对象范围，不编具体法语教学；SEO关键词不决定本篇内容。表达自然、有分享和获得感，不写成论文摘要。',
        ...(examContext ? [`${examContext.rule} 目标读者是${examContext.audience}。考试身份必须用自然中文表达，不要写“写TEF/TCF Canada写作时”这类拼接病句。`] : []),
        NOTE_DELIVERY_RULE,
        '只写本篇，完全不介绍商品，不写完整资料里还有、标签、购买指令、链接、翻页或内部字段名称。商品宣传、Tags和CTA均由程序提供。仅返回JSON：{captionParts:{opening:"正文开头",value:["后续正文自然段"]}}。opening加value就是完整正文，不返回其他字段。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(captionInput) },
  ], { stage: 'caption_bridge_tags', maxTokens: 2600, temperature: 0.45, retries: 1,
    onResponseTrace: async trace => { await writeFinalContentTrace(trace.requestId, '09_CAPTION_REQUEST_RAW_PARSED.json', trace); },
  });
  const finalData = result.data;
  const finalUsage = result.usage;
  const finalRequestId = result.requestId;
  const normalizedCaption = normalizeCaptionParts(finalData.captionParts);
  const next = structuredClone(artifactInput.data);
  next.captionParts = normalizedCaption;
  next.conversionMode = conversionMode;
  next.transitionText = '';
  next.captionParts = singleCaptionCta(next.captionParts, conversionMode);
  const seoFallbackApplied = ensureCaptionSeo(next.captionParts, captionInput.seoKeywords);
  next.captionParts.productBridge = selectedPromo?.text || '';
  // Legacy internal planning fields remain compatible, but are no longer AI output.
  next.bridgePlan = {
    freeSolves: captionInput.neutralTopic,
    userStillNeeds: '按需查看完整资料。',
    whyProduct: selectedPromo?.text || '暂无已审核的宣传句。',
    naturalCta: CAPTION_LINK_CTA,
  };
  // Retain existing tag material; Caption AI no longer supplies tag/marketing fields.
  if (Object.values(next.bridgePlan).some(value => !value)) {
    throw attachStageContext(new Error('最终商品承接缺少完整句'), 'content', mergeAiUsage(artifactInput.usage, result.usage));
  }
  next.factualClaims = [...next.factualClaims.filter(claim => claim.type !== 'product'), ...(selectedPromo ? [{text:selectedPromo.text,type:'product' as const,sourceIds:selectedPromo.sourceIds}] : [])];
  next.captionContentSnapshotHash = stableHash(next.innerPages);
  next.frenchSegments = collectFinalTeachingSegments(next)
    .filter(item => containsAuditableFrench(item.text));
  await writeFinalContentTrace(finalRequestId, '10_FINAL_CAPTION_BRIDGE_TAGS.json', {
    requestId: finalRequestId,
    captionInput,
    seoSources,
    seoFallbackApplied,
    selectedPromo,
    promoSeed,
    innerPagesSnapshotHash: next.captionContentSnapshotHash,
    captionParts: next.captionParts,
    bridgePlan: next.bridgePlan,
    tagMaterial: next.tagMaterial,
    conversionMode,
    transitionText: next.transitionText,
    factualClaims: next.factualClaims,
  });
  return {
    ...artifactInput,
    data: next,
    prompt_version: `${artifactInput.prompt_version}+caption-final-5-legacy-fields`,
    input_hash: stableHash({ previous: artifactInput.input_hash, captionInput }),
    created_at: new Date().toISOString(),
    usage: mergeAiUsage(artifactInput.usage, finalUsage),
    warnings: artifactInput.warnings,
    request_id: finalRequestId,
  };
}

/** Only exclude provably incompatible contracts; pages are not cover groups or item budgets. */
export function coverTemplateIneligibility(spec: CoverTemplateSpec, pages: GeneratedInnerPage[]): string | undefined {
  const groups = spec.sectionRange || [spec.sectionCount, spec.sectionCount];
  const items = spec.itemRange || [1, spec.itemsPerSection];
  const totalMax = spec.maxTotalItems ?? groups[1] * items[1];
  if (groups[0] > groups[1] || items[0] > items[1]
    || Math.max(spec.minTotalItems, groups[0] * items[0]) > Math.min(totalMax, groups[1] * items[1])) return 'inconsistent_capacity_contract';
  if (!pages.length || !pages.some(p => p.bullets?.some(b => clean(b)))) return 'missing_source_content';
  const source = pages.map(p => [p.page_title, p.lead, ...p.bullets].join('\n')).join('\n');
  // Absence of any Latin material proves French-only assets are unavailable. Presence
  // alone does not prove enough suitable short expressions; leave uncertain cases in.
  if (spec.primaryFrenchOnly && !/\p{Script=Latin}/u.test(source)) return 'missing_french_source_asset';
  const knownNonSequential = pages.every(p => p.page_type && p.page_type !== 'steps'
    && p.semanticLayoutType !== 'steps' && p.semanticLayoutType !== 'timeline');
  if (spec.family === 'roadmap' && knownNonSequential
    && !/(?:第[一二三四五六七八九十\d]+步|[一二三四五六七八九十\d]+步(?:法|练习|流程)|[四4]段(?:式|结构|布局)|连续.*(?:阶段|段落))/u.test(source)) return 'non_sequential_content_for_roadmap';
  return undefined;
}

export function coverCopyContractFailure(raw: {coverTitle?: unknown; coverSubtitle?: unknown}, spec?: CoverTemplateSpec) {
  if (typeof raw.coverTitle !== 'string' || !raw.coverTitle.trim()
    || typeof raw.coverSubtitle !== 'string') return 'cover_copy_missing_fields';
  // Preview text limits guide layout, not candidate rejection. Title stays complete in the renderer.
  return undefined;
}

/**
 * Give cover matching a compact whole-note map without copying full teaching bullets.
 * Product/showcase pages are conversion assets rather than editorial modules.
 */
export function buildCoverMajorModuleInventory(pages: GeneratedInnerPage[]) {
  return pages
    .filter(page => page.page_type !== 'product_bridge' && !page.showcase_asset_id)
    .map(page => ({
      pageId: clean(page.pageId) || `page_${page.page_no}`,
      pageNo: page.page_no,
      title: clean(page.page_title),
      lead: clean(page.lead),
    }))
    .filter(module => module.title || module.lead);
}

const COVER_DENSITY_RANK: Record<CoverVisualDensity, number> = {
  low: 0, medium: 1, high: 2, very_high: 3,
};

/** Rich notes should surface at least a medium/high-density automatic option. */
export function preferredCoverVisualDensity(pages: GeneratedInnerPage[]): CoverVisualDensity {
  const editorialPages = pages.filter(page => page.page_type !== 'product_bridge' && !page.showcase_asset_id);
  const bulletCount = editorialPages.reduce((sum, page) => sum + (page.bullets?.filter(Boolean).length || 0), 0);
  if (editorialPages.length >= 4 || bulletCount >= 16) return 'high';
  if (editorialPages.length >= 3 || bulletCount >= 9) return 'medium';
  return 'low';
}

/** CoverBlocks 的唯一新生产者：只从已经稳定的最终内页抽取封面短内容。 */
export async function generateFinalCoverBlocks(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: Pick<ContentStageInput, 'topic' | 'capability' | 'evidence' | 'recentCoverTemplateIds'> & {
    selectedTextTitle?:{id:string;textTitle:string};
    selectedCoverTitle?:{id:string;textTitle:string};
    /** Manual library choice: adapt this existing template without rerunning earlier stages. */
    requestedCoverTemplateId?:string;
    useDazibao?: boolean;
  },
): Promise<VersionedArtifact<ContentPackage>> {
  assertReviewedInner(artifactInput.data);
  const recent = input.recentCoverTemplateIds || [];
  const recentCounts = new Map<string, number>();
  recent.forEach(templateId => recentCounts.set(templateId, (recentCounts.get(templateId) || 0) + 1));
  const topicRotationRank = (templateId: string) => stableHash(`${input.topic.topic}::${templateId}`);
  const excludedTemplates: Array<{templateId:string;reason:string}> = [];
  let contracts = (await Promise.all(standardCreativeCards.filter(card => !input.useDazibao || card.renderer_id === 'dazibao_html').map(async card => {
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (!card.supported || !spec || spec.productionFit === 'disabled') return undefined;
    const ineligible = coverTemplateIneligibility(spec, artifactInput.data.innerPages);
    if (ineligible) { excludedTemplates.push({templateId:card.id,reason:ineligible}); return undefined; }
    if (spec.renderMode === 'image_to_image') {
      if (!card.reference_image?.startsWith('/')) return undefined;
      try { await access(path.join(process.cwd(), 'public', card.reference_image)); }
      catch { return undefined; }
    }
    const sectionRange = spec.sectionRange || [spec.sectionCount, spec.sectionCount];
    const itemRange = spec.itemRange || [1, spec.itemsPerSection];
    const exampleItemCounts = Array.from({ length: sectionRange[1] }, () => itemRange[0]);
    for (let index = 0; exampleItemCounts.reduce((sum, count) => sum + count, 0) < spec.minTotalItems && index < sectionRange[1] * itemRange[1]; index++) {
      const slot = index % exampleItemCounts.length;
      if (exampleItemCounts[slot] < itemRange[1]) exampleItemCounts[slot]++;
    }
    return {
      templateId: card.id, enabled: true, name: spec.name, renderMode: spec.renderMode,
      visualDensity: coverVisualDensity(card.renderer_id),
      minimumAverageItemVisibleUnits: minimumAverageCoverItemUnits(card.renderer_id),
      titleMaxVisibleChars:spec.titleMaxVisibleChars ?? spec.titleLengthRange?.[1] ?? 18,
      subtitleMaxVisibleChars:spec.subtitleMaxVisibleChars ?? 24,
      exampleItemCounts,
      form: spec.family, suitableTopics: spec.suitableTopics,
      structure: `coverBlocks数组需${(spec.sectionRange || [spec.sectionCount,spec.sectionCount]).join('到')}个元素，每个元素items需${(spec.itemRange || [1,spec.itemsPerSection]).join('到')}条，总条数${spec.minTotalItems}到${spec.maxTotalItems || spec.sectionCount*spec.itemsPerSection}。分组数量不等于视觉栏数。`,
      sectionRange: spec.sectionRange || [spec.sectionCount, spec.sectionCount],
      itemRange: spec.itemRange || [1, spec.itemsPerSection],
      minTotalItems: spec.minTotalItems, maxTotalItems: spec.maxTotalItems,
      maxPrimaryChars: spec.maxPrimaryVisualLength, maxSecondaryChars: spec.maxSecondaryVisualLength,
      noteInstruction: spec.notePartCount ? `每条note用｜分隔${spec.notePartCount}个来自内页、互不重复的短支项` : '可省略note',
      primaryRole: spec.primaryFrenchOnly ? '必须是内页已有短法语，不含中文' : '简洁中文摘要，或内页已有短法语',
      secondaryRole: '中文短解释，不写法语翻译或完整法语句',
      primaryFrenchOnly: Boolean(spec.primaryFrenchOnly),
      referenceImage: spec.renderMode === 'image_to_image' ? card.reference_image : undefined,
    };
  }))).filter(item => item !== undefined)
    .sort((left, right) => {
      const usageDifference = (recentCounts.get(left.templateId) || 0) - (recentCounts.get(right.templateId) || 0);
      return usageDifference || topicRotationRank(left.templateId).localeCompare(topicRotationRank(right.templateId));
    });
  if (input.requestedCoverTemplateId) {
    contracts = contracts.filter(contract => contract.templateId === input.requestedCoverTemplateId);
    if (!contracts.length) {
      const exclusion = excludedTemplates.find(item => item.templateId === input.requestedCoverTemplateId);
      throw new Error(`COVER_TEMPLATE_NOT_USABLE:${input.requestedCoverTemplateId}${exclusion ? `:${exclusion.reason}` : ''}`);
    }
  }
  if (!contracts.length) throw new Error('NO_ELIGIBLE_COVER_TEMPLATE');
  const rotationPriorityTemplateIds = contracts.slice(0, Math.min(6, contracts.length)).map(item => item.templateId);
  const brief = artifactInput.data.autoFactBrief;
  const majorModuleInventory = buildCoverMajorModuleInventory(artifactInput.data.innerPages);
  const preferredVisualDensity = preferredCoverVisualDensity(artifactInput.data.innerPages);
  const coverExamContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const coverInput = { finalPublicTopic: input.topic.topic,
    wholeNoteCore: buildWholeNoteCore(input),
    ...(coverExamContext ? { examScope: coverExamContext.scope, examScopeRule: coverExamContext.rule, targetAudience: coverExamContext.audience } : {}),
    factBoundary:currentNoteBoundary(artifactInput.data),
    ...(input.selectedTextTitle ? {selectedTextTitle:input.selectedTextTitle.textTitle} : {}),
    ...(input.selectedCoverTitle ? {selectedCoverTitle:input.selectedCoverTitle.textTitle} : {}),
    ...(brief?.sourceInnerHash === stableHash(artifactInput.data.innerPages)
      ? {factBrief:brief.factBrief,userTask:brief.userTask,supportedCounts:brief.supportedCounts,scopeNotes:brief.scopeNotes} : {}),
    majorModuleInventory, finalInnerPages: artifactInput.data.innerPages, preferredVisualDensity, recentlyUsedTemplateIds: recent,
    rotationPriorityTemplateIds, templates: contracts };
  const result = await callOpenAICompatibleJsonWithUsage<{
    candidates?: Array<{ templateId?: string; fitReason?: string; coverTitle?:string; coverSubtitle?:string; coverBlocks?: RawContentResponse['coverBlocks'] }>;
  }>([
    { role: 'system', content: [
      '你是现有小红书封面模块，一次完成模板匹配与各候选封面文案，不另设匹配或修稿节点。',
      NOTE_DELIVERY_RULE,
      ...(coverExamContext ? [`本篇考试身份必须保持为${coverExamContext.displayIdentity}。${coverExamContext.rule}不得把TEF和TCF拼成一个考试名称，也不得让封面身份与正文身份不一致。`] : []),
      'selectedTextTitle只提供点击角度，不是新事实来源。数字、时长、交付名词以finalInnerPages为准，factBoundary辅助定位；已选Title有改义时不得继承或放大，不改写用户文字标题。模板只决定排版分组，不决定正文有几类/几步。允许正文5类而封面节选3类，主副标题不要把节选数量冒充整篇全部数量。保持封面丰满，不需要逐字完整呈现正文。',
      ...(input.selectedTextTitle && input.selectedCoverTitle ? ['selectedTextTitle是用户已确认的发布文字标题；selectedCoverTitle是用户从同一候选池中另行确认的封面主标题。两者都不得修改，可以相同也可以不同。每个候选的coverTitle必须原样返回selectedCoverTitle；你只根据模板补充coverSubtitle和coverBlocks，不另创第三套主标题或卖点。'] : []),
      input.requestedCoverTemplateId
        ? '用户已经从完整模板库中指定了templates里的唯一模板。只为这个模板返回1个完整候选，按它的真实容量重新组织封面文案；不得改选其他模板。'
        : '根据最终主题和内页，从templates选2到3个真正合适的模板，按适配程度排序，不打数字分。只要templates中存在至少2个结构可承载整篇主要交付的模板，就必须返回至少2个完整且通过合同的候选，优先返回3个；不得只返回最推荐的1个。第二、第三候选允许采用不同视觉风格，但仍须真实承载整篇，不得选择明显不合适的高密度模板。',
      'recentlyUsedTemplateIds是本批前面已经推荐或采用的模板。适配程度相近时优先选择较少出现的模板，候选中尽量至少包含1个近期未使用模板；内容明显不适配时仍以适配为先，不能为轮换硬选。templates已按本批使用次数从少到多排列。',
      'rotationPriorityTemplateIds是按当前主题与近期使用情况确定的轮换优先池。适配程度接近时，候选应优先从该池选择，并尽量至少包含1个池内模板；它不是适配白名单，明显不合适的模板仍不得选择。',
      '每个候选必须同时交付完整coverBlocks。只摘要已有内容；不得发明新法语规则、案例或承诺，不得反过来要求补写内页。',
      'majorModuleInventory是整篇教学内容的模块地图，按内页顺序列出；标题相近或连续的示例页可合并理解为同一模块。它用于防止封面只抓住一个局部，不要求逐页照搬。',
      `wholeNoteCore是整篇唯一主线：${buildWholeNoteCore(input)}。封面主副标题和分组必须优先代表这条主线；单页练习、单个数字或局部清单只能作为辅助细节，不能抢成整篇卖点。`,
      'preferredVisualDensity由正文真实模块数和条目数确定。自动推荐时，第一个候选应达到该密度（若存在语义适配且合同可填满的模板）；低密度模板仍可作为风格备选或用户手动指定，但不能把它说成中高密度。visualDensity与minimumAverageItemVisibleUnits是最终渲染合同：不仅要填够组数和条数，每条实际可见文字的平均占位也必须达到下限。',
      '低容量模板（maxTotalItems不超过4）若面对多个主要模块，每个格子应优先承接不同的整篇模块或合并后的连续模块；不得把全部格子都用于同一模块下的并列子项而遗漏其他主要模块。例如整篇同时有“结构、衔接表达、完整示例”，三格应分别呈现这三类资产，而不是只列三种结构。若模板无法在主副标题和格子中真实覆盖主要交付，应改选更合适的模板。',
      '每个候选必填templateId、fitReason、coverTitle、coverSubtitle、coverBlocks。coverTitle是非空字符串，coverSubtitle必须返回字符串，无需副标题时可以为空字符串；主副标题分别遵守模板字符上限。',
      'CONTENT→TEMPLATE：材料的部分/模块不是连续步骤，不得为四步模板改成四步。封面允许节选，但主副标题须交代整篇范围；五主题不能删成三四主题并冒充全部。不同分组可承担总览/场景/获得物，不要求一页等于一组；fitReason只简述适配原因，不作与实际数组矛盾的数量声明。',
      '承接selectedTextTitle的同一使用时刻与点击理由。按模板现有form/name表达：资料教材清单可直接说获得物，痛点大字可说问题或动作，对照只能用真实对照。不虚构高频常考必考、官方考官、百分比、满分稳过或固定结果；不把有条件表达说成直接套用、X就够、固定三段式、才有效、只要X即可。普通高分/攻略/资料措辞本身不等于事实错误。',
      '不得加强原文确定性：更推荐、在某情境可用、可能不够正式等限定必须保留其含义，不能压缩成必须、严禁或直接扣分。封面只能选择和压缩已有内容，不能发明新的教学规则。',
      '先按所选模板的exampleItemCounts搭空结构，再从内页挑材料填入，分组与每组条数不要照搬内页。封面不用容纳全部教学细节，但主副标题和格子合起来必须代表整篇主要交付，不能只展示单页或单一模块。secondary只能放短中文，不能贴长法语；primary允许中文时优先选简洁中文摘要。fitReason写合规不代表实际合规，以交出的数组和短文本为准。',
      '严格遵守唯一模板合同的分组范围、每组条数、总数、primary和secondary字符上限。信息少选低容量，资料自然丰富才选高密度。中文简明，法语只引用内页已有短表达。',
      'heading是局部栏目短名，非全篇标题。只写中文或已有法语，不写Red Flags等英文标签。primary/secondary严格按字符上限压缩；法语太长时改用准确中文概括，不截断法语。maxSecondaryChars为0时必须省略secondary。',
      'secondary只用简短中文解释，绝不把primary翻译成完整法语句。primary若选用法语也必须是内页已有且长度合规的短词句；放不下就选允许中文摘要的模板，不得造新法语句。',
      'exampleItemCounts给出一种已经符合合同的分组结构。例如[2,1]表示coverBlocks正好2个元素，第一组2条items，第二组1条items；[4,4,3,3]表示4组且分别4/4/3/3条。可直接采用对应模板的这个形状，逐格填入已有内容；不要在fitReason声称符合却实际少填。每个候选的中文短文案直接按此结构输出。',
      '返回前在本次调用内逐候选核对：coverBlocks.length、每组items.length、所有items总数是否同时满足structure及数值合同。模板名字里有“三列/四项”并不意味着3组/4组，必须看合同！不够就选更小容量的合适模板，不能返回少于合同下限的空壳；尤其教材封面是2组共3到4条，不是2条。',
      '只返回JSON：{"candidates":[{"templateId":"模板ID","fitReason":"简短适配理由","coverTitle":"封面主标题","coverSubtitle":"封面副标题或空字符串","coverBlocks":[{"id":"group_1","kind":"group","heading":"栏目","items":[{"primary":"短内容","secondary":"短中文说明"}],"priority":1,"sourceMode":"general_advice","sourceIds":[]}]}]}。',
    ].join('\n') },
    { role: 'user', content: JSON.stringify(coverInput) },
  ], { stage: 'cover', model: PRODUCTION_TEXT_MODEL, maxTokens: 6200, temperature: 0.65, retries: 1,
    onResponseTrace: async trace => { await writeFinalContentTrace(trace.requestId,'19_COVER_REQUEST_RAW.json',trace); } });
  const candidates: NonNullable<ContentPackage['coverCandidates']> = (result.data.candidates || [])
    .slice(0, input.requestedCoverTemplateId ? 1 : 3).map(raw => {
    const contract = contracts.find(item => item.templateId === raw.templateId);
    const card = standardCreativeCards.find(item => item.id === raw.templateId);
    const blocks = (raw.coverBlocks || []).map((block, index) =>
      normalizeBlock(block, index, new Set<ContentBlockKind>(['group','pair','paragraph','quote','example','step','benefit']), new Set<string>())
    ).filter((block): block is ContentBlock => Boolean(block));
    const spec = card && getCoverTemplateSpec(card.renderer_id);
    const fixedCoverTitle = input.selectedCoverTitle?.textTitle || clean(raw.coverTitle);
    const copyFailure = coverCopyContractFailure({coverTitle:fixedCoverTitle,coverSubtitle:raw.coverSubtitle}, spec);
    return { templateId: clean(raw.templateId), fitReason: clean(raw.fitReason),
      coverTitle:fixedCoverTitle,coverSubtitle:clean(raw.coverSubtitle),
      coverBlocks: blocks, renderMode: contract?.renderMode || 'code',
      rejectionReason: !contract || !card ? 'template_unavailable' : coverCapacityFailure(card.renderer_id, blocks)
        || coverVisualFullnessFailure(card.renderer_id, blocks) || copyFailure };
  });
  const usable = candidates.filter(item => !item.rejectionReason);
  // Preserve AI fit order inside the requested visual-density band. Rotation is
  // only a prompt-level tie-breaker and never participates in this selection.
  const usableRanked = usable
    .map((candidate, index) => {
      const card = standardCreativeCards.find(item => item.id === candidate.templateId);
      return { candidate, index, density: card ? COVER_DENSITY_RANK[coverVisualDensity(card.renderer_id)] : -1 };
    })
    .sort((left, right) => right.density - left.density || left.index - right.index)
    .map(item => item.candidate);
  const selected = input.requestedCoverTemplateId ? usable[0] : usable.find(candidate => {
    const card = standardCreativeCards.find(item => item.id === candidate.templateId);
    return card && COVER_DENSITY_RANK[coverVisualDensity(card.renderer_id)] >= COVER_DENSITY_RANK[preferredVisualDensity];
  }) || usableRanked[0];
  await writeFinalContentTrace(result.requestId, '20_COVER_CANDIDATES.json', { coverInput, excludedTemplates, raw: result.data, candidates });
  if (!selected) throw attachStageContext(Object.assign(new Error('COVER_CANDIDATES_UNUSABLE:' + candidates.map(item => item.templateId + ':' + item.rejectionReason).join(',')), { coverCandidates: candidates }), 'content', mergeAiUsage(artifactInput.usage, result.usage));
  const orderedCandidates = [selected, ...candidates.filter(candidate => candidate !== selected)];
  const next = { ...artifactInput.data, coverSourceInnerHash: stableHash(artifactInput.data.innerPages), coverBlocks: selected.coverBlocks,
    ...(input.selectedTextTitle && input.selectedCoverTitle ? {coverCopy:{status:'complete' as const,titleId:input.selectedTextTitle.id,
      coverTitleId:input.selectedCoverTitle.id,
      sourceInnerHash:stableHash(artifactInput.data.innerPages),coverTitle:selected.coverTitle!,coverSubtitle:selected.coverSubtitle || '',requestId:result.requestId}} : {}),
    coverCandidates: orderedCandidates, selectedCoverTemplateId: selected.templateId };
  await writeFinalContentTrace(result.requestId, '20_FINAL_COVER_BLOCKS.json', {
    requestId: result.requestId, coverInput, candidates: orderedCandidates, selectedTemplateId: selected.templateId,
  });
  return { ...artifactInput, data: next, prompt_version: artifactInput.prompt_version + '+cover-candidates-1',
    input_hash: stableHash(coverInput), usage: mergeAiUsage(artifactInput.usage, result.usage),
    request_id: result.requestId };
}

function cleanUserFacingMetadata(value: unknown) {
  return clean(value)
    .replace(/\b(?:OFF-[A-Z-]+-\d{2,4}|[A-Z]{2,5}-\d{2,4})(?:\s*[~～—–]\s*(?:[A-Z]{2,5}-)?\d{2,4})?\b/giu, '')
    .replace(/(?:依据|根据)\s*productEvidence\s*[（(][^）)]*[）)]\s*[，,:：]?/giu, '')
    .replace(/\s{2,}/gu, ' ')
    .trim();
}

function finalCaptionSemanticIssues(caption: ContentPackage['captionParts']) {
  const issues: string[] = [];
  const visible = [caption.opening, ...caption.value, caption.productBridge, caption.cta];
  if (caption.value.length < 3) issues.push('value 少于 3 个完整自然段');
  visible.forEach((value, index) => {
    if (!isCompleteVisibleSentence(value)) issues.push(`第 ${index + 1} 个可见字段是残句或截断句`);
  });
  const all = visible.join('\n');
  if (/\d+\s*分(?:建立|准备|完成|掌握|复习|写作|整理|形成)/u.test(all)) {
    issues.push('出现“数字+分”后直接接动词的截断病句，需写清分钟/分数及完整语义');
  }
  if (/用\s*En raison de\s*替代\s*Parce que/iu.test(all)) {
    issues.push('把 En raison de 与 Parce que 写成可直接替换，忽略名词短语与从句的句法差异');
  }
  if (/词汇库\s*[-—]\s*功能表达\s*B1\s*表达观点|这套知识库里的按/u.test(all)) {
    issues.push('商品承接含内部字段拼接后的病句');
  }
  if (/(?:或|和|以及|因为|但是|从而|并且|而且|例如|包括|分别是)\s*[。！？!?]?$/u.test(all.trim())) {
    issues.push('Caption 以悬空连接词结束，最后一句被截断');
  }
  if (/(?:\*\*|__|```|`|\[[^\]]+\]\([^)]*\)|^\s*#{1,6}\s|\|\s*[-:]{2,}\s*\|)/mu.test(all)) {
    issues.push('Caption 含 Markdown 控制字符残留');
  }
  return unique(issues);
}

function normalizeFinalBridgePlan(plan: BridgePlan, evidence: Array<{ text: string; evidence: string }>): BridgePlan {
  const safePlan = sanitizeBridgePlan(plan);
  const malformed = (value: string) => /(?:至等|productEvidence|\b[A-Z]{2,5}-\d{2,4}\b|词汇库\s*[-—]\s*功能表达|这套知识库里的按)/iu.test(value);
  if (!Object.values(safePlan).some(malformed)) return safePlan;
  const evidenceText = evidence.map(item => `${item.text} ${item.evidence}`).join(' ');
  const hasTopicMaterial = /(?:主题|观点|论据|词汇)/u.test(evidenceText);
  const hasExpressionMaterial = /(?:表达|句型|连接|功能)/u.test(evidenceText);
  const hasModelText = /(?:范文|文体|结构)/u.test(evidenceText);
  const assets = [
    hasTopicMaterial ? '主题观点' : '',
    hasExpressionMaterial ? '功能表达' : '',
    hasModelText ? '文体范文与结构' : '',
  ].filter(Boolean).join('、') || '写作资料';
  return {
    ...safePlan,
    whyProduct: `完整资料还按问题整理了${assets}，可以继续补充这一篇没有展开的练习场景。`,
  };
}

function isCompleteVisibleSentence(value: string) {
  const text = clean(value);
  if (!text || /[，、：:（(\-—]$/u.test(text)) return false;
  return !/(?:比如|例如|包括|分为|分别是|也就是|尤其是)$/u.test(text);
}

function attachStageContext(cause: unknown, stage: 'content' | 'audit', usage: AiUsageSummary) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  Object.assign(error, { v2Stage: stage, usage, cumulativeUsage: true });
  return error;
}

function qaIssueText(value: unknown) {
  if (typeof value === 'string') return clean(value);
  if (!value || typeof value !== 'object') return '';
  const issue = value as { path?: unknown; issue?: unknown };
  const text = clean(issue.issue);
  const issuePath = clean(issue.path);
  return issuePath && text ? `${issuePath}：${text}` : text || issuePath;
}

function isObjectiveFrenchBlockingIssue(value: unknown) {
  const item = value && typeof value === 'object'
    ? value as { type?: unknown; issue?: unknown }
    : undefined;
  const type = clean(item?.type);
  const text = qaIssueText(value);
  if (!text || isNoIssueStatement(text)) return false;
  // A definite typed language error is not demoted merely because its explanation mentions B2 or an alternative.
  const definite = /拼写|主谓不一致|性数不一致|变位错误|残句|结构不成立|英法混杂|英语词|that|number|Fondamentally/iu.test(text);
  if (!definite && /不够B2|不够高级|只是偏好|语域偏好|更推荐|更自然|更地道/iu.test(text)) return false;
  if (['spelling', 'grammar', 'fragment'].includes(type)) return true;
  return /(?:英法混杂|英语词混入法语|明确拼写错误|拼写有误|明确语法错误|语法结构不成立|主谓不一致|性数不一致|动词变位错误|法语残句|明显残句|句子结构不成立|截断句|misspell|ungrammatical|sentence fragment)/iu.test(text)
    && !/语法教学错误/u.test(text);
}

function normalizeObjectiveBlockingIssues(primary: unknown, legacy?: unknown) {
  const values = Array.isArray(primary) ? primary : Array.isArray(legacy) ? legacy : [];
  return unique(values.filter(isObjectiveFrenchBlockingIssue).map(qaIssueText));
}

function objectiveBlockingPaths(primary: unknown, legacy?: unknown) {
  const values = Array.isArray(primary) ? primary : Array.isArray(legacy) ? legacy : [];
  return new Set(values.filter(isObjectiveFrenchBlockingIssue).map(value => (
    value && typeof value === 'object' ? clean((value as { path?: unknown }).path) : ''
  )).filter(Boolean));
}

function stringAtPath(root: unknown, path: string): string | undefined {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: unknown = root;
  for (const token of tokens) {
    if (!current || typeof current !== 'object' || !(token in current)) return undefined;
    current = (current as Record<string, unknown>)[token];
  }
  return typeof current === 'string' ? current : undefined;
}

/** 二次 QA 偶尔会原样回显已经修掉的“错词→正确词”。只过滤可确定已消失的旧错词。 */
function unresolvedAfterSourceRepair(value: unknown, content: ContentPackage) {
  if (!value || typeof value !== 'object') return true;
  const issue = value as { path?: unknown; issue?: unknown };
  const issuePath = clean(issue.path);
  if (!issuePath) return true;
  const current = stringAtPath(content, issuePath);
  if (current === undefined) return true;
  const wrongToken = clean(issue.issue).match(/[“”‘’'"]([^“”‘’'"]{1,60})[“”‘’'"]\s*(?:应为|应该改为|→|->)/u)?.[1];
  return !wrongToken || current.includes(wrongToken);
}

function normalizeTeachingWarnings(primary: unknown, legacy?: unknown, proposedBlocking?: unknown) {
  const warnings = Array.isArray(primary) ? primary : [];
  const legacyIssues = Array.isArray(legacy) ? legacy : [];
  const demotedBlocking = Array.isArray(proposedBlocking) ? proposedBlocking : [];
  return unique([
    ...warnings.map(qaIssueText),
    ...legacyIssues.filter(item => !isObjectiveFrenchBlockingIssue(item)).map(qaIssueText),
    ...demotedBlocking.filter(item => !isObjectiveFrenchBlockingIssue(item)).map(qaIssueText),
  ].filter(item => item && !isNoIssueStatement(item)));
}

export async function auditContentPackage(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: Pick<ContentStageInput, 'topic' | 'evidence'>,
): Promise<VersionedArtifact<ContentPackage>> {
  assertReviewedInner(artifactInput.data);
  const content = structuredClone(artifactInput.data);
  const finalPageSegments = collectFinalTeachingSegments(content);
  if (!finalPageSegments.length) return { ...artifactInput, data: content };
  const profile = getProductPromptProfile(input.topic.productId);
  const auditInput = {
    product: profile.noteIdentity,
    final_visible_teaching_content: finalPageSegments.map(field => ({
      ...field
    })),
  };
  const result = await callOpenAICompatibleJsonWithUsage<{
    approved?: boolean;
    corrections?: Array<{ path?: string; text?: string; translation?: string; reason?: string }>;
    blockingIssues?: Array<{ path?: string; type?: 'spelling' | 'grammar' | 'fragment'; issue?: string } | string>;
    warnings?: Array<{ path?: string; issue?: string } | string>;
    issues?: string[];
  }>([
    {
      role: 'system',
      content: [
        '你是最终法语语言出厂审校员。检查封面、全部内页、Caption和商品承接中最终会显示的法语。英法混杂导致结构错误属于明确语法/拼写错误，例如Je pense that、Un grand number、Fondamentally，不能因解释提到B2就降成warning。明确标为错误示例且同时提供正确示范的句子不算成品错误。你的阻断权限必须非常窄。',
        'blockingIssues只允许三类低歧义问题：1. 明确拼写错误；2. 明确语法错误；3. 明显残句、法语句子结构不成立。只有这三类才允许返回corrections并触发自动修复。',
        '自然度、是否更适合B2、是否显得高级、register/语域偏好、Je/On/Mais/Donc/Parce que/Cordialement是否推荐、B1到B2教学判断、规则是否过度绝对、教学方法是否机械、是否有更好替代、内容深度、收藏价值、小红书感和页面资产感，全部只能放warnings，绝不能放blockingIssues，绝不能提供corrections。',
        '逐个读取完整canonical字段，检查中文解释中引用的法语和意外英语。结合上下文区分被明确标错的示例与推荐用法。中文括号、缩略词、条目标签不应被当成法语残句。',
        '不要充当教学观点裁判。只要法语在语法和拼写上成立，即使你更偏好另一种表达，也不得阻断。',
        'corrections.path必须原样取自final_visible_teaching_content；text必须是修正后的完整字段，不能只给解释或可选润色。',
        'approved只由blockingIssues决定：blockingIssues为空时必须为true，即使warnings非空。',
        '只返回JSON：{approved,blockingIssues:[{path,type,issue}],warnings:[{path,issue}],corrections:[{path,text,translation,reason}]}。type只能是spelling、grammar、fragment。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(auditInput) },
  ], { stage: 'qa', maxTokens: 3500, temperature: 0.1, retries: 1 });
  const rawBlocking = [
    ...(result.data.blockingIssues || []),
    ...(result.data.warnings || []).filter(isObjectiveFrenchBlockingIssue),
  ];
  const blockingIssues = normalizeObjectiveBlockingIssues(rawBlocking, result.data.issues);
  const qaWarnings = normalizeTeachingWarnings(result.data.warnings, result.data.issues, result.data.blockingIssues);
  const paths = objectiveBlockingPaths(rawBlocking, result.data.issues);
  // QA is read-only. Proposed corrections are evidence for the one repair owner.
  content.finalTeachingQa = {
    sourceInnerHash: stableHash(content.innerPages),
    requestId: result.requestId, inputSnapshotHash: stableHash(auditInput),
    approved: blockingIssues.length === 0, issues: blockingIssues,
    corrections: (result.data.corrections || []).filter(item => paths.has(clean(item.path))),
    appliedPatches: [],
    rejectedPatches: [...paths].filter(path => !finalPageSegments.some(field => field.path === path)).map(path => ({ path, reason: 'invalid canonical path' })),
    blockingIssues, blockingPaths: [...paths], warnings: qaWarnings,
    unresolvedBlockingIssues: blockingIssues, status: blockingIssues.length ? 'FAIL' : 'PASS',
  };
  return { ...artifactInput, data: content,
    prompt_version: artifactInput.prompt_version + '+teaching-qa-readonly-1',
    usage: mergeAiUsage(artifactInput.usage, result.usage), request_id: result.requestId,
    warnings: [...artifactInput.warnings, ...qaWarnings] };
}

export async function repairContentPackage(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: ContentStageInput,
  issues: PublishIssue[],
): Promise<VersionedArtifact<ContentPackage>> {
  assertInnerRepairAllowed(artifactInput.data);
  const result = await callOpenAICompatibleJsonWithUsage<{
    corrections?: Array<{ path?: string; text?: string; reason?: string }>;
  }>([
    { role: 'system', content: '你只负责一次明确法语拼写、语法或残句的局部纠错。只处理blockingIssues，不处理warnings、语域、是否B2或风格偏好。path必须逐字复制提供的字段路径，text必须是该字段修正后的全文。不得修改未报错字段，不得改变主题、数量、页面结构或增删教学材料。只返回JSON：{corrections:[{path,text,reason}]}。' },
    { role: 'user', content: JSON.stringify({
      blockingIssues: artifactInput.data.finalTeachingQa?.blockingIssues || issues,
      fields: collectFinalTeachingSegments(artifactInput.data),
      proposedCorrections: artifactInput.data.finalTeachingQa?.corrections,
    }) },
  ], { stage: 'targeted_repair', maxTokens: 3500, temperature: 0, retries: 1 });
  const content = structuredClone(artifactInput.data);
  const qa = content.finalTeachingQa!;
  const allowed = new Set(qa.blockingPaths || []);
  // Missing / invalid QA paths are never interpreted as resolved.
  const appliedPatches: NonNullable<typeof qa.appliedPatches> = [];
  const rejectedPatches: NonNullable<typeof qa.rejectedPatches> = [...qa.rejectedPatches];
  for (const patch of result.data.corrections || []) {
    if (allowed.has(clean(patch.path)) && applyCorrection(content, patch)) {
      appliedPatches.push({ ...patch, path: clean(patch.path) });
    } else rejectedPatches.push(patch);
  }
  content.finalTeachingQa = { ...qa, appliedPatches, rejectedPatches };
  content.frenchSegments = collectFinalTeachingSegments(content);
  return { ...artifactInput, data: content,
    prompt_version: artifactInput.prompt_version + '+targeted-repair-1',
    usage: mergeAiUsage(artifactInput.usage, result.usage), request_id: result.requestId };
}

function mergeCoverPatch(original: ContentBlock[], patch: RawContentResponse['coverBlocks'], minimumSections: number, minimumItems: number): NonNullable<RawContentResponse['coverBlocks']> {
  if (!Array.isArray(patch)) return original.map(block => ({ ...block })) as NonNullable<RawContentResponse['coverBlocks']>;
  const merged = original.map(block => ({ ...block })) as Array<Partial<ContentBlock> & Record<string, unknown>>;
  patch.forEach((block, index) => {
    const id = clean(block.id);
    const target = id ? merged.findIndex(item => clean(item.id) === id) : index;
    const previous = target >= 0 && target < merged.length ? merged[target] : undefined;
    const patchItems = Array.isArray(block.items) ? block.items : [];
    const previousItems = Array.isArray(previous?.items) ? previous.items : [];
    const items = patchItems.length >= minimumItems
      ? patchItems
      : [...patchItems, ...previousItems].filter((item, itemIndex, items) => {
          const key = JSON.stringify(item);
          return items.findIndex(candidate => JSON.stringify(candidate) === key) === itemIndex;
        }).slice(0, Math.max(minimumItems, previousItems.length));
    const next = { ...previous, ...block, items };
    if (target >= 0 && target < merged.length) merged[target] = next;
    else merged.push(next);
  });
  return (merged.length >= minimumSections ? merged : original) as NonNullable<RawContentResponse['coverBlocks']>;
}

function mergePagePatch(original: GeneratedInnerPage[], patch: unknown[] | undefined) {
  if (!Array.isArray(patch)) return original;
  const merged = original.map(page => ({ ...page, bullets: [...page.bullets] })) as Array<GeneratedInnerPage | Record<string, unknown>>;
  patch.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const page = raw as Record<string, unknown>;
    const requestedPageNo = Number(page.page_no);
    const requestedPageId = clean(page.pageId) || clean(page.page_id);
    const index = requestedPageId
      ? original.findIndex(item => item.pageId === requestedPageId)
      : Number.isFinite(requestedPageNo) ? original.findIndex(item => item.page_no === requestedPageNo) : -1;
    if (index < 0) return;
    const previous = original[index];
    const patchBullets = unique(page.bullets);
    const bullets = patchBullets.length >= 3
      ? patchBullets
      : Array.from(new Set([...patchBullets, ...(previous?.bullets || [])]));
    merged[index] = { ...previous, ...page, bullets };
  });
  return merged;
}

function mergeCaptionPatch(original: ContentPackage['captionParts'], patch: RawContentResponse['captionParts']) {
  if (!patch || Array.isArray(patch) || typeof patch !== 'object') return patch || original;
  const patchValue = Array.isArray(patch.value) ? patch.value.map(clean).filter(Boolean) : [];
  const value = patchValue.length >= 3
    ? patchValue
    : Array.from(new Set([...patchValue, ...original.value])).slice(0, 6);
  return {
    opening: clean(patch.opening) || original.opening,
    value,
    productBridge: clean(patch.productBridge) || original.productBridge,
    cta: clean(patch.cta) || original.cta,
  };
}

function isNoIssueStatement(value: unknown) {
  const text = clean(value);
  return /^(?:未发现|没有发现|无)(?:明确)?(?:的)?(?:法语|商品|考试|事实|拼写|语法|错误|问题)/.test(text)
    || /(?:未发现|无).*(?:错误|问题)/.test(text);
}

/** 最终出厂审校读取全部用户可见教学内容，不再按拉丁字母过滤纯中文规则。 */
function collectFinalTeachingSegments(content: ContentPackage) {
  const segments: Array<{ path: string; text: string; translation?: string }> = [];
  const add = (path: string, value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) return;
    segments.push({ path, text: value.trim() });
  };
  content.coverBlocks.forEach((block, blockIndex) => {
    add(`coverBlocks[${blockIndex}].heading`, block.heading);
    block.items.forEach((item, itemIndex) => {
      add(`coverBlocks[${blockIndex}].items[${itemIndex}].primary`, item.primary);
      add(`coverBlocks[${blockIndex}].items[${itemIndex}].secondary`, item.secondary);
      add(`coverBlocks[${blockIndex}].items[${itemIndex}].note`, item.note);
    });
  });
  content.innerPages.forEach((page, pageIndex) => {
    add(`innerPages[${pageIndex}].page_title`, page.page_title);
    add(`innerPages[${pageIndex}].lead`, page.lead);
    page.bullets.forEach((bullet, bulletIndex) => add(`innerPages[${pageIndex}].bullets[${bulletIndex}]`, bullet));
  });
  add('captionParts.opening', content.captionParts.opening);
  content.captionParts.value.forEach((value, index) => add(`captionParts.value[${index}]`, value));
  add('captionParts.productBridge', content.captionParts.productBridge);
  add('captionParts.cta', content.captionParts.cta);
  if (content.bridgePlan) {
    add('bridgePlan.freeSolves', content.bridgePlan.freeSolves);
    add('bridgePlan.userStillNeeds', content.bridgePlan.userStillNeeds);
    add('bridgePlan.whyProduct', content.bridgePlan.whyProduct);
    add('bridgePlan.naturalCta', content.bridgePlan.naturalCta);
  }
  return segments;
}

function collectNestedFrench(value: unknown, basePath: string, add: (path: string, value: unknown) => void) {
  if (typeof value === 'string') {
    add(basePath, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNestedFrench(item, `${basePath}[${index}]`, add));
    return;
  }
  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectNestedFrench(item, `${basePath}.${key}`, add));
  }
}

export function normalizeFinalPageItems(content: ContentPackage) {
  const normalizedPages = content.innerPages.map((page, pageIndex) => {
    page.page_title = sanitizeUserVisibleCopy(page.page_title);
    page.lead = sanitizeUserVisibleCopy(page.lead);
    page.bullets = cleanRenderableStringArray(page.bullets);
    if (page.renderPayload && typeof page.renderPayload === 'object') {
      normalizeRenderPayloadItems(page.renderPayload as unknown as Record<string, unknown>);
    }
    const pageHasContent = Boolean(page.page_title.trim() || page.lead.trim() || page.bullets.length || hasRenderablePayloadContent(page.renderPayload));
    if (!pageHasContent) throw new Error(`EMPTY_PAGE: innerPages[${pageIndex}] 过滤后没有实际内容`);
    return page;
  });
  content.innerPages = paginateVisiblePages(normalizedPages).map((page, index) => ({ ...page, page_no: index + 2 }));
  content.captionParts.opening = sanitizeUserVisibleCopy(content.captionParts.opening);
  content.captionParts.value = cleanRenderableStringArray(content.captionParts.value);
  content.captionParts.productBridge = sanitizeUserVisibleCopy(content.captionParts.productBridge);
  content.captionParts.cta = sanitizeUserVisibleCopy(content.captionParts.cta);
  if (content.bridgePlan) content.bridgePlan = sanitizeBridgePlan(content.bridgePlan);
  return content;
}

function normalizeRenderPayloadItems(payload: Record<string, unknown>) {
  for (const key of ['items', 'steps', 'cases', 'categories', 'groups']) {
    const value = payload[key];
    if (!Array.isArray(value)) continue;
    payload[key] = value
      .map((item) => normalizeRenderableValue(item))
      .filter((item) => hasRenderablePayloadContent(item));
  }
  for (const key of ['left', 'right', 'before', 'after']) {
    const value = payload[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) normalizeRenderPayloadItems(value as Record<string, unknown>);
  }
}

function normalizeRenderableValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeUserVisibleCopy(value);
  if (Array.isArray(value)) return value.map(normalizeRenderableValue).filter(hasRenderablePayloadContent);
  if (value && typeof value === 'object') {
    const next = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeRenderableValue(item)]));
    return next;
  }
  return value;
}

function hasRenderablePayloadContent(value: unknown): boolean {
  if (typeof value === 'string') return Boolean(value.trim() && !/^[\p{P}\p{S}\s]+$/u.test(value.trim()));
  if (Array.isArray(value)) return value.some(hasRenderablePayloadContent);
  if (value && typeof value === 'object') return Object.values(value).some(hasRenderablePayloadContent);
  return false;
}

function cleanRenderableStringArray(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .map(value => sanitizeUserVisibleCopy(value))
    .filter(value => hasRenderablePayloadContent(value));
}

const USER_VISIBLE_META_LABELS: Array<[RegExp, string]> = [
  [/^Header\s*[:：]?\s*/iu, '信件结构：'],
  [/^Salutation\s*[:：]?\s*/iu, '称呼：'],
  [/^Avoid\s*[:：]?\s*/iu, '不建议：'],
  [/^Use\s*[:：]?\s*/iu, '更自然的表达：'],
  [/^Check Register\s*[:：]?\s*/iu, '检查语域：'],
  [/^Topic Sentence\s*[:：]?\s*/iu, '观点句：'],
  [/^Argument\s*[:：]?\s*/iu, '论点：'],
  [/^Example\s*[:：]?\s*/iu, '例子：'],
  [/^Conclusion of Paragraph\s*[:：]?\s*/iu, '段落小结：'],
  [/\bFormal Letter\b/giu, '正式信'],
  [/\bEssay\b/giu, '议论文'],
  [/\bBoss\b/giu, '负责人'],
  [/\bBullet Points?\b/giu, '题目要求'],
  [/\bComplain\b/giu, '投诉'],
  [/\bApologize\b/giu, '道歉'],
  [/\bArgue\b/giu, '论证'],
  [/\bTopic Sentence\b/giu, '主题句'],
  [/\bExplanation\b/giu, '解释'],
  [/\bExample\b/giu, '例子'],
];

function sanitizeUserVisibleCopy(value: unknown) {
  let text = clean(value);
  if (!text) return '';
  text = normalizeMarkdownTable(text);
  text = text
    .replace(/```[a-z0-9_-]*\s*/giu, '')
    .replace(/```/gu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/__([^_]+)__/gu, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, '$1')
    .replace(/(?<!_)_([^_\n]+)_(?!_)/gu, '$1')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .replace(/^\s{0,3}#{1,6}\s+/u, '')
    .replace(/^\s*[-*+]\s+/u, '')
    .replace(/^\s*[|｜]\s*|\s*[|｜]\s*$/gu, '')
    .replace(/\s*[|｜]\s*/gu, ' · ')
    .replace(/Structure\s+Type\s+d['’]un\s+Paragraph(?:e)?\s+B2/giu, 'B2段落结构')
    .replace(/满足官方最低字数要求/gu, '检查是否达到要求的字数')
    .replace(/在\s*B2\s*[，,]\s*考官要看的是/gu, '到了B2，写作更需要呈现')
    .replace(/考官(?:最|更)?(?:看重|关注|要看的是)/gu, 'B2写作更看重');
  for (const [pattern, replacement] of USER_VISIBLE_META_LABELS) text = text.replace(pattern, replacement);
  return text.replace(/\s{2,}/gu, ' ').trim();
}

function normalizeMarkdownTable(value: string) {
  const lines = value.split(/\r?\n/u);
  const separator = lines.findIndex(line => /^\s*[|｜]?\s*:?-{3,}:?\s*(?:[|｜]\s*:?-{3,}:?\s*)+[|｜]?\s*$/u.test(line));
  if (separator < 1) return value;
  const cells = (line: string) => line.replace(/^\s*[|｜]|[|｜]\s*$/gu, '').split(/[|｜]/u).map(item => item.trim()).filter(Boolean);
  const header = cells(lines[separator - 1]);
  const rows = lines.slice(separator + 1).map(cells).filter(row => row.length);
  const before = lines.slice(0, separator - 1).filter(Boolean);
  const after: string[] = [];
  rows.forEach(row => after.push(row.map((cell, index) => header[index] ? `${header[index]}：${cell}` : cell).join('；')));
  return [...before, ...after].join('\n');
}

export function paginateVisiblePages(pages: GeneratedInnerPage[]) {
  const groupedPages: GeneratedInnerPage[] = [];
  const groupedByRoot = new Map<string, GeneratedInnerPage>();
  for (const page of pages) {
    if (page.page_type === 'product_bridge') {
      groupedPages.push(page);
      continue;
    }
    const pageId = page.pageId || `content_${groupedPages.length + 1}`;
    const rootId = pageId.replace(/(?:__part_\d+)+$/u, '');
    const baseTitle = page.page_title.replace(/(?:\s+[①②③④⑤⑥]|\s+\d+)\/\d+\s*$/u, '').trim();
    const existing = groupedByRoot.get(rootId);
    if (existing) {
      existing.bullets.push(...page.bullets);
      continue;
    }
    const grouped = { ...page, pageId: rootId, page_title: baseTitle, bullets: [...page.bullets] };
    groupedByRoot.set(rootId, grouped);
    groupedPages.push(grouped);
  }

  // 页面组织由 PAGE PLAN + FINAL PAGE CONTENT 决定。这里仅合并历史机械分页，
  // 不再按 bullet 数或字符数改写页面；真实 DOM overflow 由导出 Gate 阻断。
  return groupedPages;
}

const BRIDGE_INTERNAL_LANGUAGE = /引导|用户|商品|本篇免费内容|当前仅覆盖|弥补不足|获取完整支持|查看详情|转化|承接|商品价值/u;

function sanitizeBridgePlan(plan: BridgePlan): BridgePlan {
  const cleaned = {
    freeSolves: sanitizeUserVisibleCopy(plan.freeSolves),
    userStillNeeds: sanitizeUserVisibleCopy(plan.userStillNeeds),
    whyProduct: sanitizeUserVisibleCopy(plan.whyProduct),
    naturalCta: sanitizeUserVisibleCopy(plan.naturalCta),
  };
  if (!Object.values(cleaned).some(value => BRIDGE_INTERNAL_LANGUAGE.test(value))) return cleaned;
  return {
    freeSolves: '这一篇先把当前主题最常用的观点、表达和使用场景整理清楚。',
    userStillNeeds: '换到其他常见主题时，还需要继续准备对应的观点、表达和例子。',
    whyProduct: '我把更多常见主题、功能表达和范文结构也按同样的方法整理到完整资料里了。',
    naturalCta: '下一页可以直接看完整资料里还整理了哪些内容。',
  };
}

function normalizeInitialInnerPageContent(
  raw: RawContentResponse,
  input: ContentStageInput,
  pagePlan?: UserVisiblePagePlan[],
  innerEvidence: EvidenceSnippet[] = [],
): ContentPackage {
  const rawPages = Array.isArray(raw.innerPages) ? raw.innerPages
    : Array.isArray(raw.inner_pages) ? raw.inner_pages
      : Array.isArray(raw.pages) ? raw.pages
        : [];
  const validSourceIds = new Set(innerEvidence.map(item => item.id));
  const innerPages = normalizePages(rawPages).map((page, index) => ({
    ...page,
    page_no: index + 2,
    source_ids: page.source_ids.filter(id => validSourceIds.has(id)),
  }));
  if (!innerPages.length) throw new Error('V2内容阶段没有生成有效内容页');
  return {
    topicSnapshotHash: stableHash(input.topic),
    productionBriefHash: assertLockedProductionBrief(input.topic).briefHash,
    pagePlan,
    wholeNoteCore: buildWholeNoteCore(input),
    innerEvidence,
    coverBlocks: [],
    innerPages: innerPages.map(page => ({
      ...page,
      product_identity: examScopeContext(input.topic.productId, input.topic.examScope)?.displayIdentity
        || getProductPromptProfile(input.topic.productId).noteIdentity,
    })),
    captionParts: { opening: '', value: [], productBridge: '', cta: '' },
    tagMaterial: [],
    factualClaims: [],
    frenchSegments: [],
  };
}

function normalizeContent(raw: RawContentResponse, input: ContentStageInput, validSourceIds: string[], normalizationWarnings: string[] = []): ContentPackage {
  const validIds = new Set(validSourceIds);
  const accepted = new Set(input.capability.acceptedBlockKinds);
  const coverBlocks = (Array.isArray(raw.coverBlocks) ? raw.coverBlocks : [])
    .map((block, index) => normalizeBlock(block, index, accepted, validIds))
    .filter((block): block is ContentBlock => Boolean(block));
  if (!coverBlocks.length) {
    console.error('[v2-content-rejected]', JSON.stringify({
      product_id: input.topic.productId,
      template_id: input.topic.templateId,
      response_keys: raw && typeof raw === 'object' ? Object.keys(raw) : [],
      response_preview: JSON.stringify(raw).slice(0, 5000),
    }));
    throw new Error('V2内容阶段没有生成可供封面编译的完整内容块');
  }
  const rawPages = Array.isArray(raw.innerPages) ? raw.innerPages
    : Array.isArray(raw.inner_pages) ? raw.inner_pages
      : Array.isArray(raw.pages) ? raw.pages
        : [];
  let innerPages = normalizePages(rawPages);
  if (!innerPages.length) {
    console.error('[v2-inner-pages-rejected]', JSON.stringify({
      product_id: input.topic.productId,
      template_id: input.topic.templateId,
      raw_page_count: rawPages.length,
      raw_pages_preview: JSON.stringify(rawPages).slice(0, 12000),
    }));
    throw new Error('V2内容阶段没有生成有效内容页');
  }
  innerPages = innerPages.map((page, index) => ({ ...page, page_no: index + 2 }));
  const caption = normalizeCaptionParts(raw.captionParts);
  const bridgePlan = normalizeBridgePlan(raw, input, normalizationWarnings);
  const suppliedFrenchSegments = (Array.isArray(raw.frenchSegments) ? raw.frenchSegments : [])
    .map(item => ({ path: clean(item.path), text: clean(item.text) || clean(item.original), translation: clean(item.translation) || undefined }))
    .filter(item => item.path && item.text && containsAuditableFrench(item.text));
  const segmentsByPath = new Map(suppliedFrenchSegments.map(item => [item.path, item]));
  coverBlocks.forEach((block, blockIndex) => block.items.forEach((item, itemIndex) => {
    if (!containsAuditableFrench(item.primary)) return;
    const path = `coverBlocks[${blockIndex}].items[${itemIndex}].primary`;
    if (!segmentsByPath.has(path)) {
      segmentsByPath.set(path, { path, text: item.primary, translation: item.secondary });
    }
  }));
  const content: ContentPackage = {
    topicSnapshotHash: stableHash(input.topic),
    productionBriefHash: assertLockedProductionBrief(input.topic).briefHash,
    pagePlan: normalizePagePlan(raw.pagePlan),
    coverBlocks,
    innerPages,
    ...(bridgePlan ? { bridgePlan } : {}),
    captionParts: {
      opening: caption.opening,
      value: caption.value,
      productBridge: caption.productBridge,
      cta: caption.cta,
    },
    tagMaterial: unique(raw.tagMaterial).slice(0, 12),
    factualClaims: (Array.isArray(raw.factualClaims) ? raw.factualClaims : []).map(item => ({
      text: clean(item.text) || clean(item.claim),
      type: normalizeClaimType(item.type, clean(item.text) || clean(item.claim), unique(item.sourceIds).filter(id => validIds.has(id))),
      sourceIds: unique(item.sourceIds).filter(id => validIds.has(id)),
    })).filter(item => item.text),
    frenchSegments: Array.from(segmentsByPath.values()),
  };
  if (hasForbiddenProductIdentity(input.topic.productId, JSON.stringify(content))) throw new Error('V2内容阶段发生商品身份串线');
  return content;
}

/**
 * 阶段 C（设计 §5）：解析带货承接四拍计划。软约束——缺失或部分缺失只警告，
 * 绝不让任务失败；四拍完整才写入 ContentPackage（保持类型简单，不存半成品）。
 * 三商品的非原创普通模式消费该字段；AI原创和showcase不消费。
 */
function normalizeBridgePlan(raw: RawContentResponse, input: ContentStageInput, normalizationWarnings: string[]): BridgePlan | undefined {
  const isProductShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  if (!resolveContentBriefActive(input.topic.productId, isProductShowcase) || input.topic.knowledgeMode === 'educational_original') return undefined;
  const source = raw.bridgePlan && typeof raw.bridgePlan === 'object' && !Array.isArray(raw.bridgePlan) ? raw.bridgePlan : {};
  const beats = {
    freeSolves: clean(source.freeSolves),
    userStillNeeds: clean(source.userStillNeeds),
    whyProduct: clean(source.whyProduct),
    naturalCta: clean(source.naturalCta),
  };
  const missingBeats = (Object.keys(beats) as Array<keyof typeof beats>).filter(key => !beats[key]);
  if (missingBeats.length) {
    normalizationWarnings.push(`带货承接计划缺失：${missingBeats.length === 4 ? '响应未提供 bridgePlan' : `bridgePlan 缺 ${missingBeats.join('、')}`}，正文仍按原承接规则执行`);
    return undefined;
  }
  return beats;
}

function containsAuditableFrench(value: string) {
  const withoutExamNames = value.replace(/\b(?:DELF|TEF|TCF|CLB|NCLC|IRCC|Canada)\b/gi, ' ');
  return /\b[A-Za-zÀ-ÖØ-öø-ÿŒœÇç]{2,}(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+)*\b/u.test(withoutExamNames);
}

function normalizeBlock(raw: Partial<ContentBlock> & Record<string, unknown>, index: number, accepted: Set<ContentBlockKind>, validIds: Set<string>): ContentBlock | null {
  const kind = accepted.has(raw.kind as ContentBlockKind) ? raw.kind as ContentBlockKind : Array.from(accepted)[0];
  const items = (Array.isArray(raw.items) ? raw.items : []).map(item => {
    if (typeof item === 'string') return { primary: clean(item) };
    const record = item && typeof item === 'object' ? item as unknown as Record<string, unknown> : {};
    return { primary: clean(record.primary) || clean(record.text), secondary: clean(record.secondary) || clean(record.translation) || undefined, note: clean(record.note) || undefined };
  }).filter(item => item.primary);
  if (!items.length) return null;
  return {
    id: clean(raw.id) || `block_${index + 1}`,
    kind,
    heading: clean(raw.heading) || clean(raw.title) || undefined,
    items,
    priority: [1, 2, 3].includes(Number(raw.priority)) ? raw.priority as 1 | 2 | 3 : 2,
    sourceMode: ['product_fact', 'exam_fact', 'general_advice', 'ai_example'].includes(String(raw.sourceMode)) ? raw.sourceMode as ContentBlock['sourceMode'] : 'general_advice',
    sourceIds: unique(raw.sourceIds).filter(id => validIds.has(id)),
  };
}

function normalizePages(value: unknown): GeneratedInnerPage[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const page = raw && typeof raw === 'object' ? raw as Partial<GeneratedInnerPage> : {};
    const allowed = ['knowledge_list', 'example_explain', 'wrong_right', 'steps', 'product_bridge'];
    const record = page as Record<string, unknown>;
    const visibleCopy = record.pageCopy && typeof record.pageCopy === 'object' ? record.pageCopy as Record<string, unknown> : {};
    const bullets = normalizeBullets(page.bullets)
      .concat(normalizeBullets(record.items))
      .concat(normalizeBullets(record.contentPoints))
      .concat(normalizeBullets(visibleCopy.bullets))
      .concat(normalizeBullets(record.examples));
    return {
      pageId: clean((page as Record<string, unknown>).pageId) || clean((page as Record<string, unknown>).page_id) || `content_${index + 1}`,
      page_no: index + 2,
      page_type: allowed.includes(String(page.page_type)) ? page.page_type as GeneratedInnerPage['page_type'] : 'knowledge_list',
      semanticLayoutType: semanticLayoutTypeFromAssetType(String((page as Record<string, unknown>).semanticLayoutType || '')),
      renderPayload: undefined,
      renderPayloadStatus: 'INSUFFICIENT_STRUCTURED_CONTENT' as const,
      page_title: clean(page.page_title) || clean(record.pageTitle) || clean(visibleCopy.pageTitle) || clean(record.title),
      lead: clean(page.lead) || clean(record.pageLead) || clean(visibleCopy.lead) || clean(record.content),
      bullets: Array.from(new Set(bullets)),
      source_ids: unique(page.source_ids),
      style_variant: page.style_variant,
    };
  }).filter(page => page.page_title && (
    page.bullets.length > 0
    || Boolean(page.lead)
    || hasRenderablePayloadContent(page.renderPayload)
  ));
}

function normalizeBullets(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => {
    if (typeof item === 'string') return clean(item);
    if (!item || typeof item !== 'object') return '';
    const record = item as Record<string, unknown>;
    const direct = clean(record.text) || clean(record.content) || clean(record.primary);
    if (direct) return direct;
    const labels: Record<string, string> = {
      b1: 'B1', b2: 'B2', b1_level: 'B1', b2_depth: 'B2', original: '原句', upgraded: '改写后',
      before: '修改前', after: '修改后', analysis: '说明', technique: '改写方法', logic_chain: '逻辑链',
      check: '检查项', criterion: '判断标准', actionIfFail: '未通过时修改', example: '例句',
      error: '错误示例', reason: '原因', correction: '修正', correct_example: '正确示例',
    };
    return Object.entries(record)
      .filter(([key, field]) => key !== 'type' && typeof field === 'string' && clean(field))
      .map(([key, field]) => `${labels[key] || key}：${clean(field)}`)
      .join('｜');
  }).filter(Boolean)));
}

function normalizeRenderPayload(value: unknown): GeneratedInnerPage['renderPayload'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const semanticLayoutType = semanticLayoutTypeFromAssetType(String(record.semanticLayoutType || ''));
  return { ...record, semanticLayoutType } as GeneratedInnerPage['renderPayload'];
}

function formatAuditIssue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return String(value ?? '未说明问题');
  const record = value as Record<string, unknown>;
  const preferred = [record.message, record.issue, record.reason, record.detail]
    .find(item => typeof item === 'string' && item.trim());
  if (typeof preferred === 'string') return preferred.trim();
  try {
    return JSON.stringify(record);
  } catch {
    return '审校返回了无法解析的问题对象';
  }
}

function normalizeCaptionParts(value: RawContentResponse['captionParts']): ContentPackage['captionParts'] {
  if (Array.isArray(value)) {
    const parts = value.map(item => clean(item?.text)).filter(Boolean);
    return {
      opening: parts[0] || '',
      value: parts.slice(1, -1).length ? parts.slice(1, -1) : parts.slice(1),
      productBridge: parts.length >= 3 ? parts.at(-1)! : '',
      cta: '',
    };
  }
  const caption = value && typeof value === 'object' ? value : { opening: '', value: [], productBridge: '', cta: '' };
  const rawValue = (caption as Record<string, unknown>).value;
  const normalizedValue = Array.isArray(rawValue)
    ? rawValue.map(item => {
      if (typeof item === 'string') return clean(item);
      if (!item || typeof item !== 'object') return '';
      const record = item as Record<string, unknown>;
      return clean(record.text) || clean(record.content) || clean(record.paragraph) || clean(record.value);
    }).filter(Boolean)
    : typeof rawValue === 'string'
      ? rawValue.split(/\n{2,}/u).map(clean).filter(Boolean)
      : rawValue && typeof rawValue === 'object'
        ? Object.values(rawValue as Record<string, unknown>).map(clean).filter(Boolean)
        : [];
  return {
    opening: clean(caption.opening),
    value: Array.from(new Set(normalizedValue)).slice(0, 6),
    productBridge: clean(caption.productBridge),
    cta: clean(caption.cta),
  };
}

function normalizeClaimType(value: unknown, text: string, sourceIds: string[]): ContentPackage['factualClaims'][number]['type'] {
  if (sourceIds.some(id => /^OFF-/i.test(id))) return 'exam';
  if (['product', 'exam', 'general_advice', 'example'].includes(String(value))) return value as ContentPackage['factualClaims'][number]['type'];
  if (!sourceIds.length) return /例如|比如|示例/.test(text) ? 'example' : 'general_advice';
  if (/官方|考试|要求|至少|至多|评分|分数|CLB|NCLC|\d+\s*词/.test(text) && !/资料|产品|包含|库|篇|条/.test(text)) return 'exam';
  return 'product';
}

function coverHierarchyKey(value: unknown) {
  return clean(value).toLowerCase().replace(/delf|b2|法语|写作|[\s\p{P}\p{S}]/gu, '');
}

function directlyRepeatsWholeNote(heading: string, wholeNoteTexts: string[]) {
  const local = coverHierarchyKey(heading);
  if (local.length < 6) return false;
  return wholeNoteTexts.some(value => {
    const whole = coverHierarchyKey(value);
    if (whole.length < 6) return false;
    return local === whole || (Math.min(local.length, whole.length) >= 8 && (local.includes(whole) || whole.includes(local)));
  });
}

function validateContent(content: ContentPackage, input: ContentStageInput): string[] {
  const warnings: string[] = [];
  const caption = [content.captionParts.opening, ...content.captionParts.value, content.captionParts.productBridge, content.captionParts.cta].join('\n');
  if (!caption.includes(input.topic.seo.primary)) warnings.push('正文开头或正文未自然出现主SEO词');
  if (caption.length < 350) warnings.push('正文信息量偏少');
  const templateSpec = getCoverTemplateSpec(input.capability.renderer);
  const minimumItems = templateSpec?.minTotalItems
    ?? input.capability.densityTiers[0].sectionRange[0] * input.capability.densityTiers[0].itemRange[0];
  if (content.coverBlocks.reduce((sum, block) => sum + block.items.length, 0) < minimumItems) warnings.push('封面候选内容未达到实测总容量下限，编译时可能降级');
  const task = input.topic.batchEditorialTask;
  const wholeNoteTexts = [input.topic.topic, input.topic.promise, task?.lockedMotherTopic || '', task?.promise || ''];
  for (const block of content.coverBlocks) {
    if (!block.heading) continue;
    if (directlyRepeatsWholeNote(block.heading, wholeNoteTexts)) warnings.push(`封面H2“${block.heading}”直接重复整篇选题或承诺，应改为服务本组items的局部栏目名`);
    if (/DELF\s*B2|法语\s*B2|B2\s*写作/iu.test(block.heading)) warnings.push(`封面H2“${block.heading}”重复考试身份，应由封面H1或kicker承担`);
  }
  return warnings;
}

function applyCorrection(content: ContentPackage, correction: { path?: string; text?: string; translation?: string }): boolean {
  const path = clean(correction.path);
  if (!correction.text || !collectFinalTeachingSegments(content).some(item => item.path === path)) return false;
  if (stringAtPath(content, path) === undefined || !setStringAtPath(content, path, correction.text)) return false;
  const pageIndex = /^innerPages\[(\d+)\]/.exec(path);
  if (pageIndex) invalidateDerivedRenderPayload(content.innerPages[Number(pageIndex[1])]);
  return true;
}

/**
 * page_title / lead / bullets 是最终可见内容真源。当前没有可靠的确定性代码
 * 可以从任意自然语言页面重建专用 renderPayload，因此 source 被修复后必须
 * 丢弃旧投影，并让 Renderer 安全回退到修复后的普通 bullets 布局。
 */
function invalidateDerivedRenderPayload(page: GeneratedInnerPage) {
  page.renderPayload = undefined;
  page.renderPayloadStatus = 'INSUFFICIENT_STRUCTURED_CONTENT';
}

function setStringAtPath(root: unknown, path: string, value: string): boolean {
  const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let current: any = root;
  for (const token of tokens.slice(0, -1)) {
    if (current == null || (typeof current !== 'object' && !Array.isArray(current)) || !(token in current)) return false;
    current = current[token];
  }
  const key = tokens.at(-1);
  if (current && key && typeof current === 'object' && key in current) {
    current[key] = clean(value);
    return true;
  }
  return false;
}

function artifact(data: ContentPackage, inputHash: string, usage: AiUsageSummary, requestId: string, warnings: string[]): VersionedArtifact<ContentPackage> {
  return { data, schema_version: V2_SCHEMA_VERSION, prompt_version: CONTENT_PROMPT_VERSION, input_hash: inputHash, created_at: new Date().toISOString(), usage, warnings, request_id: requestId };
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function unique(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(clean).filter(Boolean))) : [];
}

export function contentUsage(artifact: VersionedArtifact<ContentPackage> | undefined): AiUsageSummary {
  return artifact?.usage || emptyAiUsage();
}
