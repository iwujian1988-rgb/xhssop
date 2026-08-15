export type ResourceCoverType =
  | 'grammar_system'
  | 'chalkboard_offer'
  | 'chalkboard_phrase'
  | 'course_offer_note'
  | 'word_flashcard'
  | 'book_cover'
  | 'handwritten_warning'
  | 'plain_experience'
  | 'document_analysis'
  | 'vocab_table_overlay'
  | 'course_roadmap'
  | 'collocation_dense'
  | 'official_notice'
  | 'pain_quote_big';

export type ResourceCoverDensity = 'low' | 'medium' | 'high' | 'very_high';

export interface ResourceCoverRef {
  id: string;
  name: string;
  image: string;
  type: ResourceCoverType;
  contentFit: string[];
  titleFit: string[];
  sceneFit: string[];
  density: ResourceCoverDensity;
  textCapacity: ResourceCoverDensity;
  layout: string;
  styleNotes: string;
  promptRecipe: string;
  forbiddenUse: string[];
  qualityRisk: string;
}

const img = (file: string) => `/reference-covers/resource/${file}`;

export const resourceCoverRefs: ResourceCoverRef[] = [
  {
    id: 'resource_01_grammar_parchment_red',
    name: '羊皮纸语法体系大目录',
    image: img('resource_01_grammar_parchment_red.png'),
    type: 'grammar_system',
    contentFit: ['grammar', 'directory', 'checklist', 'vocab', 'writing_resource', 'product_showcase'],
    titleFit: ['resource_showcase', 'system_pack', 'number_list', 'collection_done'],
    sceneFit: ['系统整理', '考前翻看', '资料包展示'],
    density: 'very_high',
    textCapacity: 'very_high',
    layout: '顶部大标题，中间按章节纵向排布，左侧分类标签，正文多列密集条目。',
    styleNotes: '复古纸张底、深红主色、资料厚重感强，适合“我整理好了”“整个体系”这种承诺。',
    promptRecipe: '参考图的纸张质感、章节编号、左侧分类栏和密集资料排版，生成法语写作资料封面；保留大量可读中文和法语条目，整体像手工整理的资料截图。',
    forbiddenUse: ['单一真人经历', '只讲一个观点', '轻量吐槽', 'TEF/TCF选择对比'],
    qualityRisk: '文字极多，必须要求 AI 直接生成带字图，并做 OCR 检查；不适合后期 Canvas 叠字。',
  },
  {
    id: 'resource_02_grammar_white_green',
    name: '白底绿字语法清单',
    image: img('resource_02_grammar_white_green.png'),
    type: 'grammar_system',
    contentFit: ['grammar', 'directory', 'checklist', 'self_test', 'writing_resource'],
    titleFit: ['resource_showcase', 'system_pack', 'collection_done'],
    sceneFit: ['基础补漏', '语法体系', '清单收藏'],
    density: 'high',
    textCapacity: 'very_high',
    layout: '白底纹理纸，顶部大标题，下方按模块分组，绿色项目符号和括号内容。',
    styleNotes: '比羊皮纸更干净，适合“收藏型干货”，但点击冲击力略弱。',
    promptRecipe: '模仿白底绿字、分组标题、圆点列表、整页学习资料截图感；标题要大，内容区要有真实条目而不是假线。',
    forbiddenUse: ['强痛点警告', '冲刺倒计时', '真人故事'],
    qualityRisk: '容易变成普通讲义，标题必须补足点击欲。',
  },
  {
    id: 'resource_03_chalkboard_course',
    name: '黑板大字课程招募',
    image: img('resource_03_chalkboard_course.png'),
    type: 'chalkboard_offer',
    contentFit: ['course_offer', 'pain_warning', 'planning', 'service_intro'],
    titleFit: ['question_hook', 'pain_question', 'teacher_offer'],
    sceneFit: ['暑假学习', '每天投入', '有人带学'],
    density: 'medium',
    textCapacity: 'medium',
    layout: '黑板背景，超大手写标题，黄色圈画重点，底部放师资和服务说明。',
    styleNotes: '广告感强，适合课程/陪跑，不适合虚拟资料包主卖点。',
    promptRecipe: '模仿黑板粉笔字、黄色手绘圈线、底部小字说明；画面要像真实黑板海报，不要现代扁平 PPT。',
    forbiddenUse: ['纯资料目录', '表格对照', 'DELF写作检查清单'],
    qualityRisk: '会让用户以为卖课，不是卖知识库，除非笔记内容就是“学习安排/辅导感”。',
  },
  {
    id: 'resource_04_chalkboard_phrase_list',
    name: '黑板短语密集表',
    image: img('resource_04_chalkboard_phrase_list.png'),
    type: 'chalkboard_phrase',
    contentFit: ['vocab', 'grammar', 'phrase_list', 'expression_upgrade'],
    titleFit: ['resource_showcase', 'number_list', 'save_this'],
    sceneFit: ['背短语', '表达升级', '基础补漏'],
    density: 'very_high',
    textCapacity: 'very_high',
    layout: '黑板背景，顶部一句大标题，中部两到三列短语表，黄色圈出小分类。',
    styleNotes: '很适合词汇/句型类干货，视觉有手工感，适合“背了就能用”。',
    promptRecipe: '生成黑板粉笔短语表，保留法语短语+中文释义两列，多列排版，黄色手绘圈出小标题。',
    forbiddenUse: ['TEF/TCF选择', '真人经验长文', '商品目录全展示'],
    qualityRisk: 'AI 可能把法语拼错，需要 OCR 后至少抽查标题和前 10 个条目。',
  },
  {
    id: 'resource_05_grammar_clean_purple',
    name: '白底紫色语法资料',
    image: img('resource_05_grammar_clean_purple.png'),
    type: 'grammar_system',
    contentFit: ['grammar', 'directory', 'checklist', 'self_test'],
    titleFit: ['resource_showcase', 'collection_done'],
    sceneFit: ['收藏复习', '基础整理'],
    density: 'high',
    textCapacity: 'very_high',
    layout: '顶部紫色大标题，下面分块清单，留白比绿色版更大。',
    styleNotes: '干净但容易偏普通，适合内页，不一定适合首图强点击。',
    promptRecipe: '模仿白底紫色资料页，做成清晰可读的法语写作检查/语法分类表。',
    forbiddenUse: ['强痛点爆款封面', '课程销售', '故事经验'],
    qualityRisk: '容易显得太素，首图需要搭配更强标题。',
  },
  {
    id: 'resource_06_notes_course_offer',
    name: '备忘录课程说明页',
    image: img('resource_06_notes_course_offer.png'),
    type: 'course_offer_note',
    contentFit: ['offer_intro', 'fit_audience', 'service_intro'],
    titleFit: ['teacher_offer', 'who_should_join'],
    sceneFit: ['适合谁', '课程说明', '服务介绍'],
    density: 'medium',
    textCapacity: 'high',
    layout: '手机备忘录风格，黑字大段说明，黄色荧光标签分区。',
    styleNotes: '像真实招募说明，信任感可以，但不适合作为资料包干货首图。',
    promptRecipe: '模仿手机备忘录页面，使用黄色高亮标签和黑色大字分段，内容要像真实说明。',
    forbiddenUse: ['资料清单首图', '词汇表', '真题页'],
    qualityRisk: '商业感较强，容易削弱干货点击。',
  },
  {
    id: 'resource_07_question_words_parchment',
    name: '疑问词大字卡片',
    image: img('resource_07_question_words_parchment.png'),
    type: 'word_flashcard',
    contentFit: ['vocab', 'grammar', 'single_topic', 'basic_mistake'],
    titleFit: ['mistake_warning', 'save_this', 'single_knowledge'],
    sceneFit: ['基础混淆', '一页背完', '错点纠正'],
    density: 'medium',
    textCapacity: 'medium',
    layout: '顶部标题，下面九宫格式词卡，每个词大字号，下方中文和谐音/提示。',
    styleNotes: '适合单个知识点，不适合承载完整知识库。',
    promptRecipe: '模仿复古纸张和九宫格词卡，法语词放最大，下面放中文用途，少量红色强调。',
    forbiddenUse: ['商品全目录', '复杂检查清单', '长正文经验'],
    qualityRisk: '内容容量有限，只能做单点爆款。',
  },
  {
    id: 'resource_08_book_cover_fle',
    name: '法语教材封面风',
    image: img('resource_08_book_cover_fle.png'),
    type: 'book_cover',
    contentFit: ['book_like_product', 'course_pack'],
    titleFit: ['product_name', 'system_pack'],
    sceneFit: ['资料产品感', '教材感'],
    density: 'low',
    textCapacity: 'low',
    layout: '教材封面式大标题，上方色块，底部插画。',
    styleNotes: '太像书封，未必像小红书爆款封面；暂时低优先级。',
    promptRecipe: '模仿法语教材封面质感，但替换为法语写作资料包主题。',
    forbiddenUse: ['干货清单', '痛点标题', '正文经验'],
    qualityRisk: '小红书点击效率可能低，默认不推荐。',
  },
  {
    id: 'resource_09_notebook_warning',
    name: '手写本警告首图',
    image: img('resource_09_notebook_warning.png'),
    type: 'handwritten_warning',
    contentFit: ['pain_warning', 'real_experience', 'low_energy_plan', 'exam_rescue'],
    titleFit: ['pain_warning', 'dont_only', 'low_energy'],
    sceneFit: ['进度为0', '考前焦虑', '低精力学习'],
    density: 'low',
    textCapacity: 'medium',
    layout: '真实笔记本拍照，横线纸，手写大字，一行一个冲突点。',
    styleNotes: '真实感强，适合痛点首图和真人经验，不能塞太多资料。',
    promptRecipe: '生成真实手机拍摄的横线笔记本页，黑色手写中文，文字像真人写的，保持轻微拍照透视和纸张阴影。',
    forbiddenUse: ['表格资料', '复杂词汇清单', '知识库目录'],
    qualityRisk: 'AI 手写字容易变形；最好用于短标题，OCR 必须过。',
  },
  {
    id: 'resource_10_plain_text_experience',
    name: '极简真人经验正文',
    image: img('resource_10_plain_text_experience.png'),
    type: 'plain_experience',
    contentFit: ['real_experience', 'mindset', 'study_method', 'low_energy_plan'],
    titleFit: ['experience_story', 'low_energy', 'personal_method'],
    sceneFit: ['低精力备考', '真实复盘', '学习方法'],
    density: 'medium',
    textCapacity: 'high',
    layout: '白底黑字，顶部加粗下划线标题，正文大段口语化叙述。',
    styleNotes: '很像真人分享，适合正文内页或经验型首图；但商品展示弱。',
    promptRecipe: '模仿白底黑字真人经验笔记，标题粗体下划线，正文分两三段，口语化但不要 AI 总结腔。',
    forbiddenUse: ['资源目录展示', '词汇表', '表格对照'],
    qualityRisk: '如果文案写得像 AI，会立刻露馅；必须用真人语气。',
  },
  {
    id: 'resource_11_delf_doc_analysis',
    name: 'DELF素材文档解析',
    image: img('resource_11_delf_doc_analysis.png'),
    type: 'document_analysis',
    contentFit: ['sample', 'document', 'case_analysis', 'topic_material', 'writing_resource'],
    titleFit: ['material_analysis', 'resource_showcase', 'case_breakdown'],
    sceneFit: ['范文解析', '素材精析', '题目拆解'],
    density: 'high',
    textCapacity: 'high',
    layout: '白底文档页，黑框边界，顶部红色大标题，中间放真实法语材料和中文译文。',
    styleNotes: '非常适合展示“资料包里真的有内容”，信任感强。',
    promptRecipe: '模仿正式文档解析页，顶部用红黑大标题，中间放法语原文片段和中文解释，边框像打印资料。',
    forbiddenUse: ['轻松经验', '课程招募', '单纯痛点吐槽'],
    qualityRisk: '法语长文最容易错，生成后必须抽查专有词和语法。',
  },
  {
    id: 'resource_12_delf_vocab_table_overlay',
    name: '主题词汇表大字压屏',
    image: img('resource_12_delf_vocab_table_overlay.png'),
    type: 'vocab_table_overlay',
    contentFit: ['vocab', 'table', 'topic_material', 'product_showcase'],
    titleFit: ['resource_showcase', 'number_list', 'collection_done'],
    sceneFit: ['主题词汇', '考前收藏', '资料展示'],
    density: 'very_high',
    textCapacity: 'very_high',
    layout: '背景是真实表格截图，中间叠超大描边标题，右上角页码气泡。',
    styleNotes: '点击感强，资料厚重感强，适合词汇/主题库。',
    promptRecipe: '生成一张密集法语主题词汇表截图作为背景，中间叠加超大黑白描边中文标题，整体像资料合集首图。',
    forbiddenUse: ['自测题', '真人经验', 'TEF/TCF选择'],
    qualityRisk: '大标题可以 AI 生成，背景小字可半可读；但主题必须对。',
  },
  {
    id: 'resource_13_course_roadmap_blue',
    name: '蓝色课程规划信息图',
    image: img('resource_13_course_roadmap_blue.png'),
    type: 'course_roadmap',
    contentFit: ['roadmap', 'planning', 'fit_audience', 'course_offer'],
    titleFit: ['planning', 'who_should_join', 'route_map'],
    sceneFit: ['30天安排', '阶段规划', '适合人群'],
    density: 'high',
    textCapacity: 'high',
    layout: '浅蓝背景，左侧适合人群，右侧阶段卡片，底部服务卖点。',
    styleNotes: '适合规划类笔记，但图标和表情要谨慎，容易显幼稚。',
    promptRecipe: '模仿蓝色信息图结构，左栏写适合人群，右侧按阶段列学习安排，底部列资料/陪跑承接。',
    forbiddenUse: ['单点词汇', '作文检查清单', '纯文档截图'],
    qualityRisk: '容易变成招生广告，需要控制卖点比例。',
  },
  {
    id: 'resource_14_collocation_dense_green',
    name: '高频固定搭配密集表',
    image: img('resource_14_collocation_dense_green.png'),
    type: 'collocation_dense',
    contentFit: ['vocab', 'phrase_list', 'collocation', 'expression_upgrade'],
    titleFit: ['number_list', 'resource_showcase', 'save_this'],
    sceneFit: ['表达升级', '固定搭配', '考前背诵'],
    density: 'very_high',
    textCapacity: 'very_high',
    layout: '白底三列密集列表，绿色分组条，顶部超大标题，条目编号清晰。',
    styleNotes: '很适合“高频搭配/替换表达/句型库”，资源感强。',
    promptRecipe: '模仿三列高频固定搭配表，绿色分组条，法语短语+中文释义逐条编号，顶部大标题。',
    forbiddenUse: ['观点卡', '真人经验', '课程规划'],
    qualityRisk: '条目多，AI 拼写风险高；生成后要做 OCR+法语关键条目抽检。',
  },
  {
    id: 'resource_15_grammar_grid_purple',
    name: '网格纸紫色语法体系',
    image: img('resource_15_grammar_grid_purple.png'),
    type: 'grammar_system',
    contentFit: ['grammar', 'table', 'directory', 'checklist', 'writing_resource'],
    titleFit: ['resource_showcase', 'system_pack', 'collection_done'],
    sceneFit: ['语法体系', '资料整理', '收藏复习'],
    density: 'very_high',
    textCapacity: 'very_high',
    layout: '网格纸背景，顶部大紫标题，下方多段表格，左侧有工具栏装饰。',
    styleNotes: '比纯白页更像手搓资料，适合“整个体系/速查表”。',
    promptRecipe: '模仿网格纸、紫色大标题、多段表格和左侧工具栏装饰，内容做成法语写作速查/检查资料。',
    forbiddenUse: ['真人故事', '痛点短句', '课程招募'],
    qualityRisk: '适合资源页，不适合只放一句标题。',
  },
  {
    id: 'resource_16_official_notice',
    name: '官方通知公告封面',
    image: img('resource_16_official_notice.png'),
    type: 'official_notice',
    contentFit: ['product_showcase', 'selling', 'directory', 'checklist', 'writing_resource'],
    titleFit: ['resource_showcase', 'system_pack', 'number_list', 'time_sensitive'],
    sceneFit: ['资料发布', '考前通知', '福利推送', '重点公告'],
    density: 'medium',
    textCapacity: 'medium',
    layout: '浅粉色公告纸，顶部居中黑色加粗大标题，右上角小字日期，中段3段通知正文（每段一行半），右下角红色圆形印章写「备考专用」，四周木质纹理边框。',
    styleNotes: '官方公告/学习通知的视觉调性：粉色温柔底+黑色严肃字+红色印章权威感。不要广告海报感，不要 PPT 模板感，必须像真实学习社群/老师发的通知单。',
    promptRecipe: '生成小红书竖版封面，比例 3:4。参考图是一张"备考通知单"风格的公告：浅粉色（#FFF0F0 左右）纸质底，黑色加粗大标题居中靠上，右上角小字日期（年月日格式），中段3段简短通知正文（每段一行半，左对齐），右下角一个红色（#C8281C）圆形印章，印章内写"备考专用"4个白色加粗字（圆形描边+轻微旋转-8度模拟手盖）。四周保留木质纹理边框（深棕色渐变，模拟原木相框）。整体必须像真实备考社群/法语老师手发的学习通知，不是广告海报或PPT模板。文字部分用本篇实际生成的标题、副标题和3段通知正文替换原图文字，保持原排版位置和层级。印章上的"备考专用"4字和主标题必须清晰可读，不能被磨糊。',
    forbiddenUse: ['单一真人经历', '强情绪痛点', '广告推销口吻', '冒充官方机构'],
    qualityRisk: '印章+木质边框细节多，AI 容易把字磨糊；标题必须保持清晰可读，印章上的"备考专用"4字必须可识别。',
  },
  {
    id: 'resource_17_pain_quote',
    name: '极简痛点金句封面',
    image: img('resource_17_pain_quote.png'),
    type: 'pain_quote_big',
    contentFit: ['pain_warning', 'real_experience', 'low_energy_plan', 'exam_rescue', 'mindset'],
    titleFit: ['pain_warning', 'dont_only', 'low_energy', 'pain_question'],
    sceneFit: ['痛点共鸣', '错点提醒', '考前避坑', '避雷帖', '翻车复盘'],
    density: 'low',
    textCapacity: 'medium',
    layout: '纯白背景，加粗黑色中文，居中堆叠 4 行构成一句完整金句：第1行"数字+身份"（字号中等），第2行"动词+栽/卡在X上"（其中"X"用黄色横条色块作为背景高亮，文字仍是黑色加粗），第3行"的原因"（字号略小，承接），第4行"行动建议"（字号最大，下方加橙色手绘波浪线作为下划线强调）。',
    styleNotes: '极简纯文字封面，靠字号对比 + 黄色高亮块 + 橙色波浪线三个元素制造冲击力。整体像真人在便签纸上随手吐槽写下，不要 PPT 模板感、不要装饰图标、不要任何插图。视觉参考：小红书极简文字博主 / 真人吐槽贴的随手写大字风。',
    promptRecipe: '生成小红书竖版封面，比例 3:4。参考图是一张极简纯文字封面：纯白（#FFFFFF）背景，加粗黑色中文字，居中堆叠 4 行构成一句完整金句。第1行写"数字+身份"短语（如"两位室友"/"三个考友"），字号中等，黑色加粗；第2行写"动词+栽在X上"（如"栽在法语B2上"/"卡在TCF听力上"），其中"X"关键词（即考试名+科目，例如"法语B2"或"TCF听力"）用黄色（#FFD83D）横条色块作为背景高亮，色块上的文字仍是黑色加粗，色块覆盖整个关键词左右留一点 padding；第3行写"的原因"3个字，字号略小，承接第2行；第4行写"行动建议"短语（如"赶紧避开"/"提前绕开"），字号最大（比其他行大约 1.5 倍），下方加橙色（#FF8A3D）手绘波浪线作为下划线强调，波浪线略带手绘抖动感不要笔直。整体必须像真人在便签纸上随手吐槽写下，不要 PPT 模板感、不要装饰图标、不要任何插图、不要边框。文字部分用本篇实际生成的金句替换原图文字，保持 4 行堆叠结构和色彩点缀位置：黄色高亮必须出现在第2行的考试/科目关键词上，橙色波浪线必须出现在第4行行动建议下方。4 行文字必须构成一句通顺的中文。',
    forbiddenUse: ['第一人称真人案例', '具体姓名/学校', '资料清单', '课程招募', '广告海报感', 'PPT 模板感'],
    qualityRisk: 'AI 容易把 4 行金句压缩成 1 行或忽略黄块/波浪线，promptRecipe 必须强约束"4 行堆叠 + 第2行黄色横条高亮关键词 + 第4行橙色波浪下划线"三个视觉锚点；关键词拼写必须正确（DELF B2 / TCF / TCF Canada 等）。',
  },
];

