import { callOpenAICompatibleJsonWithUsage, mergeAiUsage, type AiUsageSummary, type AiResponseTrace } from '@/lib/ai-client';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getRoutedTitleFormulas } from '@/lib/full-title-formula-catalog';
import { getProductPromptProfile, hasForbiddenProductIdentity, hasRequiredProductIdentity } from '@/lib/product-prompt-profiles';
import { fingerprintTitle, getRecentTitleFingerprints, titleTemplateFingerprint } from '@/lib/title-usage-store';
import type { MigratedTopic } from '@/types/reference-workflow';
import { countVisibleUnits, stableHash, type ContentPackage, type TemplateCapability, type TitleClickMode, type TitlePackage, type TitlePair, type TitleStageTrace, type TopicOption, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { assertLockedProductionBrief } from './content-brief';
import { candidateMixForDirections, clampTitleCandidateCount, classifyTitleDirection, sampleDirectionsForNote, shouldPreferGroundedEmotionDefault, titleDirectionPromptLines, titlePromiseBeyondRange, titlePromiseRangeText, resolveTitleConsensusActive, type TitleDirection } from './title-consensus';
import { getProductEditorialMap } from './product-editorial-map';
import { formatTitleHumanizerPair, getTitleHumanizerPairs } from './title-humanizer-library';
import { findStylePlagiarism, formatStyleReferenceForPrompt, getDelfB2ShortStyleReferences, getTitleStyleReferences, type TitleStyleReference } from './title-style-library';
import { getDelfB2RelatedSearchPhrases } from './delf-search-signals';
import { buildNativeTitlePrompt, extractNativeTitleCandidates } from './native-title-skill';
import { FACT_BOUNDARY_VERSION, FACT_BOUNDARY_SYSTEM, currentNoteBoundary, normalizeScopedFacts } from './note-fact-boundary';
import { PRODUCTION_TEXT_MODEL } from './production-models';
import { examScopeContext } from '@/lib/product-exam-context';

export const TITLE_PROMPT_VERSION = 'v3-title-root-fix-4-asset-cover-language';
export const TITLE_CANDIDATE_COUNT = 4;
export const TEXT_PRODUCTION_VERSION = 'space-xhs-title-native-full-v6';
export const FACT_BRIEF_MODEL = PRODUCTION_TEXT_MODEL;
export const TEXT_MODEL = PRODUCTION_TEXT_MODEL;
export const TITLE_BOUNDARY_REVIEW_VERSION = 'semantic-boundary-gate-1';

const briefInFlight = new Map<string, Promise<VersionedArtifact<ContentPackage>>>();
export async function generateAutoTitleFactBrief(source: VersionedArtifact<ContentPackage>, input: TitleStageInput, cacheDir = path.join(process.cwd(),'data','auto-fact-brief-cache')) {
  assertReviewedInner(source.data);
  if (source.data.manualInnerReview?.status !== 'locked') throw new Error('INNER_NEEDS_HUMAN_REVIEW');
  const key = `${cacheDir}:${stableHash(source.data.innerPages)}`;
  const pending = briefInFlight.get(key);
  if (pending) { const result = await pending; return {...source,data:{...source.data,autoFactBrief:result.data.autoFactBrief}}; }
  const work = generateCachedFactBrief(source,input,cacheDir);
  briefInFlight.set(key,work);
  try { return await work; } finally { briefInFlight.delete(key); }
}
async function generateCachedFactBrief(source: VersionedArtifact<ContentPackage>, input: TitleStageInput, cacheDir: string) {
  assertReviewedInner(source.data);
  if (source.data.manualInnerReview?.status !== 'locked') throw new Error('INNER_NEEDS_HUMAN_REVIEW');
  const sourceInnerHash = stableHash(source.data.innerPages);
  const deterministicCounts = () => standardKnowledgeSupportedAssets({...input,content:{...input.content,autoFactBrief:undefined}}).map(c => ({...c,
    scope:c.sourcePages.length===1?`局部（第${c.sourcePages[0]}页）`:`覆盖第${c.sourcePages.join('、')}页`,
  }));
  if (currentNoteBoundary(source.data)) {
    return {...source,data:{...source.data,autoFactBrief:{...source.data.autoFactBrief!,supportedCounts:deterministicCounts()}}};
  }
  const cacheFile = path.join(cacheDir, `${FACT_BOUNDARY_VERSION}-${sourceInnerHash}.json`);
  try {
    const cached = JSON.parse(await readFile(cacheFile,'utf8')) as ContentPackage['autoFactBrief'];
    if (currentNoteBoundary({...source.data,autoFactBrief:cached})) return {...source,data:{...source.data,autoFactBrief:cached}};
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const canonicalInner = source.data.innerPages.map(p => ({pageNo:p.page_no,pageTitle:p.page_title,lead:p.lead,bullets:p.bullets,contentForm:p.semanticLayoutType || p.page_type}));
  const result = await callOpenAICompatibleJsonWithUsage<{factBrief:string;userTask:string;scopeNotes:string[];noteCore:string;deliverables:string[];scopedFacts:unknown[];doNotReframe:string[]}>([
    {role:'system',content:FACT_BOUNDARY_SYSTEM}, {role:'user',content:JSON.stringify({canonicalInner})},
  ], {stage:'fact_brief',model:FACT_BRIEF_MODEL,temperature:0.2,maxTokens:3600,retries:1,thinking:false,
    onResponseTrace: async trace => { const dir=path.join(process.cwd(),'data','final-content-traces',trace.requestId);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'05_FACT_BOUNDARY_REQUEST_RAW.json'),JSON.stringify(trace,null,2)); }});
  let autoFactBrief;
  try {
    autoFactBrief = finalizeAutoTitleFactBrief(source, input, result.data);
  } catch (error) {
    // A valid provider response still incurred usage if deterministic parsing fails.
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {usage: result.usage});
  }
  await mkdir(cacheDir,{recursive:true});
  await writeFile(cacheFile,JSON.stringify(autoFactBrief,null,2),{flag:'wx'});
  return {...source, data:{...source.data,autoFactBrief},usage:mergeAiUsage(source.usage,result.usage)};
}

/** Pure response normalization also permits offline replay of saved provider output. */
export function finalizeAutoTitleFactBrief(source: VersionedArtifact<ContentPackage>, input: TitleStageInput, value: unknown) {
  const raw = value as {factBrief:string;userTask:string;scopeNotes:string[]|string;noteCore:string;deliverables:string[];scopedFacts:unknown[];doNotReframe:string[]};
  const scopeNotes = typeof raw?.scopeNotes === 'string' ? (raw.scopeNotes.trim() ? [raw.scopeNotes.trim()] : []) : raw?.scopeNotes;
  if (!raw || typeof raw.factBrief !== 'string' || !raw.factBrief.trim() || typeof raw.userTask !== 'string' || !raw.userTask.trim()
    || !Array.isArray(scopeNotes) || scopeNotes.some(n=>typeof n!=='string')
    || typeof raw.noteCore !== 'string' || !raw.noteCore.trim()
    || !Array.isArray(raw.deliverables) || !raw.deliverables.length || raw.deliverables.some(n=>typeof n!=='string')
    || !Array.isArray(raw.doNotReframe) || raw.doNotReframe.some(n=>typeof n!=='string')) {
    throw new Error('INVALID_AUTO_FACT_BRIEF');
  }
  // Model count suggestions are not authority. Reuse the locked-source extractor;
  // deterministic source pages also own scope. Do not lose counts the AI omitted.
  const sourceInnerHash = stableHash(source.data.innerPages);
  const supportedCounts = standardKnowledgeSupportedAssets({...input,content:{...source.data,autoFactBrief:undefined}}).map(c=>({...c,
    scope:c.sourcePages.length===1?`局部（第${c.sourcePages[0]}页）`:`覆盖第${c.sourcePages.join('、')}页`}));
  return {factBrief:raw.factBrief.trim(),userTask:raw.userTask.trim(),scopeNotes,
    supportedCounts,sourceInnerHash,boundaryVersion:FACT_BOUNDARY_VERSION,noteCore:raw.noteCore.trim(),
    deliverables:raw.deliverables,scopedFacts:normalizeScopedFacts(raw.scopedFacts,source.data.innerPages),doNotReframe:raw.doNotReframe.slice(0,4)};
}

type TitleMechanism = 'search_utility' | 'loss_tension' | 'cognitive_conflict' | 'result_gain';

type TitleCategoryFn = (pair: TitlePair) => string;

export interface TitleStageInput {
  topic: TopicOption;
  capability: TemplateCapability;
  content: ContentPackage;
  /** 阶段 D（设计 §4.1）：输出组数入参；仅商品1普通模式（共识门控开）生效，clamp 1-8 默认 4。legacy 路径恒为 4。 */
  candidateCount?: number;
  /** 同批更早Job的全部生成候选：代码全量去重；模型只看最近40条以控制上下文。 */
  recentGeneratedTextTitles?: string[];
  noteMode?: 'product_note';
  productNoteContext?: {
    noteMode: 'product_note'; productId: string; angleId: string; angleLabel: string;
    targetBuyer: string; buyerMoment: string; mainClaim: string; supportingBenefits: string[];
    selectedAssetIds: string[]; assets: Array<{ assetId: string; reason: string; pageRole: string; shortTitle: string; badge: string; oneLine: string }>;
  };
}

interface RawTitleResponse {
  candidates?: Array<Partial<TitlePair> & Record<string, unknown>>;
  primary?: RawSlotResponse;
  secondary?: RawSlotResponse;
  emotional?: RawSlotResponse;
  alternate?: RawSlotResponse;
}

interface RawSlotResponse {
  slotId?: string;
  requestedClickMode?: string;
  bundle?: Partial<TitlePair> & Record<string, unknown>;
  textTitle?: string;
  coverTitle?: string;
  coverSubtitle?: string;
  coverKicker?: string;
  clickMode?: string;
  clickReason?: string;
  bundleIntent?: string;
  bundleAnchor?: string;
  bundleIntentKeywords?: string[];
  mechanism?: string;
  userRelation?: string;
  sourceDirection?: string;
  seoKeyword?: string;
  noveltyFingerprint?: string;
}

const TITLE_SLOT_IDS = ['primary', 'secondary', 'emotional', 'alternate'] as const;
type TitleSlotId = typeof TITLE_SLOT_IDS[number];
type TitleSlotMap = Record<TitleSlotId, TitlePair | null>;

export function diagnoseTitlePair(
  pair: TitlePair,
  input: TitleStageInput,
  selected = new Set<string>(),
  coverTitles = new Set<string>(),
) {
  return titleGateFailures(pair, input, selected, coverTitles);
}

export function selectTitleCandidateForTest(
  candidates: TitlePair[],
  input: TitleStageInput,
  recentRecords: Array<{ title: string; cover_title: string }> = [],
) {
  return selectTitleCandidate(candidates, input, new Map(), recentRecords);
}

export function passesTitleHardGatesForTest(
  pair: TitlePair,
  input: TitleStageInput,
  opts: { consensusLength?: boolean; relaxMarketing?: boolean } = {},
) {
  return passesHardGates(pair, input, new Set(), new Set(), false,
    opts.consensusLength === true, opts.relaxMarketing === true);
}

import { assertReviewedInner, teachingPages } from '@/lib/manual-inner-review';

