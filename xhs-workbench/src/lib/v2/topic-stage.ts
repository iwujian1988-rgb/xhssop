import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getProductPromptProfile, hasForbiddenProductIdentity } from '@/lib/product-prompt-profiles';
import { getRecentTitleFingerprints } from '@/lib/title-usage-store';
import { getXhsSearchKeywords } from '@/lib/xhs-search-keywords';
import type { ProductFacts } from '@/types/content-planning';
import type { ExamScope, ProductId } from '@/types/data';
import type { CompetitorCreativeCard, MigratedTopic } from '@/types/reference-workflow';
import { stableHash, type TemplateCapability, type TopicLane, type TopicOption, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { listVerifiedExamFacts } from './verified-exam-facts';
import { resolvePipelineFeatures } from './pipeline-features';
import { generateTopicOptionsConsensus, getConsensusPromptBudget, type ConsensusTopicAiCall } from './consensus-topic-stage';
import type { BatchEditorialTask } from './batch-editorial-plan';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {checkAssignedLargeScope} from './topic-value';
import { buildProductTopicScopePlan, type DemandArchetype } from './product-topic-scope-plan';
import { PRODUCTION_TEXT_MODEL } from './production-models';
import { examScopeContext } from '@/lib/product-exam-context';
import { getMarketTopicReferences } from './market-topic-pool';
import { generateMarketReferenceFirstTopics } from './delf-click-reason-topic-production';

export const TOPIC_PROMPT_VERSION = 'v2-topic-natural-mother-domains-5';
export const TOPIC_MODEL = PRODUCTION_TEXT_MODEL;

const REQUIRED_TOPIC_LANES: TopicLane[] = ['broad_pain', 'result_need', 'narrow_knowledge', 'product_value'];
const MACHINE_TOPIC_PATTERN = /资料太散|卡住|卡在|拖后腿|正在白背|白背了|写作任务|这一关|多数人|真正的原因|底层逻辑|闭环|赋能|抓手|痛点人群|用户痛点/;

// 选题阶段只拦截会把整篇笔记带到错误商品/错误封面的情况。
// 说法不够自然、字段漏填、SEO词缺失等，后续标题/正文阶段仍可修复，不能让一张卡直接失败。
const TOPIC_HARD_FAILURES = new Set([
  'cross_product_identity',
  'product_showcase_mode_mismatch',
]);

interface TopicStageInput {
  avoidTopics?: string[];
  recentDomainIds?: string[];
  /** Demand-first planning inputs. Domains only balance delivery after these. */
  recentDemandArchetypes?: DemandArchetype[];
  excludeDemandArchetypes?: DemandArchetype[];
  topicScope?: 'large' | 'medium';
  productId: ProductId;
  card: CompetitorCreativeCard;
  capability: TemplateCapability;
  facts: ProductFacts;
  direction?: string;
  contentMode?: 'standard' | 'product_showcase';
  limit?: number;
  recentAngles?: string[];
  usedMarketReferenceTitles?: string[];
  usedMarketReasonIds?: string[];
  exhaustedMarketReasonIds?: string[];
  usedMarketTopicCores?: string[];
  usedMarketFinalTopics?: string[];
  topicGenerationAttemptId?: string;
  debugRound?: number;
  /** 共识分支用：single=前台单卡；batch=批量（跨卡软规避经 recentAngles 传入）。legacy 路径忽略。 */
  topicMode?: 'single' | 'batch';
  topicSourceMode?: 'market' | 'long_tail' | 'mixed';
  batchTopicSlotId?: string;
  batchEditorialTask?: BatchEditorialTask;
  topicRotationIndex?: number;
  examScope?: ExamScope;
}

interface RawTopicResponse {
  topics?: Array<Partial<TopicOption> & Record<string, unknown>>;
}

export async function generateTopicOptions(input: TopicStageInput): Promise<VersionedArtifact<TopicOption[]>> {
  if (input.contentMode !== 'product_showcase' && input.topicSourceMode === 'market'
    && ['delf_b2_writing', 'tef_tcf_canada', 'tcf_canada_writing_7day'].includes(input.productId)) {
    return generateMarketReferenceFirstTopics({ productId: input.productId, card: input.card, capability: input.capability, facts: input.facts, limit: input.limit || 1, direction: input.direction, recentTopics: input.recentAngles, avoidTopics: input.avoidTopics, usedMarketReferenceTitles: input.usedMarketReferenceTitles, usedMarketReasonIds: input.usedMarketReasonIds, exhaustedMarketReasonIds: input.exhaustedMarketReasonIds, usedMarketTopicCores: input.usedMarketTopicCores, usedMarketFinalTopics: input.usedMarketFinalTopics, topicRotationIndex: input.topicRotationIndex, topicGenerationAttemptId: input.topicGenerationAttemptId, debugRound: input.debugRound, examScope: input.examScope });
  }
  const examContext = examScopeContext(input.productId, input.examScope);
  const marketReferences = input.contentMode === 'product_showcase' ? [] : await getMarketTopicReferences(input.productId, 20);
  // 普通内容三商品都走同一共识选题链；showcase 保留独立路径。
  const features = resolvePipelineFeatures(input.productId);
  if (features.consensusTopicStage && input.contentMode !== 'product_showcase') {
    const requestedSize = input.limit || 1;
    const rotationIndex = input.topicRotationIndex || 0;
    const scopePlan = buildProductTopicScopePlan(
      input.productId, input.examScope, input.topicScope || 'large', requestedSize,
      input.recentDomainIds, input.recentDemandArchetypes, input.excludeDemandArchetypes,
    );
    // 需求在前；内容域仅是可交付范围的校验，不得反过来决定公开选题。
    const modelScopePlan = scopePlan.map(item=>({
      slot:item.slot,
      demandCard: item.demand,
      contentCoverage: item.coverageDomain ? {
        coverageDomain:item.coverageDomain,
        coreProblem:item.coreProblem,
        requiredMotherTopics:item.requiredMotherTopics,
        minimumCoverage:item.minimumCoverage,
      } : undefined,
    }));
    const promptInput = {
      product: getProductPromptProfile(input.productId).noteIdentity,
      direction: input.direction || '', count: input.limit || 1,
      ...(examContext ? { exam_scope: { scope: input.examScope, identity: examContext.displayIdentity, audience: examContext.audience, rule: examContext.rule } } : {}),
      topicScope: input.topicScope || 'large',
      avoidTopics: (input.avoidTopics || []).map(text=>text.split('；交付：')[0]).slice(-30),
      scopePlan:modelScopePlan,
      marketReferences,
    };
    const systemPrompt = [
        '1. 按scopePlan顺序输出count篇。每篇先从 demandCard 的真实处境策划：situation=用户此刻发生什么，trigger=为什么现在急了，frustration=已试过什么仍无效，desiredOutcome=真正想得到什么，lossIfIgnored=继续不解决的代价，searchLanguage=用户自己会搜/会说的话。公开topic先回答“他为什么会点”，不能把课程模块换成人话，也不要照抄字段。',
        '2. contentCoverage 只校验这篇实际能交付什么，禁止直接把 coverageDomain、requiredMotherTopics 或模块名改写成 topic。若两张需求卡的 situation/trigger/frustration/desiredOutcome 本质相同，只保留一个；不得靠“诊断、计划、节奏、模考”等课程词制造差异。',
        '3. large须天然包含多个独立中型母题，不是同一能力的不同层级、同一任务的几步或一个痛点的几种表现。遵守contentCoverage.minimumCoverage；输出前去掉完整、系统、体系、地图、全景、框架、机制、底层等包装词，再看是否仍够大。',
        '4. topic只用普通备考者会说的一句话表达一个大问题，不提前给出答案目录。不要把3至5个子模块拼成“A、B、C、D如何共同……”或“从A、B、C到D……”。子模块移入promise。不得把课程目录、PPT提纲或“诊断→训练→模考”过程本身当作用户问题。不负责点击钩子、网感、捷径、高分、稳过、3分钟或交付形式；这些留给后续Title。',
        '5. promise才说明以5页为目标实际交付的母题材料、对照、示例与必要应用；浓缩但不漏主要范围。audienceState与painOrDesire必须复述需求卡的真实处境与未解决问题。',
        '6. avoidTopics仅用于禁止与历史选题重复：禁止学习、模仿、延续它们的措辞、结构、选题尺度或交付形式。整批核心问题不重复；不得为了避重缩成局部题。',
        '7. 只返回JSON对象：{"topics":[{"topic":"自然选题","audienceState":"处境","painOrDesire":"需求","promise":"实际交付"}]}。这里只生成long_tail，不要引用或改写市场参考。',
      ].join('\n');
    const callTopicBatch = (payload: typeof promptInput, retries: number) => callOpenAICompatibleJsonWithUsage<RawTopicResponse>([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ], { stage: 'topic', model: TOPIC_MODEL, maxTokens: Math.min(10000, Math.max(2200, payload.count * 500)), temperature: 0.85, retries,
      onResponseTrace: async trace=>{
        const dir=path.join(process.cwd(),'data','final-content-traces',trace.requestId.replace(/[^a-zA-Z0-9._-]/g,'_'));
        await mkdir(dir,{recursive:true});
        await writeFile(path.join(dir,'00_TOPIC_REQUEST_RAW_PARSED.json'),JSON.stringify(trace,null,2));
      },
    });

    const marketSystemPrompt = [
      '你现在只生成market类型的普通内容笔记选题。市场参考拥有选题主导权，不得使用Demand Card、pain-first模板、用户失败行为模板，也不得把参考题改写成“怎么解决某个学习问题”“需要哪些能力”“先补什么”“怎样安排训练优先级”。',
      '保留参考笔记的内容形态并做邻近扩展：资源/工具/网站/APP/题库、刷题方法、报名考位与信息差、路线/周期/作息、经验、避坑、考试现场、真题、复盘等都可以作为公开选题入口。允许系列化（如网站篇、APP篇、题库篇），但禁止实质同题。',
      '新Topic不能与输入中的本轮已生成Topic或最近已有Topic表达同一个核心内容。撞题时必须换另一个Market Reference或另一个邻近方向，不得只换几个字。网站清单、APP清单、工具清单如果核心都是同一入口，只保留一个；真题来源与真题使用方法也视为同题，除非输入明确需要系列。',
      '输出前先把5条按核心内容两两比较：同一工具入口、同一题型、同一资料/真题入口、同一周期路线、同一考场信息只能保留一条，其余必须换成不同市场入口；不要用“网站/APP/免费/清单/指南”换词伪装重复。',
      '同一批中同一个referenceTitle默认最多使用一次；同一参考的系列扩展只有在确实是明确系列且本批没有更好的不同市场入口时才允许，口语Part2不同生活场景也不要一次铺满。',
      '如果recentTopics已经出现某个内容家族（例如口语Part2模拟、备考网站/APP、真题来源/使用、四科时间分配），本轮后续批次默认不要再用这个家族，优先选择尚未出现的市场入口；不要把不同生活场景当作足够的新主题。',
      'DIRECT_NEIGHBOR：与某条参考在对象、动作或内容形态上自然相邻；STRUCTURE_ONLY：只迁移其点击结构/叙事结构。除非输入提供真实可证明作者经历，禁止第一人称、个人身份和个人结果，包括“我/我的/亲测/实录/上岸/通过/拿分/考了几次/每天几小时/几个月通过”等。也禁止把市场标题中的虚构经历原样搬入。必须改成中性市场形态，如“三个月备考怎么安排”“作息参考”“路线怎么分阶段”，不得保留未经证明的个人结果。',
      'DELF B2的Market Topic内容边界固定为现有DELF B2写作知识库：可以覆盖写作整体备考、周期/路线、短期冲刺、资料与范文、评分标准、训练方式、避坑、在职时间安排、观点论据、模板/句法/词汇/自查等大入口。不要把DELF Market扩展成听力、阅读或口语主题；若市场参考属于这些领域，只能在自然迁移到DELF B2写作且当前资产可支撑时借结构，否则跳过。',
      'DELF B2的Market必须保持市场型大入口，不能落成练习本每篇复盘、某一段展开、某一句替换、单个语法问题或单个检查动作；这些细颗粒度题目属于long_tail。Market可以都是写作，但不能都是细写作知识点。TCF继续保持多模块范围，只使用TCF参考，不得串考试。',
      '可写性是硬边界：不要生成当前content_note已有知识、Evidence或Product内容无法可靠回答的题目。报名考位、考点、出分时效、当前APP/网站红黑榜、具体平台名称、最新真题或考试政策等若输入资产没有可靠事实，不要为了市场感硬生成，换成已有资产能真实支撑的相邻主题。不要新增平台、分数、通过率、考试规则或时效事实，不要让Inner凭空补事实。',
      'Topic必须像用户会看到、搜索或点击的自然选题，不要输出内部标签式短语（如“信息差”“打开方式”）。',
      'Market生成顺序：先从真实Market Reference保留用户为什么想点、内容入口和叙事形态，再与当前content_note资产取交集检查可写性。知识资产只能做边界过滤，不能反过来决定Market Topic。生成前自问“这是小红书用户会点进去看的整篇笔记主题，还是课程目录里的一节课标题？”若更像课程目录，禁止作为Market。',
      '只返回JSON对象。每项必须包含topic、audienceState、painOrDesire、promise、topicSource、marketReference、imitationMode。topicSource必须为market；marketReference.sourceTitle必须逐字来自输入参考；imitationMode只能为DIRECT_NEIGHBOR或STRUCTURE_ONLY。',
    ].join('\n');
    const supportingAssets = Object.values(input.facts || {}).flat().map(item => item.text).filter(Boolean).slice(0, 80);
    const callMarketBatch = (payload: { product: string; exam: string; count: number; marketReferences: unknown[]; recentTopics: string[]; priorTopics: string[]; supportingAssets: string[] }, retries: number) => callOpenAICompatibleJsonWithUsage<RawTopicResponse>([
      { role: 'system', content: marketSystemPrompt },
      { role: 'user', content: JSON.stringify(payload) },
    ], { stage: 'topic', model: TOPIC_MODEL, maxTokens: Math.min(10000, Math.max(4200, payload.count * 800)), temperature: 0.85, retries,
      onResponseTrace: async trace=>{
        const dir=path.join(process.cwd(),'data','final-content-traces',trace.requestId.replace(/[^a-zA-Z0-9._-]/g,'_'));
        await mkdir(dir,{recursive:true});
        await writeFile(path.join(dir,'00_MARKET_TOPIC_REQUEST_RAW_PARSED.json'),JSON.stringify(trace,null,2));
      },
    });

    const requestedCount = input.limit || 1;
    const usedMarketReferenceTitles = new Set(input.usedMarketReferenceTitles || []);
    const availableMarketReferences = marketReferences.filter(reference => !usedMarketReferenceTitles.has(reference.sourceTitle));
    const sourceMode = input.topicSourceMode || 'mixed';
    const marketCount = sourceMode === 'long_tail' ? 0 : availableMarketReferences.length
      ? sourceMode === 'market' ? requestedCount : Math.max(1, Math.ceil(requestedCount * 0.7)) : 0;
    const longTailCount = sourceMode === 'market' ? 0 : requestedCount - marketCount;
    const initial = longTailCount > 0
      ? await callTopicBatch({ ...promptInput, count: longTailCount, scopePlan: modelScopePlan.slice(marketCount) }, 1)
      : null;
    const marketInitial = marketCount > 0
      ? await callMarketBatch({
        product: getProductPromptProfile(input.productId).noteIdentity,
        exam: examContext?.displayIdentity || (input.productId.includes('delf') ? 'DELF B2' : 'TCF Canada'),
        count: marketCount,
        marketReferences: availableMarketReferences,
        recentTopics: [...(input.recentAngles || []), ...(input.avoidTopics || [])].slice(-30).map(text => text.split('；交付：')[0]),
        priorTopics: [...(input.recentAngles || []), ...(input.avoidTopics || [])].slice(-30).map(text => text.split('；交付：')[0]),
        supportingAssets,
      }, 1)
      : null;
    let usage = mergeAiUsage(initial?.usage || emptyAiUsage(), marketInitial?.usage || emptyAiUsage());
    let requestId = marketInitial?.requestId || initial?.requestId || stableHash(JSON.stringify(promptInput));
    const rawByIndex = new Map<number, Partial<TopicOption> & Record<string, unknown>>();
    const isComplete = (raw: Partial<TopicOption> & Record<string, unknown> | undefined) => Boolean(raw?.topic && raw?.promise && raw?.audienceState && raw?.painOrDesire);
    const acceptedMarketReferenceTitles = new Set(usedMarketReferenceTitles);
    (marketInitial?.data.topics || []).slice(0, marketCount).forEach((raw, index) => {
      const sourceTitle = raw.marketReference && typeof raw.marketReference === 'object'
        ? String((raw.marketReference as Record<string, unknown>).sourceTitle || '') : '';
      if (isComplete(raw) && sourceTitle && !acceptedMarketReferenceTitles.has(sourceTitle)) {
        acceptedMarketReferenceTitles.add(sourceTitle);
        rawByIndex.set(index, raw);
      }
    });
    (initial?.data.topics || []).slice(0, longTailCount).forEach((raw, index) => {
      if (isComplete(raw)) rawByIndex.set(marketCount + index, raw);
    });

    const initiallyMissing = Array.from({ length: requestedCount }, (_, index) => index).filter(index => !rawByIndex.has(index));
    if (initiallyMissing.length) {
      const missingMarket = initiallyMissing.filter(index => index < marketCount);
      const missingLongTail = initiallyMissing.filter(index => index >= marketCount);
      if (missingMarket.length) {
        const recovery = await callMarketBatch({
          product: getProductPromptProfile(input.productId).noteIdentity,
          exam: examContext?.displayIdentity || (input.productId.includes('delf') ? 'DELF B2' : 'TCF Canada'),
          count: missingMarket.length, marketReferences: marketReferences.filter(reference => !acceptedMarketReferenceTitles.has(reference.sourceTitle)),
          recentTopics: [...(input.recentAngles || []), ...(input.avoidTopics || [])].slice(-30).map(text => text.split('；交付：')[0]),
          priorTopics: Array.from(rawByIndex.values()).map(raw => String(raw.topic || '')).filter(Boolean),
          supportingAssets,
        }, 1);
        usage = mergeAiUsage(usage, recovery.usage); requestId = recovery.requestId;
        (recovery.data.topics || []).slice(0, missingMarket.length).forEach((raw, i) => {
          const sourceTitle = raw.marketReference && typeof raw.marketReference === 'object'
            ? String((raw.marketReference as Record<string, unknown>).sourceTitle || '') : '';
          if (isComplete(raw) && sourceTitle && !acceptedMarketReferenceTitles.has(sourceTitle)) {
            acceptedMarketReferenceTitles.add(sourceTitle); rawByIndex.set(missingMarket[i]!, raw);
          }
        });
      }
      if (missingLongTail.length) {
        const recovery = await callTopicBatch({ ...promptInput, count: missingLongTail.length,
          avoidTopics: [...promptInput.avoidTopics, ...Array.from(rawByIndex.values()).map(raw => String(raw.topic || ''))].filter(Boolean),
          scopePlan: missingLongTail.map(index => modelScopePlan[index]!),
        }, 1);
        usage = mergeAiUsage(usage, recovery.usage); requestId = recovery.requestId;
        (recovery.data.topics || []).slice(0, missingLongTail.length).forEach((raw, i) => { if (isComplete(raw)) rawByIndex.set(missingLongTail[i]!, raw); });
      }
    }

    const stillMissing = Array.from({ length: requestedCount }, (_, index) => index).filter(index => !rawByIndex.has(index));
    if (stillMissing.length) {
      throw Object.assign(new Error(`TOPIC_COUNT_INCOMPLETE: requested=${requestedCount}, complete=${requestedCount - stillMissing.length}`), { usage });
    }

    const scopeWarnings:string[]=[];
    const seenProblems=new Set<string>();
    const accepted:TopicOption[]=[];
    const topics: TopicOption[] = scopePlan.flatMap((plannedScope, index) => {
      const raw = rawByIndex.get(index)!;
      const topicText = String(raw.topic);
      const isMarket = raw.topicSource === 'market' && index < marketCount;
      const check=isMarket || input.topicScope==='medium'?{passed:true,reasons:[],warnings:[]}:checkAssignedLargeScope(topicText,String(raw.promise),plannedScope.requiredMotherTopics);
      const normalizedPain = String(raw.painOrDesire || topicText);
      const problemKey=normalizedPain.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'');
      const historic=(input.recentAngles||[]).map(t=>t.split('；交付：')[0]);
      const exactKey=(t:string)=>t.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      if(!check.passed || seenProblems.has(problemKey) || historic.some(t=>exactKey(t)===exactKey(topicText)) || accepted.some(t=>exactKey(t.topic)===exactKey(topicText))) {
        scopeWarnings.push(`slot ${plannedScope.slot}: ${check.reasons.join(',')||'DUPLICATE_TOPIC_OR_PROBLEM'}；${topicText}`);return [];
      }
      seenProblems.add(problemKey);
      for(const warning of check.warnings) scopeWarnings.push(`slot ${plannedScope.slot}: ${warning}；${topicText}`);
      const nearHistory=historic.find(text=>{
        const left=semanticBigrams(text),right=semanticBigrams(topicText);
        const union=new Set([...left,...right]).size;
        return union>0 && [...left].filter(token=>right.has(token)).length/union>=0.52;
      });
      if(nearHistory) scopeWarnings.push(`slot ${plannedScope.slot}: HISTORY_SIMILARITY_WARNING；${nearHistory}`);
      // 未经人工语义验收，不推断实际大型或中型；planned与actual分开保存。
      const topicLane: TopicLane = 'result_need';
      const candidate:TopicOption = {
        id: 'topic_' + stableHash(topicText + index), productId: input.productId,
        examScope: input.examScope,
        templateId: input.card.renderer_id, primaryGoal: 'save', topicLane,
        topicAssignment: {
          slot: plannedScope.slot,
          plannedGranularity: plannedScope.scope,
          scopeIntent: plannedScope.intent,
          coverageDomain: plannedScope.coverageDomain,
          domainFamily: plannedScope.domainFamily,
          coreProblem: plannedScope.coreProblem||String(raw.painOrDesire),
          domainId:plannedScope.domainId,
          scopeValidation:'passed',actualGranularity:'unverified',
          minimumCoverage: plannedScope.minimumCoverage,
          userAngle: String(raw.audienceState),
          deliveryAngle: '',
          rotationIndex,
          demandAudienceState: plannedScope.demand.situation || undefined,
          demandScene: plannedScope.demand.frustration || undefined,
          demandUrgentNeed: plannedScope.demand.desiredOutcome || undefined,
          demandCard: plannedScope.demand,
        },
        topic: topicText, audienceState: String(raw.audienceState || '正在关注这个备考入口'), painOrDesire: normalizedPain,
        promise: String(raw.promise || topicText), scene: isMarket ? '' : plannedScope.demand.frustration || '', contentAngle: '', productBridge: '',
        // 由已分配的需求卡和母题派生任务单基础字段；这些是给下游内容节点的
        // 内部约束，不会要求模型把“体系/目录”写成公开 topic。
        expandContents: [...plannedScope.requiredMotherTopics],
        speechAction: plannedScope.demand.desiredOutcome || `帮读者把「${plannedScope.coreProblem}」拆成能执行的准备动作`,
        openingEmotion: plannedScope.demand.frustration || String(raw.painOrDesire),
        seo: { primary: getProductPromptProfile(input.productId).seoKeywords[0] || getProductPromptProfile(input.productId).noteIdentity, related: [] }, knowledgeMode: 'mixed',
        factTerms: [], seedSignals: [], noveltyFingerprint: stableHash(topicText),
        topicSource: raw.topicSource === 'market' ? 'market' : 'long_tail',
        clickReasonId: typeof raw.clickReasonId === 'string' ? raw.clickReasonId : undefined,
        clickReason: typeof raw.clickReason === 'string' ? raw.clickReason : undefined,
        topicCore: typeof raw.topicCore === 'string' ? raw.topicCore : undefined,
        ...(isMarket ? { imitationMode: raw.imitationMode === 'DIRECT_NEIGHBOR' ? 'DIRECT_NEIGHBOR' : 'STRUCTURE_ONLY' as const } : {}),
        ...(raw.marketReference && typeof raw.marketReference === 'object' ? { marketReference: raw.marketReference as TopicOption['marketReference'] } : {}),
      };
      accepted.push(candidate);return [candidate];
    });
    if(!topics.length) throw Object.assign(new Error(`TOPIC_SCOPE_NOT_MET: ${scopeWarnings.join('；')}`),{usage});
    return artifact(topics, stableHash(promptInput), usage, requestId, scopeWarnings);

  }
  const legacyPrompt = await buildLegacyTopicPrompt(input);
  const result = await callOpenAICompatibleJsonWithUsage<RawTopicResponse>([
    { role: 'system', content: legacyPrompt.system },
    { role: 'user', content: legacyPrompt.user },
  ], { maxTokens: topicOutputTokenBudget(legacyPrompt.limit), temperature: 0.8, retries: 2 });

  // legacy 路径的局部变量全部从同源 builder 派生，语义与提取前一致。
  const limit = legacyPrompt.limit;
  const productShowcaseMode = legacyPrompt.productShowcaseMode;
  const inputHash = stableHash(legacyPrompt.promptInput);
  const profile = getProductPromptProfile(input.productId);
  const responseData = result.data as RawTopicResponse | Partial<TopicOption>[] | Record<string, unknown>;
  const rawTopics = Array.isArray(responseData)
    ? responseData
    : Array.isArray((responseData as RawTopicResponse)?.topics)
      ? (responseData as RawTopicResponse).topics || []
      : [];
  const normalizedTopics = rawTopics
    .map((raw, index) => normalizeTopic(raw, input, index))
    .filter((topic): topic is TopicOption => Boolean(topic));
  const rejected = normalizedTopics.filter(topic => topicGateFailures(topic, input).some(failure => TOPIC_HARD_FAILURES.has(failure)));
  const topics = selectTopicPortfolio(normalizedTopics, input, limit);
  const softWarnings = topics.flatMap(topic => topicGateFailures(topic, input)
    .filter(failure => !TOPIC_HARD_FAILURES.has(failure))
    .map(failure => `${topic.topic}: ${failure}`));
  // 可见性增强：每个被闸门淘汰的候选都要带着死因透出到 warnings，
  // 供调用方/审计方回查“每个候选死在哪条闸”。不改变淘汰/降级/兜底逻辑。
  const candidateFailureWarnings = normalizedTopics
    .filter(topic => !topics.includes(topic))
    .flatMap(topic => {
      const failures = topicGateFailures(topic, input);
      return failures.length ? [`选题候选被闸门淘汰“${topic.topic}”：${failures.join('、')}`] : [];
    });
  if (topics.length < limit) {
    console.error('[v2-topic-rejected]', JSON.stringify({
      product_id: input.productId,
      card_id: input.card.id,
      response_keys: responseData && typeof responseData === 'object' && !Array.isArray(responseData) ? Object.keys(responseData) : [],
      raw_count: rawTopics.length,
      normalized_count: normalizedTopics.length,
      rejected: rejected.map(topic => ({ topic: topic.topic, failures: topicGateFailures(topic, input), public_text: publicTopicText(topic) })),
      response_preview: JSON.stringify(responseData).slice(0, 3000),
    }));
    if (topics.length > 0) {
      return artifact(
        topics.slice(0, limit),
        inputHash,
        result.usage,
        result.requestId,
        [`AI返回${topics.length}个可用选题，少于请求的${limit}个；已继续生成，不阻断任务。`, ...softWarnings, ...candidateFailureWarnings],
      );
    }
    // 单卡只请求一个选题时，不要因为唯一候选的轻微封面形态偏差整卡失败。
    // 只要没有跨商品/跨模式风险，就保留这条选题，让后续内容围绕它生成并显示提醒。
    const fallback = normalizedTopics.find(topic => {
      const failures = topicGateFailures(topic, input);
      return !failures.includes('cross_product_identity') && !failures.includes('product_showcase_mode_mismatch');
    });
    if (fallback) {
      return artifact(
        [fallback],
        inputHash,
        result.usage,
        result.requestId,
        [`唯一候选存在轻微匹配提醒，已继续生成：${topicGateFailures(fallback, input).join('、') || '无'}`, ...candidateFailureWarnings.filter(item => !item.includes(`“${fallback.topic}”`))],
      );
    }
    if (productShowcaseMode) {
      // 商品介绍模式的单位是“选中的封面截图”。某张截图的 LLM 结构化
      // 返回偶发失败时，不能让整批只剩前面已经落盘的几张卡；用当前卡的
      // 展示机制生成一个保守选题，后续标题/正文仍按正常链路继续。
      const fallbackTopic: TopicOption = {
        id: `showcase_fallback_${input.card.id}_${stableHash(input.productId)}`,
        productId: input.productId,
        templateId: input.capability.renderer,
        primaryGoal: input.capability.allowedGoals.includes('conversion') ? 'conversion' : input.capability.allowedGoals[0] || 'click',
        topicLane: 'product_value',
        topic: `${profile.noteIdentity}资料包里到底有什么：从${input.card.name}看真实内容`,
        audienceState: '正在准备法语考试、想先看清资料内容再决定是否购买的人',
        scene: '用户刷到资料截图，想判断这套资料是否值得保存和购买',
        painOrDesire: '不知道资料包具体包含什么，也不知道拿到后怎么用',
        promise: '用真实资料页说明内容结构、具体价值和使用方式',
        contentAngle: input.card.content_mechanism,
        plannedBlockKind: input.capability.acceptedBlockKinds[0],
        productBridge: `这张${input.card.name}截图对应商品中的真实资料内容`,
        seo: { primary: profile.noteIdentity, related: ['备考资料', '资料包'] },
        knowledgeMode: 'product_grounded',
        factTerms: [input.card.name, '目录', '资料内容'],
        seedSignals: ['showcase-fallback'],
        noveltyFingerprint: `showcase|${input.card.id}|${input.productId}`,
      };
      return artifact(
        [fallbackTopic],
        inputHash,
        result.usage,
        result.requestId,
        [`本张封面选题结构化返回失败，已使用该封面的商品介绍兜底选题：${input.card.name}`, ...candidateFailureWarnings],
      );
    }
    throw new Error(`V2选题阶段没有得到合格选题（原始${rawTopics.length}，规则拒绝${rejected.length}）`);
  }

  return artifact(topics.slice(0, limit), inputHash, result.usage, result.requestId, [...softWarnings, ...candidateFailureWarnings]);
}

