import { callOpenAICompatibleJson, recordAutofixEvents } from '@/lib/ai-client';
import { getCompetitorCreativeCard } from '@/lib/creative-card-library';
import { getRoutedTitleFormulas } from '@/lib/full-title-formula-catalog';
import { AI_CLICHE_PATTERN, getPublicEditorialRiskIssues, hasUnsupportedProductNumberClaim, normalizeTitleIdentity } from '@/lib/editorial-quality';
import { collectFrenchCheckTargets, findSuspiciousFrenchTokens } from '@/lib/french-spellcheck';
import { getCoverTemplatePrompt, getCoverTemplateSpec, isCoverTitleLengthOk, coverTitleMaxlength, parseContentPromiseCount, type CoverTemplateSpec } from '@/lib/cover-template-specs';
import { retrieveProductFacts } from '@/lib/product-fact-retrieval';
import {
  getProductCoverFallbackTitle,
  getProductPromptProfile,
  hasForbiddenProductIdentity,
  hasRequiredProductIdentity,
  isProductPublicTextSafe,
  stripForbiddenIdentity,
} from '@/lib/product-prompt-profiles';
import { normalizeDenseDirectoryCover, validateReferenceDraft } from '@/lib/reference-workflow-validation';
import { getAvoidedLowTrafficKeywords, getTitleReferenceKeywords, getXhsSearchKeywords } from '@/lib/xhs-search-keywords';
import { pickFormulasForTriggerTypes, type TitleFormula } from '@/lib/title-formulas';
import { getSeedTopicKeywords, isTitleAnchoredToSeed, countSeedTopicHits } from '@/lib/seed-topic-anchor';
import { fingerprintTitle, findSimilarTopic, getRecentTitleFingerprints, titleTemplateFingerprint, type RecentTitleFingerprints } from '@/lib/title-usage-store';
import { assembleCaption, normalizeCaptionParts, stableHash, pickBySeedN, pickBySeed, pickCaptionTemplate, type CaptionParts } from '@/lib/caption-schema';
import { pickImitationRefs, pickImitationRefsForStage, buildImitationPromptText, type ViralNote } from '@/lib/viral-corpus';
import skillData from '@/lib/static-data';
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

  // Defense-in-depth：ensureCoverIdentity 已 clip 过一遍，但 audit LLM-corrections
  // 会绕过 clip 直接改 item.primary/secondary。这里再 clip 一次，给 cover_item_too_long
  // 兜底，避免 audit 后 final_gate 因长度炸单。同时剥掉尾部「→，,、；;：:」等半截话标志，
  // 防 cover_item_truncated 误报。
  const TRAILING_TRUNCATION_CHARS = /[→，,、；;：:。.！!？?]$/;
  // 循环剥：clip 或 LLM 会留下"xxx，。"这类连续半截标点，只剥一次
  // 剩下的"，"仍会触发 final_gate 的 cover_item_truncated。剥到空则保留原文
  // （整条只剩标点的极端情况交给 gate 报错，不产出空条目）。
  const stripTrailingTruncation = (value: string) => {
    if (!value) return value;
    let stripped = value;
    while (TRAILING_TRUNCATION_CHARS.test(stripped)) {
      const next = stripped.replace(TRAILING_TRUNCATION_CHARS, '').trim();
      if (!next) return stripped;
      stripped = next;
    }
    return stripped;
  };
  for (const section of sections) {
    for (const item of section.items) {
      // primaryFrenchOnly：primary 混进中文尾巴（实测 "bien que + 虚拟式" 返修两次
      // 仍残留）。法语词头保留为 primary，中文部分并入 secondary——确定性修复
      // 兜住 prompt 管不住的最后一公里。放在 clip 之前，后续长度裁剪对新值生效。
      if (spec.primaryFrenchOnly && /[一-鿿]/.test(item.primary || '')) {
        const split = (item.primary || '').match(/^([A-Za-zÀ-ÿ][^一-鿿]*?)\s*[+＋]?\s*([一-鿿].*)$/);
        if (split && /[A-Za-zÀ-ÿ]{2}/.test(split[1])) {
          item.secondary = [split[2], item.secondary].filter(Boolean).join('；');
          item.primary = split[1].trim();
          events.push(`分组「${section.heading}」primary 中文尾巴→移入 secondary`);
        }
      }
      if (visualLength(item.primary) > spec.maxPrimaryVisualLength) {
        const clipped = clipVisual(item.primary, spec.maxPrimaryVisualLength);
        events.push(`分组「${section.heading}」primary 超长→截断`);
        item.primary = clipped;
      }
      if (item.secondary && visualLength(item.secondary) > spec.maxSecondaryVisualLength) {
        const clipped = clipVisual(item.secondary, spec.maxSecondaryVisualLength);
        events.push(`分组「${section.heading}」secondary 超长→截断`);
        item.secondary = clipped;
      }
      // 剥掉 clip 或 LLM 留下的尾部「半截话」标点。前后只剥一次，避免把整段干掉。
      const primaryBefore = item.primary;
      const secondaryBefore = item.secondary || '';
      item.primary = stripTrailingTruncation(item.primary);
      if (item.secondary) item.secondary = stripTrailingTruncation(item.secondary);
      if (item.primary !== primaryBefore) events.push(`分组「${section.heading}」primary 尾部截断符→清理`);
      if (item.secondary && item.secondary !== secondaryBefore) events.push(`分组「${section.heading}」secondary 尾部截断符→清理`);
    }
    if (section.items.length > maxItems) {
      // 保护性删除（job_010 实锤：盲砍队尾把文献封面唯一的法语长例句删掉，
      // document_examples_missing 炸单）。优先删内容最短的条目；带 8+ 字符
      // 法语串的例句条目最后才动（全组都是例句时按长度兜底）。幸存条目保持原顺序。
      const beforeCount = section.items.length;
      const strength = section.items.map((item, idx) => ({
        idx,
        hasExample: /[A-Za-zÀ-ÿ]{8,}/.test(`${item.primary} ${item.secondary || ''} ${item.note || ''}`),
        len: visualLength(item.primary) + visualLength(item.secondary || ''),
      }));
      const allExamples = strength.every(entry => entry.hasExample);
      const dropSet = new Set(
        strength
          .filter(entry => allExamples || !entry.hasExample)
          .sort((a, b) => a.len - b.len)
          .slice(0, beforeCount - maxItems)
          .map(entry => entry.idx),
      );
      section.items = section.items.filter((_, idx) => !dropSet.has(idx));
      events.push(`分组「${section.heading}」${beforeCount}条→截断为${maxItems}条`);
    }
  }
  while (sections.length > maxSections) {
    const last = sections.pop()!;
    const target = sections[sections.length - 1];
    const merged = [...target.items, ...last.items];
    if (merged.length > maxItems) {
      const strength = merged.map((item, idx) => ({
        idx,
        hasExample: /[A-Za-zÀ-ÿ]{8,}/.test(`${item.primary} ${item.secondary || ''} ${item.note || ''}`),
        len: visualLength(item.primary) + visualLength(item.secondary || ''),
      }));
      const allExamples = strength.every(entry => entry.hasExample);
      const dropSet = new Set(
        strength
          .filter(entry => allExamples || !entry.hasExample)
          .sort((a, b) => a.len - b.len)
          .slice(0, merged.length - maxItems)
          .map(entry => entry.idx),
      );
      target.items = merged.filter((_, idx) => !dropSet.has(idx));
    } else {
      target.items = merged;
    }
    events.push(`分组超上限，「${last.heading}」并入「${target.heading}」`);
  }
  // 封面数字确定性改写（job_010 炸单链第二环）：截断/并组后条数变了，标题里的
  // "7步骤"就成了谎言 → cover_count_mismatch 炸单。改成真实条数（幂等：本来就
  // 对就不动）。事实量词（N大模块/N项清单…指向商品事实）不改数——改数=造谎，
  // 由 final 阶段的 fact-counter 剥数字逻辑处理。
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const FACT_UNIT = /^(?:大模块|大主题|大维度|模块|资料|范文|清单|文体|主题|维度)/;
  const renumberCountClaim = (text: string): string => text.replace(COVER_COUNT_CLAIM_PATTERN, (whole, num: string, unit: string, offset: number, full: string) => {
    if (FACT_UNIT.test(unit)) return whole;
    if (FACT_UNIT.test(full.slice(offset + whole.length, offset + whole.length + 2))) return whole;
    const expected = SECTION_LEVEL_UNITS.has(unit) ? sections.length : itemCount;
    const claimed = Number.parseInt(num, 10);
    if (!Number.isFinite(claimed) || expected <= 0 || claimed === expected) return whole;
    events.push(`封面数字改写：${whole}→${expected}${unit}`);
    return `${expected}${unit}`;
  });
  return {
    cover: {
      ...cover,
      title: renumberCountClaim(cover.title || ''),
      subtitle: renumberCountClaim(cover.subtitle || ''),
      sections,
    },
    events,
  };
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
    scope_level: topic.topic_type === 'narrow_knowledge' || index === 2 ? 'narrow' : 'broad',
    // 之前 index 3 强制 product_showcase，导致每张卡都产 1 篇"资料库"污染选题。
    // 改成保留 topic.topic_type（如果 LLM 给了），否则按 index 轮换非 product_showcase 类型。
    topic_type: topic.topic_type || (index === 0 ? 'search_pain' : index === 1 ? 'selling_point' : index === 2 ? 'narrow_knowledge' : 'search_pain'),
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
        '你是资深小红书法语内容主编。根据已经完成硬匹配的种子卡，为当前参考封面创作具体内容任务。只返回JSON。',
        '种子卡已经锁定知识边界、商品、人群方向和封面内容形态；不得改seed_id，不得跨考试、跨技能或随机更换痛点。',
        // 关键修复：之前禁止照抄 seed 字段，导致 LLM 把具体痛点全换成"资料库/整理好的"通用元痛点。
        // 现在改成：pain/scene/audience 语义必须保持（可以换措辞，不准换痛点），只有 topic 字段允许改写。
        'topic 字段可以基于 seed.topic 改写以贴合具体场景（例如换成不同语气、加入具体动作），但 pain、scene、audience、content_promise 的语义必须保持。',
        '改写示例：seed.pain="读懂题目却迟迟写不出第一句"，可以改写成"打开题目卡 10 分钟还没动笔"；不可以改成"资料库/整理好的/省时间"这种通用元痛点。',
        // 元痛点黑名单：禁止把 pain 换成这些通用话术
        '禁止把 pain 改成以下通用话术（命中即视为跑题，会被强制重试）：',
        '  - "资料库"、"知识库"、"整理好的"、"系统"、"全面"、"完整"',
        '  - "省时间"、"省一半时间"、"高效"、"节省"',
        '  - "备考资料太多/太乱/太散"',
        'N 个任务必须各用不同 seed，切口明显不同（不同痛点/场景/人群）。不能只换数字和近义词。',
        // 关键修复：之前强制 4 个固定角色（topic_1=搜索痛点、topic_2=买点承接、topic_3=细分、topic_4=知识库宣传），
        // 导致每张卡必产 1 篇"资料库"污染选题。现在让 topic_type 由 seed 自身决定。
        '每个 topic 的 topic_type 由 seed 自身的 topic_type 字段决定，不强制对应位置。',
        'broad 对应大量备考者能立刻理解、经常遇到或会主动搜索的一级问题（例如没思路、词汇不会用、正式信不会写、写完不会改、范文不会迁移）；narrow 用于深入具体知识点或表达。',
        'topic 是选题，不是最终标题：12-24字，清楚说明本篇具体讲什么，不堆情绪词。',
        `每个topic必须出现“${profile.noteIdentity}”对应的清晰身份，禁止用另一商品名称凑身份。禁止写“用A替代B”式选题，不同连接词和句法只能讲语义区别与选择条件。`,
        'audience、scene、pain必须具体且互相成立；content_promise必须能由种子知识范围支撑。',
        '这是选题阶段，不要提前断言具体法语规则、列出未经检索的语法子类型或编造精确数量；具体例句、分类和法语结论留到后续检索与审校。',
        '选题阶段不得预设某句“看似正确其实错/别扭/不地道”。没有具体证据时，只能策划成“按语境区分、比较语域或检查真实错误”，避免后续为了兑现标题把正确法语硬判成错。',
        '选题阶段也不要写“扣分扣在哪、选错就扣分、致命扣分”等官方判分口吻；改成“问题在哪、容易错配、影响表达”。',
        // Fix F（精修侧）：batch_1786817030706 实测 LLM 在精修时发明“9个问题”，
        // 而卡片容量是 22+ → 密度闸门逼出 25 项 → 封面反谎规则把标题改成“25项”，
        // 任务单和成品对不上。数量承诺只能沿用种子卡的真实数字。
        'topic 和 content_promise 里的数量词（N个/N条/N项/N步等，N≥2）只能沿用 base_topic 里已有的真实数字，禁止新造、禁止改小、禁止换算；base_topic 没有数量词就不要新增数量词。封面条目数由模板容量决定，与你写的数字无关。',
        profile.topicScopePrompt,
        'AI可以补充正确科普与例句；不得虚构商品数量、服务、官方规则、得分和提分时长。',
        'product_bridge写给管理员看，只说明如何自然承接当前商品使用场景，不写内部规则、代码名或“是否收录”的讨论。',
        `当前参考封面：${input.card.name}；内容机制：${input.card.content_mechanism}；点击机制：${input.card.click_mechanism}。`,
        (() => {
          const spec = getCoverTemplateSpec(input.card.renderer_id);
          return spec ? `该封面模板容量：${spec.sectionCount}组×约${spec.itemsPerSection}条，最少${spec.minTotalItems}条有效条目。` : '';
        })(),
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
    // Fix F（确定性兜底）：精修后的数量承诺与种子卡不一致 = LLM 新造/改动了数字
    // （"9个问题"事故），直接回退种子卡原文，不信 prompt。
    const topicWithSafeCount = parseContentPromiseCount(topic) !== parseContentPromiseCount(base.topic) ? base.topic : topic;
    const uniqueTopic = topicWithSafeCount && !seen.has(topicWithSafeCount) && topicWithSafeCount !== base.topic ? topicWithSafeCount : base.topic;
    seen.add(uniqueTopic);
    const proposedPromise = selectProductSafeTaskText(input.productId, asString(proposed.content_promise), base.content_promise);
    const safePromise = parseContentPromiseCount(proposedPromise) !== parseContentPromiseCount(base.content_promise) ? base.content_promise : proposedPromise;
    return {
      ...base,
      id: `${base.seed_id || `seed_${index}`}__${input.card.renderer_id}__${nonce}`,
      scope_level: base.topic_type === 'narrow_knowledge' ? 'narrow' : 'broad',
      // 之前没有 topic_type 时按 index 强制分配，position 3 永远是 product_showcase，
      // 这是"资料库污染"的源头之一。现在改成：没 topic_type 时按 index 轮换其他 3 种，
      // product_showcase 只在 seed 显式声明时才出现。
      topic_type: base.topic_type || (index === 0 ? 'search_pain' : index === 1 ? 'selling_point' : index === 2 ? 'narrow_knowledge' : 'search_pain'),
      topic: uniqueTopic,
      audience: selectProductSafeTaskText(input.productId, asString(proposed.audience), base.audience),
      scene: selectProductSafeTaskText(input.productId, asString(proposed.scene), base.scene),
      pain: selectProductSafeTaskText(input.productId, asString(proposed.pain), base.pain),
      content_promise: safePromise,
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
    .replace(/高分模板/g, '常用写作框架')
    .replace(/直接调用/g, '按语境调用')
    .replace(/直接调取/g, '按题目调取')
    .replace(/调用功能块/g, '按题目选表达模块')
    .replace(/替换主题词就能/g, '重写语境后再')
    .replace(/替换主题词[，,]\s*就能/g, '重写主题词后，再')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/让我考前[^，。；\n]{0,24}/g, '考前复盘时')
    .replace(/看似正确(?:实则|其实)(?:错误|别扭|不对|不地道)/g, '容易混淆')
    .replace(/必备/g, '常用')
    .replace(/如何用([^，。；]{1,24})代替(?:简单的)?([^，。；]{1,24})$/g, '$1和$2怎么按语境选择')
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

// 近期已发布内容摘要：喂给生成 prompt 的"避让清单"。设计取舍——
// 不喂全量历史（几百条会稀释注意力、还可能被 LLM 反向抄袭），只喂：
//   1. 句式统计（"「先查这N项」已用4次"）——几行字挡住一整类撞款，性价比最高；
//   2. 最近 10 条封面标题 / 文字标题——挡精确撞款。
// 就算 LLM 没听话，事后还有指纹检查兜底，所以这层失效只会退回原水平，不会更差。
export function buildRecentTitleDigest(fp?: RecentTitleFingerprints): string {
  if (!fp) return '';
  const recent = fp.records.slice(-10);
  const coverTitles = Array.from(new Set(recent.map(record => record.cover_title).filter(Boolean)));
  const textTitles = Array.from(new Set(recent.map(record => record.title).filter(Boolean)));
  const hotPatterns = Array.from(fp.selectedTitleTemplates.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tpl, count]) => `「${tpl}」已用${count}次`);
  if (!coverTitles.length && !textTitles.length && !hotPatterns.length) return '';
  const lines: string[] = ['【近期已发布内容，硬约束】以下标题/句式已发布过：禁止重复，禁止只换数字或换同义词的近似改写；命中的候选会被程序直接丢弃。'];
  if (hotPatterns.length) lines.push(`过度使用句式（整类禁用，换数字换词也算同款）：${hotPatterns.join('；')}。`);
  if (coverTitles.length) lines.push(`已发布封面标题：${coverTitles.join('；')}。`);
  if (textTitles.length) lines.push(`已发布笔记标题：${textTitles.join('；')}。`);
  return lines.join('\n');
}

