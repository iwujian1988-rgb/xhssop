import { resourceCoverRefs } from './resource-cover-library';
import type { CompetitorCreativeCard, CreativeCardRenderer } from '@/types/reference-workflow';

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

export function getCompetitorCreativeCard(id: string): CompetitorCreativeCard | undefined {
  return competitorCreativeCards.find(card => card.id === id);
}