export interface LegacyTopicPrompt {
  system: string;
  user: string;
  promptInput: Record<string, unknown>;
  charCount: number;
  limit: number;
  productShowcaseMode: boolean;
}

/**
 * legacy 选题 prompt 组装（从 generateTopicOptions 原样提取，未改任何字符）。
 * 提取目的：共识分支用它量 legacy prompt 字符数，按 130% 给 5 块契约设上限（§8.1-7）。
 * 商品2/3 + showcase 仍走 generateTopicOptions 的 legacy 分支；商品2/3的普通
 * AI原创只增加商品边界和范围提示，不复用商品1的共识选题字段。
 */
async function buildLegacyTopicPrompt(input: TopicStageInput): Promise<LegacyTopicPrompt> {
  const profile = getProductPromptProfile(input.productId);
  const templateSpec = getCoverTemplateSpec(input.capability.renderer);
  const keywords = getXhsSearchKeywords(input.productId);
  const history = await getRecentTitleFingerprints(input.productId, { days: 30 });
  const factSignals = summarizeFacts(input.facts, `${input.card.id}|${history.records.length}`);
  const verifiedExamFacts = listVerifiedExamFacts(input.productId);
  // 前台已经允许普通 AI 原创批次一次请求 1–20 篇，选题节点必须如实接收。
  // 过去在这里截成 6，10 篇请求实际上只会让模型看到 6；2200 输出 token
  // 又不足以容纳多条完整结构化任务单，最终被静默落盘成半批。
  const limit = Math.max(1, Math.min(20, input.limit ?? 1));
  const candidateCount = limit;
  const productShowcaseMode = input.contentMode === 'product_showcase';
  const examContext = examScopeContext(input.productId, input.examScope);
  const educationalScaleGuidance = input.productId === 'tef_tcf_canada'
    ? {
      large: '大范围必须覆盖TEF/TCF Canada备考中的一整科、四科关系、选考判断或完整备考阶段；不能缩水成单一语法点、单一技巧或单一任务。',
      medium: '中等范围只解决一个完整能力块或任务，例如一科、一个题型群、一个计划阶段或一套自测动作。',
    }
    : input.productId === 'tcf_canada_writing_7day'
      ? {
        large: '大范围必须覆盖TCF Canada写作整体、T1/T2/T3完整题型群，或7天考前准备的完整阶段；不能缩水成单一任务、单一语法点或单个表达。',
        medium: '中等范围只解决一个完整能力块或任务，例如T1/T2/T3中的一类、观点展开、格式核对或一天的训练重点。',
      }
      : undefined;
  const promptInput = {
    product: {
      id: input.productId,
      identity: profile.noteIdentity,
      scope: profile.topicScopePrompt,
      product_facts: factSignals,
      verified_exam_facts: verifiedExamFacts.map(item => ({ id: item.id, text: item.text })),
    },
    cover: {
      id: input.card.id,
      name: input.card.name,
      family: input.capability.family,
      compiler: input.capability.compiler,
      content_mechanism: input.card.content_mechanism,
      click_mechanism: input.card.click_mechanism,
      accepted_blocks: input.capability.acceptedBlockKinds,
      allowed_goals: input.capability.allowedGoals,
      content_instruction: templateSpec?.contentInstruction || '',
      forbidden_instruction: templateSpec?.forbiddenInstruction || '',
    },
    search_signals: [...keywords.primary, ...keywords.secondary].slice(0, 12),
    recent_topics_to_avoid: [...history.recentTopics.slice(-20), ...(input.recentAngles || []).slice(-20)],
    current_batch_topics_to_avoid: (input.recentAngles || []).slice(-20),
    direction: input.direction || '',
    ...(examContext ? { exam_scope: { scope: input.examScope, identity: examContext.displayIdentity, audience: examContext.audience, rule: examContext.rule } } : {}),
    requested_content_mode: input.contentMode || 'standard',
    ...(educationalScaleGuidance ? {
      topic_scope: input.topicScope || 'large',
      topic_scope_guidance: educationalScaleGuidance,
    } : {}),
    count: candidateCount,
  };
  const system = [
    '你是资深小红书法语教育编辑。当前阶段只决定“这篇笔记讲什么”，不要写标题、正文、封面文案或内页文案。',
    '先写出一条自然、具体、用户看得懂的选题，再补齐结构字段。选题质量优先级：商品身份正确 > 用户确实会遇到 > 说人话 > 能被当前封面承载 > 有自然搜索词 > 能承接商品。',
    '每个候选必须输出 plannedBlockKind，值只能从 cover.accepted_blocks 中选择；它只是后续排版提示，不要为了迁就它改变选题主题。',
    '人群、场景、痛点、承诺和商品承接是给后续写作使用的背景字段，不要把这些字段名硬塞进公开选题句子。',
    productShowcaseMode
      ? `当前是“介绍知识库”模式：输出${candidateCount}个明显不同的商品介绍选题，全部使用topicLane=product_value；primaryGoal优先用conversion，若当前封面不支持conversion则用该封面允许的目标。每个选题都要有不同的商品展示角度，例如目录结构、模块组合、样张使用、适合人群、备考场景或资料稀缺价值，不能退回普通知识分享。`
      : `输出${candidateCount}个明显不同的候选；当数量为1时只输出1个最合适的选题，不要额外扩写。`,
    candidateCount > 1
      ? '这是同一批次的多个独立名额：先在内部为每条分配不同的“用户卡点 + 内容对象”，再输出。不得把同一个选题仅替换“从头练 / 全拆解 / 三题讲清 / 怎么练”等措辞后重复提交。每条的 audienceState、scene、painOrDesire 必须对应一个具体的备考瞬间或动作卡点；公开topic要让用户一眼看出“我正卡在这里”，不能只写考试科目目录或课程总览。'
      : '',
    'topicLane=broad_pain讲用户普遍遇到的大问题；result_need讲用户想获得的结果或省事方法；narrow_knowledge讲一个具体但真实有用的知识点；product_value讲资料包能给用户带来的具体获得感，不等于罗列目录。',
    '当前封面只决定视觉承载方式，不决定内容主题。痛点/真人经验封面优先写用户经历和问题；表格/目录封面优先写可分组、可对照、可速查的内容；不要为了套模板硬改商品主题。',
    '大痛点要像备考者平时会说的话，表达具体问题和想要的结果，避免抽象运营术语、广告腔和生硬的“X→Y”句式。',
    '细分干货可以具体，但要有上位需求；商品展示不能只罗列页数和模块，要说明用户为什么需要看。',
    'SEO词只自然选择1个主词和少量相关词，不堆词。不得复制近期选题，不得跨商品。',
    'product_facts 是商品内容、方法和卖点，不自动等于官方考试规则；verified_exam_facts 才能支撑“官方要求、评分标准、题数、时长、最低字数”等硬事实。没有证据时可以做学习建议或科普，但不要伪装成官方规则。',
    ...(examContext ? [`当前考试范围：${examContext.rule} 目标读者：${examContext.audience}`] : []),
    input.productId === 'delf_b2_writing'
      ? 'DELF B2 写作官方评分是 5 个维度按表现档位评分，不是按错误逐项扣分。禁止写“考官逐条扣分、每错一项扣几分、扣分表”这类错误角度。'
      : '当前商品的考试规则、评分、时长、题型和分数换算只能按给定证据表达；没有证据时写成备考建议，不要冒充官方规则。',
    input.productId === 'delf_b2_writing'
      ? '评分选题优先做“5个维度如何自查、四档表现是什么意思”；不要把AI原创例文包装成官方0分/5分标准答案，也不要承诺模拟考官精确打分。'
      : educationalScaleGuidance
        ? `本批选择的是${input.topicScope === 'medium' ? '中等范围' : '大范围'}：${educationalScaleGuidance[input.topicScope === 'medium' ? 'medium' : 'large']} 公开topic必须自然、具体、让备考者看得懂，不用“体系/地图/全景”等大词伪装范围。`
        : '',
    'primaryGoal只能是search/save/click/conversion；knowledgeMode只能是product_grounded/exam_grounded/educational_original/mixed。',
    '只返回JSON对象，顶层字段topics。每项必须使用这些字段：id, primaryGoal, topicLane, topic, audienceState, scene, painOrDesire, promise, contentAngle, productBridge, seo{primary,related}, knowledgeMode, factTerms, seedSignals, noveltyFingerprint, topicSource, marketReference。topicSource必须是market或long_tail；market必须引用输入中的真实市场母题并回填marketReference.sourceTitle，long_tail时marketReference省略。',
    '禁止返回旧字段title、targetAudience、useCase、painPoint、sellingPoint、knowledgeAsset、contentModule、coverBlock、searchKeywords、avoidDuplicate。',
  ].join('\n');
  const user = JSON.stringify(promptInput);
  return { system, user, promptInput, charCount: system.length + user.length, limit, productShowcaseMode };
}

