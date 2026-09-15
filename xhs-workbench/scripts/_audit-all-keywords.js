// 75 个未配置 seed 的关键词批量审计
// 两两重叠检查 + 独特性检查
// 输出按 5 个一组，方便逐组 review

const fs = require('fs');

// === 1. 解析现有 SEED_TOPIC_KEYWORDS ===
const anchorSrc = fs.readFileSync('src/lib/seed-topic-anchor.ts', 'utf8');
const existingKw = {};
const start = anchorSrc.indexOf('const SEED_TOPIC_KEYWORDS');
const end = anchorSrc.indexOf('};', start);
const block = anchorSrc.slice(start, end);
for (const m of block.matchAll(/^  ([a-z_]+):\s*\[([^\]]+)\]/gm)) {
  existingKw[m[1]] = m[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
}
console.log('已配置 seed 数:', Object.keys(existingKw).length);

// === 2. 75 个新提案 ===
const newProposals = {
  // ---------- DELF (37) ----------
  delf_showcase_master_map: ['备考地图', '全局地图', '阶段任务', '路线总览', '四周规划', '地图怎么用'],
  delf_showcase_quick_check: ['速查手册', '速查', '考前速查', '翻一遍', '速查维度', '手册怎么用'],
  delf_showcase_phrase_library: ['B2表达库', '场景分类表达', 'B2功能分类', 'B2表达调用', 'DELF表达库', 'B2调用顺序'],
  delf_time_allocation: ['时间分配', '时间表', '60分钟', '时间坑', '时间花错', '考场节奏'],
  delf_topic_analysis: ['读题', '跑题检查', '任务信号', '立场对象', '审题', '读题步骤'],
  delf_paragraph_structure: ['段落结构', '主题句', '论证链', '段落框架', '分段', '段间'],
  delf_self_evaluation: ['自评', '作文自评', '自查问题', '评分维度自查', '给自己打分', '作文复盘'],
  delf_topic_themes: ['常考主题', '主题论据', '论据库', '主题准备', '高频主题', 'B2写作主题'],
  delf_warmup_routine: ['热身', '考场热身', '5分钟热身', '10分钟热身', '进入状态', '破冰'],
  delf_agreement_pitfalls: ['性数一致', '阴阳性', '单复数', '形容词配合', '过去分词配合', '配合错误'],
  delf_tense_usage: ['B2写作时态', '时态选择', '复合过去时', '未完成过去时', '时态混用', '语式'],
  delf_register_switch: ['语体', '语体切换', '正式口语', 'on we 争论', '语体一致', '语气跳跃'],
  delf_letter_complaint: ['投诉信', 'lettre de réclamation', 'réclamation', '投诉结构', '投诉模板', '投诉信写法'],
  delf_letter_proposal: ['建议信', 'lettre de proposition', 'proposition', '建议结构', '可执行建议', '建议信写法'],
  delf_letter_application: ['申请信', 'lettre de motivation', '动机信', '经历匹配', '差异化', '动机信写法'],
  delf_forum_response: ['论坛投稿', 'forum', '论坛语气', '网友互动', '论坛回复', '半正式'],
  delf_subjunctive_scenes: ['虚拟式', 'subjonctif', '5个场景', '情绪怀疑', 'il faut que', '虚拟式场景'],
  delf_conditional_argument: ['条件式', 'conditionnel', '假设论证', 'hypothèse', 'si条件句', '条件式论证'],
  delf_emphasis_writing: ['强调结构', "c'est qui", "c'est que", "c'est à que", '强调句', '强调句型'],
  delf_inversion_register: ['倒装', 'inversion', '正式倒装', '提问倒装', '让步倒装', '倒装句'],
  delf_pronoun_condense: ['代词', 'COD', 'COI', 'en y', '双代词', '代词收紧'],
  delf_negation_variants: ['否定表达', 'ne plus', 'ne jamais', 'ne rien', 'ne personne', '否定多样化'],
  delf_theme_environment: ['环境主题', 'recyclage', 'pollution', 'éco-responsabilité', '新能源', '碳足迹'],
  delf_theme_education: ['B2教育主题', 'école', 'pédagogie', 'numérique à l\'école', 'devoirs', 'redoublement'],
  delf_theme_work: ['B2工作主题', 'télétravail', '35h', 'CDI', 'CDD', 'chômage'],
  delf_theme_tech: ['B2科技主题', 'IA', 'numérique', 'réseaux sociaux', 'RGPD', '算法'],
  delf_pain_opening_blank: ['第一句憋不出', '开头憋不出', '破题', '5种开头', '开头模板', '写不出第一句'],
  delf_pain_off_topic: ['写着跑题', '立场摇摆', '对象错位', '跑题修复', '写中跑题', '跑题自查'],
  delf_pain_examples_dry: ['例子干瘪', 'par exemple', '举不出例子', '抽象论证', '例子生成', '论证空泛'],
  delf_pain_score_stuck: ['分数卡住', '11分', '12分', '分数瓶颈', '提升路径', '卡在11分'],
  delf_pain_logic_jump: ['段落跳跃', '过渡句', '逻辑衔接', '段间过渡', 'connecteur', '逻辑断裂'],
  delf_selling_one_week_plan: ['一周冲刺', '考前一周', '7天冲刺', '冲刺方案', '考前日程', '一周方案'],
  delf_selling_theme_prediction: ['主题预测', '高频主题', '必考主题', '预测主题', 'B2写作预测', '主题押题'],
  delf_selling_high_freq_phrases: ['高频表达', '万能句', 'B2句型', '反复出现', '高频句', 'B2万能句'],
  delf_selling_mistake_collection: ['错题集', '错句改法', '典型错误', '错例', '改错练习', '错误对照'],
  delf_showcase_topic_prediction: ['预测手册', '主题手册', '手册怎么用', '预测调用', '手册结构', '主题预测手册'],
  delf_showcase_correction_set: ['批改案例', '案例集', '批改集', '自学顺序', '错误类型', '批改流程'],

  // ---------- TEF/TCF (38) ----------
  tef_ee_french_stream_intro: ['EE法语通道', '加拿大EE', 'EE通道', '入池门槛', '捞人分数线', '法语移民'],
  tef_ee_score_bonus: ['EE法语加分', 'CRS加分', '法语加分', '法语单抽', 'CLB7加分', '加分算分'],
  tef_ee_diy_timeline: ['EE DIY', 'DIY时间线', '学历认证', '入池捞人', 'PR流程', '法语通道DIY'],
  tef_ee_policy_change: ['EE大改', 'EE改革', 'IRCC', '法语通道政策', '政策变化', 'EE政策'],
  tef_zero_to_clb7_timeline: ['零基础到CLB7', '零基础法语', '零基础自学', '自学时间线', '在职零基础', '多久到CLB7'],
  tef_working_adult_strategy: ['在职备考', '每天1小时', '在职法语', '上班族法语', '碎片备考', '在职自学'],
  tef_three_attempts_recovery: ['三战不过', '反复不过', '多次没过', 'TEF没过', 'TCF没过', '卡分复盘'],
  tef_tcfca_refund: ['TCF Canada退费', '退费流程', '报名费退', '退款', '退费申请', '考试退费'],
  tcf_writing_t1_template: ['Tâche 1', 'T1模板', '写作骨架', '11场景', 'T1句型', 'TCF写作T1'],
  tcf_speaking_t2_lost: ['Tâche 2', 'T2', '丢失财物', '求助', 'T2应对', 'T2情境'],
  tcf_speaking_t3_predict: ['Tâche 3', 'T3', 'T3真题', 'T3押题', 'T3高频', 'TCF口语T3'],
  tcf_listening_trick: ['TCF听力', '听力蒙答案', 'TCF CA听力', '蒙题技巧', '听力应试', '听力技巧'],
  tcf_reading_speed: ['TCF阅读', '阅读提速', '阅读定位', '高频答案', '阅读做不完', 'TCF CA阅读'],
  tef_speaking_section_b: ['Section B', 'TEF口语Section', 'TEF口语B', '口语主题', 'TEF Canada口语'],
  tef_writing_topic_60words: ['60字', 'TEF写作短题', '60字写作', 'TEF短题', '字数限制', '60字限制'],
  tef_listening_difficult: ['TEF听力难题', '长对话', '细节题', '三类难题', 'NCLC8听力', 'TEF听力高分'],
  tef_pain_listening_stuck: ['听力卡分', '听力CLB7', '听力反复卡', '听力口音', '听力复盘', '听力卡NCLC7'],
  tef_pain_speaking_silent: ['口语冷场', '冷场', '救场', '卡壳', '陌生话题', '不冷场'],
  tef_pain_writing_blank: ['写作脑子空', 'T1救急', '写作卡壳', '脑子一片空白', '写作开头卡', '考场卡壳'],
  tef_pain_mock_vs_real: ['模考实考', '模考翻车', '实考差距', '模考低于实考', '模考复盘', '模考稳过实考翻车'],
  tef_pain_time_fragmented: ['碎片时间', '工作带娃', '5分钟单元', '时间碎', '碎片化学习', '碎片法语'],
  tef_concession_phrases: ['让步对比', 'TEF让步', 'TCF让步', '论证句型', 'TEF对比句', 'TCF因果句'],
  tef_tense_choice: ['TEF时态', 'TCF时态', 'TEF写作时态', 'TCF写作时态', '法语时态陷阱', '时态选择规则'],
  tef_quebec_expressions: ['魁北克', 'québécois', '魁北克法语', '魁北克口音', '本地表达', '魁北克发音'],
  tef_register_switch: ['TEF口语正式', 'TCF口语非正式', '语言风格切换', '口语自然度', 'TEF语言风格', 'TCF口语风格'],
  tef_linking_words: ['TEF连接词', 'TCF连接词', 'TEF逻辑词', '法语逻辑连接', '因果转折递进', 'TEF写作连接'],
  tef_theme_immigration: ['移民主题', '移民论据', '移民词块', '移民词', 'TEF移民', 'TCF移民'],
  tef_theme_education: ['TEF教育主题', 'TEF教育', 'TCF教育', '教育论据', '教育方向', 'TEF/TCF教育'],
  tef_theme_work: ['TEF工作主题', 'TEF工作', 'TCF工作', '工作论据', '工作场景', 'TEF/TCF工作'],
  tef_theme_tech: ['TEF科技主题', 'TEF科技', 'TCF科技', 'IA numérique', '科技论据', 'TEF/TCF科技'],
  tef_selling_one_week_plan: ['TEF考前一周', 'TCF考前一周', '考前一周冲刺', 'TEF冲刺', 'TCF冲刺', '考前日程'],
  tef_selling_t3_prediction: ['T3高概率', 'T3真题', '月度真题', '按月整理', '月度更新', '高概率真题'],
  tef_selling_listening_scenes: ['听力场景词', '场景词', '听力高频词', '场景词汇', 'TCF场景词', 'TEF场景词'],
  tef_selling_writing_30: ['30句', '30个万能句', '写作万能句', '万能句型', '30必备句', 'TEF写作30句'],
  tef_selling_b2_to_c1_set: ['B2到C1', 'B2 C1对比', '范文对比', '差距分析', '升C1', 'B2升C1'],
  tef_showcase_master_map: ['TEF备考地图', 'TCF备考地图', '备考全局', '12份资料', '全局规划', 'TEF/TCF地图'],
  tef_showcase_quick_check: ['TEF速查', 'TCF速查', '速查手册', '考前清单', '5分钟翻', 'TEF/TCF速查'],
  tef_showcase_phrase_library: ['TEF表达库', 'TCF表达库', '功能分类', '表达调用', '法语表达库', 'TEF/TCF表达'],
};

console.log('新提案 seed 数:', Object.keys(newProposals).length);

// === 3. 两两重叠检查 ===
const allKw = { ...existingKw, ...newProposals };
const collisions = [];
let totalChecked = 0;

for (const newSeed of Object.keys(newProposals)) {
  for (const otherSeed of Object.keys(allKw)) {
    if (otherSeed === newSeed) continue;
    totalChecked++;
    const overlap = newProposals[newSeed].filter(kw => allKw[otherSeed].includes(kw));
    if (overlap.length === 0) continue;
    const pct = Math.round(overlap.length / newProposals[newSeed].length * 100);
    if (pct >= 30) {
      collisions.push({ newSeed, otherSeed, overlap, pct });
    }
  }
}

console.log('\n========== 两两重叠 ≥30% 报告 ==========\n');
if (collisions.length === 0) {
  console.log('✓ 0 个严重重叠\n');
} else {
  for (const c of collisions) {
    console.log(`⚠ ${c.newSeed} ↔ ${c.otherSeed}: ${c.pct}% 重叠 (${c.overlap.length}/${newProposals[c.newSeed].length})`);
    console.log(`  重叠词: ${c.overlap.join(', ')}\n`);
  }
}

// === 4. 跨商品概念冲突特殊检查 ===
// 这些概念在 DELF 和 TEF 都有，需要差异化标记
console.log('========== 跨商品概念冲突检查 ==========\n');
const conceptPairs = [
  ['delf_tense_usage', 'tef_tense_choice', '时态'],
  ['delf_register_switch', 'tef_register_switch', '语体'],
  ['delf_connectors', 'tef_linking_words', '连接词'],
  ['delf_theme_education', 'tef_theme_education', '教育主题'],
  ['delf_theme_work', 'tef_theme_work', '工作主题'],
  ['delf_theme_tech', 'tef_theme_tech', '科技主题'],
  ['delf_pain_opening_blank', 'tef_pain_writing_blank', '开头卡'],
];
for (const [a, b, label] of conceptPairs) {
  const kwA = allKw[a] || [];
  const kwB = allKw[b] || [];
  const overlap = kwA.filter(kw => kwB.includes(kw));
  console.log(`[${label}] ${a} vs ${b}`);
  console.log(`  A: ${kwA.join(', ')}`);
  console.log(`  B: ${kwB.join(', ')}`);
  if (overlap.length > 0) {
    console.log(`  ⚠ 直接重叠: ${overlap.join(', ')}`);
  } else {
    console.log(`  ✓ 无直接重叠`);
  }
  console.log('');
}

// === 5. 按 5 个一组输出摘要 ===
console.log('========== 按组摘要（5 个/组） ==========\n');
const newSeeds = Object.keys(newProposals);
for (let i = 0; i < newSeeds.length; i += 5) {
  const group = newSeeds.slice(i, i + 5);
  const groupNum = Math.floor(i / 5) + 1;
  console.log(`--- 第 ${groupNum} 组 ---`);
  for (const seed of group) {
    const seedCollisions = collisions.filter(c => c.newSeed === seed);
    const status = seedCollisions.length === 0 ? '✓' : '⚠';
    console.log(`${status} ${seed}: [${newProposals[seed].join(', ')}]`);
    if (seedCollisions.length > 0) {
      for (const c of seedCollisions) {
        console.log(`   ↳ 与 ${c.otherSeed} ${c.pct}% 重叠: ${c.overlap.join(', ')}`);
      }
    }
  }
  console.log('');
}

console.log(`\n========== 总结 ==========`);
console.log(`总提案: ${newSeeds.length}`);
console.log(`严重重叠 seed 数: ${new Set(collisions.map(c => c.newSeed)).size}`);
console.log(`需要修复: ${new Set(collisions.map(c => c.newSeed)).size} 个`);