export async function generateTitlePackage(input: TitleStageInput): Promise<VersionedArtifact<TitlePackage>> {
  assertReviewedInner(input.content);
  const lockedBrief = assertLockedProductionBrief(input.topic);
  if (input.content.productionBriefHash !== lockedBrief.briefHash) throw new Error('标题阶段拒绝运行：内容工单哈希不一致');
  const profile = getProductPromptProfile(input.topic.productId);
  const examContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const recent = await getRecentTitleFingerprints(input.topic.productId, { days: 30 });
  const migrated = toMigrated(input.topic);
  const formulas = getRoutedTitleFormulas(migrated, input.capability.family).map(item => ({ id: item.id, trigger: item.trigger_type, skeleton: item.formula }));
  const coverSummary = input.content.coverBlocks.slice(0, 6).map(block => ({ heading: block.heading, kind: block.kind, items: block.items.slice(0, 4) }));
  const templateSpec = getCoverTemplateSpec(input.capability.renderer);
  const coverRange = templateSpec?.titleLengthRange || [8, 18];
  const supportedNumbers = contentNumbers(input);
  const productShowcase = isTitleProductShowcase(input.topic, input.noteMode);
  // 阶段 D 门控：商品1普通模式与商品2/3的普通+AI原创模式走完整Title Skill；
  // showcase 仍保留展示链，避免把商品介绍混入普通内容标题。
  const consensusActive = resolveTitleConsensusActive(input.topic.productId, productShowcase);
  if (consensusActive) {
    return generateStandardKnowledgeTitlePackage(input, {
      lockedBrief,
      recent,
      profile,
      coverSummary,
      templateSpec,
      coverRange,
    });
  }
  const effectiveCount = consensusActive ? clampTitleCandidateCount(input.candidateCount) : TITLE_CANDIDATE_COUNT;
  const directions = consensusActive ? sampleDirectionsForNote(input.topic.noveltyFingerprint, effectiveCount) : [];
  const slotSpecs = {
    primary: { requestedClickMode: primaryClickMode(input) },
    secondary: { requestedClickMode: secondaryClickMode(primaryClickMode(input), input) },
    emotional: { requestedClickMode: 'VOICE_EXPERIENCE' as const },
    alternate: { requestedClickMode: 'INSIGHT_CONTRARIAN' as const },
  };
  const categoryFn: TitleCategoryFn = consensusActive ? classifyTitleDirection : classifyTitleMechanism;
  const editorialMap = consensusActive ? getProductEditorialMap(input.topic.productId) : undefined;
  const approvedStyleExamples = consensusActive
    ? getTitleStyleReferences(input.topic.productId, 12).map(formatStyleReferenceForPrompt)
    : [];
  const baseActualContent = {
    cover: coverSummary,
    opening: input.content.captionParts.opening,
    value_points: input.content.captionParts.value.slice(0, 4),
  };
  const promptInput = {
    locked_production_brief: lockedBrief,
    product: { identity: examContext?.displayIdentity || profile.noteIdentity, short_identity: profile.shortIdentity, scope: profile.editorialScopePrompt,
      ...(examContext ? { exam_scope: examContext.scope, exam_scope_rule: examContext.rule, target_audience: examContext.audience } : {}) },
    topic: input.topic,
    actual_content: consensusActive ? {
      ...baseActualContent,
      // 阶段 D（设计 §4.1）：内页摘要 5 页 {page_title, lead, bullets前3} 进 prompt。
      inner_pages: input.content.innerPages.slice(0, 5).map(page => ({
        page_title: page.page_title,
        lead: page.lead,
        bullets: page.bullets.slice(0, 3),
      })),
    } : baseActualContent,
    cover: {
      renderer: input.capability.renderer,
      family: input.capability.family,
      allowed_mechanisms: input.capability.allowedTitleMechanisms,
      cover_title_visible_units: coverRange,
      title_capacity: templateSpec ? {
        titleMinVisibleChars: templateSpec.titleMinVisibleChars,
        titlePreferredMinChars: templateSpec.titlePreferredMinChars,
        titlePreferredMaxChars: templateSpec.titlePreferredMaxChars,
        titleMaxVisibleChars: templateSpec.titleMaxVisibleChars,
        titleMaxLines: templateSpec.titleMaxLines,
        subtitleMaxVisibleChars: templateSpec.subtitleMaxVisibleChars,
        subtitleMaxLines: templateSpec.subtitleMaxLines,
        kickerSupported: templateSpec.kickerSupported,
        kickerMaxVisibleChars: templateSpec.kickerMaxVisibleChars,
        preferredTextAlign: templateSpec.preferredTextAlign,
      } : undefined,
      text_title_visible_units: [12, 20],
    },
    allowed_numbers_from_actual_content: supportedNumbers,
    formula_skeletons: formulas,
    required_candidate_mix: consensusActive ? candidateMixForDirections(directions) : productShowcase ? {
      search_utility: 1,
      loss_tension: 1,
      cognitive_conflict: 1,
      result_gain: 1,
    } : {
      search_utility: 1,
      loss_tension: 1,
      cognitive_conflict: 1,
      result_gain: 1,
    },
    recent_selected_titles_to_avoid: recent.records.slice(-30).map(item => item.title),
    recent_cover_titles_to_avoid: recent.records.slice(-30).map(item => item.cover_title),
    product_showcase_title_directions: productShowcase ? [
      '平铺介绍：让用户一眼知道这个知识库具体有什么、怎么查、为什么值得收藏',
      '情绪痛点：从备考者正在经历的具体困扰切入，再自然指向这套资料',
      '强获得感：突出体系、大全、稀缺整理或考前可直接使用的价值，但不能只报数量',
      '适度吹爆：用有依据的强判断表达资料的完整、好用、值得看，不冒充官方或虚构效果',
    ] : undefined,
    // 阶段 D 输入增补（仅门控开；全部是结构化输入，不含固定文字示例）：
    // 商品能力列表、购买者地图三块全量、标题可承诺范围。legacy 路径这些键不存在。
    ...(consensusActive ? {
      approved_title_style_examples: approvedStyleExamples,
      product_capabilities: editorialMap ? editorialMap.capabilities.map(item => ({
        capability_id: item.capabilityId,
        capability: item.capability,
        modules: item.modules,
      })) : undefined,
      buyer_map: editorialMap?.buyerMap,
      title_promise_range: titlePromiseRangeText(input.topic),
    } : {}),
  };
  const inputHash = stableHash(promptInput);
  // 阶段 D（设计 §4.4）：candidateCount>4 时首轮 900+320*count，返修按 1800:1400 同比例放大；默认 4 维持 1800/1400。
  const firstMaxTokens = consensusActive && effectiveCount > 4 ? 900 + 320 * effectiveCount : 1800;
  const repairMaxTokens = firstMaxTokens === 1800 ? 1400 : Math.round((firstMaxTokens * 1400) / 1800);
  const result = await callOpenAICompatibleJsonWithUsage<RawTitleResponse>([
    {
      role: 'system',
      content: [
        '你是资深小红书标题主编。内容已经确定，你只生成“文字标题+封面标题+可选副标题”的成对候选，不得改内容。',
        '请只返回合法 json 对象，不要输出 Markdown、解释或 json 之外的文字。 Return only a valid json object.',
        '文字标题负责搜索和点击，必须让用户一眼知道法语考试/科目、具体对象和看完能得到什么；不超过20个可见字。',
        `文字标题必须为12到20个可见字；封面标题必须为${coverRange[0]}到${coverRange[1]}个可见字。汉字、字母、数字、标点各算1个，空格也计入容量上限。`,
        '封面标题是用户第一眼看到的，只保留“法语身份/用户阶段或痛点/核心收益”中的最强两项；详细解释放副标题，不能把完整方法塞进封面标题。',
        '封面标题不能只是栏目名、资料名或内容摘要。必须让用户立刻看见“这和我有什么关系”：至少出现当前阶段、正在担心的后果、马上能做的动作或看完收益中的一项；纯“差异对比、知识体系、资料整理、任务详解”不合格。注意“自查、清单、大全”只是内容形式，不等于用户关系，封面还要写出没底、怕丢分、考前、报名前、不会检查等当前状态。',
        '封面标题本身必须明确出现本商品考试身份（DELF B2/法语B2，或TEF/TCF），不能把身份只放在小副标题，也不能只写“150到250、3步扩写”这类脱离领域的标题。',
        ...(examContext ? [`本篇考试身份边界：${examContext.rule} 目标读者：${examContext.audience}。标题中不得把两个考试拼成一个“TEF/TCF写作”考试；共同内容用“无论考TEF Canada还是TCF Canada”表达，单考内容只写对应考试。`] : []),
        '封面标题必须兑现实际封面内容：高密度资料模板可用资料、大全、时效、稀缺；经验痛点模板用情绪、结果、反常识；文档解析说清解析对象。',
        productShowcase ? '这是知识库介绍模式：4组候选必须覆盖“平铺介绍、具体痛点、反常识、结果/强获得感”四个方向，标题要讲商品本身，但不能把“知识库宣传”写成内部栏目名。封面标题和文字标题都要让备考者看出这套资料与自己有关；至少有一部分候选出现“法语/DELF B2/写作”等身份和用户动作或获得感。' : '',
        '标题可以有冲突、恐惧、反常识、结果和适度夸张，但不得冒充不存在的官方、服务、经历或具体数据来源。',
        '标题里的数量、天数、分钟、分数和库存数字只能使用allowed_numbers_from_actual_content；B2、TEF、TCF、CLB7等考试名称中的数字除外。禁止为了钩子新编20词、10分钟、35分钟、1个月等数字。',
        '标题必须概括本篇主轴，而不是抓住某个次要条目另起题目。若写“3步、5点、36项”等数量结构，actual_content的主题、承诺或一级封面分组中必须真的存在同名数量结构，不能从评分档位、例句或角落数字拼出新钩子。',
        '标题和副标题只能写actual_content实际展开的维度；正文没有比较评分、费用、出分速度或考试难度，就不能在标题里新增这些维度。数字直接修饰“差异、原因、问题、方法、错误”等中文名词时必须带自然量词，禁止“4差异、3原因、5错误”这种省略。',
        '可以强化冲突，但不能偷换或升级用户问题：例如“练完没把握”不能改成“练了没用”，“不知道短板”不能改成“总跑题”。标题所写的具体症状必须与topic中的audienceState、scene、painOrDesire同义。',
        '选考类标题不得把单一能力直接等同于考试选择。禁止写“写作强选TEF”“口语弱选TCF”“某类人直接选某考试”等武断结论；标题应引导用户对比题型、任务形式和目标项目。',
        '必须说人话。禁用“资料太散、卡住、拖后腿、正在白背、格式正在偷分、写作任务、这一步、多数人”等空泛机器表达。',
        '每个标题必须是一句可以直接念出口的完整中文短句，词序要符合日常口语。禁止把“对象、数量、类别、动作”压成名词串，禁止为了缩短字数写成“语法错9类、清单查短板、5维度自查定位”这类电报式表达。',
        '具体痛点要用学习者会说的话表达，避免把编辑标签或内容分类直接当成标题。不要反复使用同一组情绪词或同义改写。',
        '不得整批都写成问句、冒号句或“别再X”句式；候选的机制、句式和核心对象必须有差异。',
        // 阶段 D：门控开时 legacy「四种机制各1组」两行替换为本次方向子集说明（title-consensus 模块生成）。
        ...(consensusActive
          ? titleDirectionPromptLines(directions, effectiveCount)
          : [
            '无论普通模式还是知识库介绍模式，最终只返回4组成对候选，四种机制各1组：search_utility（搜索/资料获得感）、loss_tension（风险/损失）、cognitive_conflict（反常识/认知冲突）、result_gain（结果/行动收益）。不要返回第5组或更多，也不要把四组写成同一个句式的改写。',
            'mechanism字段必须填写这4个英文值之一。四类候选的句式和核心点击理由必须真正不同，不能只换同义词。',
          ]),
        '标题末尾不能是冒号、逗号或顿号。若写“从X词到Y词”，实际内页必须包含完整达到Y词的法语示例；只有片段时不得使用该承诺。',
        'formula_skeletons只用于学习结构和心理触发，不得机械填槽或照抄固定措辞。',
        ...(consensusActive
          ? [
            `生成${effectiveCount}组成对候选，每方向恰好1组；缺少的方向要新写候选，不得用同一方向改写凑数。`,
            '标题只能承诺user输入里title_promise_range与actual_content实际展开的内容；超出范围的效果承诺（如保过、押题、快速提分）不得出现，返修时也要删掉。',
            'approved_title_style_examples 是用户认可过的真实标题，只学习它们的真人口吻、情绪和点击角度，不照抄句子，也不要机械套用“别再、X步、这才是”等固定开头。',
            '首轮优先从目标用户正在经历的问题出发：让人产生“这不就是我”“原来我一直做错了”或“这个我现在就用得上”的感觉；优先写用户的问题和场景，不要把资料目录当成标题。',
            '允许使用自然的第一人称、第二人称、疑问、反差或克制情绪，但必须与实际内容相符；不要为了像爆款凭空加入夸张数字、后悔、震惊或商品卖点。',
            // 截断残尾 prompt 轮（用户 2026-08-22 指示）：工程截断/闸门管不到模型
            // 未超限时的自剪行为（实测 job_002「…评分维」恰 20 字自剪），必须从生成
            // 约束侧根治：只许完整收尾，接近上限换更短说法。
            '每个标题必须以完整词、完整短语或完整句子收尾：不得在「评分维度」「写作思路」这类多字词中间断开，出现「评分维」「写作思」这类半截词直接不合格。',
            '若内容接近20字上限装不下，主动改写成更短的完整表达（12字也合格），不要为了凑满字数把句子硬塞到20字。',
          ]
          : [productShowcase ? '生成4组成对候选，每类恰好1组：search_utility平铺介绍知识库具体有什么；loss_tension写备考者会直接说出的具体困扰；cognitive_conflict写反常识或改变原有做法；result_gain把资料价值说得很强、很值得买或马上能用。四类不能只换几个词。允许适度“吹爆”资料，但必须基于本篇真实内容，不能写空泛口号。' : '生成4组成对候选，每类恰好1组。']),
        'mechanism写本候选的实际机制；userRelation明确写它与用户的关系信号；noveltyFingerprint写“机制|对象|角度”。',
        '必须返回固定四槽位JSON对象：{primary:{...},secondary:{...},emotional:{...},alternate:{...}}，不得返回candidates数组。',
        `固定slotSpecs如下：${JSON.stringify(slotSpecs)}。每个槽位必须原样保留对应requestedClickMode，不得自行改槽位策略；slotId也必须与对象键一致。`,
        'clickMode只能是COLLECTION_ASSET、EMOTIONAL_CURIOSITY、PAIN_QUESTION、INSIGHT_CONTRARIAN、COMPARISON_GAP、URGENT_EXAM、SELF_TEST_AVOIDANCE、VOICE_EXPERIENCE之一；未知就返回UNKNOWN，不要猜成COMPARISON_GAP。mode不够纯只记为提示，不能删掉该槽位。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(promptInput) },
  ], { maxTokens: firstMaxTokens, temperature: 0.86, retries: 1 });
  const normalizedCandidates = rawTitleCandidates(result.data, slotSpecs)
    .map(item => ({ slotId: item.slotId, pair: normalizePair(item.raw) }))
    .filter((item): item is { slotId: TitleSlotId; pair: TitlePair } => Boolean(item.pair))
    .map(item => ({ slotId: item.slotId, pair: normalizePairForInput({ ...item.pair, slotId: item.slotId, textTitle: compressTextTitle(item.pair.textTitle) }, input, { coverTruncate: !consensusActive, consensusActive }) }));
  let titleUsage = result.usage;
  const consensusWarnings: string[] = [];
  let candidates = normalizedCandidates
    .filter(item => passesHardGates(item.pair, input, recent.selectedTitles, recent.coverTitles, true, consensusActive, consensusActive))
    .map(item => item.pair);
  if (candidates.length < effectiveCount && !consensusActive) {
    const repairable = normalizedCandidates.slice(0, 8).map(item => item.pair);
    if (repairable.length) {
      const occupiedSlots = new Set(repairable.map(pair => pair.slotId).filter((slot): slot is TitleSlotId => Boolean(slot)));
      const missingSlots = (['primary', 'secondary', 'emotional', 'alternate'] as const)
        .filter(slot => !occupiedSlots.has(slot));
      const repaired = await repairTitleCandidates(repairable, {
        productIdentity: profile.noteIdentity,
        topic: input.topic.topic,
        promise: input.topic.promise,
        audience: input.topic.audienceState,
        painOrDesire: input.topic.painOrDesire,
        coverRange,
        supportedNumbers,
        targetCount: effectiveCount,
        ...(consensusActive ? { required_directions: directions, require_complete_phrase: true } : {}),
        missing_slots: missingSlots,
      }, input, recent.selectedTitles, recent.coverTitles, repairMaxTokens);
      titleUsage = mergeAiUsage(titleUsage, repaired.usage);
      const repairedCandidates = repaired.candidates
        .map((pair, index) => ({
          ...pair,
          slotId: pair.slotId,
          requestedClickMode: isClickMode(pair.requestedClickMode) ? pair.requestedClickMode : 'UNKNOWN',
          sourceDirection: pair.sourceDirection,
        } as TitlePair))
        .map(pair => normalizePairForInput(pair, input, { coverTruncate: !consensusActive, consensusActive }))
        .filter(pair => passesHardGates(pair, input, recent.selectedTitles, recent.coverTitles, false, consensusActive, consensusActive));
      // 按槽位合并：修复成功的槽位替换原槽位，其他已通过槽位保持不动。
      // 这里不再用跨槽位语义去重吞掉候选，否则模型返回相近但合法的两个策略时，
      // “4个固定槽位”会在最后一步又变回1～3组。
      const bySlot = new Map<NonNullable<TitlePair['slotId']>, TitlePair>();
      for (const pair of candidates) if (pair.slotId) bySlot.set(pair.slotId, pair);
      for (const pair of repairedCandidates) if (pair.slotId) bySlot.set(pair.slotId, pair);
      candidates = (['primary', 'secondary', 'emotional', 'alternate'] as const)
        .map(slot => bySlot.get(slot))
        .filter((pair): pair is TitlePair => Boolean(pair));
      if (!candidates.length) {
        candidates = repairable
          .map(pair => ({ ...pair, textTitle: fitTextTitle(pair.textTitle, consensusActive) }))
          .filter(pair => passesHardGates(pair, input, recent.selectedTitles, recent.coverTitles, false, consensusActive, consensusActive));
      }
      // 阶段 D（设计 §4.3）：门控开时封面标题超长先返修；返修后组数仍不足，
      // 才把「其余都合格、只是封面超长」的候选拿回来截断兜底，不让整篇 job 失败。
      // legacy 路径没有这一步（封面在 normalizePairForInput 已预先截断）。
      if (!consensusActive && candidates.length < effectiveCount) {
        const rescuedCover = repairable
          .map(pair => {
            const truncated = fitCoverTitle(pair.coverTitle, input, true, true);
            return { pair: { ...pair, textTitle: fitTextTitle(pair.textTitle, true), coverTitle: truncated }, didTruncate: truncated !== pair.coverTitle };
          })
          .filter(item => passesHardGates(item.pair, input, recent.selectedTitles, recent.coverTitles, false, true, true));
        const before = candidates.length;
        candidates = dedupeCandidates([...candidates, ...rescuedCover.map(item => item.pair)], categoryFn);
        if (candidates.length > before && rescuedCover.some(item => item.didTruncate)) {
          consensusWarnings.push(`封面标题超长且返修未补齐，已截断兜底${candidates.length - before}组，请人工复核封面文案`);
        }
      }
    }
  }
  const slotMap = titleSlotsFromCandidates(candidates.filter(pair => Boolean(pair.slotId)).map(pair => ({ slotId: pair.slotId!, pair })));
  const missingSlotsAfterRepair = missingTitleSlots(slotMap);
  if (missingSlotsAfterRepair.length > 0) {
    const primaryMode = primaryClickMode(input);
    const secondaryMode = secondaryClickMode(primaryMode, input);
    const completed = await generateMissingTitleSlots(
      missingSlotsAfterRepair.map(slotId => ({ slotId, requestedClickMode: requestedModeForSlot(slotId, primaryMode, secondaryMode) })),
      input,
      candidates,
      repairMaxTokens,
    );
    titleUsage = mergeAiUsage(titleUsage, completed.usage);
    for (const pair of completed.candidates) {
      const normalized = normalizePairForInput(pair, input, { coverTruncate: !consensusActive, consensusActive });
      if (passesHardGates(normalized, input, recent.selectedTitles, recent.coverTitles, true, consensusActive, consensusActive)) candidates.push(normalized);
      else consensusWarnings.push(`SLOT_COMPLETION_REJECTED:${pair.slotId || 'unknown'}`);
    }
  }
  const completedSlotMap = titleSlotsFromCandidates(candidates.filter(pair => Boolean(pair.slotId)).map(pair => ({ slotId: pair.slotId!, pair })));
  const missingSlotsFinal = missingTitleSlots(completedSlotMap);
  if (missingSlotsFinal.length > 0) {
    const incomplete = enrichTitlePackage({
      contentSnapshotHash: stableHash(input.content),
      productionBriefHash: lockedBrief.briefHash,
      candidates: TITLE_SLOT_IDS.map(slot => completedSlotMap[slot]).filter((pair): pair is TitlePair => Boolean(pair)),
      selected: candidates[0],
    }, input, result.data, directions);
    return artifact(incomplete, inputHash, titleUsage, result.requestId, [
      ...consensusWarnings,
      `TITLE_BUNDLE_INCOMPLETE:${TITLE_SLOT_IDS.length - missingSlotsFinal.length}/${TITLE_SLOT_IDS.length}`,
      'SELECTOR_BLOCKED_BECAUSE_INCOMPLETE',
    ]);
  }
  // 完整四槽位是进入 Selector 的必要条件；此处不再让跨槽位去重或限额逻辑删掉候选。
  const diversified = candidates;
  const shortlisted = diversified.slice(0, TITLE_CANDIDATE_COUNT);
  // 首轮候选只作为终审调用失败时的可发布兜底。共识路径的最终选中标题由独立
  // LLM 终审节点直接创作；它不读取这些旧标题，也不接受后续程序截断或重新排序。
  const { list: unique, warnings: coverFallbackWarnings } = applyCoverTruncateFallback(shortlisted, input, consensusActive);
  // P0：终审不再重新生成/替换候选。标题槽位已经由首轮生成和局部返修完成，
  // 继续调用一个“终审创作器”会丢掉 slotId/clickMode，并把4组压缩成1-3组。
  const finalEdit = { candidates: [] as TitlePair[], warnings: [] as string[], usage: undefined };
  if (!unique.length && !consensusActive) {
    // 独立终审不依赖上游候选。即使首轮生成/返修全灭，只要终审自身通过客观验收，
    // 仍直接发布它的唯一结果；旧 salvage 只负责终审也失败时的兜底。
    if (finalEdit.candidates.length) {
      const data: TitlePackage = {
        contentSnapshotHash: stableHash(input.content),
        productionBriefHash: lockedBrief.briefHash,
        candidates: finalEdit.candidates,
        selected: finalEdit.candidates[0]!,
      };
      return artifact(data, inputHash, titleUsage, result.requestId, [
        '上游标题候选未通过硬门槛，已由独立标题终审直接给出可选终稿',
        ...finalEdit.warnings,
        ...coverFallbackWarnings,
        ...consensusWarnings,
        ...strongPromiseRelaxWarnings(finalEdit.candidates, consensusActive, input),
        ...unsupportedTitleNumberWarnings(finalEdit.candidates, input),
      ]);
    }
    // 标题是可返修字段，不应因为历史标题重复或某个窄正则把整篇内容判死。
    // 先在不读取历史占用的前提下保留一个当前内容最匹配的候选；后续仍会在
    // warnings 中记录降级，便于人工换标题，而不是让整篇 job 失败。
    const salvagePool = dedupeCandidates(
      normalizedCandidates
        .map(item => normalizePairForInput(item.pair, input, { coverTruncate: !consensusActive, consensusActive }))
        .filter(pair => passesHardGates(pair, input, new Set(), new Set(), true, consensusActive, consensusActive)),
      categoryFn,
    );
    if (salvagePool.length) {
      const salvageCandidates = applyCoverTruncateFallback(
        limitTitleCandidates(diversifyCandidates(salvagePool, input, [], categoryFn, consensusActive ? directions : undefined), categoryFn, effectiveCount).slice(0, effectiveCount),
        input,
        consensusActive,
      );
      const salvageFinal = salvageCandidates.list.length ? salvageCandidates.list : salvagePool.slice(0, effectiveCount);
      const data: TitlePackage = {
        contentSnapshotHash: stableHash(input.content),
        productionBriefHash: lockedBrief.briefHash,
        candidates: salvageFinal,
        selected: selectTitleCandidate(salvageFinal, input, new Map(), []),
      };
      const enriched = enrichTitlePackage(data, input, result.data, directions);
      const categoryCount = new Set(data.candidates.map(categoryFn)).size;
      return artifact(enriched, inputHash, titleUsage, result.requestId, [
        '标题候选与历史或长度规则冲突，已保留当前内容最匹配的候选，请人工复核标题新鲜度',
        ...(enriched.titleBundles?.length !== TITLE_CANDIDATE_COUNT ? [`TITLE_BUNDLE_INCOMPLETE:当前仅${enriched.titleBundles?.length || 0}/4组`] : []),
        ...(categoryCount < 3 ? [`本次标题候选只覆盖${categoryCount}种点击机制`] : []),
        ...finalEdit.warnings,
        ...salvageCandidates.warnings,
        ...consensusWarnings,
        ...strongPromiseRelaxWarnings(salvageFinal, consensusActive, input),
        ...unsupportedTitleNumberWarnings(salvageFinal, input),
        ...shortTextTitleWarnings(salvageFinal, consensusActive),
      ]);
    }
    console.error('[v2-title-fallback]', JSON.stringify({
      product_id: input.topic.productId,
      template_id: input.topic.templateId,
      raw_count: Array.isArray(result.data.candidates) ? result.data.candidates.length : 0,
      response_preview: JSON.stringify(result.data).slice(0, 5000),
    }));
    const identity = profile.shortIdentity;
    const topicCore = input.topic.topic
      .replace(/^(?:DELF\s*B2|法语\s*B2|TEF(?:\s*Canada)?|TCF(?:\s*Canada)?)(?:写作|口语|听力)?\s*[：:，,]?\s*/iu, '')
      .trim();
    const textTitle = fitTextTitle(`${identity}：${topicCore || input.topic.painOrDesire}`, true);
    const coverMax = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange?.[1] || 20;
    const coverTitle = stripDanglingTitleTail(trimTitleAtNaturalBoundary(textTitle, coverMax, { keepInnerSpaces: true })) || textTitle;
    const fallback: TitlePair = {
      textTitle,
      coverTitle,
      coverSubtitle: fitCompleteSubtitle(input.topic.promise || input.topic.contentAngle || input.topic.scene),
      mechanism: 'safe_topic_fallback',
      userRelation: input.topic.audienceState || input.topic.scene,
      seoKeyword: input.topic.seo.primary,
      noveltyFingerprint: `safe-fallback|${input.topic.noveltyFingerprint}`,
    };
    const fallbackData = enrichTitlePackage({
      contentSnapshotHash: stableHash(input.content),
      productionBriefHash: lockedBrief.briefHash,
      candidates: [fallback],
      selected: fallback,
    }, input, result.data, directions);
    return artifact(fallbackData, inputHash, titleUsage, result.requestId, [
      '标题候选均未通过质量规则，已使用选题任务单生成保守标题；任务继续生产，请人工复核标题自然度',
      'TITLE_BUNDLE_INCOMPLETE:当前仅1/4组，未复制候选凑数',
      ...finalEdit.warnings,
      ...consensusWarnings,
    ]);
  }
  const baselineSelected = selectTitleCandidate(unique, input, recent.selectedTitleTemplates, recent.records);
  // 终审偶尔只返回1组可用标题。保留终审原始顺序，并用已经通过同一套硬闸门的
  // 上游候选补足展示位；不再让前台因为一次终审漏项只剩一个选择。
  const finalList = finalEdit.candidates.length
    ? dedupeCandidates([...finalEdit.candidates, ...unique], categoryFn).slice(0, effectiveCount)
    : unique;
  // 终审候选保持 LLM 原始顺序，首条只作为现有 schema/UI 的默认选中值；程序
  // 不做网感评分或重新排序。终审失败时才完整回退上游候选。
  const selected = finalEdit.candidates[0] || baselineSelected;
  const data: TitlePackage = enrichTitlePackage({ contentSnapshotHash: stableHash(input.content), productionBriefHash: lockedBrief.briefHash, candidates: finalList, selected }, input, result.data, directions);
  const categoryCount = new Set(finalList.map(categoryFn)).size;
  const warnings = [
    ...(finalList.length !== TITLE_CANDIDATE_COUNT ? [`TITLE_BUNDLE_INCOMPLETE:当前${finalList.length}/${TITLE_CANDIDATE_COUNT}组，未复制候选凑数`] : []),
    ...(finalEdit.candidates.length > 0 && finalEdit.candidates.length < effectiveCount && finalList.length > finalEdit.candidates.length
      ? [`独立标题终审只通过${finalEdit.candidates.length}组，已用通过硬门槛的上游候选补到${finalList.length}组`]
      : []),
    ...(!finalEdit.candidates.length && finalList.length < effectiveCount ? [`本次只有${finalList.length}组标题通过硬门槛，未达到${effectiveCount}组`] : []),
    ...(!finalEdit.candidates.length && categoryCount < 3 ? [`本次标题候选只覆盖${categoryCount}种点击机制`] : []),
    ...finalEdit.warnings,
    ...coverFallbackWarnings,
    ...consensusWarnings,
    ...strongPromiseRelaxWarnings(finalList, consensusActive, input),
    ...unsupportedTitleNumberWarnings(finalList, input),
    ...shortTextTitleWarnings(finalList, consensusActive),
  ];
  return artifact(data, inputHash, titleUsage, result.requestId, warnings);
}

/**
 * 阶段 D（设计 §4.3）：门控开时文字标题 <12 字只警告不淘汰。对最终存活的
 * 短标题候选记一条人工复核警告（legacy 路径 <12 仍在硬门槛判死，不产生该警告）。
 */
function shortTextTitleWarnings(candidates: TitlePair[], consensusActive: boolean): string[] {
  if (!consensusActive) return [];
  return candidates
    .filter(pair => countVisibleUnits(pair.textTitle) < 12)
    .map(pair => `文字标题仅${countVisibleUnits(pair.textTitle)}字，低于推荐下限12字，请人工复核：「${pair.textTitle}」`);
}

/**
 * 阶段 D（设计 §4.3）：门控开时封面标题超长先带 failures 进返修（fitCoverTitle
 * 不再预先截断）；返修后仍超长才在这里截断兜底并记警告。legacy 路径恒为直通。
 * 人话改写阶段后追加：截断值必须再过一遍硬闸门（含两字残尾检查），截出「…让心」
 * 这类不完整收尾时保留截断前原值并转人工复核，绝不让残值上线。
 */
function applyCoverTruncateFallback(candidates: TitlePair[], input: TitleStageInput, consensusActive: boolean): { list: TitlePair[]; warnings: string[] } {
  if (!consensusActive) return { list: candidates, warnings: [] };
  const range = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  const warnings = candidates
    .filter(pair => countVisibleUnits(pair.coverTitle) > range[1])
    .map(pair => `COVER_EDIT_RECOMMENDED:封面标题${countVisibleUnits(pair.coverTitle)}字，超过模板建议${range[1]}字，保留完整原文交给封面编辑：「${pair.coverTitle}」`);
  // 封面超模板容量不是平台硬失败，且程序截断可能制造残句。保留原值，
  // 由后续封面编辑/渲染层做字段级处理；这里绝不再切半标题。
  void input;
  return { list: candidates, warnings };
}

function isTitleProductShowcase(topic: TopicOption, noteMode?: TitleStageInput['noteMode']): boolean {
  // 三个商品同一规则：conversion 是分发目标，不等于内容已经是商品介绍。
  return topic.topicLane === 'product_value' && noteMode !== 'product_note';
}

function standardKnowledgeTopicBoundary(input: TitleStageInput) {
  const topic = input.topic as TopicOption & { finalPublicTopic?: string; motherTopic?: string };
  const task = topic.batchEditorialTask as unknown as { motherTopic?: string; finalPublicTopic?: string } | undefined;
  return {
    finalPublicTopic: topic.finalPublicTopic || task?.finalPublicTopic || topic.topic,
    motherTopic: topic.motherTopic || task?.motherTopic || topic.topic,
  };
}

function finalStandardKnowledgeContentSnapshot(input: TitleStageInput) {
  return {
    innerPages: teachingPages(input.content.innerPages).map(page => ({
      page_no: page.page_no,
      page_type: page.page_type,
      semanticLayoutType: page.semanticLayoutType,
      page_title: page.page_title,
      lead: page.lead,
      bullets: [...page.bullets],
    })),
  };
}

/** Only text verified as visible in the existing renderer, not model-generated copy. */
function fixedCoverIdentity(input: TitleStageInput) {
  if (input.capability.renderer !== 'document_analysis') return '';
  return input.topic.productId === 'delf_b2_writing'
    ? 'DELF B2 写作素材页'
    : `${getProductPromptProfile(input.topic.productId).noteIdentity}素材页`;
}

/** Reuse the same count matcher as validation; never send the source bullets. */
export function standardKnowledgeSupportedAssets(input: TitleStageInput) {
  const pages = teachingPages(input.content.innerPages);
  const assets: Array<{label:string;count:number;sourcePages:number[];scope:string}> = [];
  const maximum = Math.min(100, pages.reduce((sum,p)=>sum+p.bullets.length,0));
  for (const suffix of ['个主题','组表达对照','类场景','个检查项','步方法','条表达']) {
    for (let count=1;count<=maximum;count++) {
      const label = `${count}${suffix}`;
      if (suffix === '步方法') {
        // “第一步/第二步”是步骤序号，不是“1步/2步方法”的总量声明。
        // 只把 locked Inner 明确写出的“三步方法/三步定位/用三步走一遍”等
        // 整体数量交给 Title，避免真实的“三步”标题被数量 Gate 误杀。
        if (count < 2) continue;
        const sourcePages = pages.filter(page => {
          const text = normalizeCnNumeralsBeforeUnit([page.page_title, page.lead, ...page.bullets].join('\n'));
          const aggregate = new RegExp(`(^|[^第\\d])${count}步(?=.{0,8}(?:方法|流程|定位|审题|拆解|过(?:一|1)遍|走(?:一|1)遍|完成|汇总|清单))`, 'u');
          return aggregate.test(text);
        }).map(page => page.page_no);
        if (sourcePages.length) assets.push({label,count,sourcePages,scope:`覆盖第${sourcePages.join('、')}页`});
        continue;
      }
      const pair: TitlePair = {textTitle:label,coverTitle:'',coverSubtitle:'',mechanism:'',userRelation:'',noveltyFingerprint:''};
      if (!standardKnowledgeAssetCountsSupported(pair,input)) continue;
      const sourcePages = pages.filter(page=>standardKnowledgeAssetCountsSupported(pair,{...input,content:{...input.content,innerPages:[page]}})).map(p=>p.page_no);
      assets.push({label,count,sourcePages:sourcePages.length?sourcePages:pages.map(p=>p.page_no),
        scope:sourcePages.length?'明确局部页面结构，不代表整篇只有此项':'整篇结构合计'});
    }
  }
  return assets;
}

/** Short verbatim fragments, balanced across pages; no generated summaries or sentences. */
export function standardKnowledgeConcreteAnchors(input: TitleStageInput) {
  const pages = teachingPages(input.content.innerPages);
  const limit = Math.min(3, Math.floor(24 / Math.max(1,pages.length)));
  const forms: Record<string,string> = {knowledge_list:'条目',comparison:'对照',before_after:'改写对照',checklist:'检查清单',steps:'步骤'};
  return pages.map(page => {
    const terms: string[] = [];
    const add = (value:string) => {
      const term = value.trim().replace(/^[\p{S}\p{P}\s\d]+/u,'').trim();
      if (term && countVisibleUnits(term)<=24 && !/[。！？!?；;\n_]/u.test(term) && !terms.includes(term)) terms.push(term);
    };
    const titleParts = page.page_title.split(/[:：]/u);
    // Numbered generic headings do not identify the actual object.
    const object = /^(?:替换\d+|隐形坑[一二三四五六七八九十]+)$/u.test(titleParts[0]) ? titleParts.slice(1).join('：') : titleParts[0];
    const quotedObject = object.match(/[“‘「]([^”’」\n]{2,24})[”’」]/u)?.[1];
    if (quotedObject) add(quotedObject);
    else if (countVisibleUnits(object)<=16) add(object);
    const localText = [page.page_title,page.lead,...page.bullets].join('\n');
    for (const match of localText.matchAll(/(?:适用场景|情境[A-Z])[:：]\s*([^。；\n（(•]+)/gu)) add(match[1]);
    for (const match of localText.matchAll(/(?:比如|例如|[（(：:]\s*如[:：]?)([^。；，、（）()\n]{2,16})(?=[。；，、（）()\n]|$)/gu)) add(match[1]);
    // Named contrast terms (Bon/Mauvais, Parce que/Donc), not arbitrary sentence starts.
    for (const match of [page.page_title,page.lead].join('\n').matchAll(/\b[A-Za-zÀ-ÿ]+(?: +[A-Za-zÀ-ÿ]+)?\/[A-Za-zÀ-ÿ]+\b/gu)) add(match[0]);
    for (const match of localText.matchAll(/[“‘「]([^”’」\n]{2,24})[”’」]/gu)) add(match[1]);
    // Explicit short labels only, never the prose following the colon.
    for (const bullet of page.bullets) {
      const label = bullet.match(/^(?:[\p{S}\s]+|\d+[.、]\s*)?([^:：（(。\n]{2,12})[:：（(]/u)?.[1];
      if (label && !/^(?:升级|原句|辨析|建议|法语表达|中文释义|错误思维|考官视角|核心原则|官方|第.{1,3}步|题目|场景对比)/u.test(label)) add(label);
    }
    // Only complete short Latin runs; no cutting a full French sentence into a fragment.
    for (const match of localText.matchAll(/[（(‘']([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’ -]{1,23})[）)’']/gu)) {
      if (match[1].split(/ +/u).length<=3 && /[a-zà-ÿ]/u.test(match[1])) add(match[1]);
    }
    return {page_no:page.page_no,contentForm:forms[page.semanticLayoutType || page.page_type] || page.page_type,terms:terms.slice(0,limit)};
  });
}

export function buildStandardKnowledgeTitlePromptForTest(input: TitleStageInput) {
  const pages = finalStandardKnowledgeContentSnapshot(input).innerPages;
  const styleReferences = getDelfB2ShortStyleReferences().map(({id,title})=>({id,title}));
  const titleCoreInput = {
    wholeNoteBrief: {pageCount:pages.length,pages:pages.map(page=>({page_no:page.page_no,pageTitle:page.page_title,lead:page.lead,structure:page.semanticLayoutType || page.page_type}))},
    concreteAnchors: standardKnowledgeConcreteAnchors(input),
    supportedAssets: standardKnowledgeSupportedAssets(input),
    shortApprovedStyleReferences: styleReferences,
    negativeReferences: [
      ['DELF B2写作总写不完？先救这步', '先救这步不像自然人话'],
      ['警告！B2写作时态这3个坑让你白练', '白练在考试语境生硬'],
      ['DELF B2任务别再混着写', '任务混着写指代不清，没有自然力度'],
      ['DELF B2写作结尾表达大全，按场景挑', '按场景挑机械'],
      ['DELF B2写作时间紧？先抓这5个评分维', '评分维残缺，不像完整人话'],
      ['语法错9类', '电报式压缩'], ['清单查短板', '电报式压缩'],
      ['我把资料整理成知识库', '像工作汇报，不像分享'],
    ].map(([title,reason])=>({title,reason})),
  };
  const systemPrompt = [
    '你只写小红书DELF B2文字标题。先看wholeNoteBrief理解整篇，再看concreteAnchors获得具体对象和说法；切口可以具体，但不能让局部页冒充整篇。',
    '一次恰好生成8个候选，每个只有textTitle、clickReason、referenceApprovedId。clickReason用一句自然人话回答这个人为什么会想点，不做分类或理论分析。',
    'textTitle目标10～16 visible units，20为绝对上限。汉字、字母、数字、标点、emoji各按可见单位计，空白不计。所有候选从一开始就按短标题思考，不先写长句再压缩。优先自然使用B2或B2写作，不机械给每条加DELF B2写作。',
    '31条shortApprovedStyleReferences仅供学习自然表达，不是事实。每条可用referenceApprovedId记录一条主要参考，不复制句式、不预筛Job案例组。',
    '不得虚构高频、必考、考官偏好、提分效果或真实数据；具体数量必须由supportedAssets支持，不能继承参考或Brief中的营销断言。',
    '表达要有差异，不要只换攻略/资料/素材库/指南/清单/汇总/手册/速查前缀给同一文件命名。自然句中可使用这些词，它们不是禁词。最终目录命名型最多2条，别/别再/不要/拒绝/告别开头家族最多1条。',
    '只返回JSON：{"candidates":[{"textTitle":"短标题","clickReason":"自然点击理由","referenceApprovedId":"A15"}]}。数组恰好8个对象，不是示例中的1个；不输出其他字段或referenceWhy。',
  ].join('\n');
  return {systemPrompt,titleCoreInput,styleReferences};
}

function normalizeStandardKnowledgePair(raw: Partial<TitlePair> & Record<string, unknown>, slotId: TitleSlotId): TitlePair | null {
  const textTitle = clean(raw.textTitle) || clean(raw.text_title) || clean(raw.title);
  const coverTitle = clean(raw.coverTitle) || clean(raw.cover_title);
  if (!textTitle) return null;
  return {
    slotId,
    textTitle,
    coverTitle,
    referenceApprovedId: /^A(?:0[1-9]|[12]\d|3[01])$/.test(clean(raw.referenceApprovedId)) ? clean(raw.referenceApprovedId) : undefined,
    referenceApprovedIds: /^A(?:0[1-9]|[12]\d|3[01])$/.test(clean(raw.referenceApprovedId)) ? [clean(raw.referenceApprovedId)] : cleanStringArray(raw.referenceApprovedIds)?.filter(id => /^A(?:0[1-9]|[12]\d|3[01])$/.test(id)),
    coverSubtitle: clean(raw.coverSubtitle) || clean(raw.cover_subtitle) || clean(raw.subtitle) || undefined,
    mechanism: clean(raw.mechanism) || 'human_editorial_hook',
    userRelation: clean(raw.userRelation) || clean(raw.user_relation),
    clickReason: clean(raw.clickReason) || clean(raw.click_reason),
    bundleIntent: clean(raw.bundleIntent) || clean(raw.bundle_intent),
    bundleAnchor: clean(raw.bundleAnchor) || clean(raw.bundle_anchor),
    bundleIntentKeywords: cleanStringArray(raw.bundleIntentKeywords ?? raw.bundle_intent_keywords),
    noveltyFingerprint: clean(raw.noveltyFingerprint) || clean(raw.novelty_fingerprint) || stableHash(`${textTitle}|${coverTitle}`),
  };
}

function cleanStringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
  return items.length ? items : undefined;
}

function standardKnowledgeBundleIntentFailures(pair: TitlePair) {
  return pair.bundleIntent?.trim() ? [] : ['BUNDLE_INTENT_MISSING:缺少Creator内部语义计划'];
}

export function assessStandardKnowledgeBundleIntentForTest(pair: TitlePair) {
  return standardKnowledgeBundleIntentFailures(pair);
}

function standardKnowledgeRawCandidates(raw: RawTitleResponse) {
  if (Array.isArray(raw.candidates)) {
    return raw.candidates.flatMap((value, index) => {
      const slotId = TITLE_SLOT_IDS[index % TITLE_SLOT_IDS.length];
      const pair = normalizeStandardKnowledgePair(value, slotId);
      return pair ? [pair] : [];
    });
  }
  return TITLE_SLOT_IDS.flatMap(slotId => {
    const value = raw[slotId];
    if (!value) return [];
    const pair = normalizeStandardKnowledgePair((value.bundle || value) as Partial<TitlePair> & Record<string, unknown>, slotId);
    return pair ? [pair] : [];
  });
}

function damagedTitleLanguage(value: string) {
  return /DELFB2|Jepense|je\s+pense\s+that|je\s+pense\s+q(?:\s|$)|(?:^|[^A-Za-zÀ-ÿ])Ca(?:$|[^A-Za-zÀ-ÿ])|从\s*on\s+à\s+ça\s*到/iu.test(value);
}

function coverTitleLooksLikeSectionHeading(value: string) {
  const title = value.trim();
  if (/^(?:环境[\/／、]科技[\/／、]教育核心冲突|高频话题底层逻辑(?:拆解)?|核心内容概览|主题模块拆解|表达升级专区|语法知识总结|(?:DELF\s*)?B2写作[:：]?社会语言得体性)$/iu.test(title)) return true;
  return /核心冲突|底层逻辑|内容概览|知识总结|模块拆解|价值主张/u.test(title)
    && !/[？?]|看到题|没观点|脑子空白|不用现想|不会写|怎么写|考前/u.test(title);
}

function standardKnowledgeFieldFailures(pair: TitlePair, input: TitleStageInput) {
  const spec = getCoverTemplateSpec(input.capability.renderer);
  const failures: Array<{ field: 'textTitle' | 'coverTitle' | 'coverSubtitle'; reason: string; maxVisibleUnits: number }> = [];
  const fields = [
    { field: 'textTitle' as const, value: pair.textTitle, max: 20 },
    { field: 'coverTitle' as const, value: pair.coverTitle, max: spec?.titleMaxVisibleChars || spec?.titleLengthRange?.[1] || 18 },
    { field: 'coverSubtitle' as const, value: pair.coverSubtitle || '', max: spec?.subtitleMaxVisibleChars || 24 },
  ];
  for (const item of fields) {
    if (!item.value) failures.push({ field: item.field, reason: '字段为空', maxVisibleUnits: item.max });
    if (item.value && countVisibleUnits(item.value) > item.max) failures.push({ field: item.field, reason: `超过${item.max}个可见单位`, maxVisibleUnits: item.max });

  }
  return failures;
}

function technicalTitlePatchPreservesMeaning(before: string | undefined, after: string) {
  if (!before?.trim()) return true;
  const protectedContextGroups: Array<[RegExp, RegExp]> = [
    [/正式信|投诉信|建议信|申请信/u, /正式信|投诉信|建议信|申请信|正式书面|公文/u],
    [/语境|文体|场景/u, /语境|文体|场景|正式信|投诉信|建议信|申请信/u],
    [/并非|不一定|不是绝对|不能乱用|不要乱用/u, /并非|不一定|不是绝对|不能乱用|不要乱用|别乱用/u],
  ];
  if (protectedContextGroups.some(([source, target]) => source.test(before) && !target.test(after))) return false;
  const normalize = (value: string) => value
    .replace(/DELF\s*B2|法语\s*B2|B2\s*(?:写作|作文)?/giu, '')
    .replace(/[\s，。！？!?：:；;、“”‘’【】（）()《》]/gu, '');
  const oldText = normalize(before);
  const newText = normalize(after);
  if (!oldText || !newText) return true;
  if (oldText.includes(newText) || newText.includes(oldText)) return true;
  const oldTokens = semanticBigrams(oldText);
  const newTokens = semanticBigrams(newText);
  let overlap = 0;
  for (const token of oldTokens) if (newTokens.has(token)) overlap += 1;
  return overlap >= Math.max(1, Math.floor(Math.min(oldTokens.size, newTokens.size) * 0.45));
}

async function repairStandardKnowledgeTitleFields(
  candidates: TitlePair[],
  input: TitleStageInput,
  failures: Array<{ slotId: TitleSlotId; field: 'textTitle' | 'coverTitle' | 'coverSubtitle'; reason: string; maxVisibleUnits: number }>,
) {
  if (!failures.length) return { candidates, usage: undefined, repaired: [] as string[], rejectedSemanticPatches: [] as string[], rawPatches: [] as unknown[] };
  const result = await callOpenAICompatibleJsonWithUsage<{ patches?: Array<{ slotId?: string; field?: string; value?: string }> }>([
    {
      role: 'system',
      content: [
        '你只做标题字段级窄修复。不得重写整组标题，不得修改未列出的字段。',
        '这是技术修复，不是第二次语义创作。bundleIntent是冻结语义边界；保持原Hook、真人语气、点击理由和事实不变，只处理字段为空、物理长度、残句、法语截断、考试身份缺失、课程章节式表述或最终内容不支持的具体数量。不得新增概念、教研术语或新卖点。',
        '若指定字段是coverTitle且失败原因是“缺少考试身份”，只把B2写作自然融入现有H1，不使用冗长公文前缀，不改Hook和其他字段。',
        '若字段过长，用更短但语义相同的完整短句表达；不得把“告别学生气”改成“去个人化”之类新的抽象概念。',
        '若唯一问题是具体数量没有最终内容依据，只删除数量或改成不带数量的说法。例如“48条高频表达对照表”改为“高频表达对照表”；不得删除原本的内容对象，也不得改动同组其他字段。',
        'requestedFieldRepairs会给出currentVisibleUnits、maxVisibleUnits和更保守的targetVisibleUnits。若超长，返回值必须真正短于等于targetVisibleUnits；原样回传仍超长的字段视为修复失败。拉丁字母逐个计数，不要把一个法语单词误算成一个字。',
        '若字段为空，只能从同组另两个字段与finalPublicTopic已经存在的信息中补齐，不得发明新内容。',
        '所有法语片段必须完整保留单词与空格。不得字符截断。',
        '返回JSON：{patches:[{slotId,field,value}]}，每个请求字段恰好返回一个patch。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({
      finalPublicTopic: standardKnowledgeTopicBoundary(input).finalPublicTopic,
      candidates: candidates.map(pair => ({
        slotId: pair.slotId,
        bundleIntent: pair.bundleIntent,
        textTitle: pair.textTitle,
        coverTitle: pair.coverTitle,
        coverSubtitle: pair.coverSubtitle,
        clickReason: pair.clickReason,
      })),
      requestedFieldRepairs: failures.map(failure => {
        const pair = candidates.find(candidate => candidate.slotId === failure.slotId);
        const currentValue = pair?.[failure.field] || '';
        return {
          ...failure,
          currentValue,
          currentVisibleUnits: countVisibleUnits(currentValue),
          targetVisibleUnits: Math.max(8, failure.maxVisibleUnits - 4),
        };
      }),
    }) },
  ], { maxTokens: 900, temperature: 0.25, retries: 1 });
  const requested = new Map(failures.map(item => [`${item.slotId}:${item.field}`, item]));
  const patches = Array.isArray(result.data.patches) ? result.data.patches : [];
  const repaired: string[] = [];
  const rejectedSemanticPatches: string[] = [];
  const patched = candidates.map(pair => {
    const next = { ...pair };
    for (const patch of patches) {
      const key = `${patch.slotId}:${patch.field}`;
      if (patch.slotId !== pair.slotId || !requested.has(key) || typeof patch.value !== 'string') continue;
      if (patch.field === 'textTitle' || patch.field === 'coverTitle' || patch.field === 'coverSubtitle') {
        const value = patch.value.trim();
        if (!value || !technicalTitlePatchPreservesMeaning(pair[patch.field], value)) {
          rejectedSemanticPatches.push(key);
          continue;
        }
        next[patch.field] = value;
        repaired.push(key);
      }
    }
    return next;
  });
  return { candidates: patched, usage: result.usage, repaired, rejectedSemanticPatches, rawPatches: patches };
}

function finalStandardKnowledgeText(input: TitleStageInput) {
  const snapshot = finalStandardKnowledgeContentSnapshot(input);
  return JSON.stringify(snapshot);
}

function contradictsFinalStandardKnowledgeContent(pair: TitlePair, input: TitleStageInput) {
  const finalText = finalStandardKnowledgeText(input);
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const nuanced = /并非(?:一律|都)?(?:错误|不能用)|不(?:一定|全是)错|不必(?:一律|机械)?(?:替换|删除)|不能机械替换|并不是(?:都)?不能用|是否替换.{0,8}(?:语境|文体|对象)|(?:结合|根据|取决于|视).{0,8}(?:语境|文体|对象)/u.test(finalText);
  if (!nuanced) return false;
  const foldFrench = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase();
  const foldedFinal = foldFrench(finalText);
  const foldedTitle = foldFrench(title);
  const expressions = ['on', 'ca', 'beaucoup', 'mais', 'donc', 'je pense que'];
  // Match French words, not substrings: "ca" in "Canada" and "on" in
  // English words must never turn an unrelated hook into a contradiction.
  const sharedExpression = expressions.some(expression => {
    const word = new RegExp(`(?<![a-z])${expression.replace(/ /g, '\\s+')}(?![a-z])`, 'u');
    return word.test(foldedFinal) && word.test(foldedTitle);
  });
  const absoluteBan = /别用|不要用|不能用|绝对不能|一律(?:删|换|不用)|全部(?:删|换)|快删掉|告别.{0,12}(?:on|ça|ca|beaucoup|mais|donc)|(?:on|ça|ca|beaucoup|mais|donc).{0,12}(?:扣分|(?:判|掉到|降到)B1)|(?:扣分|(?:判|掉到|降到)B1).{0,12}(?:on|ça|ca|beaucoup|mais|donc)|只需.{0,12}替换.{0,12}(?:提分|高分|升级)|写了就(?:扣分|降档)/iu.test(title);
  return sharedExpression && absoluteBan;
}

function finalStandardKnowledgeContentSupports(pair: TitlePair, input: TitleStageInput, minimumOverlap = 2) {
  const contentTokens = semanticBigrams(finalStandardKnowledgeText(input));
  const titleTokens = semanticBigrams(`${pair.textTitle}${pair.coverTitle}${pair.coverSubtitle || ''}`);
  let hit = 0;
  for (const token of titleTokens) if (contentTokens.has(token)) hit += 1;
  return hit >= minimumOverlap;
}

/** Asset counts only. Time windows, percentages and exam identities are not inventory. */
export function standardKnowledgeAssetCountsSupported(pair: TitlePair, input: TitleStageInput) {
  const pages = teachingPages(input.content.innerPages);
  const normalize = (text: string) => normalizeCnNumeralsBeforeUnit(text.replace(/([一二两三四五六七八九十]+)大(?=主题|话题|议题)/gu, '$1类')).replace(/\s+/gu, '');
  const claims = (text: string) => [...normalize(text).matchAll(/(\d+)(?:个|大)?(大主题|大话题|大议题|主题|话题|议题|步骤|步|组|类|条|句|项|点|篇|套|种|个)([\p{Script=Han}]{0,8})/gu)]
    .filter(m => !/第$/.test(normalize(text).slice(0, m.index)))
    .map(m => ({ count: Number(m[1]), unit: m[2], object: m[3] }));
  const family = (claim: {unit:string;object:string}) => {
    const text = claim.unit + claim.object;
    if (claim.unit === '句') return 'expression';
    if (/主题|话题|议题/.test(text)) return 'topic';
    if (/步骤|^步|动作/.test(text)) return 'step';
    if (/坑|错误|误区/.test(text)) return 'pitfall';
    if (/表达|词汇|高频词|常用词|同义词|句型|例句|对照|替换/.test(text)) return claim.unit === '组' ? 'comparison' : 'expression';
    return claim.unit + ':' + claim.object.slice(0, 2);
  };
  const explicit = pages.flatMap(page => claims(page.page_title));
  const comparisonCount = pages.filter(p => p.semanticLayoutType === 'comparison').length;
  const topicCount = pages.filter(p => /远程办公|环境|科技|教育|数字健康|城市生活|工作|健康|社交媒体/.test(p.page_title)).length;
  const pitfallCount = pages.filter(p => /(?:坑|误区|错误)[一二三四五六七八九十\d]+/.test(p.page_title)).length;
  // Evaluate fields separately: a unit at one field's end must not consume another field's object.
  return [pair.textTitle, pair.coverTitle, pair.coverSubtitle || ''].every(field => claims(field).every(claim => {
    const kind = family(claim);
    const brief = input.content.autoFactBrief;
    if (brief?.sourceInnerHash === stableHash(input.content.innerPages) && brief.supportedCounts.some(c =>
      c.count === claim.count && claims(c.label).some(source => family(source) === kind))) return true;
    if (kind === 'comparison' && comparisonCount === claim.count) return true;
    if (kind === 'topic' && topicCount === claim.count) return true;
    if (kind === 'pitfall' && pitfallCount === claim.count) return true;
    // Explicit page inventory must also have enough delivered entries, not merely mention a number.
    if (explicit.some(source => source.count === claim.count && family(source) === kind)
      && pages.some(p => claims(p.page_title).some(c => c.count === claim.count && family(c) === kind) && p.bullets.length >= claim.count)) return true;
    // Read explicit sequences, ignoring decorative emoji and unnumbered footnotes.
    // A repeated/missing ordinal is not a complete inventory.
    const sequenceCount = (p: typeof pages[number], scenes = false) => {
      const ordinals = p.bullets.flatMap(b => {
        const start = b.replace(/([0-9])\uFE0F?\u20E3/gu, '$1. ').replace(/[\uFE0F\u20E3]/gu, '').replace(/^[\p{Extended_Pictographic}\p{S}\p{P}\s]+/u, '');
        const match = scenes ? start.match(/^(?:情境|场景)\s*([A-Z]|\d+|[一二三四五六七八九十])(?:[：:\s]|$)/u)
          : start.match(/^(?:第([一二三四五六七八九十]|\d+)(?:步|项|点|条)|([1-9]\d*)[.、：:\s]|([A-Z])[.、：:])/u);
        if (!match) return [];
        const token = match[1] || match[2] || match[3];
        const n = /^\d+$/.test(token) ? Number(token) : /^[A-Z]$/.test(token) ? token.charCodeAt(0)-64 : '一二三四五六七八九十'.indexOf(token)+1;
        return [n];
      });
      return ordinals.every((n,i)=>n===i+1) ? ordinals.length : 0;
    };
    const numbered = (p: typeof pages[number]) => sequenceCount(p) === claim.count;
    if (/场景|情境/.test(claim.unit + claim.object) && pages.some(p => sequenceCount(p, true) === claim.count)) return true;
    const labeled = (p: typeof pages[number]) => p.bullets.every(b => /^[^：:。]{1,12}[：:]/u.test(b));
    const checkClaim = /检查|自查|必查|核对|交卷/.test(field) && /点|项|条|步|个/.test(claim.unit);
    if (checkClaim && pages.some(p => /检查|自查|核对|交卷/.test(p.page_title + p.lead)
      && numbered(p))) return true;
    const analysisClaim = /拆解|分析|范文/.test(field) && /步|项|点|个|条/.test(claim.unit);
    if (analysisClaim && pages.some(p => /拆解|分析/.test(p.page_title)
      && p.bullets.length === claim.count && labeled(p)
      && p.bullets.every(b => /看|标出|留意|分析/.test(b)))) return true;
    if (kind === 'step') return pages.some(p => /步骤|流程|方法|三步|行动|内化/.test(p.page_title + p.lead)
      && numbered(p));
    if (kind === 'expression' && /条|项|句/.test(claim.unit)) {
      const expressionPages = pages.filter(p => /表达|句型|开场|敬语|例句|正文论证/.test(p.page_title) && p.semanticLayoutType !== 'comparison'
        && p.bullets.every(b => /[A-Za-zÀ-ÿ]{3,}/u.test(b)));
      return expressionPages.length > 0 && expressionPages.reduce((sum,p) => sum + p.bullets.length,0) === claim.count;
    }
    return false;
  }));
}

export function assessStandardKnowledgeTitlePair(pair: TitlePair, input: TitleStageInput) {
  const fields = standardKnowledgeFieldFailures(pair, input);
  const textFailures = fields.filter(f => f.field === 'textTitle').map(f => `${f.field}:${f.reason}`);
  const coverFailures = fields.filter(f => f.field !== 'textTitle').map(f => `${f.field}:${f.reason}`);
  const spec = getCoverTemplateSpec(input.capability.renderer);
  const visibleKicker = spec?.kickerSupported
    ? input.topic.productId === 'delf_b2_writing'
      ? 'DELF B2 写作'
      : getProductPromptProfile(input.topic.productId).shortIdentity
    : '';
  const visibleCover = `${visibleKicker} ${pair.coverTitle} ${pair.coverSubtitle || ''} ${fixedCoverIdentity(input)}`;
  if (!hasRequiredProductIdentity(input.topic.productId, visibleCover)) coverFailures.push('封面所有可见区域缺少考试身份');
  const textOnly = { ...pair, coverTitle: '', coverSubtitle: '' };
  const coverOnly = { ...pair, textTitle: '' };
  for (const [part, failures] of [[textOnly, textFailures], [coverOnly, coverFailures]] as const) {
    if (hasForbiddenProductIdentity(input.topic.productId, `${part.textTitle} ${part.coverTitle} ${part.coverSubtitle || ''}`)) failures.push('TOPIC_DRIFT:混入其他考试身份');
    // A standalone short text has fewer tokens than the former three-field bundle.
    // Keep an actual Inner overlap without inheriting the cover's lexical requirements.
    if (!finalStandardKnowledgeContentSupports(part, input, part === textOnly ? 1 : 2)) failures.push('TOPIC_DRIFT:标题与最终页面缺少内容依据');
    if (contradictsFinalStandardKnowledgeContent(part, input)) failures.push('FINAL_CONTENT_CONTRADICTION:标题与最终页面教学结论直接相反');
    if (!standardKnowledgeAssetCountsSupported(part, input)) failures.push('UNSUPPORTED_ASSET_COUNT:数量承诺缺少最终Inner支持');
  }
  return { textTitleValid: !textFailures.length, coverValid: !coverFailures.length,
    bundleValid: !textFailures.length && !coverFailures.length, textFailures, coverFailures,
    failures: [...textFailures.map(f => `text:${f}`), ...coverFailures.map(f => `cover:${f}`)] };
}

function standardKnowledgeHardFailures(pair: TitlePair, input: TitleStageInput, _recent: Awaited<ReturnType<typeof getRecentTitleFingerprints>>) {
  return assessStandardKnowledgeTitlePair(pair, input).failures;
}

/** Objective cleanup only; do not infer similarity from questions or shared prefixes. */
export function filterStandardKnowledgeTitleCandidates(pairs: TitlePair[], input: TitleStageInput) {
  const seen = new Set<string>();
  let negativeKept = false;
  const eligible: TitlePair[] = [];
  const evaluated = pairs.map((raw,index) => {
    const check = assessStandardKnowledgeTitlePair(raw,input);
    const pair: TitlePair = {...raw,id:raw.id || `title_bundle_${stableHash(`${raw.textTitle}|${raw.coverTitle}|${index}`)}`,
      textTitleValid:check.textTitleValid,coverValid:check.coverValid,bundleValid:check.bundleValid,
      hardFailures:check.failures,warnings:check.textTitleValid&&!check.coverValid?['COVER_ONLY_FAILURE']:[]};
    const reasons = [...check.failures];
    if (check.bundleValid) {
      const key = raw.textTitle.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
      const negative = /^(?:别|不要|拒绝|告别)/u.test(raw.textTitle.trim().replace(/^[\p{P}\p{S}\s]+/u,''));
      if (seen.has(key)) reasons.push('NORMALIZED_DUPLICATE');
      else if (negative && negativeKept) reasons.push('NEGATIVE_IMPERATIVE_FAMILY_LIMIT');
      else {
        seen.add(key);if(negative)negativeKept=true;
        if (eligible.length<4) eligible.push(pair);
        else reasons.push('VALID_RESERVE_AFTER_FIRST_FOUR');
      }
    }
    return {pair,filterReasons:reasons};
  });
  return {evaluated,humanSelectableCandidates:eligible};
}

function detectTitleInputConflict(input: TitleStageInput) {
  const boundary = standardKnowledgeTopicBoundary(input);
  const actual = [
    ...teachingPages(input.content.innerPages).flatMap(page => [page.page_title, page.lead, ...page.bullets]),
  ].join('');
  const expected = semanticBigrams(`${boundary.finalPublicTopic}${boundary.motherTopic}`);
  const actualTokens = semanticBigrams(actual);
  let overlap = 0;
  for (const token of expected) if (actualTokens.has(token)) overlap += 1;
  return overlap < 2 ? 'TITLE_INPUT_CONFLICT:finalPublicTopic与最终页面内容缺少明确语义交集' : undefined;
}

/** Deliberately narrow: a filename/section heading, never a keyword blacklist. */
export function isObviousCatalogTextTitle(title:string) {
  if (/[？?！!]/u.test(title) || /怎么|如何|为什么|总是|不放心|别|不要|原来|后悔|我|你|这|那|先|收好|拿走|有用|好用|照.{0,8}查|看懂|学会/u.test(title)) return false;
  return /^(?:(?:DELF\s*)?B2(?:写作|作文)?|法语写作)[：:\s·-]*[^，,。]{0,24}(?:攻略|资料|素材库|指南|清单|汇总|手册|速查)(?:表)?$/iu.test(title);
}

export function filterTextTitleCandidates(raw: Array<{textTitle?:unknown;clickReason?:unknown;referenceApprovedId?:unknown}>, input:TitleStageInput) {
  const previousBatchTitleKeys = new Set(
    (input.recentGeneratedTextTitles || []).map(normalizeTextTitleKey).filter(Boolean),
  );
  const seen = new Set<string>();
  const approved = new Set(getDelfB2ShortStyleReferences().map(r=>normalizeTextTitleKey(r.title)));
  const surviving: NonNullable<TitlePackage['humanSelectableTextTitles']> = [];
  const evaluated = raw.map((item,index)=>{
    item = item && typeof item==='object' ? item : {};
    const textTitle=clean(item.textTitle),clickReason=clean(item.clickReason),referenceApprovedId=clean(item.referenceApprovedId);
    const method=clean((item as Record<string,unknown>).method);
    const hookOrSearchTerm=clean((item as Record<string,unknown>).hookOrSearchTerm);
    const scoreValue=Number((item as Record<string,unknown>).score);
    const risk=clean((item as Record<string,unknown>).risk);
    const riskReason=clean((item as Record<string,unknown>).riskReason);
    const candidate={id:`text_title_${stableHash(`${index}|${textTitle}`)}`,textTitle,clickReason,referenceApprovedId,
      ...(method?{method}:{}),...(hookOrSearchTerm?{hookOrSearchTerm}:{}),...(Number.isFinite(scoreValue)?{score:scoreValue}:{}),
      ...(risk?{risk}:{}),...(riskReason?{riskReason}:{}),};
    const reasons:string[]=[];
    const warnings:string[]=[];
    const pair:TitlePair={textTitle,coverTitle:'',mechanism:'',userRelation:'',noveltyFingerprint:''};
    if (!textTitle) reasons.push('EMPTY_TEXT_TITLE');
    if (countVisibleUnits(textTitle)>20) warnings.push('TEXT_TITLE_OVER_20');
    if (hasForbiddenProductIdentity(input.topic.productId,textTitle)) warnings.push('WRONG_EXAM_IDENTITY');
    if (!finalStandardKnowledgeContentSupports(pair,input,1)) warnings.push('UNSUPPORTED_CONTENT_SCOPE');
    if (contradictsFinalStandardKnowledgeContent(pair,input)) reasons.push('CONTENT_CONTRADICTION');
    if (!standardKnowledgeAssetCountsSupported(pair,input)) warnings.push('UNSUPPORTED_FACTS_COUNTS');
    // These are factual assertions, not general emotional/marketing vocabulary.
    if (/高频|必考|常考|官方.{0,6}(?:推荐|认证|规定|指定)|考官.{0,6}(?:喜欢|偏好|推荐|要求)|(?:保证|必定|一定).{0,6}(?:过|提分|高分|满分)|稳过|包过|保过|\d+(?:\.\d+)?\s*[%％]/u.test(textTitle)) warnings.push('UNSUPPORTED_MARKETING_FACT');
    const finalText=finalStandardKnowledgeText(input);
    if (/\d+(?:\.\d+)?分.{0,8}\d+(?:\.\d+)?分|效率(?:翻倍|提升\d+)/u.test(textTitle)
      || (/(?:真实|历年)?真题/u.test(textTitle) && !/(?:真实|历年)?真题/u.test(finalText))) warnings.push('UNSUPPORTED_MARKETING_FACT');
    const audienceSource=`${finalText} ${input.topic.audienceState || ''} ${input.topic.scene || ''} ${input.topic.painOrDesire || ''}`;
    const audienceLabels=textTitle.match(/(?<![A-Za-z])i人|学生党|留学生党?|新手妈妈|宝妈|打工人/gu) || [];
    if (audienceLabels.some(label=>!audienceSource.includes(label.trim()))) reasons.push('UNSUPPORTED_AUDIENCE_IDENTITY');
    if (/\d+(?:句|条|组|步).{0,3}就够|只要.{1,10}就(?:行|够)|(?:保证|直接|必定).{0,4}(?:拿|得|提|涨)\d+分/u.test(textTitle)) warnings.push('UNSUPPORTED_RESULT_GUARANTEE');
    // Keywords cannot distinguish a valid click hook from a changed promise.
    if (promotesLocalPageToWholeTitle(textTitle, input)) warnings.push('LOCAL_PAGE_SCOPE_CHECK');
    const key=normalizeTextTitleKey(textTitle);
    if (approved.has(key)) reasons.push('APPROVED_NORMALIZED_EXACT_COPY');
    if (previousBatchTitleKeys.has(key)) reasons.push('PREVIOUS_BATCH_NORMALIZED_DUPLICATE');
    const negative=/^(?:别|不要|拒绝|告别)/u.test(textTitle.replace(/^[\p{P}\p{S}\s]+/u,''));
    const catalog=isObviousCatalogTextTitle(textTitle);
    if (!reasons.length) {
      if (seen.has(key)) reasons.push('NORMALIZED_DUPLICATE');
      else {seen.add(key);surviving.push(candidate);}
    }
    return {candidate,filterReasons:reasons,warnings,catalog,negative};
  });
  // Candidate count belongs to the native Skill. Keep every valid, de-duplicated title
  // visible to the human instead of silently truncating the pool to four.
  // Catalog/negative-family flags remain diagnostics only; they never hide a
  // valid title or invalidate the job. Four is only the minimum to continue.
  return {evaluated,survivalCount:surviving.length,humanSelectableTextTitles:surviving.length>=4?surviving:[]};
}

export function normalizeTextTitleKey(text:string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\p{Z}\s]/gu,'');
}

/**
 * A whole-note title may use a concrete detail, but a broad note must not be
 * renamed after one page or one task. These markers are only trace warnings:
 * they cannot decide scope or reject ordinary pain/scenario language.
 */
function promotesLocalPageToWholeTitle(title: string, input: TitleStageInput) {
  const wholeNote = `${input.content.wholeNoteCore || ''} ${input.topic.topic} ${input.topic.promise || ''}`;
  const broadNote = /整科|整篇|整套|这一科|四科|各科|听说读写|所有(?:题型|部分|任务)|三题|两部分|从.{0,18}到|全流程|完整(?:结构|备考|复习)/u.test(wholeNote);
  if (!broadNote) return false;
  const localMarker = /Section\s*[A-Z]|[A-C]\s*部分|第[一二三四五六七八九十\d]+(?:道|部分|题)|\d+\s*词|\d+\s*分钟|每天[^，。！？!?]{0,10}|每周[^，。！？!?]{0,10}|(?:审题|自查|检查|时间(?:怎么|分配)|结尾|开头|收尾|论点|例子|连接词)[^，。！？!?]{0,10}/iu;
  if (!localMarker.test(title)) return false;
  const wholeMarker = /整科|整篇|整套|这一科|所有|三题|两部分|各题|全流程|从.{0,18}到|完整(?:结构|备考|复习)/u;
  return !wholeMarker.test(title);
}

type ProductionTitleMethodCard = {
  id:string;
  name:string;
  instruction:string;
};

const PRODUCTION_TITLE_METHOD_CARDS: Record<string, ProductionTitleMethodCard> = {
  search: {
    id:'search',name:'搜索词卡位',
    instruction:'用一个真实搜索词做标题主干，再接本篇的具体任务或获得物；不要堆多个关键词。',
  },
  scene: {
    id:'scene',name:'场景具体化',
    instruction:'把userTask中的真实写作时刻、判断或卡点说成人话；不虚构身份、经历或场景。',
  },
  save: {
    id:'save',name:'数字清单 + 收藏指令',
    instruction:'仅当supportedCounts明确支持时使用真实数量；收藏感来自可反复查用的内容，不写“照抄就行”。',
  },
  correction: {
    id:'correction',name:'反常识纠错',
    instruction:'只针对正文明确指出的误读、混用或错误动作制造认知反差；不把建议说成官方规则。',
  },
  tutorial: {
    id:'tutorial',name:'保姆级教程 / 新手向',
    instruction:'仅当正文确有步骤、流程或操作顺序时突出可执行性；不承诺固定效果或“几步必会”。',
  },
  emotion: {
    id:'emotion',name:'情绪发现',
    instruction:'用自然的发现、松一口气、惊讶或反问增强人感；情绪后必须跟具体对象，不编造亲测经历。',
  },
};

const SPACE_XHS_TITLE_PRODUCTION_CORE = `
你为小红书DELF B2中文学习笔记生成文字标题。输入已经是锁定正文的最终标题事实包，不再重新建立或输出第二份内容简报。
先锁定editorialTopic代表的整篇问题，再结合factBrief与userTask理解实际内容和用户任务。8条都必须能代表editorialTopic这一整篇，不是8个页面小标题。wholeNoteOutline只用于核对事实；单页案例、范文题目、连接词或局部动作不能成为标题主语。scopeMode为whole_note时，每条必须保留体系、全流程、整篇任务或从起点到终点的范围，不能只写审题、开头、检查或某一道示例题。
只使用selectedMethodCards提供的Creator Buddy方法。方法卡是表达工具，不是必须平均覆盖的配额；同一合适方法可以生成不同角度，不得为了展示方法而硬造人群、情绪、数字或承诺。
标题同时考虑搜索发现和点击，但一个标题只押一个主要搜索词。specificSearchTerms是可用范围，不要求每条都塞关键词。
一次生成8条可原样发布的候选。其中5到6条稳、具体、直接，2到3条可以有自然的发布者态度、反问、发现感或松一口气；“救命、后悔、码住、别再、谁懂啊”等没有配额，不合适就不用。
每条目标13到18个可见字符，20为绝对上限。必须忠实于整篇和事实边界；数量只取supportedCounts。不得虚构人群、真实经历、官方结论、必考/高频、固定效果或分数结果；不得把组织方式说成官方固定模板。
previousBatchTitles仅用于避免同批规范化重复，不是风格参考。本次没有历史认可标题原文，也不要猜测或复原它们。
只返回严格JSON对象：{"candidates":[{"textTitle":"..."}]}。candidates恰好8条，不输出方法名、brief、评分、风险、Top 5、A/B测试、Markdown或额外字段。
`;

export function selectProductionTitleMethodCards(input:TitleStageInput): ProductionTitleMethodCard[] {
  const brief=input.content.autoFactBrief;
  // Route from the whole-note editorial scope and real user task, not from
  // local examples buried in one page. The outline remains grounding input
  // for generation but must not choose the title method for the whole note.
  const routeText=[input.topic.topic,brief?.userTask].filter(Boolean).join(' ');
  const wholeNote=/完整|全流程|体系|整篇|从.{0,16}到/u.test(input.topic.topic);
  const cards=[PRODUCTION_TITLE_METHOD_CARDS.search];
  if(!wholeNote)cards.push(PRODUCTION_TITLE_METHOD_CARDS.scene);
  const hasSupportedCount=Boolean(brief?.supportedCounts?.some(item=>Number(item.count)>1));
  if(/完整|全流程|步骤|流程|顺序|练习|路线|自查|检查|从.+到/u.test(routeText)) {
    cards.push(PRODUCTION_TITLE_METHOD_CARDS.tutorial);
  } else if(/误读|错误|跑偏|偏题|混用|只会|忘了|缺乏|不该|避免|纠偏|失分/u.test(routeText)) {
    cards.push(PRODUCTION_TITLE_METHOD_CARDS.correction);
  } else if(hasSupportedCount && /几|哪些|清单|分类|表达|句型|词|主题|素材|论据|对照/u.test(routeText)) {
    cards.push(PRODUCTION_TITLE_METHOD_CARDS.save);
  }
  cards.push(PRODUCTION_TITLE_METHOD_CARDS.emotion);
  return cards.slice(0,4);
}

function deriveSpecificSearchTerms(input:TitleStageInput) {
  const terms=['DELF B2写作'];
  const rules:Array<[RegExp,string[]]>=[
    [/正式信|信函|写信/u,['B2正式信','法语正式信']],
    [/审题|题干|指令词/u,['B2写作审题']],
    [/论据|观点|论证/u,['B2写作论据','B2议论文']],
    [/时间|分钟|写不完|超时/u,['B2写作时间管理']],
    [/自查|检查|交卷|修改/u,['B2作文检查']],
    [/范文|仿写|迁移/u,['B2写作范文']],
    [/结构|骨架|开头|主体段|结尾/u,['B2写作结构']],
    [/语法|时态|变位|性数/u,['B2写作语法']],
    [/表达|连接词|衔接词|句型/u,['B2写作表达']],
    [/备考|考前|复习/u,['B2写作备考']],
  ];
  // A whole-process topic should stay broad. Do not derive a narrow search
  // identity from one example or one page inside the note.
  if(/完整|全流程|从.{0,16}到/u.test(input.topic.topic)) return terms;
  // Public editorial scope is authoritative. Only fall back to userTask when
  // the topic itself contains no recognisable search family; otherwise a
  // concrete exercise mentioned in userTask can wrongly shrink the note.
  const sources=[input.topic.topic,input.content.autoFactBrief?.userTask||''];
  for(const source of sources) {
    const matched=rules.find(([pattern])=>pattern.test(source));
    if(!matched) continue;
    terms.push(...matched[1]);
    break;
  }
  return Array.from(new Set(terms)).slice(0,3);
}

function compactTitleOutline(input:TitleStageInput) {
  const trim=(value:unknown,max:number)=>clean(value).slice(0,max);
  return input.content.innerPages.slice(0,5).map(page=>({
    pageNo:page.page_no,
    pageTitle:trim(page.page_title,80),
    pagePurpose:trim(page.lead,180),
    keyContent:page.bullets.slice(0,3).map(item=>trim(typeof item==='string'?item:(item as {content?:unknown}).content,220)).filter(Boolean),
  }));
}

export function buildProductionTextTitlePrompt(input: TitleStageInput) {
  const brief = input.content.autoFactBrief;
  if (!brief || brief.sourceInnerHash !== stableHash(input.content.innerPages)) throw new Error('AUTO_FACT_BRIEF_STALE');
  const {sourceInnerHash: _source, ...facts} = brief;
  const specificSearchTerms=deriveSpecificSearchTerms(input);
  const selectedMethodCards=selectProductionTitleMethodCards(input);
  return {systemPrompt:SPACE_XHS_TITLE_PRODUCTION_CORE,titleCoreInput:{
    editorialTopic:input.topic.topic,
    scopeMode:/完整|全流程|体系|整篇|从.{0,16}到/u.test(input.topic.topic)?'whole_note':'focused_note',
    ...facts,
    examIdentity:'DELF B2',
    targetAudience:'正在准备DELF B2写作的中文学习者',
    allowedAudienceLabels:['B2考生','B2备考者','法语学习者'],
    specificSearchTerms,
    selectedMethodCards,
    wholeNoteOutline:compactTitleOutline(input),
    previousBatchTitles:(input.recentGeneratedTextTitles||[]).slice(-40),
  }};
}

async function generateStandardKnowledgeTitlePackage(
  input:TitleStageInput,
  context:{lockedBrief:ReturnType<typeof assertLockedProductionBrief>;recent:Awaited<ReturnType<typeof getRecentTitleFingerprints>>;profile:ReturnType<typeof getProductPromptProfile>;coverSummary:unknown;templateSpec:ReturnType<typeof getCoverTemplateSpec>;coverRange:number[]},
):Promise<VersionedArtifact<TitlePackage>> {
  const basePrompt=buildNativeTitlePrompt(input);
  const marketContentNoteFixedCover=input.topic.topicSource==='market'
    && ['delf_b2_writing','tef_tcf_canada','tcf_canada_writing_7day'].includes(input.topic.productId);
  const marketAnchor=marketContentNoteFixedCover ? {
    finalTopic:input.topic.topic,
    primaryReferenceTitle:input.topic.primaryReferenceTitle,
    referenceTitleSkeleton:input.topic.referenceTitleSkeleton,
    topicCore:input.topic.topicCore,
  } : undefined;
  const prompt={...basePrompt,userPrompt:marketAnchor
    ? `${basePrompt.userPrompt}\n\nMarket Anchor（强约束）：${JSON.stringify(marketAnchor)}\n只生成发布文字标题，不生成或改写封面标题。候选必须忠实于finalTopic的同一点击入口，不得把整篇改成另一个页面知识点。`
    : basePrompt.userPrompt};
  let providerTrace: AiResponseTrace | undefined;
  const creator=await callOpenAICompatibleJsonWithUsage<string>([
    {role:'system',content:prompt.systemPrompt},{role:'user',content:prompt.userPrompt},
  ],{stage:'title',model:TEXT_MODEL,maxTokens:10000,temperature:0.72,retries:1,thinking:false,responseMode:'text',
    onResponseTrace: trace => { providerTrace = trace; },
  });
  const dir=path.join(process.cwd(),'data','final-content-traces',creator.requestId);
  await mkdir(dir,{recursive:true});
  // Save the untouched native report even if parsing fails. No repair call.
  await writeFile(path.join(dir,'31_NATIVE_SKILL_RESULT.md'),creator.data,'utf8');
  await writeFile(path.join(dir,'29_NATIVE_PROVIDER_TRACE.json'),JSON.stringify(providerTrace || {traceMissing:true},null,2));
  if (!providerTrace || providerTrace.messages[0]?.content !== prompt.systemPrompt
      || providerTrace.messages[1]?.content !== prompt.userPrompt || providerTrace.providerRawContent !== creator.data) {
    throw Object.assign(new Error('NATIVE_TITLE_REQUEST_TRACE_MISMATCH'),{usage:creator.usage});
  }
  const requestHash=stableHash({messages:providerTrace.messages,model:providerTrace.model,
    temperature:providerTrace.temperature,maxTokens:providerTrace.maxTokens,thinking:false,responseMode:'text'});
  let raw: ReturnType<typeof extractNativeTitleCandidates>;
  try { raw=extractNativeTitleCandidates(creator.data); }
  catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)),{usage:creator.usage,requestId:creator.requestId}); }
  const filtered=filterTextTitleCandidates(raw,input);
  const debug={creatorRaw:creator.data,rawCandidateCount:raw.length,...filtered};
  await writeFile(path.join(dir,'30_TEXT_TITLE_CANDIDATES.json'),JSON.stringify({
    skill:{name:'space-xhs-title',integration:'native-full',completeSkillLoaded:true,
      path:prompt.skillPath,hash:stableHash(prompt.systemPrompt)},
    model:TEXT_MODEL,temperature:0.72,maxTokens:10000,user:prompt.userPrompt,usage:creator.usage,
    system:prompt.systemPrompt,
    input:prompt.titleCoreInput,
    requestHash,promptVersion:TEXT_PRODUCTION_VERSION,providerTraceVerified:true,
    ...debug,
  },null,2));
  if(filtered.humanSelectableTextTitles.length<4){
    const error=new Error(`INSUFFICIENT_VALID_TEXT_TITLES:${filtered.survivalCount}/4`);
    Object.assign(error,{titleDebug:{...debug,humanSelectableTextTitles:[]},usage:creator.usage});throw error;
  }
  const fixedTopicCandidate=marketContentNoteFixedCover ? {
    id:`market_final_topic_${stableHash(input.topic.topic)}`,
    textTitle:input.topic.topic,
    clickReason:'Market finalTopic原样候选',
    referenceApprovedId:String(input.topic.referenceId ?? input.topic.id),
  } : undefined;
  const candidatesForReview=fixedTopicCandidate
    ? [fixedTopicCandidate,...filtered.humanSelectableTextTitles.filter(candidate=>normalizeTextTitleKey(candidate.textTitle)!==normalizeTextTitleKey(fixedTopicCandidate.textTitle))]
    : filtered.humanSelectableTextTitles;
  const semanticReview=await reviewTitleSemanticBoundary(input, candidatesForReview);
  const boundarySafe=candidatesForReview.filter(candidate => semanticReview.keptIds.has(candidate.id));
  await writeFile(path.join(dir,'32_TITLE_SEMANTIC_BOUNDARY_REVIEW.json'),JSON.stringify({
    version:TITLE_BOUNDARY_REVIEW_VERSION,
    model:TEXT_MODEL,
    ...semanticReview.trace,
  },null,2));
  if(boundarySafe.length<4){
    const error=new Error(`INSUFFICIENT_SEMANTICALLY_SAFE_TEXT_TITLES:${boundarySafe.length}/4`);
    Object.assign(error,{titleDebug:{...debug,semanticReview},usage:mergeAiUsage(creator.usage,semanticReview.usage)});throw error;
  }
  // Legacy fields are previews only. No cover copy is created here.
  const previews=boundarySafe.map(c=>({...c,coverTitle:'',mechanism:'',userRelation:'',noveltyFingerprint:stableHash(c.textTitle),textTitleValid:true}));
  const data:TitlePackage={
    nativeSkillReport:creator.data,
    semanticBoundaryReview:{version:TITLE_BOUNDARY_REVIEW_VERSION,reviewedCandidateCount:candidatesForReview.length,
      keptCandidateIds:[...semanticReview.keptIds],rejectedCandidates:semanticReview.rejected,requestId:semanticReview.requestId},
    mode:'text_only',humanSelectableTextTitles:boundarySafe,
    fixedCoverTitle:marketContentNoteFixedCover?input.topic.topic:undefined,
    humanSelectedTextTitleId:null,humanSelectedCoverTitleId:marketContentNoteFixedCover?fixedTopicCandidate?.id:null,
    humanSelectedCandidateId:null,sourceInnerHash:stableHash(input.content.innerPages),contentSnapshotHash:stableHash(input.content.innerPages),productionBriefHash:context.lockedBrief.briefHash,
    candidates:previews,selected:previews[0],titleBundles:previews,
  };
  const finalInputHash=stableHash({nativeTitleRequest:requestHash,semanticReviewRequest:semanticReview.requestHash});
  return {...artifact(data,finalInputHash,mergeAiUsage(creator.usage,semanticReview.usage),creator.requestId,['TEXT_TITLE_AWAITING_HUMAN_CHOICE']),prompt_version:TEXT_PRODUCTION_VERSION};
}

