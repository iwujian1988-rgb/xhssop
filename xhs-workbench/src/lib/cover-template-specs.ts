import type { ContentShape, CoverTitleType, CreativeCardRenderer } from '@/types/reference-workflow';
import { countVisibleUnits } from '@/lib/v2/contracts';

export type CoverVisualDensity = 'low' | 'medium' | 'high' | 'very_high';

export interface CoverTemplateSpec {
  /** Cover preview policy; source text/counts are never rewritten. */
  displayPolicy?: { titleMaxLines: number; minFontScale: number; previewLines: number; subtitleLines: number };
  renderer: CreativeCardRenderer;
  name: string;
  family: ContentShape;
  renderMode: 'code' | 'hybrid' | 'image_to_image';
  sectionCount: number;
  itemsPerSection: number;
  /** 参考图与信息流实测后的可用范围；sectionCount/itemsPerSection 仅保留为推荐上限。 */
  sectionRange?: [number, number];
  itemRange?: [number, number];
  minTotalItems: number;
  /** 参考图与信息流实测后的整张封面上限，避免所有分组同时顶满后只能缩小字号。 */
  maxTotalItems?: number;
  maxPrimaryVisualLength: number;
  maxSecondaryVisualLength: number;
  contentInstruction: string;
  titleInstruction: string;
  allowedCoverTitleTypes?: CoverTitleType[];
  forbiddenInstruction: string;
  /** 封面主标题长度区间，默认 [8, 18]。official_notice 公文标题天然更长，单独放宽。 */
  titleLengthRange?: [number, number];
  titleMinVisibleChars?: number;
  titlePreferredMinChars?: number;
  titlePreferredMaxChars?: number;
  titleMaxVisibleChars?: number;
  titleMaxLines?: number;
  subtitleMaxVisibleChars?: number;
  subtitleMaxLines?: number;
  kickerSupported?: boolean;
  kickerMaxVisibleChars?: number;
  preferredTextAlign?: 'left' | 'center' | 'right';
  /** true = 本模板 primary 必须是纯法语词/搭配（中文只能出现在 secondary）。
   *  getCoreIssues 据此做确定性检查，混入中文直接 block 走 repair。 */
  primaryFrenchOnly?: boolean;
  notePartCount?: number;
  /** 规定哪些文字必须在信息流缩略图中读清，避免把背景密表误当成逐字阅读区。 */
  feedTextMode?: 'all_readable' | 'headline_and_groups' | 'headline_only';
  /** 生产选题合同：用于模板页说明，并由选题闸门阻止明显不匹配的内容。 */
  productionFit?: 'ready' | 'limited' | 'disabled';
  suitableTopics?: string[];
  incompatibleTopics?: string[];
  mismatchAction?: string;
}

/** 封面主标题长度是否合规（未配置时用默认 [8, 18]）。 */
export function isCoverTitleLengthOk(spec: Pick<CoverTemplateSpec, 'titleLengthRange'> | undefined, length: number) {
  const [min, max] = spec?.titleLengthRange || [8, 18];
  return length >= min && length <= max;
}

/** 封面主标题长度上限（clip 用）。 */
export function coverTitleMaxlength(spec: Pick<CoverTemplateSpec, 'titleLengthRange'> | undefined) {
  return (spec?.titleLengthRange || [8, 18])[1];
}

const directory = (renderer: CreativeCardRenderer, name: string): CoverTemplateSpec => ({
  renderer, name, family: 'directory', renderMode: 'code', sectionCount: 5, itemsPerSection: 5,
  sectionRange: [4, 5], itemRange: [4, 6], minTotalItems: 22, maxTotalItems: 28, feedTextMode: 'headline_and_groups',
  maxPrimaryVisualLength: 32, maxSecondaryVisualLength: 18,
  contentInstruction: '输出4到5个互不重复的知识分组，每组按原始资料的表格行/对照行放4到6个短知识单元，总数必须达到22到28条；不足22条视为生成失败，必须补充新的有效短条目，不能用重复项凑数。目录页要接近参考图的高密度资料页：顶部保留醒目主标题，下面用多组真实的词、短语、分类、对照或规则行压满内容区；不要只放几条孤立 bullet，也不要用空白凑高级感。primary写法语词/短语或中文知识标签，secondary写简短中文解释；长解释移到内页。',
  titleInstruction: '封面标题写“法语领域或考试名+具体资料对象”，直接说明图中有什么；副标题补充范围、使用场景或收益。',
  forbiddenInstruction: '禁止用空泛标签凑数，禁止把长句硬塞进封面，禁止制造官方不存在的数量规则，禁止使用[Madame/Monsieur]这类方括号占位符号，人称/称谓要写具体的词（如Monsieur、Madame）而不是用斜杠或方括号列出选项。',
});

const userCodeSpec = (
  renderer: CreativeCardRenderer,
  name: string,
  family: ContentShape,
  sectionCount: number,
  itemRange: [number, number],
  minTotalItems: number,
  maxTotalItems: number,
  contentInstruction: string,
): CoverTemplateSpec => ({
  renderer, name, family, renderMode: 'code', sectionCount, itemsPerSection: itemRange[0],
  sectionRange: [sectionCount, sectionCount], itemRange, minTotalItems, maxTotalItems,
  maxPrimaryVisualLength: 42, maxSecondaryVisualLength: 64, feedTextMode: 'headline_and_groups',
  contentInstruction,
  titleInstruction: `标题必须直接说明“考试/学科 + 具体资料对象”，并与${name}的内容结构一致。`,
  forbiddenInstruction: '禁止套用其他学科的示例内容，禁止虚构官方出处、年份、题量、分数与个人经历。',
});