export async function composeDraft(input: ComposeDraftInput): Promise<ReferenceDrivenDraft> {
  const spec = getCoverTemplateSpec(input.card.renderer_id);
  if (!spec) throw new Error('封面模板规格不存在');
  const profile = getProductPromptProfile(input.productId);
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const allowedTitleFormulas = getRoutedTitleFormulas(input.topic, spec.family);
  const examFactRules = getExamFactRules(input.productId);
  // 爆款模仿：每次 compose 挑 2 篇真实爆款笔记作为参考。
  // prefer_track='delf_b2_writing' 优先同赛道（DELF 选题用 DELF 爆款），
  // 但保留 1 篇跨赛道（雅思/考研/JLPT）以引入经过验证的爆款节奏。
  // 用 seed = `${cardId}|${topicId}` 做确定性采样，方便复现 bug。
  // 经 pickImitationRefsForStage 统一管理，返修阶段也走这个 helper（带 -repair-N 后缀）。
  const viralRefs = pickImitationRefsForStage('first_core', {
    productId: input.productId,
    cardId: input.card.id,
    topicId: input.topic.id,
  });
  // 跨 batch 已发布内容：一份 product 级指纹（14 天），同时供两处使用——
  // 1) 选题相似度观测（Phase 5 兜底，命中挂 warning 不拦截）；
  // 2) buildRecentTitleDigest：把"近期已用标题 + 过度使用句式"喂进生成 prompt，
  //    让 LLM 写的时候就避开，而不是生成完再靠指纹检查事后补救。
  const crossBatchTopicCheck = await getRecentTitleFingerprints(input.productId, { days: 14 })
    .catch(() => undefined);
  const similarTopicHit = crossBatchTopicCheck && input.topic.topic
    ? findSimilarTopic(input.topic.topic, crossBatchTopicCheck.recentTopics, 0.6)
    : null;
  if (similarTopicHit) {
    console.info(`[phase5] topic_similar card=${input.card.id} score=${similarTopicHit.score.toFixed(2)} topic="${input.topic.topic}" recent="${similarTopicHit.similar}"`);
  }
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
        '笔记文字标题必须不超过20个字符，中文、英文、数字、空格、全角/半角标点都各算1个字符；必须提供5类候选：资料型、解释型、强钩子型、情绪型、结果型。它负责搜索和点击，必须优先使用恐惧损失、好奇缺口、认知冲突、场景代入之一。句式硬限制：候选里带问号的疑问句最多 2 条，“救命”“别再”“为什么”开头的句式各自最多 1 条，其余写陈述句；程序按句式指纹扣分，重复句式会被排到末尾。禁止写成平淡说明书标题。',
        // 笔记文字标题必须贴合真实搜索行为。validated_search_keywords 是小红书
        // 下拉联想验证过的高流量词，标题自然嵌入 1 个能显著提升可搜性。禁止
        // 堆砌——一个标题最多 1 个高频词，且必须服务于选题核心承诺。
        titleKeywords.length
          ? `笔记文字标题应贴合小红书真实搜索流量。validated_search_keywords 字段里的词（${titleKeywords.join('、')}）均经过下拉联想验证，流量真实。每个标题候选最多自然嵌入 1 个高频词，必须服务于选题，禁止堆砌；如果选题与这些词都无关，宁可不用。`
          : '',
        '75个公式只服务于笔记文字标题：先匹配心理触发器，再仿写公式结构，禁止为了套公式扭曲内容。候选中必须覆盖5个title_type：资料型、解释型、强钩子型、情绪型、结果型；至少包含1个自然原创标题、1个公式仿写标题、1个竞品机制迁移标题。类型只能写在 title_type 字段里，title 字段只放标题文字本身——禁止在标题末尾或中间附加"（资料型）"之类的类型标注。',
        '标题质量硬要求：至少命中2项——具体人群/场景、真实痛点、悬念缺口、反常识、损失感、数字锚点。无情绪、无悬念、无痛点的内部任务名必须重写。',
        `例如：笔记文字标题负责点击和搜索；封面标题负责让人一眼看懂“${profile.noteIdentity}”的具体资料价值；副标题再说明范围或使用场景。三者不要写成同一句。`,
        '封面标题或副标题若写具体数量（N句/个/条/项/类/组/步/招/要点/关键），N必须严格等于封面实际条目数或分组数。DELF B2客观事实数字（如"3种写作任务"）允许出现在正文，但**禁止**写在封面 title/subtitle——封面格子数与考试事实数字经常对不上，会被审校砍掉。拿不准就不要写数字，让正文承载客观事实。',
        // 反谎补丁：规则"数字=格子数"遇到事实量词会产生更坏的错——标题编辑器被禁写
        // 事实数字 7（7大模块），就按分组数改写成"5大模块"，等于造出一个假事实
        // （batch_1786838937231 job_011 实锤：封面"5大模块全景图"+副题"42条资料"，
        // 正文却写 7大模块/519条，同一篇自相矛盾）。
        '特别禁止：把事实计数改写成封面格子数。量词指向商品或考试事实时（大模块/大主题/大维度/种文体/条资料/篇范文/项清单），数字必须等于商品真实数量——封面凑不齐就整个去掉数字（写"模块全景图"而不是"5大模块"），绝不允许把数字改成封面分组数或条目数。',
        '标题必须像中国用户自然说话，读出声不拗口。标题至少有明确对象、具体利益或信息缺口中的两项。',
        '标题写“陷阱/错误/避坑”时正文必须真有对应错误；写“模板/范文”时本篇必须真提供模板或完整范文。禁止为了蹭搜索词改变内容类型。',
        `每个笔记文字标题和封面主标题都必须清楚出现“${profile.noteIdentity}”对应身份，且不得出现另一商品考试名称。`,
        '标题允许适度使用“大全、必背、万能、考官、稳过、7天、提分”等强钩子词来制造点击欲，但必须能在正文中用真实干货降落；不得冒充官方授权、内部押题或真实承诺。正文和内页比标题克制，不要把标题钩子写成事实保证。',
        '没有明确证据时，禁止任何百分比、多少人会用、多少考生不知道、星级标记、具体扣分或提分数字。',
        '任何用户可见内容不得出现AU-、CH-、FW-、GD-等内部编号。',
        '这一轮只生成统一任务单、标题和封面内容，不写正文和内页。',
        // 爆款模仿：viral_references 字段给了 2 篇真实爆款笔记（标题 + 正文开头）。
        // 学的是节奏（开头方式、标题钩子类型、句子松紧），不是抄内容（爆款讲的可能不是本商品）。
        // 标题模仿：参考爆款的"具体场景开头/数字锚点/反差感"，应用到本选题。
        // 副标题模仿：参考爆款正文开头怎么"第一人称 + 具体场景"切入。
        buildImitationPromptText('first_core'),
        // 动态段（依赖 spec/card）放在末尾，前缀缓存命中的部分仍是上面这些静态段。
        templatePrompt,
        spec.primaryFrenchOnly
          ? '本模板条目 primary 只能写纯法语词、搭配或短表达，primary 里禁止出现任何汉字——前面"primary写法语词/短语或中文知识点"一句中"或中文知识点"的许可对本模板不生效。中文释义、知识点名、编号清单一律写进 secondary，读者照样一眼看懂。'
          : '',
        // 近期已发布内容摘要：LLM 在写的时候就知道该避开什么（根治撞款），
        // 事后指纹检查只是兜底。刻意保持精简（近10条标题 + 句式统计），
        // 避免长列表挤占注意力。
        buildRecentTitleDigest(crossBatchTopicCheck),
        // 容量硬约束：大容量模板（如 4组×8条）远超证据条数时，LLM 会保守地只写
        // 有据可依的条目 → 第一次生成就 cover_density_severely_low。明确允许并
        // 要求用 AI 原创条目补满容量。
        `模板要求的组数和每组条数是硬性容量，必须写满。本次检索证据只有${input.evidence.length}条，不够填满时必须基于你自己的法语备考知识原创补满（source_type 标 ai_original 或 mixed），宁可条目平淡真实，也不能少写；禁止因为证据少就缩减条数。`,
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
        // 爆款模仿：2 篇真实爆款笔记，标题和正文开头都来自小红书真实数据。
        // 学标题的"开头节奏 + 钩子类型 + 长度感"，学正文开头的"第一人称/具体场景"。
        // 不抄具体内容（爆款讲雅思/考研，本篇必须讲 DELF）。
        viral_references: viralRefs.map(n => ({
          track: n.track,
          collected: n.collected,
          title: n.title,
          caption_opening: n.caption_opening,
          cover_type: n.cover_type,
        })),
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
  let cover = applyAutoFix(ensureCoverIdentity(normalizeDenseDirectoryCover(core.cover), input.card.renderer_id, input.productId, input.topic));
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
      cardId: input.card.id,
      topicId: input.topic.id,
      attempt: repairAttempt + 1,
    });
    const repaired = asRecord(repairResult);
    titleCandidates = normalizeTitles(repaired.title_candidates, allowedTitleFormulaIds, input.productId);
    cover = applyAutoFix(ensureCoverIdentity(normalizeDenseDirectoryCover(repaired.cover), input.card.renderer_id, input.productId, input.topic));
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
  if (blockingCoreIssues.length) {
    let diagnostic = '';
    if (blockingCoreIssues.includes('product_identity_mismatch')) {
      const offenders: string[] = [];
      const forbiddenRe = profile.forbiddenIdentityPattern;
      const check = (label: string, value: string) => {
        if (value && forbiddenRe.test(value)) offenders.push(`${label}="${value.slice(0, 60)}"`);
      };
      check('cover.title', cover.title || '');
      check('cover.subtitle', cover.subtitle || '');
      cover.sections.forEach((section, idx) => {
        check(`section[${idx}].heading`, section.heading || '');
        section.items.forEach((item, j) => {
          check(`section[${idx}].item[${j}].primary`, item.primary || '');
          check(`section[${idx}].item[${j}].secondary`, item.secondary || '');
        });
      });
      titleCandidates.forEach((c, idx) => check(`titleCandidate[${idx}]`, c.title || ''));
      diagnostic = offenders.length ? ` | forbidden_hits: ${offenders.join(' | ')}` : ' | no_field_match_(pattern_miss?)';
    }
    if (blockingCoreIssues.includes('cover_primary_not_french')) {
      const offenders: string[] = [];
      cover.sections.forEach((section, idx) => section.items.forEach((item, j) => {
        if (/[一-鿿]/.test(item.primary || '')) offenders.push(`s${idx}i${j}="${(item.primary || '').slice(0, 40)}"`);
      }));
      if (offenders.length) diagnostic += ` | non_french_hits: ${offenders.slice(0, 5).join(' | ')}`;
    }
    if (blockingCoreIssues.includes('cover_section_severely_low') || blockingCoreIssues.includes('cover_density_severely_low')) {
      diagnostic += ` | section_counts: [${cover.sections.map(s => s.items.length).join(',')}] (需${spec ? `${spec.sectionCount}组×${spec.itemsPerSection}条` : '?'})`;
    }
    throw new Error(`标题或封面返修后仍未达标：${blockingCoreIssues.join(', ')}${diagnostic}`);
  }

  const narrativeSkeleton = pickNarrativeSkeleton(
    `${input.card.id}|${input.topic.seed_id || input.topic.id}`,
    crossBatchTopicCheck?.recentSkeletons || [],
  );
  const editorialResult = await generateEditorialOutput(input, {
    brief,
    selectedTitle,
    cover,
    viralRefs,
    recentTagCounts: crossBatchTopicCheck?.recentTagCounts,
    recentPageTitles: crossBatchTopicCheck?.recentPageTitles,
    narrativeSkeleton,
    recentCaptionEndings: crossBatchTopicCheck?.recentCaptionEndings,
  });

  let editorial = asRecord(editorialResult);
  let innerPages = normalizePageEvidence(normalizePages(editorial.inner_pages, `${input.card.id}|${input.topic.id}`), input.evidence);
  let caption = resolveCaptionFromEditorial(editorial, { productId: input.productId, cardId: input.card.id, topicId: input.topic.id, coverTitle: cover.title || '' });
  const seoKeywords = buildSeoKeywords(input.productId, input.topic);
  const seedTopicKeywords = getSeedTopicKeywords(input.topic.seed_id || '');
  let tags = normalizeTags(editorial.tags, seoKeywords, input.productId, [
    input.topic.topic,
    input.topic.content_promise,
    cover.title,
    cover.subtitle,
    cover.sections.map(section => section.heading).join(' '),
    caption,
    innerPages.map(page => page.page_title).join(' '),
  ].filter(Boolean).join(' '), input.card.id, crossBatchTopicCheck?.recentTagCounts, seedTopicKeywords);
  innerPages = ensureMinimumInnerPages(innerPages, cover, input.productId);
  caption = ensurePublishableCaption(caption, seoKeywords[0], cover, input.card.id);
  let editorialWarnings = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId).filter(issue => !isBlockingEditorialIssue(issue));
  const editorialIssues = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId).filter(isBlockingEditorialIssue);
  if (editorialIssues.length) {
    editorial = asRecord(await repairEditorialOutput({ brief, selectedTitle, cover, evidence: input.evidence, issues: editorialIssues, seoKeywords, cardId: input.card.id, topicId: input.topic.id, attempt: 1 }));
    innerPages = normalizePageEvidence(normalizePages(editorial.inner_pages, `${input.card.id}|${input.topic.id}`), input.evidence);
    caption = resolveCaptionFromEditorial(editorial, { productId: input.productId, cardId: input.card.id, topicId: input.topic.id, coverTitle: cover.title || '' });
    tags = normalizeTags(editorial.tags, seoKeywords, input.productId, [
      input.topic.topic,
      input.topic.content_promise,
      cover.title,
      cover.subtitle,
      cover.sections.map(section => section.heading).join(' '),
      caption,
      innerPages.map(page => page.page_title).join(' '),
    ].filter(Boolean).join(' '), input.card.id, crossBatchTopicCheck?.recentTagCounts, seedTopicKeywords);
    innerPages = ensureMinimumInnerPages(innerPages, cover, input.productId);
    caption = ensurePublishableCaption(caption, seoKeywords[0], cover, input.card.id);
    const remainingIssues = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId);
    editorialWarnings = remainingIssues.filter(issue => !isBlockingEditorialIssue(issue));
    const blockingIssues = remainingIssues.filter(isBlockingEditorialIssue);
    if (blockingIssues.length) {
      let editorialDiag = '';
      if (blockingIssues.includes('caption_ai_cliche')) {
        const m = caption.match(AI_CLICHE_PATTERN);
        editorialDiag = m ? ` | cliche_hit:"${m[0].slice(0, 50)}"` : ' | cliche:no_match_(regex_change?)';
      }
      if (blockingIssues.includes('caption_length_invalid')) {
        editorialDiag += ` | caption_len=${caption.length}(需220-440)`;
      }
      throw new Error(`内页或正文返修后仍未达标：${blockingIssues.join(', ')}${editorialDiag}`);
    }
  }
  // 带货承接 enforcement：LLM 没写承接句就按 seed 轮换确定性补一句，
  // 保证每篇正文都有带货出口（warn 不 block，补完即达标）。
  const recentCaptionEndings = crossBatchTopicCheck?.recentCaptionEndings || [];
  caption = ensureProductBridge(caption, brief, `${input.card.id}|${input.topic.seed_id || input.topic.id}`, recentCaptionEndings);
  // 结尾批内复读 enforcement：承接句/CTA 与近期结尾同尾时确定性改写成另一出口。
  caption = ensureCaptionEndingVariety(caption, recentCaptionEndings);
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
  cover = applyAutoFix(ensureCoverIdentity(normalizeDenseDirectoryCover(audited.cover), input.card.renderer_id, input.productId, input.topic));
  innerPages = normalizePageEvidence(normalizePages(audited.innerPages, `${input.card.id}|${input.topic.id}`), input.evidence);
  caption = ensurePublishableCaption(scrubCheapClaims(sanitizePublicText(audited.caption)), seoKeywords[0], cover, input.card.id);
  // 跨 batch 标题去重，两级范围：
  //   - 文字标题指纹/候选池：seed 范围（候选池跨 seed 会误杀——别的 seed 候选池里
  //     出现过不等于撞款，只是没被选中）；
  //   - 封面标题/副标题/句式统计：product 范围（封面标题是最终发布物，换卡片
  //     （=换 seed）撞款一样算撞款。"B2作文先查这9项" 跨卡片重复就是这里的洞）。
  const [seedScopedFingerprints, productWideFingerprints] = await Promise.all([
    getRecentTitleFingerprints(input.productId, { seedId: input.topic.seed_id, days: 30 }).catch(() => undefined),
    getRecentTitleFingerprints(input.productId, { days: 30 }).catch(() => undefined),
  ]);
  const recentTitleFingerprints: RecentTitleFingerprints | undefined = seedScopedFingerprints && productWideFingerprints
    ? {
      ...seedScopedFingerprints,
      coverTitles: productWideFingerprints.coverTitles,
      coverSubtitles: productWideFingerprints.coverSubtitles,
      selectedTitleTemplates: productWideFingerprints.selectedTitleTemplates,
    }
    : (seedScopedFingerprints || productWideFingerprints);
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
    recentTitleFingerprints,
  });
  titleCandidates = titlePolish.titleCandidates;
  selectedTitle = titlePolish.selectedTitle;
  cover = titlePolish.cover;

  // 最终兜底：polish 阶段可能再次注入跨商品身份词（TEF/TCF 等），final_gate
  // 会判 product_identity_mismatch 直接挂掉整个 job。再走一次 strip + autofix，
  // 避免连环重试烧 token。同时清理 caption 和 inner_pages 的 forbidden identity，
  // 因为 getEditorialIssues 也会判 product_identity_mismatch。
  const profileFinal = getProductPromptProfile(input.productId);
  const stripForbiddenIdentityFinal = (value: string) => stripForbiddenIdentity(input.productId, value);
  cover = {
    ...cover,
    title: stripForbiddenIdentityFinal(cover.title || ''),
    subtitle: stripForbiddenIdentityFinal(cover.subtitle || ''),
    sections: (cover.sections || []).map(section => ({
      ...section,
      heading: stripForbiddenIdentityFinal(section.heading || ''),
      side_label: stripForbiddenIdentityFinal(section.side_label || ''),
      items: (section.items || []).map(item => ({
        ...item,
        primary: stripForbiddenIdentityFinal(item.primary || ''),
        secondary: item.secondary ? stripForbiddenIdentityFinal(item.secondary) : item.secondary,
        note: item.note ? stripForbiddenIdentityFinal(item.note) : item.note,
      })),
    })),
  };
  selectedTitle = stripForbiddenIdentityFinal(selectedTitle);
  titleCandidates = titleCandidates.map(c => ({ ...c, title: stripForbiddenIdentityFinal(c.title || '') }));
  // 谎报词标题兜底：候选过滤在 polish 之前跑，polish 可能重新注入"官方授权"式
  // 标题。选中标题命中谎报词时确定性换掉——优先池里本 seed
  // 锚定的干净候选，其次 seed 兜底标题；换不出就保留原样走原闸门，不加新炸单点。
  if (selectedTitle && TITLE_CLAIM_PATTERN.test(selectedTitle)) {
    const cleanPoolTitle = titleCandidates.find(c => c.title && isCompleteTitle(c.title, 'text') && !TITLE_CLAIM_PATTERN.test(c.title)
      && (!input.topic.seed_id || isTitleAnchoredToSeed(c.title, input.topic.seed_id)))?.title;
    const seedFallback = buildSeedTitleFallbacks(input.topic, input.productId);
    const seedFallbackTitle = [seedFallback.free, seedFallback.reference]
      .find(title => title && !TITLE_CLAIM_PATTERN.test(title)
        && (!input.topic.seed_id || isTitleAnchoredToSeed(title, input.topic.seed_id)));
    const swapTitle = cleanPoolTitle || seedFallbackTitle;
    if (swapTitle) {
      console.info(`[final-title-claim] card=${input.card.id} "${selectedTitle}" -> "${swapTitle}"`);
      selectedTitle = swapTitle;
    }
  }
  caption = stripForbiddenIdentityFinal(caption);
  innerPages = innerPages.map(page => ({
    ...page,
    page_title: stripForbiddenIdentityFinal(page.page_title || ''),
    lead: stripForbiddenIdentityFinal(page.lead || ''),
    bullets: page.bullets.map(bullet => stripForbiddenIdentityFinal(bullet)),
  }));

  // 兜底兜底：polish 阶段如果 LLM 把 cover.title 改成不含 DELF B2/B2写作 的钩子型标题，
  // final_gate 会判 product_identity_mismatch；official_notice/pain_quote_big 的标题
  // 还会被改成不合模板格式的小红书钩子（"B2作文先查这6项"）。这里直接覆盖成
  // 已知安全的 fallback（buildCoverTitleFallback 对这两个模板返回格式正确的标题）。
  const titleFormatBroken = input.card.renderer_id === 'official_notice'
    ? !/^关于.{2,16}的通知$/.test(cover.title || '')
    : input.card.renderer_id === 'pain_quote_big'
      ? !(/我室友|我同学|我的朋友|室友|同学|朋友/.test(cover.title || '') && /栽|卡|挂|折|绊/.test(cover.title || '') && /避开|绕开|别再踩|快看看|为啥|猜猜|点开/.test(cover.title || ''))
      : false;
  if (!hasRequiredProductIdentity(input.productId, cover.title || '') || titleFormatBroken) {
    const familyFinal = getCoverTemplateSpec(input.card.renderer_id)?.family;
    // 每一环都过身份词+长度校验，不再盲信任何单一兜底源。
    // 最后一环 noteIdentity 前缀必然含本商品身份词，保证链条永远终止在合格标题上，
    // 不会再把"法语B2必背高频表达"这种缺身份词的兜底标题送进 final_gate。
    const fallbackCandidates = [
      buildCoverTitleFallback(input.topic, input.productId, input.card.renderer_id, cover, recentTitleFingerprints?.coverTitles, recentTitleFingerprints?.coverSubtitles).title,
      getRendererCoverFallbackTitle(input.productId, input.card.renderer_id, familyFinal),
      getProductCoverFallbackTitle(input.productId),
    ];
    const safeTitle = fallbackCandidates.find(title => title && hasRequiredProductIdentity(input.productId, title) && isCoverTitleLengthOk(spec, title.length));
    if (safeTitle) {
      console.info(`[final-fallback] card=${input.card.id} orig="${cover.title}" -> fallback="${safeTitle}"`);
      cover = { ...cover, title: safeTitle };
    }
  }

  // polish + strip 之后，cover.sections 可能仍残留 polish 阶段重新注入的尾部截断符
  // （autofix 只在 line 562/587/650 跑过，polish 之后的 stripForbiddenIdentity 不动截断符）。
  // 再跑一次 autoFixCoverCapacity，把 "Je vais," 这种半截标点清掉，避免 final_gate 误判。
  const finalAutofix = autoFixCoverCapacity(cover, spec);
  if (finalAutofix.events.length) {
    console.info(`[final-autofix] card=${input.card.id} events=${JSON.stringify(finalAutofix.events)}`);
  }
  cover = finalAutofix.cover;

  // 反谎终检（batch_1786838937231 job_011 实锤）：封面标题/副题的事实计数
  // （N大模块/N条资料/N篇范文…）若与正文同类计数不一致，确定性剥掉封面数字。
  // "5大模块全景图"（5=封面分组数）配正文"7大模块"、"42条资料"配"519条"，
  // 是"封面数字必须等于格子数"规则在事实量词上的副作用——编辑器凑不齐就改数，
  // 比不写数字更糟。剥数字保事实：5大模块→模块，42条资料→资料。
  {
    const COUNTER_RE = /(\d{1,3})\s*(?:大|条|篇|项|种)(模块|资料|范文|清单|文体|主题|维度)/g;
    const bodyText = `${caption} ${innerPages.map(page => `${page.page_title} ${page.lead} ${page.bullets.join(' ')}`).join(' ')}`;
    const bodyCounters = new Map<string, Set<number>>();
    for (const match of bodyText.matchAll(COUNTER_RE)) {
      const unit = match[2];
      if (!bodyCounters.has(unit)) bodyCounters.set(unit, new Set());
      bodyCounters.get(unit)!.add(Number.parseInt(match[1], 10));
    }
    const stripConflictingCounters = (value: string): string => value.replace(COUNTER_RE, (whole, num: string, unit: string) =>
      bodyCounters.get(unit)?.has(Number.parseInt(num, 10)) ? whole : `${unit}`);
    const titleStripped = stripConflictingCounters(cover.title || '');
    const subtitleStripped = stripConflictingCounters(cover.subtitle || '');
    if (titleStripped !== cover.title || subtitleStripped !== cover.subtitle) {
      console.info(`[final-fact-counter] card=${input.card.id} title="${cover.title}"->"${titleStripped}" subtitle="${(cover.subtitle || '').slice(0, 30)}"->"${subtitleStripped.slice(0, 30)}"`);
      cover = { ...cover, title: titleStripped, subtitle: subtitleStripped };
    }
  }

  const finalCoreIssues = getCoreIssues(titleCandidates, cover, input.card.renderer_id, input.evidence, input.productId);
  coreWarnings = finalCoreIssues.filter(issue => !isBlockingCoreIssue(issue));
  const finalBlockingCoreIssues = finalCoreIssues.filter(isBlockingCoreIssue);
  // 文字标题主题锚定终检：选出的 selected_title 必须命中本 seed 的关键词，
  // 否则宁可炸单返修也不发一篇标题与内容驴唇不对马嘴的笔记。
  if (input.topic.seed_id && selectedTitle && !isTitleAnchoredToSeed(selectedTitle, input.topic.seed_id)) {
    finalBlockingCoreIssues.push('selected_title_off_topic');
  }
  const finalEditorialAllIssues = getEditorialIssues(innerPages, caption, seoKeywords, input.evidence, input.productId);
  editorialWarnings = finalEditorialAllIssues.filter(issue => !isBlockingEditorialIssue(issue));
  const finalEditorialIssues = finalEditorialAllIssues.filter(isBlockingEditorialIssue);
  if (finalBlockingCoreIssues.length || finalEditorialIssues.length) {
    // 诊断输出：把 product_identity_mismatch 触发的具体字段位置暴露到 failure message，
    // 否则光看 "final_gate=product_identity_mismatch" 没法定位 LLM 在哪写了他商品身份词。
    let diagnostic = '';
    if (finalBlockingCoreIssues.includes('product_identity_mismatch') || finalEditorialIssues.includes('product_identity_mismatch')) {
      const profileFinal2 = getProductPromptProfile(input.productId);
      const offenders: string[] = [];
      const check = (label: string, value: string) => {
        if (value && profileFinal2.forbiddenIdentityPattern.test(value)) offenders.push(`${label}="${value.slice(0, 60)}"`);
      };
      check('cover.title', cover.title || '');
      check('cover.subtitle', cover.subtitle || '');
      cover.sections.forEach((section, idx) => {
        check(`section[${idx}].heading`, section.heading || '');
        section.items.forEach((item, j) => {
          check(`section[${idx}].item[${j}].primary`, item.primary || '');
          check(`section[${idx}].item[${j}].secondary`, item.secondary || '');
        });
      });
      titleCandidates.forEach((c, idx) => check(`titleCandidate[${idx}]`, c.title || ''));
      // 正文和内页也会触发 product_identity_mismatch（getEditorialIssues 检查
      // editorialText），但旧诊断只扫封面 → 报 no_field_match 没法定位。
      check('caption', caption || '');
      innerPages.forEach((page, idx) => {
        check(`innerPage[${idx}].page_title`, page.page_title || '');
        check(`innerPage[${idx}].lead`, page.lead || '');
        page.bullets.forEach((bullet, j) => check(`innerPage[${idx}].bullet[${j}]`, bullet || ''));
      });
      if (!offenders.length && !hasRequiredProductIdentity(input.productId, cover.title || '')) {
        offenders.push(`cover.title="${(cover.title || '').slice(0, 60)}"(缺本商品身份词)`);
      }
      diagnostic = offenders.length ? ` | forbidden_hits: ${offenders.join(' | ')}` : ' | no_field_match_(pattern_miss?)';
    }
    if (finalBlockingCoreIssues.includes('selected_title_off_topic')) {
      diagnostic += ` | off_topic_title: selected_title="${(selectedTitle || '').slice(0, 30)}" seed=${input.topic.seed_id} keywords=${getSeedTopicKeywords(input.topic.seed_id || '').slice(0, 4).join('/')}`;
    }
    if (finalBlockingCoreIssues.includes('cover_item_truncated')) {
      const truncated: string[] = [];
      const trailingRe = /[→，,、；;:：]$/;
      cover.sections.forEach((section, idx) => section.items.forEach((item, j) => {
        if (trailingRe.test(item.primary || '')) truncated.push(`s${idx}i${j}.primary="${(item.primary || '').slice(-20)}"`);
        if (trailingRe.test(item.secondary || '')) truncated.push(`s${idx}i${j}.secondary="${(item.secondary || '').slice(-20)}"`);
      }));
      if (truncated.length) diagnostic += ` | truncated_hits: ${truncated.join(' | ')}`;
    }
    if (finalEditorialIssues.includes('caption_ai_cliche') || finalBlockingCoreIssues.includes('caption_ai_cliche')) {
      // 套话可能藏在正文、封面或内页任何用户可见字段（getCoreIssues 用封面文本、
      // getEditorialIssues 用正文调同一个检查）。只扫 caption 会漏——实测 job_011
      // 套话在封面文本里，诊断打不出命中句。全字段扫描并定位。
      const clicheFields: string[] = [];
      const scanCliche = (label: string, value: string) => {
        if (!value) return;
        const m = value.match(AI_CLICHE_PATTERN);
        if (m) clicheFields.push(`${label}:"${m[0].slice(0, 40)}"`);
      };
      scanCliche('caption', caption);
      scanCliche('cover.title', cover.title || '');
      scanCliche('cover.subtitle', cover.subtitle || '');
      cover.sections.forEach((section, idx) => {
        scanCliche(`cover.s${idx}.heading`, section.heading || '');
        section.items.forEach((item, j) => {
          scanCliche(`cover.s${idx}i${j}.primary`, item.primary || '');
          scanCliche(`cover.s${idx}i${j}.secondary`, item.secondary || '');
        });
      });
      innerPages.forEach((page, idx) => {
        scanCliche(`page[${idx}].title`, page.page_title || '');
        scanCliche(`page[${idx}].lead`, page.lead || '');
        page.bullets.forEach((bullet, j) => scanCliche(`page[${idx}].b${j}`, bullet || ''));
      });
      diagnostic += clicheFields.length ? ` | cliche_hits: ${clicheFields.slice(0, 5).join(' | ')}` : ' | cliche:no_match_(regex_change?)';
    }
    throw new Error(`法语与考试事实审校未通过：final_gate=${[...finalBlockingCoreIssues, ...finalEditorialIssues].join(',')}${diagnostic}`);
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
    narrative_skeleton: narrativeSkeleton.id,
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
  // Phase 6 带货观测点（软警告，不阻塞）：
  // - brief.selling_point / buying_reason 空值 → LLM 没生成买点信息
  // - inner_pages 缺 product_bridge → 没有"如何承接商品"的内页（narrow_knowledge 除外）
  // 这两条之前没有 check，带货笔记可能悄悄变成纯科普。命中即挂 warning 让 benchmark 看到。
  const phase6Warnings: string[] = [];
  if (!brief.selling_point || !brief.buying_reason) {
    phase6Warnings.push('brief_product_fields_missing');
  }
  const hasProductBridge = innerPages.some(page => page.page_type === 'product_bridge');
  // narrow_knowledge 类型本身就是细分知识点，不强求带货；其他类型缺 product_bridge 才告警。
  if (!hasProductBridge && input.topic.topic_type !== 'narrow_knowledge') {
    phase6Warnings.push('product_bridge_page_missing');
  }
  draft.checks.warnings = Array.from(new Set([
    ...(draft.checks.warnings || []),
    ...coreWarnings,
    ...editorialWarnings,
    ...(similarTopicHit ? ['topic_similar_to_recent'] : []),
    ...phase6Warnings,
  ]));
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
        'corrected_caption 只在原正文上修改有事实/法语/语域错误的句子，其余句子原样保留；禁止借改写塞入"不是X而是Y""问题出在""X才是关键/根本""首先…其次…最后…"等AI套话句式，也不得把口语节奏改写成议论文。',
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
      // 审校 LLM 的改写项命中 AI 套话就整条弃用，保留原值——与 corrected_caption
      // 同一防线：审校改写是套话注入源之一。
      if ([primary, secondary, note].some(text => text && AI_CLICHE_PATTERN.test(text))) continue;
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
      if (AI_CLICHE_PATTERN.test(correctedText)) continue;
      page.bullets[bulletIndex] = correctedText;
      correctedLocations.add(`inner_pages[${Number(correction.page_index)}].bullets[${bulletIndex}]`);
      correctedCount += 1;
    }
  }
  const correctedCaption = sanitizePublicText(asString(result.corrected_caption));
  // corrected_caption 是审校 LLM 整段重写的，实测会把 AI 套话（"不是X，而是Y"）
  // 带进正文 → 后面 final_gate 才发现。在这里确定性拦掉：改写版含套话就弃用，
  // 保留原正文（原正文有事实错误时由后续 repair 循环处理）。
  if (correctedCaption && !AI_CLICHE_PATTERN.test(correctedCaption)) {
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
    // 错句对照类内容里"错："一侧（✗/×/错： 到 ✓/√/对： 之间）是故意写错的
    // 教学素材，词典层必须跳过——job_007 实测 "une voiture francais" 被
    // 判成粘词硬错，整个 job 白白多走一轮返修。只豁免词典这一层，上面的
    // LLM 审校照常看（它懂教学语境）。
    const stripWrongSide = (text: string) => text
      .replace(/(?:[✗✘×❌]|错[：:])(.*?)(?=[✓✔√]|对[：:]|正[：:]|$)/g, ' ')
      .replace(/\s+/g, ' ');
    const dictionaryCover = {
      sections: coverCopy.sections.map(section => ({
        items: section.items.map(item => ({
          primary: stripWrongSide(item.primary || ''),
          secondary: item.secondary ? stripWrongSide(item.secondary) : undefined,
        })),
      })),
    };
    const dictionaryPages = pagesCopy.map(page => ({
      lead: stripWrongSide(page.lead || ''),
      bullets: page.bullets.map(bullet => stripWrongSide(bullet || '')),
    }));
    const findings = await findSuspiciousFrenchTokens(collectFrenchCheckTargets(dictionaryCover, dictionaryPages));
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

// Caption schema 模式已永久关闭。
// 之前 list/story/contrast 三模板强制分发，导致 100% caption 结构模板化。
// 现在完全信任 LLM 看 viral_references 自由写 caption。
// 保留函数签名是为了兼容现有调用点（resolveCaptionFromEditorial / captionMin 计算）。
function captionSchemaEnabled(): boolean {
  return false;
}

// 叙事骨架池：caption schema 关闭后完全靠 LLM 自由写，但 viral_references 全是
// 第一人称失败复盘型爆款，LLM 篇篇学它的骨架（11 篇模拟实测 8/11 同为
// "我以前惨→后来方法→现在好了"救赎弧，9/11 结尾同款"整理进资料"句式）。
// 骨架由代码按 seed 确定性指定——不进 prompt 示例池（LLM 必抄文字示例），
// 只给结构描述。
const NARRATIVE_SKELETONS = [
  { id: 'failure_recovery', spec: '失败复盘——第一人称，从一次具体的失败经历（某次模考/练习/被批改的瞬间）切入，自然带出方法；结尾落在方法生效后的具体变化' },
  { id: 'direct_delivery', spec: '直给清单——开头一两句说清本篇解决什么问题、给出什么交付，直接进入条目展开；不讲故事、不铺情绪' },
  { id: 'myth_busting', spec: '误区纠偏——开头指出一个多数考生都在用的普遍做法，点破它为什么吃亏，再给正确做法和正误对照' },
  { id: 'qa_walkthrough', spec: '自问自答——开头抛出读者最可能问的一个问题，正文每段回答一个子问题，层层拆完' },
  { id: 'scene_timeline', spec: '场景时间线——开头把读者放进具体场景（发卷后十分钟/写正文前五分钟），按时间顺序走每一步该做什么' },
] as const;

export function pickNarrativeSkeleton(seedKey: string, recentSkeletons: readonly string[] = []): { id: string; spec: string } {
  // 只在"近期用得最少"的骨架里抽。旧版是排序沉底——但排序不排除，hash 取模
  // 照样能抽中沉底项（概率不变），实测 13 篇里 myth_busting×7、agent2 批内 3/4。
  // 硬排除后同骨架不可能连发两篇：被用过一次就退出候选，直到其他骨架追平。
  const useCount = (id: string) => recentSkeletons.filter(s => s === id).length;
  const counts = NARRATIVE_SKELETONS.map(s => useCount(s.id));
  const minCount = Math.min(...counts);
  const candidates = NARRATIVE_SKELETONS.filter(s => useCount(s.id) === minCount);
  return candidates[stableHash(`${seedKey}-skeleton`) % candidates.length];
}

// 从 editorial 结果里抽出 caption 字符串。
// schema 模式优先用 caption_parts（拼装）；LLM 漏返字段时退回 legacy caption 路径，不挂 job。
function resolveCaptionFromEditorial(
  editorial: Record<string, unknown>,
  fallback: { productId: ProductId; cardId: string; topicId?: string; coverTitle: string },
): string {
  if (captionSchemaEnabled() && editorial.caption_parts && typeof editorial.caption_parts === 'object') {
    const parts = normalizeCaptionParts(editorial.caption_parts, fallback);
    return scrubCheapClaims(assembleCaption(parts, fallback.cardId));
  }
  return scrubCheapClaims(sanitizePublicText(asString(editorial.caption)));
}

// ============ Caption 多模板 prompt（list / story / contrast）============

// 共通约束：所有 3 个模板都必须遵守。
const CAPTION_SCHEMA_COMMON_RULES = `共通约束（强制）：
- 所有字段禁止"帮你"、"这套"、"按部就班"、"问题在于"、"通过...才能"、"综上所述"、"即查即用"
- cta 禁止"使用时先看封面总览"、"这样复盘更具体"、"备考会更有条理"等模板化尾句
- 核心搜索词必须自然嵌入到 hook 或 scenario/story/wrong 前 80 字内（SEO 硬约束）`;

// list 模板（清单体）：N 个 X、这 X 类、N 步
const CAPTION_LIST_PROMPT = `本篇用【清单体 list】caption_parts 字段（强制，缺一不可）：
- hook: 一句话钩子，8-25字，必须含数字或反差句式（如"这5个"、"还在临时拼？"）
- scenario: 场景化描述，16-48字，必须含"我/同学/考前/练习时/上次/考场"等场景化第一人称词
- steps: 3-5个具体步骤/要点，每个6-36字，必须以动词或法语短语开头，禁止以"使用时"开头
- french_example: 一个具体法语例子（fr 5-15 词）+ 中文翻译（zh 4-40字）
- cta: 行动号召，4-16字

清单体字段示例（仅学结构，禁止抄字面，必须结合本选题内容写）：
{"template":"list","hook":"[数字+反差/痛点，8-25字]","scenario":"[第一人称+具体场景，16-48字]","steps":["[动词或法语短语开头+具体内容，6-36字]","[第2条]","[第3条]"],"french_example":{"fr":"[与本选题相关的法语例子，5-15词]","zh":"[中文翻译，4-40字]"},"cta":"[行动号召，4-16字]"}`;

// story 模板（故事体）：痛点前置、个人经历
const CAPTION_STORY_PROMPT = `本篇用【故事体 story】caption_parts 字段（强制，缺一不可）：
- hook: 反思/提炼句，8-22字，从故事里提取一句结论（不要重复 scenario 类的开头）
- story: 第一人称真实故事，60-120字，必须含具体时间/场景。**禁用"上次模考"作为故事开头**（之前 45% 的 story 都用这个，机械感强）。改用其他场景：昨晚练习、上周写真题、备考初期、写完复盘时、考前一周、刚交卷、看范文时、整理错题时、和同学讨论时、考前一晚等。
- takeaways: 2-3 个具体行动点，每个8-24字，必须以动词开头，禁止抽象总结（如"按部就班"）
- french_example: 一个具体法语例子（fr 5-15 词）+ 中文翻译（zh 4-40字）
- cta: 行动号召，4-16字

故事体字段示例（仅学结构，禁止抄字面，必须结合本选题内容写）：
{"template":"story","hook":"[从故事里提取一句结论，8-22字]","story":"[第一人称+具体时间/场景+真实细节，60-120字]","takeaways":["[动词开头+具体行动，8-24字]","[第2条]"],"french_example":{"fr":"[与本选题相关的法语例子，5-15词]","zh":"[中文翻译，4-40字]"},"cta":"[行动号召，4-16字]"}`;

// contrast 模板（对比体）：错误 vs 正确
const CAPTION_CONTRAST_PROMPT = `本篇用【对比体 contrast】caption_parts 字段（强制，缺一不可）：
- hook: 直接抛出对比主题，8-22字。可以是问句、陈述或反问，但必须自然口语化
  · ✅ 好的 hook 结构：[痛点现象] + [可能原因/反差]（如"分数卡住+可能因为X"、"丢分+往往不在Y"、"背的X+考场用不上"），结合本选题写
  · ❌ 禁用句式（命中 AI 套话检测，会让笔记被算法降权）：
    - "不是X，而是Y" / "不是X而是Y"
    - "别只看X，更要看Y" / "不能只看X，更要看Y"
    - "不在于X，而在于Y"
    - 任何含"问题出在"、"综上所述"、"总的来说"的句式
- wrong: 常见错误做法，20-50字，描述一个具体的、考生真的会犯的错（不要写"很多同学都会犯"这种空话）
- right: 正确做法，20-50字，给出具体可执行的替代方案
- transitions: 2-3 个关键差别点，每个6-24字，必须以动词或对比连词开头
- french_example: 一个具体法语例子（fr 5-15 词）+ 中文翻译（zh 4-40字）
- cta: 行动号召，4-16字

对比体字段示例（仅学结构，禁止抄字面，必须结合本选题内容写）：
{"template":"contrast","hook":"[痛点+可能原因，8-22字]","wrong":"[具体错误做法，20-50字]","right":"[具体正确做法，20-50字]","transitions":["[动词/对比连词开头+差别点，6-24字]","[第2条]"],"french_example":{"fr":"[与本选题相关的法语例子，5-15词]","zh":"[中文翻译，4-40字]"},"cta":"[行动号召，4-16字]"}`;

function getCaptionTemplatePrompt(template: 'list' | 'story' | 'contrast'): string {
  if (template === 'story') return CAPTION_STORY_PROMPT;
  if (template === 'contrast') return CAPTION_CONTRAST_PROMPT;
  return CAPTION_LIST_PROMPT;
}

// output_schema：不同模板对应不同字段 shape。
const CAPTION_LIST_SCHEMA = {
  hook: '一句话钩子，8-25字，含数字或反差句式',
  scenario: '场景化描述，16-48字，含"我/同学/考前/练习时"',
  steps: ['具体步骤1', '具体步骤2', '具体步骤3'],
  french_example: { fr: '法语原句 5-15 词', zh: '中文翻译 4-40字' },
  cta: '行动号召 4-16字',
};

const CAPTION_STORY_SCHEMA = {
  hook: '反思句，8-22字，从故事里提炼',
  story: '第一人称故事 60-120字，含具体时间场景',
  takeaways: ['行动点1', '行动点2'],
  french_example: { fr: '法语原句 5-15 词', zh: '中文翻译 4-40字' },
  cta: '行动号召 4-16字',
};

const CAPTION_CONTRAST_SCHEMA = {
  hook: '对比主题句 8-22字，禁用"不是X而是Y"和"别只看X更要看Y"',
  wrong: '错误做法 20-50字',
  right: '正确做法 20-50字',
  transitions: ['差别点1', '差别点2'],
  french_example: { fr: '法语原句 5-15 词', zh: '中文翻译 4-40字' },
  cta: '行动号召 4-16字',
};

function getCaptionSchemaShape(template: 'list' | 'story' | 'contrast') {
  if (template === 'story') return CAPTION_STORY_SCHEMA;
  if (template === 'contrast') return CAPTION_CONTRAST_SCHEMA;
  return CAPTION_LIST_SCHEMA;
}

function generateEditorialOutput(input: ComposeDraftInput, context: {
  brief: UnifiedContentBrief;
  selectedTitle: string;
  cover: NormalizedCover;
  viralRefs?: ViralNote[];
  recentTagCounts?: Map<string, number>;
  recentPageTitles?: string[];
  narrativeSkeleton?: { id: string; spec: string };
  recentCaptionEndings?: string[];
}) {
  const profile = getProductPromptProfile(input.productId);
  const seoKeywords = buildSeoKeywords(input.productId, input.topic);
  const templatePrompt = getCoverTemplatePrompt(input.card.renderer_id);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const examFactRules = getExamFactRules(input.productId);
  const useSchema = captionSchemaEnabled();
  const viralRefs = context.viralRefs || [];
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        // 静态段前置以命中 prompt cache；动态 templatePrompt 移到最后。
        '你是资深小红书法语内容编辑。选题、人群、场景、痛点和内容承诺已经锁定，不能另起主题。只返回JSON。',
        '生成4-6张真正给用户看的内页，以及一篇可直接发布的正文。内页不是把正文切片粘贴。',
        '每张内页必须有具体知识、例子、对照、步骤或练习；禁止写幕后设计意图。',
        // 内页标题跨 job 去重：通用收尾页（复盘/自查/怎么用）LLM 会反复写同一
        // 个标题（batch_1786754651839："常见错误这样检查"×3、"写完之后这样复盘"×3）。
        // 喂回近期已用标题，要求写贴本篇主题的具体标题。
        context.recentPageTitles && context.recentPageTitles.length
          ? `recent_page_titles 列出近期笔记已用过的内页标题：禁止逐字重复、禁止只换个名词的同款改写。尤其收尾页（复盘/自查/考场调用/怎么用）不许写成万能标题（"写完之后这样复盘""常见错误这样检查"这类），必须带上本篇的具体主题词。`
          : '',
        // 页型单调实测（batch_1786754651839：15 篇里 5 篇 6 页全是 knowledge_list）：
        // 整篇一个版式读起来像同一页复制 6 遍。要求至少混排 3 种页型。
        'page_type 混排硬要求：整篇内页至少覆盖 3 种不同 page_type（knowledge_list/example_explain/wrong_right/steps 任选组合，product_bridge 收尾）；禁止全部页都写 knowledge_list——有例子就写 example_explain，有对错对照就写 wrong_right，有动作序列就写 steps。',
        useSchema
          ? `正文按 caption_parts 字段结构化输出（模板由系统按本篇 seed 强制指定），由系统拼装成最终长文；字段约束见下。template 字段必须等于系统指定的值，不得自由切换。`
          : '正文280-420个中文字符，分成4-6个短段、每段约60-90字，每段写满具体内容；正文独立承载使用方法、关键提醒和自然商品承接，不是图片的附注，禁止只写两三句就收尾。',
        // 叙事骨架由系统按 seed 指定（user 消息里 narrative_skeleton 字段）。
        // viral_references 的爆款全是失败复盘型，不指定的话整批 caption 都是
        // 同一个"我以前惨→现在好"骨架（11 篇模拟实测 8/11）。
        'narrative_skeleton 是系统为本篇指定的叙事骨架，开头、行文推进方式和结尾都必须按它写，不得更换；骨架与爆款参考的节奏冲突时以骨架为准。',
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
        // tag 撞款根治：身份大词（#DELFB2 #法语写作 这类）以前篇篇都出现，
        // 整个账号的 tag 像复读机。大词只留 2 个做定位，其余从验证词池组合。
        // 旧版规则"从内页知识点提炼具体 tag"实测教 LLM 发明没人搜的描述型
        // 短语（#审题草稿技巧 #正文控时方法）——tag 没人搜就没有流量，
        // 改成只能从 validated_search_keywords 池组合（确定性检查同步拦截）。
        'tag 硬规则：总共 6-10 个。身份大词（商品名/考试名/“法语写作”这类泛身份词）最多 2 个；其中 2 个必须直接取自本篇正文/封面真实出现的内容词（知识点、题型、场景词——本篇讲什么就写什么词，不得发明本篇没有讲的词）；其余从 user 消息的 validated_search_keywords 池里选词、与身份词组合成复合 tag（组合结构 = 身份词/科目词 + 池内搜索词，本篇讲什么就从池里挑最贴近的词）。禁止自创内容描述型短语当 tag——像小标题、像方法论归纳、四个字以上但不是搜索词的（没人会搜）一律不写。程序会剥掉身份词根校验剩余锚词是否命中搜索词池，不命中的 tag 直接丢弃。overused_tags 列出近期已过度使用的 tag，这些最多保留 1 个。',
        // schema 模式下，AI 套话被字段结构消除，不再需要 prompt 黑名单。
        useSchema ? '' : '禁止以下AI套话（出现即判低质）：1）“不是X而是Y”“不在于X而在于Y”；2）“问题出在”“的关键是”“问题的关键”；3）“很多备考同学都会遇到”“很多同学”；4）递进空话“不仅仅是X，更是Y”“X让Y更Z”“X让Y不再Z”；5）翻译腔“在X的过程中”；6）结论空话“X才是关键/核心/根本”“重要性不言而喻”“通过X才能Y”“X是一个需要Y的过程”；7）议论文标志“综上所述”“总而言之”“总的来说”“首先……其次……最后”；8）句首“其实，”开头的让步句。',
        profile.editorialScopePrompt,
        '内页要承接封面未展开的信息：短条目在封面，完整解释、例句、对照、使用条件和练习进入内页。内页顺序应形成”看懂主题→获得方法→看到例子→能够自查→自然了解商品”的阅读链。',
        // 带货规格：之前只有禁令（禁库存说明、禁归属声明），LLM 学到的最安全做法
        // 是干脆不提商品 → 39 篇里只有 13 篇提到。禁令保留但精确化，同时给出
        // 正向规格：承接句必须写，且必须给购买理由，CTA 只用评论区/下方链接。
        '商品承接（带货硬要求）：正文最后一段必须有一句承接句，包含三个要素——指明这份资料/清单是什么（能力用 locked_brief.selling_point，商品事实只能来自证据）、一个购买理由、CTA。句式由本篇叙事骨架决定：直给清单可以直接说"资料在下方链接"，误区纠偏可以从"别再按老办法"过渡，场景时间线可以落在"进考场前过一遍"。承接句的开头和收尾都不许和 recent_caption_endings 里出现过的写法雷同（同一种 CTA 收尾连用两篇就是复读）——同一批笔记连着发，结尾句式一样就像复读机。购买理由必须贴着本篇内容写：本篇讲时间分配就写省时，讲语气就写改语气不用再猜，讲题型识别就写30秒定文体——禁止写"冲刺期不用东拼西凑"这种放任何一篇都成立的通用理由。CTA 只允许两种写法：“评论区”互动式或“点下方链接”直给式，二选一。禁止的是清单式库存说明（“资料里有/包含/收录N个模块”），不是禁止提商品；承接句要像真人顺口一提，不要写成广告段。',
        // 爆款模仿：用户消息里 viral_references 是 2 篇真实爆款正文开头。
        // 学开头的节奏（第一人称 + 具体场景 + 自然自嘲），不要写成”考前冲刺时”这种硬前缀。
        // 不要照抄爆款的具体内容（爆款讲的可能不是 DELF）。
        buildImitationPromptText('first_editorial'),
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
        // 近期 tag 使用频率（近14天）：高频出现的 tag 本篇最多保留 1 个。
        overused_tags: context.recentTagCounts
          ? Array.from(context.recentTagCounts.entries())
            .filter(([, count]) => count >= 3)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag, count]) => `${tag}(近${count}篇)`)
          : [],
        // 近期已用内页标题（原文，最近 60 条）：逐字重复即撞款。
        recent_page_titles: context.recentPageTitles
          ? Array.from(new Set(context.recentPageTitles)).slice(-60)
          : [],
        // 本篇叙事骨架（系统按 seed 指定，LLM 不得更换）。
        narrative_skeleton: context.narrativeSkeleton || undefined,
        // 近期正文结尾句（原文，最近 30 条）：承接句写法不得与这些雷同。
        recent_caption_endings: context.recentCaptionEndings
          ? Array.from(new Set(context.recentCaptionEndings)).slice(-30)
          : [],
        // 爆款模仿：2 篇真实爆款正文开头。
        // 学的是"第一人称/具体场景/自然自嘲"的节奏，不是抄具体内容。
        viral_references: viralRefs.map(n => ({
          track: n.track,
          collected: n.collected,
          title: n.title,
          caption_opening: n.caption_opening,
          cover_type: n.cover_type,
        })),
        output_schema: useSchema ? {
          inner_pages: [{
            page_no: 2,
            page_type: 'knowledge_list|example_explain|wrong_right|steps|product_bridge',
            page_title: '', lead: '', bullets: [], source_ids: [],
          }],
          caption_parts: { template: 'list' },
          tags: ['#法语学习'],
        } : {
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

function selectBestTitlePerType(candidates: TitleCandidate[], seedContext?: { seedId?: string; productId?: ProductId; recentSelectedTitles?: Set<string>; recentAllCandidates?: Set<string>; recentTitleTemplates?: Map<string, number> }) {
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
      .sort((a, b) => titleImpactScore(b.title, seedContext) - titleImpactScore(a.title, seedContext))[0];
    if (best && !selected.some(item => item.title === best.title)) selected.push(best);
  }
  const remaining = candidates
    .filter(item => !selected.some(selectedItem => selectedItem.title === item.title))
    .sort((a, b) => titleImpactScore(b.title, seedContext) - titleImpactScore(a.title, seedContext));
  return [...selected, ...remaining].slice(0, 5);
}