type SemanticBoundaryDecision = {id:string; decision:'KEEP'|'DROP'; reason?:string; evidence?:string};

/**
 * This gate deliberately does not score clickability or rewrite titles. Its sole
 * job is to remove clear changes of meaning which string guards cannot see.
 */
async function reviewTitleSemanticBoundary(
  input: TitleStageInput,
  candidates: NonNullable<TitlePackage['humanSelectableTextTitles']>,
) {
  const note = input.content.innerPages.map(page => [
    `P${page.page_no} ${page.page_title}`, page.lead || '',
    ...page.bullets.map(value => typeof value==='string' ? value : JSON.stringify(value)),
  ].join('\n')).join('\n\n');
  const messages = [{role:'system' as const,content:`你是标题的“语义边界闸门”，不是标题作者、润色器或评分器。
逐条审查候选标题。判断不清时一律 KEEP。不得修改、缩短、重写、推荐标题。

只在以下“明确改义”时 DROP：
1. 把“不要只靠/不要零散地/视情况/局部训练”等限定建议，扩大成绝对禁令或普遍结论；
2. 把“分别练/各题各有步骤”等内容，改成正文没有证明的题目优先级、因果或比较结论；
3. 把原创训练法、示例或自检说成官方考试规则、固定评分标准、必然结果或整篇唯一内容；
4. 添加正文没有的亲身经历、人群身份、数字、考试身份或事实承诺。

不得因为标题不够吸引、字数、语气、emoji、方法标签、轻微措辞、或只是局部切入就DROP。已通过其他硬闸门的候选无需重复审核。
输出严格json对象，不要输出Markdown、解释或json之外的文字。Return only a valid json object.：{"decisions":[{"id":"候选id","decision":"KEEP或DROP","reason":"DROP时说明改变了什么","evidence":"DROP时引用正文或事实边界中的原文依据"}]}。必须覆盖每一个候选id各一次；KEEP的reason/evidence可省略。`},
    {role:'user' as const,content:JSON.stringify({
      topic:input.topic.topic,
      sourceContext:{audienceState:input.topic.audienceState,scene:input.topic.scene,painOrDesire:input.topic.painOrDesire,promise:input.topic.promise},
      wholeNoteCore:input.content.wholeNoteCore,
      productBoundary:examScopeContext(input.topic.productId,input.topic.examScope)?.rule,
      factBoundary:currentNoteBoundary(input.content),
      fullNote:note,
      candidates:candidates.map(({id,textTitle})=>({id,textTitle})),
    })}];
  let providerTrace: AiResponseTrace | undefined;
  const result=await callOpenAICompatibleJsonWithUsage<{decisions?:unknown}>(messages,{
    stage:'title_semantic_boundary_review',model:TEXT_MODEL,maxTokens:2500,temperature:0,retries:1,thinking:false,
    onResponseTrace:trace=>{providerTrace=trace;},
  });
  if(!providerTrace || providerTrace.messages.length!==2 || providerTrace.providerRawContent.length===0) {
    throw Object.assign(new Error('TITLE_SEMANTIC_REVIEW_TRACE_MISSING'),{usage:result.usage});
  }
  const requestHash=stableHash({messages:providerTrace.messages,model:providerTrace.model,
    temperature:providerTrace.temperature,maxTokens:providerTrace.maxTokens,thinking:false,responseMode:'json'});
  const rawDecisions=Array.isArray(result.data?.decisions) ? result.data.decisions : [];
  const expected=new Set(candidates.map(candidate=>candidate.id));
  const decisions=new Map<string,SemanticBoundaryDecision>();
  for(const value of rawDecisions) {
    if(!value || typeof value!=='object') continue;
    const item=value as Record<string,unknown>;
    const id=clean(item.id),decision=clean(item.decision).toUpperCase();
    if(!expected.has(id) || decisions.has(id) || (decision!=='KEEP' && decision!=='DROP')) continue;
    decisions.set(id,{id,decision,reason:clean(item.reason),evidence:clean(item.evidence)} as SemanticBoundaryDecision);
  }
  if(decisions.size!==expected.size) {
    throw Object.assign(new Error(`TITLE_SEMANTIC_REVIEW_INVALID:${decisions.size}/${expected.size}`),{usage:result.usage});
  }
  const rejected=candidates.flatMap(candidate=>{
    const decision=decisions.get(candidate.id)!;
    return decision.decision==='DROP' ? [{id:candidate.id,textTitle:candidate.textTitle,reason:decision.reason || '模型未说明明确改义原因',...(decision.evidence?{evidence:decision.evidence}:{})}] : [];
  });
  return {keptIds:new Set(candidates.filter(candidate=>decisions.get(candidate.id)?.decision==='KEEP').map(candidate=>candidate.id)),rejected,
    requestHash,
    requestId:result.requestId,usage:result.usage,
    trace:{requestHash,request:providerTrace.messages,response:result.data,providerRawContent:providerTrace.providerRawContent,rejected}};
}