export const coverTemplateSpecs: Record<Exclude<CreativeCardRenderer, 'ai_scene_overlay'>, CoverTemplateSpec> = {
  dazibao_html: {
    renderer: 'dazibao_html', name: '原生大字报图生图封面', family: 'pain', renderMode: 'image_to_image', sectionCount: 1, itemsPerSection: 1,
    sectionRange: [1, 1], itemRange: [1, 1], minTotalItems: 1, maxTotalItems: 1, feedTextMode: 'headline_only',
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 24, titleLengthRange: [4, 32], titleMaxLines: 4,
    contentInstruction: '只保留 Native Title 的封面短标题和一句必要副标题；参考图只提供真实小红书大字报的字体、留白、强调和手工感。',
    titleInstruction: '复用 Title Package 的 coverTitle，并在图生图 prompt 中做最小 posterTitle 压缩。',
    forbiddenInstruction: '禁止 HTML/CSS 程序排版、知识卡、网页Hero、商务海报、复杂页脚、页码、年份、参数和大量小字。',
    productionFit: 'ready', suitableTopics: ['经验', '备考路线', '工具', '避坑', '时间规划', '实战'], incompatibleTopics: ['商品截图'],
    mismatchAction: '仅用于普通内容笔记；商品笔记保持原有封面流程。',
  },
  parchment_dense_directory: directory('parchment_dense_directory', '羊皮纸高密度资料目录'),
  white_green_directory: {
    ...directory('white_green_directory', '白底绿字知识清单'),
    sectionCount: 4,
    itemsPerSection: 5,
    sectionRange: [4, 4],
    itemRange: [6, 8],
    minTotalItems: 28,
    maxTotalItems: 32,
    feedTextMode: 'headline_and_groups',
    contentInstruction: '输出4个互不重复的知识分组，每组按参考图的多列清单密度放6到8个短知识单元，总数至少28条、最多32条；各组不必等量。标题和分组名在手机信息流一眼扫懂，正文保留成排词语、对照和短解释，形成“翻开就是一整套资料”的视觉密度；长解释移到内页。',
  },
  clean_purple_directory: {
    renderer: 'clean_purple_directory', name: '白底紫色知识资料', family: 'directory', renderMode: 'code', sectionCount: 4, itemsPerSection: 5,
    sectionRange: [4, 4], itemRange: [6, 8], minTotalItems: 28, maxTotalItems: 32, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 16,
    contentInstruction: '输出4个知识分组，每组按参考图的打印资料密度放6到8个短条目，总数至少28条、最多32条；各组不必等量。primary写法语词、短语或知识标签，secondary写极短中文解释。保持整页资料感：标题和分组名读清，内容区用成排对照条目填满，不做稀疏卡片。',
    titleInstruction: '标题直接说明法语领域或考试名与资料对象，适合打印资料页。',
    forbiddenInstruction: '禁止长解释、空泛口号、虚构官方数量和无法在资料页中展示的内容。',
  },
  grid_purple_directory: {
    renderer: 'grid_purple_directory', name: '网格纸紫色知识体系', family: 'directory', renderMode: 'code', sectionCount: 5, itemsPerSection: 6,
    sectionRange: [5, 6], itemRange: [6, 8], minTotalItems: 30, maxTotalItems: 40, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 16,
    contentInstruction: '输出5到6个知识分组，每组按参考图的网格表格密度放6到8个短条目，总数至少30条、最多40条；各组不必等量。每条primary是核心词、短语或知识标签，secondary是极短解释。网格资料页必须真实压屏：主标题和分组读清，内容区保留多行表格/对照格，不得改成稀疏展示。',
    titleInstruction: '标题必须是法语领域或考试名加完整知识对象，像一张可打印的知识体系总表。',
    forbiddenInstruction: '禁止长句、空泛标签和过多说明文字，禁止生成不适合放进表格的段落内容。',
  },
  blackboard_phrase: {
    renderer: 'blackboard_phrase', name: '黑板短语密集表', family: 'phrase', renderMode: 'hybrid', sectionCount: 2, itemsPerSection: 9,
    sectionRange: [2, 2], itemRange: [9, 12], minTotalItems: 18, maxTotalItems: 24, primaryFrenchOnly: true, feedTextMode: 'all_readable',
    // 正式信开头/结尾本身常超过 40 个可见字符；允许完整换行展示，不能为过闸门截断固定表达。
    maxPrimaryVisualLength: 100, maxSecondaryVisualLength: 36,
    contentInstruction: '输出2组可直接使用的法语短语，每组9到12条，总数至少18条、最多24条；两组不必等量。primary只放完整法语短语，secondary只放准确、简短的中文用途或释义，保持参考图两列/三列的密集短语表，不要为了留白删掉真实内容。',
    titleInstruction: '封面标题突出一个明确用途，例如“法语写作衔接短语”；副标题说明使用场景。',
    forbiddenInstruction: '禁止生成残缺法语、杜撰固定搭配或把整句例句塞进短语表。',
  },
  blackboard_offer: {
    renderer: 'blackboard_offer', name: '黑板大字方案说明', family: 'offer', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 1,
    sectionRange: [3, 3], itemRange: [1, 1], minTotalItems: 3, maxTotalItems: 3, feedTextMode: 'all_readable',
    maxPrimaryVisualLength: 24, maxSecondaryVisualLength: 20,
    contentInstruction: '输出3个大字证据块，每块正好1条，分别说适合谁、解决什么、资料里具体有什么。每条必须是有信息量的完整短句，建议主文案12到24个可见字，并尽量补充8到16个可见字的具体说明；禁止只写“结构、表达、练习”这类几个字的标签来凑块数。手机信息流一眼能读清；只能写商品证据可证明的模块和能力。',
    titleInstruction: '大标题说清法语对象和具体需求，副标题给可信的使用方式，不写课程招募口吻。',
    forbiddenInstruction: '禁止虚构老师资历、直播课、一对一、答疑、陪学或商品不存在的服务。',
  },
  memo_offer: {
    renderer: 'memo_offer', name: '备忘录资料说明', family: 'offer', renderMode: 'code', sectionCount: 4, itemsPerSection: 2,
    sectionRange: [4, 4], itemRange: [1, 2], minTotalItems: 4, maxTotalItems: 6, feedTextMode: 'all_readable',
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 24,
    contentInstruction: '输出4个备忘录小节，每节按内容放1到2条；依次说明适合人群、使用场景、资料内容和使用要求。各节不必等量，所有文字必须完整可读。',
    titleInstruction: '此模板特例：封面 title 必须是一句具体痛点+损失感的整句钩子（如"DELF B2格式分老丢的人先看"、"DELF B2写作这一步最容易忽略"）。禁止写"·题型备忘录"、"·题型说明"、"·资料说明"这类说明书式命名；副标题再补资料说明口吻。',
    forbiddenInstruction: '禁止冒充真人履历，禁止写不存在的课程服务和效果保证。',
    // Renderer 没有独立、可见且消费 coverKicker 的原生区域。
    kickerSupported: false,
  },
  word_flashcard: {
    renderer: 'word_flashcard', name: '印刷式词卡', family: 'flashcard', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 3, minTotalItems: 9, primaryFrenchOnly: true,
    sectionRange: [3, 3], itemRange: [3, 3], maxTotalItems: 9, feedTextMode: 'all_readable',
    maxPrimaryVisualLength: 32, maxSecondaryVisualLength: 14,
    contentInstruction: '输出3组各3个同类法语词或极短表达。primary必须是真实存在、拼写正确的完整法语词或短语，不得截断或拼接多个词；secondary是中文含义，note是1到4字的用法提示。',
    titleInstruction: '标题只讲一个词汇专题，避免把多个知识主题混在一张词卡。',
    forbiddenInstruction: '禁止长词组、整句、错误词性、拼接出的不存在词形和不在同一语义组的随机拼接。',
  },
  book_cover: {
    renderer: 'book_cover', name: '法语教材封面风', family: 'book', renderMode: 'image_to_image', sectionCount: 2, itemsPerSection: 2, minTotalItems: 3,
    sectionRange: [2, 2], itemRange: [1, 2], maxTotalItems: 4, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 32,
    contentInstruction: '输出2组各2条，概括本篇的核心主题和包含内容，像一本专题小册子的封底提要。',
    titleInstruction: '标题像专题手册名，必须包含法语领域和明确主题；副标题写学习收益。',
    forbiddenInstruction: '禁止冒充官方教材、出版社、证书或真实出版物。',
  },
  notebook_big_words: {
    renderer: 'notebook_big_words', name: '手写本痛点大字', family: 'pain', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 1, minTotalItems: 3,
    sectionRange: [3, 3], itemRange: [1, 1], maxTotalItems: 3, feedTextMode: 'all_readable',
    maxPrimaryVisualLength: 22, maxSecondaryVisualLength: 20,
    contentInstruction: '输出3条递进短句：用户现状、反差判断、解决方向。每条只表达一层意思，像真人随手写下的提醒。',
    titleInstruction: '封面正文只承载3条痛点短句，所以 title 必须是反常识/情绪型钩子（描述一类具体考生的痛点，比如"卡在某个具体环节""反复犯某个具体错误""用错某个具体方法"），让人一眼共鸣。禁止写"X 大全""X 清单""X 资料库""X 整理"这类具体内容型标题——本模板承载不了资料承诺，那种标题请走 dense_directory 类模板。副标题补一句反差/追问。不要使用固定套话式钩子（如"总差一点"），要结合本选题写具体场景。',
    forbiddenInstruction: '禁止假装本人通过考试，禁止虚构分数、时间和个人经历。',
  },
  plain_experience: {
    renderer: 'plain_experience', name: '极简经验长图', family: 'experience', renderMode: 'code', sectionCount: 1, itemsPerSection: 4, minTotalItems: 4,
    sectionRange: [1, 1], itemRange: [4, 4], maxTotalItems: 4, feedTextMode: 'all_readable',
    // 小红书信息流缩略图需要先看清标题，再读两条经验判断。
    // 长段落会迫使整张封面缩字，详细解释应该放到内页和正文。
    maxPrimaryVisualLength: 34, maxSecondaryVisualLength: 0,
    contentInstruction: '输出1个分组，分组内正好4条完整的经验判断，每条18到34个可见字；按“具体困境—错误动作—关键判断—下一步”递进。一条只说一层，不写成课程提纲或长文。详细例子和解释放内页。没有用户提供的真实经历时，不得使用"还记得我/我后来发现/我的整理方法/我考前/我上岸/我亲测"等伪第一人称经历，只写可被普遍验证的观察和建议。',
    titleInstruction: '封面正文有4条递进经验判断，所以 title 必须在信息流里单独可懂：说清考试/人群和具体困境，再给反常识、情绪或结果钩子。禁止“别乱抓”“这样就够”等离开上下文就不知所云的句子；也禁止写"X 大全""X 清单""X 资料库""X 整理好了"这类资料承诺。副标题补充主标题没说的反差或下一步。',
    forbiddenInstruction: '禁止虚构第一人称成绩、身份、留学或考试经历。',
  },
  document_analysis: {
    renderer: 'document_analysis', name: '文档素材解析', family: 'document', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 4,
    sectionRange: [3, 3], itemRange: [4, 5], minTotalItems: 12, maxTotalItems: 15, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 44, maxSecondaryVisualLength: 24,
    contentInstruction: '固定输出3个文档小节，每节4到5条，总数12到15条；三个小节分别承担题目、观点和衔接等不同功能。至少包含6条完整且准确的法语原句或例句，primary放完整法语，secondary放中文解释或可迁移用法；每条不能只有几个字的标签，必须有可读的例句、观点或具体用法说明。标题与小节名在信息流必须读清，正文小字承担素材证明，不要求在缩略图逐字阅读。知识库无原句时标注为AI示例，不伪装真题。',
    titleInstruction: '标题写清DELF B2/法语写作和本次解析主题。',
    forbiddenInstruction: '禁止伪造真题出处、年份、官方原文或未经证实的评分结论。',
  },
  vocab_table: {
    renderer: 'vocab_table', name: '主题词汇表压屏', family: 'table', renderMode: 'image_to_image', sectionCount: 4, itemsPerSection: 4, minTotalItems: 16, primaryFrenchOnly: true,
    sectionRange: [3, 4], itemRange: [4, 6], maxTotalItems: 20, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 72, maxSecondaryVisualLength: 32,
    contentInstruction: '输出3到4个主题组，每组4到6条法语词、短搭配或完整功能表达，总数至少16条；各组不必等量。中央大标题与分组名在手机信息流必须读清，表格内容允许自动换行并在点开后阅读；不要为了缩短而截断固定结构，也不要为了密度生成错误或重复表达。',
    titleInstruction: '中央大标题写考试/法语领域+词汇专题；副标题写主题数量或应用场景。',
    forbiddenInstruction: '禁止把解释性长句放进表格，禁止混入错误词形和重复词。',
  },
  course_roadmap: {
    renderer: 'course_roadmap', name: '蓝色学习路径信息图', family: 'roadmap', renderMode: 'image_to_image', sectionCount: 4, itemsPerSection: 3, minTotalItems: 12,
    sectionRange: [4, 4], itemRange: [3, 4], maxTotalItems: 16, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 18, maxSecondaryVisualLength: 22,
    contentInstruction: '输出4个连续阶段，每阶段3到4条：阶段目标、核心任务、练习动作、可检查结果；总数12到16条，各阶段不必等量。主标题、阶段名和每阶段第一条在信息流必须读清，其余为点开后的补充。路径必须与当前主题一致。',
    titleInstruction: '标题写法语人群+学习路径或备考安排；副标题交代适用阶段。',
    forbiddenInstruction: '禁止承诺固定天数提分，禁止虚构课时、教材、辅导和学习权利。',
  },
  collocation_dense: {
    renderer: 'collocation_dense', name: '三列固定搭配密表', family: 'phrase', renderMode: 'code', sectionCount: 5, itemsPerSection: 9, primaryFrenchOnly: true,
    sectionRange: [5, 6], itemRange: [8, 10], minTotalItems: 36, maxTotalItems: 54, feedTextMode: 'headline_and_groups',
    maxPrimaryVisualLength: 100, maxSecondaryVisualLength: 28,
    contentInstruction: '输出5到6组法语固定搭配或功能表达，每组8到10条，总数至少36条、最多54条；各组不必等量。primary是完整且可独立使用的法语搭配或句式，secondary必须逐条给出准确中文释义；按表达功能或考试任务分组，复刻参考图多列密表的资料量。所有primary全页唯一，不得重复，不得用同一句改写凑数，也不得留下空释义。对on、mais、après等中性词只能说明具体语境和替换目的，禁止武断写成一律避免或一律口语。主标题和分组名在信息流必须读清，条目点开后可读。',
    titleInstruction: '标题写法语领域+固定搭配专题；副标题说明用于写作、口语或备考。',
    forbiddenInstruction: '禁止截断介词、漏重音符号、重复搭配或用机器直译充数。',
  },
  official_notice: {
    renderer: 'official_notice', name: '备考通知单', family: 'offer', renderMode: 'image_to_image', sectionCount: 3, itemsPerSection: 1, minTotalItems: 3,
    sectionRange: [3, 3], itemRange: [1, 1], maxTotalItems: 3, feedTextMode: 'all_readable',
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 24,
    // 公文标题"关于……的通知"天然 14-22 字，18 字上限会把它掐死。
    titleLengthRange: [10, 22],
    contentInstruction: '输出3段通知正文，每段正好1条完整短句，依次写适用对象、这次提醒的具体事项、下一步怎么做。三段都必须在手机信息流完整可读，不写空泛公告腔，也不编日期和机构。',
    titleInstruction: '封面 title 必须是真实公文格式："关于 + 备考对象 + 具体动作 + 的通知"（如"关于做好 DELF B2 写作考前自查的通知"/"关于 TCF 听力备考常见问题排查的通知"/"关于 TEF Canada 写作格式重点提示的通知"）。备考对象写考试+科目（DELF B2 写作 / DELF B2 口语 / TCF 听力 / TEF 写作 等），具体动作用公文常见措辞（考前自查 / 常见问题排查 / 重点提示 / 考前提醒 / 阶段安排 / 重点核查）。禁止"官方通知""重要公告"这类空泛措辞；禁止"X 大全""X 清单""X 整理"资料型标题；禁止小红书钩子口吻（如"停一下"/"看过来"/"先查这 X 项"/"必看"/"赶紧"等口号）。副标题作为"藏原因制造好奇"的钩子（如"评分要点先看这一项"/"最容易丢的分在第三项"/"考前一周的同学重点关注"），保留公文感、不写感叹号和口号词。',
    forbiddenInstruction: '禁止冒充官方机构、考试院、使领馆、出版社；禁止虚构截止日期、报名名额、限量福利；禁止写课程招募、直播课、答疑服务。',
  },
  pain_quote_big: {
    renderer: 'pain_quote_big', name: '极简痛点金句', family: 'pain', renderMode: 'code', sectionCount: 3, itemsPerSection: 1, minTotalItems: 3,
    sectionRange: [3, 3], itemRange: [1, 1], maxTotalItems: 3, feedTextMode: 'headline_only',
    maxPrimaryVisualLength: 24, maxSecondaryVisualLength: 16,
    // 完整金句"身份+栽在考试上+钩子"拼装后常到 19-22 字，默认 18 上限会误杀。
    titleLengthRange: [10, 24],
    contentInstruction: '输出3个短成分，合成一条脱离上下文也能看懂的痛点金句：第1条点明考生或场景，第2条说具体卡点或错误动作，第3条给反差、后果或行动钩子。三条连读必须是一句自然中文，封面不虚构室友、同学、分数或个人经历。',
    titleInstruction: '封面 title 写一条完整、自足的痛点金句，必须包含考试/科目关键词和一个具体卡点，让用户只看封面就知道在说什么。可以暂不揭晓解决方法，但不能把原因也藏到不知所云；副标题只补充反差或后果。禁止资料清单式标题。',
    forbiddenInstruction: '禁止虚构室友、同学、分数、年份和个人经历；禁止“快看看因为啥”“猜猜为啥”这类空钩子；禁止只写考试名加情绪而不说明具体问题；禁止塞资料列表或课程卖点。',
  },
  ielts_speaking_toc: {
    ...userCodeSpec('ielts_speaking_toc', '法语考试题库目录', 'directory', 3, [7, 10], 22, 30, '输出3个真实的法语考试内容分组，每组7到10条，总数22到30条；每条是题型、主题或训练任务名与极短中文说明，复刻目录的点线与页码组织，不沿用雅思Part命名。'),
    productionFit: 'ready', suitableTopics: ['DELF/TEF/TCF题库目录', '高频主题目录', '写作或口语任务分类'], incompatibleTopics: ['单一语法点', '真人经历', '长文解析'], mismatchAction: '阻止生成并推荐语法格、手写解析或四段框架模板。',
  },
  criminal_law_formula: {
    ...userCodeSpec('criminal_law_formula', '红黑写作公式清单', 'directory', 1, [14, 14], 14, 14, '必须只输出1个coverBlock且正好14条法语考试写作或口语公式；primary写任务名或功能名，secondary写由“结构 + 动作 + 检查点”组成的可执行公式。若选题承诺的类别少于14类，就把每类拆成不同且不重复的执行动作，仍需填满14行。只复刻红黑编号清单，不生成任何刑法内容。'),
    productionFit: 'ready', suitableTopics: ['写作结构公式', '口语答题公式', '审题与自查公式'], incompatibleTopics: ['词汇表', '范文逐句解析', '情绪经验'], mismatchAction: '阻止生成并推荐词汇密表或手写解析模板。',
  },
  english_grammar_grid: {
    ...userCodeSpec('english_grammar_grid', '三列法语语法速记格', 'table', 12, [2, 3], 24, 36, '必须输出12个互不重复的法语语法或表达模块，每格2到3条完整规则、口诀、短例句或使用提醒；覆盖时态、语式、代词、连接、语域等不同模块，不能把同一分组名重复三次凑格子。只复刻三列网格版式。'),
    productionFit: 'ready', suitableTopics: ['法语语法体系', '高频错误速记', '句型功能分类'], incompatibleTopics: ['长段范文', '个人经验', '单一题目'], mismatchAction: '阻止生成并推荐文章精读或痛点模板。',
  },
  french_gender_vocab: {
    ...userCodeSpec('french_gender_vocab', '三列法语词汇密表', 'table', 3, [12, 14], 36, 42, '输出3个法语词汇或表达功能组，每组12到14条，总数36到42条；primary写简短法语词或搭配，secondary写不超过6个汉字的准确义项。分组必须按DELF/TEF/TCF写作主题或表达功能，不得沿用原图的阴阳性、性数配合或单复数概念。保持三列密表并保证点开后完整可读，不得用重复项凑密度。'),
    maxPrimaryVisualLength: 30, maxSecondaryVisualLength: 12,
    titleInstruction: '标题直接写DELF/TEF/TCF与本次真实词汇或表达专题；禁止出现“阴阳性”“性数配合”“单复数表”，原图只提供三列视觉版式。',
    forbiddenInstruction: '禁止沿用原图的阴阳性、性数配合或单复数内容；禁止长释义、长句、重复词和不完整搭配。',
    primaryFrenchOnly: true, productionFit: 'limited', suitableTopics: ['主题词汇', '固定搭配', '连接表达', '动词与名词搭配'], incompatibleTopics: ['写作步骤', '范文解析', '个人经历', '纯中文清单'], mismatchAction: '手动选择时返回 template_topic_mismatch，并推荐目录、解析或四段框架模板；不静默换模板。',
  },
  mao_article_notes: {
    ...userCodeSpec('mao_article_notes', '手写法语素材精读', 'document', 3, [2, 3], 8, 8, '必须输出3个素材或范文分组、合计正好8条；primary写完整而简短的法语原句、观点关键词或段落功能，secondary写中文解析，note写可迁移用法或使用提醒。每条三层信息都要具体，铺满手写纸版心。只复刻手写精读的组织方式。'),
    renderMode: 'hybrid', productionFit: 'limited', suitableTopics: ['范文精读', '真题/模拟题拆解', '主题观点素材解析'], incompatibleTopics: ['纯词汇表', '学习路径', '空泛经验'], mismatchAction: '缺少可追溯原句时标注AI示例；题材不符则阻止并推荐词汇密表或路径模板。',
  },
  english_grammar_notebook: {
    ...userCodeSpec('english_grammar_notebook', '手账法语语法口诀', 'document', 1, [9, 10], 9, 10, '输出9到10条法语语法速记；primary写语法点或错误名，secondary写准确规则、短口诀与必要例子。只复刻手账笔记组织，不生成英语内容。'),
    renderMode: 'hybrid', productionFit: 'ready', suitableTopics: ['法语语法口诀', '易错规则', '时态语式速记'], incompatibleTopics: ['词汇大表', '写作路径', '真人经历'], mismatchAction: '阻止生成并推荐三列词汇密表或四段框架模板。',
  },
  french_oral_question_bank: {
    ...userCodeSpec('french_oral_question_bank', '法语双语高密度长清单', 'document', 1, [15, 16], 15, 16, '只复刻双语长清单的组织方式。输出15到16条直接服务当前选题的法中双语条目：题库类选题可写完整问题或写作任务；方法、句型、观点类选题应写对应的法语句型、例句或观点及中文解释，禁止为了凑“题库”形态改成与标题无关的通用考题。'),
    primaryFrenchOnly: true,
    productionFit: 'ready', suitableTopics: ['法语口语或写作题库', '同主题双语例句', '句型清单', '观点清单', '方法步骤清单'], incompatibleTopics: ['无法拆成15条法中对应短条目的长篇叙事'], mismatchAction: '只有当前内容无法拆成15到16条法中对应条目时才阻止；不得仅因它不是问句而拒绝。',
  },
  french_a1_practice_sheet: {
    notePartCount: 4,
    ...userCodeSpec('french_a1_practice_sheet', '法语四项拆解资料页', 'directory', 1, [7, 8], 7, 8, '必须只输出1个coverBlock，里面7到8个主项；每项note必须用“｜”分隔正好4个真实、互不重复、可以直接阅读的短支项。primary写观点、概念、任务或主题，secondary只写一句极短说明。支项可以是佐证、维度、词语、表达或步骤，不强制做选择题。严禁“选项一/选项二/选项三/选项四”“示例一”“待补充”等占位内容。只复刻“一主项+四支项”的练习纸组织方式。'),
    productionFit: 'ready', suitableTopics: ['一个观点＋四个佐证', '一个概念＋四个维度', '一个主题＋四个词或表达', '语法自测与辨析'], incompatibleTopics: ['长篇叙事', '单条金句', '无法拆成并列四项的内容'], mismatchAction: '只有内容无法拆成四个并列支项时才阻止，并推荐手写解析或经验模板。',
  },
  sat_vocab_dictionary: {
    ...userCodeSpec('sat_vocab_dictionary', '法语进阶词汇词典页', 'table', 1, [22, 22], 22, 22, '输出22个与当前DELF/TEF/TCF主题一致的法语进阶词或短搭配；primary写法语词条，secondary写准确中文释义，note写简短法语例句或用法。只复刻词典页结构。'),
    primaryFrenchOnly: true, productionFit: 'ready', suitableTopics: ['主题进阶词汇', '写作替换词', '高频动词搭配'], incompatibleTopics: ['学习路径', '范文长文', '情绪经验'], mismatchAction: '阻止生成并推荐路径或手写解析模板。',
  },
  ielts_task1_four_part: {
    ...userCodeSpec('ielts_task1_four_part', '法语写作四段框架', 'roadmap', 4, [3, 4], 14, 16, '输出4个连续写作段落或答题阶段，每组3到4条；primary写可直接迁移的法语句型或动作，secondary写中文任务与替换说明。不沿用雅思Task 1内容。'),
    productionFit: 'ready', suitableTopics: ['DELF B2四段写作', 'TEF/TCF任务结构', '审题到检查的四步路径'], incompatibleTopics: ['单词表', '单一语法点', '长篇经历'], mismatchAction: '阻止生成并推荐词汇密表、语法格或经验模板。',
  },
  showcase_screenshot: {
    renderer: 'showcase_screenshot', name: '知识库截图+程序叠字', family: 'offer', renderMode: 'hybrid', sectionCount: 1, itemsPerSection: 1, minTotalItems: 1,
    maxPrimaryVisualLength: 34, maxSecondaryVisualLength: 30,
    sectionRange: [1, 1], itemRange: [1, 1], maxTotalItems: 1, feedTextMode: 'headline_only',
    contentInstruction: '封面只显示真实知识库截图、主标题和副标题；仅输出1条与截图直接对应的价值证据供内页使用，不生成封面上看不见的条目。',
    titleInstruction: '封面标题优先写“法语/考试对象 + 具体用户关系 + 资料获得感或结果”，可以使用资料、大全、稀缺、时效、情绪、结果、反常识等方向；不要只写“知识库介绍”或“资料包”。',
    forbiddenInstruction: '禁止修改截图里的原始内容；禁止编造截图未展示的商品数量；禁止把截图型封面做成课程招募或纯空口号。',
  },
};

