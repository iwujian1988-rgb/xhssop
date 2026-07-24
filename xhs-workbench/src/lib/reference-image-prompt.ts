import type { CompetitorCreativeCard, DenseDirectoryCoverPayload, CreativeCardRenderer } from '@/types/reference-workflow';

/** 锁定不变：构图骨架、配色、标题处理方式。 */
const TEMPLATE_CORE: Partial<Record<CreativeCardRenderer, string>> = {
  book_cover: [
    '3:4竖版小红书封面，法语教材封面风，扁平矢量插画，干净现代。',
    '骨架固定：顶部朱红+青绿双色条 → 中部大白底超大深蓝无衬线标题+青绿副标题+左侧深蓝竖条 → 下半青绿底插画区。',
    '配色固定：青绿#3F8880、朱红#C1272D、深蓝#2B547E、纯白。整体像实体法语教材封面，信息疏朗，不是PPT。',
    '标题处理固定：主标题居中巨大、清晰、可换行；副标题更小更浅。',
  ].join('\n'),

  vocab_table: [
    '3:4竖版小红书封面，主题词汇表压屏风。',
    '骨架固定：背景是真实感很强的蓝白双语词汇表格截图（多段表格、深蓝表头、细灰边框、法语词+中文释义密排）→ 正中央叠超大白字黑描边中文主标题。',
    '配色固定：冷色蓝白为主，表头深蓝，标题白字黑描边。整体高密度、资料厚重感，不像网页UI。',
    '标题处理固定：字号极大，手机缩略图一眼能看清；压在表格之上但不把表格纹理完全遮死。',
  ].join('\n'),

  course_roadmap: [
    '3:4竖版小红书封面，浅蓝信息图学习路径风。',
    '骨架固定：顶部大号深蓝中文主标题 → 主体两栏（左适合人群 / 右四阶段卡片）→ 底部资料承接条。',
    '配色固定：浅蓝底#E6F0FF、深蓝标题、白卡片、少量黄色点缀。扁平信息图，干净不幼稚。',
    '标题处理固定：顶部居中大号深蓝无衬线标题，清晰醒目。',
  ].join('\n'),
};

/** 每次随机抽一条：只动次要细节，不动主体风格和标题风格。 */
const TEMPLATE_VARIATIONS: Partial<Record<CreativeCardRenderer, string[]>> = {
  book_cover: [
    '本次细节：一对人物面对面交谈，手势自然；气泡图标用信封、灯泡、地球、齿轮。',
    '本次细节：左侧人物托腮思考，右侧人物比出讲解手势；气泡图标用书本、铅笔、对勾、问号。',
    '本次细节：两人并肩看向同一本打开的资料；气泡图标用时钟、清单、星星、@符号。',
    '本次细节：一人举手提问、一人点头回应；气泡图标用咖啡杯、笔记本、灯泡、地球。',
    '本次细节：人物半身剪影偏侧身，气氛轻松；气泡大小错落，图标用邮件、购物车、饼图、齿轮。',
  ],
  vocab_table: [
    '本次细节：右上角小页码气泡写1/8；表格分两段主题，表头略深。',
    '本次细节：右上角页码气泡写2/10；表格三段，中间段略浅灰底。',
    '本次细节：标题略偏上三分之一；表格四列清晰，右下角有轻微纸张阴影。',
    '本次细节：标题略居中偏下；表格更密，左侧多一列主题标签色块。',
    '本次细节：页码气泡改成圆形角标；表格边框更细，背景带一点点扫描资料质感。',
  ],
  course_roadmap: [
    '本次细节：右侧四张阶段卡错落排列；插画是坐着看书的人。',
    '本次细节：右侧阶段卡呈轻微阶梯下落；插画是走路捧书的人。',
    '本次细节：左侧人群条目配小心形/笑脸小图标；右侧卡内放打开的书本小插画。',
    '本次细节：阶段卡之间用细箭头串联；底部承接条带一盏小黄灯泡点缀。',
    '本次细节：右侧卡大小略有差异更有手工信息图感；插画是站立讲解的人物剪影。',
  ],
};

function pickOne(items: string[]) {
  return items[Math.floor(Math.random() * items.length)] || '';
}

export function buildReferenceImagePrompt(card: CompetitorCreativeCard, cover: DenseDirectoryCoverPayload) {
  const core = TEMPLATE_CORE[card.renderer_id];
  if (!core) throw new Error(`模板 ${card.renderer_id} 尚未配置文生图提示词`);

  const variationPool = TEMPLATE_VARIATIONS[card.renderer_id] || [];
  const variation = variationPool.length ? pickOne(variationPool) : '';

  const content = cover.sections.map((section, index) => [
    `${index + 1}. ${section.heading}`,
    ...section.items.map(item => `- ${item.primary}${item.secondary ? `｜${item.secondary}` : ''}${item.note ? `（${item.note}）` : ''}`),
  ].join('\n')).join('\n');

  return [
    '直接文生图，输出一张完整的3:4竖版小红书封面成品。不要上传参考图，不要图生图编辑。',
    '【模板骨架·必须保持一致】',
    core,
    variation ? `【本次允许变化的细节·只改这些】\n${variation}\n注意：主体风格、配色、标题字号层级和版式骨架不要变；只让人物姿势/图标/小点缀有新鲜感。` : '',
    '【本篇必须写入画面的文案——一字不改地画出来】',
    `主标题：${cover.title}`,
    `副标题：${cover.subtitle || '（无）'}`,
    `正文内容：\n${content}`,
    '【硬性要求】',
    '画面必须填满整张图，禁止大片留白或下半截空白。',
    '中文和法语清楚可读、无乱码、无断词、无重叠；标题在手机缩略图仍能看清。',
    '只使用上面的本篇文案，不要编造品牌、出版社、作者、账号、二维码、咨询入口。',
    card.renderer_id === 'course_roadmap'
      ? '底部承接只写资料包/练习路径，禁止一对一、直播课、老师批改、无限答疑等服务承诺。'
      : '',
  ].filter(Boolean).join('\n\n');
}

export const referenceImageNegativePrompt = [
  '不要图生图式半成品，不要大片空白。',
  '不要PPT风、网页卡片风、极简空海报。',
  '不要乱码、错别字、随机英文、文字重叠、断词、过小标题。',
  '不要真实出版社logo、作者签名、二维码、水印、咨询按钮。',
].join('\n');
