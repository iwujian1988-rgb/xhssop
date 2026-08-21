import { callOpenAICompatibleJsonWithUsage, emptyAiUsage, mergeAiUsage, type AiUsageSummary } from '@/lib/ai-client';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import { getProductPromptProfile, hasForbiddenProductIdentity } from '@/lib/product-prompt-profiles';
import type { EvidenceSnippet, GeneratedInnerPage } from '@/types/reference-workflow';
import { REQUIRED_INNER_PAGE_COUNT, stableHash, type BridgePlan, type ContentBlock, type ContentBlockKind, type ContentPackage, type TemplateCapability, type TopicOption, V2_SCHEMA_VERSION, type VersionedArtifact } from './contracts';
import { buildConsensusBriefBlock, resolveContentBriefActive } from './content-brief';
import type { PublishIssue } from './publish-guard';
import type { ProductShowcasePlan } from '@/lib/product-showcase-library';

export const CONTENT_PROMPT_VERSION = 'v2-content-5';
export const AUDIT_PROMPT_VERSION = 'v2-audit-1';

interface ContentStageInput {
  topic: TopicOption;
  capability: TemplateCapability;
  evidence: EvidenceSnippet[];
  recentAngles?: string[];
  showcasePlan?: ProductShowcasePlan;
}

interface RawContentResponse {
  coverBlocks?: Array<Partial<ContentBlock> & Record<string, unknown>>;
  innerPages?: unknown[];
  captionParts?: ContentPackage['captionParts'] | Array<{ text?: string }>;
  tagMaterial?: unknown;
  factualClaims?: Array<Partial<ContentPackage['factualClaims'][number]> & { claim?: string }>;
  frenchSegments?: Array<Partial<ContentPackage['frenchSegments'][number]> & { original?: string }>;
  bridgePlan?: Partial<BridgePlan>;
}