const coverTitleTypesByRenderer: Record<Exclude<CreativeCardRenderer, 'ai_scene_overlay'>, CoverTitleType[]> = {
  dazibao_html: ['情绪', '反常识', '结果', '时效', '资料'],
  parchment_dense_directory: ['资料', '大全', '时效', '稀缺'],
  white_green_directory: ['资料', '大全', '时效', '稀缺'],
  clean_purple_directory: ['资料', '大全', '时效', '稀缺'],
  grid_purple_directory: ['资料', '大全', '时效', '稀缺'],
  blackboard_phrase: ['资料', '大全', '稀缺', '结果'],
  blackboard_offer: ['情绪', '结果', '反常识', '时效'],
  memo_offer: ['情绪', '结果', '反常识'],
  word_flashcard: ['资料', '稀缺', '反常识'],
  book_cover: ['资料', '大全', '稀缺', '结果'],
  notebook_big_words: ['情绪', '反常识', '结果'],
  plain_experience: ['情绪', '反常识', '结果'],
  document_analysis: ['资料', '情绪', '反常识', '稀缺'],
  vocab_table: ['资料', '大全', '时效', '稀缺'],
  course_roadmap: ['结果', '时效', '大全'],
  collocation_dense: ['资料', '大全', '稀缺'],
  official_notice: ['资料', '时效', '稀缺', '结果'],
  pain_quote_big: ['情绪', '反常识', '结果'],
  ielts_speaking_toc: ['资料', '大全', '时效'],
  criminal_law_formula: ['资料', '大全', '稀缺'],
  english_grammar_grid: ['资料', '大全', '结果'],
  french_gender_vocab: ['资料', '大全', '稀缺'],
  mao_article_notes: ['资料', '稀缺', '结果'],
  english_grammar_notebook: ['资料', '大全', '结果'],
  french_oral_question_bank: ['资料', '大全', '时效'],
  french_a1_practice_sheet: ['资料', '大全', '结果'],
  sat_vocab_dictionary: ['资料', '大全', '稀缺'],
  ielts_task1_four_part: ['资料', '结果', '大全'],
  showcase_screenshot: ['资料', '大全', '稀缺', '时效', '情绪', '结果', '反常识'],
};