function topicOutputTokenBudget(candidateCount: number) {
  // 每条含 topic/audience/scene/pain/promise 等字段。按篇数扩容，避免多篇
  // JSON 在输出上限处截断；20 篇仍保留可控上限。
  return Math.min(12_000, Math.max(2_200, 700 + candidateCount * 520));
}

/**
 * 共识分支包装：AI 客户端与 legacy 同源同重试语义（callOpenAICompatibleJsonWithUsage，
 * maxTokens 2200 / temperature 0.8 / retries 2），只是把 result.usage/resultId 捕获进
 * 工件元数据。5 块契约字符预算 = legacy prompt × 1.3（§8.1-7）。
 */
async function generateTopicOptionsViaConsensus(input: TopicStageInput): Promise<VersionedArtifact<TopicOption[]>> {
  const legacyPrompt = await buildLegacyTopicPrompt(input);
  const marketReferences = await getMarketTopicReferences(input.productId, 20);
  let captured: { usage: AiUsageSummary; requestId: string } | undefined;
  const aiCall: ConsensusTopicAiCall = async messages => {
    const result = await callOpenAICompatibleJsonWithUsage<Record<string, unknown>>(messages, {
      maxTokens: 2200,
      temperature: 0.8,
      retries: 2,
    });
    captured = { usage: result.usage, requestId: result.requestId };
    return result.data;
  };
      const result = await generateTopicOptionsConsensus(
    {
      productId: input.productId,
      card: input.card,
      capability: input.capability,
      mode: input.topicMode || 'single',
      userDirection: input.direction,
      recentAngles: input.recentAngles,
      batchTopicSlotId: input.batchTopicSlotId,
      batchEditorialTask: input.batchEditorialTask,
      marketReferences,
      topicSourceMode: input.topicSourceMode,
      charBudget: getConsensusPromptBudget(legacyPrompt.charCount),
    },
    aiCall,
      );
  // §8.1-4：逐候选死因已由 consensus 阶段写入 result.warnings（单一来源），这里原样透传。
  const sourceFilteredData = input.topicSourceMode === 'market'
    ? result.data.filter(topic => topic.topicSource === 'market' && topic.marketReference?.sourceTitle)
    : input.topicSourceMode === 'long_tail'
      ? result.data.filter(topic => topic.topicSource !== 'market')
      : result.data;
  return {
    data: sourceFilteredData,
    schema_version: V2_SCHEMA_VERSION,
    prompt_version: result.promptVersion,
    input_hash: stableHash({ source: 'consensus', productId: input.productId, cardId: input.card.id, fingerprint: sourceFilteredData.map(topic => topic.noveltyFingerprint) }),
    created_at: new Date().toISOString(),
    usage: captured?.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, calls: 0, autofix_count: 0, autofix_events: [] },
    warnings: result.warnings,
    request_id: captured?.requestId,
    needsManualReview: result.needsManualReview ? true : undefined,
  };
}

