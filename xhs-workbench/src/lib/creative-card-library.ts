import { resourceCoverRefs } from './resource-cover-library';
import type { CompetitorCreativeCard, CreativeCardRenderer } from '@/types/reference-workflow';
import { PRODUCT_SHOWCASE_ANGLES } from './product-showcase-library';

const rendererByReference: Record<string, CreativeCardRenderer> = {
  resource_01_grammar_parchment_red: 'parchment_dense_directory',
  resource_02_grammar_white_green: 'white_green_directory',
  resource_03_chalkboard_course: 'blackboard_offer',
  resource_04_chalkboard_phrase_list: 'blackboard_phrase',
  resource_05_grammar_clean_purple: 'clean_purple_directory',
  resource_06_notes_course_offer: 'memo_offer',
  resource_07_question_words_parchment: 'word_flashcard',
  resource_08_book_cover_fle: 'book_cover',
  resource_15_grammar_grid_purple: 'grid_purple_directory',
  resource_09_notebook_warning: 'notebook_big_words',
  resource_10_plain_text_experience: 'plain_experience',
  resource_11_delf_doc_analysis: 'document_analysis',
  resource_12_delf_vocab_table_overlay: 'vocab_table',
  resource_13_course_roadmap_blue: 'course_roadmap',
  resource_14_collocation_dense_green: 'collocation_dense',
  resource_16_official_notice: 'official_notice',
  resource_17_pain_quote: 'pain_quote_big',
};

const mechanismByType: Record<string, { content: string; click: string }> = {
  grammar_system: {
    content: '把一个复杂主题拆成有层级、有分组、可收藏的完整知识地图。',
    click: '利用完整感、体系感和高信息密度，让用户觉得一张图能省下大量整理时间。',
  },
  chalkboard_phrase: {
    content: '围绕一个表达任务，连续展示可以直接学习和替换的短语。',
    click: '真实手写感加密集可用内容，制造“背完马上能用”的感觉。',
  },
  handwritten_warning: {
    content: '用真实学习场景承载一个强痛点判断，再给出解决方向。',
    click: '笔记本实拍感降低广告感，大字痛点负责停留。',
  },
  document_analysis: {
    content: '展示真实文档片段，并围绕片段做重点拆解。',
    click: '用真实资料证据建立专业度和获得感。',
  },
};

export const competitorCreativeCards: CompetitorCreativeCard[] = resourceCoverRefs.map(ref => {
  const mechanism = mechanismByType[ref.type] || {
    content: `沿用${ref.type}的内容组织方式，迁移成法语学习主题。`,
    click: '保留参考笔记的信息层级和第一眼识别机制。',
  };
  const rendererId = rendererByReference[ref.id] || 'ai_scene_overlay';
  return {
    id: ref.id,
    name: ref.name,
    reference_image: ref.image,
    renderer_id: rendererId,
    content_mechanism: mechanism.content,
    click_mechanism: mechanism.click,
    visual_mechanism: `${ref.layout} ${ref.styleNotes}`,
    suitable_audiences: ref.sceneFit,
    suitable_pains: ref.contentFit,
    required_payload: [
      `信息密度：${ref.density}`,
      `文字容量：${ref.textCapacity}`,
      '标题、分组和知识内容必须围绕同一个主题',
      '高密度模板必须有足量且真正可用的内容',
    ],
    forbidden_uses: ref.forbiddenUse,
    density: ref.density,
    supported: rendererId !== 'ai_scene_overlay',
  };
});

// 知识库介绍模式使用真实资料截图做底图。它们和普通竞品母版分开命名，
// 这样普通模式不会误选这些卡，showcase 模式也能在前台明确看到“截图+叠字”。
const showcaseCards: CompetitorCreativeCard[] = [
  ['directory', '知识库目录截图', '/showcase/delf_b2_writing/directory.png', '目录', '完整目录带来资料获得感和收藏理由'],
  ['library_intro', '范文库说明截图', '/showcase/delf_b2_writing/library-intro.jpg', '范文库', '用真实模块说明资料怎么查、怎么练'],
  ['sample_analysis', '范文解析截图', '/showcase/delf_b2_writing/sample-analysis.jpg', '范文解析', '用真实样张证明内容不是空目录'],
  ['phrase_vocab', '句型词汇截图', '/showcase/delf_b2_writing/phrase-vocab.jpg', '句型词汇', '展示资料颗粒度和可直接使用的查阅价值'],
].map(([type, name, image, contentLabel, click]) => ({
  id: `showcase_delf_b2_${type}`,
  name,
  reference_image: image,
  renderer_id: 'showcase_screenshot' as CreativeCardRenderer,
  content_mechanism: `知识库介绍模式：${contentLabel}截图作为真实商品证据。`,
  click_mechanism: click,
  visual_mechanism: '保留原截图的真实纹理、光线和信息密度，只在安全区叠加本篇标题。',
  suitable_audiences: ['准备DELF B2写作的学习者', '需要系统资料而不是零散技巧的人'],
  suitable_pains: ['不知道资料包里具体有什么', '想先看内容质量再决定是否购买'],
  required_payload: ['真实截图底图', '短封面标题', '一句副标题', '商品展示角度'],
  forbidden_uses: ['普通知识点讲解', '与截图无关的考试科普', '课程或老师服务招募'],
  density: 'high' as const,
  supported: true,
}));

export const productShowcaseCreativeCards = showcaseCards;
// 截图叠字是“介绍知识库”专用素材，普通知识分享模式必须排除。
export const standardCreativeCards = competitorCreativeCards.filter(card => card.renderer_id !== 'showcase_screenshot');
export const showcaseAngleLabels = PRODUCT_SHOWCASE_ANGLES.map(item => item.label);

competitorCreativeCards.push(...showcaseCards);

export function getCompetitorCreativeCard(id: string): CompetitorCreativeCard | undefined {
  return competitorCreativeCards.find(card => card.id === id);
}
