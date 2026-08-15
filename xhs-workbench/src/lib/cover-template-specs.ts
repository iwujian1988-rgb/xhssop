import type { ContentShape, CoverTitleType, CreativeCardRenderer } from '@/types/reference-workflow';

export interface CoverTemplateSpec {
  renderer: CreativeCardRenderer;
  name: string;
  family: ContentShape;
  renderMode: 'code' | 'hybrid' | 'image_to_image';
  sectionCount: number;
  itemsPerSection: number;
  minTotalItems: number;
  maxPrimaryVisualLength: number;
  maxSecondaryVisualLength: number;
  contentInstruction: string;
  titleInstruction: string;
  allowedCoverTitleTypes?: CoverTitleType[];
  forbiddenInstruction: string;
  /** 封面主标题长度区间，默认 [8, 18]。official_notice 公文标题天然更长，单独放宽。 */
  titleLengthRange?: [number, number];
  /** true = 本模板 primary 必须是纯法语词/搭配（中文只能出现在 secondary）。
   *  getCoreIssues 据此做确定性检查，混入中文直接 block 走 repair。 */
  primaryFrenchOnly?: boolean;
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
  renderer, name, family: 'directory', renderMode: 'code', sectionCount: 5, itemsPerSection: 5, minTotalItems: 22,
  maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 28,
  contentInstruction: '输出5个互不重复的知识分组，每组5个短知识点。primary写法语词/短语或中文知识标签，secondary写简短中文解释；完整句、条件和长解释移到内页。若某分组主题（如礼貌收尾/敬语）天然需要较长搭配，只写其中最短的核心搭配片段（不超过40字符），不要写完整长句。',
  titleInstruction: '封面标题写“法语领域或考试名+具体资料对象”，直接说明图中有什么；副标题补充范围、使用场景或收益。',
  forbiddenInstruction: '禁止用空泛标签凑数，禁止把长句硬塞进封面，禁止制造官方不存在的数量规则，禁止使用[Madame/Monsieur]这类方括号占位符号，人称/称谓要写具体的词（如Monsieur、Madame）而不是用斜杠或方括号列出选项。',
});