export function topicOptionToMigrated(topic: TopicOption): MigratedTopic & { v2_topic: TopicOption } {
  return {
    id: topic.id,
    exam_scope: topic.examScope,
    scope_level: topic.topicAssignment?.scopeValidation==='passed' ? 'broad' : topic.topicGranularity
      ? (topic.topicGranularity === 'level_3_micro' ? 'narrow' : 'broad')
      : topic.primaryGoal === 'search' || topic.primaryGoal === 'conversion' ? 'broad' : 'narrow',
    topic_type: topic.primaryGoal === 'search' ? 'search_pain' : topic.primaryGoal === 'conversion' ? 'product_showcase' : topic.primaryGoal === 'save' ? 'selling_point' : 'narrow_knowledge',
    topic: topic.topic,
    topicSource: topic.topicSource,
    marketReference: topic.marketReference,
    imitationMode: topic.imitationMode,
    clickReasonId: topic.clickReasonId,
    clickReason: topic.clickReason,
    primaryReferenceTitle: topic.primaryReferenceTitle,
    referenceId: topic.referenceId,
    referenceTopicCoreSeed: topic.referenceTopicCoreSeed,
    delfWritingTopicCoreSeed: topic.delfWritingTopicCoreSeed,
    referenceTitleSkeleton: topic.referenceTitleSkeleton,
    skeletonInstantiation: topic.skeletonInstantiation,
    referenceCandidates: topic.referenceCandidates,
    referenceIndexWithinReason: topic.referenceIndexWithinReason,
    rawModelFinalTopic: topic.rawModelFinalTopic,
    postprocessedFinalTopic: topic.postprocessedFinalTopic,
    historicalTopicCoresForReasonCount: topic.historicalTopicCoresForReasonCount,
    topicCore: topic.topicCore,
    audience: topic.audienceState,
    scene: topic.scene,
    pain: topic.painOrDesire,
    content_promise: topic.promise,
    product_bridge: topic.productBridge,
    why_this_reference_fits: topic.contentAngle,
    novelty: topic.noveltyFingerprint,
    search_terms: [topic.seo.primary, ...topic.seo.related].filter(Boolean),
    content_source_plan: {
      knowledge_base: topic.knowledgeMode === 'educational_original' ? '不检索本地知识库' : '按factTerms检索少量商品事实',
      ai_original: topic.knowledgeMode === 'product_grounded' ? '只补表达与组织方式' : '可原创科普、方法、解释和示例',
    },
    dynamic_fact_terms: topic.factTerms,
    title_trigger_types: topic.seedSignals,
    content_shape: undefined,
    v2_topic: topic,
  };
}

