// 标题主题锚定校验：每个 seed 必须命中的主题关键词集。
// 关键词来源：seed 的 dynamic_fact_terms + topic 核心名词 + 常见口语变体。
// 用途：
//   1. 在 callTitleEditor prompt 里把 required_keywords 显式喂给 LLM；
//   2. 在 normalizeTitles / titleImpactScore 里做软校验（未命中扣分）。
// 设计原则：
//   - 关键词要"足够窄"，避免一篇通用鸡汤标题也能命中；
//   - 关键词要"足够宽"，避免把 LLM 写出来的合理同义词误判为离题。

const SEED_TOPIC_KEYWORDS: Record<string, string[]> = {
  // ===== DELF B2 写作（50 条） =====
  delf_formal_opening_closing: [
    '开头', '结尾', '正式信', '礼貌', '敬语', 'Cordialement', '称呼', '写信', '收尾', '首句',
  ],
  delf_final_check: [
    '检查', '自查', '交卷', '扣分点', '复盘', '清单', '检查清单', '考前',
  ],
  delf_wrong_right: [
    '错句', '错误', '纠错', '改写', '语法错', '性数', '错题', '直译', '正解', '病句',
  ],
  delf_sentence_upgrade: [
    '句式', '句型', '让步', '条件', '虚拟式', '复杂句', '升级', '句法', '结构', '改写',
  ],
  delf_connectors: [
    '连接词', '过渡', '逻辑词', '衔接', '逻辑', 'donc', 'mais', 'parce que', '因果', '让步',
  ],
  delf_topic_vocabulary: [
    '主题词', '词汇', '搭配', '主题', '教育', '环境', '科技', '工作', '健康', '社交媒体', '词块',
  ],
  delf_argument_bank: [
    '观点', '论据', '例子', '展开', '论证', '让步', '理由', '立场', '论点',
  ],
  delf_sample_transfer: [
    '范文', '仿写', '迁移', '拆解', '结构', '可迁移', '可替换', '拆范文',
  ],
  delf_task_formats: [
    '题型', '格式', '正式信', '论坛', '议论文', '任务', '三类', '任务形式',
  ],
  delf_learning_route: [
    '复习', '顺序', '路径', '阶段', '计划', '安排', '诊断', '学习路径', '备考顺序', '时间安排',
  ],
  delf_scoring_dimensions: [
    '评分', '维度', '打分', '考官', '标准', '任务完成', '连贯', '语体',
  ],
  delf_combination_examples: [
    '组合', '拼', '组装', '完整句', '仿写', '组合示例',
  ],
  delf_product_showcase: [
    '资料', '知识库', '资料包', '整理', '使用说明', '资料库',
  ],

  // ===== DELF B2 写作 扩展（37 条） =====
  delf_showcase_master_map: [
    '备考地图', '全局地图', '阶段任务', '路线总览', '四周规划', '地图怎么用',
  ],
  delf_showcase_quick_check: [
    '速查手册', '速查', '考前速查', '翻一遍', '速查维度', '手册怎么用',
  ],
  delf_showcase_phrase_library: [
    'B2表达库', '场景分类表达', 'B2功能分类', 'B2表达调用', 'DELF表达库', 'B2调用顺序',
  ],
  delf_time_allocation: [
    '时间分配', '时间表', '60分钟', '时间坑', '时间花错', '考场节奏',
  ],
  delf_topic_analysis: [
    '读题', '跑题检查', '任务信号', '立场对象', '审题', '读题步骤',
  ],
  delf_paragraph_structure: [
    '段落结构', '主题句', '论证链', '段落框架', '分段', '段间',
  ],
  delf_self_evaluation: [
    '自评', '作文自评', '自查问题', '评分维度自查', '给自己打分', '作文复盘',
  ],
  delf_topic_themes: [
    '常考主题', '主题论据', '论据库', '主题准备', '高频主题', 'B2写作主题',
  ],
  delf_warmup_routine: [
    '热身', '考场热身', '5分钟热身', '10分钟热身', '进入状态', '破冰',
  ],
  delf_tense_usage: [
    'B2写作时态', '时态选择', '复合过去时', '未完成过去时', '时态混用', '语式',
  ],
  delf_register_switch: [
    '语体', '语体切换', '正式口语', 'on we 争论', '语体一致', '语气跳跃',
  ],
  delf_letter_complaint: [
    '投诉信', 'lettre de réclamation', 'réclamation', '投诉结构', '投诉模板', '投诉信写法',
  ],
  delf_letter_proposal: [
    '建议信', 'lettre de proposition', 'proposition', '建议结构', '可执行建议', '建议信写法',
  ],
  delf_letter_application: [
    '申请信', 'lettre de motivation', '动机信', '经历匹配', '差异化', '动机信写法',
  ],
  delf_forum_response: [
    '论坛投稿', 'forum', '论坛语气', '网友互动', '论坛回复', '半正式',
  ],
  delf_theme_environment: [
    '环境主题', 'recyclage', 'pollution', 'éco-responsabilité', '新能源', '碳足迹',
  ],
  delf_theme_education: [
    'B2教育主题', 'école', 'pédagogie', "numérique à l'école", 'devoirs', 'redoublement',
  ],
  delf_theme_work: [
    'B2工作主题', 'télétravail', '35h', 'CDI', 'CDD', 'chômage',
  ],
  delf_theme_tech: [
    'B2科技主题', 'IA', 'numérique', 'réseaux sociaux', 'RGPD', '算法',
  ],
  delf_pain_opening_blank: [
    '第一句憋不出', '开头憋不出', '破题', '5种开头', '开头模板', '写不出第一句',
  ],
  delf_pain_off_topic: [
    '写着跑题', '立场摇摆', '对象错位', '跑题修复', '写中跑题', '跑题自查',
  ],
  delf_pain_examples_dry: [
    '例子干瘪', 'par exemple', '举不出例子', '抽象论证', '例子生成', '论证空泛',
  ],
  delf_pain_score_stuck: [
    '分数卡住', '11分', '12分', '分数瓶颈', '提升路径', '卡在11分',
  ],
  delf_pain_logic_jump: [
    '段落跳跃', '过渡句', '逻辑衔接', '段间过渡', 'connecteur', '逻辑断裂',
  ],
  delf_selling_one_week_plan: [
    '一周冲刺', '考前一周', '7天冲刺', '冲刺方案', '考前日程', '一周方案',
  ],
  delf_selling_theme_prediction: [
    '主题预测', '高频主题', '必考主题', '预测主题', 'B2写作预测', '主题押题',
  ],
  delf_selling_high_freq_phrases: [
    '高频表达', '万能句', 'B2句型', '反复出现', '高频句', 'B2万能句',
  ],
  delf_selling_mistake_collection: [
    '错题集', '错句改法', '典型错误', '错例', '改错练习', '错误对照',
  ],
  delf_showcase_topic_prediction: [
    '预测手册', '主题手册', '手册怎么用', '预测调用', '手册结构', '主题预测手册',
  ],
  delf_showcase_correction_set: [
    '批改案例', '案例集', '批改集', '自学顺序', '错误类型', '批改流程',
  ],

  // ===== 三车道重建：车道 1 爆款钩子（24 条） =====
  delf_hook_first_sentence: [
    '第一句', '开头', '憋不出', '落笔', '开不了头', '12个开头',
  ],
  delf_hook_5day_letter: [
    '5天', '速成', '7步骤', '每天', '拆到每天', '5天速成',
  ],
  delf_hook_20_sentences: [
    '20条', '整句', '组合', '替换', '组合示例', '改两个词',
  ],
  delf_hook_forum_openers: [
    '论坛', '网友感', '功能表达', '半正式', '论坛语气', '网友',
  ],
  delf_hook_3hour_sweep: [
    '3小时', '句法', '扫一遍', '100条', '考前3小时', '过一遍',
  ],
  delf_grammar_top4: [
    '语法错', '丢分', '错误类型', '对照', '典型错误', '9类',
  ],
  delf_hook_30s_task: [
    '30秒', '文体', '归零', '判文体', '识别', '判错',
  ],
  delf_hook_closing_swap: [
    '结尾', '收尾', 'Cordialement', '结论句', '12个收尾', '换着用',
  ],
  delf_hook_second_paragraph: [
    '第二段', '没话说', '论据', '观点', '展开', '填',
  ],
  delf_hook_title_read: [
    '信号词', '跑题', '读题', '审题', '任务要求', '漏看',
  ],
  delf_hook_wordcount: [
    '字数', '篇幅', '写不够', '太密', '段落长度', '数字数',
  ],
  delf_hook_essay_template: [
    '议论文', '骨架', '流程', '结构', 'essai', '搭骨架',
  ],
  delf_hook_letter7step: [
    '60分钟', '7步', '时长', '超时', '时间表', '7步走',
  ],
  delf_hook_report_article: [
    'article', 'rapport', '低频文体', '照搬', '标准结构', '别慌',
  ],
  delf_hook_rescue_pack: [
    '救命', '空白', '救命题', '应急', '考场草稿', '5个救命',
  ],
  delf_hook_opinion_cards: [
    '观点卡', '观点', '例子', '论据', '卡片', '50条',
  ],
  delf_hook_transition_bank: [
    '过渡', '因果', '递进', '衔接', '连接', '干巴巴',
  ],
  delf_hook_one_per_day: [
    '4周', '8篇', '每天', '照表', '60分钟', '一天',
  ],
  delf_hook_last_night: [
    '前一晚', '36项', '排查', '清单', '考前一晚', '5分钟',
  ],
  delf_hook_mock_to_real: [
    '模考', '实考', '自评', '翻车', '落差', '6题',
  ],
  delf_hook_stop_practicing: [
    '瞎练', '定位', '诊断', '档位', '5道题', '别再练',
  ],
  delf_hook_hard_topics: [
    '主题', '矩阵', '交叉', '生僻', '主题准备', '10个主题',
  ],
  delf_hook_brain_blank: [
    '空白', '紧张', '启动', '开考', '十分钟', '救回来',
  ],
  delf_hook_common_top10: [
    '常见错', '类型', '自查', '低级', '典型错误', '交上去',
  ],

  // ===== 三车道重建：车道 2 粗知识点（4 条） =====
  delf_coarse_5_modules: [
    '全景', '模块', '先后', '地图', '7大', '先学哪个',
  ],
  delf_coarse_full_walkthrough: [
    '流程对比', '三大文体', '并排', '流程图', '正式信', '议论文',
  ],
  delf_coarse_task_compare: [
    '对照表', '选文体', '判断依据', '5种', '文体', '一张表',
  ],
  delf_coarse_5steps: [
    '打分', '维度', '考官', '提分', '评分', '5个维度',
  ],

  // ===== 三车道重建：车道 3 showcase（6 条） =====
  delf_showcase_diagnosis_path: [
    '诊断', '3档', '先测再学', '路径', '自测', '问卷',
  ],
  delf_showcase_theme_matrix: [
    '主题矩阵', '配齐', '交叉', '矩阵', '主题', '观点词汇句法',
  ],
  delf_showcase_exam_rules: [
    '考场规矩', '装包', '低级失误', '16条', '收卷', '取消资格',
  ],
  delf_showcase_self_eval_6: [
    '自评', '6题', '打分', '复盘', '反馈', '几个分',
  ],
  delf_showcase_essay_lib: [
    '范文', '可替换', '拆', '22篇', '范文库', '拆表达',
  ],
  delf_showcase_checklist36: [
    '36项', '逐条勾', '交卷前', '检查清单', 'E1', '7类',
  ],

  // ===== TEF/TCF 加拿大（50 条） =====
  tef_exam_choice: [
    'TEF', 'TCF', '选考', 'CLB', 'NCLC', '题型', '加拿大法语', '移民法语', '报名',
  ],
  tef_clb7_self_test: [
    'CLB7', 'NCLC7', '自测', '四科', '差距', '听力', '口语', '写作',
  ],
  tef_30_day_plan: [
    '30天', '每天2小时', '计划', '复盘', '训练', '备考计划',
  ],
  tef_writing_patterns: [
    '句型', '写作', '让步', '对比', '因果', '总结', '模板', 'TEF写作', 'TCF写作',
  ],
  tef_topic_vocab: [
    '主题词', '600词', '主题', '词汇', '搭配', '移民', '教育', '工作', '科技', 'TEF词汇',
  ],
  tef_true_topics: [
    '真题主题', '写作主题', '观点', '例子', '素材', '高频主题', 'TEF写作', 'TCF写作',
  ],
  tef_listening_method: [
    '听力', '精听', '复听', '语速', '口音', '错因', 'TEF听力', 'TCF听力',
  ],
  tef_speaking_strategy: [
    '口语', '论据', '过渡句', '开口', '模拟', 'TEF口语', 'TCF口语',
  ],
  tef_b2_c1_comparison: [
    'B2', 'C1', '范文', '结构', '论证', '词汇', '高分',
  ],
  tef_exam_day_flow: [
    '报名', '机考', '查分', '流程', '考前', '考试当天',
  ],
  tef_avoid_pitfalls: [
    '避坑', '备考经验', '复盘', '资料', '路线', '坑',
  ],
  tef_product_showcase: [
    '资料包', 'TEF', 'TCF', 'CLB7', '资料', '12份',
  ],

  // ===== TEF/TCF 加拿大 扩展（38 条） =====
  tef_ee_french_stream_intro: [
    'EE法语通道', '加拿大EE', 'EE通道', '入池门槛', '捞人分数线', '法语移民',
  ],
  tef_ee_score_bonus: [
    'EE法语加分', 'CRS加分', '法语加分', '法语单抽', 'CLB7加分', '加分算分',
  ],
  tef_ee_diy_timeline: [
    'EE DIY', 'DIY时间线', '学历认证', '入池捞人', 'PR流程', '法语通道DIY',
  ],
  tef_ee_policy_change: [
    'EE大改', 'EE改革', 'IRCC', '法语通道政策', '政策变化', 'EE政策',
  ],
  tef_zero_to_clb7_timeline: [
    '零基础到CLB7', '零基础法语', '零基础自学', '自学时间线', '在职零基础', '多久到CLB7',
  ],
  tef_working_adult_strategy: [
    '在职备考', '每天1小时', '在职法语', '上班族法语', '碎片备考', '在职自学',
    '上班族', '每天一小时', '工作党', '通勤备考',
  ],
  tef_three_attempts_recovery: [
    '三战不过', '反复不过', '多次没过', 'TEF没过', 'TCF没过', '卡分复盘',
  ],
  tef_tcfca_refund: [
    'TCF Canada退费', '退费流程', '报名费退', '退款', '退费申请', '考试退费',
  ],
  tcf_writing_t1_template: [
    'Tâche 1', 'T1模板', '写作骨架', '11场景', 'T1句型', 'TCF写作T1',
  ],
  tcf_speaking_t2_lost: [
    'Tâche 2', 'T2', '丢失财物', '求助', 'T2应对', 'T2情境',
  ],
  tcf_speaking_t3_predict: [
    'Tâche 3', 'T3', 'T3真题', 'T3押题', 'T3高频', 'TCF口语T3',
  ],
  tcf_listening_trick: [
    'TCF听力', '听力蒙答案', 'TCF CA听力', '蒙题技巧', '听力应试', '听力技巧',
  ],
  tcf_reading_speed: [
    'TCF阅读', '阅读提速', '阅读定位', '高频答案', '阅读做不完', 'TCF CA阅读',
  ],
  tef_speaking_section_b: [
    'Section B', 'TEF口语Section', 'TEF口语B', '口语主题', 'TEF Canada口语',
  ],
  tef_writing_topic_60words: [
    '60字', 'TEF写作短题', '60字写作', 'TEF短题', '字数限制', '60字限制',
  ],
  tef_listening_difficult: [
    'TEF听力难题', '长对话', '细节题', '三类难题', 'NCLC8听力', 'TEF听力高分',
  ],
  tef_pain_listening_stuck: [
    '听力卡分', '听力CLB7', '听力反复卡', '听力口音', '听力复盘', '听力卡NCLC7',
  ],
  tef_pain_speaking_silent: [
    '口语冷场', '冷场', '救场', '卡壳', '陌生话题', '不冷场',
  ],
  tef_pain_writing_blank: [
    '写作脑子空', 'T1救急', '写作卡壳', '脑子一片空白', '写作开头卡', '考场卡壳',
  ],
  tef_pain_mock_vs_real: [
    '模考实考', '模考翻车', '实考差距', '模考低于实考', '模考复盘', '模考稳过实考翻车',
  ],
  tef_pain_time_fragmented: [
    '碎片时间', '工作带娃', '5分钟单元', '时间碎', '碎片化学习', '碎片法语',
  ],
  tef_concession_phrases: [
    '让步对比', 'TEF让步', 'TCF让步', '论证句型', 'TEF对比句', 'TCF因果句',
  ],
  tef_tense_choice: [
    'TEF时态', 'TCF时态', 'TEF写作时态', 'TCF写作时态', '法语时态陷阱', '时态选择规则',
  ],
  tef_quebec_expressions: [
    '魁北克', 'québécois', '魁北克法语', '魁北克口音', '本地表达', '魁北克发音',
  ],
  tef_register_switch: [
    'TEF口语正式', 'TCF口语非正式', '语言风格切换', '口语自然度', 'TEF语言风格', 'TCF口语风格',
  ],
  tef_linking_words: [
    'TEF连接词', 'TCF连接词', 'TEF逻辑词', '法语逻辑连接', '因果转折递进', 'TEF写作连接',
  ],
  tef_theme_immigration: [
    '移民主题', '移民论据', '移民词块', '移民词', 'TEF移民', 'TCF移民',
  ],
  tef_theme_education: [
    'TEF教育主题', 'TEF教育', 'TCF教育', '教育论据', '教育方向', 'TEF/TCF教育',
  ],
  tef_theme_work: [
    'TEF工作主题', 'TEF工作', 'TCF工作', '工作论据', '工作场景', 'TEF/TCF工作',
  ],
  tef_theme_tech: [
    'TEF科技主题', 'TEF科技', 'TCF科技', 'IA numérique', '科技论据', 'TEF/TCF科技',
  ],
  tef_selling_one_week_plan: [
    'TEF考前一周', 'TCF考前一周', '考前一周冲刺', 'TEF冲刺', 'TCF冲刺', '考前日程',
  ],
  tef_selling_t3_prediction: [
    'T3高概率', 'T3真题', '月度真题', '按月整理', '月度更新', '高概率真题',
    'T3高频', 'T3高频题', '口语T3', 'T3话题',
  ],
  tef_selling_listening_scenes: [
    '听力场景词', '场景词', '听力高频词', '场景词汇', 'TCF场景词', 'TEF场景词',
  ],
  tef_selling_writing_30: [
    '30句', '30个万能句', '写作万能句', '万能句型', '30必备句', 'TEF写作30句',
  ],
  tef_selling_b2_to_c1_set: [
    'B2到C1', 'B2 C1对比', '范文对比', '差距分析', '升C1', 'B2升C1',
  ],
  tef_showcase_master_map: [
    'TEF备考地图', 'TCF备考地图', '备考全局', '12份资料', '全局规划', 'TEF/TCF地图',
  ],
  tef_showcase_quick_check: [
    'TEF速查', 'TCF速查', '速查手册', '考前清单', '5分钟翻', 'TEF/TCF速查',
  ],
  tef_showcase_phrase_library: [
    'TEF表达库', 'TCF表达库', '功能分类', '表达调用', '法语表达库', 'TEF/TCF表达',
  ],
};