export const coverTemplateSpecs: Record<Exclude<CreativeCardRenderer, 'ai_scene_overlay'>, CoverTemplateSpec> = {
  parchment_dense_directory: directory('parchment_dense_directory', '羊皮纸高密度资料目录'),
  white_green_directory: directory('white_green_directory', '白底绿字知识清单'),
  clean_purple_directory: {
    renderer: 'clean_purple_directory', name: '白底紫色知识资料', family: 'directory', renderMode: 'code', sectionCount: 4, itemsPerSection: 9, minTotalItems: 28,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 25,
    contentInstruction: '输出4个知识分组，每组8-10个短条目；primary写法语词、短语或知识标签，secondary写极短中文解释。保持打印资料页的高密度，不输出长句。',
    titleInstruction: '标题直接说明法语领域或考试名与资料对象，适合打印资料页。',
    forbiddenInstruction: '禁止长解释、空泛口号、虚构官方数量和无法在资料页中展示的内容。',
  },
  grid_purple_directory: {
    renderer: 'grid_purple_directory', name: '网格纸紫色知识体系', family: 'directory', renderMode: 'code', sectionCount: 4, itemsPerSection: 8, minTotalItems: 30,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 25,
    contentInstruction: '输出4个知识分组，每组8个短条目。每条primary是核心词、短语或知识标签，secondary是极短解释；前两组排成三列表格，后两组排成更密的两列表格。',
    titleInstruction: '标题必须是法语领域或考试名加完整知识对象，像一张可打印的知识体系总表。',
    forbiddenInstruction: '禁止长句、空泛标签和过多说明文字，禁止生成不适合放进表格的段落内容。',
  },
  blackboard_phrase: {
    renderer: 'blackboard_phrase', name: '黑板短语密集表', family: 'phrase', renderMode: 'hybrid', sectionCount: 2, itemsPerSection: 8, minTotalItems: 15, primaryFrenchOnly: true,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 25,
    contentInstruction: '输出2组各10条可直接使用的法语短语。primary只放法语短语，secondary只放准确、简短的中文用途或释义。',
    titleInstruction: '封面标题突出一个明确用途，例如“法语写作衔接短语”；副标题说明使用场景。',
    forbiddenInstruction: '禁止生成残缺法语、杜撰固定搭配或把整句例句塞进短语表。',
  },
  blackboard_offer: {
    renderer: 'blackboard_offer', name: '黑板大字方案说明', family: 'offer', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 3, minTotalItems: 7,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 34,
    contentInstruction: '输出3组各3条：适合谁、能解决什么、资料里具体有什么。只能写商品证据可证明的模块和能力。',
    titleInstruction: '大标题说清法语对象和具体需求，副标题给可信的使用方式，不写课程招募口吻。',
    forbiddenInstruction: '禁止虚构老师资历、直播课、一对一、答疑、陪学或商品不存在的服务。',
  },
  memo_offer: {
    renderer: 'memo_offer', name: '备忘录资料说明', family: 'offer', renderMode: 'code', sectionCount: 4, itemsPerSection: 2, minTotalItems: 6,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 38,
    contentInstruction: '输出4个备忘录小节，每节2条；依次说明适合人群、使用场景、资料内容和使用要求，保持真实简洁。',
    titleInstruction: '此模板特例：封面 title 必须是一句具体痛点+损失感的整句钩子（如"DELF B2格式分老丢的人先看"、"DELF B2写作这一步最容易忽略"）。禁止写"·题型备忘录"、"·题型说明"、"·资料说明"这类说明书式命名；副标题再补资料说明口吻。',
    forbiddenInstruction: '禁止冒充真人履历，禁止写不存在的课程服务和效果保证。',
  },
  word_flashcard: {
    renderer: 'word_flashcard', name: '印刷式词卡', family: 'flashcard', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 3, minTotalItems: 9, primaryFrenchOnly: true,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 25,
    contentInstruction: '输出3组各3个同类法语词或极短表达。primary必须是真实存在、拼写正确的完整法语词或短语，不得截断或拼接多个词；secondary是中文含义，note是1到4字的用法提示。',
    titleInstruction: '标题只讲一个词汇专题，避免把多个知识主题混在一张词卡。',
    forbiddenInstruction: '禁止长词组、整句、错误词性、拼接出的不存在词形和不在同一语义组的随机拼接。',
  },
  book_cover: {
    renderer: 'book_cover', name: '法语教材封面风', family: 'book', renderMode: 'image_to_image', sectionCount: 2, itemsPerSection: 2, minTotalItems: 3,
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 32,
    contentInstruction: '输出2组各2条，概括本篇的核心主题和包含内容，像一本专题小册子的封底提要。',
    titleInstruction: '标题像专题手册名，必须包含法语领域和明确主题；副标题写学习收益。',
    forbiddenInstruction: '禁止冒充官方教材、出版社、证书或真实出版物。',
  },
  notebook_big_words: {
    renderer: 'notebook_big_words', name: '手写本痛点大字', family: 'pain', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 1, minTotalItems: 3,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 42,
    contentInstruction: '输出3条递进短句：用户现状、反差判断、解决方向。每条只表达一层意思，像真人随手写下的提醒。',
    titleInstruction: '封面正文只承载3条痛点短句，所以 title 必须是反常识/情绪型钩子（描述一类具体考生的痛点，比如"卡在某个具体环节""反复犯某个具体错误""用错某个具体方法"），让人一眼共鸣。禁止写"X 大全""X 清单""X 资料库""X 整理"这类具体内容型标题——本模板承载不了资料承诺，那种标题请走 dense_directory 类模板。副标题补一句反差/追问。不要使用固定套话式钩子（如"总差一点"），要结合本选题写具体场景。',
    forbiddenInstruction: '禁止假装本人通过考试，禁止虚构分数、时间和个人经历。',
  },
  plain_experience: {
    renderer: 'plain_experience', name: '极简经验长图', family: 'experience', renderMode: 'code', sectionCount: 2, itemsPerSection: 2, minTotalItems: 4,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 54,
    contentInstruction: '输出2段各2条，组合后成为两段连贯的经验正文；每段合计70到110个中文字，必须是完整中文句子组成的段落（可嵌入法语例句）。第一段讲真实困难和判断，第二段给可执行建议。严禁输出”法语短语+中文翻译”这类词汇/短语释义条目，严禁把多条短语堆叠成伪段落（如”J\'ai bien compris.，我完全理解了。”是错误示例）。没有用户提供的真实经历时，不得使用"我后来发现/我的整理方法/让我/我考前/我上岸/我亲测"这类第一人称经历口吻，只能写成泛化观察和建议。',
    titleInstruction: '封面正文只有2段经验分享（合计不到200字），所以 title 必须是反常识/情绪/结果型钩子（如"B2写不到字数？不是词汇问题"、"DELF B2跑题的人都有一个共同点"），让用户觉得"这说的就是我"。禁止写"X 大全""X 清单""X 资料库""X 整理好了"这类具体内容型标题——2 段经验正文撑不起资料承诺，那种标题请走 dense_directory 类模板。副标题补一句反差或追问。',
    forbiddenInstruction: '禁止虚构第一人称成绩、身份、留学或考试经历。',
  },
  document_analysis: {
    renderer: 'document_analysis', name: '文档素材解析', family: 'document', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 3, minTotalItems: 6,
    maxPrimaryVisualLength: 56, maxSecondaryVisualLength: 34,
    contentInstruction: '输出3组各3条：素材原句、中文解释、可迁移表达。至少包含3条完整且准确的法语句子，primary必须是完整、真实存在的法语句子（不要为了凑字数硬编词），secondary写这句话的中文翻译或可迁移表达。知识库无原句时标注为AI示例，不伪装真题。',
    titleInstruction: '标题写清DELF B2/法语写作和本次解析主题。',
    forbiddenInstruction: '禁止伪造真题出处、年份、官方原文或未经证实的评分结论。',
  },
  vocab_table: {
    renderer: 'vocab_table', name: '主题词汇表压屏', family: 'table', renderMode: 'image_to_image', sectionCount: 5, itemsPerSection: 5, minTotalItems: 22, primaryFrenchOnly: true,
    maxPrimaryVisualLength: 24, maxSecondaryVisualLength: 18,
    contentInstruction: '输出5个主题组，每组5条法语词或搭配与中文释义，形成可扫读的主题词汇表。',
    titleInstruction: '中央大标题写考试/法语领域+词汇专题；副标题写主题数量或应用场景。',
    forbiddenInstruction: '禁止把解释性长句放进表格，禁止混入错误词形和重复词。',
  },
  course_roadmap: {
    renderer: 'course_roadmap', name: '蓝色学习路径信息图', family: 'roadmap', renderMode: 'image_to_image', sectionCount: 4, itemsPerSection: 3, minTotalItems: 10,
    maxPrimaryVisualLength: 24, maxSecondaryVisualLength: 36,
    contentInstruction: '输出4个阶段各3条：阶段目标、核心任务、可检查结果。路径必须与当前主题和商品能力一致。',
    titleInstruction: '标题写法语人群+学习路径或备考安排；副标题交代适用阶段。',
    forbiddenInstruction: '禁止承诺固定天数提分，禁止虚构课时、教材、辅导和学习权利。',
  },
  collocation_dense: {
    renderer: 'collocation_dense', name: '三列固定搭配密表', family: 'phrase', renderMode: 'image_to_image', sectionCount: 3, itemsPerSection: 8, minTotalItems: 24, primaryFrenchOnly: true,
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 14,
    contentInstruction: '输出3组各8条法语固定搭配或高频表达，形成真正的资料密表。primary是完整搭配或短表达，secondary是短中文释义；按核心动词、表达功能或考试任务分组。每组少于8条会显得空，禁止只写3-4条。',
    titleInstruction: '标题写法语领域+固定搭配专题；副标题说明用于写作、口语或备考。',
    forbiddenInstruction: '禁止截断介词、漏重音符号、重复搭配或用机器直译充数。',
  },
  official_notice: {
    renderer: 'official_notice', name: '官方通知公告风', family: 'offer', renderMode: 'image_to_image', sectionCount: 3, itemsPerSection: 2, minTotalItems: 6,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 36,
    // 公文标题"关于……的通知"天然 14-22 字，18 字上限会把它掐死。
    titleLengthRange: [10, 22],
    contentInstruction: '输出3个通知小节，每节2条：依次写通知对象/适用人群、资料内容和受益点、使用方式或时间节点。语气像一份真实的备考资料发布通知，不要写成广告海报或推销话术。',
    titleInstruction: '封面 title 必须是真实公文格式："关于 + 备考对象 + 具体动作 + 的通知"（如"关于做好 DELF B2 写作考前自查的通知"/"关于 TCF 听力备考常见问题排查的通知"/"关于 TEF Canada 写作格式重点提示的通知"）。备考对象写考试+科目（DELF B2 写作 / DELF B2 口语 / TCF 听力 / TEF 写作 等），具体动作用公文常见措辞（考前自查 / 常见问题排查 / 重点提示 / 考前提醒 / 阶段安排 / 重点核查）。禁止"官方通知""重要公告"这类空泛措辞；禁止"X 大全""X 清单""X 整理"资料型标题；禁止小红书钩子口吻（如"停一下"/"看过来"/"先查这 X 项"/"必看"/"赶紧"等口号）。副标题作为"藏原因制造好奇"的钩子（如"评分要点先看这一项"/"最容易丢的分在第三项"/"考前一周的同学重点关注"），保留公文感、不写感叹号和口号词。',
    forbiddenInstruction: '禁止冒充官方机构、考试院、使领馆、出版社；禁止虚构截止日期、报名名额、限量福利；禁止写课程招募、直播课、答疑服务。',
  },
  pain_quote_big: {
    renderer: 'pain_quote_big', name: '极简痛点金句', family: 'pain', renderMode: 'image_to_image', sectionCount: 3, itemsPerSection: 1, minTotalItems: 3,
    maxPrimaryVisualLength: 30, maxSecondaryVisualLength: 24,
    // 完整金句"身份+栽在考试上+钩子"拼装后常到 19-22 字，默认 18 上限会误杀。
    titleLengthRange: [10, 24],
    contentInstruction: '封面目的是「藏原因制造好奇」——封面只承担"谁+栽在什么考试上+钩子"三件事，真正的原因和知识点必须放到内页展开，逼用户点开看。输出3条短成分：第1条=「单数身份」（从"我室友"/"我同学"/"我的朋友"/"室友"/"同学"/"朋友"里选一个，必须单数第一人称或亲密称呼，禁止复数泛化）；第2条=「动词+栽/卡/挂/折在+考试名」（动词从"栽/卡/挂/折/绊"里选一个，"考试名"只到考试+大科目级别，从"法语B2"/"DELF"/"DELF B2"/"DELF B2写作"/"TCF"/"TCF听力"/"考试"里挑一个最贴合 seed 的，禁止细化到具体知识点如"跑题/字数/口语/时态/论据"等）；第3条=「行动或好奇钩子」（从"赶紧避开/提前绕开/别再踩/快看看因为啥/为啥看看/猜猜为啥/点开避坑"里选，可微调但必须 4-8 字）。三条连读必须是一句通顺中文，像真人随手吐槽。绝对禁止在封面三成分里出现任何具体知识点、方法论或解决步骤。',
    titleInstruction: '封面 title 写整句金句（单数身份+栽在考试上+行动/好奇钩子），封面目的是「隐藏原因制造好奇」，title 绝对不能写具体知识点。LLM 必须替换原图的"我同学/法语B2/快看看因为啥"为本次选题的等价表达：身份从"我室友/我同学/我的朋友/室友/同学/朋友"里选；"X"只到考试+大科目级别（DELF B2 系 seed 优先"法语B2"/"DELF B2"/"DELF B2写作"，TEF/TCF 系 seed 优先"TCF"/"TEF"/"TCF听力"），禁止细化到"跑题/字数/口语"等知识点；行动短语从"赶紧避开/提前绕开/别再踩/快看看因为啥/为啥看看/猜猜为啥/点开避坑"里选，不能照抄原图原句。副标题可省略或写半句反差补刀。禁止"X 大全""X 清单""X 整理"这类资料型标题——本模板只承得下单句金句，承不下资料承诺。',
    forbiddenInstruction: '禁止用"两位X/三个考友/一群研友"等数字+身份的复数泛化形式；禁止具体姓名、学校、年份；禁止虚构第一人称分数、身份、留学经历；禁止塞资料列表/课程卖点/服务承诺；禁止把长解释或资料条目塞进 3 个成分里；禁止在封面写任何具体知识点（如"跑题""字数不够""口语紧张""时态错误""论据不足"等），具体知识点必须放到内页展开——封面只承担"藏原因制造好奇"的功能。',
  },
};

