import { callOpenAICompatibleJson, recordAutofixEvents } from '@/lib/ai-client';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getRoutedTitleFormulas } from '@/lib/full-title-formula-catalog';
import { getPublicEditorialRiskIssues, hasUnsupportedProductNumberClaim, normalizeTitleIdentity } from '@/lib/editorial-quality';
import { collectFrenchCheckTargets, findSuspiciousFrenchTokens } from '@/lib/french-spellcheck';
import { getCoverTemplatePrompt, getCoverTemplateSpec, type CoverTemplateSpec } from '@/lib/cover-template-specs';
import { retrieveProductFacts } from '@/lib/product-fact-retrieval';
import {
  getProductCoverFallbackTitle,
  getProductPromptProfile,
  hasForbiddenProductIdentity,
  hasRequiredProductIdentity,
  isProductPublicTextSafe,
} from '@/lib/product-prompt-profiles';
import { normalizeDenseDirectoryCover, validateReferenceDraft } from '@/lib/reference-workflow-validation';
import { getAvoidedLowTrafficKeywords, getTitleReferenceKeywords } from '@/lib/xhs-search-keywords';
import type { ProductId } from '@/types/data';
import type {
  ContentShape,
  CoverTitleCandidate,
  CreativeCardRenderer,
  GeneratedInnerPage,
  MigratedTopic,
  ReferenceDrivenDraft,
  TitleCandidate,
  TitleCandidateType,
  UnifiedContentBrief,
} from '@/types/reference-workflow';

type NormalizedCover = ReturnType<typeof normalizeDenseDirectoryCover>;

const FLEXIBLE_CAPACITY_FAMILIES = new Set<CoverTemplateSpec['family']>([
  'directory', 'document', 'offer', 'experience', 'pain', 'roadmap', 'phrase', 'table', 'book',
]);

export function autoFixCoverCapacity(cover: NormalizedCover, spec: CoverTemplateSpec): { cover: NormalizedCover; events: string[] } {
  const flexible = FLEXIBLE_CAPACITY_FAMILIES.has(spec.family);
  const maxSections = flexible ? spec.sectionCount + 1 : spec.sectionCount;
  const maxItems = flexible ? spec.itemsPerSection + 2 : spec.itemsPerSection;
  const events: string[] = [];
  const sections = cover.sections.map(section => ({ ...section, items: section.items.map(item => ({ ...item })) }));

  for (const section of sections) {
    if (section.items.length > maxItems) {
      events.push(`分组「${section.heading}」${section.items.length}条→截断为${maxItems}条`);
      section.items = section.items.slice(0, maxItems);
    }
  }
  while (sections.length > maxSections) {
    const last = sections.pop()!;
    const target = sections[sections.length - 1];
    target.items = [...target.items, ...last.items].slice(0, maxItems);
    events.push(`分组超上限，「${last.heading}」并入「${target.heading}」`);
  }
  return { cover: { ...cover, sections }, events };
}

export type ProductCard = NonNullable<ReturnType<typeof getCompetitorCreativeCard>>;

export interface GenerateTopicsInput {
  productId: ProductId;
  card: ProductCard;
  productContext: unknown;
  direction: string;
}

export interface RefineSeededTopicsInput {
  productId: ProductId;
  card: ProductCard;
  seededTopics: MigratedTopic[];
  direction: string;
}

export interface ComposeDraftInput {
  productId: ProductId;
  card: ProductCard;
  topic: MigratedTopic;
  evidence: ReturnType<typeof retrieveProductFacts>;
}

export type ComposeFailureStage = 'core' | 'editorial' | 'audit' | 'unknown';

export function classifyComposeError(error: Error | null): ComposeFailureStage {
  const message = error?.message || '';
  if (message.startsWith('标题或封面返修后仍未达标')) return 'core';
  if (message.startsWith('内页或正文返修后仍未达标')) return 'editorial';
  if (message.startsWith('法语与考试事实审校未通过')) return 'audit';
  return 'unknown';
}

export function isRetryableComposeError(error: Error): boolean {
  const message = error.message;
  if (/请求失败：4\d\d/.test(message)) return false;
  if (message.includes('缺少 OPENAI_API_KEY')) return false;
  return true;
}

export async function generateTopics(input: GenerateTopicsInput): Promise<MigratedTopic[]> {
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const profile = getProductPromptProfile(input.productId);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const avoidedTerms = getAvoidedLowTrafficKeywords(input.productId);

  // 选题 LLM 输出概率性偶发空（resource_10 等模板重跑 3 次仍空），原实现一次失败
  // 就抛错。这里加 topics-level 重试：最多调 3 次，跨调用按 topic 文本去重，凑够 3
  // 个为止；只要拿到 ≥1 个就不抛。prompt 没动，只是绕过 LLM 随机性。
  const collected: MigratedTopic[] = [];
  const seenTopics = new Set<string>();
  const MAX_TOPIC_CALLS = 3;

  for (let call = 0; call < MAX_TOPIC_CALLS && collected.length < 4; call += 1) {
    const result = await callOpenAICompatibleJson([
      {
        role: 'system',
        content: [
          '你是资深小红书法语学习内容主编。任务不是套模板，而是像真人编辑一样，从竞品成功机制出发迁移选题。',
          '只返回JSON。必须给出4个真正不同、值得发布、可以由当前商品或正确科普内容支撑的选题。',
          '4个选题固定按顺序输出：topic_1=搜索痛点型，topic_2=买点承接型，topic_3=细分干货型，topic_4=知识库宣传型。',
          'topic_1围绕小红书下拉词里的模板、范文、题型、格式、评分标准、批改等真实搜索入口；topic_2从商品能力反推购买理由；topic_3讲一个具体知识点或任务；topic_4宣传知识库本身但必须先讲用户痛点，不写硬广。',
          'topic_1和topic_2为broad，topic_3为narrow，topic_4为broad。',
          'topic_1必须是大痛点入口：没思路、词背了用不上、正式信不会写、写完不会改、范文不会迁移、任务总跑题、资料很多不知道先练什么。它要像用户会搜索/会收藏的问题，不像教研目录。',
          'broad不是空泛：它应对应大量备考者会遇到、会主动搜索的一级问题，例如没思路、词汇不会用、正式信不会写、写完不会改、范文不会迁移；内容仍需给出明确解决结果。禁止把评分维度、抽象名词搭配、单个句法、单个连接词类别、单个术语伪装成topic_1。',
          'narrow可以深入一个具体知识点或使用场景，但仍要有明确实用价值。三个选题不能都写成抽象名词、单个连接词或极细语法点。',
          '人群、场景、痛点、内容和商品承接必须构成一条自然关系，禁止随机拼接。',
          '不要把商品资料里没有的内容说成商品自带；AI可以原创正确的科普、例句和练习。',
          profile.topicScopePrompt,
          `每个topic必须出现“${profile.noteIdentity}”对应的清晰身份，且不得出现另一商品的考试名称。`,
          '任何给用户看的字段都不许出现AU-001、CH-085等内部ID，也不要出现括号里的内部标签。',
          '商品事实可用于判断，但选题表述必须像真人编辑说话，简洁、具体，避免“实现跃迁、四合一、全局观”等企划腔。',
          // 选题应优先围绕真实高流量搜索词构造角度。validated_search_keywords 已
          // 通过小红书下拉联想验证：联想词多 = 真实搜索流量大。avoided_keywords
          // 已验证下拉无联想（流量低），选题 pain/scene 不应围绕它们。
          titleKeywords.length
            ? `选题角度应贴近真实搜索流量：优先围绕这些已验证高频搜索词构造切入点——${titleKeywords.join('、')}。每个选题自然呼应其中 1 个，不要堆砌。`
            : '',
          avoidedTerms.length
            ? `下列词在小红书下拉联想中无任何建议（流量已验证极低），选题的 pain/scene 不得以它们为核心：${avoidedTerms.join('、')}。`
            : '',
          templatePrompt,
        ].filter(Boolean).join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          product_id: input.productId,
          optional_direction: input.direction,
          competitor_creative_card: input.card,
          product_map_material: input.productContext,
          validated_search_keywords: titleKeywords,
          avoided_low_traffic_keywords: avoidedTerms,
          output_schema: {
            topics: [{
              id: 'topic_1',
              scope_level: 'broad|narrow',
              topic_type: 'search_pain|selling_point|narrow_knowledge|product_showcase',
              topic: '一句话选题',
              audience: '具体人群和阶段',
              scene: '具体使用场景',
              pain: '具体行为或卡点',
              content_promise: '用户点开后实际得到什么',
              product_bridge: '如何自然连接商品；不需要强卖',
              why_this_reference_fits: '为什么适合当前高密度资料封面',
              novelty: '与常规法语清单有什么不同',
              search_terms: ['用于检索本地知识库的关键词'],
              content_source_plan: {
                knowledge_base: '优先从商品里找什么',
                ai_original: '知识库不足时AI可以原创什么',
              },
            }],
          },
        }),
      },
    ], { maxTokens: 3000, retries: 3 });
    const root = asRecord(result);
    const topics: MigratedTopic[] = Array.isArray(root.topics)
      ? root.topics.map((topic, index) => normalizeTopic(topic, index, input.productId)).filter((topic): topic is MigratedTopic => topic !== null)
      : [];
    for (const topic of topics) {
      const key = topic.topic.trim();
      if (key && !seenTopics.has(key)) {
        seenTopics.add(key);
        collected.push(topic);
        if (collected.length >= 4) break;
      }
    }
  }

  if (collected.length < 1) throw new Error(`AI ${MAX_TOPIC_CALLS} 次调用均未返回可用选题`);
  return collected.slice(0, 4).map((topic, index) => ({
    ...topic,
    scope_level: index === 2 ? 'narrow' : 'broad',
    topic_type: index === 0 ? 'search_pain' : index === 1 ? 'selling_point' : index === 2 ? 'narrow_knowledge' : 'product_showcase',
  }));
}

export async function refineSeededTopics(input: RefineSeededTopicsInput): Promise<MigratedTopic[]> {
  if (!input.seededTopics.length) return [];
  const profile = getProductPromptProfile(input.productId);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = asRecord(await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是资深小红书法语内容主编。根据4张已经完成硬匹配的种子卡，为当前参考封面创作4个具体内容任务。只返回JSON。',
        '种子卡已经锁定知识边界、商品、人群方向和封面内容形态；不得改seed_id，不得跨考试、跨技能或随机更换痛点。',
        '每个任务都要像真人编辑临时策划的新选题，不得照抄种子的topic、audience、scene、pain或content_promise。',
        '4个任务必须切口明显不同：使用不同具体场景、知识子集或用户动作；不能只换数字和近义词。',
        '4个任务固定按顺序输出：topic_1=搜索痛点型，topic_2=买点承接型，topic_3=细分干货型，topic_4=知识库宣传型。',
        'topic_1必须围绕小红书下拉词里的真实搜索入口：模板、范文、题型、格式、评分标准、批改、备考资料、备考攻略。它要像用户会搜索/会收藏的问题，不像教研目录。',
        'topic_2必须从商品能力反推购买理由：例如范文库解决范文不会迁移、检查清单解决写完不会改、学习路径解决资料太多不知道先练什么。',
        'topic_3才用于细分知识点、任务或表达讲解。',
        'topic_4必须宣传知识库本身，但标题前置用户痛点：先说为什么需要整理好的资料库，再说资料库怎么帮他；不要写成硬广。',
        'topic_1和topic_2为broad，topic_3为narrow，topic_4为broad。',
        'broad必须对应大量备考者能立刻理解、经常遇到或会主动搜索的一级问题，例如没思路、词汇不会用、正式信不会写、写完不会改、范文不会迁移；它仍要有具体交付，不能写成“全面提升写作”。',
        '前两个broad严禁缩成二级知识点：单个连接词类别（如让步连接词）、单个句法（如虚拟式）、单个抽象名词搭配、单个固定表达、单一细分错误或冷门术语，都只能放到第三个narrow位置。',
        'narrow才用于深入一个具体知识点或使用场景，但也必须能解决真实问题，不能为了显得专业而选生僻术语。',
        'topic是选题，不是最终标题：12-24字，清楚说明本篇具体讲什么，不堆情绪词。',
        `每个topic必须出现“${profile.noteIdentity}”对应的清晰身份，禁止用另一商品名称凑身份。禁止写“用A替代B”式选题，不同连接词和句法只能讲语义区别与选择条件。`,
        'audience、scene、pain必须具体且互相成立；content_promise必须能由种子知识范围支撑。',
        '这是选题阶段，不要提前断言具体法语规则、列出未经检索的语法子类型或编造精确数量；具体例句、分类和法语结论留到后续检索与审校。',
        '选题阶段不得预设某句“看似正确其实错/别扭/不地道”。没有具体证据时，只能策划成“按语境区分、比较语域或检查真实错误”，避免后续为了兑现标题把正确法语硬判成错。',
        '选题阶段也不要写“扣分扣在哪、选错就扣分、致命扣分”等官方判分口吻；改成“问题在哪、容易错配、影响表达”。',
        profile.topicScopePrompt,
        'AI可以补充正确科普与例句；不得虚构商品数量、服务、官方规则、得分和提分时长。',
        'product_bridge写给管理员看，只说明如何自然承接当前商品使用场景，不写内部规则、代码名或“是否收录”的讨论。',
        `当前参考封面：${input.card.name}；内容机制：${input.card.content_mechanism}；点击机制：${input.card.click_mechanism}。`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        variation_nonce: nonce,
        optional_direction: input.direction || '由AI结合当前封面选择具体切口',
        validated_search_keywords: titleKeywords,
        locked_seed_cards: input.seededTopics.map(topic => ({
          seed_id: topic.seed_id,
          base_topic: topic.topic,
          audience_direction: topic.audience,
          use_scene_direction: topic.scene,
          pain_direction: topic.pain,
          content_value_direction: topic.content_promise,
          knowledge_terms: topic.dynamic_fact_terms || topic.search_terms,
          ai_original_scope: topic.ai_original_scope,
        })),
        output_schema: {
          topics: [{
            seed_id: '必须原样返回',
            scope_level: 'topic_1/topic_2/topic_4=broad，topic_3=narrow',
            topic_type: '必须原样返回：search_pain/selling_point/narrow_knowledge/product_showcase',
            topic: '本次具体选题',
            audience: '具体人群和阶段',
            scene: '发生问题的具体场景',
            pain: '用户当下的具体卡点',
            content_promise: '看完本篇获得的具体内容',
            product_bridge: '自然承接商品的方式',
            why_this_reference_fits: '当前封面为何适合承载本篇内容',
            novelty: '本次与常规清单及其他两个任务的区别',
            search_terms: ['3-8个本地事实卡检索词'],
          }],
        },
      }),
    },
  ], { maxTokens: 2600, retries: 2, temperature: 0.85 }));

  const rawTopics = Array.isArray(result.topics) ? result.topics.map(asRecord) : [];
  const bySeed = new Map(rawTopics.map(topic => [asString(topic.seed_id), topic]));
  const seen = new Set<string>();
  return input.seededTopics.map((base, index) => {
    const proposed = bySeed.get(base.seed_id || '') || rawTopics[index] || {};
    // Do not hard-cut a Chinese topic by character count. A slightly longer,
    // complete sentence is better than a 30-character fragment such as
    // "...把常见"; downstream title generation will create the short title.
    const topic = selectProductSafeTaskText(input.productId, asString(proposed.topic), base.topic, true);
    const uniqueTopic = topic && !seen.has(topic) && topic !== base.topic ? topic : base.topic;
    seen.add(uniqueTopic);
    return {
      ...base,
      id: `${base.seed_id || `seed_${index}`}__${input.card.renderer_id}__${nonce}`,
      scope_level: base.topic_type === 'narrow_knowledge' || index === 2 ? 'narrow' : 'broad',
      topic_type: base.topic_type || (index === 0 ? 'search_pain' : index === 1 ? 'selling_point' : index === 2 ? 'narrow_knowledge' : 'product_showcase'),
      topic: uniqueTopic,
      audience: selectProductSafeTaskText(input.productId, asString(proposed.audience), base.audience),
      scene: selectProductSafeTaskText(input.productId, asString(proposed.scene), base.scene),
      pain: selectProductSafeTaskText(input.productId, asString(proposed.pain), base.pain),
      content_promise: selectProductSafeTaskText(input.productId, asString(proposed.content_promise), base.content_promise),
      // Product facts are not sent to this lightweight ideation call. Keep the
      // pre-grounded bridge instead of letting the model invent modules/services.
      product_bridge: base.product_bridge,
      why_this_reference_fits: selectProductSafeTaskText(input.productId, asString(proposed.why_this_reference_fits), `${input.card.name}适合把本篇重点做成可快速浏览的封面内容。`),
      novelty: selectProductSafeTaskText(input.productId, asString(proposed.novelty), base.novelty),
      search_terms: Array.isArray(proposed.search_terms)
        ? Array.from(new Set(proposed.search_terms.map(asString).filter(term => term && isProductPublicTextSafe(input.productId, term)))).slice(0, 8)
        : base.search_terms,
    };
  });
}

function sanitizeTaskText(value: string, productId?: ProductId) {
  const result = sanitizePublicText(value)
    .replace(/精准提分/g, '找到改进方向')
    .replace(/高分模板/g, '常用写作框架')
    .replace(/直接调用/g, '按语境调用')
    .replace(/直接调取/g, '按题目调取')
    .replace(/调用功能块/g, '按题目选表达模块')
    .replace(/替换主题词就能/g, '重写语境后再')
    .replace(/替换主题词[，,]\s*就能/g, '重写主题词后，再')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/效率翻倍/g, '更省力')
    .replace(/分数卡在\s*\d+\s*分左右/g, '写作一直卡住')
    .replace(/让我考前[^，。；\n]{0,24}/g, '考前复盘时')
    .replace(/看似正确(?:实则|其实)(?:错误|别扭|不对|不地道)/g, '容易混淆')
    .replace(/必备/g, '常用')
    .replace(/如何用([^，。；]{1,24})代替(?:简单的)?([^，。；]{1,24})$/g, '$1和$2怎么按语境选择')
    .replace(/(?:稳拿|冲刺|拿到|写出)?高分/g, '写得更稳')
    .replace(/扣分扣在哪/g, '问题在哪')
    .replace(/(?:被)?扣在哪里/g, '问题出在哪里')
    .replace(/(?:被)?扣在/g, '问题在')
    .replace(/选错就扣分/g, '选错容易错配')
    .replace(/致命扣分/g, '明显影响表达')
    .replace(/扣分重灾区/g, '容易出问题的地方')
    .replace(/重灾区/g, '高频问题')
    .replace(/隐形扣分点/g, '容易忽略的问题')
    .replace(/扣分点/g, '易错点')
    .replace(/扣分/g, '影响表达')
    .replace(/直接套用/g, '迁移使用')
    .replace(/可套用/g, '可迁移')
    .replace(/用([^：，。；]{1,20})替代[^，。；]+/g, '$1的用法区别与选择')
    .replace(/替换\s*(?:mais|donc|parce que|on|à mon avis)/gi, '不同语境')
    .replace(/主题词一换/g, '按新语境重写')
    .replace(/完美契合/g, '适合')
    .replace(/一图胜十篇/g, '便于收藏复查')
    .replace(/比[^，。；]{1,24}更符合大脑(?:记忆与提取|记忆|认知)逻辑/g, '便于分类记忆和调用')
    .replace(/真实学生作文片段/g, '模拟作文片段')
    .replace(/真实学生习作片段/g, '模拟习作片段')
    .replace(/真实文档片段/g, '示例文档片段')
    .replace(/真实DELF\s*B2?题目/g, '示例题目')
    .replace(/真实DELF题目/g, '示例题目')
    .replace(/真实(?:TEF|TCF|DALF)\s*(?:考题|真题|题目)/g, '示例题目')
    .replace(/官方作文片段/g, '示例作文片段')
    .replace(/官方素材/g, '示例素材')
    .replace(/真实场景/g, '典型场景')
    .replace(/真实书信片段/g, '示例正式信片段')
    .replace(/真实[^，。；]{0,12}片段/g, '示例片段')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return productId === 'delf_b2_writing' ? result.replace(/短信|简讯/g, '论坛投稿') : result;
}

function ensureTaskIdentity(value: string, productId: ProductId) {
  if (!value || hasForbiddenProductIdentity(productId, value)) return '';
  if (hasRequiredProductIdentity(productId, value)) return value;
  return `${getProductPromptProfile(productId).shortIdentity}：${value}`;
}

function selectProductSafeTaskText(
  productId: ProductId,
  proposed: string,
  fallback: string,
  requireIdentity = false,
) {
  const value = sanitizeTaskText(proposed, productId);
  if (!value || !isProductPublicTextSafe(productId, value)) return fallback;
  if (requireIdentity && !hasRequiredProductIdentity(productId, value)) return fallback;
  return value;
}