export function migratedToTopicOption(topic: MigratedTopic & { v2_topic?: TopicOption }, productId: ProductId, card: CompetitorCreativeCard): TopicOption {
  if (topic.v2_topic) return topic.v2_topic;
  return {
    id: topic.id || `topic_${stableHash(topic.topic)}`,
    examScope: topic.exam_scope,
    productId,
    templateId: card.renderer_id,
    primaryGoal: topic.topic_type === 'product_showcase' ? 'conversion' : topic.topic_type === 'search_pain' ? 'search' : topic.topic_type === 'selling_point' ? 'save' : 'click',
    topicLane: topic.topic_type === 'product_showcase' ? 'product_value' : topic.topic_type === 'search_pain' ? 'broad_pain' : topic.topic_type === 'selling_point' ? 'result_need' : 'narrow_knowledge',
    topic: topic.topic,
    topicSource: topic.topicSource || 'long_tail',
    marketReference: topic.marketReference,
    audienceState: topic.audience,
    scene: topic.scene,
    painOrDesire: topic.pain,
    promise: topic.content_promise,
    contentAngle: topic.why_this_reference_fits,
    plannedBlockKind: inferPlannedBlockKind(card, topic.why_this_reference_fits),
    productBridge: topic.product_bridge,
    seo: { primary: topic.search_terms?.[0] || getProductPromptProfile(productId).noteIdentity, related: topic.search_terms?.slice(1, 5) || [] },
    knowledgeMode: topic.content_source_plan?.ai_original?.includes('原创') ? 'mixed' : 'product_grounded',
    factTerms: topic.dynamic_fact_terms || topic.search_terms || [],
    seedSignals: topic.title_trigger_types || [],
    noveltyFingerprint: topic.novelty || stableHash(`${topic.topic}|${topic.content_promise}`),
  };
}