const coverTitleTypesByRenderer: Record<Exclude<CreativeCardRenderer, 'ai_scene_overlay'>, CoverTitleType[]> = {
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
};

for (const renderer of Object.keys(coverTitleTypesByRenderer) as Exclude<CreativeCardRenderer, 'ai_scene_overlay'>[]) {
  coverTemplateSpecs[renderer].allowedCoverTitleTypes = coverTitleTypesByRenderer[renderer];
}

export function getCoverTemplateSpec(renderer: CreativeCardRenderer) {
  return renderer === 'ai_scene_overlay' ? undefined : coverTemplateSpecs[renderer];
}

export function getCoverTemplatePrompt(renderer: CreativeCardRenderer) {
  const spec = getCoverTemplateSpec(renderer);
  if (!spec) return '';
  return [
    `封面模板：${spec.name}。`,
    `必须输出${spec.sectionCount}组，每组${spec.itemsPerSection}条，至少${spec.minTotalItems}条有效内容。`,
    spec.allowedCoverTitleTypes?.length
      ? `封面标题允许类型：${spec.allowedCoverTitleTypes.join(' / ')}。必须从中选择一种；资料目录模板优先资料/大全/时效/稀缺，情绪实拍模板优先情绪/结果/反常识，禁止标题和画面错配。`
      : '',
    spec.contentInstruction,
    spec.titleInstruction,
    spec.forbiddenInstruction,
  ].join('\n');
}