/**
 * 检查候选实际表达的点击理由是否匹配请求槽位。
 * 这是语义后置检查，不信任模型返回的 clickMode 字段本身。
 */
export function assessTitleModeAuthenticity(
  pair: TitlePair,
  requestedMode: TitleClickMode | 'UNKNOWN',
) {
  const text = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const firstClause = text.split(/[：:？！!?。]/u)[0] || text;
  const has = (pattern: RegExp) => pattern.test(text);
  const hasInFirstClause = (pattern: RegExp) => pattern.test(firstClause);
  const checks: Record<TitleClickMode, boolean> = {
    COLLECTION_ASSET: has(/清单|汇总|整理|速查|表|库|地图|资料|合集|大全/u) && !hasInFirstClause(/慌|焦虑|来不及|别再|不要|不会|为什么/u),
    EMOTIONAL_CURIOSITY: has(/慌|焦虑|心慌|没底|后悔|终于|意外|原来|好奇/u),
    PAIN_QUESTION: has(/不会|不够|没思路|写不完|来不及|慌|焦虑|丢分|没把握|为什么/u),
    INSIGHT_CONTRARIAN: has(/别再|不要|不是|反而|原来|误区|别瞎|盲目/u),
    COMPARISON_GAP: has(/B1.{0,5}B2|B2.{0,5}B1|对比|区别|差距|前后|普通.{0,4}高分/u),
    URGENT_EXAM: has(/考前|临近考试|限时|最后[一二三两]?天|还剩|分钟|冲刺/u),
    SELF_TEST_AVOIDANCE: has(/自查|检查|查漏|短板|审题|核对|最后.{0,4}看/u),
    VOICE_EXPERIENCE: has(/过来人|亲测|我用|我把|我踩|我的经验|实战经验/u),
  };
  const valid = requestedMode !== 'UNKNOWN' && checks[requestedMode] === true;
  return { valid, reason: valid ? undefined : `标题主要表达未体现${requestedMode}的点击语义` };
}

/**
 * 检查公开标题是否把一个母题缩成其中一个执行子点。
 * 这里只做明显下钻的确定性识别，不用字符串完全相等替代语义判断。
 */