for (const renderer of Object.keys(coverTitleTypesByRenderer) as Exclude<CreativeCardRenderer, 'ai_scene_overlay'>[]) {
  coverTemplateSpecs[renderer].allowedCoverTitleTypes = coverTitleTypesByRenderer[renderer];
}

export function getCoverTemplateSpec(renderer: CreativeCardRenderer) {
  if (renderer === 'ai_scene_overlay') return undefined;
  const spec = coverTemplateSpecs[renderer];
  const [min, max] = spec.titleLengthRange || [8, 18];
  return {
    ...spec,
    displayPolicy: spec.displayPolicy ?? {
      titleMaxLines: spec.titleMaxLines ?? 2,
      minFontScale: spec.family === 'pain' ? 0.86 : 0.8,
      previewLines: spec.family === 'flashcard' ? 3 : spec.family === 'pain' ? 2 : 3,
      subtitleLines: spec.subtitleMaxLines ?? 2,
    },
    titleMinVisibleChars: spec.titleMinVisibleChars ?? min,
    titlePreferredMinChars: spec.titlePreferredMinChars ?? Math.max(min, max - 5),
    titlePreferredMaxChars: spec.titlePreferredMaxChars ?? max,
    titleMaxVisibleChars: spec.titleMaxVisibleChars ?? max,
    titleMaxLines: spec.titleMaxLines ?? 2,
    subtitleMaxVisibleChars: spec.subtitleMaxVisibleChars ?? 24,
    subtitleMaxLines: spec.subtitleMaxLines ?? 2,
    // 只有 Renderer 明确渲染动态 coverKicker 时才可设为 true。
    // 当前封面 Renderer 的 EXAM NOTE 等字样是静态装饰，不消费 coverKicker。
    kickerSupported: spec.kickerSupported ?? false,
    kickerMaxVisibleChars: spec.kickerMaxVisibleChars ?? 16,
    preferredTextAlign: spec.preferredTextAlign ?? 'left',
  };
}

