import { CoverTemplateId } from '@/types/data';

export type CoverStyleId =
  | 'list_dense_pack'
  | 'list_redblue_dashboard'
  | 'table_big_grid'
  | 'table_split_decision'
  | 'pain_big_words'
  | 'pain_doc_callout'
  | 'doc_stack_sample'
  | 'doc_feishu_window'
  | 'practice_question_sheet'
  | 'practice_answer_mark'
  | 'rescue_countdown'
  | 'rescue_timeline';

export interface CoverStyle {
  id: CoverStyleId;
  coverTemplateId: CoverTemplateId;
  name: string;
  benchmarkSignal: string;
  visualRule: string;
}

export const coverStyles: CoverStyle[] = [
  {
    id: 'list_dense_pack',
    coverTemplateId: 'list_poster',
    name: '清单型A：厚资料包堆叠',
    benchmarkSignal: '清单整理型最多，核心是高密度、目录、数量感、收藏感',
    visualRule: '大标题 + 叠放资料页 + 左侧目录 + 2x2模块卡 + 红色强调条',
  },
  {
    id: 'list_redblue_dashboard',
    coverTemplateId: 'list_poster',
    name: '清单型B：红蓝信息看板',
    benchmarkSignal: '竞品常用红蓝标签突出“整理好了/别再乱找”',
    visualRule: '红蓝强标题 + 数据徽章 + 多行清单 + 底部资料标签',
  },
  {
    id: 'table_big_grid',
    coverTemplateId: 'table_compare',
    name: '表格型A：一表整理',
    benchmarkSignal: '表格对照型主类型114张，适合收藏和搜索',
    visualRule: '顶端标题 + 大面积双列表格 + 蓝色正确列 + 红色问题列',
  },
  {
    id: 'table_split_decision',
    coverTemplateId: 'table_compare',
    name: '表格型B：选择决策卡',
    benchmarkSignal: 'TEF/TCF、A/B选择类封面需要一眼帮用户决策',
    visualRule: '左右两张决策卡 + 中间VS + 底部判断标准',
  },
  {
    id: 'pain_big_words',
    coverTemplateId: 'white_blue_pain',
    name: '痛点型A：大字冲突',
    benchmarkSignal: '大字痛点和纯文字型相关123张，靠第一眼冲突',
    visualRule: '超大标题 + 少量红色否定词 + 三条失败原因',
  },
  {
    id: 'pain_doc_callout',
    coverTemplateId: 'white_blue_pain',
    name: '痛点型B：文档批注',
    benchmarkSignal: '痛点型叠加文档感会更像知识分享，而不是空白口号',
    visualRule: '大标题 + 文档片段 + 红色批注箭头',
  },
  {
    id: 'doc_stack_sample',
    coverTemplateId: 'document_sample',
    name: '截图型A：样张堆叠',
    benchmarkSignal: '文档截图型相关44张，关键是“看得见资料本体”',
    visualRule: '多张样张错位叠放 + 顶部资料标题 + 局部遮挡',
  },
  {
    id: 'doc_feishu_window',
    coverTemplateId: 'document_sample',
    name: '截图型B：飞书窗口',
    benchmarkSignal: '虚拟知识库产品要更像飞书/Notion真实页面',
    visualRule: '窗口头 + 目录栏 + 文档正文 + 侧边标注',
  },
  {
    id: 'practice_question_sheet',
    coverTemplateId: 'case_review',
    name: '练习型A：真题练习纸',
    benchmarkSignal: '真题练习型相关44张，适合题型、范文、刷题',
    visualRule: '题目纸 + 选项/横线 + 重点题号',
  },
  {
    id: 'practice_answer_mark',
    coverTemplateId: 'case_review',
    name: '练习型B：答案批改',
    benchmarkSignal: '练习结果/批改感比纯经验分享更有点击理由',
    visualRule: '练习纸 + 红色批改 + 分析标签',
  },
  {
    id: 'rescue_countdown',
    coverTemplateId: 'plan_table',
    name: '急救型A：倒计时清单',
    benchmarkSignal: '考前急救数量少但转化强，靠紧迫感',
    visualRule: '倒计时大数字 + 今日必做清单 + 红色优先级',
  },
  {
    id: 'rescue_timeline',
    coverTemplateId: 'plan_table',
    name: '急救型B：阶段路径',
    benchmarkSignal: '计划路径适合30天、CLB7、考前冲刺',
    visualRule: '三阶段时间轴 + 每阶段任务 + 底部提醒',
  },
];

const fallbackByTemplate: Partial<Record<CoverTemplateId, CoverStyleId[]>> = {
  mistake_compare: ['table_big_grid', 'table_split_decision'],
};

export function getCoverStylesForTemplate(templateId: CoverTemplateId): CoverStyle[] {
  const direct = coverStyles.filter(style => style.coverTemplateId === templateId);
  if (direct.length > 0) return direct;
  const fallbackIds = fallbackByTemplate[templateId] || ['list_dense_pack', 'list_redblue_dashboard'];
  return fallbackIds
    .map(id => coverStyles.find(style => style.id === id))
    .filter((style): style is CoverStyle => Boolean(style));
}

export function getCoverStyle(id?: string | null): CoverStyle | undefined {
  return coverStyles.find(style => style.id === id);
}