export function assessTitleScopePreservation(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle} ${pair.coverTitle}`;
  const broad = `${input.topic.topic} ${input.topic.promise} ${input.topic.contentAngle}`;
  const hasBroadProcess = /从.{0,8}(读题|审题).{0,12}(完稿|成稿|检查|自查)|完整路径|作战地图|时间分配|阶段|流程/u.test(broad);
  const onlyMicro = /审题|读题/u.test(title)
    && !/完稿|成稿|检查|自查|流程|时间|阶段|完整|地图|全程|从.{0,8}到/u.test(title);
  const valid = !(hasBroadProcess && onlyMicro);
  return { valid, reason: valid ? undefined : '公开标题只覆盖母题中的审题/读题子点' };
}

export function applyCoverTruncateFallbackForTest(candidates: TitlePair[], input: TitleStageInput, consensusActive: boolean) {
  return applyCoverTruncateFallback(candidates, input, consensusActive);
}

function fitTextTitle(value: string, consensusActive = false) {
  const compacted = compactTitleLanguage(value).replace(/DELF\s*B2/gi, 'DELF B2').replace(/TEF\s*TCF/gi, 'TEF/TCF');
  const text = consensusActive ? compacted.replace(/DELF\s*B2\s*作文/gi, 'DELF B2写作') : compacted;
  // 共识路径禁止程序硬切文字标题。超长标题交给硬闸门和返修；
  // 宁可淘汰一个候选，也不能产出“为何总丢”这类被截断的残句。
  if (consensusActive) return stripDanglingTitleTail(text);
  if (countVisibleUnits(text) <= 20) return consensusActive ? stripDanglingTitleTail(text) : text;
  const trimmed = trimTitleAtNaturalBoundary(text, 20, consensusActive ? { keepInnerSpaces: true } : undefined);
  return consensusActive ? stripDanglingTitleTail(trimmed) : trimmed;
}

function compactTitleLanguage(value: string) {
  return value
    .replace(/TEF\s*(?:和|与|还是|\/|／)\s*TCF/gi, 'TEF/TCF')
    .replace(/DELF\s*B2\s*写作/gi, 'DELF B2写作')
    .replace(/个技巧/g, '招')
    .replace(/帮你/g, '')
    .replace(/轻松/g, '')
    .replace(/练了很多篇/g, '练了')
    .replace(/先搞懂/g, '先看')
    .replace(/到底|真正|完整地|系统地/g, '')
    .replace(/(\d+)个差异对比/g, '$1处差异')
    .replace(/(\d+)个(?:常见)?原因/g, '$1个原因')
    .replace(/自然凑满/g, '写够')
    .replace(/自然扩到/g, '扩到')
    .replace(/总是/g, '')
    .replace(/是因为/g, '：')
    .replace(/\s+/g, ' ')
    .trim();
}

// 阶段 D：共用机器（limit/dedupe/penalty/diversify）的分类器可传参，
// 默认值 = 现有 4 机制分类，legacy 调用点行为零变化；门控路径传 6 方向分类器。
function limitTitleCandidates(candidates: TitlePair[], classifier: TitleCategoryFn = classifyTitleMechanism, targetCount = TITLE_CANDIDATE_COUNT) {
  const limits = new Map<string, number>();
  const result: TitlePair[] = [];
  for (const candidate of candidates) {
    const mechanism = classifier(candidate);
    const count = limits.get(mechanism) || 0;
    if (count >= 1) continue;
    limits.set(mechanism, count + 1);
    result.push(candidate);
  }
  // AI偶尔漏掉某一机制时，用其余合格候选补足展示位，避免前台出现1组/2组。
  for (const candidate of candidates) {
    if (result.length >= targetCount) break;
    if (!result.includes(candidate)) result.push(candidate);
  }
  return result;
}

// 「拉丁字母」统一口径（用户 2026-08-22 指示）：Unicode Latin Script——覆盖 é/è/à/ç
// 等法语重音字母，不含汉字；不用 \p{L}（会把汉字纳入），也不裸用 ASCII 类（认不出
// 重音字母）。截断尾部回退与残尾检测共用这一口径。
const LATIN_LETTER_SRC = '\\p{Script=Latin}';
// 尾部法语短语整体回退：Latin 词 + 词间空格连成的尾部串一次性剥掉，回到汉字/标点
// 边界。不能只剥切半的词——「…只会Je vous éc」剥成「…只会Je vous」仍是语义悬空
// 句（用户 2026-08-22 口径），必须退到「…只会」。
const TRAILING_LATIN_PHRASE = new RegExp(`(?:(?:${LATIN_LETTER_SRC}|[0-9])+\\s*)+$`, 'u');
const LEADING_LATIN_LETTER = new RegExp(`^${LATIN_LETTER_SRC}`, 'u');

// 汉字词切半回退（batch_1787409902266 job_002 实测「…写作思路才打开」20字硬切落成
// 「写作思」）：用词级分词判定，不加汉字黑名单（用户 2026-08-22 指示）。保留段最后
// 一个字与被丢弃的第一个字同属一个 ≥2 字的含汉字词段时，说明切点落在该词内部——
// 回退到该词起点（前一个自然边界）。数量短语「50篇」「5维」不误伤：分词把数字与
// 量词分成独立段，截断恰好落在量词后（被丢弃字是新段首字）不触发回退。分词器无
// 词典环境退化为单字分段 → 永不触发 → 行为与旧版一致（保守降级）。仅共识路径调用。
function hanWordSplitRetreatIndex(graphemes: string[], cutGraphemeIdx: number): number | null {
  const wordSegs = Array.from(
    new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(graphemes.join('')),
    item => item.segment,
  );
  let idx = 0;
  for (const seg of wordSegs) {
    // 码点计数：本域字符（汉字/ASCII/预组合重音字母）与字素一一对应
    const len = Array.from(seg).length;
    if (cutGraphemeIdx < idx + len) {
      if (cutGraphemeIdx > idx && len >= 2 && /[一-鿿]/u.test(seg)) return idx;
      return null;
    }
    idx += len;
  }
  return null;
}

export function trimTitleAtNaturalBoundary(value: string, max: number, opts: { keepInnerSpaces?: boolean } = {}) {
  // 阶段F修复轮（batch_1787382741943 用户拒收项）：旧实现重组时把所有空白单元丢掉，
  // 是「DELFB2 缺空格」的直接根因。keepInnerSpaces 模式按非空白单元计数（与
  // countVisibleUnits 同口径），空格原样保留；默认不传 = legacy 字节锁定不变。
  const graphemes = Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value), item => item.segment);
  let units: string[];
  let firstDropped: string | null = null;
  if (opts.keepInnerSpaces) {
    let visible = 0;
    units = [];
    for (const unit of graphemes) {
      if (!/^\s+$/u.test(unit)) visible += 1;
      if (visible > max) { firstDropped = unit; break; }
      units.push(unit);
    }
  } else {
    units = graphemes.filter(unit => !/^\s+$/u.test(unit)).slice(0, max);
  }
  // 尾部处理口径（用户 2026-08-22 指示）：
  // - keepInnerSpaces（共识路径）优先级：①被丢弃首字符是 Latin 字母（ASCII 口径认不
  //   出 é 等重音字母，batch_1787401381055 job_003 实测「…Je vous é」＝「écris」被切
  //   剩首字母）→ 切进尾部法语短语——切在词中（…écris 切成 …éc）或完整词后短语还在
  //   继续（…écris 后还有 pour）。整条尾部法语短语回退到汉字边界：只剥半个词会停在
  //   「Je vous」这类语义悬空处。截断恰好落在完整短语边界、后续是汉字时（firstDropped
  //   非拉丁），尾部法语原样保留，不误删「…DELF B2」这类完整收尾。回退后悬空的
  //   连接符（「备考TEF/」的「/」）一并清理。②非拉丁丢弃字符 → 查词级分词，切点
  //   落在含汉字词段内部（「写作思」类）时回退到该词起点。已完整收尾（无丢弃字符
  //   或丢弃字是新词段首字）不额外删字。
  // - 默认 legacy 分支：ASCII 字节锁定不变（两路回退都不生效）。
  if (opts.keepInnerSpaces && firstDropped !== null && !LEADING_LATIN_LETTER.test(firstDropped)) {
    const retreat = hanWordSplitRetreatIndex(graphemes, units.length);
    if (retreat !== null) units = units.slice(0, retreat);
  }
  let text: string;
  if (opts.keepInnerSpaces && firstDropped !== null && LEADING_LATIN_LETTER.test(firstDropped)) {
    text = units.join('')
      .replace(TRAILING_LATIN_PHRASE, '')
      .replace(/[\s，：、/·]+$/u, '');
  } else if (opts.keepInnerSpaces) {
    text = units.join('');
  } else {
    text = units.join('').replace(/[A-Za-z0-9]+$/u, '').replace(/[，：、]$/u, '');
  }
  const lastBoundary = Math.max(text.lastIndexOf('，'), text.lastIndexOf('！'), text.lastIndexOf('？'));
  if (lastBoundary >= Math.floor(max * 0.68)) text = text.slice(0, lastBoundary + 1);
  return text.replace(/[，：、]$/u, '').replace(/\s+$/u, '');
}

/**
 * 截断点落在词中间时会留下不能自然收尾的单字虚词（实测案例：「…三分钟自查法让」，
 * 「让你的」被切掉一半后连 isUnnatural 的「让你的$」模式都匹配不上）。
 * 只在当前开启的完整 Title Skill 路径启用；showcase 的截断行为保持原样。
 * 「的」不在列表里：「写给零基础的」这类名词化结尾是合法的，剥了会误伤。
 */
// 「及」不能按单字尾硬拦：「来不及」是完整自然表达。宁可放过极少数真正悬空的
// 单字「及」，也不系统误杀高频口语标题。
const DANGLING_TITLE_TAIL = /(?:让|把|被|给|拿|靠|和|与|或|而|且|之|地|得|在|从|对|向|往|比|跟|替|连|就|要按|按)$/u;
const INCOMPLETE_TITLE_TAIL_PHRASE = /做了个$/u;

export function hasDanglingTitleTail(value: string): boolean {
  return DANGLING_TITLE_TAIL.test(value) || INCOMPLETE_TITLE_TAIL_PHRASE.test(value);
}

// 两字残尾（f-p1r1 实测「…36项清单让心」）：使役/处置动词落在倒数第二位，后面挂着
// 被切半的宾语短语。只拦使役类（让把被拿靠帮使令叫）——「给分」这类合法动宾结尾不拦。
// 仅共识路径启用；legacy 截断行为保持原样（任务 #11 存量另记）。
const INCOMPLETE_PHRASE_TAIL = /(?:让|把|被|拿|靠|帮|使|令|叫)[一-鿿]$/u;

export function hasIncompletePhraseTail(value: string): boolean {
  return INCOMPLETE_PHRASE_TAIL.test(value);
}

export function stripDanglingTitleTail(value: string): string {
  let text = value;
  for (;;) {
    const next = text.replace(/[，：、]$/u, '').replace(DANGLING_TITLE_TAIL, '').replace(INCOMPLETE_TITLE_TAIL_PHRASE, '');
    if (next === text) return text;
    text = next;
  }
}

// 阶段F修复轮（batch_1787382741943 用户拒收项）：20字硬切留下的「截断残片」两类——
// 数字残尾（job_002 实测「我靠4步砍掉一」＝「砍掉一半」被切剩数字头；动词收口
// 了/掉/完/够/成/剩/留 + 中文数字/半/几）和字母词后单字残尾（job_003 实测
// 「融进DELFB2作」＝「写作」被切半）。量词白名单放行「3步/12周/50篇」这类合法
// 量词收尾；「到一」（从零到一）、「唯一」「万一」不进动词集合不误杀。
// 白名单新增字符必须有真实语料证据并配回归断言（层：title-gates 夹具「先补这3层」；
// 维：真实跑批 v2-real-smoke-20260818-r2「自查5维」），不接受直觉扩列。
// 口径（用户 2026-08-22 指示）：残片只识别+硬拦+回退/转人工复核，绝不剥字伪装成
// 合格标题（「砍掉一」剥成「砍掉」仍不是完整自然的标题）。因此只有 has 没有 strip。
const CUT_FRAGMENT_TAIL_NUMERAL = /(?:了|掉|完|够|成|剩|留)(?:一|二|两|三|四|五|六|七|八|九|十|百|千|万|半|几)$/u;
// 「别写penser/dire了」是完整口语；“了”有真实误杀证据，作为合法尾字放行。
const CUT_FRAGMENT_TAIL_AFTER_ALNUM = /(?<=[A-Za-z0-9])(?![步天周篇页项个招遍分钟字词分条张次类档级轮套点月年倍层维了])[一-鿿]$/u;
// 法语单字母残尾（batch_1787401381055 job_003 实测「DELF B2写作开头只会Je vous é」＝
// 「écris」被切剩首字母；历史同型「TEF还是T」「总用J」「错误句v」）：单个 Latin 字母
// 独立成词收尾——前面是空格/汉字/中文标点/省音撇号（l'é）/开头。语料证据（2026-08-22
// 扫描 29433 个标题字段）：合法法语收尾全是多字母词（donc/mais/Cordialement/malgré/
// TEF…无一例外），单字母收尾的标题样本全部是残片；唯一近似「回复来信：Je fais suite
// à」是内页 page_title，不走此闸门。多字母切半（「只会premiè」）无法与真词区分，
// 由截断侧整短语回退兜住。与截断侧共用 Latin Script 口径。
const CUT_FRAGMENT_TAIL_LONE_LATIN = new RegExp(`(?:^|[\\s一-鿿，。、！？：；）'’])${LATIN_LETTER_SRC}$`, 'u');

export function hasCutFragmentTail(value: string): boolean {
  return CUT_FRAGMENT_TAIL_NUMERAL.test(value) || CUT_FRAGMENT_TAIL_AFTER_ALNUM.test(value) || CUT_FRAGMENT_TAIL_LONE_LATIN.test(value);
}

function normalizePairForInput(pair: TitlePair, input: TitleStageInput, opts: { coverTruncate?: boolean; consensusActive?: boolean } = {}): TitlePair {
  let coverTitle = pair.coverTitle;
  const coverIdentitySource = `${pair.coverKicker || ''} ${coverTitle} ${pair.coverSubtitle || ''}`;
  const profile = getProductPromptProfile(input.topic.productId);
  const examContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const hasExplicitCoverIdentity = hasRequiredProductIdentity(input.topic.productId, coverIdentitySource);
  if (!hasExplicitCoverIdentity) {
    if (input.topic.productId === 'delf_b2_writing') {
      coverTitle = /^B2/i.test(coverTitle) ? `DELF ${coverTitle}` : `DELF B2 ${coverTitle}`;
    } else {
      coverTitle = `${profile.shortIdentity} ${coverTitle}`;
    }
  }
  return {
    ...pair,
    textTitle: fitTextTitle(pair.textTitle, opts.consensusActive === true),
    coverTitle: fitCoverTitle(coverTitle, input, opts.coverTruncate !== false, opts.consensusActive === true),
  };
}

function fitCoverTitle(value: string, input: TitleStageInput, allowTruncate = true, consensusActive = false) {
  const range = getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18];
  const text = compactTitleLanguage(normalizeNaturalCounters(value))
    .replace(/还在/g, '')
    .replace(/快速/g, '')
    .replace(/全解析/g, '看清')
    .replace(/\s+/g, ' ')
    .trim();
  if (countVisibleUnits(text) <= range[1]) return consensusActive ? stripDanglingTitleTail(text) : text;
  if (!allowTruncate) return consensusActive ? stripDanglingTitleTail(text) : text;
  const trimmed = trimTitleAtNaturalBoundary(text, range[1], consensusActive ? { keepInnerSpaces: true } : undefined);
  return consensusActive ? stripDanglingTitleTail(trimmed) : trimmed;
}

function passesHardGates(
  pair: TitlePair,
  input: TitleStageInput,
  selected: Set<string>,
  coverTitles: Set<string>,
  ignoreLength = false,
  // 阶段 D：门控开时 <12 字只警告不淘汰（设计 §0.7 / §4.3）；>20 硬上限两个路径都保留。
  relaxMinTextTitle = false,
  // 人话改写轮（用户 2026-08-22 收窄口径）：只有「营销表达」放宽——百分比钩子、分数
  // 变化、速成时间承诺（90%、两周速成、12分➡️18分）。事实性数字（3步/36项/50篇/20词/
  // x分钟这类内容结构声称）与语义安全检查（新痛点/新维度/词数扩写/跑题）任何路径都硬拦。
  relaxMarketingPromises = false,
) {
  // 只有平台物理上限是标题字段级硬限制；封面容量、身份重复、普通数字、用户关系、
  // 目录感和营销表达都由 QA 记 warning/排序信号处理，不再把合格候选整组淘汰。
  if (!ignoreLength && countVisibleUnits(pair.textTitle) > 20) return false;
  const fullCover = `${pair.coverKicker || ''} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  if (hasForbiddenProductIdentity(input.topic.productId, `${pair.textTitle} ${fullCover}`)) return false;
  if (selected.has(fingerprintTitle(pair.textTitle)) || coverTitles.has(fingerprintTitle(pair.coverTitle))) return false;
  if (isUnnatural(pair.textTitle) || isUnnatural(pair.coverTitle)) return false;
  // 悬空虚词收尾、两字残尾（「…让心」「…让你」）与截断残片（「…砍掉一」「…DELFB2作」）
  // 只在共识路径硬拦（legacy 零变化）。残片拦截后走返修/回退，不做剥字伪装。
  if (relaxMinTextTitle && (
    hasDanglingTitleTail(pair.textTitle) || hasDanglingTitleTail(pair.coverTitle)
    || hasIncompletePhraseTail(pair.textTitle) || hasIncompletePhraseTail(pair.coverTitle)
    || hasCutFragmentTail(pair.textTitle) || hasCutFragmentTail(pair.coverTitle)
  )) return false;
  if (/[：:，、]$/u.test(pair.textTitle) || /[：:，、]$/u.test(pair.coverTitle)) return false;
  // 这些是软告警/排序信号：没有可靠数字、缺少显式痛点、普通内容摘要、身份重复，
  // 都不应成为全局硬失败。仍保留真正跑题和明显错误标题作为安全硬门槛。
  if (introducesNewPain(pair, input) || introducesUnsupportedFacet(pair, input) || !contentSupports(pair, input)) return false;
  // 用户关系、点击理由和收益强度属于质量排序信号。它们不能和事实、身份、
  // 数字来源一样做全盘硬拦，否则模型给出的可用角度会被窄正则全部误杀。
  return true;
}

function introducesNewPain(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const context = [
    input.topic.topic,
    input.topic.audienceState,
    input.topic.scene,
    input.topic.painOrDesire,
    input.topic.promise,
    ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...input.content.innerPages.flatMap(page => [page.page_title, page.lead, ...page.bullets]),
    input.content.captionParts.opening,
    ...input.content.captionParts.value,
  ].join(' ');
  const painSignals: Array<[RegExp, RegExp]> = [
    [/跑题|偏题/, /跑题|偏题|审题|题意/],
    [/练了没用|练了没效果|白练/, /练了没用|练了没效果|白练|没有进步|分数没变化/],
    [/字数不够|写不够|凑字|差.{0,4}词/, /字数不够|写不够|凑字|差.{0,4}词|250词/],
    [/格式|称呼|结尾/, /格式|称呼|结尾|正式信|论坛投稿/],
    [/没思路|不会展开|写不出来/, /没思路|不会展开|写不出来|不知道怎么写|论点/],
    [/词汇少|背词|词汇量/, /词汇少|背词|词汇量|用词|词汇/],
    [/语法差|语法错|变位/, /语法差|语法错|变位|句法|配合/],
    [/来不及|时间不够|写不完/, /来不及|时间不够|写不完|时间分配/],
    [/丢分|分数上不去|提不上去/, /丢分|分数上不去|提不上去|扣分|评分/],
    [/选错|选哪个|怎么选/, /选错|选哪个|怎么选|不确定|纠结|选考/],
  ];
  return painSignals.some(([inTitle, inContext]) => inTitle.test(title) && !inContext.test(context));
}

async function generateSingleTitleSlot(
  slotId: TitleSlotId,
  requestedClickMode: TitleClickMode,
  input: TitleStageInput,
  existing: TitlePair[],
  maxTokens = 1100,
) {
  const result = await callOpenAICompatibleJsonWithUsage<{ slotId?: string; requestedClickMode?: string; bundle?: Record<string, unknown> }>([
    {
      role: 'system',
      content: [
        '你只负责补一个缺失的标题槽位。不要返回数组，不要修改其他槽位，不要改Mother Topic或正文。',
        `必须返回JSON：{slotId:"${slotId}",requestedClickMode:"${requestedClickMode}",bundle:{textTitle,coverKicker,coverTitle,coverSubtitle,clickMode,clickReason,mechanism,userRelation,seoKeyword,noveltyFingerprint}}。`,
        `当前槽位是${slotId}，主点击逻辑是${requestedClickMode}；策略必须真实体现在标题中，不得只改字段标签。`,
        '只使用输入正文已有对象和数字；文字标题超过20字不要硬切，写成更短的完整句。封面身份可由coverKicker承担。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({
      slotId,
      requestedClickMode,
      motherTopic: input.topic.topic,
      finalPublicTopic: input.topic.topic,
      specificAsset: input.topic.specificAsset,
      audience: input.topic.audienceState,
      scene: input.topic.scene,
      painOrDesire: input.topic.painOrDesire,
      contentSummary: {
        coverBlocks: input.content.coverBlocks.slice(0, 6).map(block => ({ heading: block.heading, items: block.items.slice(0, 4) })),
        innerPages: input.content.innerPages.slice(0, 5).map(page => ({ page_title: page.page_title, lead: page.lead, bullets: page.bullets.slice(0, 3) })),
      },
      existingTitles: existing.map(item => ({ textTitle: item.textTitle, coverTitle: item.coverTitle, clickMode: item.clickMode })),
    }) },
  ], { maxTokens, temperature: 0.45, retries: 1 });
  if (result.data.slotId !== slotId || !result.data.bundle) return { pair: null, usage: result.usage, error: 'SLOT_ID_MISMATCH' };
  const pair = normalizePair({ ...result.data.bundle, slotId, requestedClickMode });
  return { pair, usage: result.usage, error: pair ? undefined : 'SLOT_BUNDLE_INVALID' };
}

async function generateMissingTitleSlots(
  missingSlots: Array<{ slotId: TitleSlotId; requestedClickMode: TitleClickMode }>,
  input: TitleStageInput,
  existing: TitlePair[],
  maxTokens = 1400,
) {
  const result = await callOpenAICompatibleJsonWithUsage<RawTitleResponse>([
    {
      role: 'system',
      content: `只补齐指定的标题槽位。必须返回固定对象键：${missingSlots.map(item => item.slotId).join('、')}；不要返回数组，不要修改已有槽位。每个对象必须包含slotId、textTitle、coverKicker、coverTitle、coverSubtitle、clickMode、clickReason、mechanism、userRelation、seoKeyword、noveltyFingerprint。requestedClickMode由slotSpecs注入，不要自行改写。只使用已有内容和数字。`,
    },
    { role: 'user', content: JSON.stringify({
      slotSpecs: missingSlots,
      motherTopic: input.topic.topic,
      finalPublicTopic: input.topic.topic,
      specificAsset: input.topic.specificAsset,
      audience: input.topic.audienceState,
      scene: input.topic.scene,
      painOrDesire: input.topic.painOrDesire,
      contentSummary: input.content.innerPages.slice(0, 5).map(page => ({ page_title: page.page_title, lead: page.lead, bullets: page.bullets.slice(0, 3) })),
      existingTitles: existing.map(item => ({ slotId: item.slotId, textTitle: item.textTitle, coverTitle: item.coverTitle })),
    }) },
  ], { maxTokens, temperature: 0.4, retries: 1 });
  const candidates = missingSlots.flatMap(item => {
    const raw = result.data[item.slotId];
    if (!raw) return [];
    const bundle = raw.bundle || raw;
    const pair = normalizePair({ ...bundle, slotId: item.slotId, requestedClickMode: item.requestedClickMode } as Partial<TitlePair> & Record<string, unknown>);
    return pair ? [pair] : [];
  });
  return { candidates, usage: result.usage };
}

async function repairTitleCandidates(
  candidates: TitlePair[],
  context: { productIdentity: string; topic: string; promise: string; audience: string; painOrDesire: string; coverRange: number[]; supportedNumbers: string[]; targetCount: number; required_directions?: string[]; require_complete_phrase?: boolean; missing_slots?: string[] },
  input: TitleStageInput,
  selected: Set<string>,
  coverTitles: Set<string>,
  maxTokens = 1400,
) {
  const payload = candidates.map((candidate, index) => ({
    index,
    slotId: candidate.slotId || slotForIndex(index),
    requestedClickMode: candidate.requestedClickMode || 'UNKNOWN',
    clickMode: candidate.clickMode || candidate.generatorClickMode || 'UNKNOWN',
    textTitle: candidate.textTitle,
    textTitleVisibleUnits: countVisibleUnits(candidate.textTitle),
    coverTitle: candidate.coverTitle,
    coverSubtitle: candidate.coverSubtitle,
    mechanism: candidate.mechanism,
    userRelation: candidate.userRelation,
    seoKeyword: candidate.seoKeyword,
    noveltyFingerprint: candidate.noveltyFingerprint,
    failures: titleGateFailures(candidate, input, selected, coverTitles),
  }));
  const result = await callOpenAICompatibleJsonWithUsage<RawTitleResponse>([
    {
      role: 'system',
      content: [
        '你是小红书标题精修编辑。候选角度已确定，逐项修复failures，不新增内容里没有的角度、承诺或数字。',
        context.required_directions
          ? `当前输入可能只有${candidates.length}组，但最终必须补齐到${context.targetCount}组；缺少的方向按required_directions补写新候选，每方向恰好1组，不得复制已有标题，也不能只返回原候选。`
          : `当前输入可能只有${candidates.length}组，但最终必须补齐到${context.targetCount}组；缺少的点击机制要补写新候选，不得复制已有标题，也不能只返回原候选。`,
        ...(context.missing_slots?.length ? [`必须优先补齐这些缺失槽位：${context.missing_slots.join('、')}；每个slotId只返回一组，已有槽位不要改策略。`] : []),
        'textTitle超过平台20字才必须压缩；短于推荐长度、封面容量略超、缺少显式痛点或资料型摘要只作为提示，不得因此丢弃槽位。',
        `封面标题目标容量为${context.coverRange[0]}到${context.coverRange[1]}字；略超时优先保留完整意思，不要硬切残句。`,
        `封面整体应保留商品考试身份（${context.productIdentity}）；如果coverKicker已经提供身份，coverTitle不必重复。标题末尾不能是冒号、逗号或顿号。`,
        '不同clickMode使用不同QA：COLLECTION_ASSET重资料对象和收藏感；PAIN_QUESTION重用户对号入座；INSIGHT_CONTRARIAN重认知冲突；COMPARISON_GAP必须有真实A/B；URGENT_EXAM重考前场景；SELF_TEST_AVOIDANCE重自查动作；VOICE_EXPERIENCE允许真人口吻。',
        '选考标题只能引导比较目标项目、题型和任务形式，不得用单一强弱项直接下“选TEF/选TCF”的结论。',
        `只能保留这些正文已有数字：${context.supportedNumbers.join('、') || '无'}；B2、TEF、TCF、CLB7等考试名称除外。其余新编数量、分数、天数和分钟必须删除。`,
        '禁止生造“资料太散”“卡住”“拖后腿”等机器表达。',
        '必须改成可以直接念出口的完整中文短句，禁止“短板不明确、练了没重点、清单查短板、语法错9类”这类书面硬拼。商品身份只出现一次，禁止标题前后重复DELF、B2、TEF或TCF。',
        ...(context.require_complete_phrase
          ? ['修复后的标题必须以完整词、完整短语或完整句子收尾，不得在「评分维度」「写作思路」这类多字词中间断开；原候选带「评分维」「写作思」这类半截词时改成更短的完整表达，不得原样保留。']
          : []),
        '除考试缩写和actual_content里已有的法语词外，不得在中文标题或副标题里夹入未翻译的英文单词。',
        '修复中文数量搭配：数字修饰“差异、原因、问题、方法、错误”等名词时必须带自然量词；禁止“4差异”“3原因”“必考差异”等不说人话的组合。标题和副标题也不得新增正文没有展开的评分、费用、出分速度或难度。',
        '返回JSON对象，顶层为candidates；每项必须原样保留输入slotId/requestedClickMode/sourceDirection，严格保留{textTitle,coverKicker,coverTitle,coverSubtitle,mechanism,userRelation,seoKeyword,noveltyFingerprint}。不得改变槽位策略。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify({ context, candidates: payload }) },
  ], { maxTokens, temperature: 0.35, retries: 1 });
  return {
    candidates: (Array.isArray(result.data.candidates) ? result.data.candidates : [])
      .map(normalizePair)
      .filter((pair): pair is TitlePair => Boolean(pair)),
    usage: result.usage,
  };
}

export const TITLE_FINAL_EDITOR_PROMPT_VERSION = 'v2-title-final-editor-8';
export const TITLE_TEXT_HUMANIZER_PROMPT_VERSION = 'v2-title-text-humanizer-2';
// 兼容现有测试与诊断脚本；生产主流程已不再调用旧的四槽 humanize 节点。
export const TITLE_HUMANIZE_PROMPT_VERSION = TITLE_FINAL_EDITOR_PROMPT_VERSION;

type FinalTitleCandidateResponse = {
  textTitle?: string;
  coverTitle?: string;
  coverSubtitle?: string;
  clickReasonType?: string;
  clickReason?: string;
};

type FinalTitleResponse = {
  candidates?: FinalTitleCandidateResponse[];
};

type FinalTextHumanizerResponse = {
  candidates?: Array<{ id?: string; textTitle?: string }>;
};

type FinalTextHumanizerInput = {
  pair: TitlePair;
  clickReason: string;
  clickReasonType: string;
};

type FinalTitleContext = {
  coverRange: number[];
  requestedCount: number;
  selected: Set<string>;
  coverTitles: Set<string>;
};

const FINAL_TITLE_CLICK_REASONS = [
  '错误认知',
  '错误做法',
  '被说中场景',
  '考场失控',
  '结果焦虑',
  '即时收益',
  '具体方法',
  '后悔避坑',
] as const;

function finalEditorDirection(raw: FinalTitleCandidateResponse): TitleDirection {
  const type = typeof raw.clickReasonType === 'string' ? raw.clickReasonType : '';
  const text = `${raw.textTitle || ''} ${raw.coverTitle || ''} ${raw.coverSubtitle || ''}`;
  if (/结果焦虑|考场失控/.test(type) || /焦虑|破防|崩溃|心慌|慌了|发慌|心累|害怕|怕|来不及/.test(text)) return 'emotion';
  if (/错误认知/.test(type)) return 'counter';
  if (/错误做法|后悔避坑|被说中场景/.test(type)) return 'pain';
  if (/即时收益|具体方法/.test(type)) return 'fast_path';
  return classifyTitleDirection({
    textTitle: raw.textTitle || '',
    coverTitle: raw.coverTitle || '',
    coverSubtitle: raw.coverSubtitle,
    mechanism: type,
    userRelation: '',
    noveltyFingerprint: '',
  });
}

/** 供离线验收复用正式出厂压缩逻辑，不触发模型调用。 */
export function compressTextTitleForTest(value: string) {
  return compressTextTitle(value);
}

/** 只做整词/整短语压缩；压不下来就原样返回，交给字段级 Repair，绝不切字符。 */
function compressTextTitle(value: string) {
  if (countVisibleUnits(value) <= 20) return value;
  const compressed = value
    .replace(/\s+/g, ' ')
    .replace(/DELF\s*B2\s*写作/gi, 'B2写作')
    .replace(/过来人说大实话/g, '过来人说')
    .replace(/精准定位薄弱项补救/g, '定位薄弱项')
    .replace(/离考试没几天/g, '临近考试')
    .replace(/整理好了[：:]/g, '')
    .replace(/别死磕长难句/g, '别死磕难句')
    .replace(/这样查才不慌/g, '这样查不慌')
    .replace(/\s*([：:，、])\s*/g, '$1')
    .trim();
  return countVisibleUnits(compressed) <= 20 ? compressed : value;
}

function finalCoverAssetContract(input: TitleStageInput) {
  const blocks = input.content.coverBlocks.slice(0, 6);
  return {
    required_cover_identity: `${examScopeContext(input.topic.productId, input.topic.examScope)?.displayIdentity || getProductPromptProfile(input.topic.productId).noteIdentity}身份必须在coverTitle或封面文字中自然可见；不能只放在文字标题里`,
    topic_object: input.topic.topic,
    content_angle: input.topic.contentAngle,
    content_promise: input.topic.promise,
    use_scene: input.topic.scene,
    primary_sections: blocks.map(block => block.heading).filter(Boolean),
    concrete_components: blocks.flatMap(block => block.items.slice(0, 4).map(item => item.primary)),
    naming_instruction: '先根据以上事实识别这篇真正交付的具体对象，再给它命名。名称要让人知道里面是什么、怎么用；“清单/要点/速查/攻略”只有在内容确实就是该形态且前面的修饰语已经说清具体对象时才可使用，不能拿这些泛词代替对象名。',
    feed_standalone_test: '想象用户在信息流里只看到封面，没有看到文字标题和正文。coverTitle与coverSubtitle合在一起必须让他马上知道考试/对象、具体问题或可得价值；禁止“别乱抓”“这样就够”等离开上下文就不知所云的封面。',
  };
}

function fitCompleteSubtitle(value: string) {
  const clean = compactTitleLanguage(value).replace(/[。！？!?]+$/u, '');
  if (countVisibleUnits(clean) <= 24) return clean;
  return stripDanglingTitleTail(trimTitleAtNaturalBoundary(clean, 24, { keepInnerSpaces: true }));
}

function finalClickReasonEvidence(input: TitleStageInput) {
  return {
    primary_problem: input.topic.painOrDesire,
    scene: input.topic.scene,
    content_correction: input.content.innerPages.slice(0, 5).map(page => page.lead).filter(Boolean),
    concrete_actions: input.content.coverBlocks
      .flatMap(block => block.items.slice(0, 4).map(item => item.primary)),
    supported_outcomes: [
      input.topic.promise,
      input.content.captionParts.opening,
      ...input.content.captionParts.value.slice(0, 4),
    ].filter(Boolean),
  };
}

function finalEditorTemplatePrompt(input: TitleStageInput): string[] {
  const spec = getCoverTemplateSpec(input.capability.renderer);
  const common = spec ? [
    `当前封面模板是“${spec.name}”（${input.capability.renderer} / ${input.capability.family}）。`,
    `只遵守当前模板规则：${spec.titleInstruction}`,
    `当前模板禁区：${spec.forbiddenInstruction}`,
    spec.allowedCoverTitleTypes?.length ? `当前模板允许的封面标题方向：${spec.allowedCoverTitleTypes.join(' / ')}。` : '',
    '锁定工单是上游已确认的事实边界：文字标题和封面标题可以分工，但必须指向同一个内容对象、同一个核心结果。不得各自发明不同的数量、题型、步骤数或资料类型。',
  ].filter(Boolean) : [
    `当前封面模板是 ${input.capability.renderer} / ${input.capability.family}，请让封面文案与它的实际承载方式一致。`,
  ];
  const resourceFamilies = new Set(['directory', 'table', 'phrase', 'flashcard', 'book', 'roadmap']);
  if (resourceFamilies.has(input.capability.family)) {
    return [...common,
      '这是资料/知识资产型封面。封面标题既要让人看懂具体有什么、能拿来做什么，也必须有点击张力，不能写成平淡目录名。文本标题负责揭示用户为什么现在会在意这份资料，例如正在犯的错误、被说中的场景、认知落差或立即可用的收益；不要重复封面的“表、清单、步骤、整理”。',
    ];
  }
  if (input.capability.family === 'pain') {
    return [...common,
      '这是痛点大字封面。封面负责把具体冲突或痛感打出来；文本标题必须增加另一层信息，例如真实场景、原因、后果或正文给出的解决方向，不能把同一句情绪换词再说一遍。',
    ];
  }
  if (input.capability.family === 'experience') {
    return [...common,
      '这是经验型封面。封面负责经验判断或结果；文本标题负责对应的失败现场、原因或适用人群。没有输入证据时不要虚构第一人称经历。',
    ];
  }
  if (input.capability.family === 'document') {
    return [...common,
      '这是文档解析型封面。封面说清解析对象和具体价值；文本标题从用户对该对象的误解、不会迁移或实际使用困难切入，不能只复述“解析了什么”。',
    ];
  }
  if (input.capability.renderer === 'official_notice') {
    return [...common,
      '封面保持当前模板要求的通知体裁；文本标题另写一个自然的点击理由，不要再写成第二条通知，也不要重复封面公文标题。',
    ];
  }
  if (input.capability.renderer === 'showcase_screenshot') {
    return [...common,
      '这是知识库截图证明型封面。封面负责让用户看见具体资料和可信获得感；文本标题负责指出用户为什么需要它，避免空喊商品价值。',
    ];
  }
  return [...common,
    '封面标题与文本标题必须在同一锁定工单内分工：一边给具体价值或视觉主张，另一边补用户为什么会在意。可以不同句，但不能变成两个选题，更不能发明不同数量或内容类型。',
  ];
}

/**
 * 最终标题创作：不读取旧候选，只根据本篇事实、当前封面模板和用户认可语感，
 * 独立创作最多6组三件套。程序保持原始顺序且不改字；单条有客观硬伤只丢该条，
 * 整批0条可用时才把失败原因退给LLM技术性重写一次。
 */
async function createFinalTitleWithLlm(
  input: TitleStageInput,
  context: FinalTitleContext,
): Promise<{ candidates: TitlePair[]; warnings: string[]; usage: AiUsageSummary | undefined }> {
  const requestedCount = Math.max(1, Math.min(6, Math.trunc(context.requestedCount || TITLE_CANDIDATE_COUNT)));
  const styleReferences = getTitleStyleReferences(input.topic.productId, 6);
  const spec = getCoverTemplateSpec(input.capability.renderer);
  const preferGroundedEmotionFirst = shouldPreferGroundedEmotionDefault(input.topic.noveltyFingerprint);
  const basePayload = {
    task: `独立创作最多${requestedCount}组可直接发布的小红书标题三件套。不要润色、参考或猜测任何旧标题。`,
    candidate_count_max: requestedCount,
    topic: input.topic.topic,
    target_user: input.topic.audienceState,
    scene: input.topic.scene,
    pain_or_desire: input.topic.painOrDesire,
    content_promise: input.topic.promise,
    seo: {
      preferred_keyword: input.topic.seo.primary,
      related_keywords: input.topic.seo.related,
      instruction: '在自然且不破坏语感时优先放进textTitle；不是每条都必须硬塞完整关键词。考试身份也可以自然落在coverTitle。',
    },
    physical_limits: {
      text_title_max_visible_units: 20,
      text_title_recommended_visible_units: [12, 20],
      cover_title_visible_units: context.coverRange,
      cover_subtitle_max_visible_units: 24,
    },
    current_cover_template: spec ? {
      renderer: spec.renderer,
      name: spec.name,
      family: spec.family,
      title_instruction: spec.titleInstruction,
      forbidden_instruction: spec.forbiddenInstruction,
      allowed_title_types: spec.allowedCoverTitleTypes,
    } : {
      renderer: input.capability.renderer,
      family: input.capability.family,
    },
    cover_asset_contract: finalCoverAssetContract(input),
    click_reason_evidence: finalClickReasonEvidence(input),
    emotion_policy: {
      required_candidate: '本批至少有1组从真实备考情绪切入；情绪必须由scene、pain_or_desire或click_reason_evidence中的具体原因支撑',
      explicit_words_allowed: ['焦虑', '破防', '崩溃', '慌', '心累', '后悔'],
      use_rule: '可以直接使用情绪词，不必一律弱化；但读者必须能回答“为什么会有这种情绪”，禁止把情绪词孤零零贴在资料名后面',
      default_order: preferGroundedEmotionFirst
        ? '本篇属于情绪首位轮换：若该组事实成立，把最自然、最具体的情绪候选排第1；不要为了排位夸大事实'
        : '本篇不强制情绪候选排第1：仍需保留1组情绪候选，其余按整体发布质量排序',
    },
    actual_content: {
      cover_blocks: input.content.coverBlocks.slice(0, 6).map(block => ({
        heading: block.heading,
        items: block.items.slice(0, 4).map(item => item.primary),
      })),
      inner_pages: input.content.innerPages.slice(0, 5).map(page => ({
        page_title: page.page_title,
        lead: page.lead,
        bullets: page.bullets.slice(0, 3),
      })),
      caption: {
        opening: input.content.captionParts.opening,
        value_points: input.content.captionParts.value.slice(0, 4),
      },
    },
    style_references: styleReferences.map(formatStyleReferenceForPrompt),
  };
  let usage: AiUsageSummary | undefined;
  let lastRejected: Array<{ candidate: FinalTitleCandidateResponse; failures: string[] }> = [];
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const payload = attempt === 1
        ? basePayload
        : {
          ...basePayload,
          rejected_candidates: lastRejected,
          retry_instruction: '上一批没有任何候选通过客观技术验收。针对列出的硬错误重新创作一批，不要解释，也不要只修补原句。',
        };
      const result = await callOpenAICompatibleJsonWithUsage<FinalTitleResponse>([
        {
          role: 'system',
          content: [
            '你是本篇内容最后一个、可以独立创作的小红书标题编辑。旧标题不存在；你的任务不是润色，而是直接写出用户愿意发布的候选。程序不会替你补语感、截字、改词或排序。',
            `一次最多返回${requestedCount}组三件套，质量不足可以少返回，不要硬凑。返回顺序就是你建议用户看到的顺序，但不要解释排序。`,
            '创作textTitle前先在内部识别：目标用户在本篇主题上最常见的旧认知、错误做法或具体困境是什么；正文真正纠正、解释或解决了什么；二者最大的落差在哪里；用户意识到这个落差时会产生什么心理反应。优先从这个落差中寻找点击理由，不要只是把正文知识点包装得更口语。',
            '每个textTitle都必须触发一个清晰的用户心理反应，例如被说中、焦虑、意外、顿悟、获得感、好奇或行动冲动；但不要求使用强烈情绪词，也不能为了冲突歪曲正文。',
            '本批至少写1组“有具体原因的情绪标题”。焦虑、破防、崩溃、慌、心累、后悔都可以直接使用，不要自动替换成更安全的干货词；但情绪必须由scene、pain_or_desire或click_reason_evidence支撑，让人能说清“为什么会这样”。禁止“DELF B2写作破防”“委屈破防”“承载焦虑”等孤立贴标签或编辑术语。',
            preferGroundedEmotionFirst
              ? '本篇命中情绪首位轮换：如果有事实成立且表达自然的情绪候选，请把它排在第1位；事实不成立时不得硬造情绪。'
              : '本篇不要求情绪候选排第1，但仍须在候选中保留1组；第1位按总体发布质量决定。',
            `生成前先根据click_reason_evidence为每组确定点击理由。clickReasonType只是表达角度，值只能是：${FINAL_TITLE_CLICK_REASONS.join(' / ')}；clickReason必须另写成一条具体、完整、可由正文支持的因果或需求命题，例如“背范文原句导致换题后无法迁移”，禁止只填“错误认知、被说中场景、具体方法”等抽象类别。`,
            '同批候选的具体clickReason必须在语义上不同，不能把同一个因果理由分别包装成错误认知、场景和方法来冒充多样性。正文只支持少数理由时宁可少返回；不要机械分配问句、别再句或任何公式配额。',
            ...finalEditorTemplatePrompt(input),
            '封面命名前必须先读取cover_asset_contract：先识别本篇真正交付的具体对象，再写coverTitle。不要在没有对应资产证据时自行发明“时间分配表”等对象，也不要用“清单、要点、速查、攻略”替代说不清的对象名。',
            `本批 coverTitle 的独立必填条件：${finalCoverAssetContract(input).required_cover_identity}。这不是SEO软目标；不满足的整组不会展示给用户。`,
            '文本标题与封面标题必须增加不同信息。textTitle不得只是coverTitle的口语化复述；coverTitle也不能只把textTitle缩短。封面究竟写“药”还是写“痛”，以当前模板规则为准。',
            'SEO是文字标题的必要约束，但不能写成搜索词串：每个textTitle都要自然保留一个真实身份或主题锚点（如DELF B2写作、B2作文、TEF写作）；优先使用用户会说的话，不能为了关键词牺牲网感。',
            `textTitle不超过20个可见字；coverTitle保持${context.coverRange[0]}到${context.coverRange[1]}个可见字；coverSubtitle不超过24个可见字并补充一个新信息。字母、数字、标点各算1字，空格不算。上限不是目标，装不下就换更短的完整说法。`,
            '三个字段都必须非空，且以完整词、完整短语或完整句子收尾。禁止“评分维、写作思、DELFB2作、Je vous é”这类残词残句。',
            '可以使用自然的第一/第二人称、疑问、反差、克制情绪或少量平台化口吻，但不要批量复制同一开头和句法骨架，也不要让“为什么、别再、真正、其实、可能、还不够”连续泛滥。',
            '避免震惊、封神、99%都不知道、建议收藏、一文搞懂、保姆级等廉价标题党。',
            '只能使用输入内容真实支持的主题、事实、数字和承诺；不得为了点击新增分数、天数、效果、个人经历或商品卖点。',
            'style_references是用户明确认可的语感样本。学习它们的口吻、节奏、情绪强度和点击角度，不照抄原句，也不要退回标准内容运营腔。',
            attempt === 2
              ? '这是唯一一次技术返写。上一批0条可用；只修复rejected_candidates里列出的空字段、超限、身份错误、明确编造数字、精确重复或残词残句，重新创作整组三件套。'
              : '',
            '只返回JSON：{"candidates":[{"clickReasonType":"错误认知等允许值之一","clickReason":"具体的底层因果或需求命题","textTitle":"...","coverTitle":"...","coverSubtitle":"..."}]}。两个clickReason字段只供内部审计与批内精确去重，不会展示给用户；不要输出分析、解释或其他字段。',
          ].filter(Boolean).join('\n'),
        },
        { role: 'user', content: JSON.stringify(payload) },
      ], {
        maxTokens: 500 + requestedCount * 300,
        temperature: 0.9,
        retries: 1,
      });
      usage = usage ? mergeAiUsage(usage, result.usage) : result.usage;
      const rawCandidates = Array.isArray(result.data.candidates)
        ? result.data.candidates.slice(0, requestedCount)
        : [];
      const accepted: TitlePair[] = [];
      const acceptedForHumanizer: FinalTextHumanizerInput[] = [];
      const seenTriples = new Set<string>();
      const seenClickReasons = new Set<string>();
      let skippedDuplicateReasons = 0;
      lastRejected = [];
      for (const raw of rawCandidates) {
        const pair = finalTitlePairFromResponse(raw, input);
        const failures = pair
          ? finalTitleValidationFailures(pair, input, context)
          : ['textTitle、coverTitle、coverSubtitle都必须是非空字符串'];
        const exactKey = pair ? `${pair.textTitle}\u0000${pair.coverTitle}\u0000${pair.coverSubtitle || ''}` : '';
        if (pair && seenTriples.has(exactKey)) failures.push('与本批另一组三件套完全重复');
        if (failures.length) {
          lastRejected.push({ candidate: raw, failures });
          continue;
        }
        if (!pair) continue;
        const clickReason = typeof raw.clickReason === 'string' ? fingerprintTitle(raw.clickReason) : '';
        if (clickReason && seenClickReasons.has(clickReason)) {
          skippedDuplicateReasons += 1;
          continue;
        }
        seenTriples.add(exactKey);
        if (clickReason) seenClickReasons.add(clickReason);
        accepted.push(pair);
        acceptedForHumanizer.push({
          pair,
          clickReason: typeof raw.clickReason === 'string' ? raw.clickReason : '',
          clickReasonType: typeof raw.clickReasonType === 'string' ? raw.clickReasonType : '',
        });
      }
      if (accepted.length) {
        const humanized = await humanizeFinalTextTitles(acceptedForHumanizer, input, context);
        if (humanized.usage) usage = usage ? mergeAiUsage(usage, humanized.usage) : humanized.usage;
        return {
          candidates: humanized.candidates,
          warnings: [
            `标题终审（${TITLE_FINAL_EDITOR_PROMPT_VERSION}）：${attempt === 1 ? '首轮' : '技术返写'}返回${accepted.length}组可选终稿，保持LLM原始顺序，程序未改字`,
            ...(lastRejected.length ? [`另有${lastRejected.length}组因客观硬错误被丢弃，未触发整批返写`] : []),
            ...(skippedDuplicateReasons ? [`另有${skippedDuplicateReasons}组与前项具体clickReason完全重复，未进入用户候选`] : []),
            ...humanized.warnings,
          ],
          usage,
        };
      }
      lastError = rawCandidates.length ? '本批候选全部未通过客观技术验收' : '返回缺少candidates数组或数组为空';
    } catch (error) {
      lastError = error instanceof Error ? error.message : '标题终审调用失败';
      lastRejected = [];
    }
  }
  return {
    candidates: [],
    warnings: [`标题终审（${TITLE_FINAL_EDITOR_PROMPT_VERSION}）：首轮与一次技术返写均为0组可用，保留上游候选转人工复核（${lastError || '客观技术验收未通过'}）${lastRejected.length ? `；末次拒收=${JSON.stringify(lastRejected)}` : ''}`],
    usage,
  };
}

/**
 * v7 后的窄口径 social-voice 节点。模型只能返回 id + textTitle；clickReason、封面、
 * 副题和事实边界都冻结。单条改写未通过客观验收就回退该条 v7 原文，不影响同批其他项。
 */
async function humanizeFinalTextTitles(
  candidates: FinalTextHumanizerInput[],
  input: TitleStageInput,
  context: FinalTitleContext,
): Promise<{
  candidates: TitlePair[];
  warnings: string[];
  usage: AiUsageSummary | undefined;
  audit: Array<{ id: string; original: string; proposed: string; adopted: boolean; failures: string[] }>;
}> {
  const pairs = getTitleHumanizerPairs(
    input.topic.productId,
    [input.topic.topic, input.topic.painOrDesire, input.topic.promise, ...candidates.map(item => item.clickReason)].join(' '),
    3,
  );
  if (!pairs.length) {
    return {
      candidates: candidates.map(item => item.pair),
      warnings: [`文字标题活人化（${TITLE_TEXT_HUMANIZER_PROMPT_VERSION}）：无用户认可前后对照样本，保持v7原文`],
      usage: undefined,
      audit: [],
    };
  }
  const preferredSearchPhrases = preferredTextTitleSearchPhrases(input);
  const payload = {
    task: '只降低textTitle的内容编辑腔，让同一句已经成立的话更像真实小红书发布者自然说出来；已经自然时原样返回',
    immutable_contract: {
      click_reason: '不许改变、替换或扩展',
      cover_title: '不许改，也不要在输出中返回',
      cover_subtitle: '不许改，也不要在输出中返回',
      facts_and_claims: '不得新增数字、结果、个人经历、焦虑、后悔或正文没有的效果',
    },
    approved_before_after_pairs: pairs.map(formatTitleHumanizerPair),
    preferred_identity_keywords: input.topic.productId === 'delf_b2_writing'
      ? ['B2写作', 'B2作文', 'DELF B2写作']
      : [input.topic.seo.primary, ...input.topic.seo.related].filter(Boolean).slice(0, 4),
    preferred_topic_search_phrases: preferredSearchPhrases,
    supported_context: finalClickReasonEvidence(input),
    candidates: candidates.map((item, index) => ({
      id: `c${index + 1}`,
      clickReason: item.clickReason,
      clickReasonType: item.clickReasonType,
      originalTextTitle: item.pair.textTitle,
      frozenCoverTitle: item.pair.coverTitle,
      frozenCoverSubtitle: item.pair.coverSubtitle,
    })),
  };
  try {
    const result = await callOpenAICompatibleJsonWithUsage<FinalTextHumanizerResponse>([
      {
        role: 'system',
        content: [
          '你是一个极窄的textTitle口语化编辑，不是标题策划，也不是爆款生成器。v7已经把内容理由、封面资产和事实想对了；你只负责降低发布者与内容编辑之间的语言距离。',
          '输出前逐条在内部做二选一：KEEP（原样返回）或REWRITE（明显降低编辑腔）。不要输出这个判断。没有可感知收益就必须KEEP，不能为了显示做过工作而改字。',
          '逐条判断originalTextTitle是否有明显内容编辑腔；有就改成真实备考者或真实分享者自然会发的说法，已经自然就原样返回。目标是同一个意思说得更像人，不得增强、削弱或删除原来由clickReason支撑的情绪强度。不要只判断语法是否通顺，要判断一个不做内容运营的真实备考者会不会主动这样发。',
          'approved_before_after_pairs里的editor_voice是需要降低的编辑腔，不是合格基准。原标题若明显接近其中的压缩结论、≠符号、冒号提炼或老师式方法总结，不得仅因信息正确就原样保留；应学习对应human_voice如何把同一理由还原成真实说话。',
          'originalTextTitle出现“≠”或用冒号把观点压成编辑摘要时，必须改成能直接念出口的自然说法，不得原样返回符号公式或栏目式提炼。',
          'clickReason、frozenCoverTitle、frozenCoverSubtitle和supported_context全部是冻结边界。不得改变因果、增加新问题、效果、经历、数字或承诺；不得重新命名封面，也不得输出封面字段。',
          '真人感可以来自自然词序、轻微不工整、真实停顿、直接对用户说话、轻吐槽、后知后觉或一点废话；不要求使用强情绪词，也不要机械添加“服了、谁懂啊、救命、为什么没人早点告诉我”。',
          '改写必须带来可感知的发布口吻变化。禁止只增加或替换“是、先、上、急着、怎么”等一两个虚词来伪装改写；例如“新题到手，先别抄范文→新题到手，先别急着抄范文”和“三步把范文用到新题→三步把范文用到新题上”都属于无效改写，必须返回原文。',
          '在不损害口语、点击理由和20字上限的前提下，优先让textTitle自然带上preferred_identity_keywords中的一个身份词。可以把泛称“作文/写作”自然改成“B2作文/B2写作”，也可以保留原文已有身份；不要叠加多个关键词，不要写成搜索词串。',
          'preferred_topic_search_phrases来自小红书真实相关搜索词，并已按本篇正文筛选。只有与当前clickReason直接相关时才可自然使用其中一个；不要为了命中搜索词把标题改回“资料目录”，也不得使用没有出现在该数组里的联想词扩写选题。',
          '关键词是软目标，不是硬任务：如果加入后显得生硬、重复、超长，或会挤掉真正有感觉的表达，就宁可不加并保留自然标题。不要把“DELF B2”压成影响阅读的“DELFB2”。',
          'textTitle不超过20个可见字，必须是完整自然的话。少量标点或emoji可以保留或使用，但不能靠口头禅和emoji伪装真人感。',
          '每个输入id必须返回且只能返回一次。只返回JSON：{"candidates":[{"id":"c1","textTitle":"..."}]}，不要解释，不要返回clickReason、coverTitle或coverSubtitle。',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ], {
      maxTokens: 220 + candidates.length * 100,
      temperature: 0.65,
      retries: 1,
    });
    const rows = Array.isArray(result.data.candidates) ? result.data.candidates : [];
    const byId = new Map<string, string>();
    for (const row of rows) {
      if (typeof row.id !== 'string' || typeof row.textTitle !== 'string' || byId.has(row.id)) continue;
      byId.set(row.id, row.textTitle);
    }
    const seen = new Set<string>();
    const originalFingerprints = candidates.map(item => fingerprintTitle(item.pair.textTitle));
    let changed = 0;
    const rollbacks: string[] = [];
    const audit: Array<{ id: string; original: string; proposed: string; adopted: boolean; failures: string[] }> = [];
    const finalized = candidates.map((item, index) => {
      const id = `c${index + 1}`;
      const rewritten = byId.get(id);
      if (!rewritten || !rewritten.trim()) {
        seen.add(fingerprintTitle(item.pair.textTitle));
        rollbacks.push(`${id}缺少有效textTitle`);
        audit.push({ id, original: item.pair.textTitle, proposed: '', adopted: false, failures: ['缺少有效textTitle'] });
        return item.pair;
      }
      const candidate = { ...item.pair, textTitle: rewritten };
      const failures = finalTitleValidationFailures(candidate, input, context);
      const fingerprint = fingerprintTitle(rewritten);
      if (seen.has(fingerprint)) failures.push('与本批另一条文字标题完全重复');
      if (originalFingerprints.some((original, otherIndex) => otherIndex !== index && original === fingerprint)) {
        failures.push('与本批另一条v7原文字标题完全重复');
      }
      if (failures.length) {
        seen.add(fingerprintTitle(item.pair.textTitle));
        rollbacks.push(`${id}${failures.join('、')}`);
        audit.push({ id, original: item.pair.textTitle, proposed: rewritten, adopted: false, failures: failures.slice() });
        return item.pair;
      }
      seen.add(fingerprint);
      if (rewritten !== item.pair.textTitle) changed += 1;
      audit.push({ id, original: item.pair.textTitle, proposed: rewritten, adopted: true, failures: [] });
      return candidate;
    });
    return {
      candidates: finalized,
      warnings: [`文字标题活人化（${TITLE_TEXT_HUMANIZER_PROMPT_VERSION}）：1次窄口径调用，${changed}/${candidates.length}条采用改写${rollbacks.length ? `；${rollbacks.join('；')}，已逐条回退v7原文` : ''}`],
      usage: result.usage,
      audit,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 240) : '未知错误';
    return {
      candidates: candidates.map(item => item.pair),
      warnings: [`文字标题活人化（${TITLE_TEXT_HUMANIZER_PROMPT_VERSION}）：调用失败，整批保持v7原文（${reason}）`],
      usage: undefined,
      audit: [],
    };
  }
}

function preferredTextTitleSearchPhrases(input: TitleStageInput): string[] {
  if (input.topic.productId !== 'delf_b2_writing') return [];
  const cues = [
    input.topic.topic,
    input.topic.contentAngle,
    input.topic.promise,
    input.topic.painOrDesire,
    ...input.content.coverBlocks.flatMap(block => [
      block.heading || '',
      ...block.items.flatMap(item => [item.primary, item.secondary || '']),
    ]),
  ].join(' ');
  return getDelfB2RelatedSearchPhrases(cues).slice(0, 5);
}

export async function humanizeFinalTextTitlesForTest(
  candidates: FinalTextHumanizerInput[],
  input: TitleStageInput,
) {
  return humanizeFinalTextTitles(candidates, input, {
    coverRange: getCoverTemplateSpec(input.capability.renderer)?.titleLengthRange || [8, 18],
    requestedCount: candidates.length,
    selected: new Set(),
    coverTitles: new Set(),
  });
}

function finalTitlePairFromResponse(raw: FinalTitleCandidateResponse | undefined, input: TitleStageInput): TitlePair | undefined {
  // 保留 LLM 原始字符；连空白也不由程序“顺手修掉”。客观格式问题交给验收失败后返写。
  const textTitle = typeof raw?.textTitle === 'string' ? raw.textTitle : '';
  const coverTitle = typeof raw?.coverTitle === 'string' ? raw.coverTitle : '';
  const coverSubtitle = typeof raw?.coverSubtitle === 'string' ? raw.coverSubtitle : '';
  if (!textTitle.trim() || !coverTitle.trim() || !coverSubtitle.trim()) return undefined;
  return {
    textTitle,
    coverTitle,
    coverSubtitle,
    mechanism: finalEditorDirection(raw || {}),
    userRelation: input.topic.painOrDesire,
    seoKeyword: input.topic.seo.primary,
    noveltyFingerprint: stableHash(`${textTitle}|${coverTitle}`),
  };
}

function finalTitleValidationFailures(
  pair: TitlePair,
  input: TitleStageInput,
  context: FinalTitleContext,
): string[] {
  const failures: string[] = [];
  const textLength = countVisibleUnits(pair.textTitle);
  const coverLength = countVisibleUnits(pair.coverTitle);
  const subtitleLength = countVisibleUnits(pair.coverSubtitle || '');
  if (textLength > 20) failures.push(`textTitle实际${textLength}字，超过20字物理上限`);
  if (coverLength > context.coverRange[1]) failures.push(`coverTitle实际${coverLength}字，超过当前模板${context.coverRange[1]}字物理上限`);
  if (subtitleLength > 24) failures.push(`coverSubtitle实际${subtitleLength}字，超过24字物理上限`);
  if (!hasRequiredProductIdentity(input.topic.productId, pair.coverTitle)) {
    failures.push('coverTitle本身缺少考试或科目身份；小红书信息流里副题可能看不清，不能把身份只放在副题或文字标题');
  }
  if (hasForbiddenProductIdentity(input.topic.productId, `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`)) failures.push('混入了其他考试或商品身份');
  if (titleNodeRequiresSeo(input) && !hasTitleSeoAnchor(pair.textTitle)) failures.push('文字标题缺少自然SEO搜索锚点');
  if (hasDanglingTitleTail(pair.textTitle) || hasDanglingTitleTail(pair.coverTitle)
    || hasIncompletePhraseTail(pair.textTitle) || hasIncompletePhraseTail(pair.coverTitle)
    || hasIncompletePhraseTail(pair.coverSubtitle || '')
    || hasCutFragmentTail(pair.textTitle) || hasCutFragmentTail(pair.coverTitle)
    || hasCutFragmentTail(pair.coverSubtitle || '')) failures.push('字段以残词、虚词或被切半的短语收尾');
  if (/[：:，、]$/u.test(pair.textTitle) || /[：:，、]$/u.test(pair.coverTitle)
    || /[：:，、]$/u.test(pair.coverSubtitle || '')) failures.push('字段以冒号、逗号或顿号收尾');
  if (context.selected.has(fingerprintTitle(pair.textTitle))) failures.push('与近期已选文字标题重复');
  if (context.coverTitles.has(fingerprintTitle(pair.coverTitle))) failures.push('与近期已选封面标题重复');
  return failures;
}

function titleNodeRequiresSeo(input: TitleStageInput): boolean {
  return input.topic.productId === 'delf_b2_writing'
    || input.topic.productId === 'tef_tcf_canada'
    || input.topic.productId === 'tcf_canada_writing_7day';
}

function unsupportedTitleNumberWarnings(candidates: TitlePair[], input: TitleStageInput): string[] {
  return candidates
    .filter(pair => !finalTitleExplicitNumbersSupported(pair, input))
    .map(pair => `标题含正文未明确支撑的数字或数量表达，保留候选但请人工核验：「${pair.textTitle}」/「${pair.coverTitle}」`);
}

function finalTitleExplicitNumbersSupported(pair: TitlePair, input: TitleStageInput): boolean {
  return [pair.textTitle, pair.coverTitle, pair.coverSubtitle || '']
    .every(value => titleFieldExplicitNumbersSupported(value, input));
}

function titleFieldExplicitNumbersSupported(value: string, input: TitleStageInput): boolean {
  const allowed = new Set(contentNumbers(input));
  const text = value
    .replace(/DELF\s*B2|B2|TEF|TCF|CLB\s*7|2026/gi, '')
    // 指代某个步骤，不是在声明“共有1步”；不要送进中文数量归一化。
    .replace(/(?:这|那|哪|上|下)一步/g, '');
  const normalized = titleNumberGateConsensusActive(input) ? normalizeCnNumeralsBeforeUnit(text) : text;
  return (normalized.match(/\d+(?:\.\d+)?/g) || []).every(token => allowed.has(token));
}

// textTitle 必须至少保留一个真实搜索锚点（商品1写作域）；改写丢失即整槽回退。
const TITLE_SEO_ANCHOR_PATTERNS: RegExp[] = [
  /DELF\s*B2\s*写作/iu,
  /DELF\s*B2/iu,
  /法语\s*B2\s*写作/iu,
  /B2\s*写作/iu,
  /B2\s*作文/iu,
  /(?<![A-Za-z])B2(?![A-Za-z])/iu,
  /DELF\s*写作/iu,
  /TEF(?:\s*\/\s*TCF)?(?:\s*Canada)?/iu,
  /TEF(?:\s*\/\s*TCF)?(?:\s*Canada)?\s*(?:写作|作文)/iu,
  /TCF(?:\s*Canada)?\s*(?:写作|作文)/iu,
];

export function hasTitleSeoAnchor(value: string): boolean {
  return TITLE_SEO_ANCHOR_PATTERNS.some(pattern => pattern.test(value));
}

export type HumanizeRewrite = { index?: number | string; textTitle?: string; coverTitle?: string; coverSubtitle?: string };

/**
 * 单槽改写验收链：空槽 → 照抄（对全部30条样本）→ SEO锚点丢失 → 生产同款归一化
 * 模拟（不截断封面）→ 完整硬闸门（营销口径放宽）。任何一环失败整槽回退原候选。
 * 副标题例外：模型漏返回（或空串）时沿用原候选副标题，不允许把已有副标题抹掉。
 */
export function evaluateHumanizedSlot(
  original: TitlePair,
  rewritten: HumanizeRewrite,
  input: TitleStageInput,
  context: { selected: Set<string>; coverTitles: Set<string>; styleReferences: TitleStyleReference[] },
): { pair: TitlePair; kept: boolean; rollbackReason?: string } {
  const textTitle = String(rewritten.textTitle ?? '').trim();
  const coverTitle = String(rewritten.coverTitle ?? '').trim();
  const coverSubtitle = (typeof rewritten.coverSubtitle === 'string' ? rewritten.coverSubtitle.trim() : '') || original.coverSubtitle || '';
  if (!textTitle || !coverTitle) return { pair: original, kept: false, rollbackReason: '改写返回空槽' };
  if (findStylePlagiarism(`${textTitle} ${coverTitle} ${coverSubtitle}`, context.styleReferences).length) {
    return { pair: original, kept: false, rollbackReason: '改写后与用户认可样本雷同' };
  }
  if (!hasTitleSeoAnchor(textTitle)) return { pair: original, kept: false, rollbackReason: '改写丢失SEO搜索锚点' };
  const normalized = normalizePairForInput({ ...original, textTitle, coverTitle, coverSubtitle }, input, { coverTruncate: false, consensusActive: true });
  if (!passesHardGates(normalized, input, context.selected, context.coverTitles, false, true, true)) {
    return { pair: original, kept: false, rollbackReason: '改写后未过完整硬闸门' };
  }
  return { pair: normalized, kept: true };
}

/**
 * 人话改写节点（v2-title-humanize-4，仅共识路径调用）：对最终 shortlist 整批只调
 * 一次 LLM，三件套同时改写，逐槽验收失败回退原候选；调用异常整批保留原候选。
 * 30条用户认可样本作风格参考（全部进prompt并作照抄比对）；样本缺失时不
 * 跳过，改用通用人话规则并记 warning。
 */
async function humanizeTitleCandidates(
  candidates: TitlePair[],
  input: TitleStageInput,
  context: { coverRange: number[]; selected: Set<string>; coverTitles: Set<string> },
): Promise<{ candidates: TitlePair[]; warnings: string[]; usage: AiUsageSummary | undefined }> {
  const warnings: string[] = [];
  const productIdentity = examScopeContext(input.topic.productId, input.topic.examScope)?.displayIdentity
    || getProductPromptProfile(input.topic.productId).noteIdentity;
  const styleReferences = getTitleStyleReferences(input.topic.productId, 30);
  const hasSamples = styleReferences.length > 0;
  const payload = {
    task: '根据事实和用户认可样本，重新创作更像小红书的标题三件套：保留原选题、目标用户、核心事实和承诺范围，但不要继承原标题的句式；原标题只作为事实边界参考，不是润色底稿',
    topic: input.topic.topic,
    promise: input.topic.promise,
    cover_blocks: input.content.coverBlocks.slice(0, 6).map(block => ({ heading: block.heading, items: block.items.slice(0, 4).map(item => item.primary) })),
    ...(hasSamples ? { style_references: styleReferences.map(formatStyleReferenceForPrompt) } : {}),
    // 不把旧标题送进创作节点：旧标题已经带有被用户拒收的目录腔/模板腔，
    // 这里只传每个槽位需要覆盖的方向和事实锚点，让模型重新找表达角度。
    candidates: candidates.map((pair, index) => ({
      index,
      direction: pair.mechanism,
      user_relation: pair.userRelation,
      seo_keyword: pair.seoKeyword || input.topic.seo.primary,
      source_angle: pair.noveltyFingerprint,
    })),
  };
  const styleLines = hasSamples ? [
    '你是擅长教育/知识类内容的小红书标题口语化改写编辑与终审编辑。style_references 是用户逐条认可过的真实标题样本（括号内为风格标签），它们是本次改写最重要的风格依据：学习其中“像真人在说话”的感觉、口语节奏、情绪力度、叙述视角和点击理由。',
    '改写前先在内部判断：原标题讲什么，目标用户正在遇到什么问题，用户可能误以为什么，哪个角度最容易让人产生“这不就是我”或“原来如此”的反应。不要输出分析，只输出JSON。',
    '这不是同义词润色任务：原标题不会作为底稿提供，只作为事实边界参考；请根据 topic、promise、cover_blocks 和每个槽位的方向重新创作，允许重排句式和改变叙述视角，但不得改变原选题、事实、数字或承诺范围。',
    '允许从“作者要讲的知识”改成“用户正在经历的问题”，也允许使用被说中、认知反差、问题意识、真实情绪、个人动作或明确收益中的一种或两种；不要为了套公式强行加入情绪。',
    '每组三件套至少要有一个清晰的点击理由：具体痛点/场景、一个真实反差、作者亲身动作，或看完能立刻使用的收益；如果原标题只是知识名词，也要把它翻译成用户会遇到的问题，不能只换成“详解、清单、整理、攻略”。',
    '标题要像真正了解备考者的人说出来的话：可以自然使用“我、你、怎么、为什么、其实、别再”等口语表达，也可以有克制的惊讶、后悔或反常识，但不能写成营销号、资料目录或课程广告。',
    '不要机械复制样本中的固定句式，不要批量套“别急着、先、这才是、X步、X个”等模板；样本用于学习感觉，不用于拼装公式。',
    '禁止照抄样本原句或其中任何连续片段；改写结果必须与全部样本保持可核查的距离。',
  ] : [
    '你是小红书标题口语化改写编辑。本次没有风格样本：改用通用人话规则——把书面腔、编辑腔改成备考者真会说的话；短句、口语词序、可以带情绪但不夸张；禁用「资料太散、卡住、拖后腿」等机器表达。',
  ];
  try {
    const result = await callOpenAICompatibleJsonWithUsage<{ candidates?: HumanizeRewrite[] }>([
      {
        role: 'system',
        content: [
          ...styleLines,
          `textTitle、coverTitle、coverSubtitle 三件套必须同时改写并保持同一主张：textTitle 保持12到20个可见字，且至少保留一个与本篇考试身份自然一致的搜索锚点（${productIdentity}或本篇已给出的相关词）。textTitle 优先讲用户的问题、场景或错误认知，而不是罗列资料有什么。`,
          '改写结果必须以完整词、完整短语或完整句子收尾：不得在「评分维度」「写作思路」这类多字词中间断开；为压字数写出「评分维」「写作思」这类半截词直接不合格，应换成更短的完整表达。',
          `coverTitle 保持${context.coverRange[0]}到${context.coverRange[1]}个可见字并保留${productIdentity}身份；它要同时让人看懂“这篇在解决什么问题/提供什么具体内容”，并带出自然的点击理由，不能只写关键词加功能名。coverSubtitle 用一句话补充具体做法、对象或收益，不重复 coverTitle，也不单独发明新卖点。`,
          '承诺范围、事实、数字一律沿用 topic、promise 和 cover_blocks，不得新增、放大或引入正文没有的维度；营销表达（如90%、两周速成）只有原内容确实支持时才允许保留，不要为了像爆款主动添加。',
          '返回JSON对象，顶层字段candidates；每项严格为{index,textTitle,coverTitle,coverSubtitle}，index对应输入候选，逐项都要返回，不得遗漏。',
        ].join('\n'),
      },
      { role: 'user', content: JSON.stringify(payload) },
    ], { maxTokens: 1200, temperature: 0.75, retries: 1 });
    const rows = Array.isArray(result.data.candidates) ? result.data.candidates : [];
    const rewritesByIndex = new Map<number, HumanizeRewrite>();
    rows.forEach((row, position) => {
      const rawIndex = Number(row.index);
      const index = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < candidates.length && !rewritesByIndex.has(rawIndex)
        ? rawIndex
        : position < candidates.length && !rewritesByIndex.has(position)
          ? position
          : -1;
      if (index >= 0) rewritesByIndex.set(index, row);
    });
    // 防改写互相撞款：历史占用 + 其他槽位原候选指纹 + 已保留改写共同构成 seen 集合；
    // 自身原候选除外——改写结果恰好等于原候选是无害空改，不判撞款。
    const seenKeptText = new Set<string>();
    const seenKeptCover = new Set<string>();
    const rollbacks: string[] = [];
    let kept = 0;
    const finalized = candidates.map((pair, index) => {
      const rewrite = rewritesByIndex.get(index);
      if (!rewrite) return pair;
      const selected = new Set([
        ...context.selected,
        ...seenKeptText,
        ...candidates.filter((_, other) => other !== index).map(other => fingerprintTitle(other.textTitle)),
      ]);
      const coverTitles = new Set([
        ...context.coverTitles,
        ...seenKeptCover,
        ...candidates.filter((_, other) => other !== index).map(other => fingerprintTitle(other.coverTitle)),
      ]);
      const verdict = evaluateHumanizedSlot(pair, rewrite, input, { selected, coverTitles, styleReferences });
      if (!verdict.kept) {
        rollbacks.push(`第${index + 1}组回退（${verdict.rollbackReason}）`);
        return pair;
      }
      kept += 1;
      seenKeptText.add(fingerprintTitle(verdict.pair.textTitle));
      seenKeptCover.add(fingerprintTitle(verdict.pair.coverTitle));
      return verdict.pair;
    });
    warnings.push(`标题人话改写（${TITLE_HUMANIZE_PROMPT_VERSION}）：1次LLM调用，${kept}/${candidates.length}槽保留改写${hasSamples ? '' : '（无用户认可风格样本，改用通用人话规则）'}${rollbacks.length ? `；${rollbacks.join('、')}` : ''}`);
    return { candidates: finalized, warnings, usage: result.usage };
  } catch {
    warnings.push(`标题人话改写（${TITLE_HUMANIZE_PROMPT_VERSION}）：改写调用失败，整批保留原候选（0槽改写）`);
    return { candidates, warnings, usage: undefined };
  }
}

/**
 * 营销表达警告（仅共识路径）：最终标题里出现正文数字来源不支持的强承诺表达
 * （90%、12分➡️18分、两周速成）时，按营销口径放行但记人工复核——这些表达在
 * 硬闸门里走 relaxMarketing 剥离，不淘汰；legacy 路径没有放宽，也不产生该警告。
 */
function strongPromiseRelaxWarnings(candidates: TitlePair[], consensusActive: boolean, input: TitleStageInput): string[] {
  if (!consensusActive) return [];
  const allowed = new Set(contentNumbers(input));
  const warnings: string[] = [];
  for (const pair of candidates) {
    const text = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`.replace(/DELF\s*B2|B2|TEF|TCF|CLB\s*7|2026/gi, '');
    const hits = unsupportedMarketingPromises(text, allowed);
    if (hits.length) warnings.push(`「${pair.textTitle}」含正文未支持的强承诺表达（${hits.join('、')}），按营销口径放行，请人工复核`);
  }
  return warnings;
}