/** Use the measured renderer contract as the single source of visual density. */
export function coverVisualDensity(renderer: CreativeCardRenderer): CoverVisualDensity {
  const spec = getCoverTemplateSpec(renderer);
  if (!spec || spec.feedTextMode === 'headline_only' || spec.minTotalItems <= 4) return 'low';
  if (spec.minTotalItems <= 10) return 'medium';
  if (spec.minTotalItems <= 17) return 'high';
  return 'very_high';
}

export function minimumAverageCoverItemUnits(renderer: CreativeCardRenderer) {
  const density = coverVisualDensity(renderer);
  // These layouts reserve large visual regions. A structurally valid handful
  // of tiny labels would still leave the published cover visibly empty.
  if (renderer === 'blackboard_offer') return 12;
  if (renderer === 'memo_offer') return 12;
  if (renderer === 'notebook_big_words') return 12;
  if (renderer === 'plain_experience') return 14;
  if (renderer === 'document_analysis') return 16;
  return density === 'low' ? 6 : density === 'medium' ? 5 : density === 'high' ? 4.5 : 3.5;
}

/** Counts alone cannot prove that the rendered content area is visually filled. */
export function coverVisualFullnessFailure(
  renderer: CreativeCardRenderer,
  blocks: Array<{ items: Array<{ primary: string; secondary?: string; note?: string }> }>,
): string | undefined {
  // These designs derive fullness from their background artwork or headline.
  if (renderer === 'showcase_screenshot' || renderer === 'book_cover' || renderer === 'pain_quote_big') return undefined;
  const visibleItems = coverDisplayBlocks(renderer, blocks).flatMap(block => block.items);
  if (!visibleItems.length) return 'visual_density';
  const totalUnits = visibleItems.reduce((sum, item) => sum
    + countVisibleUnits(item.primary)
    + countVisibleUnits(item.secondary || '') * 0.55
    + countVisibleUnits(item.note || '') * 0.35, 0);
  return totalUnits / visibleItems.length < minimumAverageCoverItemUnits(renderer)
    ? 'visual_density'
    : undefined;
}