// 法语连接词等会被中英混合写进标题，命中时不区分大小写。
// 简单实现：用 lower-case 比对法语短语，中文短语直接 includes。
const unconfiguredWarnedSeeds = new Set<string>();
export function isTitleAnchoredToSeed(title: string, seedId: string): boolean {
  const keywords = SEED_TOPIC_KEYWORDS[seedId];
  if (!keywords) {
    if (!unconfiguredWarnedSeeds.has(seedId)) {
      unconfiguredWarnedSeeds.add(seedId);
      console.warn(
        `[seed-topic-anchor] seed "${seedId}" 未配置关键词，-8 错位惩罚失效。请在 SEED_TOPIC_KEYWORDS 里补齐。`
      );
    }
    return true; // 未配置的 seed 不拦（保留旧行为，仅打 warn）
  }
  const lower = title.toLowerCase();
  return keywords.some(kw => {
    // 含 ASCII 字母的关键词走小写比对（donc/mais/TEF）
    if (/^[a-z]+$/i.test(kw)) return lower.includes(kw.toLowerCase());
    if (title.includes(kw)) return true;
    // 纯中文关键词 ≥4 字时，标题含其前 2 字也算锚定：自然标题常用短形
    // （"性数一致"的短形是"性数"），只做全串匹配会误杀完全对题的标题
    // （实测 job_008 "性数错一个，B2写作整段白写" 被 off_topic 闸门打死）。
    if (/^[一-鿿]{4,}$/.test(kw)) return title.includes(kw.slice(0, 2));
    return false;
  });
}

export function getSeedTopicKeywords(seedId: string): string[] {
  return SEED_TOPIC_KEYWORDS[seedId] || [];
}

// 命中数（>1 表示锚定更稳，可作 score 加分项）
export function countSeedTopicHits(title: string, seedId: string): number {
  const keywords = SEED_TOPIC_KEYWORDS[seedId];
  if (!keywords) return 0;
  const lower = title.toLowerCase();
  return keywords.reduce((count, kw) => {
    const hit = /^[a-z]+$/i.test(kw) ? lower.includes(kw.toLowerCase()) : title.includes(kw);
    return hit ? count + 1 : count;
  }, 0);
}