function contentSupports(pair: TitlePair, input: TitleStageInput) {
  const content = [input.topic.topic, input.topic.promise, input.content.captionParts.opening, ...input.content.captionParts.value, ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || ''])])].join('');
  const titleTokens = semanticBigrams(`${pair.textTitle}${pair.coverTitle}`);
  const contentTokens = semanticBigrams(content);
  let hit = 0;
  for (const token of titleTokens) if (contentTokens.has(token)) hit += 1;
  return hit >= 2;
}

function contentNumbers(input: TitleStageInput) {
  const text = [
    input.topic.topic,
    input.topic.promise,
    ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...input.content.innerPages.flatMap(page => [page.page_title, page.lead, ...page.bullets]),
    input.content.captionParts.opening,
    ...input.content.captionParts.value,
  ].join(' ');
  const normalized = titleNumberGateConsensusActive(input) ? normalizeCnNumeralsBeforeUnit(text) : text;
  return Array.from(new Set(normalized.match(/\d+(?:\.\d+)?/g) || [])).filter(token => token !== '2');
}

/**
 * 中文数字归一化（阶段F修复3）：数字来源闸门两侧共用。
 * 实测（batch_1787325885084 / job_002 首跑 4 组标题全灭）：内容写「三分钟」、
 * 标题写「3分钟」，抽取只认 /\d+/ 判为正文没有的数字。这里把**紧跟量词单位**
 * 的中文数字（三分钟、十一步、二十篇、两遍…）归一成阿拉伯数字，两侧口径一致；
 * 闸门语义不变——正文真没有的数字仍然拦截。
 * 只归一「数字+单位」组合：全文单字替换会把「一般」这类词误变数字制造假拦截；
 * 单位表不含独立的「分」，避免「十分有用」被改成「10分有用」。
 * 「一步步」这类「一+单位」短语仍会被归一；两侧用同一函数、正文同步变化，常见场景对称不误拦。
 * 仅完整 Title Skill 路径启用，showcase 仍保留原展示链。
 */