export async function generateContentPackage(input: ContentStageInput): Promise<VersionedArtifact<ContentPackage>> {
  const profile = getProductPromptProfile(input.topic.productId);
  const templateSpec = getCoverTemplateSpec(input.capability.renderer);
  const isProductShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  // 阶段 C（设计 §5）：仅商品1普通模式开启的内容任务单增补；缺失字段软约束（只警告）。
  const briefActive = resolveContentBriefActive(input.topic.productId, isProductShowcase);
  const consensusBrief = briefActive ? buildConsensusBriefBlock(input.topic) : null;
  const compactTier = input.capability.densityTiers[0];
  const normalTier = input.capability.densityTiers[1] || compactTier;
  const evidence = input.evidence.slice(0, 10).map(item => ({
    id: item.id,
    category: item.category,
    text: item.text,
    evidence: item.evidence,
    caution: item.usage_caution,
  }));
  const promptInput = {
    product: { id: input.topic.productId, identity: profile.noteIdentity, scope: profile.contentScopePrompt, exam_rules: profile.examFactRules },
    topic: input.topic,
    cover_contract: {
      compiler: input.capability.compiler,
      accepted_block_kinds: input.capability.acceptedBlockKinds,
      language_policy: input.capability.languagePolicy,
      density_tiers: input.capability.densityTiers,
      required_output: {
        target_sections: normalTier.sectionRange[1],
        minimum_sections: compactTier.sectionRange[0],
        items_per_section: normalTier.itemRange,
        absolute_minimum_items_per_section: compactTier.itemRange[0],
        maximum_primary_visible_units: normalTier.primaryVisualLength[1],
        maximum_secondary_visible_units: normalTier.secondaryVisualLength[1],
      },
      template_content_instruction: templateSpec?.contentInstruction || '',
      template_forbidden_instruction: templateSpec?.forbiddenInstruction || '',
    },
    evidence,
    conversion_asset_ids: evidence
      .filter(item => ['raw_selling_points', 'knowledge_assets', 'displayable_assets', 'content_modules'].includes(item.category))
      .map(item => item.id),
    recent_angles_to_avoid: (input.recentAngles || []).slice(0, 10),
    product_showcase_contract: isProductShowcase ? {
      enabled: true,
      note_type: '商品介绍型笔记：整篇介绍知识库/资料包本身，不是假装分享一个孤立知识点',
      cover: '优先展示真实商品结构：目录、模块、资料页、样张或大字价值主张；封面文字必须回答“这套资料对谁有什么用”',
      inner_pages: ['这套资料解决什么备考问题', '里面具体有什么模块/目录', '展示1到2个真实样张或使用方法', '适合谁、什么时候用、如何承接购买'],
      caption: '开头先点明法语考试对象和用户状态，再展示资料结构与具体获得感；不要把正文写成普通科普后只在结尾硬塞商品',
      forbidden: ['把商品写成课程、老师服务或一对一辅导', '只说“资料很全/整理好了”而不展示具体内容', '用一个知识点冒充整套商品介绍'],
      selected_angle: input.showcasePlan?.angle,
      selected_cover_asset: input.showcasePlan?.coverAsset,
      selected_inner_assets: input.showcasePlan?.innerAssets,
    } : { enabled: false },
    editorial_contract: {
      caption_visible_units: [320, 700],
      caption_value_paragraphs: [3, 5],
      each_value_paragraph_visible_units: [45, 120],
      seo_primary_must_appear_in_first_100_units: true,
      paid_product_cta: true,
      forbid_free_or_private_message_cta: true,
      register_every_exam_or_product_number_in_factualClaims: true,
      no_unverified_statistics: true,
    },
    // 阶段 C：门控关闭（商品2/3、showcase）时该键完全不出现，promptInput 键集合与现状一致。
    ...(consensusBrief ? { consensus_brief: consensusBrief.block } : {}),
  };
  const inputHash = stableHash(promptInput);
  // 阶段 C：新增说明行只在门控开启时加入；关闭时数组与现状逐字一致（字节锁定）。
  const consensusBriefSystemLines = briefActive ? [
    'consensus_brief 是本篇内容任务单的增补：本篇说话动作与开头情绪起势必须落实在正文第一段，也就是 captionParts.opening 里，不得写成通用开场或自我介绍。consensus_brief 中留空的项不自行编造。',
    '标题与正文的承诺都不得超出 consensus_brief.标题可承诺范围 列出的核心结果、可展开内容与事实锚词；范围之外的承诺句不要写。',
    '除原有字段外，再在响应中新增 bridgePlan 字段，按四拍各写一句完整中文：freeSolves=本篇免费内容先解决什么；userStillNeeds=读者照本篇做完后还缺什么；whyProduct=商品为什么能接上（只锚定 consensus_brief.带货承接计划 给出的能力与模块，不得编造输入之外的商品功能）；naturalCta=最后如何自然引导查看商品。四拍缺一不可，只返回 JSON 的约束不变。',
  ] : [];
  const result = await callOpenAICompatibleJsonWithUsage<RawContentResponse>([
    {
      role: 'system',
      content: [
        '你是资深小红书法语教育内容编辑。只写本篇内容，不写文字标题、封面标题或标题候选。',
        '封面内容、内页、正文必须围绕同一个选题，但承担不同信息：封面给最值得扫读的短内容，内页解释和举例，正文补体验与商品承接。',
        isProductShowcase
          ? '本篇是商品介绍型笔记，不是普通知识分享：封面、内页、正文都要围绕“这套法语备考知识库/资料包有什么、适合谁、怎么用、为什么值得买”展开。封面展示目录/模块/样张/价值主张；内页必须至少有一页具体目录或模块、一页真实内容样张/使用方式；正文开头就点明商品和用户场景，后面用具体模块说明获得感，不能只在结尾加一句“资料已整理好”。'
          : '',
        isProductShowcase && input.showcasePlan
          ? `本次已经由程序选定商品展示角度“${input.showcasePlan.angle.label}”：${input.showcasePlan.angle.instruction}。封面截图是“${input.showcasePlan.coverAsset.label}”。内页必须按下面5张截图逐张对应说明，不得串图：${input.showcasePlan.innerAssets.map((asset, index) => `第${index + 1}张｜模块：${asset.moduleLabel || asset.sourceSection}｜截图：${asset.label}｜图中内容：${asset.realContent}｜用户价值：${asset.userValue}`).join('；')}。每张图的page_title、lead和bullets只解释对应截图，不要另起一个主题，也不要把截图里的原始内容当成普通科普题。`
          : '',
        'coverBlocks输出语义块候选池，不需要精确填满模板格子；每条必须完整，不能为了短而截半句。',
        '目录/词表类信息要密但可读；经验/痛点类必须是自然中文段落或完整短句，禁止伪装真人经历；文档解析类必须保留原句、解释、迁移用途。',
        '科普方法、解释和练习示例可原创；商品包含什么、数量和能力只能引用给定evidence并填写sourceIds。',
        '复述考试数字时，数字和量词必须一起严格沿用evidence：题、部分、科、项、分钟、小时、词不得互换或模糊改写。无法确认原单位就删掉该数字，不要凭常识改写。',
        '讲评分时，只能复述official_exam_fact明确给出的维度和档位含义。AI原创正反例必须标成“练习示例”，不能写成官方0分/5分标准答案或考官精确判分依据。',
        '法语词句必须准确，法语与中文释义对应；所有法语放入frenchSegments并用path指回原字段。',
        '正文控制在450-750个中文可见字左右，开头自然出现主SEO词，不用“不是…而是…”“真正的…”“建议收藏”等AI套话。',
        'captionParts.value必须恰好写4段，每段60到110个可见字；4段分别承担事实或判断、具体对比或方法、练习动作、使用提醒，不要把一个要点扩成两百字长段。',
        '正文必须有具体干货和自然购买承接，但不写开发意图、页面说明或“这一页最值得收藏”。',
        '任何页面标题或导语只要承诺“几类错误、几种原因、几个方法、几个步骤”，本页bullets就必须逐条完整列够这个数量；列不全就改成不带数量的标题，不能用总数包装残缺列表。',
        'captionParts.productBridge必须落到conversion_asset_ids中的至少1项具体商品资产：说明这项资料能接住本篇哪个问题，并在factualClaims登记对应商品事实和sourceIds。不得只写“资料已整理好、需要可看看”这类空承接。',
        '本项目售卖的是知识库/资料包，不是课程、网课、批改或一对一服务。不得把商品写成课程，也不得编造研究、调查、考官原话或无证据数据。',
        '除给定官方事实外，不要编“每段80/150词、每个论据50词、很多考生卡在230词”等数字规律；方法建议用结构和动作表达。',
        '用户可见内容不得出现D-003、FW-007、KA-001这类内部资料ID；要直接说资料里有什么和怎么用。',
        '扩写观点不能建议“换种说法反复阐述同一观点”，应补充理由、机制、具体例子、影响或让步回应，避免同义反复。',
        '若选题涉及TEF/TCF怎么选，只能客观比较官方题型、任务形式、时长和目标项目认可情况；不得写“擅长/喜欢长文就选TEF、反应快就选TCF”等按单一强弱项下结论。可给的决策动作是：先确认目标项目认可范围，再分别体验官方样题和真实任务形式后决定。',
        '同一段既有官方数字事实又有学习建议时，必须先用完整句写事实并登记factualClaims，再另起完整句写建议；不要把事实、偏好和推荐揉成一句。',
        '内页标题若承诺“练习示例、正反例、从X到Y”，该页必须给出完整可核对的内容；不能只写一句标题或用几十词片段冒充完整250词范文。',
        'tagMaterial只给与正文实际内容相关的词根，不加#，不堆身份大词。',
        '只返回JSON对象，字段严格为coverBlocks、innerPages、captionParts、tagMaterial、factualClaims、frenchSegments。captionParts必须一次写完整，value数组固定4个非空字符串。innerPages必须恰好5页。',
        'coverBlocks每项必须是{id,kind,heading,items:[{primary,secondary,note}],priority,sourceMode,sourceIds}；items禁止使用字符串数组。',
        '必须优先遵守cover_contract.required_output和template_content_instruction。coverBlocks数量不得少于minimum_sections，每个block的items不得少于absolute_minimum_items_per_section；长解释放innerPages，不得用少写组数规避封面密度。',
        '每条primary和secondary还必须分别不超过maximum_primary_visible_units和maximum_secondary_visible_units。文档解析中的法语句必须完整且简短，不得通过截断句子达到限制。',
        'innerPages必须恰好5项，每项是{page_type,page_title,lead,bullets,source_ids}，每页至少3条具体内容；captionParts必须是{opening,value,productBridge,cta}对象。',
        'factualClaims每项必须是{text,type,sourceIds}；frenchSegments每项必须是{path,text,translation}。禁止使用旧字段title/content/examples/claim/original。',
        ...consensusBriefSystemLines,
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(promptInput) },
  ], { maxTokens: 5200, temperature: 0.72, retries: 2 });

  let content: ContentPackage;
  const normalizationWarnings: string[] = [];
  try {
    content = normalizeContent(result.data, input, evidence.map(item => item.id), normalizationWarnings);
  } catch (cause) {
    throw attachStageContext(cause, 'content', result.usage);
  }
  const briefFieldWarnings = (consensusBrief?.missing || []).map(field => `共识内容任务单字段缺失：${field}，对应提示留空`);
  const warnings = [...normalizationWarnings, ...briefFieldWarnings, ...validateContent(content, input)];
  return artifact(content, inputHash, result.usage, result.requestId, warnings);
}

function attachStageContext(cause: unknown, stage: 'content' | 'audit', usage: AiUsageSummary) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  Object.assign(error, { v2Stage: stage, usage });
  return error;
}

