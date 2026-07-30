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
    renderer: 'clean_purple_directory', name: '白底紫色知识资料', family: 'directory', renderMode: 'code', sectionCount: 4, itemsPerSection: 10, minTotalItems: 36,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 25,
    contentInstruction: '输出4个知识分组，每组10个短条目；primary写法语词、短语或知识标签，secondary写极短中文解释。保持打印资料页的高密度，不输出长句。',
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
    renderer: 'blackboard_phrase', name: '黑板短语密集表', family: 'phrase', renderMode: 'hybrid', sectionCount: 2, itemsPerSection: 8, minTotalItems: 15,
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
    titleInstruction: '此模板特例：封面 title 必须是一句具体痛点+损失感的整句钩子（如"你的DELF B2格式正在拖后腿"、"DELF B2写作这一步最容易忽略"）。禁止写"·任务格式备忘录"、"·任务格式说明"、"·资料说明"这类说明书式命名；副标题再补资料说明口吻。',
    forbiddenInstruction: '禁止冒充真人履历，禁止写不存在的课程服务和效果保证。',
  },
  word_flashcard: {
    renderer: 'word_flashcard', name: '印刷式词卡', family: 'flashcard', renderMode: 'hybrid', sectionCount: 3, itemsPerSection: 3, minTotalItems: 9,
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
    titleInstruction: '标题可以情绪化，但必须说明法语对象；封面正文承担痛点和转折。',
    forbiddenInstruction: '禁止假装本人通过考试，禁止虚构分数、时间和个人经历。',
  },
  plain_experience: {
    renderer: 'plain_experience', name: '极简经验长图', family: 'experience', renderMode: 'code', sectionCount: 2, itemsPerSection: 2, minTotalItems: 4,
    maxPrimaryVisualLength: 40, maxSecondaryVisualLength: 54,
    contentInstruction: '输出2段各2条，组合后成为两段连贯的经验正文；每段合计70到110个中文字，必须是完整中文句子组成的段落（可嵌入法语例句）。第一段讲真实困难和判断，第二段给可执行建议。严禁输出”法语短语+中文翻译”这类词汇/短语释义条目，严禁把多条短语堆叠成伪段落（如”J\'ai bien compris.，我完全理解了。”是错误示例）。没有用户提供的真实经历时，不得使用"我后来发现/我的整理方法/让我/我考前/我上岸/我亲测"这类第一人称经历口吻，只能写成泛化观察和建议。',
    titleInstruction: '标题像一篇经验帖的大标题，清楚指出法语人群或阶段。',
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
    renderer: 'vocab_table', name: '主题词汇表压屏', family: 'table', renderMode: 'image_to_image', sectionCount: 5, itemsPerSection: 5, minTotalItems: 22,
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
    renderer: 'collocation_dense', name: '三列固定搭配密表', family: 'phrase', renderMode: 'image_to_image', sectionCount: 3, itemsPerSection: 8, minTotalItems: 24,
    maxPrimaryVisualLength: 28, maxSecondaryVisualLength: 14,
    contentInstruction: '输出3组各8条法语固定搭配或高频表达，形成真正的资料密表。primary是完整搭配或短表达，secondary是短中文释义；按核心动词、表达功能或考试任务分组。每组少于8条会显得空，禁止只写3-4条。',
    titleInstruction: '标题写法语领域+固定搭配专题；副标题说明用于写作、口语或备考。',
    forbiddenInstruction: '禁止截断介词、漏重音符号、重复搭配或用机器直译充数。',
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