const CN_NUMERAL_MAP: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_NUMERAL_UNIT_PATTERN = '分钟|小时|秒|步|项|点|类|组|份|篇|条|题|词|天|个|页|张|遍|次|轮|套|维|周|月|年';

function cnNumeralValue(text: string): number | null {
  const combo = /^([零一两二三四五六七八九])?十([零一两二三四五六七八九])?$/u.exec(text);
  if (combo) {
    const tens = combo[1] ? CN_NUMERAL_MAP[combo[1]!] : 1;
    const ones = combo[2] ? CN_NUMERAL_MAP[combo[2]!] : 0;
    return tens * 10 + ones;
  }
  if (text.length === 1 && CN_NUMERAL_MAP[text] !== undefined) return CN_NUMERAL_MAP[text]!;
  return null;
}

export function normalizeCnNumeralsBeforeUnit(value: string): string {
  return value.replace(new RegExp(`[零一二两三四五六七八九十]+(?=(?:${CN_NUMERAL_UNIT_PATTERN}))`, 'gu'), (match, offset: number, whole: string) => {
    // 「几十词」「数百题」是不定概数：归一成具体数字会凭空造出正文没有的数量（gates 实测「总差几十词」被误拦）。
    const preceding = offset > 0 ? whole[offset - 1]! : '';
    if (preceding === '几' || preceding === '数') return match;
    const parsed = cnNumeralValue(match);
    return parsed === null ? match : String(parsed);
  });
}

function titleNumberGateConsensusActive(input: TitleStageInput): boolean {
  return resolveTitleConsensusActive(input.topic.productId, isTitleProductShowcase(input.topic, input.noteMode));
}

// 强承诺营销表达（用户 2026-08-22 口径，仅共识路径放宽 + 人工复核警告）：
// 百分比钩子（90%）、分数变化（12分➡️18分/从12分到18分）、速成时间承诺（两周速成）。
// 事实性数字（3步/36项/50篇/20词/x分钟这类内容结构声称）不在此列，仍走数字来源闸门。
const MARKETING_PROMISE_PATTERNS: RegExp[] = [
  /\d+\s*分\s*(?:➡️|➡|→|到|变到|提到|涨到|提至|升至)\s*\d+\s*分/,
  /\d+(?:\.\d+)?\s*%/,
  /(?:\d+|[零一两二三四五六七八九十]{1,3})\s*(?:周|天|个?月)\s*(?:速成|提分|逆袭|冲刺|突破|上岸)/,
];

function stripMarketingPromises(value: string): string {
  let text = value;
  for (const pattern of MARKETING_PROMISE_PATTERNS) {
    text = text.replace(new RegExp(pattern.source, 'g'), ' ');
  }
  return text;
}

function unsupportedMarketingPromises(text: string, allowed: Set<string>): string[] {
  const hits: string[] = [];
  for (const pattern of MARKETING_PROMISE_PATTERNS) {
    for (const match of text.match(new RegExp(pattern.source, 'g')) || []) {
      const digits = match.match(/\d+(?:\.\d+)?/g) || [];
      if (digits.length === 0) {
        if (/[零一两二三四五六七八九十]/.test(match)) hits.push(match);
        continue;
      }
      if (!digits.every(token => allowed.has(token))) hits.push(match);
    }
  }
  return hits;
}