function normalizeTopic(raw: Partial<TopicOption> & Record<string, unknown>, input: TopicStageInput, index: number): TopicOption | null {
  const requestedGoal = ['search', 'save', 'click', 'conversion'].includes(String(raw.primaryGoal)) ? raw.primaryGoal as TopicOption['primaryGoal'] : undefined;
  const goal = requestedGoal && input.capability.allowedGoals.includes(requestedGoal)
    ? requestedGoal
    : input.capability.allowedGoals[index % input.capability.allowedGoals.length];
  const topic = clean(raw.topic) || clean(raw.title);
  if (!topic) return null;
  const searchKeywords = unique(raw.searchKeywords);
  const seoPrimary = clean(raw.seo?.primary) || searchKeywords[0] || getProductPromptProfile(input.productId).noteIdentity;
  const audienceState = clean(raw.audienceState) || resolveFactRef(input.facts, raw.targetAudience);
  const scene = clean(raw.scene) || resolveFactRef(input.facts, raw.useCase);
  const painOrDesire = clean(raw.painOrDesire) || resolveFactRef(input.facts, raw.painPoint);
  const sellingPoint = resolveFactRef(input.facts, raw.sellingPoint);
  const knowledgeAsset = resolveFactRef(input.facts, raw.knowledgeAsset);
  const contentModule = resolveFactRef(input.facts, raw.contentModule);
  return {
    id: clean(raw.id) || `v2_topic_${stableHash(`${input.card.id}|${topic}`)}`,
    productId: input.productId,
    examScope: input.examScope,
    templateId: input.card.renderer_id,
    primaryGoal: goal,
    topicLane: normalizeTopicLane(raw.topicLane, goal, topic, index),
    topic,
    topicSource: raw.topicSource === 'market' ? 'market' : 'long_tail',
    ...(raw.marketReference && typeof raw.marketReference === 'object' ? { marketReference: raw.marketReference as TopicOption['marketReference'] } : {}),
    audienceState,
    scene,
    painOrDesire,
    promise: clean(raw.promise) || sellingPoint || clean(raw.avoidDuplicate),
    contentAngle: clean(raw.contentAngle) || [knowledgeAsset, contentModule].filter(Boolean).join('；'),
    plannedBlockKind: normalizePlannedBlockKind(raw.plannedBlockKind, input.capability),
    productBridge: clean(raw.productBridge) || sellingPoint,
    seo: { primary: seoPrimary, related: unique(raw.seo?.related).concat(searchKeywords.slice(1)).slice(0, 5) },
    knowledgeMode: ['product_grounded', 'exam_grounded', 'educational_original', 'mixed'].includes(String(raw.knowledgeMode)) ? raw.knowledgeMode as TopicOption['knowledgeMode'] : 'mixed',
    factTerms: unique(raw.factTerms).concat([knowledgeAsset, contentModule].filter(Boolean)).slice(0, 8),
    seedSignals: unique(raw.seedSignals).concat(unique([raw.coverBlock])).slice(0, 8),
    noveltyFingerprint: clean(raw.noveltyFingerprint) || stableHash(`${goal}|${topic}|${raw.contentAngle || ''}`),
  };
}

function resolveFactRef(facts: ProductFacts, value: unknown): string {
  const ref = clean(value);
  if (!ref) return '';
  for (const items of Object.values(facts)) {
    const match = items.find(item => item.id === ref);
    if (match) return clean(match.text);
  }
  return ref;
}