export async function composeDraft(input: ComposeDraftInput): Promise<ReferenceDrivenDraft> {
  const spec = getCoverTemplateSpec(input.card.renderer_id);
  if (!spec) throw new Error('封面模板规格不存在');
  const profile = getProductPromptProfile(input.productId);
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const allowedTitleFormulas = getRoutedTitleFormulas(input.topic, spec.family);
  const examFactRules = getExamFactRules(input.productId);
  const coreResult = await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        // 静态段全部前置：DeepSeek prompt cache 基于精确前缀字节匹配，多次
        // 调用间只要前缀稳定就能命中缓存（cached input token 单价 1/10）。
        // 任何依赖 spec/card 的动态段都挪到数组末尾。
        '你是资深小红书法语编辑兼出版物信息设计师。根据已确认选题生成一套可直接进入模板的笔记数据，只返回JSON。',
        '整篇只能讲一件事。笔记文字标题、封面标题、内页和正文必须共享同一个核心承诺，但两种标题承担不同任务，禁止强行写成同一句。',
        '每条必须让普通中国备考者一眼看懂：primary写法语词/短语或中文知识点，secondary给简短中文释义。禁止只写vocabulaire B2、concordance等无解释的内部速记，禁止把条目写成冗长的是非问句。',
        '每条法语和备考规则输出前先自查准确性。禁止把学习建议写成官方硬规则，禁止虚构固定句法配额、得分或提分承诺。',
        '纠错对照只允许使用真正存在拼写、变位、搭配或语义错误的原句。若两个表达都正确，只是正式程度、语气或语义侧重点不同，必须把分组和条目标成“口语/正式、语义A/语义B、场景A/场景B”，绝不能写成“错误/正确、中式直译/修正”。',
        'Et、mais、parce que、on、je pense que、beaucoup de、gens本身都不是错误，也不能一律标成口语或非正式；更复杂的连接词和词汇有各自语义，不得包装成机械升级。',
        profile.contentScopePrompt,
        '禁止自创数量门槛，例如“至少2个B2级词汇”“至少1个虚拟式”“每段必须1个连接词”。词汇等级没有可机械计数的官方清单，虚拟式也只在语义需要时使用。',
        '知识库证据可直接引用或改写；AI原创内容必须保持法语正确，source_type标为ai_original或mixed。来源标记只供内部审校，绝不能显示给用户。',
        'AI补充的科普内容可以正常出现在笔记里，但公开文案不得声称它属于商品，也不得刻意声明它不属于商品。只有给定证据明确证明的商品模块、数量和能力，才允许作为商品事实表达。',
        '商品数量、模块、服务只能来自给定证据。科普、例句、练习可以原创。',
        '笔记文字标题必须不超过20个字符，中文、英文、数字、空格、全角/半角标点都各算1个字符；必须提供5类候选：资料型、解释型、强钩子型、情绪型、结果型。它负责搜索和点击，必须优先使用恐惧损失、好奇缺口、认知冲突、场景代入之一。禁止机械使用“XXX？YYY”的同一种句式，禁止写成平淡说明书标题。',
        // 笔记文字标题必须贴合真实搜索行为。validated_search_keywords 是小红书
        // 下拉联想验证过的高流量词，标题自然嵌入 1 个能显著提升可搜性。禁止
        // 堆砌——一个标题最多 1 个高频词，且必须服务于选题核心承诺。
        titleKeywords.length
          ? `笔记文字标题应贴合小红书真实搜索流量。validated_search_keywords 字段里的词（${titleKeywords.join('、')}）均经过下拉联想验证，流量真实。每个标题候选最多自然嵌入 1 个高频词，必须服务于选题，禁止堆砌；如果选题与这些词都无关，宁可不用。`
          : '',
        '75个公式只服务于笔记文字标题：先匹配心理触发器，再仿写公式结构，禁止为了套公式扭曲内容。候选中必须覆盖5个title_type：资料型、解释型、强钩子型、情绪型、结果型；至少包含1个自然原创标题、1个公式仿写标题、1个竞品机制迁移标题。',
        '标题质量硬要求：至少命中2项——具体人群/场景、真实痛点、悬念缺口、反常识、损失感、数字锚点。无情绪、无悬念、无痛点的内部任务名必须重写。',
        `可参考的强标题方向：${profile.titleExamples.join('；')}。只学方向，不得照抄。`,
        `例如：笔记文字标题负责点击和搜索；封面标题负责让人一眼看懂“${profile.noteIdentity}”的具体资料价值；副标题再说明范围或使用场景。三者不要写成同一句。`,
        '封面标题或副标题若写具体数量（N句/个/条/项），N必须等于封面实际条目总数；写N类/组时必须等于分组数。拿不准就不要写具体数字。',
        '标题必须像中国用户自然说话，读出声不拗口。标题至少有明确对象、具体利益或信息缺口中的两项。',
        '标题写“陷阱/错误/避坑”时正文必须真有对应错误；写“模板/范文”时本篇必须真提供模板或完整范文。禁止为了蹭搜索词改变内容类型。',
        `每个笔记文字标题和封面主标题都必须清楚出现“${profile.noteIdentity}”对应身份，且不得出现另一商品考试名称。`,
        '标题允许适度使用“大全、必背、万能、考官、稳过、7天、提分”等强钩子词来制造点击欲，但必须能在正文中用真实干货降落；不得冒充官方授权、内部押题或真实承诺。正文和内页比标题克制，不要把标题钩子写成事实保证。',
        '没有明确证据时，禁止任何百分比、多少人会用、多少考生不知道、星级标记、具体扣分或提分数字。',
        '任何用户可见内容不得出现AU-、CH-、FW-、GD-等内部编号。',
        '这一轮只生成统一任务单、标题和封面内容，不写正文和内页。',
        // 动态段（依赖 spec/card）放在末尾，前缀缓存命中的部分仍是上面这些静态段。
        templatePrompt,
        examFactRules,
        `primary视觉长度不得超过${spec.maxPrimaryVisualLength}，secondary视觉长度不得超过${spec.maxSecondaryVisualLength}；超出的解释和例句移到内页。`,
        `封面标题独立生成，不等于笔记文字标题；它按模板允许类型走，优先服务第一眼点击和画面兑现。${spec.titleInstruction}`,
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        competitor_creative_card: input.card,
        confirmed_topic: input.topic,
        retrieved_product_evidence: input.evidence,
        seed_context: {
          seed_id: input.topic.seed_id,
          content_shape: input.topic.content_shape,
          page_plan: input.topic.page_plan,
          ai_original_scope: input.topic.ai_original_scope,
        },
        title_formula_candidates: allowedTitleFormulas,
        validated_search_keywords: titleKeywords,
        output_schema: {
          brief: {
            product_id: input.productId,
            reference_card_id: input.card.id,
            topic: '', audience: '', scene: '', pain: '', content_value: '', content_shape: 'dense_directory',
            selling_point: '', buying_reason: '', product_claim_limit: '', knowledge_base_plan: '', ai_original_plan: '',
            cover_requirement: '', difference_from_recent: '',
          },
          title_candidates: [{
            title: '', title_type: '资料型|解释型|强钩子型|情绪型|结果型', formula_id: '', trigger_type: '', formula_skeleton: '', reason: '', risk_flags: [],
          }],
          selected_title: '',
          cover: {
            kind: 'dense_directory', title: '', title_type: '资料|大全|时效|稀缺|情绪|结果|反常识', subtitle: '',
            sections: [{
              side_label: '2至4字', heading: '分组标题', columns: 3,
              items: [{ primary: '知识点', secondary: '可选法语或解释', note: '' }],
              source_type: 'knowledge_base|ai_derived|ai_original|mixed', source_ids: [],
            }],
          },
        },
      }),
    },
  ], { maxTokens: 6500, retries: 3 });

  const core = asRecord(coreResult);
  const brief = normalizeBrief(core.brief, input);
  const allowedTitleFormulaIds = new Set(allowedTitleFormulas.map(item => item.id));
  let titleCandidates = normalizeTitles(core.title_candidates, allowedTitleFormulaIds, input.productId);
  const autofixEvents: string[] = [];
  const applyAutoFix = (currentCover: NormalizedCover): NormalizedCover => {
    if (!spec) return currentCover;
    const groundedCover = normalizeCoverEvidence(currentCover, input.evidence);
    const result = autoFixCoverCapacity(groundedCover, spec);
    if (result.events.length) {
      autofixEvents.push(...result.events);
      // 挂进 recentUsage.autofix_count/events，让 benchmark 和尸体池能直接读到
      // 「这次 compose 触发了 N 次 autofix」用于命中率统计。仍保留 console 日志
      // 方便 dev server 控制台目检。
      recordAutofixEvents(result.events);
      console.info(`[autofix] card=${input.card.id} events=${JSON.stringify(result.events)}`);
    }
    return result.cover;
  };
  let cover = applyAutoFix(ensureCoverIdentity(normalizeDenseDirectoryCover(core.cover), input.card.renderer_id, input.productId));
  titleCandidates = filterTitleCandidatesByContent(titleCandidates, input.topic, cover);
  titleCandidates = ensureTitleCandidateMix(titleCandidates, cover.title, input.topic, input.productId);
  let selectedTitle = chooseSafeTitle(core.selected_title, titleCandidates, cover.title, `${cover.title} ${cover.subtitle} ${brief.topic}`, input.productId);
  ({ titleCandidates, selectedTitle } = syncTitlesWithCoverCounts(titleCandidates, selectedTitle, cover));
  let coreIssues = getCoreIssues(titleCandidates, cover, input.card.renderer_id, input.evidence, input.productId);
  let coreWarnings = coreIssues.filter(issue => !isBlockingCoreIssue(issue));
  let blockingCoreIssues = coreIssues.filter(isBlockingCoreIssue);
  for (let repairAttempt = 0; blockingCoreIssues.length && repairAttempt < 2; repairAttempt += 1) {
    const repairResult = await repairCoreOutput({
      brief,
      titleCandidates,
      selectedTitle,
      cover,
      issues: blockingCoreIssues,
      evidence: input.evidence,
      allowedTitleFormulas,
      renderer: input.card.renderer_id,
      productId: input.productId,
    });
    const repaired = asRecord(repairResult);
    titleCandidates = normalizeTitles(repaired.title_candidates, allowedTitleFormulaIds, input.productId);
    cover = applyAutoFix(ensureCoverIdentity(normalizeDenseDirectoryCover(repaired.cover), input.card.renderer_id, input.productId));
    titleCandidates = filterTitleCandidatesByContent(titleCandidates, input.topic, cover);
    titleCandidates = ensureTitleCandidateMix(titleCandidates, cover.title, input.topic, input.productId);
    selectedTitle = chooseSafeTitle(repaired.selected_title, titleCandidates, cover.title, `${cover.title} ${cover.subtitle} ${brief.topic}`, input.productId);
    ({ titleCandidates, selectedTitle } = syncTitlesWithCoverCounts(titleCandidates, selectedTitle, cover));
    coreIssues = getCoreIssues(titleCandidates, cover, input.card.renderer_id, input.evidence, input.productId);
    coreWarnings = coreIssues.filter(issue => !isBlockingCoreIssue(issue));
    blockingCoreIssues = coreIssues.filter(isBlockingCoreIssue);
  }
  if (autofixEvents.length) {
    console.info(`[autofix-summary] card=${input.card.id} count=${autofixEvents.length} events=${JSON.stringify(autofixEvents)}`);
  }
  if (blockingCoreIssues.length) throw new Error(`标题或封面返修后仍未达标：${blockingCoreIssues.join(', ')}`);

  const editorialResult = await generateEditorialOutput(input, {
    brief,
    selectedTitle,
    cover,
  });

  let editorial = asRecord(editorialResult);
  let innerPages = normalizePageEvidence(normalizePages(editorial.inner_pages), input.evidence);
  let caption = sanitizePublicText(asString(editorial.caption));
  const seoKeywords = buildSeoKeywords(input.productId, input.topic);
  let tags = normalizeTags(editorial.tags, seoKeywords, input.productId, `${input.topic.topic} ${input.topic.content_promise} ${cover.title}`);
  innerPages = ensureMinimumInnerPages(innerPages, cover, input.productId);
  caption = ensurePublishableCaption(caption, seoKeywords[0], cover);
  let editorialWarnings = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId).filter(issue => !isBlockingEditorialIssue(issue));
  const editorialIssues = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId).filter(isBlockingEditorialIssue);
  if (editorialIssues.length) {
    editorial = asRecord(await repairEditorialOutput({ brief, selectedTitle, cover, evidence: input.evidence, issues: editorialIssues, seoKeywords }));
    innerPages = normalizePageEvidence(normalizePages(editorial.inner_pages), input.evidence);
    caption = sanitizePublicText(asString(editorial.caption));
    tags = normalizeTags(editorial.tags, seoKeywords, input.productId, `${input.topic.topic} ${input.topic.content_promise} ${cover.title}`);
    innerPages = ensureMinimumInnerPages(innerPages, cover, input.productId);
    caption = ensurePublishableCaption(caption, seoKeywords[0], cover);
    const remainingIssues = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId);
    editorialWarnings = remainingIssues.filter(issue => !isBlockingEditorialIssue(issue));
    const blockingIssues = remainingIssues.filter(isBlockingEditorialIssue);
    if (blockingIssues.length) throw new Error(`内页或正文返修后仍未达标：${blockingIssues.join(', ')}`);
  }
  let audited = await auditEducationalContent({
    productId: input.productId,
    cover,
    innerPages,
    caption,
    evidence: input.evidence,
    renderer: input.card.renderer_id,
  });
  for (let auditAttempt = 0; !audited.summary.approved && auditAttempt < 1; auditAttempt += 1) {
    audited = await auditEducationalContent({
      productId: input.productId,
      cover: audited.cover,
      innerPages: audited.innerPages,
      caption: audited.caption,
      evidence: input.evidence,
      renderer: input.card.renderer_id,
    });
  }
  if (!audited.summary.approved) {
    throw new Error(`法语与考试事实审校未通过：${audited.summary.issues.join('；')}`);
  }
  cover = applyAutoFix(ensureCoverIdentity(normalizeDenseDirectoryCover(audited.cover), input.card.renderer_id, input.productId));
  innerPages = normalizePageEvidence(normalizePages(audited.innerPages), input.evidence);
  caption = ensurePublishableCaption(sanitizePublicText(audited.caption), seoKeywords[0], cover);
  const titlePolish = await polishTitlesAfterContent({
    productId: input.productId,
    card: input.card,
    topic: input.topic,
    brief,
    titleCandidates,
    selectedTitle,
    cover,
    innerPages,
    caption,
    evidence: input.evidence,
    allowedTitleFormulas,
  });
  titleCandidates = titlePolish.titleCandidates;
  selectedTitle = titlePolish.selectedTitle;
  cover = titlePolish.cover;

  const finalCoreIssues = getCoreIssues(titleCandidates, cover, input.card.renderer_id, input.evidence, input.productId);
  coreWarnings = finalCoreIssues.filter(issue => !isBlockingCoreIssue(issue));
  const finalBlockingCoreIssues = finalCoreIssues.filter(isBlockingCoreIssue);
  const finalEditorialAllIssues = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId);
  editorialWarnings = finalEditorialAllIssues.filter(issue => !isBlockingEditorialIssue(issue));
  const finalEditorialIssues = finalEditorialAllIssues.filter(isBlockingEditorialIssue);
  if (finalBlockingCoreIssues.length || finalEditorialIssues.length) {
    throw new Error(`法语与考试事实审校未通过：final_gate=${[...finalBlockingCoreIssues, ...finalEditorialIssues].join(',')}`);
  }
  const draft: ReferenceDrivenDraft = {
    id: `draft_${Date.now()}`,
    brief,
    title_candidates: titleCandidates,
    selected_title: selectedTitle,
    cover_title_candidates: titlePolish.coverTitleCandidates,
    cover,
    inner_pages: innerPages,
    caption,
    tags,
    seo_keywords: seoKeywords,
    accuracy_audit: audited.summary,
    evidence: input.evidence,
    checks: {
      title_cover_consistent: false,
      template_capacity_ok: false,
      product_claims_grounded: false,
      content_density_ok: false,
      issues: [],
    },
  };
  draft.checks = validateReferenceDraft(draft, input.card.renderer_id);
  draft.checks.warnings = Array.from(new Set([...(draft.checks.warnings || []), ...coreWarnings, ...editorialWarnings]));
  return draft;
}

export async function auditEducationalContent(input: {
  productId: ProductId;
  cover: ReturnType<typeof normalizeDenseDirectoryCover>;
  innerPages: GeneratedInnerPage[];
  caption: string;
  evidence: ReturnType<typeof retrieveProductFacts>;
  renderer: ProductCard['renderer_id'];
}) {
  const family = getCoverTemplateSpec(input.renderer)?.family;
  const profile = getProductPromptProfile(input.productId);
  const examFactRules = getExamFactRules(input.productId);
  const result = asRecord(await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是严谨的法语教师和考试内容审校员。只做语言正确性与当前商品明确考试事实审校，不改文风，不扩写，只返回JSON。',
        '核心任务：检查封面、内页和正文里的法语例句、短语、拼写、变位、搭配、语域及中文释义是否准确。',
        examFactRules,
        profile.auditScopePrompt,
        '检查用户可理解性：法语术语必须配清楚的中文含义，不能留下vocabulaire B2、concordance等只有作者自己懂的速记。',
        '封面短条目允许是合法法语词干/搭配开头（例如 Pour remédier à cette、Je sollicite votre），也允许以"..."结尾表示句子刻意未写完、留给读者自行续写；完整补全放在内页；不要把“条目偏短/未补全整句/以...结尾”判成 error。',
        '“避免说：口语表达”这类语域对照，只要口语句本身没错且意图是提醒正式语域，标 warning 即可，不要当 error。',
        '只有拼写错误、错误变位、错误搭配、错误敬语、虚假考试规则才标 error。',
        '不要把“语体不够正式但语法正确”的句子标成错误，也不要虚构错误原因。例如 Je suis président, j’écris pour... 不能只因直接就判错；如要优化，应写成“正式信中更稳妥的表达”。',
        '重点检查错误/正确对照是否真的构成错误，尤其核对因果连接词、让步结构、虚拟式触发条件和正式信语域，不能把不同语义结构说成同义替换。',
        '如果封面把本来正确的表达放进“错误/中式直译”一栏，必须在cover_corrections中把该条改成一个真实存在的错误及其准确修正；不能只在issue里解释“它其实没错”。',
        'Et、mais、parce que、on、je pense que、beaucoup de、gens是中性常用表达，不能仅因存在更复杂的替代说法就标成口语、非正式或错误。Cordialement的适用性取决于收信人和文体，不能称为所有正式信的最低标准。',
        '检查所谓“主题迁移”是否语义成立：禁止把环保、健康、教育等主题词逐个画箭头当成可直接替换；应改为在新主题中重写完整、合理的例句。',
        '检查法中释义强度是否一致，例如 essentiel 通常是“重要/有必要/至关重要”，不能不看语境一律译成“必须”；non seulement 必须与 mais aussi 等完整结构匹配。',
        '你只负责法语语法/搭配/敬语和考试规则事实的正确性，不负责评价中文表达是否够正式、够精确、够地道；像"字数失控/时间分配"这类中文短语只要意思清楚、没有事实错误，禁止标 error，最多标 warning。法语术语没配中文释义、可打印成一句更完整的表达，这类可读性建议同样最多 warning，不能 error。',
        '只对确定有错或明显误导的地方给修正；不确定时标为warning，不要凭空新增规则。',
        '每个severity=error的issue必须同时提供对应的cover_corrections、page_corrections或corrected_caption；没有把握给出可直接替换的修正时，只能标warning。修正后应当可以直接发布，不能只解释问题。',
        '不得把某个正式信开头或结尾说成适合大多数/所有情况；称呼、收信人身份、写信目的和礼貌结尾必须相互匹配。不要用“适合上级或长辈”“非正式一点的正式信”这种模糊分类。',
        '学习流程中的分钟数只能明确写成个人练习建议，不能包装成考试固定分配；没有必要时直接删除具体分钟数。',
        'correction中的note只能放用户需要看的补充知识；禁止写“将强制要求改为建议、修正原因、原文有误”等幕后说明，不需要note就返回空字符串。',
        '“toujours/jamais属于绝对频率表达，建议谨慎使用”“bien que与malgré都能表达让步但句法不同”属于有效教学说明，不要误判成事实错误。',
        '每条issue的problem必须给出单一、确定的结论，禁止先说"有错误"又说"无错误/无误/正确/无问题"这种自我否定或自我改判的表述；如果分析到最后发现其实没有错误、只是更地道的表达偏好、或者是封面短条目允许的词干/未完整礼貌结语，直接把severity设为warning或完全不放进issues数组，不要标severity为error后又在problem里说它其实不构成错误。',
        '检查每个法语词/短语本身是否是真实存在、拼写完整的词形；如果像是被截断或多个词拼接在一起产生的不存在词形（例如缺少空格、词尾被截断后接了另一个词），必须标为error并给出修正。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        cover_family: family,
        cover: input.cover,
        inner_pages: input.innerPages,
        caption: input.caption,
        supporting_fact_cards: input.evidence.map(item => ({
          id: item.id,
          text: item.text,
          evidence: item.evidence,
        })),
        output_schema: {
          approved: true,
          issues: [{ severity: 'error|warning', location: 'cover.sections[0].items[0].primary 或 inner_pages[0].bullets[0] 这种点/方括号路径', problem: '', correction: '' }],
          cover_corrections: [{ section_index: 0, item_index: 0, primary: '', secondary: '', note: '' }],
          page_corrections: [{ page_index: 0, bullet_index: 0, corrected_text: '' }],
          corrected_caption: '仅当正文有事实、法语或语域错误时，返回完整修正版正文；否则返回空字符串',
        },
      }),
    },
  ], { maxTokens: 4200, retries: 2, temperature: 0.15 }));

  const coverCopy = structuredClone(input.cover);
  const pagesCopy = structuredClone(input.innerPages);
  let captionCopy = input.caption;
  let correctedCount = 0;
  const correctedLocations = new Set<string>();
  if (Array.isArray(result.cover_corrections)) {
    for (const value of result.cover_corrections) {
      const correction = asRecord(value);
      const section = coverCopy.sections[Number(correction.section_index)];
      const item = section?.items[Number(correction.item_index)];
      if (!item) continue;
      const primary = sanitizePublicText(asString(correction.primary));
      const secondary = sanitizePublicText(asString(correction.secondary));
      const note = sanitizePublicText(asString(correction.note));
      const baseLocation = `cover.sections[${Number(correction.section_index)}].items[${Number(correction.item_index)}]`;
      if (primary) { item.primary = primary; correctedLocations.add(`${baseLocation}.primary`); }
      if (secondary) { item.secondary = secondary; correctedLocations.add(`${baseLocation}.secondary`); }
      if (note) { item.note = note; correctedLocations.add(`${baseLocation}.note`); }
      correctedCount += 1;
    }
  }
  if (Array.isArray(result.page_corrections)) {
    for (const value of result.page_corrections) {
      const correction = asRecord(value);
      const page = pagesCopy[Number(correction.page_index)];
      const bulletIndex = Number(correction.bullet_index);
      const correctedText = sanitizePublicText(asString(correction.corrected_text));
      if (!page || !page.bullets[bulletIndex] || !correctedText) continue;
      page.bullets[bulletIndex] = correctedText;
      correctedLocations.add(`inner_pages[${Number(correction.page_index)}].bullets[${bulletIndex}]`);
      correctedCount += 1;
    }
  }
  const correctedCaption = sanitizePublicText(asString(result.corrected_caption));
  if (correctedCaption) {
    captionCopy = correctedCaption;
    correctedLocations.add('caption');
    correctedCount += 1;
  }
  const issueRecords = Array.isArray(result.issues)
    ? result.issues.map(value => {
        const issue = asRecord(value);
        return {
          severity: asString(issue.severity).toLowerCase(),
          location: asString(issue.location),
          problem: asString(issue.problem),
        };
      }).filter(issue => issue.location || issue.problem)
    : [];
  const truncationTolerantFamily = family === 'phrase' || family === 'document';
  const falsePositivePattern = truncationTolerantFamily
    ? /不完整|缺少动词|缺少名词|缺少完整|缺少\s*[“"]?que|条目偏短|未补全|应补全为整句|避免说|\.\.\.[\s\S]{0,30}?(缺少|应为|应接|应补全)|(缺少|应为|应接)[\s\S]{0,30}?\.\.\./
    : /应改为\s*同句|避免说/;
  const selfContradictionPattern = /无错误|无误|没有错误|并无不妥|表述正确|无问题|是正确的|并无问题|应改为\s*warning|标记?为?错误不准确|更(自然|地道|准确)(?!.{0,6}(拼写|变位|搭配)错)|不(是|算|构成)错误|并非错误|不构成问题/;
  // The model writes "location" as free text ("cover > sections[0] > items[2]
  // > primary", "cover.sections[0].items[2].primary", etc.) so an exact-string
  // match against our internally-tracked dot/bracket paths almost never hits.
  // That silently defeats "don't count issues we already corrected" - the
  // field gets fixed but the stale issue about the old text still blocks
  // approval. Normalize both sides to bare alphanumerics before comparing.
  const normalizeLocation = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const normalizedCorrectedLocations = [...correctedLocations].map(normalizeLocation);
  const llmIssues = issueRecords
    .filter(issue => issue.severity === 'error')
    .filter(issue => {
      const normalized = normalizeLocation(issue.location);
      return !normalizedCorrectedLocations.some(location => normalized === location || normalized.startsWith(location));
    })
    .filter(issue => !falsePositivePattern.test(issue.problem))
    .filter(issue => !selfContradictionPattern.test(issue.problem))
    .filter(issue => !isSameQuotedCorrection(issue.problem))
    .filter(issue => !(normalizeLocation(issue.location).startsWith('cover') && /未完整|未补全|省略号|应补全/.test(issue.problem)))
    .filter(issue => !/中文句子|逗号|语句不通顺|重复出现|与当前页面主题[^。；]*无关/.test(issue.problem))
    .map(issue => `${issue.location}：${issue.problem}`.replace(/^：/, ''));

  // Deterministic second layer: a real French dictionary lookup, independent
  // of whatever the LLM audit above did or didn't catch. This is not a
  // matter of judgement (word exists or it doesn't), so high-confidence
  // findings (a token that decomposes into two real words glued together)
  // are treated as hard errors and feed the same repair loop as LLM issues.
  // Plain "not in this dictionary" hits are kept as non-blocking, human-
  // reviewable notes since they can be proper nouns or rare-but-real words.
  let dictionaryErrors: string[] = [];
  let dictionaryWarnings: string[] = [];
  try {
    const findings = await findSuspiciousFrenchTokens(collectFrenchCheckTargets(coverCopy, pagesCopy));
    dictionaryErrors = findings
      .filter(f => f.certain)
      .map(f => `${f.location}：词典硬校验发现疑似缺空格拼接词"${f.token}"，可能应为"${f.suggestion}"`);
    dictionaryWarnings = findings
      .filter(f => !f.certain)
      .slice(0, 5)
      .map(f => `${f.location}：词典未收录"${f.token}"（可能是专有名词或生僻词，仅供人工复核，不阻塞发布）`);
  } catch {
    // Dictionary unavailable for some reason - degrade to LLM-only audit rather than failing the whole request.
  }

  const issues = [...llmIssues, ...dictionaryErrors].slice(0, 12);
  return {
    cover: normalizeDenseDirectoryCover(coverCopy),
    innerPages: pagesCopy,
    caption: captionCopy,
    summary: {
      approved: !issues.length,
      corrected_count: correctedCount,
      issues: [...issues, ...dictionaryWarnings],
    },
  };
}