function normalizePages(value: unknown, styleSeed?: string): GeneratedInnerPage[] {
  if (!Array.isArray(value)) return [];
  const STYLES: NonNullable<GeneratedInnerPage['style_variant']>[] = [
    'lined-notebook', 'grid-notebook', 'dot-notebook',
    'sticky-note', 'draft-paper', 'loose-leaf', 'kraft-paper',
  ];
  return value.map((item, index) => {
    const input = asRecord(item);
    const validTypes = ['knowledge_list', 'example_explain', 'wrong_right', 'steps', 'product_bridge'];
    const pageType = asString(input.page_type);
    const normalizedPageType = (validTypes.includes(pageType) ? pageType : 'knowledge_list') as GeneratedInnerPage['page_type'];
    const rawBullets = Array.isArray(input.bullets)
      ? dedupeBullets(input.bullets.map(item => scrubCheapClaims(normalizeBulletText(sanitizePublicText(asString(item))))).filter(Boolean)).slice(0, 7)
      : [];
    const pageNo = Number(input.page_no) || index + 2;
    // job 级统一一种笔记本样式：seed = cardId|topicId，同一封面任务内所有页共用一种，
    // 不同 job 之间分布不同。重跑稳定。
    const style_variant = styleSeed
      ? STYLES[stableHash(styleSeed) % STYLES.length]
      : undefined;
    return {
      page_no: pageNo,
      page_type: normalizedPageType,
      page_title: normalizeInnerPageTitle(scrubCheapClaims(sanitizePublicText(asString(input.page_title))), index),
      lead: clip(scrubCheapClaims(sanitizePublicText(asString(input.lead))), 90),
      bullets: normalizePageBullets(normalizedPageType, rawBullets),
      source_ids: Array.isArray(input.source_ids) ? input.source_ids.map(asString).filter(Boolean).slice(0, 10) : [],
      ...(style_variant ? { style_variant } : {}),
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
    // 前面带数字/数词的"秒判"（三十秒判对文体 / 30秒判断）是正常中文，别改写
    .replace(/(?<![零一二两三四五六七八九十百千0-9〇])秒判/g, '快速判断')
    .replace(/严重影响得分/g, '明显影响表达')
    .replace(/导致低分/g, '让表达不稳')
    .replace(/换主题词就能/g, '换主题后重写语境再')
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

function ensureCoreKeywordOpening(caption: string, keyword?: string, seed?: string) {
  // 之前会在 caption 开头硬塞 "DELF B2备考时，" / "考前冲刺时，" 等 4 种前缀，
  // 导致两个问题：
  //   1. 15 篇 caption 开头 100% 一样（AI-味重）
  //   2. 当 LLM 已经写了 "考前冲刺时，..." 时，hash 又选中 "考前冲刺时，" 前缀，
  //      产生 "考前冲刺时，考前冲刺时，昨晚练真题..." 这种重复
  // 现在改成完全信任 LLM 的开头。SEO 关键词靠：
  //   - 2nd AI call system prompt 强制正文前 80 字嵌入核心词（已存在）
  //   - viral_references 教 LLM 用自然第一人称开头
  // 不再用机械前缀。
  return caption;
}

function ensurePublishableCaption(
  caption: string,
  keyword: string | undefined,
  cover: ReturnType<typeof normalizeDenseDirectoryCover>,
  seed?: string,
) {
  const captionWithoutInlineTags = caption.replace(/#[\s\S]*$/, '').trim();
  let result = ensureCoreKeywordOpening(captionWithoutInlineTags || caption, keyword, seed)
    .replace(/on换成nous/g, '泛指 on 要看语境')
    .replace(/全程用vous/g, '称呼保持一致')
    .replace(/帮助你在练习中精准自查，高效提分/g, '帮助你在练习中更有方向地复盘')
    .replace(/帮助你精准自查，高效提分/g, '帮助你更有方向地复盘')
    .replace(/高效提分/g, '更有针对性地复盘');
  // 之前在 caption 偏短时会硬塞模板化尾句凑长度——这违反"删模板"原则。
  // 现在完全交给 LLM：prompt 要求 280-420 字，长度不达标就走 caption_length_invalid
  // 让质检触发 retry，而不是用模板尾句污染 caption。
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
  cardId: string;
  topicId: string;
  attempt?: number;
}) {
  const profile = getProductPromptProfile(input.brief.product_id);
  const examFactRules = getExamFactRules(input.brief.product_id);
  const useSchema = captionSchemaEnabled();
  // 返修阶段重新挑爆款（带 -repair-N 后缀），避免 LLM 被首次生成时看到的爆款锚定。
  // 之前返修没塞 viral_references，LLM 只能凭禁令改 → 越改越像议论文。
  const repairRefs = pickImitationRefsForStage('repair_editorial', {
    productId: input.brief.product_id,
    cardId: input.cardId,
    topicId: input.topicId,
    attempt: input.attempt,
  });
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书法语内容总编。完整重写未过质检的内页和正文，只返回JSON，不能改变锁定主题。',
        '必须完整返回4-6张内页，每页标题8-22字、引导语和4-7条具体内容；不得输出半句话。',
        useSchema
          ? `正文按 caption_parts 字段结构化输出（template=list，不得切换），由系统拼装。`
          : '必须完整返回280-420个中文字符的正文（分4-6个短段、每段约60-90字，不足280字按未完成处理）和5-8个标签。正文开头直接进入具体问题，不能虚构作者个人考试经历。',
        useSchema ? CAPTION_SCHEMA_COMMON_RULES : '',
        '逐条核对法语语法、搭配、语域和适用场景；不得把学习建议写成官方硬规则。',
        profile.editorialScopePrompt,
        '禁止把不同主题的名词做机械一对一替换；主题迁移必须重写语义完整、符合新语境的例句。',
        examFactRules,
        '核心搜索词必须出现在正文前80字，其他关键词自然出现，不得堆砌。',
        'AI补充知识可以直接正常讲解，但公开文案不得讨论它是否收录在商品中；禁止“商品里有/没有、资料中包含/未收录”等句式。',
        '商品承接不要写“我的/我们的资料里有、资料提供、内容来自资料”等库存说明；数量只可使用证据中原样存在的数字。',
        // 带货承接（返修侧同款正向规格）：failed_checks 里出现
        // caption_product_bridge_missing 时按此补写承接句。
        '带货承接硬要求：正文最后一段必须有一句承接句 = 我把它整理成了什么（selling_point 能力，商品事实来自证据）+ 一个购买理由（必须贴本篇内容：讲什么考点就说拿它解决什么）+ CTA（只允许“评论区”或“点下方链接”两种写法）。禁库存说明和通用理由。',
        // 风格腔调黑名单（营销腔），效果承诺类已按用户 2026-08-16 拍板撤销。
        '禁止万能、必背、捷径、阅卷老师看重、百分比、考官追着给分；禁止幕后设计说明和"不是……而是……"套话。',
        // AI cliché 黑名单（命中即 block，重写时必须避开）。
        // 这些句式是 LLM 议论文/总结体标志，会让笔记读起来像机器写的。
        'AI套话硬禁令（命中即判低质，必须换说法）：1）"不是X而是Y""不在于X而在于Y"；2）"问题出在""问题的关键"；3）"不仅仅是X，更是Y"递进空话；4）"在X的过程中"翻译腔；5）"X才是关键/核心/根本"结论空话（如"短句互动才是自然的关键"→改成"短句互动直接影响语气是否自然"）；6）"通过X，才能Y"条件空话；7）"X让Y不再Z"焦虑式；8）"重要性不言而喻"循环定义；9）"X是一个需要Y的过程"循环定义；10）"综上所述""总而言之""总的来说"议论文尾段；11）"首先，…其次，…最后，…"议论文中段。',
        '禁止把不同语义的法语表达写成机械替换，例如“用 bien que 代替 mais”“用 en revanche 代替 mais”。必须说明各自适用语义。禁止把建议写成“严禁/必须”的官方规则。',
        'Et、mais、parce que、on、je pense que、beaucoup de、gens本身是中性常用表达，不得标成口语、非正式或错误；只能说明不同表达的语义、位置和语域差异。Cordialement不得写成所有正式信的最低标准。',
        // 返修模仿指令：塞爆款给 LLM 参考，让"重写"有具体方向，而不只是看禁令。
        buildImitationPromptText('repair_editorial'),
      ].filter(Boolean).join('\n'),
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
        // 返修模仿：跟首次生成用不同的两条爆款（seed 后缀不同），让 LLM 看到新参照。
        viral_references: repairRefs.map(n => ({
          track: n.track,
          collected: n.collected,
          title: n.title,
          caption_opening: n.caption_opening,
          cover_type: n.cover_type,
        })),
        required_output: useSchema ? {
          inner_pages: [{ page_no: 2, page_type: 'knowledge_list', page_title: '', lead: '', bullets: ['', '', '', ''], source_ids: [] }],
          caption_parts: { template: 'list' },
          tags: ['#法语学习'],
        } : {
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
  cardId: string;
  topicId: string;
  attempt?: number;
}) {
  const spec = getCoverTemplateSpec(input.renderer);
  if (!spec) throw new Error('封面模板规格不存在');
  const currentCounts = input.cover.sections.map(section => section.items.length);
  const currentTotal = currentCounts.reduce((sum, count) => sum + count, 0);
  const capacityHint = (input.issues.includes('cover_section_severely_low')
    || input.issues.includes('cover_density_severely_low')
    || input.issues.includes('cover_section_count_invalid'))
    ? `当前每组条目数为[${currentCounts.join(',')}]，共${input.cover.sections.length}组、${currentTotal}条，这不符合要求。请严格输出恰好${spec.sectionCount}组，每组恰好${spec.itemsPerSection}条（允许±1条误差），总条目不少于${spec.minTotalItems}条；宁可每组多写1-2条平淡但真实的短条目，也不能少于下限。`
    : '';
  const frenchOnlyHint = spec.primaryFrenchOnly
    ? '本模板每条 primary 只能是纯法语词、搭配或短表达，primary 里禁止出现任何汉字。"让备考者一眼看懂"由 secondary 承担：中文释义全部写进 secondary。返修时把 primary 里的中文（含"1. 名词阴阳性"这类编号知识点）改成纯法语条目或移到 secondary。'
    : '';
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const profile = getProductPromptProfile(input.productId);
  const examFactRules = getExamFactRules(input.productId);
  // 返修重挑爆款（带 -repair-N 后缀），让 LLM 看新参考，避免被首次版本锚定。
  const repairRefs = pickImitationRefsForStage('repair_core', {
    productId: input.productId,
    cardId: input.cardId,
    topicId: input.topicId,
    attempt: input.attempt,
  });
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书内容总编，负责定向修复未过质检的标题和封面数据。只返回JSON，不改变锁定选题。',
        '完整重写标题和封面，不能只返回修改的局部。',
        '75个公式只用于笔记文字标题且只是灵感库，不是硬模板。公式仿写候选的formula_id原样返回；自然原创或竞品机制迁移候选允许formula_id写free_original或reference_migration。',
        '必须返回5个20字以内的笔记文字标题；这里的“字”按小红书肉眼字数算，汉字、英文字母、数字、空格、全角/半角标点都各算1个字。标题通常14-18字，少于13字会显得信息量不足，除非钩子极强；宁可14-18字完整，不要20字卡边断尾。',
        'title_type分别为资料型、解释型、强钩子型、情绪型、结果型；至少包含1个自然原创、1个公式仿写、1个竞品机制迁移，且心理触发不同。至少3个标题要有明显点击钩子：恐惧、好奇、反常识、场景代入、结果承诺或数字锚点。',
        '标题允许适度使用“大全、必背、万能、考官、稳过、7天、提分”等强钩子词，但不能冒充官方授权或内部押题；标题钩子必须能被本篇封面和正文降落。',
        '平淡的知识点名称、资料说明和内部任务名必须重写。标题要像人会点的小红书笔记。',
        '标题写“陷阱/错误/避坑”时正文必须真有对应错误；写“模板/范文”时本篇必须真提供模板或完整范文。禁止为了蹭搜索词改变内容类型。',
        titleKeywords.length
          ? `笔记文字标题应贴合小红书真实搜索流量。validated_search_keywords（${titleKeywords.join('、')}）均经过下拉联想验证，每个标题最多自然嵌入 1 个高频词，禁止堆砌；与选题无关就别硬塞。`
          : '',
        `每个标题和封面主标题必须清楚出现“${profile.noteIdentity}”对应身份，且不得出现另一商品考试名称。`,
        getCoverTemplatePrompt(input.renderer),
        capacityHint,
        frenchOnlyHint,
        `primary视觉长度不得超过${spec.maxPrimaryVisualLength}，secondary视觉长度不得超过${spec.maxSecondaryVisualLength}；长解释和完整例句移到内页。`,
        '每条必须让普通中国备考者一眼看懂，法语术语配简短中文释义；禁止冗长的是非问句和无解释的内部速记。',
        '法语和备考规则必须准确，禁止把建议写成官方硬规则。',
        '禁止自创“至少N个B2词汇、虚拟式、连接词”等数量门槛；虚拟式只在语义需要时使用。',
        examFactRules,
        '禁止用“严禁/必须”把学习建议包装成官方规则。',
        '不同法语结构不能机械互换。禁止“用 bien que 代替 mais”“用 en revanche 代替 mais”一类写法，必须解释语义和使用条件。',
        'Et、mais、parce que、on、je pense que、beaucoup de、gens本身是中性常用表达，不得标成口语、非正式或错误；两个正确表达只能按语义、语气和场景对比。Cordialement不得写成所有正式信的最低标准。',
        profile.contentScopePrompt,
        '封面标题或副标题若写具体数量（N句/个/条/项），N必须等于封面实际条目总数；写N类/组时必须等于分组数。',
        '用户可见文字不能出现内部ID。',
        '公开文案不要写“商品里有/没有、资料中包含/未收录”等库存关系句。AI补充内容正常讲知识即可；商品承接只使用证据明确支持的能力和适用场景。',
        // 返修模仿：塞爆款让"重写"有具体方向，而不只是看禁令改。
        buildImitationPromptText('repair_core'),
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
        // 返修模仿：跟首次不同的爆款（seed 后缀不同），让 LLM 看到新参照。
        viral_references: repairRefs.map(n => ({
          track: n.track,
          collected: n.collected,
          title: n.title,
          caption_opening: n.caption_opening,
          cover_type: n.cover_type,
        })),
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

function chooseSafeTitle(value: unknown, candidates: TitleCandidate[], fallback: string, context = fallback, productId?: ProductId, seedId?: string, recentSelectedTitles?: Set<string>, recentAllCandidates?: Set<string>, recentTitleTemplates?: Map<string, number>) {
  const proposed = sanitizeTitleLikeText(asString(value));
  const seedContext = { seedId, productId, recentSelectedTitles, recentAllCandidates, recentTitleTemplates };
  const baseSafe = candidates
    // 完整性硬过滤：残句标题（clip 切半/LLM 半截话）永远不进候选——选中残句
    // 会触发 needsTitleRewrite 二次调用，等于自己造问题自己烧钱修。
    .filter(item => isNaturalTitle(item.title) && !isWeakCommercialTitle(item.title) && isCompleteTitle(item.title, 'text'))
    .sort((a, b) => titleSelectionScore(b.title, context, seedContext) - titleSelectionScore(a.title, context, seedContext));
  // 锚定硬过滤：seed 配了关键词时，未锚定标题只有在全池都未锚定时才允许兜底。
  // 之前只靠 titleImpactScore -8 软扣——兜底公式候选全员未锚定时照样烂里挑烂，
  // 实测论坛语气笔记选中了"任务识别"标题（agent2 job_001）。
  const anchoredSafe = seedId ? baseSafe.filter(item => isTitleAnchoredToSeed(item.title, seedId)) : baseSafe;
  const safeCandidates = anchoredSafe.length ? anchoredSafe : baseSafe;
  const proposedCandidate = safeCandidates.find(item => item.title === proposed);
  return ensureTextTitleDisplayIdentity(
    proposedCandidate?.title || safeCandidates[0]?.title || candidates.find(item => isCompleteTitle(item.title, 'text'))?.title || fallback,
    productId,
  );
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
  recentTitleFingerprints?: RecentTitleFingerprints;
}): Promise<{
  titleCandidates: TitleCandidate[];
  selectedTitle: string;
  cover: NormalizedCover;
  coverTitleCandidates: CoverTitleCandidate[];
}> {
  const first = await callTitleEditor(input, false);
  let polished = normalizeTitleEditorResult(first, input);
  if (needsTitleRewrite(
    polished.titleCandidates,
    polished.selectedTitle,
    polished.cover.title,
    {
      seedId: input.topic.seed_id,
      productId: input.productId,
      recentSelectedTitles: input.recentTitleFingerprints?.selectedTitles,
      recentAllCandidates: input.recentTitleFingerprints?.allCandidates,
      recentTitleTemplates: input.recentTitleFingerprints?.selectedTitleTemplates,
    },
  )) {
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
  recentTitleFingerprints?: RecentTitleFingerprints;
}, rewrite: boolean) {
  const profile = getProductPromptProfile(input.productId);
  const spec = getCoverTemplateSpec(input.card.renderer_id);
  const titleKeywords = getTitleReferenceKeywords(input.productId);
  const avoidedKeywords = getAvoidedLowTrafficKeywords(input.productId);
  // 之前会按 seed 的 title_trigger_types 预筛 6 个 75 公式喂给 LLM 套用。
  // 这导致 LLM 写出来的标题都按固定模板拼，2/2 都套到 emotion_choice。
  // 删除：让 LLM 看 viral_references 的真实爆款标题自由起，不再套公式。
  const formulaSeed = `${input.card.id}|${input.topic.seed_id || input.topic.id}`;
  // polish 阶段也算返修（第二次 rewrite=true 时尤其需要新参考）。
  // 选不同爆款让 LLM 不被首次的标题锚定。
  const titleRefs = pickImitationRefsForStage('repair_title', {
    productId: input.productId,
    cardId: input.card.id,
    topicId: input.topic.id,
    attempt: rewrite ? 2 : 1,
  });
  const seedTopicKeywords = input.topic.seed_id
    ? getSeedTopicKeywords(input.topic.seed_id)
    : [];
  // 封面标题示例池已删除：之前 18 个固定示例 → LLM 抄示例（"B2写作总差一点先看"
  // 被 3 个不同 seed 的 job 抄成"B2写作总差一点"），跟"上次模考"是同一种 bug。
  // 改成只描述钩子结构（不写具体标题），强制 LLM 看 viral_references 里 2 篇爆款
  // 的真实 title 字段学钩子，每次拿不同爆款 → 不会撞款。
  // 注意：这里只描述钩子的"结构"，不写任何可抄的字面标题片段——LLM 会照抄
  // 示例再换个数字（"先查这5项"→"先查这9项"），就是跨 job 撞款的源头。
  const coverHookStructures = [
    '人群或场景前置型：把有具体痛点的人群放在标题最前面',
    '动作+后果型：某种常见做法 → 它造成的具体损失',
    '反差或数字锚点型：预期与实际的反差，或用具体数字制造可信度',
    '损失感+检查动作型：先点出损失，再给一个马上能做的检查动作',
    '认知冲突型：大家普遍以为的 vs 实际上的',
  ];
  const seedCoverExamples = pickBySeedN(coverHookStructures, `${formulaSeed}-cover-ex`, 3);
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
        // 删除固定文字示例（"B2写作总差一点先看"等），改成钩子结构描述 + 强制看爆款。
        // 之前 LLM 抄 prompt 示例 → 跨 job 撞款。改后必须看 viral_references 字段学钩子。
        `封面标题可学的钩子结构（不要照抄字面，结合本选题内容写）：${seedCoverExamples.join('；')}。`,
        '参考 viral_references 里 2 篇爆款的真实 title 字段，学它们的钩子切入角度和句子节奏。每篇爆款的标题都不一样，你也不要套用任何固定标题模板，更不要照抄爆款原话。',
        '文字标题比封面标题更完整：必须像用户会点开的笔记标题，而不是图片上的大字。可以包含搜索词、完整钩子和具体承接。',
        '文字标题参考 viral_references 里 2 篇爆款的 title 字段，学钩子结构（反差/数字/痛点前置/具体场景），但必须用本选题的 DELF/法语内容，不要抄爆款的具体话题。',
        '标题不是概括内容，而是制造点击理由。先选心理钩子，再写标题。',
        '可用钩子：恐惧损失、好奇缺口、认知冲突、场景代入、结果承诺、资料稀缺、大全收藏、时效更新。',
        '每个文字标题至少命中 2 个张力点：具体人群/场景、真实痛点、悬念缺口、反常识、损失感、数字锚点、搜索关键词。',
        '不要为了不超20字写成10字左右的短标题；标题要尽量写到14-18字，把对象、场景、痛点、结果说清楚。禁止结尾悬空，如“别再只盯语”“问题出在”“格式不”“这5个常”“早该”“每”“哪科最”。',
        '尽量覆盖资料型/解释型/强钩子型/情绪型/结果型这 5 种类型；同一类型可以多写一个强候选，让程序从强候选里选最好的。',
        '句式硬限制（程序会按句式指纹扣分）：候选池里带问号的疑问句式最多 2 条；“救命”“为什么”“别再”开头或包含的情绪/命令/设问句式各自最多 1 条；其余必须是陈述句。历史已用过的句式再出现会被直接排到末尾。',
        '必须先把普通标题爆改，不要直接写说明书式标题。禁止平淡如“资料整理好了”“怎么准备”“知识点清单”。',
        '允许适度使用资料强度词：大全、必背、考官视角、7天、最后检查；但救命/别再这类呼喊式开头已经严重过量，不要再产出，也不要冒充官方授权、内部押题或真实保证。',
        `身份词硬约束：每个文字标题（含候选池）必须自然包含“${profile.noteIdentity}”或“${profile.shortIdentity}”。变体如“B2写作”“TEF写作”也接受，但不允许只写“B2”漏掉“写作”、或只写“TEF”漏掉写作/口语/听力等具体科目。违反此规则的候选会被直接丢弃，不要再生成。`,
        seedTopicKeywords.length
          ? `主题锚定硬约束（seed_topic_anchor）：本篇选题的关键词集是 [${seedTopicKeywords.join('、')}]。每个文字标题候选必须命中其中至少 1 个关键词，否则视为离题、会被丢弃。封面标题不强制，但命中会更稳。不要写与本 seed 无关的通用鸡汤标题。`
          : '',
        '允许两种 formula_id：free_original（自由发挥，必须说明思路）和 reference_migration（迁移爆款封面机制）。每个候选必须给出 formula_id。不要再套固定模板公式——直接看 current_titles 和爆款参考写自然中文标题。',
        // AI 味 vs 真人话对照：删掉 5 个固定标题对照（"B2模板背了用不上？"等都会被 LLM 抄），
        // 改成纯结构差异描述。学语感节奏但不给可抄的具体标题。
        'AI 味标题特征（要避开）：抽象判断（"正在拖后腿""资料太散"）、说明书式（"写作任务这样区分"）、概括式（"范文太长不看"）。',
        '真人话标题特征（要写出）：具体场景或人群放在句首、带一个具体动作或数字锚点、痛点后面紧跟可执行的检查动作。只描述结构，不要套任何固定句式。',
        '当前封面标题必须匹配当前模板 allowed_cover_title_types；资料目录模板优先资料/大全/稀缺/时效，情绪实拍模板优先情绪/反常识/结果。',
        '如果封面是高密度资料页，封面标题可以资料感更强；如果封面是手写/备忘录/真人经验，封面标题必须更像情绪钩子。',
        '封面标题或副标题写具体数量时，必须和封面实际条目数/分组数一致；不确定就不要写具体数量。',
        '标题必须像中国备考用户自然会说的话，读出声不拗口。',
        '备用封面标题只给标题和副标题，不生成图；它们要按各自模板风格写，方便用户后续换模板。',
        'Candidate-pool rule: return exactly 15 alternatives in text_title_pools, three complete alternatives for each type. Use exact English keys: material, explanation, strong_hook, emotion, result. Do not count on the model to hit the character limit exactly; the program will select valid candidates.',
        // 近期已发布内容（recently_published_digest 字段）是硬约束：撞款候选会被
        // 程序直接丢弃。写之前先对照这份清单自查。
        'recently_published_digest 字段列出近14天已发布的标题和过度使用句式：禁止重复，禁止只换数字或换同义词的近似改写（"先查这9项"→"先查这10项"就是撞款）。',
        'Each alternative must be a different complete sentence, not a shortened or truncated version of another candidate. Aim for 14-18 visible characters; never end mid-phrase.',
        rewrite ? '这是第二次标题返修：上一次仍然太平或错配。请明显加大冲突、损失、反常识或资料稀缺感，但保持和内容一致。' : '',
        // 标题返修模仿：塞爆款让 LLM 学真实点击钩子，不只是凭禁令改。
        buildImitationPromptText('repair_title'),
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: input.productId,
        // 标题返修爆款参考：让 LLM 看真实笔记的标题钩子，避免议论文味。
        viral_references: titleRefs.map(n => ({
          track: n.track,
          collected: n.collected,
          title: n.title,
          cover_type: n.cover_type,
        })),
        product_identity: profile.noteIdentity,
        identity_rule: {
          required: profile.noteIdentity,
          accepted_variants: [profile.shortIdentity],
          rule: `每个标题（文字标题含候选池、封面标题）必须自然包含 "${profile.noteIdentity}" 或 "${profile.shortIdentity}"。变体如"B2写作""TEF写作"也接受，但禁止只写"B2"漏掉"写作"。`,
        },
        seed_topic_anchor: seedTopicKeywords.length
          ? {
              seed_id: input.topic.seed_id,
              required_keywords: seedTopicKeywords,
              rule: '每个文字标题候选必须命中至少 1 个 required_keywords；封面标题建议但非强制。',
            }
          : null,
        // 之前这里喂 allowed_formulas（6 个 75 公式），让 LLM 按公式套标题。
        // 已删除：LLM 看 viral_references 自由起标题，不再套公式。
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
        recently_published_digest: buildRecentTitleDigest(input.recentTitleFingerprints) || undefined,
        validated_search_keywords: titleKeywords,
        title_language_rules: {
          use_human_phrasing: true,
          forbidden_surface_phrases: ['资料太散', '卡住', '拖后腿', '正在白背', '白背', '写作任务', '你的DELF B2格式', '你的DELF B2范文'],
          cover_title_rule: '封面标题先让用户觉得和自己有关，再给资料感或结果感；不要只写资料名。',
          text_title_rule: '文字标题可以更完整，优先 14-20 个可见字，允许搜索词和爆款钩子结合。',
        },
        avoid_low_traffic_keywords: avoidedKeywords,
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
          // 封面字段放最前：2600 token 预算下输出被截断时，排在 schema 尾部的
          // selected_cover_title/alternate_cover_titles 整个丢失 → 15 个 job 里
          // 5 个封面整套掉进本地兜底池（batch_1786754651839）。放前面后，再截
          // 也只会截掉文字标题池的尾巴，封面不再陪葬。
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
        },
      }),
    },
    // 15 条池 + 5 类候选 + 封面标题都带 reason，2600 不够（截断实测砍掉尾部
    // 封面字段）。4200 与其他返修调用对齐。
  ], { maxTokens: 4200, retries: 2, temperature: rewrite ? 0.75 : 0.68 });
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
    recentTitleFingerprints?: RecentTitleFingerprints;
  },
) {
  const record = asRecord(value);
  // 之前会取 seedAnchoredIds 跟 catalog 取并集校验 formula_id 合法性。
  // 已删除：LLM 不再被喂公式集，允许任意 formula_id（实际只剩 free_original / reference_migration）。
  // catalog 路由的 8 个公式仍保留作为兜底合法性集。
  const allowedTitleFormulaIds = new Set(input.allowedTitleFormulas.map(item => item.id));
  const seedContext = {
    seedId: input.topic.seed_id,
    productId: input.productId,
    recentSelectedTitles: input.recentTitleFingerprints?.selectedTitles,
    recentAllCandidates: input.recentTitleFingerprints?.allCandidates,
    recentTitleTemplates: input.recentTitleFingerprints?.selectedTitleTemplates,
  };
  let titleCandidates = normalizeTitles(extractTitleEditorPool(record), allowedTitleFormulaIds, input.productId);
  titleCandidates = filterTitleCandidatesByContent(titleCandidates, input.topic, input.cover);
  titleCandidates = ensureTitleCandidateMix(titleCandidates, input.cover.title, input.topic, input.productId);
  titleCandidates = selectBestTitlePerType(titleCandidates, seedContext);
  let selectedTitle = chooseSafeTitle(
    record.selected_text_title,
    titleCandidates,
    input.cover.title,
    `${input.cover.title} ${input.cover.subtitle} ${input.topic.topic}`,
    input.productId,
    input.topic.seed_id,
    seedContext.recentSelectedTitles,
    seedContext.recentAllCandidates,
    seedContext.recentTitleTemplates,
  );
  let selectedCoverTitle = normalizeCoverTitleCandidate(record.selected_cover_title, input.card.renderer_id, input.productId);
  const fallbackCoverTitle = buildCoverTitleFallback(input.topic, input.productId, input.card.renderer_id, input.cover, input.recentTitleFingerprints?.coverTitles, input.recentTitleFingerprints?.coverSubtitles);
  if (!selectedCoverTitle || isWeakCoverTitle(selectedCoverTitle.title, input.productId)) {
    selectedCoverTitle = fallbackCoverTitle;
  }
  // 封面去重：LLM 重写的 cover.title 若与近期 job 撞款（"B2作文先查这25项"被反复用），
  // 弃用，走 fallback 让 ensureCoverIdentity 兜底。subtitle 撞款就清空，让原始 subtitle 顶上。
  // 同模板去重：cover.title/subtitle 命中模板（如"先查这""别把X丢掉"）已用 ≥2 次 → 同样弃用，
  // 治"sub-title 反复写'别把能拿的分丢掉'"型的隐性复读。
  if (selectedCoverTitle && input.recentTitleFingerprints) {
    const titleTpl = titleTemplateFingerprint(selectedCoverTitle.title);
    const subtitleTpl = selectedCoverTitle.subtitle ? titleTemplateFingerprint(selectedCoverTitle.subtitle) : '';
    const titleTplCount = titleTpl ? (input.recentTitleFingerprints.selectedTitleTemplates.get(titleTpl) || 0) : 0;
    const subtitleTplCount = subtitleTpl ? (input.recentTitleFingerprints.selectedTitleTemplates.get(subtitleTpl) || 0) : 0;
    if (
      input.recentTitleFingerprints.coverTitles.has(fingerprintTitle(selectedCoverTitle.title)) ||
      titleTplCount >= 2
    ) {
      selectedCoverTitle = fallbackCoverTitle;
    } else if (
      selectedCoverTitle.subtitle &&
      (input.recentTitleFingerprints.coverSubtitles.has(fingerprintTitle(selectedCoverTitle.subtitle)) ||
       subtitleTplCount >= 2)
    ) {
      selectedCoverTitle = { ...selectedCoverTitle, subtitle: undefined };
    }
  }
  let cover: NormalizedCover = input.cover;
  if (selectedCoverTitle?.title) {
    cover = {
      ...cover,
      title: selectedCoverTitle.title,
      subtitle: selectedCoverTitle.subtitle || cover.subtitle,
    };
  }
  // polish 阶段 LLM 重写的 cover.title 没过 ensureCoverIdentity，
  // 历史上这里漏过去过大量"忘加 B2 写作身份词"的封面 → product_identity_mismatch。
  // 这里再跑一次：身份词缺失 / 长度越界 / 截断半截 → 回退到 renderer fallback。
  cover = ensureCoverIdentity(cover, input.card.renderer_id, input.productId, input.topic);
  // selectedCoverTitle 同步成 ensureCoverIdentity 之后的最终 title/subtitle，
  // 否则 coverTitleCandidates 里会留着那条没身份词的旧候选。
  if (selectedCoverTitle) {
    selectedCoverTitle = {
      ...selectedCoverTitle,
      title: cover.title,
      subtitle: cover.subtitle,
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
  if (!isCompleteTitle(title, 'cover') || !isCoverTitleLengthOk(spec, title.length)) return undefined;
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

// 兜底标题变体挑选：按 seed+日期轮转，同 seed 不同天拿不同变体；
// 提供近期已用指纹时优先跳过撞款组合。之前每个分支只有 1 条硬编码标题，
// "B2作文先查这9项" 被多个 job 原样拼出——就是跨 batch 撞款的直接来源。
// 兜底标题零件池：标题 = 身份词 × 主题词 × 痛点句式，副标题单独一组。
// 身份词池里每一条都必须满足本商品 requiredIdentityPattern（否则 final_gate
// 直接拦死）；主题词×痛点句式自由拼接，组合数 = 池长相乘，每分支上百种。
// 禁止退回"每分支 3-5 条手写标题"的小 N 写死池——291 条出货里 219 条撞在
// 那种池子上（"B2写作词别硬背"出了 17 次），这是标题重复的第一根源。
interface CoverFallbackParts {
  subjects: string[];
  problems: string[];
  subtitles: string[];
}

const DELF_FALLBACK_IDENTITY = ['DELF B2写作', '法语B2写作', 'B2写作', 'B2作文'];
const TEF_FALLBACK_IDENTITY = ['TEF/TCF', 'TEF/TCF备考', '加拿大法语', 'CLB7'];

const DELF_FALLBACK_BRANCHES: Record<string, CoverFallbackParts> = {
  check: {
    subjects: ['交卷前', '写完', '评分点'],
    problems: ['别急着合笔', '先扫一遍再交', '对照着过完', '还来得及补'],
    subtitles: ['按评分点过完再交卷', '自查走完这一遍再交', '差的那点分就在这步'],
  },
  format: {
    subjects: ['正式信', '论坛稿', '文体', '开头结尾'],
    problems: ['先判对再写', '别混着套', '写错就白练'],
    subtitles: ['判错文体整篇都偏', '格式分先稳稳拿到手', '两种文体分开过一遍'],
  },
  model: {
    subjects: ['范文', '好句子', '范文结构'],
    problems: ['别整篇背', '拆开才用上', '背了套不进'],
    subtitles: ['拆结构比整篇硬背有用', '按段落拆功能来仿', '先拆再仿才写得像'],
  },
  vocab: {
    subjects: ['主题词', '词汇', '场景词'],
    problems: ['背了写不出', '放到场景里记', '别按字母表背'],
    subtitles: ['场景对了词才用得上', '按写作场景归组记忆', '进作文的才算背过'],
  },
  syntax: {
    subjects: ['句型', '连接词', '长句'],
    problems: ['别堆在一句里', '位置先于难度', '乱放反而碍事'],
    subtitles: ['放对位置才有用处', '一句留一个就够了', '难度要给位置让路'],
  },
  kb: {
    subjects: ['资料', '材料'],
    problems: ['别越收越多', '按用途翻', '一套拆透就够'],
    subtitles: ['按用途翻才来得及', '一套翻透胜过收藏十套', '先分清哪天看什么'],
  },
  argument: {
    subjects: ['论据', '论证', '观点段'],
    problems: ['落到具体场景', '加个例子就深', '别停在口号'],
    subtitles: ['观点后面跟具体场景', '例子一加说服力就来', '层次拉开比堆词强'],
  },
  errors: {
    subjects: ['高频错', '性数配合', '时态'],
    problems: ['考前扫一遍', '错了要记下', '再错就亏了'],
    subtitles: ['性数时态各扫一遍', '错因写在本子边上', '考前扫比再刷题值'],
  },
  else: {
    subjects: ['卡壳', '跑题', '写得慢'],
    problems: ['多半卡在审题', '回题目再写', '拆开练更快'],
    subtitles: ['先回题目找关键词', '问题常出在动笔前', '拆步骤写比硬憋快'],
  },
};

const TEF_FALLBACK_BRANCHES: Record<string, CoverFallbackParts> = {
  exam_choice: {
    subjects: ['选考', '报名', '换考'],
    problems: ['先看清再定', '别急着交钱', '选错多绕半年路'],
    subtitles: ['先看两个考试差在哪', '先确认移民局认哪个', '定错了再改费时间'],
  },
  clb: {
    subjects: ['四科', '总分', '听说读写'],
    problems: ['先测再排', '别平均用力', '弱科先补'],
    subtitles: ['先测再排每天练什么', '弱科多排强科保持', '分数差通常就一科'],
  },
  speaking: {
    subjects: ['口语', '开口', '展开'],
    problems: ['卡壳别背答案', '骨架比流利要紧', '论据凑齐再说'],
    subtitles: ['展开结构比流利要紧', '按提问类型备论据', '过渡词要按场景选'],
  },
  listening: {
    subjects: ['听力', '精听', '语速'],
    problems: ['别只猛刷题', '复听顺序先搞对', '跟不上先慢速练'],
    subtitles: ['精听步骤对了再上量', '复听按这个顺序走', '先听懂了再提语速'],
  },
  plan: {
    subjects: ['顺序', '每天安排', '冲刺期'],
    problems: ['先排弱项', '别平均用力', '按阶段走'],
    subtitles: ['顺序错了时间白花', '先测再定每天练什么', '每个阶段留一套材料'],
  },
  materials: {
    subjects: ['资料', '资料包'],
    problems: ['在精不在多', '按阶段用', '吃透一套就够'],
    subtitles: ['每个阶段只留一套', '先分清哪个阶段看', '收藏多不如翻得勤'],
  },
  generic: {
    subjects: ['卡分', '刷题', '提不上去'],
    problems: ['先定位再刷', '别乱刷题', '弱项先补'],
    subtitles: ['先找最拖分的科目', '定位比刷量更重要', '测完一轮再定刷什么'],
  },
};

function assembleCoverFromParts(
  identityPool: string[],
  parts: CoverFallbackParts,
  key: string,
  recentCoverTitles?: Set<string>,
  titleLengthRange: [number, number] = [8, 18],
  recentCoverSubtitles?: Set<string>,
  // 副标题池全撞时的替代来源：本篇 LLM 内容（content_promise 等）截取。
  // 写死池每分支只有 3 条，同分支同天第二个 job 必撞——"差的那点分就在这步"
  // 一个 batch 出现两次就是这么来的。
  subtitleFallbackText?: string,
): [string, string] {
  const dayKey = new Date().toISOString().slice(0, 10);
  const [minLen, maxLen] = titleLengthRange;
  const freshSubtitles = parts.subtitles.filter(s => !recentCoverSubtitles?.has(fingerprintTitle(s)));
  let firstFit: [string, string] | null = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const seedKey = `${key}|${dayKey}|${attempt}`;
    const subtitlePool = freshSubtitles.length ? freshSubtitles : (subtitleFallbackText ? [subtitleFallbackText] : parts.subtitles);
    const candidate: [string, string] = [
      `${pickBySeedN(identityPool, `${seedKey}-id`, 1)[0]}${pickBySeedN(parts.subjects, `${seedKey}-subj`, 1)[0]}${pickBySeedN(parts.problems, `${seedKey}-prob`, 1)[0]}`,
      pickBySeedN(subtitlePool, `${seedKey}-sub`, 1)[0],
    ];
    if (candidate[0].length < minLen || candidate[0].length > maxLen) continue;
    if (!firstFit) firstFit = candidate;
    if (!recentCoverTitles || !recentCoverTitles.has(fingerprintTitle(candidate[0]))) return candidate;
  }
  return firstFit || ['', ''];
}

function buildCoverTitleFallback(
  topic: MigratedTopic,
  productId: ProductId,
  templateId: CreativeCardRenderer,
  cover: NormalizedCover,
  recentCoverTitles?: Set<string>,
  recentCoverSubtitles?: Set<string>,
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
  const variantKey = `${topic.seed_id || topic.id}|${templateId}`;

  // 新模板的标题有格式硬约束（official_notice 公文格式 / pain_quote_big 完整金句），
  // 通用兜底标题会是小红书钩子风 → final_gate 直接拦死。这里按模板单独兜底，
  // 零件化拼装（身份×动词×考试名×钩子）保证 seed 级多样性，不是固定小 N。
  // seedKey 带上日期：同一个 seed 7 天冷却期过后回来，拼出的是另一组零件，
  // 不再复刻旧标题。
  const seedKey = `${topic.seed_id || topic.id}|${templateId}|${new Date().toISOString().slice(0, 10)}`;
  if (templateId === 'official_notice') {
    const noticeActions = productId === 'tef_tcf_canada'
      ? ['考前自查', '常见问题排查', '重点提示', '考前提醒', '阶段安排']
      : ['考前自查', '常见问题排查', '重点句型提示', '考前提醒', '写作重点核查'];
    const noticeSubject = productId === 'tef_tcf_canada'
      ? ['TEF/TCF听力', 'TEF/TCF写作格式', 'TEF/TCF备考', 'CLB7冲刺']
      : ['DELF B2写作', '法语B2写作', 'B2写作'];
    const [action, subject] = [pickBySeedN(noticeActions, `${seedKey}-act`, 1)[0], pickBySeedN(noticeSubject, `${seedKey}-subj`, 1)[0]];
    return {
      template_id: templateId,
      title: `关于${subject}${action}的通知`,
      subtitle: '',
      title_type: titleType,
      reason: '本地兜底：official_notice 封面标题必须走公文格式。',
      fit_score: 86,
    };
  }
  if (templateId === 'pain_quote_big') {
    const quoteIdentity = ['我室友', '我同学', '我的朋友'];
    const quoteVerbs = ['栽', '卡', '挂'];
    const quoteExams = productId === 'tef_tcf_canada'
      ? ['TEF/TCF听力', 'TEF/TCF写作', '加拿大法语考试']
      : ['法语B2写作', 'DELF B2', 'B2写作'];
    const quoteHooks = ['快看看因为啥', '为啥看看', '猜猜为啥', '别再踩', '提前绕开', '点开避坑'];
    const [identity, verb, exam, hook] = [
      pickBySeedN(quoteIdentity, `${seedKey}-id`, 1)[0],
      pickBySeedN(quoteVerbs, `${seedKey}-verb`, 1)[0],
      pickBySeedN(quoteExams, `${seedKey}-exam`, 1)[0],
      pickBySeedN(quoteHooks, `${seedKey}-hook`, 1)[0],
    ];
    return {
      template_id: templateId,
      title: `${identity}${verb}在${exam}上，${hook}`,
      subtitle: '',
      title_type: titleType,
      reason: '本地兜底：pain_quote_big 封面只有标题一句完整金句。',
      fit_score: 86,
    };
  }

  const identityPool = productId === 'tef_tcf_canada' ? TEF_FALLBACK_IDENTITY : DELF_FALLBACK_IDENTITY;
  const branches = productId === 'tef_tcf_canada' ? TEF_FALLBACK_BRANCHES : DELF_FALLBACK_BRANCHES;
  const branchKey = productId === 'tef_tcf_canada'
    ? (/TEF还是TCF|选考|报名/.test(text) ? 'exam_choice'
      : /CLB|NCLC|自测|四科/.test(text) ? 'clb'
      : /口语|开口|论据|过渡/.test(text) ? 'speaking'
      : /听力|精听|复听|语速/.test(text) ? 'listening'
      : /30天|计划|每天|2小时|路径|安排/.test(text) ? 'plan'
      : /资料包|资料|系统备考|product_showcase/.test(text) ? 'materials'
      : 'generic')
    : (/评分|自评|检查|批改|交卷|写完|final/.test(text) ? 'check'
      : /题型|任务|格式|文体|正式信|论坛|建议|投诉/.test(text) ? 'format'
      : /范文|迁移|仿写/.test(text) ? 'model'
      : /词汇|主题词|单词/.test(text) ? 'vocab'
      : /句式|句型|句法|连接词|衔接/.test(text) ? 'syntax'
      : /资料库|知识库|资料包|备考资料|product_showcase/.test(text) ? 'kb'
      : /论证|议论文|观点|论据/.test(text) ? 'argument'
      : /错误|性数配合|时态|语体|避坑|坑/.test(text) ? 'errors'
      : 'else');
  // check 分支的数字钩子（"先查这N项"）从真实条目数生成，不会 count_mismatch；
  // 其余分支不用数字，避免数字钩子反复出现形成新套路。
  let parts = branches[branchKey] || branches[productId === 'tef_tcf_canada' ? 'generic' : 'else'];
  if (branchKey === 'check' && countPhrase) {
    parts = { ...parts, problems: [`先查这${countPhrase}`, `先过这${countPhrase}`, ...parts.problems] };
  }
  [title, subtitle] = assembleCoverFromParts(
    identityPool,
    parts,
    `${variantKey}-${branchKey}`,
    recentCoverTitles,
    spec?.titleLengthRange || [8, 18],
    recentCoverSubtitles,
    topic.content_promise || topic.pain || '',
  );

  return {
    template_id: templateId,
    title: polishHumanTitleText(normalizeTitleIdentity(clip(title, coverTitleMaxlength(spec)), productId), productId),
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
  // cover 放宽到 24：official_notice 公文标题（≤22）和 pain_quote_big 整句金句
  // （≤24）天然偏长；各模板的精确长度区间由 isCoverTitleLengthOk 在 core 校验。
  const max = role === 'cover' ? 24 : 20;
  if (!title || length < min || length > max) return false;
  if (/(?:先|把|给|的|和|与|在|还|最|这|这个|这里|怎么|问题出在|别再|早该|每|直|高频主|这\d+个常|先看这张)$/u.test(title)) return false;
  if (/[，,、：:；;。\s]$/u.test(title)) return false;
  return true;
}

function needsTitleRewrite(
  candidates: TitleCandidate[],
  selectedTitle: string,
  coverTitle: string,
  context?: { seedId?: string; productId?: ProductId; recentSelectedTitles?: Set<string>; recentAllCandidates?: Set<string>; recentTitleTemplates?: Map<string, number> },
) {
  // 必须带 context 打分：裸打只有身份词/数字/清单项可拿（上限 7 分），
  // 而 selected 门槛是 9 分 → 永远触发第二轮，每篇白烧一次 LLM 调用。
  const bestScore = Math.max(0, ...candidates.map(item => titleImpactScore(item.title, context)));
  const selectedScore = titleImpactScore(selectedTitle, context);
  const coverScore = titleImpactScore(coverTitle, context);
  const repeatedQuestionPattern = candidates.filter(item => /[锛?？].{0,8}(?:先|看|用|查)/.test(item.title)).length >= 3;
  // 池内残句不再触发重写（2026-08-16 撤掉 candidates.some 完整性条件）：
  // 残句已不可能中选（chooseSafeTitle 完整性硬过滤），池子是内部数据不是
  // 发布物；之前靠它触发的二次标题调用是"每篇固定多烧 1 次"的主因之一。
  return bestScore < 11
    || selectedScore < 9
    || coverScore < 7
    || repeatedQuestionPattern
    || !isCompleteTitle(selectedTitle, 'text')
    || !isCompleteTitle(coverTitle, 'cover');
}

function polishHumanTitleText(value: string, productId?: ProductId) {
  let title = sanitizeTitleLikeText(value);
  const isDelf = productId === 'delf_b2_writing' || /DELF|B2|写作|作文|法语B2/i.test(title);
  const isTef = productId === 'tef_tcf_canada' || /TEF|TCF|CLB|Canada/i.test(title);
  // 只保留长串替换。短词（卡住/拖后腿/白背/写作任务）曾在全局正则下误改
  // “卡住的题先标记”“写作任务书”等合法标题，已移除——
  // 这类 AI 味词由 isUnnaturalTitle 黑名单直接拒绝，不再 post-process 改写。
  const replacements: Array<[RegExp, string]> = [
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
  if (!/[？?!！]/.test(value) && !/\d/.test(value) && !/别再|先别|警告|常犯|总|越|反而|像A2|不高级|卡住|卡在|跑题|白费|白练|翻车|瞎练|丢分|错过|后悔|漏|错|太晚|不懂|不会|乱|别扭|差在哪|问题在这|一页|交卷前|考前/i.test(value)) {
    return true;
  }
  return /^(?:法语|DELF|B2|TEF|TCF).{0,8}(?:知识点|学习方案|资料|清单|指南|手册|怎么准备|这样准备|这样看|这样用|这样分|先看|先选对)/.test(value)
    || /(?:知识点|学习方案|资料整理|主题词汇|观点|表达)(?:这样|如何)?(?:准备|使用|整理|学习)$/.test(value)
    || /先选对这一档|先看这一页|这次具体练什么/.test(value);
}

function titleImpactScore(value: string, context?: { seedId?: string; productId?: ProductId; recentSelectedTitles?: Set<string>; recentAllCandidates?: Set<string>; recentTitleTemplates?: Map<string, number> }): number {
  let score = 0;
  if (isUnnaturalTitle(value)) score -= 12;
  if (/法语|DELF|B2|TEF|TCF/i.test(value)) score += 3;
  if (/\d/.test(value)) score += 2;
  if (/一页|这张表|这几类|这\d+[处类项步句个]|清单|体系|地图/.test(value)) score += 2;
  // 钩子信号（2026-08-16 前台验收：11 job 标题 7/7 全是资料目录型，"没让人
  // 好奇点进去"）。疑问钩子/损失反差/考试时刻各一次性加分，AI 目录腔扣分。
  // 三类合计封顶 +8，仍低于句式复读 -12——钩子救不活本批已用句式，多样性不破。
  if (/[？?]/.test(value)) score += 3;
  if (/(翻车|白练|白费|丢分|卡在|错过|后悔|别再|瞎练)/.test(value)) score += 3;
  if (/(模考|考场|交卷|开考|考完|出分|首考)/.test(value)) score += 2;
  if (/(量化|一站式|全覆盖|全方位)/.test(value)) score -= 4;
  if (/怎么准备|这样准备|学习方案|知识点|指南|手册|内容整理/.test(value)) score -= 5;
  if (/^法语B2写作[:：].{2,}$/.test(value)) score -= 2;
  if (value.length > 20) score -= 2;
  if (value.length < 9) score -= 1;
  // 主题锚定 + SEO 软校验：未传 context 时退回老逻辑（保持调用兼容）。
  if (context?.seedId) {
    if (isTitleAnchoredToSeed(value, context.seedId)) {
      score += 2;
      const hits = countSeedTopicHits(value, context.seedId);
      if (hits >= 2) score += 1; // 多关键词命中再加 1
    } else {
      score -= 8; // 未锚定本 seed，重扣（治"通用标题"真凶）
    }
  }
  if (context?.productId) {
    const keywords = getXhsSearchKeywords(context.productId);
    if (keywords.primary.some(kw => value.includes(kw))) score += 3;
    if (keywords.secondary.some(kw => value.includes(kw))) score += 1;
  }
  // 跨 batch 已用：被选过的标题重扣（基本会被排到末尾，等于硬剔除）；
  // 仅出现在历次候选池里的标题轻扣（保留作 backup 的可能）。
  const fp = fingerprintTitle(value);
  if (context?.recentSelectedTitles?.has(fp)) score -= 100;
  else if (context?.recentAllCandidates?.has(fp)) score -= 6;
  // 句式模板去重：治"别再 X""X，直接扣分"被反复用。
  // 旧版同时存在一张"强词加分表"（救命/别再/大全 +4~+5），加分把轻扣完全
  // 盖住——1914 条候选里"别再"×220、"？"×283，评分器自己就是句式复读机。
  // 加分表已删；同句式在 batch 历史里出现过 1 次就重扣（同句式每批最多中选 1 次）。
  if (context?.recentTitleTemplates) {
    const tpl = titleTemplateFingerprint(value);
    if (tpl) {
      const cnt = context.recentTitleTemplates.get(tpl) || 0;
      // 疑问句式分层：问号是钩子第一工具，"用过 1 次就 -12"等于全月只准发
      // 1 条问句标题，直接对冲钩子加分。1-2 次轻扣，满 3 次才重罚；
      // 功能词模板（先看/一页/清单…）维持一次即罚。
      if (tpl === '疑问句式') score -= cnt >= 3 ? 12 : cnt >= 1 ? 4 : 0;
      else if (cnt >= 1) score -= 12;
    }
  }
  return score;
}

function titleSelectionScore(value: string, context: string, seedContext?: { seedId?: string; productId?: ProductId; recentSelectedTitles?: Set<string>; recentAllCandidates?: Set<string>; recentTitleTemplates?: Map<string, number> }) {
  return titleImpactScore(value, seedContext) + titleContextFitScore(value, context);
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

// 标题谎报词拦截：效果承诺类（提分/必过/保分等）已按用户 2026-08-16 拍板撤销，
// 只拦谎报事实类——冒充官方授权/内部押题/100%。发布面风险扫描不含标题候选池，
// 选中前的拦截全靠这层 + polish 后的确定性换标题。
const TITLE_CLAIM_PATTERN = /内部押题|内部资料|官方授权|百分百|100\s*%|考官追着给分/;

function filterTitleCandidatesByContent(
  candidates: TitleCandidate[],
  topic: MigratedTopic,
  cover: NormalizedCover,
) {
  const context = `${topic.topic} ${topic.content_promise} ${cover.title} ${cover.subtitle} ${cover.sections.map(section => section.heading).join(' ')}`;
  return candidates.filter(item => {
    if (TITLE_CLAIM_PATTERN.test(item.title)) return false;
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
  // 剥除产品标识（DELF B2 / TEF/TCF / CLB7）+ 功能词。
  // 保留所有领域词（法语/B2）和场景词（写作/作文/备考/资料/模板/范文）——
  // 之前把"写作|口语|听力"也剥掉，导致 "B2写作模板" 和 "B2口语模板" 被判同义。
  return polishHumanTitleText(value)
    .replace(/DELF\s*B2|TEF\s*\/\s*TCF|TEF|TCF|CLB\s*7|Canada/gi, '')
    .replace(/这张|这份|先看|先别|别再|的人|一下/g, '')
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
        // 删掉通用钩子 `${writing}词背了还用不上？`：跨 topic 会被 LLM 抄（如条件式
        // topic 含"表达"也匹配此分支 → LLM 拿到这条候选照搬，跟 topic 完全不匹配）。
        // 改成跟 topic 内容绑定的钩子，避免跨 topic 撞款。
        free: `${base}主题词别散着背`,
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
      // 同上：删掉 `${writing}词背了还用不上？` 这种通用钩子（跨 topic 抄的源头）。
      free: `${base}主题词按场景用`,
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
  // 兜底标题的 topic 名优先取 seed 配置的纯中文关键词（如"论坛投稿""时态选择"），
  // 保证兜底标题天然锚定本篇主题；inferTitleTopicName 的关键词桶做未配置 seed 的后备
  // （它没有时态/语气桶，时态笔记曾被错标成"句式表达"）。
  const seedTopicLabel = getSeedTopicKeywords(topic.seed_id || '').find(kw => /^[一-鿿]{2,5}$/.test(kw));
  const topicName = topic.topic_type === 'product_showcase' ? '资料库' : (seedTopicLabel || inferTitleTopicName(text));
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
  if (/评分|检查|交卷|自查/.test(text)) return 'DELF B2写作写完别急着交，先自查这几处';
  if (/范文|模板/.test(text)) return '法语B2写作卡住的人，真的别再硬背范文了';
  if (/格式|文体|任务/.test(text)) return 'DELF B2写作总跑题的人，先别急着下笔';
  if (/词汇|句式|连接词/.test(text)) return 'B2写作写完像A2？可能不是词汇量的问题';
  return fallback || 'DELF B2写作写到一半卡住的人，先停一下';
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
const COVER_COUNT_CLAIM_PATTERN = /(\d+)\s*(大主题|大模块|大方向|大话题|大板块|大场景|大类|大组|大步骤|大要点|大关键|大错误|句|个|条|项|组|类|步|招|要点|关键|错误|阶段|维度|方向|板块|章节)/g;
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
    .replace(/格式分/g, '格式问题')
    .replace(/(?:我|我的)整理方法/g, '可以这样整理')
    .replace(/让我考前[^，。；\n]{0,24}/g, '考前复盘时')
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
    .replace(/必查/g, '重点查')
    .replace(/白考/g, '白费')
    .replace(/扣\s*\d+\s*分/g, '容易丢分')
    .replace(/\d+\s*%/g, '不少')
    .replace(/百分之\d*/g, '不少')
    .replace(/一对一/g, '针对性')
    .replace(/直播课/g, '系统讲解')
    .replace(/老师批改/g, '自检清单')
    .replace(/无限答疑/g, '常见问题汇总')
    .replace(/陪学/g, '辅助')
    .replace(/督学/g, '规划')
    .replace(/课时/g, '内容')
    .replace(/学习权利/g, '使用说明')
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
  topic?: MigratedTopic,
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
    // 负向后行断言：d'accord / l'accord 是完整法语词，不是缩写，不能翻成"性数配合"
    .replace(/(?<!['’])\baccords?\b/gi, '性数配合')
    .replace(/\bsubj\.?\b/gi, '虚拟式')
    .replace(/\bcond\.?\b/gi, '条件式');
  const sanitizeCoverText = (value: string) => scrubCheapClaims(sanitizePublicText(value));
  // 跨商品身份污染兜底：LLM 在 cover.sections 里偶发出现他商品考试名（如 DELF B2
  // 封面被审校 LLM 改写成 "TEF Canada" 之类），final_gate 会判 product_identity_mismatch。
  // 用 product profile 的 forbiddenIdentityPattern 替换成对应 identity，比 throw 触发
  // repair 更稳，避免连环重试烧 token。
  const sanitizeSectionText = (value: string) => stripForbiddenIdentity(productId, sanitizeCoverText(value));
  const sanitizeCoverTitle = (value: string) => sanitizeTitleLikeText(normalizeFrenchIdentity(value));
  const sections = spec ? rawSections.map(section => ({
    ...section,
    heading: sanitizeSectionText(section.heading),
    side_label: sanitizeSectionText(section.side_label || ''),
    items: section.items.map(item => ({
      ...item,
      primary: clipVisual(explainShorthand(sanitizeSectionText(item.primary)), spec.maxPrimaryVisualLength),
      secondary: item.secondary
        ? clipVisual(explainShorthand(sanitizeSectionText(item.secondary)), spec.maxSecondaryVisualLength)
        : undefined,
      note: item.note ? sanitizeCoverNote(stripForbiddenIdentity(productId, item.note)) : item.note,
    })),
  })) : rawSections;
  const itemCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  const sectionCount = sections.length;
  let title = alignCoverCountClaims(sanitizeCoverTitle(cover.title), itemCount, sectionCount);
  let subtitle = cover.subtitle.length >= 8
    ? clip(alignCoverCountClaims(sanitizeCoverTitle(cover.subtitle), itemCount, sectionCount), 24)
    : '';
  // autofix 兜底：align 之后若仍触发 cover_count_mismatch（LLM 写的数字单位在
  // pattern 之外，或对齐后破坏 DELF 客观事实），直接把"N+单位"整段从 title/subtitle
  // 删掉。比如"B2写作3大题型速查"→"B2写作题型速查"。比 fallback 更保原标题语义。
  if (hasCoverCountMismatch(title, itemCount, sectionCount)) {
    title = stripCoverCountClaims(title);
  }
  if (subtitle && hasCoverCountMismatch(subtitle, itemCount, sectionCount)) {
    subtitle = clip(stripCoverCountClaims(subtitle), 24);
  }
  const hasOwnIdentity = hasRequiredProductIdentity(productId, title) && !hasForbiddenProductIdentity(productId, title);
  // 模板特有标题格式：official_notice 必须公文格式，pain_quote_big 必须完整金句。
  // 不合格就走 fallback 重建，而不是留到 final_gate 才拦死整个 job。
  const officialNoticeFormatOk = spec?.renderer !== 'official_notice' || /^关于.{2,16}的通知$/.test(title);
  const painQuoteFormatOk = spec?.renderer !== 'pain_quote_big' || (
    /我室友|我同学|我的朋友|室友|同学|朋友/.test(title)
    && /栽|卡|挂|折|绊/.test(title)
    && /避开|绕开|别再踩|快看看|为啥|猜猜|点开/.test(title)
  );
  // 拒绝被 clip 截断后留下 `…` 的半截标题：说明上游 LLM 输出过长，封面不该
  // 留这种半句话。fallback 来自 profile，能给出完整的"商品 + 知识体系"标题。
  const looksTruncated = /[….]+$/.test(title) || /\.\.\.$/.test(title);
  if (hasOwnIdentity && !looksTruncated && isCoverTitleLengthOk(spec, title.length) && officialNoticeFormatOk && painQuoteFormatOk) {
    return { ...cover, title, subtitle, sections };
  }
  // 优先用 topic-aware fallback（每次都因 seed 主题不同而不同，根治多 job 撞款）；
  // 若 topic-aware 标题仍不通过身份/长度校验，退回 renderer 静态映射兜底。
  if (topic) {
    const topicFallback = buildCoverTitleFallback(topic, productId, renderer, cover).title;
    const fallbackHasIdentity = hasRequiredProductIdentity(productId, topicFallback) && !hasForbiddenProductIdentity(productId, topicFallback);
    if (fallbackHasIdentity && isCoverTitleLengthOk(spec, topicFallback.length)) {
      title = topicFallback;
    } else {
      title = getRendererCoverFallbackTitle(productId, renderer, family);
    }
  } else {
    title = getRendererCoverFallbackTitle(productId, renderer, family);
  }
  return { ...cover, title, subtitle, sections };
}

// stripCoverCountClaims：把"N + 单位"整段从标题里删掉，比 align 更保守。
// 用于 alignCoverCountClaims 仍触发 mismatch 时（LLM 写的数字是 DELF 客观事实，
// 不应被改写）。删数字保语义：标题意思不变，只是不带数字承诺。
function stripCoverCountClaims(text: string) {
  return text
    .replace(COVER_COUNT_CLAIM_PATTERN, '')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/^[，,、\s]+|[，,、\s]+$/g, '')
    .replace(/\s{2,}/g, ' ');
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
  // 单组容量校验拆两挡（跟 cover_density 一致的思路）：
  // - 单组少于 50%（cover_section_severely_low）→ block，LLM 偷懒必须返修
  // - 单组 50%-100% 但不在 ±2 容差内（cover_section_capacity_invalid）→ warn，
  //   autofix 兜底即可，不再卡死整个 job。
  // 之前 hard fail 让"建议信三步"这种小切口选题在 clean_purple_directory
  // （每组 9 条）上必挂——LLM 拆不出 7 条/组 × 4 组就被整 job 干掉。
  if (spec) {
    const severePerSection = Math.max(1, Math.ceil(spec.itemsPerSection * 0.5));
    if (flexibleCapacity) {
      const hasSevere = cover.sections.some(section => section.items.length < severePerSection || section.items.length > spec.itemsPerSection + 2);
      if (hasSevere) issues.push('cover_section_severely_low');
      else {
        const hasSlight = cover.sections.some(section => section.items.length < Math.max(1, spec.itemsPerSection - 2) || section.items.length > spec.itemsPerSection + 2);
        if (hasSlight) issues.push('cover_section_capacity_invalid');
      }
    } else {
      const hasMismatch = cover.sections.some(section => section.items.length !== spec.itemsPerSection);
      if (hasMismatch) {
        // 非灵活模板（flashcard 等）：偏离就是 block
        issues.push('cover_section_severely_low');
      }
    }
  } else {
    issues.push('cover_section_severely_low');
  }
  const duplicateItemCount = cover.sections.reduce((sum, section) => {
    const keys = section.items.map(item => canonicalSemanticText(item.primary));
    return sum + (keys.length - new Set(keys).size);
  }, 0);
  if (duplicateItemCount >= Math.max(3, Math.ceil(itemCount * 0.15))) issues.push('cover_items_semantic_duplicate');
  // 封面密度拆两挡：少于 70% 是严重不足（block，LLM 偷懒必须返修）；
  // 70%-100% 之间是轻微不足（warn，autofix 兜底即可，不再卡死整个 job）。
  // 之前一挡 <minTotalItems 就 block，遇到小切口选题（如"投诉信开头"）
  // LLM 写不出 22 条硬卡，2 次返修还是不够 → 整个 job 挂。
  const minItems = spec?.minTotalItems || 0;
  const severeThreshold = Math.ceil(minItems * 0.7);
  if (!spec || itemCount < severeThreshold) issues.push('cover_density_severely_low');
  else if (itemCount < minItems) issues.push('cover_density_too_low');
  // 图生图模板：字长由图模型在 prompt 里自行缩字/折行（见 reference-image-prompt.ts），
  // 代码层不再做硬限，避免 LLM 偶尔超长就被整条 job 干掉。
  // 代码/混合模板：CSS clamp + line-clamp 兜底，但仍校验避免 LLM 写成段落。
  if (spec && spec.renderMode !== 'image_to_image' && cover.sections.some(section => section.items.some(item => visualLength(item.primary) > spec.maxPrimaryVisualLength || visualLength(item.secondary || '') > spec.maxSecondaryVisualLength))) issues.push('cover_item_too_long');
  // 截断检测：clipVisual 兜底后仍可能留下「→」「，」「。」等结尾的半截话
  // （LLM 写到一半被切，或 audit LLM-corrections 直接写入未走 clip）。
  // 这种半截条目直接发笔记会被读者一眼看出来，硬挡。
  const TRAILING_TRUNCATION = /[→，,、；;:：]$/;
  if (cover.sections.some(section => section.items.some(item => TRAILING_TRUNCATION.test(item.primary) || TRAILING_TRUNCATION.test(item.secondary || '')))) {
    issues.push('cover_item_truncated');
  }
  // 法语条目模板（primaryFrenchOnly）：primary 混进中文是 spec 硬违规
  // （词典层只能查拉丁词元，混排的中文没人拦，之前只有 audit LLM 事后
  // 能发现，漏检就漏到审校闸门炸单）。确定性拦截，走 core repair loop。
  if (spec?.primaryFrenchOnly && cover.sections.some(section => section.items.some(item => /[一-鿿]/.test(item.primary || '')))) {
    issues.push('cover_primary_not_french');
  }
  // plain_experience：条目必须是"完整中文句子组成的段落"（spec 硬要求），
  // 严禁"法语短语+中文翻译"词条。这条之前只写在 LLM 指令里没有闸门——
  // job_009 实测整张封面全是 "lire la consigne deux fois — 读题两遍"
  // 式词条，发出来就是一张假"经验贴"。两个确定性判据，任一命中走返修：
  //   1) 条目是纯法语/无中文，或"法语—中文翻译"对 → 词条不是句子；
  //   2) 单段中文字数 < spec 要求（70-110 字/段）的 8 成 → 伪段落堆叠。
  if (spec?.renderer === 'plain_experience') {
    const countCjk = (text: string) => (text.match(/[一-鿿]/g) || []).length;
    const isPhraseEntry = (text: string) =>
      !text.trim() ? false : /^[A-Za-zÀ-ÿ'’\- ]+\s*[—\-–:：]/.test(text.trim()) || countCjk(text) === 0;
    if (cover.sections.some(section => section.items.some(item =>
      isPhraseEntry(item.primary) || (item.secondary ? isPhraseEntry(item.secondary) : false)))) {
      issues.push('plain_experience_phrase_entry');
    }
    if (cover.sections.some(section => {
      const paragraphCjk = section.items.reduce(
        (sum, item) => sum + countCjk(item.primary || '') + countCjk(item.secondary || ''), 0);
      return paragraphCjk < 56;
    })) {
      issues.push('plain_experience_paragraph_too_short');
    }
  }
  if (!isCoverTitleLengthOk(spec, cover.title.length)) issues.push('cover_title_length_invalid');
  // official_notice 封面标题必须走真实公文格式；标题编辑器/兜底常把它改写成
  // "B2作文先查这6项"这类小红书钩子，与模板公告纸版式严重错配，硬挡。
  if (spec?.renderer === 'official_notice' && !/^关于.{2,16}的通知$/.test(cover.title)) {
    issues.push('official_notice_title_format_invalid');
  }
  // pain_quote_big 封面只有标题一句话（用户明确要求），标题必须是完整金句：
  // 单数身份 + 栽/卡/挂/折/绊在考试上 + 行动钩子。缺任一成分整张封面就立不住。
  if (spec?.renderer === 'pain_quote_big') {
    const hasIdentityWord = /我室友|我同学|我的朋友|室友|同学|朋友/.test(cover.title);
    const hasFallVerb = /栽|卡|挂|折|绊/.test(cover.title);
    const hasHook = /避开|绕开|别再踩|快看看|为啥|猜猜|点开/.test(cover.title);
    if (!hasIdentityWord || !hasFallVerb || !hasHook) issues.push('pain_quote_title_incomplete');
  }
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
  // 风险面只扫封面，不含标题候选池（job_006 实锤：落选候选里的"不是…而是…"
  // 把整 job 炸成 caption_ai_cliche no_match——候选不发布就不该有否决权；
  // 承诺型候选另在 filterTitleCandidatesByContent 拦截，防被选中发布）。
  const coverRiskText = `${cover.title} ${cover.sections.map(section => `${section.heading} ${section.items.map(item => `${item.primary} ${item.secondary || ''}`).join(' ')}`).join(' ')}`;
  issues.push(...getPublicEditorialRiskIssues(coverRiskText));
  if (/(?:\bEt\b|\bMais\b|Parce que|Je pense que|\bOn peut\b|Beaucoup de|Des gens)[^。；\n]{0,18}(?:口语|非正式|错误)/i.test(coverRiskText)) {
    issues.push('neutral_french_misclassified_as_oral');
  }
  if (/Cordialement[^。；\n]{0,18}(?:最低标准|一律|所有|任何)/i.test(coverRiskText)) {
    issues.push('overabsolute_register_rule');
  }
  if (/短信|简讯/.test(coverRiskText) && /DELF B2|法语B2/i.test(coverRiskText)) issues.push('off_scope_writing_task');
  if (/官方授权|内部押题|内部资料|100\s*%|百分百|考官追着给分/.test(coverRiskText)) issues.push('cheap_or_unsupported_claim');
  if (/(商品|资料)(里|中|内).{0,10}(有|没有|包含|不含|收录|未收录)/.test(coverRiskText)) issues.push('public_inventory_relation_claim');
  const allowedSourceIds = collectEvidenceSourceIds(evidence);
  const sourceMismatch = cover.sections.some(section => {
    if (section.source_type === 'ai_original') return section.source_ids.length > 0;
    if (section.source_type === 'knowledge_base' || section.source_type === 'ai_derived') {
      return section.source_ids.length === 0 || section.source_ids.some(id => !allowedSourceIds.has(id));
    }
    return section.source_ids.some(id => !allowedSourceIds.has(id));
  });
  if (sourceMismatch) issues.push('cover_source_evidence_mismatch');
  if (/每段.{0,8}必须.{0,8}空行|Cordialement.{0,8}(错误|禁用)|每个论点.{0,10}必须.{0,10}(数据|例子)/i.test(coverRiskText)) issues.push('overabsolute_exam_rule');
  if (/至少\s*\d+\s*个.{0,8}(B2.{0,4}词|词汇|虚拟式|连接词)|每段.{0,8}(必须|至少).{0,8}(连接词|例子|数据)/i.test(coverRiskText)) issues.push('invented_quantity_rule');
  if (/\b(?:vocabulaire\s*B2|concordance|accords?)\b(?![^。；，\n]{0,12}(?:词汇|时态|一致|配合|阴阳性|单复数))/i.test(coverRiskText)) issues.push('unexplained_french_shorthand');
  if (spec?.family === 'phrase' && cover.sections.some(section => section.items.some(item => !/[A-Za-zÀ-ÿ]/.test(item.primary) || !item.secondary))) issues.push('french_chinese_pair_required');
  if (spec?.family === 'flashcard' && cover.sections.some(section => section.items.some(item => !/[A-Za-zÀ-ÿ]/.test(item.primary) || !item.secondary || !item.note))) issues.push('flashcard_fields_incomplete');
  if (spec?.family === 'document' && cover.sections.flatMap(section => section.items)
    .filter(item => /[A-Za-zÀ-ÿ]{8,}/.test(`${item.primary} ${item.secondary || ''} ${item.note || ''}`)).length < 1) issues.push('document_examples_missing');
  if ((spec?.family === 'offer' || spec?.family === 'roadmap') && /一对一|直播课|老师批改|无限答疑|陪学|督学|课时|学习权利/.test(coverRiskText)) issues.push('unsupported_service_claim');
  if ((spec?.family === 'experience' || spec?.family === 'pain') && /我.{0,12}(上岸|通过|考到|拿到|亲测|亲身|用了\d+|学了\d+)/.test(coverRiskText)) issues.push('fabricated_first_person_experience');
  if (spec?.family === 'document' && /官方真题|历年真题|原题|真题原文/.test(coverRiskText)) issues.push('unverified_exam_source');
  return issues;
}

function isBlockingCoreIssue(issue: string) {
  return classifyCoreIssue(issue) === 'block';
}

function classifyCoreIssue(issue: string): 'block' | 'autofix' | 'warn' {
  const warnIssues = new Set([
    'public_inventory_relation_claim',
    'overmechanical_content_method',
    'free_original_title_missing',
    'reference_migration_title_missing',
    'formula_title_missing',
    'title_candidate_mix_incomplete',
    'cover_items_semantic_duplicate',
    // 封面密度差一点（70%-100%）：autofix 兜底即可，不再卡死 job。
    // 严重不足（<70%）走另一个 issue：cover_density_severely_low（默认 block）。
    'cover_density_too_low',
    // 单组容量差一点（50%-100% 但不在 ±2 容差内）：autofix 兜底即可。
    // 严重不足（<50%）走另一个 issue：cover_section_severely_low（默认 block）。
    'cover_section_capacity_invalid',
    // Symmetric with classifyEditorialIssue: time-budget claims surface in
    // both cover and body text. Treating them as block on core only makes
    // generation flaky on product 2 (TEF/TCF has real per-section time
    // budgets the LLM legitimately surfaces) while editorial treats them
    // as warn. Keep the check firing so it is visible, but do not block.
    'unsupported_fixed_time_advice',
    'unsupported_exam_official_rule',
    // caption_ai_cliche 之前归 warn——但 warn 不触发 retry，LLM 不会改。
    // 按 Enforcement 不是 Observation 原则：命中即 block，repair 时强制避开。
    // repair prompt 里已列出具体禁用句式（"X 才是 Y 关键"等）。
    'editorial_low_quality_phrase',
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

// ============ 带货承接句（caption product bridge）============
// 背景：prompt 里曾只有带货禁令（禁库存说明/禁归属声明/禁效果承诺），LLM 学到
// 的最安全做法是干脆不提商品——实测 39 篇正文只有 13 篇提到。现在双保险：
//   1) 生成/返修 prompt 给正向规格（承接句 = 整理成了什么 + 对谁有用 + 软CTA）；
//   2) 这里确定性校验 + 兜底补写：缺承接句就按 seed 轮换补一句，保证每篇正文
//      都有带货出口，但不弄死 job。
// CTA 只用两种出口：评论区 / 点下方链接（用户定的规矩，不要花式 CTA）。
// 但每种出口备 3 条写法：之前全管线只有 2 条固定 CTA + 收尾改写器又只会换成
// 固定 2 条替换语，11 篇里 7 篇被改成同 2 个字符串（×4/×3），改写器自己成了
// 复读源。变体刻意让句尾各不相同——收尾复读检测比的是公共后缀，尾巴不同就
// 不会互相误判，同出口轮换也就不会撞近期结尾。
const PRODUCT_CTA_FORUM = [
  '评论区告诉我你最卡的一步。',
  '想看完整例句，评论区说一声。',
  '评论区聊聊你练到哪部分了。',
];
const PRODUCT_CTA_LINK = [
  '完整内容点下方链接直接带走。',
  '点下方链接，翻开就能用。',
  '资料就在下方链接，考前直接翻。',
];
// 承接句的"怎么拿到"连接段。之前固定写"直接翻这份就行"——batch_1786754651839
// 里 15 篇有 9 篇 caption 以同一个"直接翻这份就行。点下方链接直接带走。"收尾。
// 连接段改成与分句形态无关的完整短句池，按 seed 轮换。
const PRODUCT_BRIDGE_CONNECTORS = [
  '直接翻这份就行。',
  '不用再自己整理。',
  '考前过一遍就够了。',
  '写之前扫一眼就够。',
  '照着勾就行。',
  '卡住的时候直接查。',
  '拿来就能对。',
  '按这个顺序走。',
];

export function captionHasProductBridge(caption: string) {
  const hasCta = /评论区|下方链接|私信/.test(caption);
  const hasMaterial = /资料|清单|对照表|速查|这份|这套|检查表|时间表|句库|词库|自查/.test(caption);
  return hasCta && hasMaterial;
}

function ensureProductBridge(caption: string, brief: UnifiedContentBrief, seedKey: string, recentEndings: readonly string[] = []): string {
  // LLM 自己已经写出承接句（CTA + 资料指代都齐）时不再补写——job_009 实测
  // caption 已有"点下方链接，模考前照着走一遍"，兜底又接一段，双 CTA 收尾。
  // 结尾是否复读交给后面的 ensureCaptionEndingVariety 管。
  if (captionHasProductBridge(caption)) return caption;
  // CTA 池只有两条（用户定的规矩：只用评论区/点下方链接两种出口），确定性
  // 按 seed 抽会整批复读（实测 "点下方链接直接带走。" 同批 ×2）。改成先排除
  // 与近期结尾同尾的写法，两条都撞时取撞得少的那条。
  const cta = pickCtaAvoidingRecentEndings(`${seedKey}-bridge-cta`, recentEndings);
  // 购买理由不进通用池——必须贴着本篇内容：selling_point 是什么资料、
  // buying_reason 是本篇人群的痛点。两个都是完整分句（陈述句/需求句/动词短语
  // 都有），不许用"如果你也{pain}"这类固定连接词硬拼——buying_reason 是
  // "跑题是DELF B2写作最致命的失分点"时拼出"如果你也跑题是……的失分点"病句
  // （实测 job_001/006/017）。按独立句子直接拼，任何分句形态都通。
  const selling = (brief.selling_point || '这篇的知识点').replace(/[。.]\s*$/, '');
  const pain = (brief.buying_reason || '').replace(/[。.]\s*$/, '');
  const connector = pickBySeed(PRODUCT_BRIDGE_CONNECTORS, `${seedKey}-bridge-conn`);
  const bridge = pain
    ? `${selling}。${pain}。${connector}${cta}`
    : `${selling}。我整理成了一份能直接翻的资料。${connector}${cta}`;
  // 正文长度上限 440：补句可能超，先在句界裁掉尾部再接承接句。
  const budget = 432 - bridge.length;
  if (caption.length > budget) {
    const trimmed = caption.slice(0, budget);
    const cut = Math.max(trimmed.lastIndexOf('。'), trimmed.lastIndexOf('！'), trimmed.lastIndexOf('\n'));
    caption = cut > 120 ? trimmed.slice(0, cut + 1) : trimmed;
  }
  return `${caption}${caption.endsWith('\n') ? '' : '\n'}${bridge}`;
}

function normalizeEndingForCompare(value: string): string {
  return value.replace(/[\s，。；：、！？!?·…《》「」“”‘’'"（）()【】\[\]]/g, '');
}

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

// caption 结尾与近期结尾同尾（规范化后公共后缀 ≥6 字）即算复读。
// 只比对最近 2 条：CTA 出口只有两种，窗口拉太长会把两种出口的写法全堵死
// （首版 window=3 + 池子只有 2 条时，7/11 篇的结尾全被判定复读，改写器
// 把整批换成同 2 个固定字符串——enforcement 自己造出了新的复读）。
export function captionEndingRepeatsRecent(caption: string, recentEndings: readonly string[]): boolean {
  if (!caption || recentEndings.length === 0) return false;
  const tailKey = normalizeEndingForCompare(caption).slice(-12);
  if (tailKey.length < 6) return false;
  return recentEndings
    .filter(Boolean)
    .slice(-2)
    .some(recent => commonSuffixLength(tailKey, normalizeEndingForCompare(recent).slice(-12)) >= 6);
}

function pickCtaAvoidingRecentEndings(seedKey: string, recentEndings: readonly string[]): string {
  const pool = [...PRODUCT_CTA_FORUM, ...PRODUCT_CTA_LINK];
  if (!recentEndings.length) return pickBySeed(pool, seedKey);
  const overlapCount = (cta: string) => recentEndings.filter(recent =>
    commonSuffixLength(
      normalizeEndingForCompare(cta).slice(-12),
      normalizeEndingForCompare(recent).slice(-12),
    ) >= 6).length;
  const safe = pool.filter(cta => overlapCount(cta) === 0);
  if (safe.length) return pickBySeed(safe, seedKey);
  // 全撞的极端情况：取与近期撞得最少的那条，避免假死锁。
  return pool.reduce((best, cta) => (overlapCount(cta) < overlapCount(best) ? cta : best));
}

// caption 结尾批内复读兜底：LLM 写的结尾句与近期同尾时，把最后一个 CTA 分句
// 整段替换成另一出口的写法（实测 agent4 三篇全以"评论区说一声"收尾——
// recent_caption_endings 只喂了 prompt 没有 enforcement，拦不住）。
function ensureCaptionEndingVariety(caption: string, recentEndings: readonly string[]): string {
  if (!captionEndingRepeatsRecent(caption, recentEndings)) return caption;
  const forumIdx = caption.lastIndexOf('评论区');
  const linkIdx = caption.lastIndexOf('下方链接');
  const markerIdx = Math.max(forumIdx, linkIdx);
  if (markerIdx < 0) return caption;
  const clauseStart = Math.max(
    caption.lastIndexOf('，', markerIdx),
    caption.lastIndexOf('。', markerIdx),
    caption.lastIndexOf('；', markerIdx),
    caption.lastIndexOf('\n', markerIdx),
  ) + 1;
  let sentenceEnd = caption.length;
  const punctMatch = caption.slice(markerIdx).match(/[。！？\n]/);
  if (punctMatch && punctMatch.index !== undefined) sentenceEnd = markerIdx + punctMatch.index + 1;
  // 替换语从"另一出口"的变体池里抽，同样避开近期结尾——固定 2 条替换语
  // 的旧版把整批判成同 2 个收尾（见 PRODUCT_CTA_FORUM 注释）。
  const oppositePool = forumIdx >= linkIdx ? PRODUCT_CTA_LINK : PRODUCT_CTA_FORUM;
  const safePool = oppositePool.filter(cta => !captionEndingRepeatsRecent(cta, recentEndings));
  const replacement = pickBySeed(safePool.length ? safePool : oppositePool, `ending-rewrite-${caption.length}-${markerIdx}`);
  let next = `${caption.slice(0, clauseStart)}${replacement}${caption.slice(sentenceEnd)}`;
  if (next.length > 440) {
    // 替换句比原句长导致超限时，在替换句之前的句界裁头，保住结尾。
    const headLimit = clauseStart - (next.length - 440);
    const cut = Math.max(
      next.lastIndexOf('。', headLimit),
      next.lastIndexOf('；', headLimit),
      next.lastIndexOf('\n', headLimit),
    );
    if (cut > 120) next = next.slice(cut + 1);
  }
  return next;
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
  // 页型单调（整篇全是一种 page_type）：warn 级可见——生成侧 prompt 已硬要求
  // 至少混排 3 种；这里兜底让 checks/质检脚本能看到没做到的 job。
  if (pages.length >= 4 && new Set(pages.map(page => page.page_type)).size < 3) {
    issues.push('inner_page_type_monotone');
  }
  if (pages.some(page => page.page_title.length < 8 || page.page_title.length > 24)) issues.push('inner_page_title_invalid');
  if (pages.some(page => page.bullets.length < 3)) issues.push('inner_page_content_too_thin');
  // caption schema 已废弃；统一阈值与 prompt 要求的 280-420 对齐（给 60 字宽容）。
  const captionMin = 220;
  if (caption.length < captionMin || caption.length > 440) issues.push('caption_length_invalid');
  if (seoKeywords[0] && !caption.slice(0, 100).includes(seoKeywords[0])) issues.push('core_keyword_missing_from_opening');
  const editorialText = `${caption} ${pages.map(page => `${page.page_title} ${page.lead} ${page.bullets.join(' ')}`).join(' ')}`;
  if (hasForbiddenProductIdentity(productId, editorialText)) issues.push('product_identity_mismatch');
  if (/万能|必背|捷径|阅卷老师|考官|★/.test(editorialText)) issues.push('editorial_low_quality_phrase');
  // 断句破洞：生成/裁剪把词吞掉留下的残句，读者一眼能看出来。两类实锤模式：
  //   1) 标点/换行后紧跟"的"（正常行文不会出现"，的…"；排除"的确/的话"）；
  //   2) "这份/这套"后接动名词就断句——中心语被吞（job_009 实测
  //      "整理在这份备考，"——"备考资料"只剩前半）。
  if (/[\n，、；：。！？]的(?![确地话])/.test(editorialText)
    || /[这每][份套](?:备考|复习|自学|冲刺)[，、；：。！？]/.test(editorialText)) {
    issues.push('broken_sentence_hole');
  }
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
  // 带货强度：正文缺承接句。warn 级 + composeDraft 末尾 ensureProductBridge
  // 确定性补写，这里只负责让 checks/质检脚本能看到。
  if (!captionHasProductBridge(caption)) issues.push('caption_product_bridge_missing');
  return issues;
}

function isBlockingEditorialIssue(issue: string) {
  return classifyEditorialIssue(issue) === 'block';
}

function classifyEditorialIssue(issue: string): 'block' | 'autofix' | 'warn' {
  const warnIssues = new Set([
    // 运营/SEO/带货强度问题：应该提示或自动补，不应该中断生成。
    'core_keyword_missing_from_opening',
    'unsupported_product_quantity_claim',
    'overabsolute_public_rule',
    'unsupported_fixed_time_advice',
    'unsupported_exam_official_rule',
    'overmechanical_content_method',
    'public_inventory_relation_claim',
    'editorial_low_quality_phrase',
    // 带货承接缺失由 ensureProductBridge 确定性补写，绝不能 block 整个 job。
    'caption_product_bridge_missing',
    // 页型单调：prompt 已硬要求混排，没做到可见但不卡死 job。
    'inner_page_type_monotone',
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

function getProductSeoTags(productId: ProductId) {
  return skillData.seo_tags[productId];
}

function buildSeoKeywords(productId: ProductId, topic: MigratedTopic) {
  // 改：读 seo_tags.core_keywords（4-5 个大词），不再硬编码 3 个。
  // 旧 pipeline 用 variant-generator.ts 时读这套数据，新 pipeline 之前跳过，
  // 导致 15 篇 caption 的 SEO 关键词池子只有 3 个固定词。
  const seoData = getProductSeoTags(productId);
  const base = seoData?.core_keywords ?? [];
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

// 整池按 seed 洗牌（稳定：同 seed 同顺序）。注入道要的是"全池过滤后取前 N"，
// pickBySeedN 抽 N 个再过滤会在命中词稀疏时饿死整条道（24 词池 7 个能命中，
// 抽 6 个期望命中 1.75 < 2，selftest 实测整道空）。
function shuffleTagPool(pool: readonly string[], salt: string): string[] {
  return pool
    .map((word, i) => ({ word, k: stableHash(`${salt}:${i}:${word}`) }))
    .sort((x, y) => x.k - y.k)
    .map(entry => entry.word);
}

function normalizeTags(value: unknown, seoKeywords: string[], productId?: ProductId, contentContext = '', seed = 'default', recentTagCounts?: Map<string, number>, seedKeywords: readonly string[] = []) {
  const raw = Array.isArray(value) ? value.map(asString).filter(Boolean) : [];
  const ctxCompact = contentContext.replace(/\s+/g, '');
  // 新：从 seo_tags 数据池子按 seed 抽样，让 15 篇笔记的 tag 不再雷同。
  //   - predefinedTags：大词标签（#DELFB2 #法语B2 ...），抽 2 个
  //   - longTailTags：长尾关键词转成 #xxx 形式，抽 2 个
  //   - emojiTag：1 个表情符号
  const seoData = productId ? getProductSeoTags(productId) : null;
  const predefinedPool = seoData?.tags ?? [];
  const longTailPool = seoData?.long_tail_keywords ?? [];
  const pickedPredefined = pickBySeedN(predefinedPool, `${seed}-pre`, 2);
  // 长尾 tag 按 seed 随机注入实测出语义错配（时间分配篇挂 #法语写作替换词）。
  // 长尾词剥掉通用词根后剩下的"锚词"（替换词/范文/模板…）必须出现在本篇内容里，
  // 否则这个长尾词跟选题无关，不注入。
  const stripGenericTagRoots = (kw: string) => kw.replace(/DELF|DALF|TEF|TCF|NCLC|CLB|B2|法语|写作|作文|备考|Canada|production|écrite|\s+/gi, '');
  // 身份大词判定提前定义：下面"LLM tag 必须可被搜索"的过滤也要用它放行纯身份词。
  const IDENTITY_TAG_ROOTS = ['DELFB2', 'DALF', 'TEFTCF', 'NCLC', 'CLB', 'TEF', 'TCF', 'DELF', 'Canada', '法语', '写作', '作文', '备考', '考试', '学习', '考生', 'B2'];
  const isIdentityBigTag = (bare: string) => {
    let rest = bare;
    let changed = true;
    while (changed) {
      changed = false;
      for (const root of IDENTITY_TAG_ROOTS) {
        const next = rest.replace(new RegExp(root, 'i'), '');
        if (next !== rest) { rest = next; changed = true; }
      }
    }
    return rest.length === 0;
  };
  // 频率封顶按锚词判，不只按全名：历史里 #DELFB2议论文 用满 3 次后，fallback
  // 换个裸写法塞 #议论文 仍能漏网（selftest 实测）。把 ≥3 次的 tag 连同剥掉
  // 身份词根后的锚词一起做成集合，两处拦截点共用。
  const overusedAnchors = new Set<string>();
  if (recentTagCounts) {
    for (const [tag, count] of recentTagCounts) {
      if (count < 3) continue;
      overusedAnchors.add(tag.replace(/^#+/, '').toLowerCase());
      const anchor = stripGenericTagRoots(tag).toLowerCase();
      if (anchor) overusedAnchors.add(anchor);
    }
  }
  // fallback 只垫底：身份词直接可用，内容词必须锚定本篇内容——裸塞 #议论文
  // 到范文/正式信篇就是"时间分配篇挂 #法语写作替换词"的翻版（selftest cardB-D 实测）。
  const fallbacks = seoKeywords.slice(0, 5).filter(word => {
    const bare = word.replace(/\s+/g, '');
    if (isIdentityBigTag(bare)) return true;
    const anchor = stripGenericTagRoots(bare);
    return anchor.length >= 2 && (contentContext.includes(anchor) || ctxCompact.includes(anchor));
  });
  // tag 必须可被搜索（确定性拦截，与 core prompt 的 tag 硬规则同步）：
  // LLM 自己发明的描述型短语（#审题草稿技巧 #正文控时方法）没人搜，剥掉
  // 身份词根后锚词必须命中验证搜索词池，否则丢弃。池子来源的 tag 不查。
  const validatedPool = productId
    ? [...getXhsSearchKeywords(productId).primary, ...getXhsSearchKeywords(productId).secondary]
        .map(word => word.replace(/\s+/g, '').toLowerCase())
    : [];
  const rawSearchable = raw.filter(tag => {
    if (!productId || validatedPool.length === 0) return true;
    const bare = tag.replace(/^#+/, '').replace(/\s+/g, '');
    if (isIdentityBigTag(bare)) return true;
    const anchor = stripGenericTagRoots(bare);
    if (!anchor) return true;
    const a = anchor.toLowerCase();
    // 锚词包含池词时池词必须 ≥3 字：否则 #审题草稿技巧 靠 2 字池词"技巧"
    // 的子串匹配就能逃逸（实测漏网）。反向（锚词是池词的子串，如 7自测⊂clb7自测）
    // 任意长度都放行。
    const poolOk = validatedPool.some(word =>
      (word.length >= 3 && a.includes(word)) || (a.length >= 2 && word.includes(a)));
    if (!poolOk) return false;
    // 主题锚定：池子只保证"有人搜"，不保证"跟本篇搭"——论坛语气笔记挂
    // #DELFB2建议信、时态笔记挂 #DELFB2建议信 都过了池检查（实测 agent2
    // job_001 / agent1 job_004）。seed 配了关键词时，锚词必须出现在本篇内容
    // 或 seed 关键词里，否则丢弃。seed 未配置不查（避免误杀，与标题锚定同策略）。
    if (seedKeywords.length) {
      const contextual = anchor.length >= 2
        && (contentContext.includes(anchor) || ctxCompact.includes(anchor)
          || seedKeywords.some(kw => kw.toLowerCase().includes(a) || a.includes(kw.toLowerCase())));
      if (!contextual) return false;
    }
    // 万能 tag 频率封顶：#B2写作表达 这类池内"泛词"跟任何选题都配，11 篇模拟
    // 实测 6/11 篇都挂它——内容上下文匹配拦不住（建议信篇选题里写"建议"不写
    // "建议信"，首版误杀 37/66）。改用近期使用频率做确定性拦截：同一 tag 近期
    // 已出现在 ≥3 篇笔记里就丢弃，prompt 层 overused_tags 只降权不删，这里补刀。
    if (recentTagCounts && ((recentTagCounts.get(bare) || 0) >= 3 || overusedAnchors.has(a) || overusedAnchors.has(bare.toLowerCase()))) return false;
    return true;
  });
  const pickedLongTail = shuffleTagPool(longTailPool, `${seed}-lt`)
    .map(kw => kw.replace(/\s+/g, ''))
    .filter(kw => {
      const anchor = stripGenericTagRoots(kw);
      return anchor.length >= 2 && (contentContext.includes(anchor) || ctxCompact.includes(anchor));
    })
    .slice(0, 2);
  // 撤回 emoji 注入：用户实测发现 tag 里塞 emoji 在小红书算法上是降权信号，
  // 而且 emoji 跟学习类内容调性不符（让笔记显得轻浮）。昨天加的设计判断是错的。
  const seedTags = [...pickedPredefined, ...pickedLongTail];
  // 锚词占用表：LLM tag 先占坑，四条注入道抽到已占锚词的词就跳过换下一个。
  // 不互斥的话四条道各自随机再靠收口去重，等于每篇都围绕同一小撮锚词复读
  // （selftest 同内容 4 seed 实测 unique 只有 10）。
  const usedAnchors = new Set<string>();
  for (const tag of [...rawSearchable, ...pickedLongTail]) {
    const anchor = stripGenericTagRoots(tag.replace(/^#+/, '')).toLowerCase();
    if (anchor) usedAnchors.add(anchor);
  }

  // 2026-08-16 用户拍板 tag 方案：四条注入道各按 seed 随机 2 个，池子全量开放。
  //   ① 验证搜索词池直接注入（identity + 池词）
  //   ② seo_tags 数据池（predefined 2 + long_tail 2，上面已抽）
  //   ③ SEO 核心词/选题搜索词
  //   ④ 复合道（identity + 标题参考词池，池子扩到全量 secondary）
  // 加上 LLM 按正文写的 2 个内容词，最终 6-10 个。复合 tag 锚词必须出现在
  // 本篇内容里（contentContext 已含正文），锚词去重兜底防同词多份。
  // 旧病根：fallback 固定 slice(0,5) 全是身份词，占满身份上限后内容 tag
  // 全靠 LLM，LLM tag 再被窄内容匹配（只查选题+封面标题）误杀，7/7 篇
  // 只剩 2-3 个身份词（batch_1786838937231 实测）。
  const tagIdentityBase = productId ? getProductPromptProfile(productId).tagIdentity : 'DELFB2';
  const injectCompoundTags = (pool: readonly string[], salt: string, count: number) => {
    if (!productId || pool.length === 0) return [];
    // 整池洗牌后按序保留命中本篇内容的 count 个：抽固定个数再过滤会在
    // 命中词稀疏时饿死整条道（seed1 实测 0/2 命中）。
    return shuffleTagPool(pool, salt)
      .map(word => word.replace(/\s+/g, ''))
      .filter(word => {
        const anchor = stripGenericTagRoots(word);
        if (anchor.length < 2) return false;
        if (usedAnchors.has(anchor.toLowerCase())) return false;
        return ctxCompact.includes(anchor) || ctxCompact.toLowerCase().includes(anchor.toLowerCase());
      })
      .slice(0, count)
      .map(word => {
        const anchor = stripGenericTagRoots(word).toLowerCase();
        if (anchor) usedAnchors.add(anchor);
        return `${tagIdentityBase}${word}`;
      });
  };
  const validatedWords = productId
    ? [...getXhsSearchKeywords(productId).primary, ...getXhsSearchKeywords(productId).secondary]
    : [];
  const validatedCompound = injectCompoundTags(validatedWords, `${seed}-vp`, 2);
  const compoundFromValidated = injectCompoundTags(productId ? getTitleReferenceKeywords(productId) : [], `${seed}-compound`, 2);
  const seoCompound = pickBySeedN(seoKeywords, `${seed}-seo`, 2)
    .map(word => word.replace(/\s+/g, ''))
    .filter(word => {
      if (!word || isIdentityBigTag(word)) return false;
      const anchor = stripGenericTagRoots(word);
      if (anchor.length < 2) return false;
      if (usedAnchors.has(anchor.toLowerCase())) return false;
      return ctxCompact.includes(anchor) || ctxCompact.toLowerCase().includes(anchor.toLowerCase());
    })
    .map(word => {
      const anchor = stripGenericTagRoots(word).toLowerCase();
      if (anchor) usedAnchors.add(anchor);
      return `${tagIdentityBase}${word}`;
    });
  const normalized = [...rawSearchable, ...pickedLongTail, ...validatedCompound, ...compoundFromValidated, ...seoCompound, ...pickedPredefined, ...fallbacks]
    .map(tag => tag
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
    .filter(tag => !productId || !/^#(模板|范文|主题|技巧|格式|评分标准|真题|写作任务|句型|连接词|表达|段落|结构|开头|结尾)$/.test(tag))
    // 纯拉丁字 tag（#forum）：中文用户不搜英文 tag，只有考试身份词（DELFB2/
    // TEFCanada 这类）允许纯拉丁，其余丢弃（实测 agent2 job_001 挂 #forum）。
    .filter(tag => !/^[#A-Za-z0-9]+$/.test(tag) || isIdentityBigTag(tag.replace(/^#/, '')))
    // 统一收口：主题锚定和频率封顶之前只查 LLM 原始 tag（rawSearchable），
    // seedTags/fallbacks/compound 兜底来源不查——#DELFB2建议信 挂在论坛/
    // 投诉/性数笔记上、#DELFB2题型 ×4，全是从这条后门进来的（agent1 实测）。
    // 无论来源，非身份 tag 一律过同样的检查：seed 配了关键词时锚词必须出现
    // 在本篇内容或 seed 关键词里；同一 tag 近期 ≥3 篇用过就丢。
    .filter(tag => {
      const bare = tag.replace(/^#/, '');
      if (isIdentityBigTag(bare)) return true;
      const anchor = stripGenericTagRoots(bare);
      if (!anchor) return true;
      const a = anchor.toLowerCase();
      if (seedKeywords.length) {
        const contextual = anchor.length >= 2
          && (contentContext.includes(anchor) || ctxCompact.includes(anchor)
            || seedKeywords.some(kw => kw.toLowerCase().includes(a) || a.includes(kw.toLowerCase())));
        if (!contextual) return false;
      }
      if (recentTagCounts && ((recentTagCounts.get(bare) || 0) >= 3 || overusedAnchors.has(a) || overusedAnchors.has(bare.toLowerCase()))) return false;
      return true;
    });
  // 身份大词上限：#DELFB2 #法语写作 这类大词以前篇篇都出现（实测 96% 的笔记带
  // #DELFB2、86% 带 #法语写作），整个账号的 tag 像复读机。判定逻辑（剥通用词根）
  // 已上移到 seedTags 段之前，供"LLM tag 必须可被搜索"过滤共用。
  // 无论来源，纯身份大词最多保留 2 个。
  let identityKept = 0;
  // 锚词去重：#DELFB2真题 和 #法语B2真题 剥掉身份词根后锚词相同（真题），
  // 同篇并存就是同义复读（实测 agent1 job_002）。非身份 tag 按锚词只留第一个。
  const seenAnchors = new Set<string>();
  return Array.from(new Set(normalized))
    .filter(tag => !tag.includes('范文') || /范文|完整文章|全文示例/.test(contentContext))
    .filter(tag => !tag.includes('模板') || /模板|框架/.test(contentContext))
    .filter(tag => {
      if (!isIdentityBigTag(tag.replace(/^#/, ''))) return true;
      identityKept += 1;
      return identityKept <= 2;
    })
    .filter(tag => {
      const bare = tag.replace(/^#/, '');
      if (isIdentityBigTag(bare)) return true;
      const anchor = stripGenericTagRoots(bare).toLowerCase();
      if (!anchor) return true;
      if (seenAnchors.has(anchor)) return false;
      seenAnchors.add(anchor);
      return true;
    })
    .slice(0, 10);
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
    // LLM 偶尔把类型标注（资料型/解释型…）写进标题文字里（实测 5-agent 模拟
    // Agent D 全部 3 篇中招），title_type 才是类型该待的字段。这里剥离发生在
    // normalizeTitles/chooseSafeTitle 共用入口，候选与选中标题全覆盖。
    .replace(/[（(]\s*(?:资料型|解释型|强钩子型|情绪型|结果型)\s*[)）]/g, '')
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
    .replace(/换主题词就能/g, '换主题后重写语境再')
    .replace(/只替换主题词和例子/g, '围绕新题重写主题词和例子')
    .replace(/只替换主题词/g, '围绕新题重写主题词')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/\d+\s*篇范文/g, '范文库')
    .replace(/\d+\s*类识别表/g, '任务识别清单')
    .replace(/\d+\s*秒判对文体/g, '先判对文体')
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
    // 前面带数字/数词的"秒判"（三十秒判对文体 / 30秒判断）是正常中文，别改写
    .replace(/(?<![零一二两三四五六七八九十百千0-9〇])秒判/g, '快速判断')
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
    .replace(/换词就能迁移/g, '换主题后要重写语境')
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
    .replace(/考官追着给分/g, 'B2高阶表达')
    .replace(/考官最想要/g, '评分标准看重')
    .replace(/考官/g, '评分标准')
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
    .replace(/换主题词就能/g, '换主题后重写语境再')
    .replace(/只替换主题词和例子/g, '围绕新题重写主题词和例子')
    .replace(/只替换主题词/g, '围绕新题重写主题词')
    .replace(/就能快速组织出/g, '更容易组织出')
    .replace(/\d+\s*篇范文/g, '范文库')
    .replace(/\d+\s*类识别表/g, '任务识别清单')
    .replace(/\d+\s*秒判对文体/g, '先判对文体')
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
    // 前面带数字/数词的"秒判"（三十秒判对文体 / 30秒判断）是正常中文，别改写
    .replace(/(?<![零一二两三四五六七八九十百千0-9〇])秒判/g, '快速判断')
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
    .replace(/换词就能迁移/g, '换主题后要重写语境')
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