function summarizeFacts(facts: ProductFacts, rotationSeed: string) {
  return Object.fromEntries(Object.entries(facts).map(([category, items]) => {
    if (!items.length) return [category, []];
    // 选题只需要知道商品有哪些方向，不需要读取整张事实卡。
    // 完整事实卡留给选题确定后的 resolveProductEvidence；否则每个封面都会重复发送
    // 全量事实，17个封面会把同一份资料发送17遍。
    const coreCount = category === 'raw_pain_points' || category === 'raw_selling_points' ? 2 : 1;
    const targetCount = category === 'knowledge_assets' || category === 'displayable_assets' ? 5 : 4;
    const core = items.slice(0, coreCount);
    const remaining = items.slice(coreCount);
    const start = remaining.length
      ? parseInt(stableHash(`${rotationSeed}|${category}`), 36) % remaining.length
      : 0;
    const rotated = remaining.length
      ? [...remaining.slice(start), ...remaining.slice(0, start)].slice(0, Math.max(0, targetCount - core.length))
      : [];
    return [category, [...core, ...rotated].map(item => ({
      id: item.id,
      text: item.text.slice(0, 120),
      keywords: item.raw_keywords.slice(0, 8),
    }))];
  }));
}

function publicTopicText(topic: TopicOption) {
  return [topic.topic, topic.audienceState, topic.scene, topic.painOrDesire, topic.promise, topic.productBridge].join(' ');
}

function hasUnsupportedExamFraming(topic: TopicOption) {
  const text = publicTopicText(topic);
  return /(?:考官.{0,10}(?:逐条|每项|怎么).{0,8}扣分|每错.{0,10}扣.{0,4}分|逐项扣分表|错误扣分表)/i.test(text);
}

export function diagnoseTopicOption(topic: TopicOption, input: Pick<TopicStageInput, 'productId' | 'capability'>) {
  return topicGateFailures(topic, input);
}

export function selectTopicPortfolio(
  topics: TopicOption[],
  input: Pick<TopicStageInput, 'productId' | 'capability' | 'contentMode'>,
  maxTopics = 4,
) {
  const eligible = topics.filter(topic => topicGateFailures(topic, input).every(failure => !TOPIC_HARD_FAILURES.has(failure)));
  const selected: TopicOption[] = [];
  const requiredLanes = input.contentMode === 'product_showcase'
    ? (['product_value'] as TopicLane[])
    : REQUIRED_TOPIC_LANES;
  for (const lane of requiredLanes) {
    const candidate = eligible.find(topic => topic.topicLane === lane && !isNearDuplicate(topic, selected));
    if (candidate) selected.push(candidate);
  }
  for (const candidate of eligible) {
    if (selected.length >= maxTopics) break;
    if (!selected.includes(candidate) && !isNearDuplicate(candidate, selected)) selected.push(candidate);
  }
  return selected.slice(0, maxTopics);
}

function topicGateFailures(topic: TopicOption, input: Pick<TopicStageInput, 'productId' | 'capability' | 'contentMode'>) {
  const failures: string[] = [];
  const publicText = publicTopicText(topic);
  if (hasForbiddenProductIdentity(input.productId, publicText)) failures.push('cross_product_identity');
  if (hasUnsupportedExamFraming(topic)) failures.push('unsupported_exam_framing');
  if (MACHINE_TOPIC_PATTERN.test(publicText)) failures.push('machine_expression');
  if (!input.capability.allowedGoals.includes(topic.primaryGoal)) failures.push('cover_goal_mismatch');
  if (topicShapeMismatch(topic, input.capability)) failures.push('cover_content_shape_mismatch');
  if (explicitStepCountMismatch(topic)) failures.push('cover_content_shape_mismatch');
  if (!topic.topic || !topic.audienceState || !topic.painOrDesire || !topic.promise) failures.push('missing_user_context');
  if (!topic.productBridge) failures.push('missing_product_bridge');
  if (!topic.seo.primary) failures.push('missing_seo_primary');
  if (input.contentMode === 'product_showcase' && topic.topicLane !== 'product_value') {
    failures.push('product_showcase_mode_mismatch');
  }
  return failures;
}

export function topicShapeMismatch(topic: TopicOption, capability: TemplateCapability) {
  const angle = `${topic.topic} ${topic.promise} ${topic.contentAngle} ${(topic.expandContents || []).join(' ')}`;
  if (topic.plannedBlockKind && !capability.acceptedBlockKinds.includes(topic.plannedBlockKind)) return true;
  // 今日新增模板复刻的是版式，不是原图学科。这里按各版式真实承载能力做二级闸门，
  // 避免用户手选“三列词汇密表”后却生成学习路径或长篇经验。
  if (capability.renderer === 'criminal_law_formula') {
    return !/(?:公式|结构|框架|步骤|检查|审题|答题|段落功能)/i.test(angle)
      || /(?:词汇表|长篇经历|完整范文|逐句精读)/i.test(angle);
  }
  if (capability.renderer === 'english_grammar_grid' || capability.renderer === 'english_grammar_notebook') {
    return !/(?:语法|时态|语式|代词|关系词|连接|句型|规则|易错|口诀)/i.test(angle)
      || /(?:学习路径|真人经历|完整范文)/i.test(angle);
  }
  if (capability.renderer === 'mao_article_notes') {
    return !/(?:原句|例句|范文|真题|模拟题|素材|观点|解析|拆解|改写|迁移|精读)/i.test(angle)
      || /(?:学习路径|纯词汇表|真人经历)/i.test(angle);
  }
  if (capability.renderer === 'french_oral_question_bank') {
    return !/(?:题库|题目|问题|追问|口语题|写作题|主题题)/i.test(angle)
      || /(?:语法规则|学习路径|单词释义)/i.test(angle);
  }
  if (capability.renderer === 'french_a1_practice_sheet') {
    const fourPartAsset = /(?:观点|佐证|理由|概念|维度|词汇|单词|表达|短语|步骤|要点|自测|选择题|辨析|练习题|错句|语境选择|分类|清单)/i;
    return !fourPartAsset.test(angle) || /(?:长篇经历|完整故事|情绪随笔|单条金句)/i.test(angle);
  }
  if (capability.family === 'experience') {
    const listOrLessonPlan = /(?:先讲|再列|逐条|对照表|词汇表|短语表|清单|大全|速查|口诀|规则解析|句型整理|分组整理)/i;
    const experienceAngle = /(?:观察|经历|复盘|误区|场景|感受|变化|建议|为什么|少走弯路|容易犯|写不完|不会写|总是|考场)/i;
    return listOrLessonPlan.test(angle) || !experienceAngle.test(angle);
  }
  if (capability.family === 'phrase' || capability.family === 'flashcard' || capability.family === 'table') {
    const groupedLanguageAsset = /(?:词汇|短语|表达|搭配|句型|替换词|连接词|关系词|对照|话题词|主题词|动词|形容词|介词)/i;
    return /(?:长篇经历|完整故事|纯经验分享|情绪随笔|时间分配|复习规划|复习顺序|复习优先级|考前计划|第\s*[一二三四1234].{0,3}周|每周)/i.test(angle) || !groupedLanguageAsset.test(angle);
  }
  if (capability.family === 'directory') {
    const incompatible = /(?:完整故事|长篇经历|情绪随笔|个人成长叙事|第一人称复盘|单一经验|一个提醒|一个错误)/i.test(angle);
    const groupedAsset = /(?:体系|目录|分类|分组|清单|速查|对照|题型|维度|步骤|检查|表达库|句型库|知识点)/i.test(angle);
    return incompatible || !groupedAsset;
  }
  if (capability.family === 'pain') {
    const incompatible = /(?:词汇表|短语表|固定搭配表|资料目录|课程路径|阶段规划|逐句解析)/i.test(angle);
    const concretePain = /(?:写不完|不会写|卡在|总是|容易|丢分|跑题|记不住|用不上|改不动|来不及|看不懂|分不清|没思路|写得生硬)/i.test(angle);
    return incompatible || !concretePain;
  }
  if (capability.family === 'offer') {
    if (capability.renderer === 'official_notice') {
      return !/(?:提醒|通知|排查|核查|安排|重点|考前|阶段|注意事项)/i.test(angle);
    }
    if (capability.renderer === 'showcase_screenshot') {
      return !/(?:资料|知识库|范文库|句型库|观点库|目录|样张|截图|怎么用|能查到)/i.test(angle);
    }
    const pureLesson = /(?:只讲|专讲|逐句解释|语法规则解析|词义辨析|例句精讲)/i.test(angle);
    const productUse = /(?:资料|知识库|包含|适合|使用|解决|能查|怎么用|获得)/i.test(angle);
    const offerShape = /(?:适合|解决|包含|使用|怎么用|能查|获得|资料|知识库)/i.test(angle);
    return (pureLesson && !productUse) || !offerShape;
  }
  if (capability.family === 'document') {
    const incompatible = /(?:学习路径|阶段规划|真人经历|情绪故事|资料包介绍)/i.test(angle);
    const documentShape = /(?:原句|例句|范文|真题|题目|素材|评分表|解析|拆解|改写|迁移|批改|对照)/i.test(angle);
    return incompatible || !documentShape;
  }
  if (capability.family === 'roadmap') {
    const isolatedKnowledge = /(?:单词表|短语表|固定搭配|逐句解析|一条语法规则|单一技巧|一个错误)/i.test(angle);
    const roadmapShape = /(?:阶段|路径|计划|顺序|安排|从.+到|第\s*[一二三四1234].+步)/i.test(angle);
    return isolatedKnowledge || !roadmapShape;
  }
  if (capability.family === 'book') {
    const systemAsset = /(?:手册|指南|体系|专题|章节|方法合集|完整路径|从.+到)/i.test(angle);
    return /(?:单一提醒|一个错误|情绪故事|真人经历)/i.test(angle) || !systemAsset;
  }
  return false;
}