function generateEditorialOutput(input: ComposeDraftInput, context: {
  brief: UnifiedContentBrief;
  selectedTitle: string;
  cover: NormalizedCover;
}) {
  const profile = getProductPromptProfile(input.productId);
  const seoKeywords = buildSeoKeywords(input.productId, input.topic);
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const examFactRules = getExamFactRules(input.productId);
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        // 静态段前置以命中 prompt cache；动态 templatePrompt 移到最后。
        '你是资深小红书法语内容编辑。选题、人群、场景、痛点和内容承诺已经锁定，不能另起主题。只返回JSON。',
        '生成4-6张真正给用户看的内页，以及一篇可直接发布的正文。内页不是把正文切片粘贴。',
        '每张内页必须有具体知识、例子、对照、步骤或练习；禁止写幕后设计意图。',
        '正文控制在280-420个中文字符，图片已经承载干货，正文只补充使用方法、关键提醒和自然商品承接。',
        '商品事实只能来自证据；正确科普、法语例句、练习可以原创。公开文案不讨论AI补充内容是否收录在商品里，既不声称包含，也不声明不包含。',
        'AI原创科普以稳妥常识和法语用法为主，不编造现实数据、比例、年份或未经证据支持的具体地区损失与医学因果。',
        '逐条核对法语语法、搭配、语域和适用场景；不确定就删除。不要把学习建议描述成官方强制规则。',
        '主题迁移不能把两个无直接对应关系的名词画成机械替换（例如“污染→工作压力”）；必须保留论证功能后重写完整例句，并说明语境。',
        '中文释义必须精确：不要把“重要/有必要”夸成“必须”，也不要把不同语义的表达包装成同义替换。',
        '核心搜索词必须自然出现在正文前80字，长尾词自然出现1次，不能堆砌。',
        // 正文要嵌入验证过的高频搜索词，让真实用户搜得到。tag 必须组合成带商品
        // 身份的复合形式（#DELFB2模板 而不是 #模板），单独的 #模板 流量再大也是
        // 垃圾标签池，搜出来的全是无关内容。
        titleKeywords.length
          ? `validated_search_keywords 已经过小红书下拉联想验证，真实有流量。正文里自然嵌入 1-2 个（前 80 字优先），禁止堆砌；tag 必须组合成带商品身份的复合形式，但只能描述本篇真实内容：没有完整范文就不能写“范文”，没有模板就不能写“模板”。禁止输出单独的「#模板」「#范文」「#技巧」这类无主标签。`
          : '',
        '禁止“不是……而是……”“问题出在”“问题的关键”“很多同学都会遇到”等AI套话。',
        profile.editorialScopePrompt,
        '内页要承接封面未展开的信息：短条目在封面，完整解释、例句、对照、使用条件和练习进入内页。内页顺序应形成“看懂主题→获得方法→看到例子→能够自查→自然了解商品”的阅读链。',
        '商品承接写成用户下一步行动和适用场景，不要写“我的/我们的资料里有、资料提供、内容来自资料”等库存说明；数量只可使用证据中原样存在的数字。',
        examFactRules,
        `当前封面创作卡要求：${templatePrompt}`,
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        locked_brief: context.brief,
        selected_note_title: context.selectedTitle,
        locked_cover: context.cover,
        locked_page_plan: input.topic.page_plan || [],
        confirmed_topic: input.topic,
        competitor_content_mechanism: input.card.content_mechanism,
        product_evidence: input.evidence,
        seo_keywords: seoKeywords,
        validated_search_keywords: titleKeywords,
        output_schema: {
          inner_pages: [{
            page_no: 2,
            page_type: 'knowledge_list|example_explain|wrong_right|steps|product_bridge',
            page_title: '', lead: '', bullets: [], source_ids: [],
          }],
          caption: '完整正文，280-420个中文字符，分短段',
          tags: ['#法语学习'],
        },
      }),
    },
  ], { maxTokens: 5000, retries: 3 });
}

function normalizeTopic(value: unknown, index: number, productId?: ProductId): MigratedTopic | null {
  const input = asRecord(value);
  const sourcePlan = asRecord(input.content_source_plan);
  const rawTopic = sanitizeTaskText(asString(input.topic), productId);
  const topic = productId ? ensureTaskIdentity(rawTopic, productId) : rawTopic;
  if (!topic || (productId && !isProductPublicTextSafe(productId, topic))) return null;
  const safe = (field: unknown) => {
    const text = sanitizeTaskText(asString(field), productId);
    return !productId || isProductPublicTextSafe(productId, text) ? text : '';
  };
  return {
    id: asString(input.id) || `topic_${index + 1}`,
    scope_level: asString(input.scope_level) === 'narrow' ? 'narrow' : 'broad',
    topic_type: normalizeTopicType(asString(input.topic_type), index),
    topic,
    audience: safe(input.audience),
    scene: safe(input.scene),
    pain: safe(input.pain),
    content_promise: safe(input.content_promise),
    product_bridge: safe(input.product_bridge),
    why_this_reference_fits: safe(input.why_this_reference_fits),
    novelty: safe(input.novelty),
    search_terms: Array.isArray(input.search_terms) ? input.search_terms.map(asString).filter(item => item && (!productId || isProductPublicTextSafe(productId, item))).slice(0, 12) : [],
    content_source_plan: {
      knowledge_base: asString(sourcePlan.knowledge_base),
      ai_original: asString(sourcePlan.ai_original),
    },
  };
}

function normalizeTopicType(value: string, index: number): MigratedTopic['topic_type'] {
  if (value === 'search_pain' || value === 'selling_point' || value === 'narrow_knowledge' || value === 'product_showcase') return value;
  return index === 0 ? 'search_pain' : index === 1 ? 'selling_point' : index === 2 ? 'narrow_knowledge' : 'product_showcase';
}

function normalizeBrief(value: unknown, input: ComposeDraftInput): UnifiedContentBrief {
  const brief = asRecord(value);
  return {
    product_id: input.productId,
    reference_card_id: input.card.id,
    topic: asString(brief.topic) || input.topic.topic,
    audience: input.topic.audience,
    scene: input.topic.scene,
    pain: input.topic.pain,
    content_value: input.topic.content_promise,
    content_shape: input.topic.content_shape || input.card.renderer_id,
    selling_point: asString(brief.selling_point),
    buying_reason: asString(brief.buying_reason),
    product_claim_limit: asString(brief.product_claim_limit),
    knowledge_base_plan: asString(brief.knowledge_base_plan),
    ai_original_plan: asString(brief.ai_original_plan),
    cover_requirement: asString(brief.cover_requirement),
    difference_from_recent: asString(brief.difference_from_recent),
    seed_id: input.topic.seed_id,
    page_plan: input.topic.page_plan || [],
    public_source_policy: 'AI补充内容可以正常使用；公开文案不声称其属于商品，也不声明其不属于商品。商品事实只使用已验证证据。',
  };
}

function normalizeTitles(value: unknown, allowedIds?: Set<string>, productId?: ProductId): TitleCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    const input = asRecord(item);
    const title = compactTitleForLimit(
      polishHumanTitleText(normalizeTitleIdentity(sanitizeTitleLikeText(asString(input.title)), productId), productId),
      productId,
    );
    return {
      title,
      title_type: normalizeTitleCandidateType(asString(input.title_type) || asString(input.trigger_type)),
      formula_id: asString(input.formula_id),
      trigger_type: asString(input.trigger_type),
      formula_skeleton: asString(input.formula_skeleton),
      reason: asString(input.reason),
      risk_flags: Array.isArray(input.risk_flags) ? input.risk_flags.map(asString).filter(Boolean) : [],
    };
  }).filter(item => item.title
    && isCompleteTitle(item.title, 'text')
    && (!productId
      ? /法语|DELF|B2|TEF|TCF/i.test(item.title)
      : hasRequiredProductIdentity(productId, item.title) && !hasForbiddenProductIdentity(productId, item.title))
    && !isUnnaturalTitle(item.title)
    && (!allowedIds || allowedIds.has(item.formula_id) || item.formula_id === 'free_original' || item.formula_id === 'reference_migration')
    && !/官方授权|内部押题|内部资料|100\s*%|百分百/.test(item.title)
  );
}

function extractTitleEditorPool(record: Record<string, unknown>) {
  const pool = asRecord(record.text_title_pools);
  const labels: Record<string, string> = {
    material: '\u8d44\u6599\u578b',
    explanation: '\u89e3\u91ca\u578b',
    strong_hook: '\u5f3a\u94a9\u5b50\u578b',
    emotion: '\u60c5\u7eea\u578b',
    result: '\u7ed3\u679c\u578b',
  };
  const pooled = Object.entries(labels).flatMap(([key, type]) => {
    const values = Array.isArray(pool[key]) ? pool[key] as unknown[] : [];
    return values.map(value => ({ ...asRecord(value), title_type: type }));
  });
  return pooled.length > 0 ? pooled : record.text_title_candidates;
}

function selectBestTitlePerType(candidates: TitleCandidate[]) {
  const typeOrder = [
    '\u8d44\u6599\u578b',
    '\u89e3\u91ca\u578b',
    '\u5f3a\u94a9\u5b50\u578b',
    '\u60c5\u7eea\u578b',
    '\u7ed3\u679c\u578b',
  ];
  const selected: TitleCandidate[] = [];
  for (const type of typeOrder) {
    const best = candidates
      .filter(item => item.title_type === type)
      .sort((a, b) => titleImpactScore(b.title) - titleImpactScore(a.title))[0];
    if (best && !selected.some(item => item.title === best.title)) selected.push(best);
  }
  const remaining = candidates
    .filter(item => !selected.some(selectedItem => selectedItem.title === item.title))
    .sort((a, b) => titleImpactScore(b.title) - titleImpactScore(a.title));
  return [...selected, ...remaining].slice(0, 5);
}

function normalizePages(value: unknown): GeneratedInnerPage[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const input = asRecord(item);
    const validTypes = ['knowledge_list', 'example_explain', 'wrong_right', 'steps', 'product_bridge'];
    const pageType = asString(input.page_type);
    const normalizedPageType = (validTypes.includes(pageType) ? pageType : 'knowledge_list') as GeneratedInnerPage['page_type'];
    const rawBullets = Array.isArray(input.bullets)
      ? dedupeBullets(input.bullets.map(item => normalizeBulletText(sanitizePublicText(asString(item)))).filter(Boolean)).slice(0, 7)
      : [];
    return {
      page_no: Number(input.page_no) || index + 2,
      page_type: normalizedPageType,
      page_title: normalizeInnerPageTitle(sanitizePublicText(asString(input.page_title)), index),
      lead: clip(sanitizePublicText(asString(input.lead)), 90),
      bullets: normalizePageBullets(normalizedPageType, rawBullets),
      source_ids: Array.isArray(input.source_ids) ? input.source_ids.map(asString).filter(Boolean).slice(0, 10) : [],
    };
  }).filter(page => page.page_title).slice(0, 6);
}

function normalizeBulletText(value: string) {
  const trimmed = value.trim();
  if (/[:：]\s*$/.test(trimmed) && visualLength(trimmed) < 36) return '';
  return value
    .replace(/，，+/g, '，')
    .replace(/,,+/g, ',')
    .replace(/别只看建议用/g, '别只看是否用了')
    .replace(/别只看是否用了这些词，更要看逻辑上存在这类关系/g, '别只看是否用了这些词，更要看两句话本身是否真有这类关系')
    .replace(/资料中(?:的)?/g, '')
    .replace(/资料里(?:的)?/g, '')
    .replace(/DELF B2备考资料里除了/g, '系统备考时，除了')
    .replace(/DELF B2写作备考资料里除了/g, '系统备考时，除了')
    .replace(/结合DELF B2写作备考资料/g, '做系统备考时')
    .replace(/避免泛指\s*on/gi, '谨慎使用泛指 on')
    .replace(/Pas de ['’]on['’]/gi, 'on 按语境使用')
    .replace(/官方评分表通常列出4项，但语体（Registre）隐含在词汇与连贯中，单独检查更有效。/g, '这套自查按5个维度看：任务完成、连贯、词汇、语法和语体。')
    .replace(/练习中常见的写完作文后/g, '很多人写完作文后')
    .replace(/代词所指不超过前两句/g, '代词所指要清楚')
    .replace(/前两句内必须有先行词/g, '前文要有明确先行词')
    .replace(/前两句内明确出现/g, '前文有明确先行词')
    .replace(/我的资料|我们的资料/g, '这类材料')
    .replace(/对照DELF B2写作备考检查清单/g, '对照一份DELF B2写作检查清单')
    .replace(/有没有遗漏让步段或结论/g, '观点是否有必要的限定和结论')
    .replace(/正式信避免缩写（如“c'est”改为“cela est”）/g, '正式信里少用聊天式缩写，语气保持完整')
    .replace(/30秒避坑清单/g, '写前避坑清单')
    .replace(/秒判/g, '快速判断')
    .replace(/严重影响得分/g, '明显影响表达')
    .replace(/导致低分/g, '让表达不稳')
    .replace(/换主题词就能/g, '换主题时要重写语境')
    .replace(/只替换主题词和例子/g, '围绕新题重写主题词和例子')
    .replace(/只替换主题词/g, '围绕新题重写主题词')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizePageBullets(pageType: GeneratedInnerPage['page_type'], bullets: string[]) {
  if (pageType !== 'steps') return bullets;
  const mostlyFrenchSentence = (value: string) => {
    const latin = (value.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const chinese = (value.match(/[\u4e00-\u9fff]/g) || []).length;
    return latin >= 35 && chinese <= 6 && !/^\d+[.、]/.test(value);
  };
  const kept = bullets.filter(value => !mostlyFrenchSentence(value));
  const numbered = kept.map((value, index) => {
    const body = value
      .replace(/^\d+[.、]\s*/, '')
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣9️⃣🔟]\s*/, '')
      .trim();
    return `${index + 1}. ${body}`;
  });
  const fallbackSteps = [
    '整体结构：引言、发展、结论是否完整',
    '段落衔接：上一段和下一段是否能接上',
    '段内逻辑：因果、转折、递进关系是否清楚',
    '指代检查：代词能否明确指回前文对象',
    '最后复盘：把反复出现的问题单独记下来',
  ];
  while (numbered.length < 5) {
    numbered.push(`${numbered.length + 1}. ${fallbackSteps[numbered.length]}`);
  }
  return numbered.slice(0, 6);
}

function normalizePageEvidence(
  pages: GeneratedInnerPage[],
  evidence: ComposeDraftInput['evidence'],
) {
  const allowedSourceIds = collectEvidenceSourceIds(evidence);
  return pages.map(page => ({
    ...page,
    // source_ids are internal provenance metadata, not public content. Models
    // occasionally invent a plausible-looking ID even when the prose itself is
    // valid AI-original knowledge. Silently discard unknown IDs instead of
    // spending another generation call or rejecting the whole note.
    source_ids: page.source_ids.filter(id => allowedSourceIds.has(id)),
  }));
}

function normalizeCoverEvidence(
  cover: NormalizedCover,
  evidence: ComposeDraftInput['evidence'],
): NormalizedCover {
  const allowedSourceIds = collectEvidenceSourceIds(evidence);
  return {
    ...cover,
    sections: cover.sections.map(section => {
      const sourceIds = section.source_ids.filter(id => allowedSourceIds.has(id));
      return {
        ...section,
        source_ids: sourceIds,
        // Provenance is bookkeeping. If a model cites no valid retrieved fact,
        // treat the section as original educational content. Do not ask another
        // model to rewrite otherwise usable cover copy just to repair an ID.
        source_type: sourceIds.length
          ? (section.source_type === 'ai_original' ? 'ai_derived' : section.source_type)
          : 'ai_original',
      };
    }),
  };
}

function dedupeBullets(values: string[]) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value
      .replace(/[▎□❌✅•·]/g, '')
      .replace(/（(?:教学建议|官方要求)）/g, '')
      .replace(/^第\d+步[：:]?/g, '')
      .replace(/[\s，,。；;：:！？!?()（）]/g, '')
      .toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function ensureMinimumInnerPages(
  pages: GeneratedInnerPage[],
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
  productId: ProductId,
) {
  const result = [...pages];
  const identity = getProductPromptProfile(productId).noteIdentity;
  for (const section of cover.sections) {
    if (result.length >= 4) break;
    const bullets = section.items
      .map(item => `${item.primary}${item.secondary ? `：${item.secondary}` : ''}`)
      .filter(Boolean)
      .slice(0, 7);
    while (bullets.length < 3) bullets.push('结合本篇主题完成一次替换练习');
    const rawTitle = `${identity}${section.heading}`;
    result.push({
      page_no: result.length + 2,
      page_type: 'knowledge_list',
      page_title: clip(rawTitle, 22),
      lead: cover.subtitle || '把封面的知识点展开成可直接理解的内容。',
      bullets,
      source_ids: section.source_ids,
    });
  }
  return result.slice(0, 6).map((page, index) => ({ ...page, page_no: index + 2 }));
}

function normalizeInnerPageTitle(value: string, index: number) {
  const trimmed = clip(value, 24);
  if (trimmed.length >= 8) return trimmed;
  const fallbacks = [
    '法语写作先看这一页',
    '这一页拆清楚用法',
    '常见错误这样检查',
    '例句放到作文里用',
    '写完之后这样复盘',
    '资料对应这样使用',
  ];
  return fallbacks[index] || '法语写作这一页怎么用';
}

function ensureCoreKeywordOpening(caption: string, keyword?: string) {
  if (!keyword || caption.slice(0, 100).includes(keyword)) return caption;
  const head = caption.slice(0, 80);
  // 关键词以变体形式已经在开头出现时，不需要再硬塞原词。两个商品都需要这套短路逻辑，
  // 否则会出现 "TEF TCF Canada 备考时，TEF Canada 备考的同学..." 这种重复开头。
  if (/DELF\s*B2/i.test(keyword) && /DELF\s*B2/i.test(head) && /写作|作文/.test(head)) return caption;
  if (/TEF|TCF|CLB/i.test(keyword) && /TEF|TCF|CLB/i.test(head) && /备考|考试|Canada|加拿大/i.test(head)) return caption;
  return clip(`${keyword}备考时，${caption}`, 440);
}

function ensurePublishableCaption(
  caption: string,
  keyword: string | undefined,
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
) {
  const captionWithoutInlineTags = caption.replace(/#[\s\S]*$/, '').trim();
  let result = ensureCoreKeywordOpening(captionWithoutInlineTags || caption, keyword)
    .replace(/on换成nous/g, '泛指 on 要看语境')
    .replace(/全程用vous/g, '称呼保持一致')
    .replace(/帮助你在练习中精准自查，高效提分/g, '帮助你在练习中更有方向地复盘')
    .replace(/帮助你精准自查，高效提分/g, '帮助你更有方向地复盘')
    .replace(/高效提分/g, '更有针对性地复盘');
  if (result.length < 260) {
    const headings = cover.sections.map(section => section.heading).filter(Boolean).slice(0, 4).join('、');
    result += `使用时可以先看封面总览，再按${headings || '各个模块'}逐项核对。容易混淆的地方单独抄下来，下一篇练习时优先检查；确认已经掌握的内容再划掉。这样复盘会更具体，也方便看出自己反复出错的位置。`;
  }
  if (result.length < 260) {
    result += '收藏后不要一次把所有内容都背完，先选和当前作文最相关的一组，写进完整句子，再结合题目检查语境、搭配和语体是否合适。';
  }
  if (result.length > 440) {
    const candidate = result.slice(0, 430);
    const boundary = Math.max(candidate.lastIndexOf('。'), candidate.lastIndexOf('！'), candidate.lastIndexOf('？'));
    result = `${candidate.slice(0, boundary >= 260 ? boundary + 1 : 420).trim()}。`;
  }
  return sanitizePublicText(result);
}

async function repairEditorialOutput(input: {
  brief: UnifiedContentBrief;
  selectedTitle: string;
  cover: ReturnType<typeof normalizeDenseDirectoryCover>;
  evidence: ReturnType<typeof retrieveProductFacts>;
  issues: string[];
  seoKeywords: string[];
}) {
  const profile = getProductPromptProfile(input.brief.product_id);
  const examFactRules = getExamFactRules(input.brief.product_id);
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书法语内容总编。完整重写未过质检的内页和正文，只返回JSON，不能改变锁定主题。',
        '必须完整返回4-6张内页，每页标题8-22字、引导语和4-7条具体内容；不得输出半句话。',
        '必须完整返回280-420个中文字符的正文和5-8个标签。正文开头直接进入具体问题，不能虚构作者个人考试经历。',
        '逐条核对法语语法、搭配、语域和适用场景；不得把学习建议写成官方硬规则。',
        profile.editorialScopePrompt,
        '禁止把不同主题的名词做机械一对一替换；主题迁移必须重写语义完整、符合新语境的例句。',
        examFactRules,
        '核心搜索词必须出现在正文前80字，其他关键词自然出现，不得堆砌。',
        'AI补充知识可以直接正常讲解，但公开文案不得讨论它是否收录在商品中；禁止“商品里有/没有、资料中包含/未收录”等句式。',
        '商品承接不要写“我的/我们的资料里有、资料提供、内容来自资料”等库存说明；数量只可使用证据中原样存在的数字。',
        '禁止万能、必背、捷径、阅卷老师看重、百分比、考官追着给分、白考、保分、必过；禁止虚构省时、挽回分数、保证提分；禁止幕后设计说明和“不是……而是……”套话。',
        '禁止把不同语义的法语表达写成机械替换，例如“用 bien que 代替 mais”“用 en revanche 代替 mais”。必须说明各自适用语义。禁止把建议写成“严禁/必须”的官方规则。',
        'Et、mais、parce que、on、je pense que、beaucoup de、gens本身是中性常用表达，不得标成口语、非正式或错误；只能说明不同表达的语义、位置和语域差异。Cordialement不得写成所有正式信的最低标准。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        locked_brief: input.brief,
        locked_title: input.selectedTitle,
        locked_cover: input.cover,
        failed_checks: input.issues,
        product_evidence: input.evidence,
        seo_keywords: input.seoKeywords,
        required_output: {
          inner_pages: [{ page_no: 2, page_type: 'knowledge_list', page_title: '', lead: '', bullets: ['', '', '', ''], source_ids: [] }],
          caption: '280-420个中文字符的完整正文',
          tags: ['#法语学习'],
        },
      }),
    },
  ], { maxTokens: 5000, retries: 3 });
}