export async function auditContentPackage(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: Pick<ContentStageInput, 'topic' | 'evidence'>,
): Promise<VersionedArtifact<ContentPackage>> {
  const content = artifactInput.data;
  if (!content.frenchSegments.length) return artifactInput;
  const profile = getProductPromptProfile(input.topic.productId);
  const auditInput = {
    product: profile.auditScopePrompt,
    french_segments: content.frenchSegments,
  };
  const result = await callOpenAICompatibleJsonWithUsage<{
    approved?: boolean;
    corrections?: Array<{ path?: string; text?: string; translation?: string; reason?: string }>;
    issues?: string[];
  }>([
    {
      role: 'system',
      content: [
        '你是法语准确性审校员，只检查法语拼写、语法、固定搭配及对应中文释义。',
        '不要改文风、标题、结构和普通学习建议。只返回确定错误，不做可选润色。',
        'corrections中的path必须原样取自french_segments；text/translation只填需要替换的值。',
        '只返回JSON：approved、corrections、issues。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(auditInput) },
  ], { maxTokens: 1800, temperature: 0.1, retries: 1 });
  let corrections: Array<{ path?: string; text?: string; translation?: string; reason?: string }>;
  let next: ContentPackage;
  let unresolved: string[];
  try {
    corrections = Array.isArray(result.data.corrections) ? result.data.corrections : [];
    next = structuredClone(content);
    for (const correction of corrections) applyCorrection(next, correction);
    unresolved = Array.isArray(result.data.issues)
      ? result.data.issues.filter(Boolean).filter(issue => !isNoIssueStatement(issue))
      : [];
    if (result.data.approved === false && corrections.length === 0 && unresolved.length) {
      throw new Error(`法语/事实审校未通过：${unresolved.join('；')}`);
    }
  } catch (cause) {
    throw attachStageContext(cause, 'audit', mergeAiUsage(artifactInput.usage, result.usage));
  }
  return {
    ...artifactInput,
    data: next,
    prompt_version: `${CONTENT_PROMPT_VERSION}+${AUDIT_PROMPT_VERSION}`,
    input_hash: stableHash({ previous: artifactInput.input_hash, auditInput }),
    created_at: new Date().toISOString(),
    usage: mergeAiUsage(artifactInput.usage, result.usage),
    warnings: [...artifactInput.warnings, ...unresolved.map(item => `审校提醒：${item}`)],
    request_id: result.requestId,
  };
}

export async function repairContentPackage(
  artifactInput: VersionedArtifact<ContentPackage>,
  input: ContentStageInput,
  issues: PublishIssue[],
): Promise<VersionedArtifact<ContentPackage>> {
  const profile = getProductPromptProfile(input.topic.productId);
  const isProductShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  const evidence = input.evidence.slice(0, 12).map(item => ({
    id: item.id,
    category: item.category,
    text: item.text,
    evidence: item.evidence,
    caution: item.usage_caution,
  }));
  const repairInput = {
    product: { identity: profile.noteIdentity, scope: profile.contentScopePrompt, exam_rules: profile.examFactRules },
    topic: input.topic,
    template: {
      renderer: input.capability.renderer,
      accepted_block_kinds: input.capability.acceptedBlockKinds,
      density_tiers: input.capability.densityTiers,
      instruction: getCoverTemplateSpec(input.capability.renderer)?.contentInstruction || '',
    },
    exact_failures: issues,
    evidence,
    existing_content: {
      coverBlocks: issues.some(item => item.code.startsWith('cover_') || item.code.includes('claim') || item.code.includes('fact'))
        ? artifactInput.data.coverBlocks
        : artifactInput.data.coverBlocks.map(block => ({ heading: block.heading, kind: block.kind, items: block.items.slice(0, 2) })),
      innerPages: issues.some(item => item.code.includes('claim') || item.code.includes('fact'))
        ? artifactInput.data.innerPages
        : artifactInput.data.innerPages.map(page => ({ page_title: page.page_title, lead: page.lead, bullets: page.bullets.slice(0, 2) })),
      captionParts: artifactInput.data.captionParts,
      factualClaims: artifactInput.data.factualClaims,
    },
  };
  const result = await callOpenAICompatibleJsonWithUsage<RawContentResponse>([
    {
      role: 'system',
      content: [
        '你是小红书法语教育内容的定向返修编辑。只修复 exact_failures，不改变原选题、商品、封面模板和已正确内容。',
        isProductShowcase
          ? '这是商品介绍型笔记的返修：保留“展示知识库/资料包本身”的主线。若修封面，补具体目录、模块、样张或使用场景；若修内页/正文，不能把它改回普通知识分享，必须保留商品结构和购买理由。'
          : '',
        '只返回需要替换的字段补丁，可用字段为 coverBlocks、innerPages、captionParts、tagMaterial、factualClaims、frenchSegments；不要回显 product、topic、template、evidence、existing_content 或 exact_failures。',
        '如果失败只涉及正文，只返回 captionParts；如果只涉及封面，只返回 coverBlocks；涉及事实时同时返回 factualClaims。',
        '数组字段一旦返回就是完整替换值，不是局部片段：coverBlocks必须返回满足模板最低组数和每组条数的完整数组；innerPages必须返回完整5页且每页至少3条；captionParts.value必须完整返回3到5段。',
        '封面条目必须满足模板组数、每组条数和单条长度；长解释移到内页，禁止截断半句话。',
        '正文写 320-700 个可见字，至少 3 段具体干货；主 SEO 词自然出现在前 100 字；商品承接指向付费商品，不写免费领取、私信领取。',
        'captionParts.productBridge必须引用evidence中的具体商品资产，说明它与本篇问题的关系；同时在factualClaims登记对应product事实和sourceIds。禁止只写“资料已整理好、需要可看看”这类空承接。',
        '用户可见内容不得出现内部资料ID；每段必须是完整内容，禁止只返回“练习示例：从X到Y”这种空段。',
        '所有考试规则、题数、时长、字数、商品数量都必须逐条登记到 factualClaims，并引用能直接支持原句和数字的 sourceIds；没有证据就删掉或改成不含该事实的通用学习建议。',
        '返修考试事实时，数字和量词必须一起按evidence原文恢复；题、部分、科、项、分钟、小时、词不能互换。禁止只保留正确数字却改错单位。',
        '讲评分时，只能复述官方事实卡明确给出的维度和档位含义。AI原创正反例必须标成“练习示例”，不能写成官方0分/5分标准答案或考官精确判分依据。',
        '若exact_failures含oversimplified_exam_choice，删除所有“擅长/喜欢某种任务就选TEF或TCF”的个性化结论，改为：客观对比题型与任务形式，先确认目标项目认可范围，再分别体验官方样题后决定。',
        '若exact_failures含risky_fact_not_registered，不要把官方事实和个人偏好揉在同一句；只保留evidence直接支持的事实并登记sourceIds，学习建议另起一句且不得伪装成考试规则。',
        '法语与中文释义必须对应，并继续维护 frenchSegments 的 path、text、translation。',
        '“评分标准、考官扣分、官方要求”等表述只能引用 official_exam_fact；商品自查表不能冒充官方评分标准。只返回 JSON。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(repairInput) },
  ], { maxTokens: 2800, temperature: 0.3, retries: 1 });
  let content: ContentPackage;
  const normalizationWarnings: string[] = [];
  try {
    const patch = result.data as RawContentResponse;
    const hasPatchField = ['coverBlocks', 'innerPages', 'captionParts', 'tagMaterial', 'factualClaims', 'frenchSegments']
      .some(key => Object.prototype.hasOwnProperty.call(patch, key));
    if (!hasPatchField) throw new Error('V2定向返修没有返回任何可应用字段');
    const touchesCover = issues.some(item => item.path?.startsWith('coverBlocks') || item.code.startsWith('cover_'));
    const touchesInnerPages = issues.some(item => item.path?.startsWith('innerPages'));
    const touchesCaption = issues.some(item => item.path?.startsWith('captionParts') || item.code.startsWith('caption_') || item.code.includes('product_bridge'));
    const compact = input.capability.densityTiers[0];
    const merged: RawContentResponse = {
      coverBlocks: touchesCover
        ? mergeCoverPatch(artifactInput.data.coverBlocks, patch.coverBlocks, compact.sectionRange[0], compact.itemRange[0])
        : artifactInput.data.coverBlocks.map(block => ({ ...block })) as RawContentResponse['coverBlocks'],
      innerPages: touchesInnerPages ? mergePagePatch(artifactInput.data.innerPages, patch.innerPages) : artifactInput.data.innerPages,
      captionParts: touchesCaption ? mergeCaptionPatch(artifactInput.data.captionParts, patch.captionParts) : artifactInput.data.captionParts,
      tagMaterial: artifactInput.data.tagMaterial,
      factualClaims: Array.isArray(patch.factualClaims) ? patch.factualClaims : artifactInput.data.factualClaims,
      frenchSegments: artifactInput.data.frenchSegments,
      // 阶段 C：定向返修不重写承接计划，沿用已解析的四拍，避免重复警告/丢字段。
      bridgePlan: artifactInput.data.bridgePlan,
    };
    content = normalizeContent(merged, input, evidence.map(item => item.id), normalizationWarnings);
  } catch (cause) {
    throw attachStageContext(cause, 'content', mergeAiUsage(artifactInput.usage, result.usage));
  }
  return {
    ...artifactInput,
    data: content,
    prompt_version: `${CONTENT_PROMPT_VERSION}+targeted-repair-1`,
    input_hash: stableHash({ previous: artifactInput.input_hash, issues }),
    created_at: new Date().toISOString(),
    usage: mergeAiUsage(artifactInput.usage, result.usage),
    warnings: [...normalizationWarnings, ...validateContent(content, input)],
    request_id: result.requestId,
  };
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
  patch.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const page = raw as Record<string, unknown>;
    const previous = original[index];
    const patchBullets = unique(page.bullets);
    const bullets = patchBullets.length >= 3
      ? patchBullets
      : Array.from(new Set([...patchBullets, ...(previous?.bullets || [])])).slice(0, 8);
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

function isNoIssueStatement(value: string) {
  return /^(?:未发现|没有发现|无)(?:明确)?(?:的)?(?:法语|商品|考试|事实|拼写|语法|错误|问题)/.test(value.trim())
    || /(?:未发现|无).*(?:错误|问题)/.test(value.trim());
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
  let innerPages = normalizePages(raw.innerPages);
  if (innerPages.length !== REQUIRED_INNER_PAGE_COUNT) {
    console.warn('[v2-pages-normalized]', JSON.stringify({
      product_id: input.topic.productId,
      template_id: input.topic.templateId,
      raw_pages: Array.isArray(raw.innerPages) ? raw.innerPages.length : 0,
      normalized_pages: innerPages.length,
      response_preview: JSON.stringify(raw).slice(0, 5000),
    }));
    if (innerPages.length < REQUIRED_INNER_PAGE_COUNT) {
      // 与 publish-guard 的补页警告同口径：程序凑数页必须可见，便于统计触发频率。
      normalizationWarnings.push(`本篇内页由程序从 ${innerPages.length} 页补齐到 ${REQUIRED_INNER_PAGE_COUNT} 页，补充 ${REQUIRED_INNER_PAGE_COUNT - innerPages.length} 页为固定模板页（非AI生成），建议人工复核`);
    }
    innerPages = ensureInnerPageCount(innerPages, coverBlocks, input);
  }
  const caption = normalizeCaptionParts(raw.captionParts);
  const bridgePlan = normalizeBridgePlan(raw, input, normalizationWarnings);
  const content: ContentPackage = {
    topicSnapshotHash: stableHash(input.topic),
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
    frenchSegments: (Array.isArray(raw.frenchSegments) ? raw.frenchSegments : [])
      .map(item => ({ path: clean(item.path), text: clean(item.text) || clean(item.original), translation: clean(item.translation) || undefined }))
      .filter(item => item.path && item.text && containsAuditableFrench(item.text)),
  };
  if (hasForbiddenProductIdentity(input.topic.productId, JSON.stringify(content))) throw new Error('V2内容阶段发生商品身份串线');
  return content;
}

/**
 * 阶段 C（设计 §5）：解析带货承接四拍计划。软约束——缺失或部分缺失只警告，
 * 绝不让任务失败；四拍完整才写入 ContentPackage（保持类型简单，不存半成品）。
 * 仅商品1普通模式消费该字段；legacy 路径 raw 里没有 bridgePlan 也不会有任何行为。
 */
function normalizeBridgePlan(raw: RawContentResponse, input: ContentStageInput, normalizationWarnings: string[]): BridgePlan | undefined {
  const isProductShowcase = input.topic.primaryGoal === 'conversion' || input.topic.topicLane === 'product_value';
  if (!resolveContentBriefActive(input.topic.productId, isProductShowcase)) return undefined;
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
  return value.slice(0, 6).map((raw, index) => {
    const page = raw && typeof raw === 'object' ? raw as Partial<GeneratedInnerPage> : {};
    const allowed = ['knowledge_list', 'example_explain', 'wrong_right', 'steps', 'product_bridge'];
    return {
      page_no: index + 2,
      page_type: allowed.includes(String(page.page_type)) ? page.page_type as GeneratedInnerPage['page_type'] : 'knowledge_list',
      page_title: clean(page.page_title) || clean((page as Record<string, unknown>).title),
      lead: clean(page.lead) || clean((page as Record<string, unknown>).content),
      bullets: normalizeBullets(page.bullets).concat(normalizeBullets((page as Record<string, unknown>).examples)).slice(0, 8),
      source_ids: unique(page.source_ids),
      style_variant: page.style_variant,
    };
  }).filter(page => page.page_title && page.bullets.length >= 2);
}

function normalizeBullets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(item => {
    if (typeof item === 'string') return clean(item);
    if (!item || typeof item !== 'object') return '';
    const record = item as Record<string, unknown>;
    return clean(record.text) || clean(record.content) || clean(record.primary);
  }).filter(Boolean)));
}

function ensureInnerPageCount(
  pages: GeneratedInnerPage[],
  coverBlocks: ContentBlock[],
  input: ContentStageInput,
): GeneratedInnerPage[] {
  const result = [...pages];
  const evidenceBullets = coverBlocks.flatMap(block => block.items.map(item => (
    [block.heading, item.primary, item.secondary, item.note].filter(Boolean).join('：')
  ))).filter(Boolean);
  const fallbackBullets = evidenceBullets.length >= 3
    ? evidenceBullets
    : input.topic.promise.split(/[；。]/u).map(clean).filter(Boolean);
  if (fallbackBullets.length < 3) fallbackBullets.push('结合本篇主题完成一次替换练习', '把这一页内容和自己的情况对照一遍', '记下一个下一步可以执行的动作');
  const sourceIds = unique(coverBlocks.flatMap(block => block.sourceIds));
  const fallbackTypes: GeneratedInnerPage['page_type'][] = input.capability.family === 'offer'
    ? ['product_bridge', 'knowledge_list', 'example_explain', 'steps', 'product_bridge']
    : ['steps', 'knowledge_list', 'example_explain', 'wrong_right', 'steps'];
  const fallbackTitles = input.capability.family === 'offer'
    ? ['这份资料适合怎么查', '里面具体整理了什么', '拿一页内容举个例子', '按这个顺序使用', '最后看它能帮你什么']
    : ['先把核心问题看懂', '这页知识怎么记', '放进例子里看一遍', '常见错误怎么避开', '最后这样练一遍'];
  const fallbackLeads = input.capability.family === 'offer'
    ? '先看本页，再按自己的情况继续往下查。'
    : '先看懂这一页，再用一个小练习确认自己会用。';
  while (result.length < REQUIRED_INNER_PAGE_COUNT) {
    const index = result.length;
    result.push({
      page_no: index + 2,
      page_type: fallbackTypes[index] || 'knowledge_list',
      page_title: fallbackTitles[index] || `第${index + 1}页继续看`,
      lead: fallbackLeads,
      bullets: Array.from(new Set([
        ...fallbackBullets.slice((index * 2) % Math.max(fallbackBullets.length, 1), ((index * 2) % Math.max(fallbackBullets.length, 1)) + 6),
        ...fallbackBullets.slice(0, 3),
      ])).slice(0, 8),
      source_ids: sourceIds,
    });
  }
  return result.slice(0, REQUIRED_INNER_PAGE_COUNT).map((page, index) => ({ ...page, page_no: index + 2 }));
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
  return {
    opening: clean(caption.opening),
    value: unique(caption.value).slice(0, 6),
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

function validateContent(content: ContentPackage, input: ContentStageInput): string[] {
  const warnings: string[] = [];
  const caption = [content.captionParts.opening, ...content.captionParts.value, content.captionParts.productBridge, content.captionParts.cta].join('\n');
  if (!caption.includes(input.topic.seo.primary)) warnings.push('正文开头或正文未自然出现主SEO词');
  if (caption.length < 350) warnings.push('正文信息量偏少');
  if (content.coverBlocks.reduce((sum, block) => sum + block.items.length, 0) < input.capability.densityTiers[0].sectionRange[0] * input.capability.densityTiers[0].itemRange[0]) warnings.push('封面候选内容未达到compact密度，编译时可能降级');
  return warnings;
}

function applyCorrection(content: ContentPackage, correction: { path?: string; text?: string; translation?: string }) {
  const path = clean(correction.path);
  const segment = content.frenchSegments.find(item => item.path === path);
  if (!segment) return;
  if (correction.text) segment.text = clean(correction.text);
  if (correction.translation) segment.translation = clean(correction.translation);
  const match = /^coverBlocks\[(\d+)]\.items\[(\d+)]\.(primary|secondary|note)$/.exec(path);
  if (!match) return;
  const block = content.coverBlocks[Number(match[1])];
  const item = block?.items[Number(match[2])];
  if (!item) return;
  const key = match[3] as 'primary' | 'secondary' | 'note';
  if (correction.text) item[key] = clean(correction.text);
  if (correction.translation && key === 'primary') item.secondary = clean(correction.translation);
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