function titleNumbersSupported(pair: TitlePair, input: TitleStageInput, relaxMarketing = false) {
  const allowed = new Set(contentNumbers(input));
  const consensusActive = titleNumberGateConsensusActive(input);
  let text = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`
    .replace(/DELF\s*B2|B2|TEF|TCF|CLB\s*7|2026/gi, '');
  if (relaxMarketing) text = stripMarketingPromises(text);
  const normalizedText = consensusActive ? normalizeCnNumeralsBeforeUnit(text) : text;
  if (!(normalizedText.match(/\d+(?:\.\d+)?/g) || []).every(token => allowed.has(token))) return false;
  const claims = quantityClaims(normalizedText);
  if (!claims.length) return true;
  const majorContent = [
    input.topic.topic,
    input.topic.promise,
    input.topic.contentAngle,
    ...input.content.coverBlocks.flatMap(block => [
      block.heading || '',
      `${block.items.length}项`,
      ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || '']),
    ]),
  ].join(' ');
  const normalizedMajor = consensusActive ? normalizeCnNumeralsBeforeUnit(majorContent) : majorContent;
  const supportedClaims = new Set(quantityClaims(normalizedMajor));
  return claims.every(claim => supportedClaims.has(claim));
}

function quantityClaims(value: string) {
  const claims = value.match(/\d+(?:\.\d+)?\s*(?:个)?(?:步|项|点|类|组|份|篇|条|题|词|天|分钟|小时|维度|维)/g) || [];
  return Array.from(new Set(claims.map(item => item.replace(/\s|个/g, '').replace(/维度$/u, '维'))));
}

function numericTransformationSupported(pair: TitlePair, input: TitleStageInput) {
  const text = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const match = /从\s*(\d+)\s*词?.{0,6}(?:到|扩到|写到)\s*(\d+)\s*词?/i.exec(text);
  if (!match) return true;
  const target = Number(match[2]);
  return input.content.innerPages.some(page => countFrenchWords([page.lead, ...page.bullets].join(' ')) >= target);
}

function countFrenchWords(value: string) {
  return (value.match(/[A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+(?:['’\-][A-Za-zÀ-ÖØ-öø-ÿŒœÇç]+)*/g) || []).length;
}

function userRelationVisible(title: string, topic: TopicOption) {
  const relationText = `${topic.audienceState}${topic.scene}${topic.painOrDesire}`;
  if (topic.productId === 'tef_tcf_canada' && /选考|选错|选哪|怎么选|报名|纠结|不确定/.test(relationText)) {
    return /报名前|准备报名|要报名|选考|怕选错|别选错|选错|纠结|怎么选|选哪|还是|先别报名|别急着报名/.test(title);
  }
  const titleTokens = semanticBigrams(title);
  const relationTokens = semanticBigrams(relationText);
  for (const token of titleTokens) if (relationTokens.has(token)) return true;
  return /考前|备考|写不好|不会写|不会检查|写完没底|没把握|心里没底|总丢分|想提分|要考试|上班族|零基础|冲刺|刚开始|来不及|选考|怎么选|选哪个|怕选错|别选错|不确定|纠结|先看目标项目|选对|短板|练了没提高|练了没进步|只数语法|别数语法/.test(title);
}

function coverHasClickReason(title: string, input: TitleStageInput) {
  const utility = /大全|清单|速查|必查|整理好|对照|一页|全套|稀缺|考前|报名前|备考|自查|避坑|少走弯路|先看|看清/;
  const tension = /选错|丢分|低分|没提高|没进步|白练|白背|白准备|浪费|重来|来不及|别急|先别|最怕|致命|反常识|竟然|原来|救急|冲刺|没把握|没底|心里没底|练了很多|别数语法/;
  const outcome = /提分|高分|写出来|会展开|看懂|搞懂|找短板|短板|定方向|选对|用得上/;
  void input;
  return tension.test(title) || outcome.test(title) || utility.test(title);
}

function textHasConcretePayoff(title: string) {
  return /自查|检查|清单|评分|短板|扣分|差异|题型|目标项目|一张表|字数|\d+层|选择|路线|计划|步骤|方法|范文|模板|句型|词汇|语法|连接词|资料|大全|速查|错误|写完|报名前|选对|定位|找到|看懂|写够|提分|高分/.test(title);
}

function classifyTitleMechanism(pair: TitlePair): TitleMechanism {
  const declared = pair.mechanism.toLowerCase();
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  if (/cognitive_conflict|反常识|认知冲突|争议|挑战/.test(declared)) return 'cognitive_conflict';
  if (/loss_tension|恐惧|损失|风险|避坑|警告/.test(declared)) return 'loss_tension';
  if (/result_gain|结果|收益|行动|获得感/.test(declared)) return 'result_gain';
  if (/search_utility|搜索|资料|清单|大全|稀缺|时效/.test(declared)) return 'search_utility';
  if (/原来|竟然|反而|越.+越|不是.+而是|别再|误区|真相/.test(title)) return 'cognitive_conflict';
  if (/选错|丢分|白练|白背|浪费|来不及|后悔|最怕|致命|千万别/.test(title)) return 'loss_tension';
  if (/提分|高分|写出来|会展开|选对|省时间|少走弯路|搞懂|看懂/.test(title)) return 'result_gain';
  return 'search_utility';
}

function preferredTitleMechanisms(input: TitleStageInput) {
  const preferred = new Set<TitleMechanism>();
  for (const value of input.capability.allowedTitleMechanisms) {
    if (/资料|大全|稀缺|时效/.test(value)) preferred.add('search_utility');
    if (/情绪/.test(value)) preferred.add('loss_tension');
    if (/反常识/.test(value)) preferred.add('cognitive_conflict');
    if (/结果/.test(value)) preferred.add('result_gain');
  }
  return preferred;
}

function titleMotifs(value: string) {
  const motifs = new Set<string>();
  const groups: Array<[string, RegExp]> = [
    ['uncertainty', /没底|没把握|心里没底|不知道好坏/],
    ['weakness', /短板|弱项|最弱|定位/],
    ['self_check', /自查|检查|核对|查漏/],
    ['wasted_effort', /白练|白背|没进步|没提高|练了很多/],
    ['deadline', /考前|冲刺|来不及|最后\d+天|最后\d+分钟/],
    ['choice_anxiety', /选错|纠结|怎么选|选哪个|报名前/],
    ['material_gain', /资料|大全|清单|速查|整理好|一张表/],
    ['score_loss', /丢分|扣分|低分|分数上不去/],
  ];
  for (const [name, pattern] of groups) if (pattern.test(value)) motifs.add(name);
  return motifs;
}

function recentTitlePenalty(pair: TitlePair, records: Array<{ title: string; cover_title: string }>, classifier: TitleCategoryFn = classifyTitleMechanism) {
  const recent = records.slice(-16);
  const candidateMotifs = titleMotifs(`${pair.textTitle} ${pair.coverTitle}`);
  const mechanism = classifier(pair);
  let motifHits = 0;
  let mechanismHits = 0;
  for (const record of recent) {
    const prior = `${record.title || ''} ${record.cover_title || ''}`;
    const priorMotifs = titleMotifs(prior);
    if ([...candidateMotifs].some(item => priorMotifs.has(item))) motifHits += 1;
    if (classifier({ ...pair, textTitle: record.title || '', coverTitle: record.cover_title || '', coverSubtitle: undefined, mechanism: '' }) === mechanism) mechanismHits += 1;
  }
  return Math.min(32, motifHits * 5) + Math.min(16, mechanismHits * 2);
}

function diversifyCandidates(
  candidates: TitlePair[],
  input: TitleStageInput,
  records: Array<{ title: string; cover_title: string }>,
  classifier: TitleCategoryFn = classifyTitleMechanism,
  categories?: string[],
) {
  const bucketKeys: string[] = categories && categories.length
    ? categories
    : ['search_utility', 'loss_tension', 'cognitive_conflict', 'result_gain'];
  const buckets = new Map<string, TitlePair[]>(bucketKeys.map(key => [key, []]));
  for (const candidate of candidates) buckets.get(classifier(candidate))?.push(candidate);
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => recentTitlePenalty(a, records, classifier) - recentTitlePenalty(b, records, classifier));
  }
  const ordered: TitlePair[] = [];
  for (let index = 0; index < 3; index += 1) {
    for (const mechanism of bucketKeys) {
      const candidate = buckets.get(mechanism)?.[index];
      if (candidate) ordered.push(candidate);
    }
  }
  const included = new Set(ordered);
  return [...ordered, ...candidates.filter(candidate => !included.has(candidate))];
}

function selectTitleCandidate(
  candidates: TitlePair[],
  input: TitleStageInput,
  templates: Map<string, number>,
  records: Array<{ title: string; cover_title: string }>,
) {
  const preferred = preferredTitleMechanisms(input);
  const compatible = preferred.size
    ? candidates.filter(candidate => preferred.has(classifyTitleMechanism(candidate)))
    : candidates;
  const pool = compatible.length ? compatible : candidates;
  return pool.slice().sort((a, b) => scorePair(b, input, templates, records) - scorePair(a, input, templates, records))[0];
}

function introducesUnsupportedFacet(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  const actual = [
    ...input.content.coverBlocks.flatMap(block => [block.heading || '', ...block.items.flatMap(item => [item.primary, item.secondary || '', item.note || ''])]),
    ...input.content.innerPages.flatMap(page => [page.page_title, page.lead, ...page.bullets]),
    input.content.captionParts.opening,
    ...input.content.captionParts.value,
  ].join(' ');
  const facets: Array<[RegExp, RegExp]> = [
    [/评分|分数|评分方式/, /评分|分数|评分方式/],
    [/费用|报名费|价格/, /费用|报名费|价格/],
    [/出分|查分|成绩速度/, /出分|查分|成绩速度/],
    [/难度|更难|更简单/, /难度|更难|更简单/],
  ];
  return facets.some(([inTitle, inContent]) => inTitle.test(title) && !inContent.test(actual));
}

function scorePair(
  pair: TitlePair,
  input: TitleStageInput,
  templates: Map<string, number>,
  records: Array<{ title: string; cover_title: string }>,
) {
  let score = 0;
  const title = `${pair.textTitle} ${pair.coverTitle}`;
  if (title.includes(input.topic.seo.primary)) score += 10;
  if (userRelationVisible(pair.coverTitle, input.topic)) score += 12;
  else score -= 12;
  if (coverHasClickReason(pair.coverTitle, input)) score += 12;
  else score -= 15;
  if (textHasConcretePayoff(pair.textTitle)) score += 10;
  else score -= 15;
  if (preferredTitleMechanisms(input).has(classifyTitleMechanism(pair))) score += 18;
  if (resolveTitleConsensusActive(input.topic.productId, isTitleProductShowcase(input.topic, input.noteMode))) {
    score += humanVoiceSignalScore(pair);
    // 最终选择也要尊重用户认可的点击感：内容完整不是“资料目录化”的通行证。
    // 只做排序软信号，事实/SEO/模板/长度等硬约束仍由前面的闸门负责。
    if (isCatalogLikeTitle(pair.textTitle) && !/[？?]|为什么|其实|原来|明明|不是.{0,4}而是/u.test(pair.textTitle)) score -= 12;
  }
  if (/\d+类(?:语法)?错|清单查短板|\d+维度自查定位|语法错\d+类/.test(title)) score -= 60;
  score += Math.min(18, majorContentOverlap(pair, input) * 3);
  const template = titleTemplateFingerprint(pair.textTitle);
  if (template) score -= Math.min(32, (templates.get(template) || 0) * 8);
  score -= recentTitlePenalty(pair, records);
  const length = countVisibleUnits(pair.textTitle);
  if (length >= 15 && length <= 20) score += 4;
  if (/[？?]/.test(pair.textTitle) && /[？?]/.test(pair.coverTitle)) score -= 6;
  return score;
}

function primaryClickMode(input: TitleStageInput): TitleClickMode {
  const text = `${input.topic.demandType || ''} ${input.topic.valueType || ''} ${input.topic.topic} ${input.topic.painOrDesire} ${input.topic.promise}`;
  if (/自查|检查|清单|避坑|错误/.test(text)) return 'SELF_TEST_AVOIDANCE';
  if (/反常识|误区|不要|不是|背整篇|高级词|大词/.test(text)) return 'INSIGHT_CONTRARIAN';
  if (/为什么|没深度|不会|卡|痛点|问题/.test(text)) return 'PAIN_QUESTION';
  if (/考前|最后|急救|剩下|倒计时/.test(text)) return 'URGENT_EXAM';
  if (/对比|B1|B2|差异|修改前|修改后/.test(text)) return 'COMPARISON_GAP';
  return 'COLLECTION_ASSET';
}

function secondaryClickMode(primary: TitleClickMode, input: TitleStageInput): TitleClickMode {
  const modes: TitleClickMode[] = ['COLLECTION_ASSET', 'PAIN_QUESTION', 'INSIGHT_CONTRARIAN', 'COMPARISON_GAP', 'URGENT_EXAM', 'SELF_TEST_AVOIDANCE', 'EMOTIONAL_CURIOSITY'];
  return modes.find(mode => mode !== primary && `${input.topic.topic} ${input.topic.promise}`.length > 0) || 'EMOTIONAL_CURIOSITY';
}

function modeFromPair(pair: TitlePair): TitleClickMode {
  if (pair.finalClickMode && pair.finalClickMode !== 'UNKNOWN') return pair.finalClickMode;
  if (pair.generatorClickMode && isClickMode(pair.generatorClickMode)) return pair.generatorClickMode;
  if (pair.clickMode) return pair.clickMode;
  const mechanism = `${pair.mechanism} ${pair.textTitle} ${pair.coverTitle}`;
  if (/search|资料|整理|清单|大全|速查/i.test(mechanism)) return 'COLLECTION_ASSET';
  if (/loss|痛|问题|怎么办|卡|怕|焦虑/i.test(mechanism)) return 'PAIN_QUESTION';
  if (/cognitive|反常识|不是|别再|不要/i.test(mechanism)) return 'INSIGHT_CONTRARIAN';
  if (/comparison|对比|差异|B1|B2/i.test(mechanism)) return 'COMPARISON_GAP';
  if (/urgent|考前|急救|最后/i.test(mechanism)) return 'URGENT_EXAM';
  if (/self|自查|检查|避坑/i.test(mechanism)) return 'SELF_TEST_AVOIDANCE';
  return 'EMOTIONAL_CURIOSITY';
}

function mapSourceDirection(value: unknown): TitleClickMode | 'UNKNOWN' {
  if (isClickMode(value)) return value;
  if (typeof value !== 'string') return 'UNKNOWN';
  const map: Record<string, TitleClickMode> = {
    material: 'COLLECTION_ASSET', pain: 'PAIN_QUESTION', emotion: 'EMOTIONAL_CURIOSITY',
    counter: 'INSIGHT_CONTRARIAN', fast_path: 'URGENT_EXAM', voice: 'VOICE_EXPERIENCE',
  };
  return map[value] || 'UNKNOWN';
}

function slotForIndex(index: number): 'primary' | 'secondary' | 'emotional' | 'alternate' {
  return (['primary', 'secondary', 'emotional', 'alternate'] as const)[index] || 'alternate';
}

function requestedModeForSlot(
  slot: TitleSlotId,
  primary: TitleClickMode,
  secondary: TitleClickMode,
): TitleClickMode {
  if (slot === 'primary') return primary;
  if (slot === 'secondary') return secondary;
  if (slot === 'emotional') return 'VOICE_EXPERIENCE';
  return 'INSIGHT_CONTRARIAN';
}

function nextUnusedSlot(usedSlots: Set<TitlePair['slotId']>, preferred: TitlePair['slotId'] | undefined, index: number): NonNullable<TitlePair['slotId']> {
  if (preferred && !usedSlots.has(preferred)) return preferred;
  const fallback = (['primary', 'secondary', 'emotional', 'alternate'] as const).find(slot => !usedSlots.has(slot));
  return fallback || slotForIndex(index);
}

const TITLE_SLOT_ORDER: NonNullable<TitlePair['slotId']>[] = ['primary', 'secondary', 'emotional', 'alternate'];

function localTitleReason(mode: TitleClickMode, title: string) {
  const labels: Record<TitleClickMode, string> = {
    COLLECTION_ASSET: '整理好的资料和可直接收藏的内容',
    EMOTIONAL_CURIOSITY: '考生正在经历的焦虑或好奇点',
    PAIN_QUESTION: '考生正在遇到的具体写作困难',
    INSIGHT_CONTRARIAN: '对常见写作做法的反向提醒',
    COMPARISON_GAP: '两个写作水平或做法的清晰差异',
    URGENT_EXAM: '考前或限时场景下的应对内容',
    SELF_TEST_AVOIDANCE: '可以照着完成的自查或避坑动作',
    VOICE_EXPERIENCE: '真实经验口吻带来的代入感',
  };
  return `${title}：${labels[mode]}`;
}

function localTitleMechanism(mode: TitleClickMode) {
  return mode;
}

function localTitleUserRelation(mode: TitleClickMode, productId: TopicOption['productId'] = 'delf_b2_writing') {
  // This is metadata shown downstream, not a new title rule. Keep Product 1's
  // legacy wording byte-for-byte and derive the other products from profile.
  const identity = getProductPromptProfile(productId).shortIdentity;
  return `面向需要${mode === 'COLLECTION_ASSET' ? '资料整理' : '写作帮助'}的${identity}写作者`;
}

function enrichTitlePackage(data: TitlePackage, input: TitleStageInput, raw: unknown, directions: string[]): TitlePackage {
  const spec = getCoverTemplateSpec(input.capability.renderer);
  const primary = primaryClickMode(input);
  const secondary = secondaryClickMode(primary, input);
  const usedSlots = new Set<TitlePair['slotId']>();
  const bundles = data.candidates.map((candidate, index) => {
    const clickMode = modeFromPair(candidate);
    const modeWarning = candidate.requestedClickMode && candidate.requestedClickMode !== 'UNKNOWN' && clickMode !== candidate.requestedClickMode
      ? ['MODE_MISMATCH_WARNING']
      : [];
    const requestedBySlot = requestedModeForSlot(candidate.slotId || slotForIndex(index), primary, secondary);
    const requestedClickMode = candidate.requestedClickMode && candidate.requestedClickMode !== 'UNKNOWN'
      ? candidate.requestedClickMode
      : requestedBySlot;
    const slotId = nextUnusedSlot(usedSlots, candidate.slotId, index);
    usedSlots.add(slotId);
    const coverTitle = candidate.coverTitle;
    const compressedTextTitle = compressTextTitle(candidate.textTitle);
    const textTitleCompressionWarning = countVisibleUnits(compressedTextTitle) > 20
      ? 'TEXT_TITLE_LOCAL_COMPRESSION_INSUFFICIENT'
      : undefined;
    const max = spec?.titleMaxVisibleChars || (spec?.titleLengthRange?.[1] || 18);
    const visibleChars = countVisibleUnits(coverTitle);
    const maxLines = spec?.titleMaxLines || 2;
    const kicker = candidate.coverKicker || (spec?.kickerSupported
      ? input.topic.productId === 'delf_b2_writing'
        ? 'DELF B2 写作'
        : getProductPromptProfile(input.topic.productId).shortIdentity
      : undefined);
    const subtitleVisibleChars = countVisibleUnits(candidate.coverSubtitle || '');
    const titleFits = visibleChars <= max;
    const subtitleFits = subtitleVisibleChars <= (spec?.subtitleMaxVisibleChars || 24);
    const kickerFits = countVisibleUnits(kicker || '') <= (spec?.kickerMaxVisibleChars || 20);
    const fitReasons = [
      ...(!titleFits ? [`coverTitle ${visibleChars}>${max}`] : []),
      ...(!subtitleFits ? [`coverSubtitle ${subtitleVisibleChars}>${spec?.subtitleMaxVisibleChars || 24}`] : []),
      ...(!kickerFits ? [`coverKicker ${countVisibleUnits(kicker || '')}>${spec?.kickerMaxVisibleChars || 20}`] : []),
    ];
    return {
      ...candidate,
      // 平台20字是唯一的文字标题物理上限；只做整词压缩，不淘汰或重写整个 Bundle。
      textTitle: compressedTextTitle,
      id: candidate.id || `title_bundle_${stableHash(`${candidate.textTitle}|${candidate.coverTitle}|${index}`)}`,
      clickMode,
      detectedClickMode: clickMode,
      finalClickMode: clickMode,
      slotId,
      requestedClickMode,
      sourceDirection: candidate.sourceDirection || undefined,
      clickReason: candidate.clickReason || localTitleReason(clickMode, candidate.textTitle),
      mechanism: candidate.mechanism || localTitleMechanism(clickMode),
      userRelation: candidate.userRelation || localTitleUserRelation(clickMode, input.topic.productId),
      coverKicker: kicker,
      topicScope: candidate.topicScope || input.topic.topicScope || 'mother',
      pairSemanticMatch: candidate.pairSemanticMatch || 'strong',
      promisePayloadFit: candidate.promisePayloadFit || 'aligned',
      templateFit: candidate.templateFit || {
        fits: titleFits && subtitleFits && kickerFits,
        kickerFits,
        titleFits,
        subtitleFits,
        defaultRenderFits: titleFits && subtitleFits && kickerFits,
        fitReasons,
        visibleChars,
        maxVisibleChars: max,
        estimatedLines: Math.max(1, Math.ceil(visibleChars / Math.max(1, Math.ceil(max / maxLines)))),
        maxLines,
      },
      warnings: [...(candidate.warnings || []), ...modeWarning, ...(textTitleCompressionWarning ? [textTitleCompressionWarning] : [])],
      softWarnings: [...(candidate.softWarnings || []), ...modeWarning, ...(textTitleCompressionWarning ? [textTitleCompressionWarning] : [])],
    };
  });
  bundles.sort((a, b) => TITLE_SLOT_ORDER.indexOf(a.slotId!) - TITLE_SLOT_ORDER.indexOf(b.slotId!));
  const ranked = bundles
    .map((bundle, index) => ({ bundle, index, score: scorePair(bundle, input, new Map(), []) }))
    .sort((a, b) => b.score - a.score);
  const selectedBundle = data.selected?.id ? bundles.find(bundle => bundle.id === data.selected.id) : ranked[0]?.bundle || bundles[0];
  const selected = selectedBundle || data.selected;
  const trace: TitleStageTrace = {
    primaryClickMode: primary,
    secondaryClickMode: secondary,
    directions,
    generatorRaw: raw,
    normalizedBundles: bundles,
    selectorInputs: ranked.map(item => ({ id: item.bundle.id, clickMode: item.bundle.clickMode, score: item.score, originalPosition: item.index })),
    recommendedReason: selected ? `${selected.clickMode}：${selected.clickReason || '与当前内容承接度最高'}` : undefined,
    selectedOriginalPosition: selected ? bundles.findIndex(bundle => bundle.id === selected.id) + 1 : undefined,
  };
  return { ...data, candidates: bundles, selected, titleBundles: bundles, recommendedBundleId: selected?.id, selectedBundleId: selected?.id, titleStageTrace: trace };
}

// 只用于共识路径的轻量排序信号：帮助最终选择偏向用户认可的真人口吻，
// 不作为硬闸门，也不规定固定句式，避免把样本风格再压成一套公式。
function humanVoiceSignalScore(pair: TitlePair) {
  const title = `${pair.textTitle} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  let score = 0;
  if (/(?:^|[，。！？\s])我(?:用|把|的|也|怎么|终于|不再)?|我的/u.test(title)) score += 3;
  if (/(?:^|[，。！？\s])你(?:的|也|总是|还在|怎么)?/u.test(title)) score += 2;
  if (/[？?]/u.test(title)) score += 2;
  if (/为什么|其实|原来|明明|不是.{0,4}而是|反而/u.test(title)) score += 3;
  if (/没底|没把握|焦虑|心慌|怕|来不及|白写|白背|丢分|写不完|不敢|后悔/u.test(title)) score += 2;
  if (/大全|清单|框架|汇总|速查|整理|知识体系|模块/u.test(pair.textTitle) && !/[？?]|为什么|其实|原来/u.test(pair.textTitle)) score -= 2;
  return score;
}

function isCatalogLikeTitle(textTitle: string) {
  return /(?:评分表详解|评分表\+?自查|范文库|资料库|知识库|检查清单|自查清单|速查表|题型整理好了|按题型整理|使用说明|学习路径|攻略大全|资料合集)/u.test(textTitle);
}

function majorContentOverlap(pair: TitlePair, input: TitleStageInput) {
  const title = `${pair.textTitle}${pair.coverTitle}`.replace(/DELF|B2|TEF|TCF|Canada|法语|写作/gi, '');
  const major = [input.topic.topic, input.topic.promise, input.topic.contentAngle, ...input.content.coverBlocks.map(block => block.heading || '')].join('');
  const titleTokens = semanticBigrams(title);
  const majorTokens = semanticBigrams(major);
  let hit = 0;
  for (const token of titleTokens) if (majorTokens.has(token)) hit += 1;
  return hit;
}

function rawTitleCandidates(
  raw: RawTitleResponse,
  slotSpecs: Record<TitleSlotId, { requestedClickMode: TitleClickMode }>,
): Array<{ slotId: TitleSlotId; raw: Partial<TitlePair> & Record<string, unknown> }> {
  const fixed = TITLE_SLOT_IDS.flatMap(slot => {
    const value = raw[slot];
    if (!value) return [];
    const bundle = value.bundle || value;
    return [{ slotId: slot, raw: { ...bundle, slotId: slot, requestedClickMode: slotSpecs[slot].requestedClickMode } as Partial<TitlePair> & Record<string, unknown> }];
  });
  if (fixed.length) return fixed;
  return (Array.isArray(raw.candidates) ? raw.candidates : [])
    .map(item => {
      const slotId = item.slotId as TitleSlotId;
      return { slotId, raw: { ...item, requestedClickMode: slotSpecs[slotId]?.requestedClickMode } };
    })
    .filter(item => TITLE_SLOT_IDS.includes(item.slotId));
}

function titleSlotsFromCandidates(candidates: Array<{ slotId: TitleSlotId; pair: TitlePair }>): TitleSlotMap {
  const slots: TitleSlotMap = { primary: null, secondary: null, emotional: null, alternate: null };
  for (const item of candidates) if (!slots[item.slotId]) slots[item.slotId] = item.pair;
  return slots;
}

function missingTitleSlots(slots: TitleSlotMap) {
  return TITLE_SLOT_IDS.filter(slot => !slots[slot]);
}

function normalizePair(raw: Partial<TitlePair> & Record<string, unknown>): TitlePair | null {
  const textTitle = normalizeNaturalCounters(clean(raw.textTitle) || clean(raw.title) || clean(raw.text_title));
  const coverTitle = normalizeNaturalCounters(clean(raw.coverTitle) || clean(raw.cover_title));
  if (!textTitle || !coverTitle) return null;
  const generatorClickMode = clean(raw.generatorClickMode) || clean(raw.clickMode);
  return {
    textTitle,
    id: clean(raw.id) || undefined,
    slotId: TITLE_SLOT_IDS.includes(clean(raw.slotId) as TitleSlotId) ? clean(raw.slotId) as TitlePair['slotId'] : undefined,
    requestedClickMode: mapSourceDirection(raw.requestedClickMode),
    sourceDirection: clean(raw.sourceDirection) || undefined,
    generatorClickMode: generatorClickMode || undefined,
    coverKicker: normalizeNaturalCounters(clean(raw.coverKicker) || clean(raw.cover_kicker)) || undefined,
    coverTitle,
    coverSubtitle: normalizeNaturalCounters(clean(raw.coverSubtitle) || clean(raw.cover_subtitle) || clean(raw.subtitle)) || undefined,
    mechanism: clean(raw.mechanism) || clean(raw.title_type) || clean(raw.trigger_type) || '好奇缺口',
    userRelation: clean(raw.userRelation) || clean(raw.user_relation) || clean(raw.reason),
    clickMode: isClickMode(raw.clickMode) ? raw.clickMode : undefined,
    clickReason: clean(raw.clickReason) || clean(raw.click_reason) || undefined,
    seoKeyword: clean(raw.seoKeyword) || clean(raw.seo_keyword) || undefined,
    noveltyFingerprint: clean(raw.noveltyFingerprint) || clean(raw.novelty_fingerprint) || stableHash(`${textTitle}|${coverTitle}`),
  };
}

function normalizeNaturalCounters(value: string) {
  return value
    .replace(/\s*\bweakest\b\s*/gi, '最弱')
    .replace(/(\d+)\s*(差异|原因|问题|方法|错误|误区)/g, '$1个$2')
    .replace(/(\d+)\s*步骤/g, '$1个步骤')
    .replace(/语法错(\d+)类/g, '$1类语法错误')
    .replace(/必考差异/g, '关键差异');
}

function dedupeCandidates(candidates: TitlePair[], classifier: TitleCategoryFn = classifyTitleMechanism) {
  const seenExact = new Set<string>();
  const seenSemantic = new Set<string>();
  return candidates.filter(item => {
    const exactKey = `${fingerprintTitle(item.textTitle)}|${fingerprintTitle(item.coverTitle)}`;
    if (seenExact.has(exactKey)) return false;
    seenExact.add(exactKey);
    const objects = `${item.textTitle}${item.coverTitle}`.match(/自查|检查|评分|短板|差异|题型|范文|模板|句型|词汇|语法|连接词|资料|大全|速查|错误|选考|报名/g) || [];
    const motifs = [...titleMotifs(`${item.textTitle} ${item.coverTitle}`)].sort();
    const semanticKey = `${classifier(item)}|${motifs.join(',')}|${Array.from(new Set(objects)).sort().join(',')}`;
    if ((motifs.length || objects.length) && seenSemantic.has(semanticKey)) return false;
    seenSemantic.add(semanticKey);
    return true;
  });
}

function isUnnatural(value: string) {
  return /资料太散|卡住|卡主(?:了)?|卡了|卡在这一步|拖后腿|拖分|守住(?:这|那)?一分|替换就守住|正在白背|格式正在|偷走|写作任务|多数人|真正的原因|你以为|不是.+而是|短板不明确|练了没重点|\d+类(?:语法)?错|清单查短板|\d+维度自查定位|语法错\d+类|(?:定位|适合|帮|让|告诉|解决)你的$|的人进$|进来看看$|看过来$/.test(value);
}

function isClickMode(value: unknown): value is TitleClickMode {
  return typeof value === 'string' && ['COLLECTION_ASSET', 'EMOTIONAL_CURIOSITY', 'PAIN_QUESTION', 'INSIGHT_CONTRARIAN', 'COMPARISON_GAP', 'URGENT_EXAM', 'SELF_TEST_AVOIDANCE', 'VOICE_EXPERIENCE'].includes(value);
}

function hasRedundantIdentity(value: string, productId: TopicOption['productId']) {
  if (productId === 'delf_b2_writing') {
    return (value.match(/DELF/gi) || []).length > 1 || (value.match(/B2/gi) || []).length > 1;
  }
  return (value.match(/TEF/gi) || []).length > 1 || (value.match(/TCF/gi) || []).length > 1;
}

function hasOversimplifiedExamChoice(value: string) {
  return /(?:强|弱|喜欢|偏好|擅长).{0,8}(?:就?选|更适合)(?:TEF|TCF)|(?:直接|就)选(?:TEF|TCF)/i.test(value);
}

function titleGateFailures(pair: TitlePair, input: TitleStageInput, selected: Set<string>, coverTitles: Set<string>) {
  const failures: string[] = [];
  const textLength = countVisibleUnits(pair.textTitle);
  const coverIdentity = `${pair.coverKicker || ''} ${pair.coverTitle} ${pair.coverSubtitle || ''}`;
  if (textLength > 20) failures.push(`TEXT_TITLE_OVER_PLATFORM_LIMIT:${textLength}`);
  if (hasForbiddenProductIdentity(input.topic.productId, `${pair.textTitle} ${coverIdentity}`)) failures.push('TOPIC_DRIFT:混入了另一个商品或考试身份');
  if (introducesNewPain(pair, input) || introducesUnsupportedFacet(pair, input) || !contentSupports(pair, input)) failures.push('TOPIC_DRIFT:标题承诺超出当前内容');
  if (isUnnatural(pair.textTitle) || isUnnatural(pair.coverTitle)) failures.push('存在机器化或不说人话表达');
  if (/[：:，、]$/u.test(pair.textTitle) || /[：:，、]$/u.test(pair.coverTitle)) failures.push('标题句尾残缺');
  // 阶段 D（设计 §5 末尾 / §6.2）：标题承诺超出本篇可承诺范围只进返修级 failures，不加硬拦、不动内容阶段。
  if (resolveTitleConsensusActive(input.topic.productId, isTitleProductShowcase(input.topic, input.noteMode))) {
    const beyondRange = titlePromiseBeyondRange(pair, input.topic);
    if (beyondRange) failures.push(beyondRange);
    if (hasDanglingTitleTail(pair.textTitle) || hasDanglingTitleTail(pair.coverTitle)) failures.push('标题以悬空虚词收尾，句子不完整');
    if (hasCutFragmentTail(pair.textTitle) || hasCutFragmentTail(pair.coverTitle)) failures.push('标题以截断残片收尾（数字或词语被切半），句子不完整');
  }
  if (selected.has(fingerprintTitle(pair.textTitle)) || coverTitles.has(fingerprintTitle(pair.coverTitle))) failures.push('与近期标题重复');
  return failures;
}

function semanticBigrams(value: string) {
  const cleanText = value.toLowerCase().replace(/DELF|TEF|TCF|Canada|B2|CLB7|法语|写作|备考|资料|知识库|[\s\p{P}\p{S}]/gu, '');
  const set = new Set<string>();
  for (let i = 0; i < cleanText.length - 1; i += 1) set.add(cleanText.slice(i, i + 2));
  return set;
}

function toMigrated(topic: TopicOption): MigratedTopic {
  return {
    id: topic.id,
    topic_type: topic.primaryGoal === 'search' ? 'search_pain' : topic.primaryGoal === 'conversion' ? 'product_showcase' : topic.primaryGoal === 'save' ? 'selling_point' : 'narrow_knowledge',
    topic: topic.topic,
    audience: topic.audienceState,
    scene: topic.scene,
    pain: topic.painOrDesire,
    content_promise: topic.promise,
    product_bridge: topic.productBridge,
    why_this_reference_fits: topic.contentAngle,
    novelty: topic.noveltyFingerprint,
    search_terms: [topic.seo.primary, ...topic.seo.related],
    content_source_plan: { knowledge_base: '', ai_original: '' },
    title_trigger_types: topic.seedSignals,
  };
}

function artifact(data: TitlePackage, inputHash: string, usage: AiUsageSummary, requestId: string, warnings: string[]): VersionedArtifact<TitlePackage> {
  return { data, schema_version: V2_SCHEMA_VERSION, prompt_version: TITLE_PROMPT_VERSION, input_hash: inputHash, created_at: new Date().toISOString(), usage, warnings, request_id: requestId };
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}