async function repairCoreOutput(input: {
  brief: UnifiedContentBrief;
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  cover: ReturnType<typeof normalizeDenseDirectoryCover>;
  issues: string[];
  evidence: ReturnType<typeof retrieveProductFacts>;
  allowedTitleFormulas: ReturnType<typeof getRoutedTitleFormulas>;
  renderer: ProductCard['renderer_id'];
  productId: ProductId;
}) {
  const spec = getCoverTemplateSpec(input.renderer);
  if (!spec) throw new Error('封面模板规格不存在');
  const currentCounts = input.cover.sections.map(section => section.items.length);
  const currentTotal = currentCounts.reduce((sum, count) => sum + count, 0);
  const capacityHint = (input.issues.includes('cover_section_capacity_invalid')
    || input.issues.includes('cover_density_too_low')
    || input.issues.includes('cover_section_count_invalid'))
    ? `当前每组条目数为[${currentCounts.join(',')}]，共${input.cover.sections.length}组、${currentTotal}条，这不符合要求。请严格输出恰好${spec.sectionCount}组，每组恰好${spec.itemsPerSection}条（允许±1条误差），总条目不少于${spec.minTotalItems}条；宁可每组多写1-2条平淡但真实的短条目，也不能少于下限。`
    : '';
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const profile = getProductPromptProfile(input.productId);
  const examFactRules = getExamFactRules(input.productId);
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书内容总编，负责定向修复未过质检的标题和封面数据。只返回JSON，不改变锁定选题。',
        '完整重写标题和封面，不能只返回修改的局部。',
        '75个公式只用于笔记文字标题且只是灵感库，不是硬模板。公式仿写候选的formula_id原样返回；自然原创或竞品机制迁移候选允许formula_id写free_original或reference_migration。',
        '必须返回5个20字以内的笔记文字标题；这里的“字”按小红书肉眼字数算，汉字、英文字母、数字、空格、全角/半角标点都各算1个字。标题通常14-18字，少于13字会显得信息量不足，除非钩子极强；宁可14-18字完整，不要20字卡边断尾。',
        'title_type分别为资料型、解释型、强钩子型、情绪型、结果型；至少包含1个自然原创、1个公式仿写、1个竞品机制迁移，且心理触发不同。至少3个标题要有明显点击钩子：恐惧、好奇、反常识、场景代入、结果承诺或数字锚点。',
        '标题允许适度使用“大全、必背、万能、考官、稳过、7天、提分”等强钩子词，但不能冒充官方授权、内部押题或真实承诺；标题钩子必须能被本篇封面和正文降落。',
        '平淡的知识点名称、资料说明和内部任务名必须重写。标题要像人会点的小红书笔记。',
        `可参考的强标题方向：${profile.titleExamples.join('；')}。只学点击机制，不得照抄。`,
        '标题写“陷阱/错误/避坑”时正文必须真有对应错误；写“模板/范文”时本篇必须真提供模板或完整范文。禁止为了蹭搜索词改变内容类型。',
        titleKeywords.length
          ? `笔记文字标题应贴合小红书真实搜索流量。validated_search_keywords（${titleKeywords.join('、')}）均经过下拉联想验证，每个标题最多自然嵌入 1 个高频词，禁止堆砌；与选题无关就别硬塞。`
          : '',
        `每个标题和封面主标题必须清楚出现“${profile.noteIdentity}”对应身份，且不得出现另一商品考试名称。`,
        getCoverTemplatePrompt(input.renderer),
        capacityHint,
        `primary视觉长度不得超过${spec.maxPrimaryVisualLength}，secondary视觉长度不得超过${spec.maxSecondaryVisualLength}；长解释和完整例句移到内页。`,
        '每条必须让普通中国备考者一眼看懂，法语术语配简短中文释义；禁止冗长的是非问句和无解释的内部速记。',
        '法语和备考规则必须准确，禁止把建议写成官方硬规则。',
        '禁止自创“至少N个B2词汇、虚拟式、连接词”等数量门槛；虚拟式只在语义需要时使用。',
        examFactRules,
        '禁止虚构“省下N分钟、挽回N分、保证提分”等效果；禁止用“严禁/必须”把学习建议包装成官方规则。',
        '不同法语结构不能机械互换。禁止“用 bien que 代替 mais”“用 en revanche 代替 mais”一类写法，必须解释语义和使用条件。',
        'Et、mais、parce que、on、je pense que、beaucoup de、gens本身是中性常用表达，不得标成口语、非正式或错误；两个正确表达只能按语义、语气和场景对比。Cordialement不得写成所有正式信的最低标准。',
        profile.contentScopePrompt,
        '封面标题或副标题若写具体数量（N句/个/条/项），N必须等于封面实际条目总数；写N类/组时必须等于分组数。',
        '用户可见文字不能出现内部ID。',
        '公开文案不要写“商品里有/没有、资料中包含/未收录”等库存关系句。AI补充内容正常讲知识即可；商品承接只使用证据明确支持的能力和适用场景。',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        locked_brief: input.brief,
        failed_checks: input.issues,
        current_title_candidates: input.titleCandidates,
        current_selected_title: input.selectedTitle,
        current_cover: input.cover,
        product_evidence: input.evidence,
        allowed_title_formulas: input.allowedTitleFormulas,
        validated_search_keywords: titleKeywords,
        output_schema: {
          title_candidates: [{ title: '', title_type: '资料型|解释型|强钩子型|情绪型|结果型', formula_id: '', trigger_type: '', formula_skeleton: '', reason: '', risk_flags: [] }],
          selected_title: '',
          cover: {
            kind: 'dense_directory', title: '', title_type: '资料|大全|时效|稀缺|情绪|结果|反常识', subtitle: '',
            sections: [{ side_label: '', heading: '', columns: 3, items: [{ primary: '', secondary: '', note: '' }], source_type: 'mixed', source_ids: [] }],
          },
        },
      }),
    },
  ], { maxTokens: 6500, retries: 3 });
}

function chooseSafeTitle(value: unknown, candidates: TitleCandidate[], fallback: string, context = fallback, productId?: ProductId) {
  const proposed = sanitizeTitleLikeText(asString(value));
  const safeCandidates = candidates
    .filter(item => isNaturalTitle(item.title) && !isWeakCommercialTitle(item.title))
    .sort((a, b) => titleSelectionScore(b.title, context) - titleSelectionScore(a.title, context));
  const proposedCandidate = safeCandidates.find(item => item.title === proposed);
  return ensureTextTitleDisplayIdentity(proposedCandidate?.title || safeCandidates[0]?.title || candidates[0]?.title || fallback, productId);
}

function ensureTextTitleDisplayIdentity(value: string, productId?: ProductId) {
  const title = sanitizeTitleLikeText(value);
  if (!productId || hasForbiddenProductIdentity(productId, title)) return title;
  if (productId === 'tef_tcf_canada' && !/TEF\s*\/\s*TCF|TEF.{0,4}TCF|TCF.{0,4}TEF/i.test(title)) {
    const withIdentity = `TEF/TCF${title.replace(/^TEF\/TCF[：:]/i, '').replace(/^法语/, '')}`;
    return isCompleteTitle(withIdentity, 'text') ? withIdentity : title;
  }
  if (productId === 'delf_b2_writing' && !hasRequiredProductIdentity(productId, title)) {
    const withIdentity = `法语B2${title.replace(/^DELF\s*B2[：:]/i, '').replace(/^写作/, '')}`;
    return isCompleteTitle(withIdentity, 'text') ? withIdentity : title;
  }
  return title;
}

async function polishTitlesAfterContent(input: {
  productId: ProductId;
  card: ProductCard;
  topic: MigratedTopic;
  brief: UnifiedContentBrief;
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  cover: NormalizedCover;
  innerPages: GeneratedInnerPage[];
  caption: string;
  evidence: ComposeDraftInput['evidence'];
  allowedTitleFormulas: ReturnType<typeof getRoutedTitleFormulas>;
}): Promise<{
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  cover: NormalizedCover;
  coverTitleCandidates: CoverTitleCandidate[];
}> {
  const first = await callTitleEditor(input, false);
  let polished = normalizeTitleEditorResult(first, input);
  if (needsTitleRewrite(polished.titleCandidates, polished.selectedTitle, polished.cover.title)) {
    const second = await callTitleEditor({
      ...input,
      titleCandidates: polished.titleCandidates,
      selectedTitle: polished.selectedTitle,
      cover: polished.cover,
    }, true);
    polished = normalizeTitleEditorResult(second, input);
  }
  return polished;
}

function callTitleEditor(input: {
  productId: ProductId;
  card: ProductCard;
  topic: MigratedTopic;
  brief: UnifiedContentBrief;
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  cover: NormalizedCover;
  innerPages: GeneratedInnerPage[];
  caption: string;
  evidence: ComposeDraftInput['evidence'];
  allowedTitleFormulas: ReturnType<typeof getRoutedTitleFormulas>;
}, rewrite: boolean) {
  const profile = getProductPromptProfile(input.productId);
  const spec = getCoverTemplateSpec(input.card.renderer_id);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const avoidedKeywords = getAvoidedLowTrafficKeywords(input.productId);
  const coverSummary = input.cover.sections.map(section => ({
    heading: section.heading,
    items: section.items.slice(0, 8).map(item => `${item.primary}${item.secondary ? ` / ${item.secondary}` : ''}`),
  }));
  const allTemplateIds: Exclude<CreativeCardRenderer, 'ai_scene_overlay'>[] = [
    'parchment_dense_directory',
    'white_green_directory',
    'clean_purple_directory',
    'grid_purple_directory',
    'blackboard_phrase',
    'blackboard_offer',
    'memo_offer',
    'word_flashcard',
    'book_cover',
    'notebook_big_words',
    'plain_experience',
    'document_analysis',
    'vocab_table',
    'course_roadmap',
    'collocation_dense',
  ];
  const alternateTemplates = allTemplateIds
    .filter(id => id !== input.card.renderer_id)
    .map(id => {
      const alt = getCoverTemplateSpec(id);
      return alt ? { template_id: id, name: alt.name, family: alt.family, allowed_title_types: alt.allowedCoverTitleTypes || [] } : null;
    })
    .filter(Boolean)
    .slice(0, 8);

  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书法语备考赛道的标题总编，只负责把已经定稿的内容包装成更想点开的标题。只返回 JSON。',
        '不要重写正文、不要重写内页、不要改封面条目；你只能改：笔记文字标题、当前封面标题/副标题、备用封面标题。',
        '笔记文字标题和封面图片标题是两套标题：',
        '1) text_title 用于小红书发布标题，负责搜索、推荐流点击和关键词承接，必须20字以内；这里的“字”按小红书肉眼字数算，汉字、英文字母、数字、空格、全角/半角标点都各算1个字。text_title通常14-18字，少于13字会显得信息量不足；宁可14-18字完整，不要20字卡边断尾，并且必须清楚出现商品身份词。',
        '2) cover_title 用于封面大字，负责第一眼停留，通常12-18字，最多20字，短、狠、能被当前封面画面兑现；少于12字必须有极强钩子。cover_subtitle 8-24字，补充范围/使用场景。',
        '封面标题不是资料名，必须让用户第一眼知道“这和我有关”：必须包含领域身份（法语/DELF/B2/TEF/TCF/CLB7之一）+ 用户状态/场景/痛点/损失感之一。',
        '封面标题允许多种句式：直给型、提醒型、结果型、资料型、情绪型。禁止连续输出同一种“AAA？BBB”句式。',
        '好封面标题示例：DELF格式分老丢的人先看、B2作文写完先查、TEF口语说不长先别背答案、CLB7总差一点先测、考前7天还在背范文。',
        '文字标题比封面标题更完整：必须像用户会点开的笔记标题，而不是图片上的大字。可以包含搜索词、完整钩子和具体承接。',
        '好文字标题示例：DELF B2写作总拿不到高分？先查这5个扣分点；法语B2模板背了也用不上？这份结构表更适合考前翻；TEF/TCF备考最怕的不是题难，是一开始就选错方向。',
        '标题不是概括内容，而是制造点击理由。先选心理钩子，再写标题。',
        '可用钩子：恐惧损失、好奇缺口、认知冲突、场景代入、结果承诺、资料稀缺、大全收藏、时效更新。',
        '每个文字标题至少命中 2 个张力点：具体人群/场景、真实痛点、悬念缺口、反常识、损失感、数字锚点、搜索关键词。',
        '不要为了不超20字写成10字左右的短标题；标题要尽量写到14-18字，把对象、场景、痛点、结果说清楚。禁止结尾悬空，如“别再只盯语”“问题出在”“格式不”“这5个常”“早该”“每”“哪科最”。',
        '必须输出 5 个 text_title_candidates：资料型、解释型、强钩子型、情绪型、结果型各 1 个。不要全部写成“XXX？先YYY”。',
        '必须先把普通标题爆改，不要直接写说明书式标题。禁止平淡如“资料整理好了”“怎么准备”“知识点清单”。',
        '允许适度使用强词：大全、必背、万能、考官、稳过、7天、提分、救命、别再、白练、最后检查；但不要冒充官方授权、内部押题或真实保证。',
        '搜索词最多自然嵌入 1 个；能用就用，不能硬塞。封面标题不必强塞搜索词。',
        '当前封面标题必须匹配当前模板 allowed_cover_title_types；资料目录模板优先资料/大全/稀缺/时效，情绪实拍模板优先情绪/反常识/结果。',
        '如果封面是高密度资料页，封面标题可以资料感更强；如果封面是手写/备忘录/真人经验，封面标题必须更像情绪钩子。',
        '封面标题或副标题写具体数量时，必须和封面实际条目数/分组数一致；不确定就不要写具体数量。',
        '标题必须像中国备考用户自然会说的话，读出声不拗口。',
        '备用封面标题只给标题和副标题，不生成图；它们要按各自模板风格写，方便用户后续换模板。',
        'Candidate-pool rule: return exactly 15 alternatives in text_title_pools, three complete alternatives for each type. Use exact English keys: material, explanation, strong_hook, emotion, result. Do not count on the model to hit the character limit exactly; the program will select valid candidates.',
        'Each alternative must be a different complete sentence, not a shortened or truncated version of another candidate. Aim for 14-18 visible characters; never end mid-phrase.',
        rewrite ? '这是第二次标题返修：上一次仍然太平或错配。请明显加大冲突、损失、反常识或资料稀缺感，但保持和内容一致。' : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        product_identity: profile.noteIdentity,
        current_template: {
          template_id: input.card.renderer_id,
          name: spec?.name,
          family: spec?.family,
          allowed_cover_title_types: spec?.allowedCoverTitleTypes || [],
          title_instruction: spec?.titleInstruction,
        },
        alternate_templates: alternateTemplates,
        topic: input.topic,
        brief: input.brief,
        current_titles: {
          selected_title: input.selectedTitle,
          title_candidates: input.titleCandidates,
          cover_title: input.cover.title,
          cover_subtitle: input.cover.subtitle,
        },
        title_formula_candidates: input.allowedTitleFormulas,
        validated_search_keywords: titleKeywords,
        title_language_rules: {
          use_human_phrasing: true,
          forbidden_surface_phrases: ['资料太散', '卡住', '拖后腿', '正在白背', '白背', '写作任务', '你的DELF B2格式', '你的DELF B2范文'],
          preferred_rewrites: {
            '资料太散': '资料太乱',
            '卡住': '写不好/说不长/听不懂/上不去',
            '拖后腿': '扣分/老丢分',
            '白背': '背了也用不上',
            '写作任务': '写作题型/文体/正式信/论坛投稿/建议信/投诉信',
          },
          cover_title_rule: '封面标题先让用户觉得和自己有关，再给资料感或结果感；不要只写资料名。',
          text_title_rule: '文字标题可以更完整，优先 14-20 个可见字，允许搜索词和爆款钩子结合。',
        },
        avoid_low_traffic_keywords: avoidedKeywords,
        strong_title_examples: profile.titleExamples,
        cover_content: {
          item_count: input.cover.sections.reduce((sum, section) => sum + section.items.length, 0),
          section_count: input.cover.sections.length,
          sections: coverSummary,
        },
        inner_page_titles: input.innerPages.map(page => page.page_title),
        caption_preview: clip(input.caption, 260),
        evidence_summary: input.evidence.slice(0, 10).map(item => ({
          id: item.id,
          text: item.text,
          evidence: clip(item.evidence || item.source_excerpt || '', 120),
        })),
        output_schema: {
          text_title_pools: {
            material: [{ title: '', formula_id: '', trigger_type: '', reason: '', risk_flags: [], score: 0 }],
            explanation: [{ title: '', formula_id: '', trigger_type: '', reason: '', risk_flags: [], score: 0 }],
            strong_hook: [{ title: '', formula_id: '', trigger_type: '', reason: '', risk_flags: [], score: 0 }],
            emotion: [{ title: '', formula_id: '', trigger_type: '', reason: '', risk_flags: [], score: 0 }],
            result: [{ title: '', formula_id: '', trigger_type: '', reason: '', risk_flags: [], score: 0 }],
          },
          text_title_candidates: [{
            title: '',
            title_type: '资料型|解释型|强钩子型|情绪型|结果型',
            formula_id: '',
            trigger_type: '',
            formula_skeleton: '',
            reason: '',
            risk_flags: [],
            score: 0,
          }],
          selected_text_title: '',
          selected_cover_title: {
            template_id: input.card.renderer_id,
            title: '',
            subtitle: '',
            title_type: '资料|大全|时效|稀缺|情绪|结果|反常识',
            reason: '',
            fit_score: 0,
          },
          alternate_cover_titles: [{
            template_id: '',
            title: '',
            subtitle: '',
            title_type: '',
            reason: '',
            fit_score: 0,
          }],
        },
      }),
    },
  ], { maxTokens: 2600, retries: 2, temperature: rewrite ? 0.75 : 0.68 });
}

function normalizeTitleEditorResult(
  value: unknown,
  input: {
    productId: ProductId;
    card: ProductCard;
    topic: MigratedTopic;
    cover: NormalizedCover;
    titleCandidates: TitleCandidate[];
    selectedTitle: string;
    allowedTitleFormulas: ReturnType<typeof getRoutedTitleFormulas>;
  },
) {
  const record = asRecord(value);
  const allowedTitleFormulaIds = new Set(input.allowedTitleFormulas.map(item => item.id));
  let titleCandidates = normalizeTitles(extractTitleEditorPool(record), allowedTitleFormulaIds, input.productId);
  titleCandidates = filterTitleCandidatesByContent(titleCandidates, input.topic, input.cover);
  titleCandidates = ensureTitleCandidateMix(titleCandidates, input.cover.title, input.topic, input.productId);
  titleCandidates = selectBestTitlePerType(titleCandidates);
  let selectedTitle = chooseSafeTitle(record.selected_text_title, titleCandidates, input.cover.title, `${input.cover.title} ${input.cover.subtitle} ${input.topic.topic}`, input.productId);
  let selectedCoverTitle = normalizeCoverTitleCandidate(record.selected_cover_title, input.card.renderer_id, input.productId);
  const fallbackCoverTitle = buildCoverTitleFallback(input.topic, input.productId, input.card.renderer_id, input.cover);
  if (!selectedCoverTitle || isWeakCoverTitle(selectedCoverTitle.title, input.productId)) {
    selectedCoverTitle = fallbackCoverTitle;
  }
  let cover: NormalizedCover = input.cover;
  if (selectedCoverTitle?.title) {
    cover = {
      ...cover,
      title: selectedCoverTitle.title,
      subtitle: selectedCoverTitle.subtitle || cover.subtitle,
    };
  }
  ({ titleCandidates, selectedTitle } = syncTitlesWithCoverCounts(titleCandidates, selectedTitle, cover));
  const alternateCoverTitles = Array.isArray(record.alternate_cover_titles)
    ? record.alternate_cover_titles
      .map(item => normalizeCoverTitleCandidate(item, undefined, input.productId))
      .filter((item): item is CoverTitleCandidate => Boolean(item))
      .filter(item => !isWeakCoverTitle(item.title, input.productId))
      .filter(item => item.template_id !== input.card.renderer_id)
      .slice(0, 8)
    : [];
  const coverTitleCandidates = uniqueCoverTitleCandidates([
    ...(selectedCoverTitle ? [selectedCoverTitle] : []),
    ...alternateCoverTitles,
  ]);
  return { titleCandidates, selectedTitle, cover, coverTitleCandidates };
}

function normalizeCoverTitleCandidate(value: unknown, fallbackTemplateId: CreativeCardRenderer | undefined, productId: ProductId): CoverTitleCandidate | undefined {
  const input = asRecord(value);
  const templateId = (asString(input.template_id) || fallbackTemplateId) as CreativeCardRenderer | undefined;
  if (!templateId || templateId === 'ai_scene_overlay' || !getCoverTemplateSpec(templateId)) return undefined;
  const title = polishHumanTitleText(normalizeTitleIdentity(sanitizeTitleLikeText(asString(input.title)), productId), productId);
  const subtitle = polishHumanTitleText(normalizeTitleIdentity(sanitizeTitleLikeText(asString(input.subtitle)), productId), productId);
  const spec = getCoverTemplateSpec(templateId);
  const titleType = asString(input.title_type) as CoverTitleCandidate['title_type'];
  if (!isCompleteTitle(title, 'cover') || title.length > 18) return undefined;
  if (subtitle && subtitle.length > 24) return undefined;
  if (isUnnaturalTitle(title) || !hasRequiredProductIdentity(productId, title) || hasForbiddenProductIdentity(productId, `${title} ${subtitle}`)) return undefined;
  return {
    template_id: templateId,
    title,
    subtitle: subtitle || undefined,
    title_type: spec?.allowedCoverTitleTypes?.includes(titleType as any) ? titleType : undefined,
    reason: clip(asString(input.reason), 80),
    fit_score: Number(input.fit_score) || undefined,
  };
}