function explicitStepCountMismatch(topic: TopicOption) {
  const match = `${topic.topic} ${topic.promise}`.match(/([2-9二三四五六七八九])\s*(?:步|个步骤)/u);
  if (!match || !topic.expandContents?.length) return false;
  const chinese: Record<string, number> = { '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  const promised = Number(match[1]) || chinese[match[1]];
  return promised !== topic.expandContents.length;
}

function normalizePlannedBlockKind(value: unknown, capability: TemplateCapability) {
  const requested = clean(value) as TopicOption['plannedBlockKind'];
  return requested && capability.acceptedBlockKinds.includes(requested)
    ? requested
    : capability.acceptedBlockKinds[0];
}

function inferPlannedBlockKind(card: CompetitorCreativeCard, angle: string) {
  const capability = getCapabilityFallback(card);
  const text = clean(angle);
  const preferred = /(?:原句|例句|解析|改写)/i.test(text) ? 'example'
    : /(?:经历|复盘|观察|故事)/i.test(text) ? 'paragraph'
      : /(?:步骤|路径|阶段|顺序)/i.test(text) ? 'step'
        : /(?:收益|适合|解决|获得)/i.test(text) ? 'benefit'
          : /(?:短语|词汇|搭配|对照)/i.test(text) ? 'pair'
            : capability.acceptedBlockKinds[0];
  return capability.acceptedBlockKinds.includes(preferred as never)
    ? preferred as TopicOption['plannedBlockKind']
    : capability.acceptedBlockKinds[0];
}

function normalizeTopicLane(value: unknown, goal: TopicOption['primaryGoal'], topic: string, index: number): TopicLane {
  if (REQUIRED_TOPIC_LANES.includes(String(value) as TopicLane)) return String(value) as TopicLane;
  if (goal === 'conversion') return 'product_value';
  if (/资料|知识库|资料包|合集|大全|速查/.test(topic)) return 'product_value';
  if (/不会|写不好|分不清|不知道|总是|容易|常犯|丢分/.test(topic) || goal === 'search') return 'broad_pain';
  if (/方法|怎么|提分|省时|计划|路径|结果/.test(topic) || goal === 'save') return 'result_need';
  return REQUIRED_TOPIC_LANES[index % REQUIRED_TOPIC_LANES.length];
}

function isNearDuplicate(candidate: TopicOption, selected: TopicOption[]) {
  const candidateTokens = semanticBigrams(`${candidate.topic}${candidate.painOrDesire}${candidate.promise}`);
  return selected.some(item => {
    const tokens = semanticBigrams(`${item.topic}${item.painOrDesire}${item.promise}`);
    const intersection = Array.from(candidateTokens).filter(token => tokens.has(token)).length;
    const union = new Set([...candidateTokens, ...tokens]).size;
    return union > 0 && intersection / union >= 0.52;
  });
}

function semanticBigrams(value: string) {
  const normalized = value.toLowerCase()
    .replace(/delf|tef|tcf|canada|b2|法语|写作|备考|考试|资料|知识库|用户|人群|内容|方法/gi, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  const chars = Array.from(normalized);
  const tokens = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) tokens.add(`${chars[index]}${chars[index + 1]}`);
  return tokens;
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function unique(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(clean).filter(Boolean))) : [];
}

function artifact(data: TopicOption[], inputHash: string, usage: AiUsageSummary, requestId: string, warnings: string[] = []): VersionedArtifact<TopicOption[]> {
  return { data, schema_version: V2_SCHEMA_VERSION, prompt_version: TOPIC_PROMPT_VERSION, input_hash: inputHash, created_at: new Date().toISOString(), usage, warnings, request_id: requestId };
}

export function getCapabilityFallback(card: CompetitorCreativeCard): TemplateCapability {
  const spec = getCoverTemplateSpec(card.renderer_id);
  if (!spec) throw new Error(`模板 ${card.renderer_id} 没有V2能力配置`);
  return {
    renderer: card.renderer_id,
    family: spec.family,
    compiler: ['phrase', 'flashcard', 'table'].includes(spec.family) ? 'pairs' : ['pain', 'experience'].includes(spec.family) ? 'narrative' : spec.family === 'document' ? 'document' : spec.family === 'offer' || spec.family === 'roadmap' || spec.family === 'book' ? 'offer' : 'directory',
    renderMode: spec.renderMode,
    allowedGoals: spec.family === 'pain' || spec.family === 'experience' ? ['click', 'search'] : spec.family === 'offer' || spec.family === 'roadmap' ? ['conversion', 'save', 'search'] : ['save', 'search', 'click', 'conversion'],
    acceptedBlockKinds: ['phrase', 'flashcard', 'table'].includes(spec.family) ? ['pair', 'group'] : ['pain', 'experience'].includes(spec.family) ? ['paragraph', 'quote', 'step'] : spec.family === 'document' ? ['example', 'pair', 'group'] : spec.family === 'offer' || spec.family === 'roadmap' || spec.family === 'book' ? ['benefit', 'group', 'step'] : ['group', 'step', 'benefit'],
    allowedTitleMechanisms: spec.allowedCoverTitleTypes || [],
    densityTiers: buildTiers(
      spec.sectionRange || [spec.sectionCount, spec.sectionCount],
      spec.itemRange || [spec.itemsPerSection, spec.itemsPerSection],
      spec.maxPrimaryVisualLength,
      spec.maxSecondaryVisualLength,
    ),
    languagePolicy: spec.primaryFrenchOnly ? 'primary_french' : 'mixed',
  };
}

function buildTiers(sectionRange: [number, number], itemRange: [number, number], primary: number, secondary: number): TemplateCapability['densityTiers'] {
  const [sectionMin, sectionMax] = sectionRange;
  const [itemMin, itemMax] = itemRange;
  const compactSections = sectionMin;
  const normalSectionMin = sectionMin;
  // Small narrative/card templates use every item as part of their visual
  // structure (for example plain_experience is exactly two paragraphs).
  // Letting the compact tier subtract two would silently turn that contract
  // into a one-paragraph cover. Dense lists can still shed two items.
  const compactItemMin = itemMin;
  const compactItemMax = Math.max(itemMin, Math.min(itemMax, itemMin + 1));
  const normalItemMin = itemMin;
  const normalItemMax = itemMax;
  const denseItemMin = itemMax;
  return [
    { id: 'compact', sectionRange: [compactSections, compactSections], itemRange: [compactItemMin, compactItemMax], primaryVisualLength: [1, primary], secondaryVisualLength: [0, secondary] },
    { id: 'normal', sectionRange: [normalSectionMin, sectionMax], itemRange: [normalItemMin, normalItemMax], primaryVisualLength: [1, primary], secondaryVisualLength: [0, secondary] },
    { id: 'dense', sectionRange: [sectionMax, sectionMax], itemRange: [denseItemMin, denseItemMin], primaryVisualLength: [1, primary], secondaryVisualLength: [0, secondary] },
  ];
}
