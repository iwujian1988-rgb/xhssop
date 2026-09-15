import type { CompetitorCreativeCard, CreativeCardRenderer } from '@/types/reference-workflow';

type UserCoverReference = {
  id: string;
  name: string;
  image: string;
  renderer: CreativeCardRenderer;
  fit: string;
  density: CompetitorCreativeCard['density'];
};

// 用户提供的母版只进入视觉验收，不进入普通批次的随机选择池。
// 原图保留为对照证据；生产封面仍由对应 renderer 重新排字，避免旧主题文字泄漏。
const references: UserCoverReference[] = [
  { id: 'user_toc_dense', name: '雅思口语库·26年8月题库', image: '/reference-covers/user/752957aeb66116867163ea7789e97c35.jpg', renderer: 'ielts_speaking_toc', fit: '雅思口语题库、Part 1/2/3、章节清单、资料包总览', density: 'very_high' },
  { id: 'user_formula_sheet', name: '刑法64个罪名公式表', image: '/reference-covers/user/4a18c2984b942f2dcea718e92c9a8d1c.jpg', renderer: 'criminal_law_formula', fit: '罪名公式、规则表、构成要件、错误对照', density: 'very_high' },
  { id: 'user_three_column_phrase', name: '英语语法顺口溜·三列速记', image: '/reference-covers/user/8a3158cac4c7b9398081f8caaff1122b.jpg', renderer: 'english_grammar_grid', fit: '英语语法短语、顺口溜、句型替换、重点规则', density: 'very_high' },
  { id: 'user_vocab_table', name: '法语阴阳性词汇表', image: '/reference-covers/user/4229023d58e5e3161a4348bb77f80bae.jpg', renderer: 'french_gender_vocab', fit: '法语词汇表、阴阳性、词义对照、主题词库', density: 'very_high' },
  { id: 'user_handwritten_history', name: '毛爷爷文章·手写精读', image: '/reference-covers/user/ad6b2b96d2cf2e48d629f5c8af9591b4.jpg', renderer: 'mao_article_notes', fit: '文章精读、历史重点、观点摘录、材料整理', density: 'high' },
  { id: 'user_handwritten_grammar', name: '英语语法顺口溜·手账版', image: '/reference-covers/user/f545a8e4e7fa3d4bdc228e6b7ccc45f4.jpg', renderer: 'english_grammar_notebook', fit: '语法口诀、易错点、语法顺口溜、考前提醒', density: 'high' },
  { id: 'user_question_bank', name: '法语口语双语题库', image: '/reference-covers/user/060894f26415905c4da334e0d0cd3ed1.jpg', renderer: 'french_oral_question_bank', fit: '真题题库、双语问题、口语问答、题型合集', density: 'very_high' },
  { id: 'user_practice_sheet', name: '法语A1练习题库', image: '/reference-covers/user/cbd8f9d055a93c84d6c6af891f740e92.jpg', renderer: 'french_a1_practice_sheet', fit: '选择题、练习题、考点自测、题目演示', density: 'high' },
  { id: 'user_dictionary_dense', name: 'SAT进阶词汇必背', image: '/reference-covers/user/20ff6db2c0851a304dedd65fb4992e48.jpg', renderer: 'sat_vocab_dictionary', fit: 'SAT词典、进阶词汇、词根词族、例句、长列表资料', density: 'very_high' },
  { id: 'user_roadmap_four_steps', name: '雅思小作文·四段流程', image: '/reference-covers/user/3be6ea23907bd9095670f76ae1daf324.jpg', renderer: 'ielts_task1_four_part', fit: '雅思小作文、流程图写作、写作步骤、框架总结', density: 'high' },
];

export const userCoverReferenceCards: CompetitorCreativeCard[] = references.map(item => ({
  id: item.id,
  name: item.name,
  reference_image: item.image,
  renderer_id: item.renderer,
  content_mechanism: `用户参考母版：${item.fit}。`,
  click_mechanism: '用清晰的信息量和真实资料感，让用户一眼知道里面有具体内容。',
  visual_mechanism: '原图只作视觉参照；生产时由程序重新排字。',
  suitable_audiences: ['需要可直接查阅资料的人', '偏好高信息量封面的人'],
  suitable_pains: [item.fit],
  required_payload: ['真实可展示的条目', '可识别的资料对象', '与母版密度匹配的排版结构'],
  forbidden_uses: ['直接复用原图文字', '没有足量内容却强行使用高密度母版', '把目录母版用于单句痛点标题'],
  density: item.density,
  supported: true,
}));