function uniqueCoverTitleCandidates(candidates: CoverTitleCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = `${candidate.template_id}|${candidate.title}`.replace(/\s+/g, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildCoverTitleFallback(
  topic: MigratedTopic,
  productId: ProductId,
  templateId: CreativeCardRenderer,
  cover: NormalizedCover,
): CoverTitleCandidate {
  const text = `${topic.seed_id || ''} ${topic.topic} ${topic.pain} ${topic.content_promise} ${cover.title} ${cover.subtitle}`;
  const spec = getCoverTemplateSpec(templateId);
  const family = spec?.family;
  const titleType = inferCoverTitleType(family, spec?.allowedCoverTitleTypes || []);
  const itemCount = cover.sections.reduce((sum, section) => sum + section.items.length, 0);
  const sectionCount = cover.sections.length;
  const countPhrase = itemCount >= 5 && itemCount <= 30 ? `${itemCount}项` : sectionCount >= 3 && sectionCount <= 8 ? `${sectionCount}类` : '';
  let title = '';
  let subtitle = '';

  if (productId === 'tef_tcf_canada') {
    if (/TEF还是TCF|选考|报名/.test(text)) {
      title = family === 'directory' || family === 'table' ? 'TEF/TCF别选错' : 'TEF还是TCF先别急';
      subtitle = '移民备考先看差异';
    } else if (/CLB|NCLC|自测|四科/.test(text)) {
      title = 'CLB7总差一点先测';
      subtitle = '先看哪科最拖后腿';
    } else if (/口语|开口|论据|过渡/.test(text)) {
      title = 'TEF口语卡住别背答案';
      subtitle = '先练展开和过渡';
    } else if (/听力|精听|复听|语速/.test(text)) {
      title = 'TCF听力别只猛刷题';
      subtitle = '复听顺序先搞对';
    } else if (/30天|计划|每天|2小时|路径|安排/.test(text)) {
      title = 'TEF备考别平均用力';
      subtitle = '每天2小时先排顺序';
    } else if (/资料包|资料|系统备考|product_showcase/.test(text)) {
      title = 'TEF/TCF资料别乱收';
      subtitle = '按备考阶段来用';
    } else {
      title = 'TEF/TCF备考先别乱刷';
      subtitle = '先找最拖分的地方';
    }
  } else {
    if (/评分|自评|检查|批改|交卷|写完|final/.test(text)) {
      title = countPhrase ? `B2作文先查这${countPhrase}` : 'B2作文写完先查';
      subtitle = '别把能拿的分丢掉';
    } else if (/题型|任务|格式|文体|正式信|论坛|建议|投诉/.test(text)) {
      title = 'DELF格式分别白丢';
      subtitle = '先判文体再下笔';
    } else if (/范文|迁移|仿写/.test(text)) {
      title = 'B2范文别整篇背';
      subtitle = '拆结构比硬背有用';
    } else if (/词汇|主题词|单词/.test(text)) {
      title = 'B2写作词别硬背';
      subtitle = '按场景用才像B2';
    } else if (/句式|句型|句法|连接词|衔接/.test(text)) {
      title = 'B2句型别乱升级';
      subtitle = '先看用在什么位置';
    } else if (/资料库|知识库|资料包|备考资料|product_showcase/.test(text)) {
      title = 'DELF写作资料别乱收';
      subtitle = '考前按用途翻这套';
    } else {
      title = 'B2写作总差一点';
      subtitle = '先看问题卡在哪里';
    }
  }

  return {
    template_id: templateId,
    title: polishHumanTitleText(normalizeTitleIdentity(clip(title, 18), productId), productId),
    subtitle: polishHumanTitleText(clip(subtitle, 24), productId),
    title_type: titleType,
    reason: '本地兜底：保证封面标题含领域身份和用户关系。',
    fit_score: 86,
  };
}

function inferCoverTitleType(
  family: CoverTemplateSpec['family'] | undefined,
  allowedTypes: readonly string[],
): CoverTitleCandidate['title_type'] {
  const preferred = family === 'directory' || family === 'document' || family === 'table' || family === 'phrase'
    ? ['资料', '大全', '时效', '稀缺']
    : family === 'roadmap' || family === 'offer'
      ? ['结果', '资料']
      : ['情绪', '反常识', '结果'];
  return (preferred.find(type => allowedTypes.includes(type)) || allowedTypes[0]) as CoverTitleCandidate['title_type'];
}

function isWeakCoverTitle(value: string, productId: ProductId) {
  const title = sanitizeTitleLikeText(value);
  if (!hasRequiredProductIdentity(productId, title)) return true;
  if (!isCompleteTitle(title, 'cover')) return true;
  if (/资料整理好了|知识点清单|怎么准备|这样准备|速查表$|资料包长啥样|整理好的知识库长啥样/.test(title)) return true;
  if (/^[A-Za-z0-9/ ]+[：:]/.test(title) && !/别|先|卡|丢|错|背|查|冲|救|总|白|差/.test(title)) return true;
  return false;
}

function isCompleteTitle(value: string, role: 'cover' | 'text') {
  const title = sanitizeTitleLikeText(value);
  const length = Array.from(title).length;
  const min = role === 'cover' ? 10 : 13;
  if (!title || length < min || length > 20) return false;
  if (/(?:先|把|给|的|和|与|在|还|最|这|这个|这里|怎么|问题出在|别再|早该|每|直|高频主|这\d+个常|先看这张)$/u.test(title)) return false;
  if (/[，,、：:；;。\s]$/u.test(title)) return false;
  return true;
}

function needsTitleRewrite(candidates: TitleCandidate[], selectedTitle: string, coverTitle: string) {
  const bestScore = Math.max(0, ...candidates.map(item => titleImpactScore(item.title)));
  const selectedScore = titleImpactScore(selectedTitle);
  const coverScore = titleImpactScore(coverTitle);
  const repeatedQuestionPattern = candidates.filter(item => /[锛?？].{0,8}(?:先|看|用|查)/.test(item.title)).length >= 3;
  return bestScore < 11
    || selectedScore < 9
    || coverScore < 7
    || repeatedQuestionPattern
    || !isCompleteTitle(selectedTitle, 'text')
    || !isCompleteTitle(coverTitle, 'cover')
    || candidates.some(item => !isCompleteTitle(item.title, 'text'));
}

function polishHumanTitleText(value: string, productId?: ProductId) {
  let title = sanitizeTitleLikeText(value);
  const isDelf = productId === 'delf_b2_writing' || /DELF|B2|写作|作文|法语B2/i.test(title);
  const isTef = productId === 'tef_tcf_canada' || /TEF|TCF|CLB|Canada/i.test(title);
  const stuckReplacement = /口语|开口/.test(title)
    ? '说不长'
    : /听力|听/.test(title)
      ? '听不懂'
      : /CLB|分数/.test(title)
        ? '上不去'
        : /写作|作文|DELF|B2/.test(title)
          ? '写不好'
          : '没方向';
  const replacements: Array<[RegExp, string]> = [
    [/资料太散/g, '资料太乱'],
    [/总卡住/g, stuckReplacement],
    [/卡住/g, stuckReplacement],
    [/正在拖后腿/g, '一直在扣分'],
    [/拖后腿/g, '扣分'],
    [/正在白背/g, '背了也用不上'],
    [/白背/g, '背了也用不上'],
    [/你的DELF\s*B2格式/g, 'DELF B2格式'],
    [/你的DELF\s*B2范文/g, 'DELF B2范文'],
    [/你的法语B2/g, '法语B2'],
    [/写作任务/g, '写作题型'],
    [/三类任务/g, '三类题型'],
    [/任务别混/g, '题型别混'],
    [/任务这样区分/g, '题型这样分'],
    [/模板别乱背，先看结构表/g, '模板背了用不上？'],
  ];
  for (const [pattern, replacement] of replacements) title = title.replace(pattern, replacement);
  if (isDelf) title = title.replace(/^B2(?!写作|作文|范文|格式|题型|句型|词汇)/, 'DELF B2');
  if (isTef) title = title.replace(/^法语备考/, 'TEF/TCF备考');
  return sanitizeTitleLikeText(title);
}

function isUnnaturalTitle(value: string) {
  return /资料太散|正在拖后腿|拖后腿|正在白背|白背|写作任务|你的DELF\s*B2|你的法语B2|卡住/.test(value);
}

function isNaturalTitle(value: string) {
  return !/测一测.{0,12}(?:评分维度|检查清单|句法库|词汇库)|按目的套用语|组合法语句|越改越口语/.test(value);
}

function isWeakCommercialTitle(value: string) {
  if (isUnnaturalTitle(value)) return true;
  if (!/[？?!！]/.test(value) && !/\d/.test(value) && !/别再|先别|警告|常犯|总|越|反而|像A2|不高级|卡住|跑题|白费|漏|错|太晚|不懂|不会|乱|别扭|差在哪|问题在这|一页|交卷前|考前/i.test(value)) {
    return true;
  }
  return /^(?:法语|DELF|B2|TEF|TCF).{0,8}(?:知识点|学习方案|资料|清单|指南|手册|怎么准备|这样准备|这样看|这样用|这样分|先看|先选对)/.test(value)
    || /(?:知识点|学习方案|资料整理|主题词汇|观点|表达)(?:这样|如何)?(?:准备|使用|整理|学习)$/.test(value)
    || /先选对这一档|先看这一页|这次具体练什么/.test(value);
}

function titleImpactScore(value: string) {
  let score = 0;
  if (isUnnaturalTitle(value)) score -= 12;
  if (/写不好|说不长|听不懂|背了也用不上|一直在扣分|老丢分|扣分|写不出来|用不上|没方向/.test(value)) score += 4;
  if (/法语|DELF|B2|TEF|TCF/i.test(value)) score += 3;
  if (/[？?!！]/.test(value)) score += 2;
  if (/\d/.test(value)) score += 2;
  if (/别再|先别|停止|警告|常犯|错误|避坑|白费|漏|错|跑题|卡住|乱|别扭|像A2|不高级|太晚|不懂|不会|差在哪|问题在这|根本原因/i.test(value)) score += 5;
  if (/为什么|其实|反而|不是|到底|真的|原来|没想到|看懂也会|背了还|背范文反而|资料越多/.test(value)) score += 4;
  if (/大全|必背|万能|考官|稳过|提分|冲刺|急救|救命|白考|白费|别乱|别硬背|别再|官方必背|最爱看/.test(value)) score += 4;
  if (/交卷前|考前|写完|一到考场|刚开始|没时间|没方向|零基础|B2考生/.test(value)) score += 3;
  if (/一页|这张表|这几类|这\d+[处类项步句个]|清单|体系|地图/.test(value)) score += 2;
  if (/怎么准备|这样准备|学习方案|知识点|指南|手册|内容整理/.test(value)) score -= 5;
  if (/^法语B2写作[:：].{2,}$/.test(value)) score -= 2;
  if (value.length > 20) score -= 2;
  if (value.length < 9) score -= 1;
  return score;
}

function titleSelectionScore(value: string, context: string) {
  return titleImpactScore(value) + titleContextFitScore(value, context);
}

function titleContextFitScore(value: string, context: string) {
  const titleTokens = titleSignalTokens(value);
  const contextTokens = new Set(titleSignalTokens(context));
  let score = 0;
  for (const token of titleTokens) {
    if (contextTokens.has(token)) score += token.length >= 4 ? 3 : 2;
  }
  if (/CLB\s*7/i.test(value) && /CLB\s*7/i.test(context)) score += 5;
  if (/TEF\s*\/\s*TCF/i.test(value) && /TEF\s*\/\s*TCF/i.test(context)) score += 5;
  if (/Canada|加拿大/i.test(value) && /Canada|加拿大/i.test(context)) score += 4;
  return score;
}

function titleSignalTokens(value: string) {
  const normalized = value
    .replace(/TEF\s*\/\s*TCF/gi, 'TEF/TCF')
    .replace(/CLB\s*7/gi, 'CLB7');
  const tokens = normalized.match(/TEF\/TCF|TEF|TCF|Canada|加拿大|CLB7|DELF|B2|法语|写作|备考|自测|评分|路径|资料|清单|范文|模板|词汇|听力|口语|报名|选考|流程|错题|检查|题型|格式/g);
  return Array.from(new Set(tokens || []));
}

function filterTitleCandidatesByContent(
  candidates: TitleCandidate[],
  topic: MigratedTopic,
  cover: NormalizedCover,
) {
  const context = `${topic.topic} ${topic.content_promise} ${cover.title} ${cover.subtitle} ${cover.sections.map(section => section.heading).join(' ')}`;
  return candidates.filter(item => {
    if (/范文/.test(item.title) && !/范文|完整文章|全文示例/.test(context)) return false;
    if (/模板/.test(item.title) && !/模板|框架|格式|句式/.test(context)) return false;
    if (/陷阱|错误|避坑/.test(item.title) && !/陷阱|错误|误区|避坑|纠错|错题/.test(context)) return false;
    return true;
  });
}

function ensureTitleCandidateMix(
  candidates: TitleCandidate[],
  coverTitle: string,
  topic: MigratedTopic,
  productId: ProductId,
) {
  const result: TitleCandidate[] = candidates.map(candidate => ({
    ...candidate,
    title_type: candidate.title_type || normalizeTitleCandidateType(`${candidate.trigger_type} ${candidate.title}`),
  }));
  const fallbacks = buildSeedTitleFallbacks(topic, productId);
  const strongCandidates = buildStrongTitleCandidates(topic, productId);
  const choiceCandidates = buildTitleChoiceCandidates(topic, productId, coverTitle);
  const append = (candidate: TitleCandidate) => {
    const title_type = candidate.title_type || normalizeTitleCandidateType(`${candidate.trigger_type} ${candidate.title}`) || (
      candidate.formula_id === 'free_original' ? '痛点型' : candidate.formula_id === 'reference_migration' ? '强钩子型' : '资料型'
    );
    if (!result.some(item => item.title === candidate.title)) result.push({ ...candidate, title_type });
  };
  choiceCandidates.forEach(append);
  if (!result.some(item => item.formula_id === 'free_original' && !isWeakCommercialTitle(item.title))) append({
    title: strongCandidates.free || fallbacks.free,
    title_type: '痛点型',
    formula_id: 'free_original',
    trigger_type: '痛点代入',
    formula_skeleton: '人群状态 + 真实痛点 + 反向提醒',
    reason: '先圈住正在写作卡住的人，再给出一个想点开的具体问题。',
    risk_flags: [],
  });
  if (!result.some(item => item.formula_id !== 'free_original' && item.formula_id !== 'reference_migration' && !isWeakCommercialTitle(item.title))) append({
    title: strongCandidates.formula,
    title_type: '强钩子型',
    formula_id: strongCandidates.formulaId,
    trigger_type: strongCandidates.triggerType,
    formula_skeleton: strongCandidates.skeleton,
    reason: '使用标题公式里的损失、数字或好奇结构，避免标题变成资料说明。',
    risk_flags: [],
  });
  if (!result.some(item => item.formula_id === 'reference_migration' && !isWeakCommercialTitle(item.title))) append({
    title: strongCandidates.reference || fallbacks.reference,
    title_type: '强钩子型',
    formula_id: 'reference_migration',
    trigger_type: '竞品钩子迁移',
    formula_skeleton: '高赞封面机制 + 本篇痛点',
    reason: '迁移竞品的停留机制，同时保留本篇自己的内容承诺。',
    risk_flags: [],
  });
  const required = [
    result.filter(item => item.formula_id !== 'free_original' && item.formula_id !== 'reference_migration').sort((a, b) => titleImpactScore(b.title) - titleImpactScore(a.title))[0],
    result.filter(item => item.formula_id === 'reference_migration').sort((a, b) => titleImpactScore(b.title) - titleImpactScore(a.title))[0],
    result.filter(item => item.formula_id === 'free_original').sort((a, b) => titleImpactScore(b.title) - titleImpactScore(a.title))[0],
  ].filter((item): item is TitleCandidate => Boolean(item));
  const choiceFirst = [
    result.find(item => item.title_type === '资料型'),
    result.find(item => item.title_type === '解释型'),
    result.find(item => item.title_type === '强钩子型'),
    result.find(item => item.title_type === '情绪型'),
    result.find(item => item.title_type === '结果型'),
  ].filter((item): item is TitleCandidate => Boolean(item));
  const rest = uniqueTitleCandidatesStrict([...required, ...result.filter(item => !choiceFirst.includes(item) && !required.includes(item))])
    .sort((a, b) => titleImpactScore(b.title) - titleImpactScore(a.title));
  return uniqueTitleCandidatesStrict([...choiceFirst, ...rest]).slice(0, 6);
}

function uniqueTitleCandidates(candidates: TitleCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = candidate.title.replace(/[\s，,。；;：:！？!?]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueTitleCandidatesStrict(candidates: TitleCandidate[]) {
  const seen = new Set<string>();
  const seenMeaning: string[] = [];
  return candidates.filter(candidate => {
    const key = sanitizeTitleLikeText(candidate.title).replace(/[\s，。；：、！？!?·《》“”"'（）()]/g, '').toLowerCase();
    if (!key || seen.has(key)) return false;
    const meaningKey = titleMeaningKey(candidate.title);
    if (meaningKey && seenMeaning.some(existing => existing === meaningKey || titleMeaningOverlap(existing, meaningKey) >= 0.72)) return false;
    seen.add(key);
    if (meaningKey) seenMeaning.push(meaningKey);
    return true;
  });
}

function titleMeaningKey(value: string) {
  return polishHumanTitleText(value)
    .replace(/DELF\s*B2|TEF\s*\/\s*TCF|TEF|TCF|CLB\s*7|Canada/gi, '')
    .replace(/法语|B2|写作|作文|备考|资料|模板|范文|这张|这份|先看|先别|别再|的人|一下/g, '')
    .replace(/[\s，。；：、！？!?·《》“”"'（）()]/g, '')
    .toLowerCase();
}

function titleMeaningOverlap(a: string, b: string) {
  const left = titleMeaningTokens(a);
  const right = new Set(titleMeaningTokens(b));
  if (!left.length || !right.size) return 0;
  const hit = left.filter(token => right.has(token)).length;
  return hit / Math.max(left.length, right.size);
}

function titleMeaningTokens(value: string) {
  return Array.from(new Set(value.match(/[A-Za-z0-9]+|[\u4e00-\u9fa5]{2}/g) || []));
}

function buildSeedTitleFallbacks(topic: MigratedTopic, productId: ProductId) {
  const bySeed: Record<ProductId, Record<string, { free: string; reference: string }>> = {
    delf_b2_writing: {
      delf_formal_opening_closing: { free: 'DELF B2开头总卡住？', reference: 'DELF B2开头结尾这样选' },
      delf_final_check: { free: 'DELF B2交卷前查什么', reference: 'DELF B2作文按这几类检查' },
      delf_wrong_right: { free: '法语B2这些错误别再犯', reference: 'DELF B2错句应该这样改' },
      delf_sentence_upgrade: { free: '法语B2句式怎么用才自然', reference: 'DELF B2句式按用途学' },
      delf_connectors: { free: '法语B2连接词别乱换', reference: 'DELF B2连接词这样分' },
      delf_topic_vocabulary: { free: 'DELF B2主题词怎么准备', reference: 'DELF B2词汇按主题积累' },
      delf_argument_bank: { free: 'DELF B2没观点怎么展开', reference: 'DELF B2观点这样写具体' },
      delf_sample_transfer: { free: 'DELF B2范文别整篇背', reference: 'DELF B2范文这样拆才会用' },
      delf_task_formats: { free: 'DELF B2三类题型别混', reference: 'DELF B2写作题型这样分' },
      delf_learning_route: { free: 'DELF B2写作先练哪一块', reference: 'DELF B2按阶段安排复习' },
      delf_scoring_dimensions: { free: 'DELF B2作文该怎么自评', reference: 'DELF B2评分维度这样看' },
      delf_combination_examples: { free: '法语B2表达怎么组合', reference: 'DELF B2词句观点这样拼' },
    },
    tef_tcf_canada: {
      tef_exam_choice: { free: 'TEF还是TCF？别急着报名', reference: 'TEF/TCF选考看这张表' },
      tef_clb7_self_test: { free: 'CLB7四科差在哪？先测', reference: 'TEF/TCF自测先做这步' },
      tef_30_day_plan: { free: 'TEF/TCF备考别再乱刷', reference: '30天计划按这个走' },
      tef_writing_patterns: { free: 'TEF/TCF句型背了用不上？', reference: 'TEF/TCF句型按功能分' },
      tef_topic_vocab: { free: 'TEF/TCF词背了还说不出？', reference: 'TEF/TCF主题词这样用' },
      tef_true_topics: { free: 'TEF/TCF写作别临场想观点', reference: 'TEF/TCF高频主题这样准备' },
      tef_listening_method: { free: 'TCF听力临考猛刷有用吗', reference: 'TEF/TCF听力训练顺序' },
      tef_speaking_strategy: { free: 'TEF/TCF口语卡住？不只缺词', reference: 'TEF/TCF口语这样准备' },
      tef_b2_c1_comparison: { free: '加拿大法语写作差在哪？', reference: 'TEF/TCF写作B2到C1差什么' },
      tef_exam_day_flow: { free: 'TEF/TCF考试流程别当天查', reference: 'TEF/TCF流程清单看这张' },
      tef_avoid_pitfalls: { free: 'TEF/TCF备考越努力越乱？', reference: 'TEF/TCF避坑看这几条' },
      tef_product_showcase: { free: 'TEF/TCF资料别再乱收了', reference: 'TEF/TCF资料包怎么用' },
    },
  };
  const identity = getProductPromptProfile(productId).shortIdentity;
  return bySeed[productId][topic.seed_id || ''] || {
    free: `${identity}备考这次具体练什么`,
    reference: `${identity}备考按用途整理更清楚`,
  };
}

function buildStrongTitleCandidates(topic: MigratedTopic, productId: ProductId) {
  const text = `${topic.seed_id || ''} ${topic.topic} ${topic.pain} ${topic.content_promise} ${topic.content_shape}`;
  const profile = getProductPromptProfile(productId);
  if (productId === 'tef_tcf_canada') return buildTefTcfStrongTitleCandidates(topic, text);
  const base = profile.shortIdentity;
  const writing = profile.noteIdentity;
  if (topic.topic_type === 'search_pain') {
    if (/范文|迁移|仿写/.test(text)) {
      return {
        free: `${base}范文别整篇背`,
        formula: `${base}背范文反而写不出？`,
        formulaId: '1',
        triggerType: '认知冲突',
        skeleton: '为什么 [每个人都觉得很好的事] 其实对你有害？',
        reference: `${base}范文这样拆才会用`,
      };
    }
    if (/评分|自评|检查|批改|交卷|写完/.test(text)) {
      return {
        free: `写完法语作文，先别急着交`,
        formula: `${base}写作越改越乱？`,
        formulaId: '17',
        triggerType: '恐惧损失',
        skeleton: '警告！[数字] 件事正让你的 [努力] 白费',
        reference: `${base}交卷前别漏这几项`,
      };
    }
    if (/题型|任务|格式|文体|正式信|论坛|建议/.test(text)) {
      return {
        free: `${base}题目看懂也会跑题？`,
        formula: `${base}写作总跑题？先判文体`,
        formulaId: '19',
        triggerType: '恐惧损失',
        skeleton: '[一群人] 常犯的 [数字] 个错误',
        reference: `${base}三类任务别再混`,
      };
    }
  }
  if (topic.topic_type === 'selling_point') {
    if (/路线|路径|规划|阶段|资料|顺序|安排/.test(text)) {
      return {
        free: `${base}写作先练哪一块？`,
        formula: `资料越多，${base}写作越乱？`,
        formulaId: '56',
        triggerType: '场景条件',
        skeleton: '如果你 [抗拒] [抗拒] [抗拒]，如何解决 [问题]',
        reference: `${base}备考别再乱翻资料`,
      };
    }
    if (/词汇|表达|主题词/.test(text)) {
      return {
        free: `${writing}词背了还用不上？`,
        formula: `${base}别再硬背主题词`,
        formulaId: '29',
        triggerType: '数字锚定',
        skeleton: '[行动] 时，[数字] 个最有用的词',
        reference: `${base}主题词按场景用`,
      };
    }
  }
  if (topic.topic_type === 'product_showcase' || /product_showcase|资料库|知识库|资料包|备考资料|备考攻略|东翻西找/.test(text)) {
    return {
      free: `DELF B2资料别乱收了`,
      formula: `资料越多，${base}写作越乱？`,
      formulaId: '1',
      triggerType: '认知冲突',
      skeleton: '为什么 [每个人都觉得很好的事] 其实对你有害？',
      reference: `${base}资料库怎么用才不浪费`,
    };
  }
  if (/task|format|正式信|论坛|建议信|投诉|任务|文体|读题|审题/.test(text)) {
    return {
      free: `${base}写作总跑题？先判文体`,
      formula: `${base}题目看懂也会跑题？`,
      formulaId: '19',
      triggerType: '好奇缺口',
      skeleton: '[一群人] 常犯的 [数字] 个错误',
      reference: `${base}任务别再混着写`,
    };
  }
  if (/final|check|自查|检查|评分|交卷|考前/.test(text)) {
    return {
      free: `写完法语作文，先别急着交`,
      formula: `${base}写作越改越乱？`,
      formulaId: '19',
      triggerType: '冲突钩子',
      skeleton: '[一群人] 常犯的 [数字] 个错误',
      reference: `${base}交卷前别漏这几项`,
    };
  }
  if (/wrong|错误|错题|纠错|扣分|避坑/.test(text)) {
    return {
      free: `${writing}像A2？问题在这`,
      formula: `${base}写作没大错却不高级？`,
      formulaId: '19',
      triggerType: '反常识',
      skeleton: '[一群人] 常犯的 [数字] 个错误',
      reference: `${writing}这些错别再犯`,
    };
  }
  if (/vocab|词汇|单词|表达/.test(text)) {
    return {
      free: `${writing}词背了还用不上？`,
      formula: `${base}别再硬背主题词`,
      formulaId: '29',
      triggerType: '行动号召',
      skeleton: '[行动] 时，[数字] 个最有用的词',
      reference: `${base}主题词别硬背`,
    };
  }
  if (/sentence|句式|句法|连接词|connect|表达替换/.test(text)) {
    return {
      free: `${writing}别再只会mais`,
      formula: `${base}写作越升级越别扭？`,
      formulaId: '32',
      triggerType: '认知冲突',
      skeleton: '[数字] 个 [话题] 的最大谎言',
      reference: `${base}表达别乱升级`,
    };
  }
  if (/sample|范文|迁移|仿写/.test(text)) {
    return {
      free: `${base}范文别整篇背`,
      formula: `${base}背范文反而写不出？`,
      formulaId: '1',
      triggerType: '认知冲突',
      skeleton: '为什么 [每个人都觉得很好的事] 其实对你有害？',
      reference: `${base}范文这样拆才会用`,
    };
  }
  if (/route|plan|规划|阶段|安排|学习路径/.test(text)) {
    return {
      free: `${writing}越练越乱？先停`,
      formula: `资料越多，${base}写作越乱？`,
      formulaId: '56',
      triggerType: '认知冲突',
      skeleton: '如果你 [抗拒] [抗拒] [抗拒]，如何解决 [问题]',
      reference: `${base}写作先练哪一块`,
    };
  }
  return {
    free: `${writing}卡住？先看这张表`,
    formula: `${base}越背越写不出来？`,
    formulaId: '1',
    triggerType: '认知冲突',
    skeleton: '为什么 [每个人都觉得很好的事] 其实对你有害？',
    reference: `${base}写作别再瞎练`,
  };
}

function buildTefTcfStrongTitleCandidates(topic: MigratedTopic, text: string) {
  const seed = topic.seed_id || '';
  const pack = (free: string, formula: string, reference: string, triggerType = '恐惧损失') => ({
    free,
    formula,
    formulaId: triggerType === '认知冲突' ? '1' : triggerType === '数字锚定' ? '29' : '17',
    triggerType,
    skeleton: triggerType === '认知冲突'
      ? '为什么 [常见做法] 反而让你更乱？'
      : triggerType === '数字锚定'
        ? '[场景] 里最该先看的 [数字] 件事'
        : '[一群人] 常犯的 [数字] 个错误',
    reference,
  });
  if (seed === 'tef_exam_choice' || /TEF还是TCF|选考|报名/.test(text)) {
    return pack('TEF还是TCF？别急着报名', 'TEF/TCF选错，后面全乱？', 'TEF/TCF选考看这张表', '恐惧损失');
  }
  if (seed === 'tef_clb7_self_test' || /CLB|NCLC|自测|四科/.test(text)) {
    return pack('CLB7差在哪？先别乱刷', '想冲CLB7，先测这4科', 'CLB7自测先做这一步', '数字锚定');
  }
  if (seed === 'tef_30_day_plan' || /30天|计划|每天|2小时|路径|安排/.test(text)) {
    return pack('TEF/TCF备考别平均用力', '每天2小时，别这样备考', 'TEF/TCF按阶段安排复习', '认知冲突');
  }
  if (seed === 'tef_writing_patterns' || /句型|写作|模板/.test(text)) {
    return pack('TEF/TCF句型背了用不上？', 'TEF/TCF别再硬背模板', 'TEF/TCF句型按功能分', '认知冲突');
  }
  if (seed === 'tef_topic_vocab' || /词汇|主题词|600词|背词/.test(text)) {
    return pack('法语词背了还说不出？', 'TEF/TCF词汇别再散着背', 'TEF/TCF主题词按场景用', '认知冲突');
  }
  if (seed === 'tef_true_topics' || /主题|观点|素材|真题/.test(text)) {
    return pack('TEF/TCF写作别临场想观点', '考场没观点，先补这几类', 'TEF/TCF高频主题这样准备', '恐惧损失');
  }
  if (seed === 'tef_listening_method' || /听力|精听|复听|语速/.test(text)) {
    return pack('TEF/TCF听力别只猛刷题', '听力刷很多还听不懂？', 'TEF/TCF听力这样复盘', '认知冲突');
  }
  if (seed === 'tef_speaking_strategy' || /口语|开口|论据|过渡/.test(text)) {
    return pack('TEF/TCF口语卡住？不只缺词', '口语说不长，问题不在词少', 'TEF/TCF口语这样展开', '认知冲突');
  }
  if (seed === 'tef_b2_c1_comparison' || /B2到C1|高分范文|对比/.test(text)) {
    return pack('法语写作差的不是高级词', 'B2到C1，差在这几处', '法语写作B2到C1这样看', '认知冲突');
  }
  if (seed === 'tef_exam_day_flow' || /流程|机考|查分|进场|考场/.test(text)) {
    return pack('TEF/TCF流程别当天才查', '上考场前，这几步别漏', 'TEF/TCF流程清单看这张', '恐惧损失');
  }
  if (seed === 'tef_avoid_pitfalls' || /避坑|乱|白费|效率/.test(text)) {
    return pack('TEF/TCF备考越努力越乱？', '这些坑，让备考时间白花', 'TEF/TCF避坑看这几条', '恐惧损失');
  }
  if (seed === 'tef_product_showcase' || /资料包|资料|系统备考/.test(text)) {
    return pack('TEF/TCF资料别再乱收了', '资料越多，备考越乱？', 'TEF/TCF资料包按顺序用', '认知冲突');
  }
  return pack('TEF/TCF备考先别乱刷', '越努力越没方向？先停', 'TEF/TCF备考按问题拆', '认知冲突');
}

function buildTitleChoiceCandidates(topic: MigratedTopic, productId: ProductId, coverTitle: string): TitleCandidate[] {
  const text = `${topic.seed_id || ''} ${topic.topic} ${topic.pain} ${topic.content_promise} ${coverTitle}`;
  const profile = getProductPromptProfile(productId);
  const base = profile.shortIdentity;
  const writing = profile.noteIdentity;
  const topicName = topic.topic_type === 'product_showcase' ? '资料库' : inferTitleTopicName(text);
  const usage = inferTitleUsage(text);
  const material = topic.topic_type === 'product_showcase'
    ? buildProductShowcaseTitle(productId, writing)
    : buildMaterialTitle(productId, base, topicName, text);
  const explanation = topic.topic_type === 'product_showcase'
    ? buildProductShowcaseExplainTitle(productId, writing)
    : buildExplanationChoiceTitle(writing, usage, text);
  const strongPack = buildStrongTitleCandidates(topic, productId);
  const strong = strongPack.formula;
  const emotion = buildEmotionTitle(productId, text, strongPack.free);
  const result = buildResultTitle(productId, text);
  const choices: TitleCandidate[] = [
    {
      title: material,
      title_type: '资料型',
      formula_id: 'material_choice',
      trigger_type: '资料型',
      formula_skeleton: '领域身份 + 资料名 + 速查/清单',
      reason: '适合资料型封面和搜索收藏，点击欲中等但承接最稳。',
      risk_flags: [],
    },
    {
      title: explanation,
      title_type: '解释型',
      formula_id: 'explain_choice',
      trigger_type: '解释型',
      formula_skeleton: '领域身份 + 用户正在卡的问题 + 怎么查/怎么用',
      reason: '适合用户已经有明确痛点时点击，语气比强钩子更稳。',
      risk_flags: [],
    },
    {
      title: strong,
      title_type: '强钩子型',
      formula_id: 'strong_choice',
      trigger_type: '强钩子型',
      formula_skeleton: '痛点/损失/反常识 + 具体承接',
      reason: '优先拉点击和停留，但发布前要确认正文能承接标题承诺。',
      risk_flags: [],
    },
    {
      title: emotion,
      title_type: '情绪型',
      formula_id: 'emotion_choice',
      trigger_type: '场景代入',
      formula_skeleton: '用户状态 + 情绪词/损失感 + 行动提醒',
      reason: '封面首屏和推荐流更容易让用户觉得“说的是我”。',
      risk_flags: [],
    },
    {
      title: result,
      title_type: '结果型',
      formula_id: 'result_choice',
      trigger_type: '结果承诺',
      formula_skeleton: '时间/目标/结果 + 具体动作',
      reason: '适合用户想快速判断这篇能带来什么结果。',
      risk_flags: [],
    },
  ];
  return choices.filter(item => item.title && hasRequiredProductIdentity(productId, item.title) && !hasForbiddenProductIdentity(productId, item.title));
}

function buildProductShowcaseTitle(productId: ProductId, writing: string) {
  if (productId === 'tef_tcf_canada') return 'TEF/TCF资料别再乱收了';
  return `${writing}资料别再乱收了`;
}

function buildProductShowcaseExplainTitle(productId: ProductId, writing: string) {
  if (productId === 'tef_tcf_canada') return 'TEF/TCF备考资料怎么用才不乱？';
  return `${writing}资料怎么用才不乱？`;
}

function buildMaterialTitle(productId: ProductId, base: string, topicName: string, text: string) {
  if (productId === 'tef_tcf_canada') {
    if (/选考|TEF还是TCF/.test(text)) return 'TEF和TCF区别在哪？先看这张表';
    if (/CLB|自测/.test(text)) return 'CLB7自测表，先看你差在哪科';
    if (/30天|计划|路径/.test(text)) return 'TEF/TCF 30天备考路线图';
    return clip(`${base}${topicName}，我整理好了`, 20);
  }
  if (/评分|检查|交卷|自查/.test(text)) return 'DELF B2写作扣分点，我做成检查表';
  if (/范文|模板/.test(text)) return '法语B2模板背了用不上？';
  return clip(`${base}${topicName}，考前直接照这个查`, 20);
}

function buildEmotionTitle(productId: ProductId, text: string, fallback: string) {
  if (productId === 'tef_tcf_canada') {
    if (/口语|开口/.test(text)) return 'TEF口语一开口就卡？你可能缺的不是单词';
    if (/选考|TEF还是TCF/.test(text)) return 'TEF/TCF备考最怕的，是一开始选错';
    if (/CLB|四科/.test(text)) return 'CLB7一直卡住的人，别再四科平均用力';
    if (/听力/.test(text)) return 'TEF/TCF听力刷很多题还听不懂？';
    return 'TEF/TCF备考越努力越乱的人，先停一下';
  }
  if (/评分|检查|交卷|自查/.test(text)) return '救命，DELF B2写作不是不会写';
  if (/范文|模板/.test(text)) return '法语B2写作卡住的人，真的别再硬背范文了';
  if (/格式|文体|任务/.test(text)) return 'DELF B2写作总跑题的人，先别急着下笔';
  if (/词汇|句式|连接词/.test(text)) return 'B2写作写完像A2？可能不是词汇量的问题';
  return fallback || '法语B2写作总差一点的人，先看问题在哪';
}

function buildResultTitle(productId: ProductId, text: string) {
  if (productId === 'tef_tcf_canada') {
    if (/CLB|30天|计划|路径/.test(text)) return '3个月冲CLB7，TEF/TCF先这样排顺序';
    if (/口语|开口/.test(text)) return 'TEF口语想说长一点，先练这3类展开';
    if (/写作|句型/.test(text)) return 'TEF/TCF写作想提速，先用熟这几类句型';
    return 'TEF/TCF备考想少走弯路，先按这张表排';
  }
  if (/评分|检查|交卷|自查/.test(text)) return '考前7天，我会先看B2写作检查表';
  if (/词汇|表达|句式|连接词/.test(text)) return '想让DELF B2作文更像B2，先换这类表达';
  if (/范文|模板/.test(text)) return '法语B2写作提分，别先背范文，先拆结构';
  return '想让法语B2作文更像B2，先看这张表';
}

function inferTitleTopicName(text: string) {
  if (/TEF还是TCF|选考|报名/.test(text)) return '选考对照';
  if (/CLB|NCLC|自测|四科/.test(text)) return 'CLB自测';
  if (/听力|精听|复听|语速/.test(text)) return '听力训练';
  if (/口语|开口|论据|过渡/.test(text)) return '口语展开';
  if (/流程|机考|查分|进场|考场/.test(text)) return '考试流程';
  if (/评分|自评|维度/.test(text)) return '评分维度';
  if (/自查|检查|交卷|final/.test(text)) return '交卷自查';
  if (/任务|文体|正式信|论坛|建议信|投诉|读题|审题/.test(text)) return '任务识别';
  if (/错误|错题|纠错|避坑/.test(text)) return '常见错误';
  if (/词汇|单词|主题词/.test(text)) return '主题词汇';
  if (/句式|句型|句法/.test(text)) return '句式表达';
  if (/连接词|衔接/.test(text)) return '衔接表达';
  if (/范文|迁移|仿写/.test(text)) return '范文拆解';
  if (/任务|文体|正式信|论坛|建议信|投诉/.test(text)) return '任务格式';
  if (/规划|路径|阶段|安排/.test(text)) return '练习路径';
  if (/观点|论证|主题/.test(text)) return '观点展开';
  return '写作知识';
}

function inferTitleUsage(text: string) {
  if (/TEF还是TCF|选考|报名/.test(text)) return '选考';
  if (/CLB|NCLC|自测|四科/.test(text)) return 'CLB7';
  if (/听力|精听|复听|语速/.test(text)) return '听力';
  if (/口语|开口|论据|过渡/.test(text)) return '口语';
  if (/流程|机考|查分|进场|考场/.test(text)) return '流程';
  if (/评分|自评|维度/.test(text)) return '评分';
  if (/交卷|自查|检查/.test(text)) return '交卷前';
  if (/任务|文体|正式信|论坛|建议信|投诉|读题|审题/.test(text)) return '文体';
  if (/错误|错题|纠错/.test(text)) return '错句';
  if (/词汇|单词|表达/.test(text)) return '表达';
  if (/范文|迁移|仿写/.test(text)) return '范文';
  if (/任务|文体|正式信|论坛|建议信|投诉/.test(text)) return '文体';
  return '到底';
}

function buildExplanationChoiceTitle(identity: string, usage: string, text: string) {
  if (/TEF还是TCF|选考|报名/.test(text)) return `${identity}该怎么选？`;
  if (/CLB|NCLC|自测|四科/.test(text)) return `CLB7差在哪？`;
  if (/听力|精听|复听|语速/.test(text)) return `${identity}听力怎么练？`;
  if (/口语|开口|论据|过渡/.test(text)) return `${identity}口语怎么展开？`;
  if (/流程|机考|查分|进场|考场/.test(text)) return `${identity}流程怎么查？`;
  if (/评分|自评|维度/.test(text)) return `${identity}评分到底看什么？`;
  if (/交卷|自查|检查/.test(text)) return `${identity}交卷前怎么查？`;
  if (/错误|错题|纠错/.test(text)) return `${identity}错句到底错在哪？`;
  if (/词汇|单词|表达/.test(text)) return `${identity}表达怎么才像B2？`;
  if (/范文|迁移|仿写/.test(text)) return `${identity}范文到底怎么拆？`;
  if (/任务|文体|正式信|论坛|建议信|投诉/.test(text)) return `${identity}文体到底怎么判？`;
  return `${identity}${usage}怎么查？`;
}

// "N大主题/N大模块/N大方向" 是 LLM 偏爱的标题写法。原来的单位表只有
// (句|个|条|项|组|类)，"大"字起头的复合单位完全绕过校验，导致 "DELF B2 10大主题核心词汇"
// 这种标题（实际只有 3 组）既不会被自动对齐，也不会触发 cover_count_mismatch 重试。
// 长单位必须排在单字单位前面，否则 leftmost-first 的 regex 会先吃掉 "类/组"，
// 把 "大" 字留在原文，对齐结果就破了。
const SECTION_LEVEL_UNITS = new Set(['类', '组', '大类', '大组', '大主题', '大模块', '大方向', '大话题', '大板块', '大场景']);
const COVER_COUNT_CLAIM_PATTERN = /(\d+)\s*(大主题|大模块|大方向|大话题|大板块|大场景|大类|大组|句|个|条|项|组|类)/g;
const NOTE_ITEM_COUNT_PATTERN = /(\d+)\s*(大主题|大模块|大方向|大话题|大板块|大场景|大类|大组|句|个|条|项|组)/g;

function scrubCheapClaims(text: string) {
  return text
    .replace(/230\s*[-~至]\s*280\s*词/g, '至少250词')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*论据/g, '论据充分具体')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*主题词/g, '主题词准确多样')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*条件式/g, '条件式按语义使用')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*关系从句/g, '关系从句自然使用')
    .replace(/(?:至少|≥)\s*\d+\s*种?\s*(?:不同的)?连接词/g, '连接词按逻辑使用')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*B2(?:级)?表达/g, '使用准确的B2表达')
    .replace(/(?:至少|≥)\s*\d+\s*种?\s*时态/g, '时态主线清楚')
    .replace(/主题词\s*(?:≥|至少)\s*\d+\s*个?/g, '主题词准确多样')
    .replace(/主题词汇\s*(?:≥|至少)\s*\d+\s*个?/g, '主题词汇准确多样')
    .replace(/虚拟式\s*(?:≥|至少)\s*\d+\s*个?/g, '虚拟式按语义使用')
    .replace(/条件式\s*(?:≥|至少)\s*\d+\s*个?/g, '条件式按语义使用')
    .replace(/关系从句\s*(?:≥|至少)\s*\d+\s*个?/g, '关系从句自然使用')
    .replace(/连接词\s*(?:≥|至少)\s*\d+\s*种?/g, '连接词按逻辑使用')
    .replace(/B2(?:级)?表达\s*(?:≥|至少)\s*\d+\s*个?/g, '使用准确的B2表达')
    .replace(/时态\s*(?:≥|至少)\s*\d+\s*种?/g, '时态主线清楚')
    .replace(/B2(?:级)?替换\s*(?:≥|至少)?\s*\d*\s*个?/g, '词汇符合语境')
    .replace(/每段(?:开头)?\s*(?:必须|都要|至少|有)\s*(?:一个?)?\s*连接词/g, '连接词衔接自然')
    .replace(/每段开头连接词/g, '连接词衔接自然')
    .replace(/每段有主题句/g, '段落主旨清楚')
    .replace(/观点文有让步段/g, '观点有适当限定')
    .replace(/全程\s*用\s*vous/g, '称呼与对象保持一致')
    .replace(/避免泛指\s*on/g, '主语指代清楚')
    .replace(/代词所指不超过前两句/g, '代词所指要清楚')
    .replace(/前两句内必须有先行词/g, '前文要有明确先行词')
    .replace(/前两句内明确出现/g, '前文有明确先行词')
    .replace(/Pas de ['’]on['’]/gi, 'on 按语境使用')
    .replace(/至少\s*\d+\s*个?\s*B2(?:级)?词汇/g, '使用准确的B2词汇')
    .replace(/至少\s*\d+\s*个?\s*B2(?:级)?表达/g, '使用准确的B2表达')
    .replace(/至少\s*\d+\s*个?\s*虚拟式/g, '虚拟式按语义使用')
    .replace(/至少\s*\d+\s*个?\s*连接词/g, '连接词按逻辑使用')
    .replace(/至少\s*\d+\s*种?\s*(?:不同的)?连接词/g, '连接词按逻辑使用')
    .replace(/至少\s*\d+\s*种?\s*时态/g, '时态主线清楚')
    .replace(/每段.{0,8}(?:必须|至少).{0,8}连接词/g, '连接词按逻辑使用')
    .replace(/每段.{0,8}(?:必须|至少).{0,8}例子/g, '论点配合具体例子')
    .replace(/每段.{0,8}(?:必须|至少).{0,8}数据/g, '论点可用事实支撑')
    .replace(/(?:需|必须)包含\s*date\s*,\s*destinataire\s*,\s*objet\s*,\s*formule d'appel et de politesse/gi, '注意称呼、正文结构和礼貌结尾；objet等要素按题目场景处理')
    .replace(/(?:需|必须)包含\s*date[、，,]\s*destinataire[、，,]\s*objet/gi, '注意称呼、正文结构和礼貌结尾；objet等要素按题目场景处理')
    .replace(/高手不会告诉你的?/g, '')
    .replace(/一步到位/g, '逐步掌握')
    .replace(/考官追着给分/g, 'B2高阶表达')
    .replace(/考官最想要/g, '评分标准看重')
    .replace(/考官/g, '评分标准')
    .replace(/阅卷老师(?:最)?看重/g, 'B2写作常用')
    .replace(/阅卷老师/g, '评分标准')
    .replace(/万能/g, '常用')
    .replace(/必背/g, '常用')
    .replace(/捷径/g, '方法')
    .replace(/高分/g, '更稳')
    .replace(/精准提分/g, '找到改进方向')
    .replace(/提分方向/g, '改进方向')
    .replace(/分数卡在\s*\d+\s*分左右/g, '写作一直卡住')
    .replace(/格式分/g, '格式问题')
    .replace(/(?:我|我的)整理方法/g, '可以这样整理')
    .replace(/让我考前[^，。；\n]{0,24}/g, '考前复盘时')
    .replace(/考场不超时/g, '考场更不慌')
    .replace(/练了好几篇还是B1/g, '练了好几篇还是像B1')
    .replace(/直接降分/g, '影响整体表达')
    .replace(/直接扣掉\s*\d+(?:\s*[-~至]\s*\d+)?\s*分/g, '影响格式表现')
    .replace(/扣结构分/g, '结构会显得不稳')
    .replace(/任务完成度打折扣/g, '任务完成度不够完整')
    .replace(/正式信全程用\s*vous/gi, '正式信通常用 vous')
    .replace(/动笔前花\s*\d+\s*分钟/g, '动笔前先')
    .replace(/\d+\s*天复习路径/g, '阶段复习路径')
    .replace(/直接调用/g, '按语境调用')
    .replace(/直接调取/g, '按题目调取')
    .replace(/调用功能块/g, '按题目选表达模块')
    .replace(/替换主题词[，,]?\s*就能/g, '重写主题词后，再')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/效率翻倍/g, '更省力')
    .replace(/必查/g, '重点查')
    .replace(/白考/g, '白费')
    .replace(/保分|必过|包过/g, '提分')
    .replace(/扣\s*\d+\s*分/g, '容易丢分')
    .replace(/\d+\s*%/g, '不少')
    .replace(/百分之\d*/g, '不少')
    .replace(/★+/g, '')
    .replace(/[，、。；]{2,}/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeFrenchIdentity(text: string) {
  return text
    .replace(/法语\s*DELF\s*B2/gi, 'DELF B2')
    .replace(/DELF\s*B2\s*法语/gi, 'DELF B2')
    .replace(/法语\s*B2\s*法语/gi, '法语B2');
}

function alignCoverCountClaims(text: string, itemCount: number, sectionCount: number) {
  return text.replace(COVER_COUNT_CLAIM_PATTERN, (_match, rawCount: string, unit: string) => {
    const claimed = Number(rawCount);
    const expected = SECTION_LEVEL_UNITS.has(unit) ? sectionCount : itemCount;
    if (!Number.isFinite(claimed) || expected <= 0 || claimed === expected) {
      return `${rawCount}${unit}`;
    }
    return `${expected}${unit}`;
  });
}

function alignNoteItemCountClaims(text: string, itemCount: number, sectionCount: number) {
  return text.replace(NOTE_ITEM_COUNT_PATTERN, (_match, rawCount: string, unit: string) => {
    const claimed = Number(rawCount);
    const expected = SECTION_LEVEL_UNITS.has(unit) ? sectionCount : itemCount;
    if (!Number.isFinite(claimed) || expected <= 0 || claimed === expected) {
      return `${rawCount}${unit}`;
    }
    return `${expected}${unit}`;
  });
}

function hasCoverCountMismatch(text: string, itemCount: number, sectionCount: number) {
  for (const match of text.matchAll(COVER_COUNT_CLAIM_PATTERN)) {
    const claimed = Number(match[1]);
    const unit = match[2];
    const expected = SECTION_LEVEL_UNITS.has(unit) ? sectionCount : itemCount;
    if (Number.isFinite(claimed) && expected > 0 && claimed !== expected) return true;
  }
  return false;
}

function syncTitlesWithCoverCounts(
  titles: TitleCandidate[],
  selectedTitle: string,
  _cover: ReturnType<typeof normalizeDenseDirectoryCover>,
) {
  const syncOne = (value: string) => clip(normalizeFrenchIdentity(sanitizeTitleLikeText(value)), 20);
  return {
    titleCandidates: titles.map(item => ({ ...item, title: syncOne(item.title) })),
    selectedTitle: syncOne(selectedTitle),
  };
}

function ensureCoverIdentity(
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
  renderer: ProductCard['renderer_id'],
  productId: ProductId,
) {
  const spec = getCoverTemplateSpec(renderer);
  const family = spec?.family;
  const flexibleCapacity = Boolean(spec) && ['directory', 'document', 'offer', 'experience', 'pain', 'roadmap', 'book', 'table'].includes(spec!.family);
  const rawSections = flexibleCapacity && spec
    ? cover.sections.slice(0, spec.sectionCount + 1)
    : cover.sections;
  const explainShorthand = (value: string) => value
    .replace(/vocabulaire\s*B2/gi, 'B2词汇')
    .replace(/\bconcordance\b/gi, '时态配合')
    .replace(/\baccords?\b/gi, '性数配合')
    .replace(/\bsubj\.?\b/gi, '虚拟式')
    .replace(/\bcond\.?\b/gi, '条件式');
  const sanitizeCoverText = (value: string) => scrubCheapClaims(sanitizePublicText(value));
  const sanitizeCoverTitle = (value: string) => sanitizeTitleLikeText(normalizeFrenchIdentity(value));
  const sections = spec ? rawSections.map(section => ({
    ...section,
    heading: sanitizeCoverText(section.heading),
    side_label: sanitizeCoverText(section.side_label || ''),
    items: section.items.map(item => ({
      ...item,
      primary: clipVisual(explainShorthand(sanitizeCoverText(item.primary)), spec.maxPrimaryVisualLength),
      secondary: item.secondary
        ? clipVisual(explainShorthand(sanitizeCoverText(item.secondary)), spec.maxSecondaryVisualLength)
        : undefined,
      note: item.note ? sanitizeCoverNote(item.note) : item.note,
    })),
  })) : rawSections;
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const sectionCount = sections.length;
  let title = alignCoverCountClaims(sanitizeCoverTitle(cover.title), itemCount, sectionCount);
  let subtitle = cover.subtitle.length >= 8
    ? clip(alignCoverCountClaims(sanitizeCoverTitle(cover.subtitle), itemCount, sectionCount), 24)
    : '';
  const hasOwnIdentity = hasRequiredProductIdentity(productId, title) && !hasForbiddenProductIdentity(productId, title);
  // 拒绝被 clip 截断后留下 `…` 的半截标题：说明上游 LLM 输出过长，封面不该
  // 留这种半句话。fallback 来自 profile，能给出完整的"商品 + 知识体系"标题。
  const looksTruncated = /[….]+$/.test(title) || /\.\.\.$/.test(title);
  if (hasOwnIdentity && !looksTruncated && title.length >= 8 && title.length <= 18) {
    return { ...cover, title, subtitle, sections };
  }
  title = getRendererCoverFallbackTitle(productId, renderer, family);
  return { ...cover, title, subtitle, sections };
}

function getRendererCoverFallbackTitle(productId: ProductId, renderer: ProductCard['renderer_id'], family?: ContentShape) {
  const rendererFallbacks: Partial<Record<ProductCard['renderer_id'], Partial<Record<ProductId, string>>>> = {
    parchment_dense_directory: {
      delf_b2_writing: 'DELF B2写作资料大全',
      tef_tcf_canada: 'TEF/TCF备考资料大全',
    },
    white_green_directory: {
      delf_b2_writing: '法语B2写作必背清单',
      tef_tcf_canada: 'TEF/TCF必背清单',
    },
    clean_purple_directory: {
      delf_b2_writing: '法语B2写作语法体系',
      tef_tcf_canada: 'TEF/TCF语法资料',
    },
    grid_purple_directory: {
      delf_b2_writing: 'DELF B2写作知识体系',
      tef_tcf_canada: 'TEF/TCF备考知识体系',
    },
    document_analysis: {
      delf_b2_writing: 'DELF B2写作素材解析',
      tef_tcf_canada: 'TEF/TCF素材解析',
    },
    vocab_table: {
      delf_b2_writing: 'DELF B2主题词汇大全',
      tef_tcf_canada: 'TEF/TCF主题词汇大全',
    },
    course_roadmap: {
      delf_b2_writing: 'DELF B2写作7天急救',
      tef_tcf_canada: '3个月冲CLB7路径',
    },
    notebook_big_words: {
      delf_b2_writing: '法语B2写作别瞎练',
      tef_tcf_canada: 'TEF/TCF别再乱刷',
    },
    plain_experience: {
      delf_b2_writing: 'DELF B2写作复盘',
      tef_tcf_canada: 'TEF/TCF备考复盘',
    },
  };
  const exactFallback = rendererFallbacks[renderer]?.[productId];
  if (exactFallback) return exactFallback;
  if (renderer === 'memo_offer') {
    return productId === 'delf_b2_writing'
      ? 'DELF B2格式分老丢的人先看'
      : 'TEF/TCF备考正在被资料拖慢';
  }
  return getProductCoverFallbackTitle(productId, family);
}

function sanitizeCoverNote(value: string) {
  if (/将.{0,12}改为|修正原因|强制要求|原文有误|审校/.test(value)) return undefined;
  return scrubCheapClaims(value);
}

function canonicalSemanticText(value: string) {
  return value
    .replace(/（建议）|\(建议\)/g, '')
    .replace(/[\s，,。；;：:！？!?()（）]/g, '')
    .toLowerCase();
}

function getCoreIssues(
  titles: TitleCandidate[],
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
  renderer: ProductCard['renderer_id'],
  evidence: ComposeDraftInput['evidence'],
  productId: ProductId,
) {
  const issues: string[] = [];
  const spec = getCoverTemplateSpec(renderer);
  const itemCount = cover.sections.reduce((sum, section) => sum + section.items.length, 0);
  if (titles.length < 3) issues.push('title_candidate_mix_incomplete');
  if (!titles.some(item => item.formula_id === 'free_original')) issues.push('free_original_title_missing');
  if (!titles.some(item => item.formula_id === 'reference_migration')) issues.push('reference_migration_title_missing');
  if (!titles.some(item => item.formula_id !== 'free_original' && item.formula_id !== 'reference_migration')) issues.push('formula_title_missing');
  const flexibleCapacity = spec && ['directory', 'document', 'offer', 'experience', 'pain', 'roadmap', 'phrase', 'table', 'book'].includes(spec.family);
  const lowDensityStoryCover = spec && ['experience', 'pain'].includes(spec.family);
  const sectionCountInvalid = !spec || (flexibleCapacity
    ? cover.sections.length < (lowDensityStoryCover ? 1 : Math.max(2, spec.sectionCount - 1)) || cover.sections.length > spec.sectionCount + 1
    : cover.sections.length !== spec.sectionCount);
  if (sectionCountInvalid) issues.push('cover_section_count_invalid');
  const capacityInvalid = !spec || cover.sections.some(section => flexibleCapacity
    ? section.items.length < Math.max(1, spec.itemsPerSection - 2) || section.items.length > spec.itemsPerSection + 2
    : section.items.length !== spec.itemsPerSection);
  if (capacityInvalid) issues.push('cover_section_capacity_invalid');
  const duplicateItemCount = cover.sections.reduce((sum, section) => {
    const keys = section.items.map(item => canonicalSemanticText(item.primary));
    return sum + (keys.length - new Set(keys).size);
  }, 0);
  if (duplicateItemCount >= Math.max(3, Math.ceil(itemCount * 0.15))) issues.push('cover_items_semantic_duplicate');
  if (!spec || itemCount < spec.minTotalItems) issues.push('cover_density_too_low');
  // 图生图模板：字长由图模型在 prompt 里自行缩字/折行（见 reference-image-prompt.ts），
  // 代码层不再做硬限，避免 LLM 偶尔超长就被整条 job 干掉。
  // 代码/混合模板：CSS clamp + line-clamp 兜底，但仍校验避免 LLM 写成段落。
  if (spec && spec.renderMode !== 'image_to_image' && cover.sections.some(section => section.items.some(item => visualLength(item.primary) > spec.maxPrimaryVisualLength || visualLength(item.secondary || '') > spec.maxSecondaryVisualLength))) issues.push('cover_item_too_long');
  if (cover.title.length < 8 || cover.title.length > 18) issues.push('cover_title_length_invalid');
  if (cover.subtitle && (cover.subtitle.length < 8 || cover.subtitle.length > 24)) issues.push('cover_subtitle_length_invalid');
  if (
    hasCoverCountMismatch(cover.title, itemCount, cover.sections.length)
    || hasCoverCountMismatch(cover.subtitle || '', itemCount, cover.sections.length)
  ) {
    issues.push('cover_count_mismatch');
  }
  const publicText = `${titles.map(item => item.title).join(' ')} ${cover.title} ${cover.sections.map(section => `${section.heading} ${section.items.map(item => `${item.primary} ${item.secondary || ''}`).join(' ')}`).join(' ')}`;
  if (!hasRequiredProductIdentity(productId, cover.title) || hasForbiddenProductIdentity(productId, publicText)) {
    issues.push('product_identity_mismatch');
  }
  issues.push(...getPublicEditorialRiskIssues(publicText));
  if (/(?:\bEt\b|\bMais\b|Parce que|Je pense que|\bOn peut\b|Beaucoup de|Des gens)[^。；\n]{0,18}(?:口语|非正式|错误)/i.test(publicText)) {
    issues.push('neutral_french_misclassified_as_oral');
  }
  if (/Cordialement[^。；\n]{0,18}(?:最低标准|一律|所有|任何)/i.test(publicText)) {
    issues.push('overabsolute_register_rule');
  }
  if (/短信|简讯/.test(publicText) && /DELF B2|法语B2/i.test(publicText)) issues.push('off_scope_writing_task');
  if (/官方授权|内部押题|内部资料|100\s*%|百分百|考官追着给分|保证(?:提分|通过|稳过)/.test(publicText)) issues.push('cheap_or_unsupported_claim');
  if (/(商品|资料)(里|中|内).{0,10}(有|没有|包含|不含|收录|未收录)/.test(publicText)) issues.push('public_inventory_relation_claim');
  const allowedSourceIds = collectEvidenceSourceIds(evidence);
  const sourceMismatch = cover.sections.some(section => {
    if (section.source_type === 'ai_original') return section.source_ids.length > 0;
    if (section.source_type === 'knowledge_base' || section.source_type === 'ai_derived') {
      return section.source_ids.length === 0 || section.source_ids.some(id => !allowedSourceIds.has(id));
    }
    return section.source_ids.some(id => !allowedSourceIds.has(id));
  });
  if (sourceMismatch) issues.push('cover_source_evidence_mismatch');
  if (/每段.{0,8}必须.{0,8}空行|Cordialement.{0,8}(错误|禁用)|每个论点.{0,10}必须.{0,10}(数据|例子)/i.test(publicText)) issues.push('overabsolute_exam_rule');
  if (/至少\s*\d+\s*个.{0,8}(B2.{0,4}词|词汇|虚拟式|连接词)|每段.{0,8}(必须|至少).{0,8}(连接词|例子|数据)/i.test(publicText)) issues.push('invented_quantity_rule');
  if (/\b(?:vocabulaire\s*B2|concordance|accords?)\b(?![^。；，\n]{0,12}(?:词汇|时态|一致|配合|阴阳性|单复数))/i.test(publicText)) issues.push('unexplained_french_shorthand');
  if (spec?.family === 'phrase' && cover.sections.some(section => section.items.some(item => !/[A-Za-zÀ-ÿ]/.test(item.primary) || !item.secondary))) issues.push('french_chinese_pair_required');
  if (spec?.family === 'flashcard' && cover.sections.some(section => section.items.some(item => !/[A-Za-zÀ-ÿ]/.test(item.primary) || !item.secondary || !item.note))) issues.push('flashcard_fields_incomplete');
  if (spec?.family === 'document' && cover.sections.flatMap(section => section.items)
    .filter(item => /[A-Za-zÀ-ÿ]{8,}/.test(`${item.primary} ${item.secondary || ''} ${item.note || ''}`)).length < 2) issues.push('document_examples_missing');
  if ((spec?.family === 'offer' || spec?.family === 'roadmap') && /一对一|直播课|老师批改|无限答疑|陪学|督学|课时|学习权利/.test(publicText)) issues.push('unsupported_service_claim');
  if ((spec?.family === 'experience' || spec?.family === 'pain') && /我.{0,12}(上岸|通过|考到|拿到|亲测|亲身|用了\d+|学了\d+)/.test(publicText)) issues.push('fabricated_first_person_experience');
  if (spec?.family === 'document' && /官方真题|历年真题|原题|真题原文/.test(publicText)) issues.push('unverified_exam_source');
  return issues;
}

function isBlockingCoreIssue(issue: string) {
  return classifyCoreIssue(issue) === 'block';
}

function classifyCoreIssue(issue: string): 'block' | 'autofix' | 'warn' {
  const warnIssues = new Set([
    'public_inventory_relation_claim',
    'unsupported_score_or_time_claim',
    'unsupported_outcome_claim',
    'overmechanical_content_method',
    'free_original_title_missing',
    'reference_migration_title_missing',
    'formula_title_missing',
    'title_candidate_mix_incomplete',
    'cover_items_semantic_duplicate',
    // Symmetric with classifyEditorialIssue: time-budget claims surface in
    // both cover and body text. Treating them as block on core only makes
    // generation flaky on product 2 (TEF/TCF has real per-section time
    // budgets the LLM legitimately surfaces) while editorial treats them
    // as warn. Keep the check firing so it is visible, but do not block.
    'unsupported_fixed_time_advice',
    'unsupported_exam_official_rule',
  ]);
  const autofixIssues = new Set([
    'neutral_french_misclassified_as_oral',
    'unsafe_mechanical_language_replacement',
    'overabsolute_register_rule',
    'overabsolute_public_rule',
  ]);
  if (warnIssues.has(issue)) return 'warn';
  if (autofixIssues.has(issue)) return 'autofix';
  return 'block';
}

function getEditorialIssues(
  pages: GeneratedInnerPage[],
  caption: string,
  seoKeywords: string[],
  evidence: ComposeDraftInput['evidence'],
  productId: ProductId,
) {
  const issues: string[] = [];
  if (pages.length < 4 || pages.length > 6) issues.push('inner_page_count_invalid');
  if (pages.some(page => page.page_title.length < 8 || page.page_title.length > 24)) issues.push('inner_page_title_invalid');
  if (pages.some(page => page.bullets.length < 3)) issues.push('inner_page_content_too_thin');
  if (caption.length < 260 || caption.length > 440) issues.push('caption_length_invalid');
  if (seoKeywords[0] && !caption.slice(0, 100).includes(seoKeywords[0])) issues.push('core_keyword_missing_from_opening');
  const editorialText = `${caption} ${pages.map(page => `${page.page_title} ${page.lead} ${page.bullets.join(' ')}`).join(' ')}`;
  if (hasForbiddenProductIdentity(productId, editorialText)) issues.push('product_identity_mismatch');
  if (/万能|必背|捷径|阅卷老师|考官|白考|保分|必过|包过|★/.test(editorialText)) issues.push('editorial_low_quality_phrase');
  issues.push(...getPublicEditorialRiskIssues(editorialText, caption));
  if (/(?:\bEt\b|\bMais\b|Parce que|Je pense que|\bOn peut\b|Beaucoup de|Des gens)[^。；\n]{0,24}(?:口语|非正式|错误)/i.test(editorialText)) {
    issues.push('neutral_french_misclassified_as_oral');
  }
  if (/Cordialement[^。；\n]{0,24}(?:最低标准|一律|所有|任何)/i.test(editorialText)) {
    issues.push('overabsolute_register_rule');
  }
  if (hasUnsupportedProductNumberClaim(editorialText, evidence.map(item => `${item.text} ${item.evidence} ${item.source_section} ${item.source_excerpt || ''}`))) {
    issues.push('unsupported_product_quantity_claim');
  }
  const allowedSourceIds = collectEvidenceSourceIds(evidence);
  if (pages.some(page => page.source_ids.some(id => !allowedSourceIds.has(id)))) issues.push('inner_page_source_evidence_mismatch');
  return issues;
}

function isBlockingEditorialIssue(issue: string) {
  return classifyEditorialIssue(issue) === 'block';
}

function classifyEditorialIssue(issue: string): 'block' | 'autofix' | 'warn' {
  const warnIssues = new Set([
    // 运营/SEO/带货强度问题：应该提示或自动补，不应该中断生成。
    'core_keyword_missing_from_opening',
    'caption_ai_cliche',
    'unsupported_score_or_time_claim',
    'unsupported_product_quantity_claim',
    'overabsolute_public_rule',
    'unsupported_fixed_time_advice',
    'unsupported_exam_official_rule',
    'overmechanical_content_method',
    'public_inventory_relation_claim',
    'editorial_low_quality_phrase',
  ]);
  const autofixIssues = new Set([
    // 可由前后处理确定性清洗的语言风格问题。
    'neutral_french_misclassified_as_oral',
    'unsafe_mechanical_language_replacement',
    'overabsolute_register_rule',
  ]);
  if (warnIssues.has(issue)) return 'warn';
  if (autofixIssues.has(issue)) return 'autofix';
  return 'block';
}

function collectEvidenceSourceIds(evidence: ComposeDraftInput['evidence']) {
  const ids = new Set<string>();
  for (const item of evidence) {
    ids.add(item.id);
    const sourceText = `${item.text} ${item.evidence} ${item.source_section} ${item.source_excerpt || ''}`;
    for (const match of sourceText.matchAll(/\b[A-Z]{1,3}-\d{3}\b/g)) ids.add(match[0]);
  }
  return ids;
}

function buildSeoKeywords(productId: ProductId, topic: MigratedTopic) {
  const base = productId === 'delf_b2_writing'
    ? ['DELF B2写作', '法语写作', 'DELF B2备考']
    : ['TEF TCF Canada', '法语备考', '加拿大法语考试'];
  const topicWords = topic.search_terms.filter(item => item.length >= 2 && item.length <= 12).slice(0, 3);
  return Array.from(new Set([...base, ...topicWords])).slice(0, 6);
}

function getExamFactRules(productId: ProductId) {
  if (productId === 'delf_b2_writing') {
    return '权威考试规则优先：DELF B2写作要求至少250词，不得写230-280词；官方没有规定必须几个论据、B2词、主题词、虚拟式、条件式、关系从句或每段一个连接词。on、à mon avis等表达不能脱离语境一律禁用。';
  }
  return '考试规则只能使用当前商品的已验证证据；不得把学习建议改写成官方数量要求、固定句法配额、固定提分或扣分承诺。';
}

function isSameQuotedCorrection(problem: string) {
  if (!/拼写错误|应为|改为/.test(problem)) return false;
  const quoted = [...problem.matchAll(/[“"]([^”"]+)[”"]/g)].map(match => match[1].trim().toLowerCase());
  return quoted.length >= 2 && quoted[0] === quoted[1];
}

function normalizeTags(value: unknown, seoKeywords: string[], productId?: ProductId, contentContext = '') {
  const raw = Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
  const fallbacks = seoKeywords.slice(0, 5);
  // 单字高频词（#模板 #范文）作为标签无意义，必须组合成带商品身份的复合标签。
  // 这一步只在 LLM 没给够 tag、走 fallback 时才生效；LLM 自己写的复合标签
  // （例如「#DELFB2写作模板」）原样保留。
  const identity = productId ? getProductPromptProfile(productId).tagIdentity : 'DELFB2';
  const compoundFromValidated = productId
    ? getTitleReferenceKeywords(productId)
        .slice(0, 3)
        .map(word => `${identity}${word}`)
    : [];
  const normalized = [...raw, ...fallbacks, ...compoundFromValidated]
    .map(tag => tag
      .replace(/高分范文/g, '范文拆解')
      .replace(/高分/g, '')
      .replace(/精准提分/g, '写作复盘')
      .replace(/任务完成扣分/g, '任务完成自查')
      .replace(/语体扣分/g, '语体自查')
      .replace(/隐形扣分点/g, '易错点')
      .replace(/扣分点/g, '易错点')
      .replace(/扣分/g, '易错点'))
    .map(tag => `#${tag.replace(/^#+/, '').replace(/\s+/g, '')}`)
    .filter(tag => !/^#(AU|CH|FW|GD|JF|CL|ER|CB)-\w*/i.test(tag) && tag.length >= 3 && tag.length <= 18)
    // 过滤跨商品身份：商品 2 的标签里不得出现 DELF/DALF/B2写作；商品 1 不得出现 TEF/TCF/CLB。
    .filter(tag => !productId || !hasForbiddenProductIdentity(productId, tag.replace(/^#/, '')))
    // 过滤掉无主单词标签：#模板 #范文 #技巧 这种脱离商品身份的高频词作为
    // 标签只会被淹没在小红书同类垃圾池里，反而拖低笔记的相关性信号。
    .filter(tag => !productId || !/^#(模板|范文|主题|技巧|格式|评分标准|真题|写作任务|句型|连接词|表达|段落|结构|开头|结尾)$/.test(tag));
  return Array.from(new Set(normalized))
    .filter(tag => !tag.includes('范文') || /范文|完整文章|全文示例/.test(contentContext))
    .filter(tag => !tag.includes('模板') || /模板|框架/.test(contentContext))
    .slice(0, 8);
}

function visualLength(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
}

function clipVisual(value: string, max: number) {
  const chars = Array.from(value);
  let result = '';
  let length = 0;
  let cutIndex = chars.length;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    const nextLength = length + (/[^\x00-\xff]/.test(char) ? 2 : 1);
    if (nextLength > max) { cutIndex = i; break; }
    result += char;
    length = nextLength;
  }
  const wasTruncated = cutIndex < chars.length;
  if (wasTruncated) {
    const stripInlineExample = (text: string) => {
      const exampleIndex = Math.max(text.lastIndexOf('例如'), text.lastIndexOf('比如'), text.lastIndexOf('如'));
      return exampleIndex >= Math.floor(text.length * 0.45) ? text.slice(0, exampleIndex) : text;
    };
    // A cut is only safe if it doesn't split a Latin word in half. Check the
    // actual boundary character (not just a length-ratio heuristic), so a
    // long trailing word (e.g. "distinguées") never survives as a mangled
    // fragment like "disti" - back off to the last space/punctuation instead.
    const cutsMidLatinWord = /[A-Za-zÀ-ÿ]$/.test(result) && /[A-Za-zÀ-ÿ]/.test(chars[cutIndex] || '');
    const boundary = Math.max(result.lastIndexOf(' '), result.lastIndexOf('，'), result.lastIndexOf('；'), result.lastIndexOf('、'));
    result = stripInlineExample(result);
    if (cutsMidLatinWord) {
      result = boundary >= 0 ? result.slice(0, boundary) : '';
    } else if (boundary >= Math.floor(result.length * 0.55)) {
      result = result.slice(0, boundary);
    }
  }
  result = result.trim();
  if (wasTruncated && result && !/[…。！？.!?,，:：]$/.test(result) && /[A-Za-zÀ-ÿ]$/.test(result)) {
    result += '...';
  }
  return result;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTitleCandidateType(value: string): TitleCandidateType | undefined {
  if (/资料|清单|大全|模板|范文|合集|速查/.test(value)) return '资料型';
  if (/解释|为什么|区别|怎么用|怎么查|怎么看|原理|到底/.test(value)) return '解释型';
  if (/痛点|恐惧|损失|避坑|错误|卡住|白费|不会|不懂/.test(value)) return '痛点型';
  if (/救命|别再|先停|崩溃|焦虑|急|乱|心里没底/.test(value)) return '情绪型';
  if (/结果|提分|拿下|冲|更像|说长|高分|稳|7天|3个月/.test(value)) return '结果型';
  if (/强钩子|反常识|认知冲突|好奇|悬念/.test(value)) return '强钩子型';
  return undefined;
}

function sanitizeTitleLikeText(value: string) {
  return value
    .replace(/\b[A-Z]{1,3}-\d{3}\b/g, '')
    .replace(/官方授权|内部押题|内部资料/g, '')
    .replace(/考官追着给分/g, '考官想看的表达')
    .replace(/[“”"]/g, '')
    .replace(/[，、。；]{2,}/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function compactTitleForLimit(value: string, productId?: ProductId) {
  let title = sanitizeTitleLikeText(value);
  if (Array.from(title).length <= 20) return title;
  const replacements: [RegExp, string][] = productId === 'delf_b2_writing'
    ? [[/DELF\s*B2写作/gi, 'B2写作'], [/DELF\s*B2作文/gi, 'B2作文'], [/法语\s*B2写作/gi, 'B2写作'], [/法语\s*B2作文/gi, 'B2作文']]
    : productId === 'tef_tcf_canada'
      ? [[/TEF\s*\/\s*TCF写作/gi, 'TEF写作'], [/TEF\s*\/\s*TCF口语/gi, 'TEF口语'], [/TEF\s*\/\s*TCF听力/gi, 'TCF听力'], [/TEF\s*\/\s*TCF备考/gi, 'TEF法语备考']]
      : [];
  const common: [RegExp, string][] = [[/为什么/g, '为何'], [/不要再/g, '别再'], [/一开始/g, '开局'], [/每次练/g, '练'], [/都要/g, '总要'], [/常见的/g, '常见'], [/真正的/g, '真正'], [/一次性/g, '一次']];
  for (const [pattern, replacement] of [...replacements, ...common]) {
    if (Array.from(title).length <= 20) break;
    title = title.replace(pattern, replacement);
  }
  if (Array.from(title).length > 20 && productId === 'delf_b2_writing' && /DELF\s*B2/i.test(title)) {
    const rest = title.replace(/DELF\s*B2/ig, '');
    title = title.replace(/DELF\s*B2/ig, /\u5199\u4f5c|\u4f5c\u6587/.test(rest) ? 'B2' : 'B2\u5199\u4f5c');
  }
  if (Array.from(title).length > 20 && productId === 'tef_tcf_canada' && /TEF\s*\/\s*TCF/i.test(title)) {
    title = title.replace(/TEF\s*\/\s*TCF/ig, 'TEF');
  }
  return sanitizeTitleLikeText(title);
}

function clip(value: string, max: number) {
  if (value.length <= max) return value;
  let result = value.slice(0, max);
  const cutsMidLatinWord = /[A-Za-zÀ-ÿ]$/.test(result) && /[A-Za-zÀ-ÿ]/.test(value[max] || '');
  if (cutsMidLatinWord) {
    const boundary = Math.max(result.lastIndexOf(' '), result.lastIndexOf('，'), result.lastIndexOf('、'), result.lastIndexOf('；'), result.lastIndexOf('。'));
    // A mid-word cut is never acceptable - always back off to the last safe
    // boundary rather than only doing so when it happens to be far enough in.
    if (boundary >= 0) result = result.slice(0, boundary);
  }
  return result.trim();
}

function sanitizePublicText(value: string) {
  return value
    .replace(/立刻变得/g, '会更')
    .replace(/立刻升级/g, '更稳')
    .replace(/精准提分/g, '找到改进方向')
    .replace(/提分方向/g, '改进方向')
    .replace(/分数卡在\s*\d+\s*分左右/g, '写作一直卡住')
    .replace(/(?:我|我的)整理方法/g, '可以这样整理')
    .replace(/我的整理/g, '这种整理')
    .replace(/我后来发现/g, '后来会发现')
    .replace(/让我考前[^，。；\n]{0,24}/g, '考前复盘时')
    .replace(/高分模板/g, '常用写作框架')
    .replace(/高分范文/g, '范文拆解')
    .replace(/直接调用/g, '按语境调用')
    .replace(/直接调取/g, '按题目调取')
    .replace(/调用功能块/g, '按题目选表达模块')
    .replace(/替换主题词就能/g, '重写语境后再')
    .replace(/替换主题词[，,]\s*就能/g, '重写主题词后，再')
    .replace(/换主题词就能/g, '换主题时要重写语境')
    .replace(/只替换主题词和例子/g, '围绕新题重写主题词和例子')
    .replace(/只替换主题词/g, '围绕新题重写主题词')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/\d+\s*篇范文/g, '范文库')
    .replace(/\d+\s*类识别表/g, '任务识别清单')
    .replace(/\d+\s*秒判对文体/g, '先判对文体')
    .replace(/效率翻倍/g, '更省力')
    .replace(/格式分/g, '格式问题')
    .replace(/练习中常见的过这种情况/g, '练习中常见这种情况')
    .replace(/练习中常见的存了大量/g, '不少人存了大量')
    .replace(/练习中常见的下载了/g, '不少人下载了')
    .replace(/练习中常见的过这样的困境/g, '很多人会遇到这样的困境')
    .replace(/问题不能只看资料不够，更要看没有拆解结构。/g, '资料再多，如果不拆结构，换题还是会卡住。')
    .replace(/其实问题不在资料少，而是没有按题型和功能分类。/g, '资料少不一定是关键，更常见的是没有按题型和功能分类。')
    .replace(/其实问题不在([^，。；\n]{1,40})，而是([^。；\n]{1,50})。/g, '真正卡住的往往不是$1，而是$2。')
    .replace(/问题不在([^，。；\n]{1,40})，而在于([^。；\n]{1,50})。/g, '$1之外，更要先解决$2。')
    .replace(/问题不能只看([^，。；\n]{1,40})，更要看([^。；\n]{1,50})。/g, '$1之外，更要先看$2。')
    .replace(/高效整理/g, '更稳的整理')
    .replace(/快速调用/g, '更容易调用')
    .replace(/考场上才能/g, '写作时才更容易')
    .replace(/直接定位到对应文件夹/g, '先定位到对应文件夹')
    .replace(/就能快速完成仿写/g, '再完成一版仿写')
    .replace(/搭配组合示例，可以帮你/g, '搭配组合示例，用来帮你')
    .replace(/有没有遗漏让步段或结论/g, '观点是否有必要的限定和结论')
    .replace(/正式信避免缩写（如“c'est”改为“cela est”）/g, '正式信里少用聊天式缩写，语气保持完整')
    .replace(/30秒避坑清单/g, '写前避坑清单')
    .replace(/秒判/g, '快速判断')
    .replace(/严重影响得分/g, '明显影响表达')
    .replace(/导致低分/g, '让表达不稳')
    .replace(/不好，，/g, '不好，')
    .replace(/用\d+\s*篇范文里/g, '用范文库里')
    .replace(/\d+\s*篇范文里/g, '范文库里')
    .replace(/必须/g, '建议')
    .replace(/一律/g, '通常')
    .replace(/千篇通常/g, '千篇一律')
    .replace(/评分标准听了也点头/g, '表达更容易被听懂')
    .replace(/严禁/g, '不建议')
    .replace(/直接套用/g, '参考后按题目改写')
    .replace(/换词就能迁移/g, '换主题时要重写语境')
    .replace(/主题词一换/g, '换主题时重写例句')
    .replace(/对照DELF B2写作备考资料中的检查清单/g, '对照一份DELF B2写作检查清单')
    .replace(/DELF B2备考资料里除了/g, '系统备考时，除了')
    .replace(/DELF B2写作备考资料里除了/g, '系统备考时，除了')
    .replace(/结合DELF B2写作备考资料/g, '做系统备考时')
    .replace(/DELF B2写作备考资料中的/g, 'DELF B2写作')
    .replace(/资料中的/g, '')
    .replace(/资料里的/g, '')
    .replace(/资料里/g, '')
    .replace(/避免泛指\s*on/gi, '谨慎使用泛指 on')
    .replace(/Pas de ['’]on['’]/gi, 'on 按语境使用')
    .replace(/官方评分表通常列出4项，但语体（Registre）隐含在词汇与连贯中，单独检查更有效。/g, '这套自查按5个维度看：任务完成、连贯、词汇、语法和语体。')
    .replace(/练习中常见的写完作文后/g, '很多人写完作文后')
    .replace(/代词所指不超过前两句/g, '代词所指要清楚')
    .replace(/前两句内必须有先行词/g, '前文要有明确先行词')
    .replace(/前两句内明确出现/g, '前文有明确先行词')
    .replace(/我的资料|我们的资料/g, '这类备考材料')
    .replace(/(?:至少|≥)\s*\d+\s*种?\s*(?:不同的)?连接词/g, '连接词按逻辑使用')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*B2(?:级)?表达/g, '使用准确的B2表达')
    .replace(/(?:至少|≥)\s*\d+\s*种?\s*时态/g, '时态主线清楚')
    .replace(/不要用\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24})\s*(?:代替|替换|换成)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24})/gi, '$1与$2语义不同，要按语境选择')
    .replace(/用\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24})\s*(?:代替|替换|换成)\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24})/gi, '比较$1与$2的语义和适用场景')
    .replace(/把\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24})\s*换成\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24})/gi, '比较$1与$2的语义和适用场景')
    .replace(/\bjoindre\s+un\s+examen\b/gi, 'passer un examen')
    .replace(/\bjoindre\s+l['’]examen\b/gi, "passer l'examen")
    .replace(/很多[^，。；\n]{0,24}(?:同学|考生)(?:都会?|常常?|往往)?(?:遇到|发现)?(?:一个)?/g, '练习中常见的')
    .replace(/其实[，,]\s*/g, '')
    .replace(/问题(?:就)?出在/g, '常见原因是')
    .replace(/问题的关键(?:是|在于)?/g, '更需要注意的是')
    .replace(/不是([^。；\n]{1,70})[，,]?而是/g, '别只看$1，更要看')
    .replace(/不在于([^。；\n]{1,70})[，,]?而在于/g, '不能只看$1，更要看')
    .replace(/考官追着给分/g, 'B2高阶表达')
    .replace(/考官最想要/g, '评分标准看重')
    .replace(/考官/g, '评分标准')
    .replace(/立刻升级/g, '更稳')
    .replace(/精准提分/g, '找到改进方向')
    .replace(/提分方向/g, '改进方向')
    .replace(/分数卡在\s*\d+\s*分左右/g, '写作一直卡住')
    .replace(/(?:我|我的)整理方法/g, '可以这样整理')
    .replace(/我的整理/g, '这种整理')
    .replace(/我后来发现/g, '后来会发现')
    .replace(/让我考前[^，。；\n]{0,24}/g, '考前复盘时')
    .replace(/考场不超时/g, '考场更不慌')
    .replace(/练了好几篇还是B1/g, '练了好几篇还是像B1')
    .replace(/直接降分/g, '影响整体表达')
    .replace(/直接扣掉\s*\d+(?:\s*[-~至]\s*\d+)?\s*分/g, '影响格式表现')
    .replace(/扣结构分/g, '结构会显得不稳')
    .replace(/任务完成度打折扣/g, '任务完成度不够完整')
    .replace(/正式信全程用\s*vous/gi, '正式信通常用 vous')
    .replace(/动笔前花\s*\d+\s*分钟/g, '动笔前先')
    .replace(/\d+\s*天复习路径/g, '阶段复习路径')
    .replace(/高分模板/g, '常用写作框架')
    .replace(/高分范文/g, '范文拆解')
    .replace(/直接调用/g, '按语境调用')
    .replace(/直接调取/g, '按题目调取')
    .replace(/调用功能块/g, '按题目选表达模块')
    .replace(/替换主题词就能/g, '重写语境后再')
    .replace(/替换主题词[，,]\s*就能/g, '重写主题词后，再')
    .replace(/换主题词就能/g, '换主题时要重写语境')
    .replace(/只替换主题词和例子/g, '围绕新题重写主题词和例子')
    .replace(/只替换主题词/g, '围绕新题重写主题词')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/\d+\s*篇范文/g, '范文库')
    .replace(/\d+\s*类识别表/g, '任务识别清单')
    .replace(/\d+\s*秒判对文体/g, '先判对文体')
    .replace(/效率翻倍/g, '更省力')
    .replace(/格式分/g, '格式问题')
    .replace(/练习中常见的过这种情况/g, '练习中常见这种情况')
    .replace(/练习中常见的存了大量/g, '不少人存了大量')
    .replace(/练习中常见的下载了/g, '不少人下载了')
    .replace(/练习中常见的过这样的困境/g, '很多人会遇到这样的困境')
    .replace(/问题不能只看资料不够，更要看没有拆解结构。/g, '资料再多，如果不拆结构，换题还是会卡住。')
    .replace(/其实问题不在资料少，而是没有按题型和功能分类。/g, '资料少不一定是关键，更常见的是没有按题型和功能分类。')
    .replace(/其实问题不在([^，。；\n]{1,40})，而是([^。；\n]{1,50})。/g, '真正卡住的往往不是$1，而是$2。')
    .replace(/问题不在([^，。；\n]{1,40})，而在于([^。；\n]{1,50})。/g, '$1之外，更要先解决$2。')
    .replace(/问题不能只看([^，。；\n]{1,40})，更要看([^。；\n]{1,50})。/g, '$1之外，更要先看$2。')
    .replace(/高效整理/g, '更稳的整理')
    .replace(/快速调用/g, '更容易调用')
    .replace(/考场上才能/g, '写作时才更容易')
    .replace(/直接定位到对应文件夹/g, '先定位到对应文件夹')
    .replace(/就能快速完成仿写/g, '再完成一版仿写')
    .replace(/搭配组合示例，可以帮你/g, '搭配组合示例，用来帮你')
    .replace(/有没有遗漏让步段或结论/g, '观点是否有必要的限定和结论')
    .replace(/正式信避免缩写（如“c'est”改为“cela est”）/g, '正式信里少用聊天式缩写，语气保持完整')
    .replace(/30秒避坑清单/g, '写前避坑清单')
    .replace(/秒判/g, '快速判断')
    .replace(/严重影响得分/g, '明显影响表达')
    .replace(/导致低分/g, '让表达不稳')
    .replace(/不好，，/g, '不好，')
    .replace(/用\d+\s*篇范文里/g, '用范文库里')
    .replace(/\d+\s*篇范文里/g, '范文库里')
    .replace(/必须/g, '建议')
    .replace(/一律/g, '通常')
    .replace(/千篇通常/g, '千篇一律')
    .replace(/评分标准听了也点头/g, '表达更容易被听懂')
    .replace(/严禁/g, '不建议')
    .replace(/直接套用/g, '参考后按题目改写')
    .replace(/换词就能迁移/g, '换主题时要重写语境')
    .replace(/主题词一换/g, '换主题时重写例句')
    .replace(/对照DELF B2写作备考资料中的检查清单/g, '对照一份DELF B2写作检查清单')
    .replace(/DELF B2备考资料里除了/g, '系统备考时，除了')
    .replace(/DELF B2写作备考资料里除了/g, '系统备考时，除了')
    .replace(/结合DELF B2写作备考资料/g, '做系统备考时')
    .replace(/DELF B2写作备考资料中的/g, 'DELF B2写作')
    .replace(/资料中的/g, '')
    .replace(/资料里的/g, '')
    .replace(/资料里/g, '')
    .replace(/避免泛指\s*on/gi, '谨慎使用泛指 on')
    .replace(/Pas de ['’]on['’]/gi, 'on 按语境使用')
    .replace(/官方评分表通常列出4项，但语体（Registre）隐含在词汇与连贯中，单独检查更有效。/g, '这套自查按5个维度看：任务完成、连贯、词汇、语法和语体。')
    .replace(/我的资料|我们的资料/g, '这类备考材料')
    .replace(/(?:至少|≥)\s*\d+\s*种?\s*(?:不同的)?连接词/g, '连接词按逻辑使用')
    .replace(/(?:至少|≥)\s*\d+\s*个?\s*B2(?:级)?表达/g, '使用准确的B2表达')
    .replace(/(?:至少|≥)\s*\d+\s*种?\s*时态/g, '时态主线清楚')
    .replace(/万能/g, '常用')
    .replace(/必背/g, '常用')
    .replace(/阅卷老师(?:最)?看重/g, 'B2写作常用')
    .replace(/\d+\s*%\s*(?:的)?(?:考生|人|同学)?(?:都)?(?:不知道|会用|常用)/g, '很多人容易忽略')
    .replace(/百分之[一二三四五六七八九十百零]+(?:的)?(?:考生|人|同学)?(?:都)?(?:不知道|会用|常用)/g, '很多人容易忽略')
    .replace(/★+/g, '')
    .replace(/白考/g, '复习白费')
    .replace(/保分/g, '稳住基础')
    .replace(/必过|包过/g, '考前实用')
    .replace(/扣\s*\d+\s*分/g, '容易丢分')
    .replace(/(?:被)?默默扣分/g, '影响整体表现')
    .replace(/扣分扣在哪/g, '问题在哪')
    .replace(/(?:被)?扣在哪里/g, '问题出在哪里')
    .replace(/(?:被)?扣在/g, '问题在')
    .replace(/选错就扣分/g, '选错容易错配')
    .replace(/致命扣分/g, '明显影响表达')
    .replace(/扣分重灾区/g, '容易出问题的地方')
    .replace(/隐形扣分点/g, '容易忽略的问题')
    .replace(/扣分点/g, '易错点')
    .replace(/扣分/g, '影响表达')
    .replace(/DALF\s*B2/gi, 'DELF B2')
    .replace(/([。！？])\1+/g, '$1')
    .replace(/[，,]{2,}/g, '，')
    .replace(/[（(][^）)]*(?:AU|CH|FW|GD|JF|CL|ER|CB)-\d+[^）)]*[）)]/gi, '')
    .replace(/\b(?:AU|CH|FW|GD|JF|CL|ER|CB)-\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