// 解析选题/承诺文本里的"条目数量承诺"（N项/N条/N步/N个开头…）。
// 用途：发牌时过滤物理上兑现不了的数量承诺，精修选题时兜底回退 LLM 新造的数字。
// 刻意排除分钟/秒/小时/天/周/种/档/分：它们是时长、分类事实或分数，不是条目数。
// N=0/1 不算承诺；多个数量取最大（主承诺）。返回 null 表示没有数量承诺。
const PROMISE_COUNT_UNIT = '(?:个问题|个要点|个步骤|个开头|个收尾|个救命题|个动作|个维度|个场景|个检查点|个信号|个陷阱|个错误|个表达|个句型|个主题|道题|篇|项|步|招|条|类|组|句|题|个)';
export function parseContentPromiseCount(text: string): number | null {
  const counts = [...String(text).matchAll(new RegExp(`(\\d{1,3})\\s*${PROMISE_COUNT_UNIT}`, 'g'))]
    .map(match => Number.parseInt(match[1], 10))
    .filter(count => Number.isFinite(count) && count >= 2);
  return counts.length ? Math.max(...counts) : null;
}

export function getCoverTemplatePrompt(renderer: CreativeCardRenderer) {
  const spec = getCoverTemplateSpec(renderer);
  if (!spec) return '';
  const sectionRange = spec.sectionRange || [spec.sectionCount, spec.sectionCount];
  const itemRange = spec.itemRange || [spec.itemsPerSection, spec.itemsPerSection];
  const sectionText = sectionRange[0] === sectionRange[1] ? `${sectionRange[0]}组` : `${sectionRange[0]}到${sectionRange[1]}组`;
  const itemText = itemRange[0] === itemRange[1] ? `每组${itemRange[0]}条` : `每组${itemRange[0]}到${itemRange[1]}条`;
  const totalText = spec.maxTotalItems
    ? `，整张总数控制在${spec.minTotalItems}到${spec.maxTotalItems}条`
    : `，整张至少${spec.minTotalItems}条`;
  const readability = spec.feedTextMode === 'headline_only'
    ? '信息流可读层级：主标题和副标题必须一眼读清；其余结构只作视觉辅助。'
    : spec.feedTextMode === 'headline_and_groups'
      ? '信息流可读层级：主标题、副标题和分组名必须一眼读清；密集条目点开后可读。'
      : '信息流可读层级：主标题、副标题、分组名和每条内容都必须完整可读，禁止裁字和省略号。';
  return [
    `封面模板：${spec.name}。`,
    `视觉密度：${coverVisualDensity(renderer)}；每条实际可见文字平均至少${minimumAverageCoverItemUnits(renderer)}个单位，不能只用几个短标签把数量凑够。`,
    `视觉实测容量：${sectionText}，${itemText}${totalText}有效内容；各组不必等量，不得为了凑数重复或硬塞。`,
    readability,
    spec.allowedCoverTitleTypes?.length
      ? `封面标题允许类型：${spec.allowedCoverTitleTypes.join(' / ')}。必须从中选择一种；资料目录模板优先资料/大全/时效/稀缺，情绪实拍模板优先情绪/结果/反常识，禁止标题和画面错配。`
      : '',
    spec.contentInstruction,
    spec.titleInstruction,
    spec.forbiddenInstruction,
  ].join('\n');
}
/** A display-only projection. Keep the full original blocks on the content artifact. */
export function coverDisplayBlocks<T extends {items: Array<{primary:string;secondary?:string;note?:string}>}>(
  renderer: CreativeCardRenderer, blocks: T[],
): T[] {
  const spec = getCoverTemplateSpec(renderer);
  if (!spec) return blocks;
  const groups = spec.sectionRange ?? [spec.sectionCount, spec.sectionCount];
  const items = spec.itemRange ?? [1, spec.itemsPerSection];
  const totalMax = spec.maxTotalItems ?? groups[1] * items[1];
  const visible = blocks.slice(0, groups[1]);
  // Reserve the minimum for every visible region before filling extra slots.
  const counts = visible.map(b => Math.min(items[0], b.items.length));
  let remaining = totalMax - counts.reduce((a,b)=>a+b,0);
  for (let i=0; i<visible.length && remaining>0; i++) {
    const extra = Math.min(remaining, Math.max(0, Math.min(items[1],visible[i].items.length)-counts[i]));
    counts[i]+=extra; remaining-=extra;
  }
  return visible.map((b,i)=>({...b,items:b.items.slice(0,counts[i])}));
}

