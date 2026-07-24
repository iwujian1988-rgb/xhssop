import { CoverStyleId } from './cover-style-library';

export interface ReferenceCover {
  id: string;
  styleId: CoverStyleId;
  account: string;
  imageFile: string;
  localPath: string;
  previewPath: string;
  coverText: string;
  layoutSignals: string[];
  mimicRules: string[];
}

export const referenceCovers: ReferenceCover[] = [
  {
    id: 'ref_list_01',
    styleId: 'list_dense_pack',
    account: 'TCFgo法语加拿大',
    imageFile: '6a0306e9000000003502a26e.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a0306e9000000003502a26e.heif'),
    previewPath: '/reference-covers/ref_list_01.png',
    coverText: 'TCF考试',
    layoutSignals: ['清单整理型', '高密度', '多模块', '资料目录感'],
    mimicRules: ['标题要短', '下半区放资料模块', '必须出现数量或模块名', '整体像整理好的资料包'],
  },
  {
    id: 'ref_list_02',
    styleId: 'list_redblue_dashboard',
    account: 'TCFgo法语加拿大',
    imageFile: '6a04b77100000000380366ce.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a04b77100000000380366ce.heif'),
    previewPath: '/reference-covers/ref_list_02.png',
    coverText: 'TCF Canada备考 | 短期冲分真正有用的不是学很多，而是练得像考试',
    layoutSignals: ['清单整理型', '红蓝强调', '痛点清单', '知识分享感'],
    mimicRules: ['用红色标低效动作', '用蓝色承接正确动作', '保留多行解释但不塞满全屏'],
  },
  {
    id: 'ref_table_01',
    styleId: 'table_big_grid',
    account: 'TCFgo法语加拿大',
    imageFile: '6807e7ed000000000b02ff95.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6807e7ed000000000b02ff95.heif'),
    previewPath: '/reference-covers/ref_table_01.png',
    coverText: 'TCF CANADA 模考系统',
    layoutSignals: ['表格对照型', '清单整理型', '数据指标', '分区网格'],
    mimicRules: ['使用大面积表格区', '用多列指标体现资料量', '上方标题要像产品/资料名'],
  },
  {
    id: 'ref_table_02',
    styleId: 'table_split_decision',
    account: 'TCFgo法语加拿大',
    imageFile: '6a035d560000000036030bbf.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a035d560000000036030bbf.heif'),
    previewPath: '/reference-covers/ref_table_02.png',
    coverText: '2026最新TCF CAD',
    layoutSignals: ['表格对照型', '文档截图型', '选择决策', '信息分块'],
    mimicRules: ['左右对比', '中间给判断线索', '底部给决策提醒'],
  },
  {
    id: 'ref_pain_01',
    styleId: 'pain_big_words',
    account: 'TCFgo法语加拿大',
    imageFile: '6a01f1e6000000003701c932.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a01f1e6000000003701c932.heif'),
    previewPath: '/reference-covers/ref_pain_01.png',
    coverText: 'TCF法语时态 | 别再死背变位了',
    layoutSignals: ['大字痛点型', '纯文字封面型', '低密度', '一句核心结论'],
    mimicRules: ['标题必须有冲突', '正文只放3条失败原因', '不要像PPT说明页'],
  },
  {
    id: 'ref_pain_02',
    styleId: 'pain_doc_callout',
    account: 'TCFgo法语加拿大',
    imageFile: '6a0de7e100000000370340ec.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a0de7e100000000370340ec.heif'),
    previewPath: '/reference-covers/ref_pain_02.png',
    coverText: '如何提升法语听力',
    layoutSignals: ['文档截图型', '痛点解释', '局部批注', '知识分享'],
    mimicRules: ['标题上方留白', '中部放文档片段', '用红色箭头指出问题'],
  },
  {
    id: 'ref_doc_01',
    styleId: 'doc_stack_sample',
    account: 'TCFgo法语加拿大',
    imageFile: '6a0c9fff00000000380353d3.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a0c9fff00000000380353d3.heif'),
    previewPath: '/reference-covers/ref_doc_01.png',
    coverText: 'TCF CA...',
    layoutSignals: ['文档截图型', '资料样张', '截图堆叠', '真实材料感'],
    mimicRules: ['必须露出资料本体', '可以遮挡部分内容', '不能只画假线条'],
  },
  {
    id: 'ref_doc_02',
    styleId: 'doc_feishu_window',
    account: 'TCFgo法语加拿大',
    imageFile: '6a11ddc9000000003700dfb8.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a11ddc9000000003700dfb8.heif'),
    previewPath: '/reference-covers/ref_doc_02.png',
    coverText: 'TCF CA写作',
    layoutSignals: ['文档截图型', '清单整理型', '窗口截图', '目录结构'],
    mimicRules: ['做成飞书/Notion窗口', '左侧必须有目录', '右侧必须有真实模块名'],
  },
  {
    id: 'ref_practice_01',
    styleId: 'practice_question_sheet',
    account: 'TCFgo法语加拿大',
    imageFile: '6a0f39070000000036003090.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a0f39070000000036003090.heif'),
    previewPath: '/reference-covers/ref_practice_01.png',
    coverText: 'TCF Canada 写作T1',
    layoutSignals: ['真题练习型', '题目纸', '写作任务', '练习感'],
    mimicRules: ['像练习纸', '出现题号/任务', '不要做成纯清单'],
  },
  {
    id: 'ref_practice_02',
    styleId: 'practice_answer_mark',
    account: 'TCFgo法语加拿大',
    imageFile: '6a15c429000000003501ca0f.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a15c429000000003501ca0f.heif'),
    previewPath: '/reference-covers/ref_practice_02.png',
    coverText: 'TCF CA写作 | 城市',
    layoutSignals: ['真题练习型', '文档截图型', '批改感', '红色标注'],
    mimicRules: ['练习纸上加批注', '突出丢分点', '底部给分析标签'],
  },
  {
    id: 'ref_rescue_01',
    styleId: 'rescue_countdown',
    account: '英语冲九分学',
    imageFile: '698460bc000000000a032d07.heif',
    localPath: competitorImagePath('英语冲九分伟学', '698460bc000000000a032d07.heif'),
    previewPath: '/reference-covers/ref_rescue_01.png',
    coverText: '一天速成',
    layoutSignals: ['考前急救型', '大数字', '紧迫感', '短期目标'],
    mimicRules: ['必须有时间数字', '必须给今日优先项', '不能承诺必过'],
  },
  {
    id: 'ref_rescue_02',
    styleId: 'rescue_timeline',
    account: 'TCFgo法语加拿大',
    imageFile: '6a04b77100000000380366ce.heif',
    localPath: competitorImagePath('TCFgo法语加拿大', '6a04b77100000000380366ce.heif'),
    previewPath: '/reference-covers/ref_rescue_02.png',
    coverText: '短期冲分真正有用的不是学很多',
    layoutSignals: ['计划路径型', '阶段任务', '短期备考', '执行清单'],
    mimicRules: ['三阶段结构', '每阶段只放一个任务', '底部提醒先排顺序'],
  },
];

export function getReferenceCoversForStyle(styleId?: string | null): ReferenceCover[] {
  return referenceCovers.filter(ref => ref.styleId === styleId);
}

function competitorImagePath(account: string, imageFile: string) {
  return `D:\\claude_work\\taolun\\法语付费资料\\_xhs_competitor\\${account}\\images\\${imageFile}`;
}