export function matchResourceCovers(input: {
  contentKind?: string;
  noteFormat?: string;
  titleIntent?: string;
  scene?: string;
  limit?: number;
}): ResourceCoverRef[] {
  const kind = input.contentKind || '';
  const format = input.noteFormat || '';
  const titleIntent = input.titleIntent || '';
  const scene = input.scene || '';
  const limit = input.limit ?? 4;

  return [...resourceCoverRefs]
    .map(ref => {
      let score = 0;
      if (ref.contentFit.includes(kind)) score += 40;
      if (ref.contentFit.includes(format)) score += 20;
      if (ref.titleFit.includes(titleIntent)) score += 20;
      if (ref.sceneFit.some(item => scene.includes(item))) score += 10;
      if (kind === 'vocab' && ['vocab_table_overlay', 'collocation_dense', 'chalkboard_phrase'].includes(ref.type)) score += 25;
      if (kind === 'checklist' && ['grammar_system', 'document_analysis'].includes(ref.type)) score += 20;
      if (kind === 'self_test' && ['grammar_system', 'word_flashcard'].includes(ref.type)) score += 15;
      if (kind === 'opinion' && ['plain_experience', 'document_analysis'].includes(ref.type)) score += 12;
      if (kind === 'rewrite' && ['document_analysis', 'plain_experience'].includes(ref.type)) score += 18;
      if (ref.type === 'book_cover') score -= 20;
      return { ref, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.ref);
}