/** Source over-supply is allowed; check filled visual slots, not raw exact counts. */
export function coverCapacityFailure(
  renderer: CreativeCardRenderer,
  blocks: Array<{ items: Array<{ primary: string; secondary?: string; note?: string }> }>,
): string | undefined {
  const spec = getCoverTemplateSpec(renderer);
  if (!spec || spec.productionFit === 'disabled') return 'template_disabled';
  blocks = coverDisplayBlocks(renderer, blocks);
  const sections = spec.sectionRange || [spec.sectionCount, spec.sectionCount];
  const items = spec.itemRange || [1, spec.itemsPerSection];
  if (blocks.length < sections[0] || blocks.length > sections[1]) return 'section_capacity';
  if (blocks.some(block => block.items.length < items[0] || block.items.length > items[1])) return 'item_capacity';
  const total = blocks.reduce((sum, block) => sum + block.items.length, 0);
  const maxTotal = spec.maxTotalItems || sections[1] * items[1];
  // For medium/high-capacity covers, a structurally complete result that is only
  // one item below the recommended total is still visually usable. Keep section
  // and per-group minimums hard, and never tolerate a larger shortfall.
  const oneItemVisualTolerance = spec.minTotalItems >= 8 && total === spec.minTotalItems - 1;
  if ((!oneItemVisualTolerance && total < spec.minTotalItems) || total > maxTotal) return 'total_capacity';
  if (blocks.some(block => block.items.some(item =>
    !item.primary?.trim()
  ))) return 'empty_preview_content';
  if (spec.primaryFrenchOnly && blocks.some(block => block.items.some(item => /\p{Script=Han}/u.test(item.primary)))) return 'primary_language';
  if (spec.notePartCount && blocks.some(block => block.items.some(item => {
    const parts = (item.note || '').split(/[·｜|]/u).map(part => part.trim()).filter(Boolean);
    return parts.length !== spec.notePartCount || new Set(parts).size !== parts.length;
  }))) return 'note_structure';
  return undefined;
}
