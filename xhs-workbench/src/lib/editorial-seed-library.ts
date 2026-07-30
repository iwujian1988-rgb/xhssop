import type { ContentShape, EditorialSeed, MigratedTopic } from '@/types/reference-workflow';
import type { ProductId } from '@/types/data';
import type { ProductFacts } from '@/types/content-planning';
import type { ProductCard } from '@/lib/reference-compose';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';

const delfSeeds: EditorialSeed[] = [
  {
    seed_id: 'delf_formal_opening_closing', product_id: 'delf_b2_writing',
    topic: 'DELF B2正式信开头和结尾怎么写', keyword_candidates: ['模板', '格式', '开头', '结尾'],
    audience: '距离DELF B2考试1个月以内、正式信开头和结尾经常卡住的考生',
    user_pain: '读懂题目却迟迟写不出第一句，结尾又只会用Cordialement',
    user_need: '按写信目的选择合适的开头和结尾，并知道各自适用场景',
    pay_trigger: '临近考试，模考时发现正式信开头和收尾耗时太久',
    use_scenario: '考前集中整理正式信表达，以及考场草稿阶段快速调用',
    content_shapes: ['directory', 'phrase', 'offer', 'flashcard', 'pain', 'document'],
    anchor_fact_ids: ['PP-007', 'KA-008', 'KA-009', 'KA-020'],
    dynamic_fact_terms: ['正式信', '开头', '结尾', '礼貌', '写信目的'],
    ai_original_scope: '可以补充新的正确例句和选用场景，但不得伪造商品条目、官方模板或固定得分规则',
    title_trigger_types: ['好奇缺口', '恐惧损失', '数字锚定', '场景条件'],
    page_plan: ['先判断写信目的', '按场景选择开头', '按语气选择结尾', '展示完整套用示例', '给出考场调用方法'],
  },
  {
    seed_id: 'delf_final_check', product_id: 'delf_b2_writing',
    topic: 'DELF B2作文交卷前怎么检查', keyword_candidates: ['评分标准', '技巧', '格式'],
    audience: '能写完DELF B2作文，但写完后不知道从哪里检查的考生',
    user_pain: '检查时只会重读全文，重复出现的结构、语体和语法问题仍然漏掉',
    user_need: '有顺序地检查任务完成、结构、词汇句法、语体和拼写',
    pay_trigger: '模考作文总有低级错误，却找不到稳定的自查方法',
    use_scenario: '每次练习写完后的复盘，以及交卷前最后检查',
    content_shapes: ['directory', 'offer', 'pain', 'document', 'table'],
    anchor_fact_ids: ['UC-010', 'SP-009', 'DA-009', 'KA-025'],
    dynamic_fact_terms: ['检查清单', '评分维度', '结构', '语体', '拼写', '自查'],
    ai_original_scope: '可以补充非官方的检查顺序和示例，但不得把学习建议写成DELF官方硬性评分规则',
    title_trigger_types: ['互动测试', '恐惧损失', '数字锚定', '行动号召'],
    page_plan: ['先给检查顺序', '拆解高频检查项', '展示容易漏掉的例子', '给一轮快速自测', '说明如何复盘'],
  },
  {
    seed_id: 'delf_wrong_right', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作常见错误怎么改', keyword_candidates: ['技巧', '句型', '表达'],
    audience: '作文能表达基本意思，但语法和语体错误反复出现的B1-B2考生',
    user_pain: '知道句子不够好，却说不清具体错在哪里，也不知道如何改',
    user_need: '通过错误句、正确句和解释建立可复用的纠错方法',
    pay_trigger: '同类错误在多篇作文里重复出现，靠重写仍然没有改善',
    use_scenario: '日常批改复盘、错题整理和下一篇作文前快速回看',
    content_shapes: ['pain', 'experience', 'document'],
    anchor_fact_ids: ['SP-010', 'KA-025', 'KA-026', 'DA-010'],
    dynamic_fact_terms: ['错题', '错误句', '正确句', '性数一致', '直译', '语体', '时态'],
    ai_original_scope: '可以依据明确语法规则原创错误对照例句，但必须经过法语审校，不得冒充用户真实作文或商品原句',
    title_trigger_types: ['恐惧损失', '认知冲突', '互动测试', '数字锚定'],
    page_plan: ['展示典型错误', '解释错误原因', '给出正确改法', '总结迁移规则', '安排自查练习'],
  },
  {
    seed_id: 'delf_sentence_upgrade', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作句式怎么升级', keyword_candidates: ['句型', '表达', '技巧'],
    audience: '作文大多由简单句组成、希望表达更有层次的B1-B2考生',
    user_pain: '观点能写出来，但句式重复，复杂结构用得生硬或用错',
    user_need: '按语义选择让步、条件、因果、对比和强调结构',
    pay_trigger: '模考作文内容完整，但语言表现一直停留在简单句',
    use_scenario: '专项句式训练，以及改写旧作文时逐句升级',
    content_shapes: ['directory', 'phrase', 'flashcard', 'book', 'document', 'table'],
    anchor_fact_ids: ['PP-010', 'SP-007', 'KA-013', 'KA-014', 'KA-015', 'KA-016', 'KA-017', 'KA-018'],
    dynamic_fact_terms: ['句法', '虚拟式', '条件式', '让步', '因果', '对比', '强调'],
    ai_original_scope: '可以按知识库结构原创正确例句，不得规定每篇必须使用几次虚拟式或复杂句',
    title_trigger_types: ['认知冲突', '好奇缺口', '数字锚定', '行动号召'],
    page_plan: ['先按表达目的分类', '说明结构适用条件', '给出短句模板', '展示完整例句', '安排改写练习'],
  },
  {
    seed_id: 'delf_connectors', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作连接词怎么选', keyword_candidates: ['连接词', '表达', '句型'],
    audience: '作文里反复使用donc、mais、parce que的B1-B2考生',
    user_pain: '连接词记了不少，但写作时仍然重复，甚至逻辑关系用反',
    user_need: '根据原因、结果、让步、对比和总结选择衔接表达',
    pay_trigger: '作文段落之间跳跃，读起来像句子堆叠',
    use_scenario: '写作前搭结构、写作中衔接段落、写完后检查重复',
    content_shapes: ['directory', 'phrase', 'flashcard', 'book', 'document', 'table'],
    anchor_fact_ids: ['PP-011', 'KA-002', 'KA-003', 'KA-004', 'KA-005', 'KA-007'],
    dynamic_fact_terms: ['连接词', '原因', '结果', '让步', '对比', '总结'],
    ai_original_scope: '可以原创上下文例句展示逻辑差异，但不得把可替换表达说成任何语境都能互换',
    title_trigger_types: ['认知冲突', '恐惧损失', '数字锚定', '互动测试'],
    page_plan: ['按逻辑关系分组', '解释容易混淆的差异', '给出短表达', '放入完整段落示例', '提供重复检查法'],
  },
  {
    seed_id: 'delf_topic_vocabulary', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作主题词汇怎么积累', keyword_candidates: ['主题', '表达', '词汇'],
    audience: '遇到教育、环境、科技等题目时缺少具体词汇的B1-B2考生',
    user_pain: '背了零散单词，换到具体作文主题仍然想不到能用的表达',
    user_need: '围绕一个主题积累可放进观点句和例句的词汇搭配',
    pay_trigger: '练真题时发现同一批普通词在不同主题里反复使用',
    use_scenario: '按主题准备词汇、观点和例子，并在写作前快速激活',
    content_shapes: ['directory', 'flashcard', 'book', 'document', 'table'],
    anchor_fact_ids: ['SP-006', 'KA-010', 'KA-011', 'DA-013'],
    dynamic_fact_terms: ['教育', '环境', '科技', '工作', '健康', '社交媒体', '主题词'],
    ai_original_scope: '可以围绕选定主题补充常见正确搭配和例句，不得虚构词频、等级或真题出现次数',
    title_trigger_types: ['数字锚定', '好奇缺口', '场景条件', '行动号召'],
    page_plan: ['锁定一个主题', '按子话题分词汇', '补充常用搭配', '写进观点句', '安排主题复习'],
  },
  {
    seed_id: 'delf_argument_bank', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作观点和例子怎么展开', keyword_candidates: ['主题', '范文', '技巧'],
    audience: '看得懂题目但想不出论点和具体例子的B1-B2考生',
    user_pain: '作文只有态度，没有原因、例子和让步，段落很快写完',
    user_need: '围绕常见主题建立观点、理由、例子和让步的展开链',
    pay_trigger: '计时写作时花大量时间想内容，最后只能重复题目',
    use_scenario: '平时建立主题论据库，以及考场草稿阶段快速列提纲',
    content_shapes: ['directory', 'book', 'pain', 'experience', 'document', 'table'],
    anchor_fact_ids: ['PP-008', 'SP-008', 'KA-023', 'KA-024', 'DA-014'],
    dynamic_fact_terms: ['观点', '论据', '例子', '让步', '教育', '环境', '科技'],
    ai_original_scope: '可以补充常识性观点和虚构但合理的教学例子，不得伪造统计数据、研究结论或真实个人经历',
    title_trigger_types: ['好奇缺口', '恐惧损失', '认知冲突', '数字锚定'],
    page_plan: ['拆解题目立场', '给出观点展开框架', '展示主题论据', '补充让步角度', '完成一段示范'],
  },
  {
    seed_id: 'delf_sample_transfer', product_id: 'delf_b2_writing',
    topic: 'DELF B2范文怎么拆成自己的表达', keyword_candidates: ['范文', '表达', '句型'],
    audience: '收藏和背过范文，但换题后仍然不会写的B1-B2考生',
    user_pain: '记住了整篇范文的内容，却没有提取能迁移到新题目的表达和结构',
    user_need: '从范文中拆出功能表达、句法结构、论证方法和可替换位置',
    pay_trigger: '花了很多时间背范文，模考换题后依旧从头现编',
    use_scenario: '精读范文、仿写段落和整理个人表达库',
    content_shapes: ['directory', 'book', 'pain', 'experience', 'document'],
    anchor_fact_ids: ['SP-004', 'SP-005', 'CM-001', 'DA-011', 'KA-027', 'KA-028'],
    dynamic_fact_terms: ['范文', '可替换表达', '仿写', '组合示例', '迁移'],
    ai_original_scope: '可以基于知识点生成新的仿写示例，但不得冒充商品范文原文、真题原文或用户亲身经历',
    title_trigger_types: ['认知冲突', '恐惧损失', '好奇缺口', '行动号召'],
    page_plan: ['展示一段材料', '标出可迁移结构', '替换主题词', '完成新题仿写', '总结拆范文方法'],
  },
  {
    seed_id: 'delf_task_formats', product_id: 'delf_b2_writing',
    topic: 'DELF B2三种写作任务怎么区分', keyword_candidates: ['写作任务', '格式', '范文'],
    audience: '对正式信、论坛投稿和议论文边界不清楚的备考者',
    user_pain: '知道要表达观点，却经常用错称呼、结构和语体',
    user_need: '看懂三类任务的读题信号、结构、语体和常见误区',
    pay_trigger: '练习时发现同一套开头结尾被套到所有任务里',
    use_scenario: '开始系统备考时建立任务地图，以及每次写作前确认格式',
    content_shapes: ['directory', 'offer', 'book', 'pain', 'document', 'table', 'roadmap'],
    anchor_fact_ids: ['UC-003', 'UC-004', 'UC-005', 'CM-001', 'DA-003', 'DA-004', 'DA-005'],
    dynamic_fact_terms: ['正式信', '论坛投稿', '议论文', '任务形式', '语体', '格式'],
    ai_original_scope: '可以补充任务识别示例和对比题干，不得伪造官方真题、评分要求或唯一固定结构',
    title_trigger_types: ['认知冲突', '互动测试', '恐惧损失', '数字锚定'],
    page_plan: ['先识别任务信号', '对比三类结构', '说明语体差异', '展示常见错配', '给出写前检查'],
  },
  {
    seed_id: 'delf_learning_route', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作复习顺序怎么安排', keyword_candidates: ['技巧', '主题', '范文'],
    audience: '资料很多但不知道先练什么、如何安排写作复习的考生',
    user_pain: '今天背词明天看范文，练习之间没有前后关系，也看不出进步',
    user_need: '根据当前水平和距考时间安排诊断、专项训练、完整写作和复盘',
    pay_trigger: '临近考试仍然在随机翻资料，缺少可执行的下一步',
    use_scenario: '开始备考时制定路径，以及每周复盘后调整下一阶段',
    content_shapes: ['offer', 'pain', 'experience', 'roadmap'],
    anchor_fact_ids: ['AU-001', 'AU-002', 'AU-003', 'SP-002', 'SP-003', 'DA-001', 'DA-002'],
    dynamic_fact_terms: ['诊断', '学习路径', '4周', '8周', '冲刺', '复盘'],
    ai_original_scope: '可以给通用练习顺序和时间分配建议，但不得承诺固定周期提分或把建议写成唯一正确路径',
    title_trigger_types: ['场景条件', '身份代入', '结果承诺', '数字锚定'],
    page_plan: ['先判断当前阶段', '选择训练重点', '安排每周产出', '设置复盘节点', '说明如何调整路径'],
  },
  {
    seed_id: 'delf_scoring_dimensions', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作评分维度怎么看', keyword_candidates: ['评分标准', '技巧', '结构'],
    audience: '写完作文只凭感觉判断好坏、不了解评价维度的考生',
    user_pain: '修改作文时只盯语法，任务完成、连贯和语体问题没有被发现',
    user_need: '从任务完成、结构连贯、词汇句法、语体等维度理解改进方向',
    pay_trigger: '作文改了很多遍，却不知道修改是否真正对应评价目标',
    use_scenario: '初次了解考试、作文自评和阶段性复盘',
    content_shapes: ['directory', 'offer', 'document', 'table', 'roadmap'],
    anchor_fact_ids: ['UC-006', 'DA-007', 'SP-009', 'CM-005'],
    dynamic_fact_terms: ['评分维度', '任务完成', '连贯', '词汇', '句法', '语体'],
    ai_original_scope: '可以把维度解释成易懂的检查问题，但不得虚构分值、官方措辞或机械数量门槛',
    title_trigger_types: ['互动测试', '好奇缺口', '恐惧损失', '认知冲突'],
    page_plan: ['解释评价维度', '把维度改写成问题', '展示修改前后', '给出自评顺序', '连接到日常训练'],
  },
  {
    seed_id: 'delf_combination_examples', product_id: 'delf_b2_writing',
    topic: 'DELF B2词汇句型和观点怎么组合', keyword_candidates: ['表达', '句型', '范文'],
    audience: '分别背过词汇、句型和观点，但写作时不会把它们组合起来的考生',
    user_pain: '知识点单独看都懂，真正写段落时仍然只能用最熟悉的简单表达',
    user_need: '看到词汇、句法和观点如何组合成完整句，并能替换成自己的主题',
    pay_trigger: '积累了很多笔记，却很少真正写进完整作文',
    use_scenario: '专项仿写、旧句改写和主题迁移练习',
    content_shapes: ['directory', 'phrase', 'book', 'document', 'table'],
    anchor_fact_ids: ['SP-011', 'KA-027', 'KA-028', 'DA-012'],
    dynamic_fact_terms: ['组合示例', '完整法语句', '仿写变体', '词汇', '句法', '观点'],
    ai_original_scope: '可以使用同一组合逻辑原创新的法语句和仿写变体，不得把AI示例描述为商品原句或真题',
    title_trigger_types: ['认知冲突', '好奇缺口', '数字锚定', '行动号召'],
    page_plan: ['拆开一个完整句', '标出词汇句法观点', '替换主题元素', '完成新的组合句', '安排仿写检查'],
  },
  {
    seed_id: 'delf_product_showcase', product_id: 'delf_b2_writing',
    topic: 'DELF B2写作资料库怎么用', keyword_candidates: ['备考资料', '备考攻略', '模板', '范文'],
    audience: '准备系统备考DELF B2写作、收藏了很多资料但不知道如何使用的考生',
    user_pain: '模板、范文、词汇和检查清单分散在不同地方，每次练作文都要重新翻找',
    user_need: '知道这套资料库按什么逻辑组织，以及不同阶段应该先打开哪一类内容',
    pay_trigger: '备考资料很多但没有路径，想减少整理成本，直接进入写作练习和复盘',
    use_scenario: '刚开始准备DELF B2写作、考前整理资料、或写完作文后需要按模块复盘',
    content_shapes: ['directory', 'offer', 'book', 'pain', 'experience', 'document', 'table', 'roadmap'],
    anchor_fact_ids: ['AU-001', 'AU-002', 'AU-003', 'SP-002', 'SP-003', 'UC-006', 'UC-010', 'CM-001'],
    dynamic_fact_terms: ['使用说明', '学习路径', '范文库', '评分对照', '检查清单', '词汇库', '句法库', '错题对照'],
    ai_original_scope: '可以解释资料库适合的使用顺序和备考场景，但不得虚构服务、陪学、批改、官方承诺或提分时长',
    title_trigger_types: ['好奇缺口', '恐惧损失', '身份代入', '行动号召'],
    page_plan: ['先说明适合谁', '展示资料库分层', '按备考阶段给使用顺序', '举例一次写作复盘怎么用', '自然承接购买理由'],
  },
];

const tefTcfSeeds: EditorialSeed[] = [
  {
    seed_id: 'tef_exam_choice',
    product_id: 'tef_tcf_canada',
    topic: 'TEF还是TCF，加拿大法语考试先别选错',
    keyword_candidates: ['TEF还是TCF', 'TEF Canada', 'TCF Canada', '加拿大法语考试'],
    audience: '准备靠法语成绩服务加拿大移民规划，但还没确定考 TEF 还是 TCF 的人',
    user_pain: '一开始考试选错，后面题型、资料、报名节奏都容易跟着乱',
    user_need: '先用对照表判断自己更适合哪一种考试，再进入具体备考',
    pay_trigger: '已经准备开始买资料或报考，却还没把 TEF/TCF 的区别想清楚',
    use_scenario: '备考前第一步，先做选考决策，再决定资料和训练路径',
    content_shapes: ['directory', 'table', 'offer', 'document', 'roadmap', 'pain'],
    anchor_fact_ids: ['TS-002', 'TD-002', 'TU-001', 'TP-001', 'TK-001'],
    dynamic_fact_terms: ['TEF', 'TCF', 'CLB', 'NCLC', '选考', '报名', '题型'],
    ai_original_scope: '可以补充通用选考判断维度，但不得编造官方政策、移民分数或保证某个考试更容易拿分',
    title_trigger_types: ['fear_loss', 'cognitive_conflict', 'curiosity_gap', 'scenario'],
    page_plan: ['先说为什么不能盲选', '用表格拆 TEF/TCF 差异', '给出适合人群判断', '列出下一步备考动作', '自然承接资料包里的选考模块'],
  },
  {
    seed_id: 'tef_clb7_self_test',
    product_id: 'tef_tcf_canada',
    topic: '想冲CLB7，先测你到底卡在哪一科',
    keyword_candidates: ['CLB7', '法语B2备考', '加拿大法语', '自测'],
    audience: '目标 CLB7/NCLC7，但不知道四科差距的人',
    user_pain: '只知道想要 CLB7，却不知道听说读写哪一科最该先补',
    user_need: '用自测题把目标拆成四科差距，再确定训练顺序',
    pay_trigger: '备考一段时间后仍然不知道自己该主攻哪一科',
    use_scenario: '开始备考或复盘阶段，先做一次差距定位',
    content_shapes: ['directory', 'table', 'offer', 'roadmap', 'pain', 'document', 'flashcard'],
    anchor_fact_ids: ['TS-003', 'TD-003', 'TU-002', 'TP-002', 'TK-002'],
    dynamic_fact_terms: ['CLB7', 'NCLC7', '自测', '四科', '听力', '口语', '写作'],
    ai_original_scope: '可以生成非官方的学习诊断问题，但不得承诺自测结果等同官方分数',
    title_trigger_types: ['interaction_test', 'fear_loss', 'curiosity_gap', 'number_anchor'],
    page_plan: ['先让用户确认目标', '给出3-6个自测问题', '把问题映射到四科差距', '给下一步训练建议', '承接资料里的CLB7自测表'],
  },
  {
    seed_id: 'tef_30_day_plan',
    product_id: 'tef_tcf_canada',
    topic: '每天只有2小时，TEF/TCF备考别平均用力',
    keyword_candidates: ['法语B2备考', 'TEF备考', 'TCF备考', '30天备考'],
    audience: '每天只有1-2小时备考、需要可执行安排的人',
    user_pain: '资料很多但每天不知道练什么，最后变成随机刷题',
    user_need: '把30天拆成输入、输出、复盘和模拟任务',
    pay_trigger: '想开始系统备考，但缺少每天打开就能照做的计划',
    use_scenario: '制定30天备考节奏，尤其适合时间碎片化的人',
    content_shapes: ['roadmap', 'offer', 'directory', 'pain', 'experience', 'table'],
    anchor_fact_ids: ['TS-007', 'TD-007', 'TU-003', 'TP-003', 'TK-006'],
    dynamic_fact_terms: ['30天', '每天2小时', '计划', '听力', '写作', '口语', '复盘'],
    ai_original_scope: '可以生成通用30天任务拆分，但不得承诺30天必过、必达CLB7或保证提分',
    title_trigger_types: ['scenario', 'result_promise', 'fear_loss', 'number_anchor'],
    page_plan: ['先说时间限制', '拆出每天任务结构', '给一周样例', '说明怎么复盘调整', '承接完整30天计划'],
  },
  {
    seed_id: 'tef_writing_patterns',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF写作别硬背模板，先会用这几类句型',
    keyword_candidates: ['写作句型', '法语写作模板', 'TEF写作', 'TCF写作'],
    audience: '写作能写出来但句子简单、论证不稳的人',
    user_pain: '背了模板但换题不会用，写出来还是像简单句堆叠',
    user_need: '按功能掌握引入、让步、对比、因果和总结句型',
    pay_trigger: '写作想提分，但不知道该背哪些真正能迁移的表达',
    use_scenario: '写作专项训练和考前句型速查',
    content_shapes: ['phrase', 'directory', 'flashcard', 'document', 'table', 'book'],
    anchor_fact_ids: ['TS-004', 'TD-004', 'TU-004', 'TP-004', 'TK-003'],
    dynamic_fact_terms: ['写作句型', '让步', '对比', '因果', '总结', '模板'],
    ai_original_scope: '可以生成准确的法语例句和中文释义，但法语例句必须经过校验，不得乱造不自然表达',
    title_trigger_types: ['cognitive_conflict', 'curiosity_gap', 'fear_loss', 'number_anchor'],
    page_plan: ['先反对硬背模板', '按功能列短句型', '给中文使用场景', '给法语例句', '引导去资料里的50句型'],
  },
  {
    seed_id: 'tef_topic_vocab',
    product_id: 'tef_tcf_canada',
    topic: '法语B2背词总用不上，先按主题整理',
    keyword_candidates: ['法语B2备考', '主题词汇', '法语词汇', 'TEF词汇'],
    audience: '单词背了不少，但写作口语调不出来的人',
    user_pain: '词汇零散，到了移民、教育、工作、科技这类主题就不会说',
    user_need: '按主题积累能直接放进写作和口语的词汇搭配',
    pay_trigger: '背词花了时间，但输出时仍然缺词缺表达',
    use_scenario: '写作和口语主题准备阶段',
    content_shapes: ['directory', 'table', 'flashcard', 'book', 'document', 'phrase'],
    anchor_fact_ids: ['TS-005', 'TD-005', 'TU-005', 'TP-005', 'TK-004'],
    dynamic_fact_terms: ['600词', '主题词', '移民', '教育', '工作', '科技', '口语'],
    ai_original_scope: '可以补充常见主题词和搭配，但不得声称所有词都来自商品原文；法语释义必须准确',
    title_trigger_types: ['cognitive_conflict', 'fear_loss', 'number_anchor', 'action_call'],
    page_plan: ['先说零散背词的问题', '展示主题分组', '每组给可输出词块', '给一句使用示范', '承接12大类600词'],
  },
  {
    seed_id: 'tef_true_topics',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF写作练什么，先抓高频主题',
    keyword_candidates: ['写作主题', '真题主题', 'TEF写作', 'TCF写作'],
    audience: '看到题目才开始想观点和例子的人',
    user_pain: '高频主题没准备，考场时间被浪费在想内容上',
    user_need: '提前准备主题词、观点和例子，形成可迁移素材',
    pay_trigger: '开始刷写作题后发现自己不是不会法语，而是没素材',
    use_scenario: '写作主题库搭建和考前素材复盘',
    content_shapes: ['directory', 'document', 'table', 'book', 'pain', 'phrase'],
    anchor_fact_ids: ['TS-006', 'TD-006', 'TU-006', 'TP-006', 'TK-005'],
    dynamic_fact_terms: ['真题主题', '写作主题', '观点', '例子', '素材'],
    ai_original_scope: '可以生成通用主题观点和例子，但不得冒充官方真题原文或给出未经证实的押题承诺',
    title_trigger_types: ['fear_loss', 'curiosity_gap', 'number_anchor', 'scenario'],
    page_plan: ['先说为什么不能只练范文', '列主题分类', '给主题下的观点方向', '示范如何展开一段', '承接高频主题资料'],
  },
  {
    seed_id: 'tef_listening_method',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF听力别临时猛刷，先把训练顺序弄对',
    keyword_candidates: ['TEF听力', 'TCF听力', '法语听力', '听力怎么练'],
    audience: '听力长期提不上去，越临近考试越慌的人',
    user_pain: '刷了题但听不懂的地方还是听不懂，复盘也没有方法',
    user_need: '建立听力训练顺序：输入、精听、复听和错因复盘',
    pay_trigger: '听力卡住后，想找一套能坚持的训练方法',
    use_scenario: '听力专项训练和每周复盘',
    content_shapes: ['pain', 'experience', 'offer', 'roadmap', 'document'],
    anchor_fact_ids: ['TS-008', 'TD-008', 'TU-007', 'TP-007', 'TK-007'],
    dynamic_fact_terms: ['听力', '精听', '复听', '语速', '口音', '错因'],
    ai_original_scope: '可以补充通用听力训练步骤，但不得承诺短期快速突破或保证考试分数',
    title_trigger_types: ['cognitive_conflict', 'fear_loss', 'scenario', 'action_call'],
    page_plan: ['先指出猛刷题的问题', '拆听力卡点', '给训练步骤', '给一轮复盘模板', '承接听力资料'],
  },
  {
    seed_id: 'tef_speaking_strategy',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF口语卡住，不一定是词太少',
    keyword_candidates: ['TEF口语', 'TCF口语', '法语口语', '开口说'],
    audience: '能看懂材料但一开口就卡的人',
    user_pain: '口语不是完全不会法语，而是没有观点、论据和过渡表达',
    user_need: '提前准备可复用的论据碎片和连接句',
    pay_trigger: '练口语时总是沉默、重复或说两句就结束',
    use_scenario: '口语专项准备、模拟练习和考前热身',
    content_shapes: ['pain', 'experience', 'offer', 'document', 'flashcard', 'phrase'],
    anchor_fact_ids: ['TS-009', 'TD-009', 'TU-008', 'TP-008', 'TK-008'],
    dynamic_fact_terms: ['口语', '论据', '过渡句', '开口', '模拟'],
    ai_original_scope: '可以生成常见口语论据和过渡表达，但法语句子必须准确自然，不得冒充真实考题',
    title_trigger_types: ['cognitive_conflict', 'curiosity_gap', 'identity', 'fear_loss'],
    page_plan: ['先拆开口卡住的原因', '给论据碎片结构', '给过渡表达', '示范一小段回答', '承接口语资料'],
  },
  {
    seed_id: 'tef_b2_c1_comparison',
    product_id: 'tef_tcf_canada',
    topic: '法语写作从B2到C1，差的不是高级词',
    keyword_candidates: ['法语写作范文', 'B2到C1', '高分范文', '写作对比'],
    audience: '写作有基础，但不知道好文章到底好在哪里的人',
    user_pain: '改作文只盯语法，却看不出结构、论证和表达层级的差距',
    user_need: '通过B2/C1范文对比，看到可迁移的升级点',
    pay_trigger: '想提升写作质量，但没有可对照的样本',
    use_scenario: '范文精读、改写和复盘阶段',
    content_shapes: ['document', 'table', 'directory', 'pain'],
    anchor_fact_ids: ['TS-010', 'TD-010', 'TU-009', 'TP-009', 'TK-009'],
    dynamic_fact_terms: ['B2', 'C1', '范文', '结构', '论证', '词汇'],
    ai_original_scope: '可以生成短段落对比和修改建议，但不得冒充商品原文范文或真实考生作文',
    title_trigger_types: ['cognitive_conflict', 'curiosity_gap', 'fear_loss', 'number_anchor'],
    page_plan: ['先说误区', '展示B2/C1差异维度', '给一组短句对比', '总结可迁移规则', '承接范文对比资料'],
  },
  {
    seed_id: 'tef_exam_day_flow',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF上考场前，流程别到当天才查',
    keyword_candidates: ['TEF报名', 'TCF报名', '查分', '考试流程'],
    audience: '临近考试，需要弄清报名、考试当天和查分流程的人',
    user_pain: '真正考试前不只要会做题，还要避免流程信息差带来的慌乱',
    user_need: '用流程清单把报名、考前、当天和查分后动作串起来',
    pay_trigger: '已经准备报名或即将考试，想减少流程风险',
    use_scenario: '报名之前、考前一周和考试当天早上',
    content_shapes: ['roadmap', 'offer', 'directory', 'document', 'table'],
    anchor_fact_ids: ['TS-013', 'TD-013', 'TU-010', 'TP-010', 'TK-011'],
    dynamic_fact_terms: ['报名', '机考', '查分', '流程', '考前清单'],
    ai_original_scope: '可以生成通用流程提醒，但不得替代官方报名说明；具体日期、费用和政策必须提示用户以官网为准',
    title_trigger_types: ['fear_loss', 'scenario', 'action_call', 'number_anchor'],
    page_plan: ['先强调流程风险', '拆报名前动作', '拆考试当天动作', '拆查分后动作', '承接全流程资料'],
  },
  {
    seed_id: 'tef_avoid_pitfalls',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF备考这几个坑，越早知道越省时间',
    keyword_candidates: ['法语B2备考', 'TEF备考经验', 'TCF备考经验', '避坑'],
    audience: '刚开始备考或备考一段时间后觉得效率很低的人',
    user_pain: '方法换来换去，时间花了但没有形成稳定训练闭环',
    user_need: '先避开常见错误，再把训练安排回到可执行路径上',
    pay_trigger: '想少走弯路，直接参考已经整理好的经验和流程',
    use_scenario: '备考初期路线校准、阶段复盘和考前提醒',
    content_shapes: ['pain', 'directory', 'document', 'offer', 'experience'],
    anchor_fact_ids: ['TS-012', 'TD-012', 'TU-010', 'TP-003', 'TK-010'],
    dynamic_fact_terms: ['避坑', '备考经验', '复盘', '资料', '路线'],
    ai_original_scope: '可以补充通用备考坑点，但不得伪造真实用户故事、成绩结果或保证避坑后一定提分',
    title_trigger_types: ['fear_loss', 'cognitive_conflict', 'curiosity_gap', 'number_anchor'],
    page_plan: ['先抛出高频坑', '解释为什么会浪费时间', '给替代做法', '整理成清单', '承接30条避坑经验'],
  },
  {
    seed_id: 'tef_product_showcase',
    product_id: 'tef_tcf_canada',
    topic: 'TEF/TCF备考资料包，适合这样按顺序用',
    keyword_candidates: ['法语B2备考资料', 'TEF备考资料', 'TCF备考资料', '加拿大法语'],
    audience: '想系统准备 TEF/TCF，但资料分散、不知道怎么组合使用的人',
    user_pain: '选考、自测、写作、词汇、听力、口语和流程资料散在不同地方，每次都要重新找',
    user_need: '看懂这套资料包的结构，以及不同阶段该先打开哪一份',
    pay_trigger: '已经确定要系统备考，希望减少资料整理成本，直接进入训练和复盘',
    use_scenario: '开始系统备考、整理资料或向用户展示商品价值时',
    content_shapes: ['directory', 'offer', 'book', 'pain', 'experience', 'document', 'table', 'roadmap', 'phrase'],
    anchor_fact_ids: ['TS-001', 'TD-001', 'TM-001', 'TM-002', 'TM-003', 'TM-004', 'TM-006'],
    dynamic_fact_terms: ['12份资料', 'TEF', 'TCF', 'CLB7', '30天计划', '50句型', '600词'],
    ai_original_scope: '可以解释资料包使用顺序和适合人群，但不得虚构服务、陪跑、批改、保过或提分承诺',
    title_trigger_types: ['curiosity_gap', 'fear_loss', 'identity', 'action_call'],
    page_plan: ['先说适合谁', '展示12份资料结构', '按阶段给使用顺序', '举例一天怎么用', '自然说明购买理由'],
  },
];

const seedLibrary: Partial<Record<ProductId, EditorialSeed[]>> = {
  delf_b2_writing: delfSeeds,
  tef_tcf_canada: tefTcfSeeds,
};

// These seeds describe first-level problems that a broad group of learners
// recognizes immediately. The first two topic slots must start here; otherwise
// a visually compatible but very narrow seed can dominate all three choices.
const broadSeedIds = new Set([
  'delf_final_check',
  'delf_wrong_right',
  'delf_sentence_upgrade',
  'delf_topic_vocabulary',
  'delf_argument_bank',
  'delf_sample_transfer',
  'delf_task_formats',
  'delf_learning_route',
  'delf_scoring_dimensions',
  'delf_combination_examples',
]);

const firstLevelPainSeedIds = new Set([
  'delf_final_check',
  'delf_wrong_right',
  'delf_topic_vocabulary',
  'delf_argument_bank',
  'delf_sample_transfer',
  'delf_task_formats',
  'delf_learning_route',
  'delf_formal_opening_closing',
]);

const searchPainSeedIds = new Set([
  'delf_sample_transfer',
  'delf_final_check',
  'delf_task_formats',
  'delf_scoring_dimensions',
  'delf_wrong_right',
  'delf_formal_opening_closing',
]);

const sellingPointSeedIds = new Set([
  'delf_learning_route',
  'delf_topic_vocabulary',
  'delf_argument_bank',
  'delf_combination_examples',
  'delf_sentence_upgrade',
]);

const productShowcaseSeedIds = new Set(['delf_product_showcase']);

const tefBroadSeedIds = new Set([
  'tef_exam_choice',
  'tef_clb7_self_test',
  'tef_30_day_plan',
  'tef_writing_patterns',
  'tef_topic_vocab',
  'tef_true_topics',
  'tef_listening_method',
  'tef_speaking_strategy',
  'tef_b2_c1_comparison',
  'tef_exam_day_flow',
  'tef_avoid_pitfalls',
]);

const tefSearchPainSeedIds = new Set([
  'tef_exam_choice',
  'tef_clb7_self_test',
  'tef_listening_method',
  'tef_speaking_strategy',
  'tef_avoid_pitfalls',
  'tef_exam_day_flow',
]);

const tefSellingPointSeedIds = new Set([
  'tef_30_day_plan',
  'tef_writing_patterns',
  'tef_topic_vocab',
  'tef_true_topics',
  'tef_b2_c1_comparison',
]);

const tefProductShowcaseSeedIds = new Set(['tef_product_showcase']);

const topicSeedPools: Record<ProductId, {
  broad: Set<string>;
  searchPain: Set<string>;
  sellingPoint: Set<string>;
  productShowcase: Set<string>;
}> = {
  delf_b2_writing: {
    broad: broadSeedIds,
    searchPain: searchPainSeedIds,
    sellingPoint: sellingPointSeedIds,
    productShowcase: productShowcaseSeedIds,
  },
  tef_tcf_canada: {
    broad: tefBroadSeedIds,
    searchPain: tefSearchPainSeedIds,
    sellingPoint: tefSellingPointSeedIds,
    productShowcase: tefProductShowcaseSeedIds,
  },
};

export function getEditorialSeeds(productId: ProductId): EditorialSeed[] {
  return seedLibrary[productId] || [];
}

export function planSeededTopics(input: {
  productId: ProductId;
  card: ProductCard;
  facts: ProductFacts;
  direction?: string;
  limit?: number;
  date?: Date;
  recentSeedIds?: string[];
}): MigratedTopic[] {
  const spec = getCoverTemplateSpec(input.card.renderer_id);
  if (!spec) return [];
  const factIds = new Set(Object.values(input.facts).flat().map(item => item.id));
  const direction = normalize(input.direction || '');
  const recentSeedIds = new Set(input.recentSeedIds || []);
  const day = (input.date || new Date()).toISOString().slice(0, 10);
  const ranked = getEditorialSeeds(input.productId)
    .filter(seed => seed.content_shapes.includes(spec.family))
    .filter(seed => seed.anchor_fact_ids.every(id => factIds.has(id)))
    .map(seed => ({
      seed,
      directionScore: direction ? scoreDirection(seed, direction) : 0,
      recentPenalty: recentSeedIds.has(seed.seed_id) ? 1 : 0,
      rotation: stableHash(`${day}:${input.card.id}:${seed.seed_id}`),
    }))
    .sort((a, b) => b.directionScore - a.directionScore || a.recentPenalty - b.recentPenalty || a.rotation - b.rotation);

  const limit = input.limit ?? 4;
  const pools = topicSeedPools[input.productId];
  const selected: Array<{ seed: EditorialSeed; topicType: NonNullable<MigratedTopic['topic_type']> }> = [];
  const selectedIds = new Set<string>();
  const pick = (ids: Set<string>, topicType: NonNullable<MigratedTopic['topic_type']>) => {
    const item = ranked.find(candidate => ids.has(candidate.seed.seed_id) && !selectedIds.has(candidate.seed.seed_id));
    if (!item || selected.length >= limit) return;
    selected.push({ seed: item.seed, topicType });
    selectedIds.add(item.seed.seed_id);
  };
  pick(pools.searchPain, 'search_pain');
  pick(pools.sellingPoint, 'selling_point');
  for (const item of ranked.filter(item => pools.broad.has(item.seed.seed_id))) {
    if (selected.length >= Math.min(3, limit)) break;
    if (!selectedIds.has(item.seed.seed_id)) {
      selected.push({ seed: item.seed, topicType: 'narrow_knowledge' });
      selectedIds.add(item.seed.seed_id);
    }
  }
  pick(pools.productShowcase, 'product_showcase');
  for (const item of ranked) {
    if (selected.length >= limit) break;
    if (!selectedIds.has(item.seed.seed_id)) {
      const fallbackType = selected.length === 0
        ? 'search_pain'
        : selected.length === 1
          ? 'selling_point'
          : selected.length === 2 || input.productId === 'tef_tcf_canada'
            ? 'narrow_knowledge'
            : 'product_showcase';
      selected.push({ seed: item.seed, topicType: fallbackType });
      selectedIds.add(item.seed.seed_id);
    }
  }

  return selected.map(({ seed, topicType }, index) => seedToTopic(seed, spec.family, input.card, index, topicType));
}

function seedToTopic(seed: EditorialSeed, shape: ContentShape, card: ProductCard, index: number, topicType?: NonNullable<MigratedTopic['topic_type']>): MigratedTopic {
  const keyword = seed.keyword_candidates[index % seed.keyword_candidates.length] || seed.keyword_candidates[0];
  return {
    id: `${seed.seed_id}__${card.renderer_id}`,
    seed_id: seed.seed_id,
    topic_type: topicType,
    scope_level: topicType === 'narrow_knowledge' ? 'narrow' : 'broad',
    topic: seed.topic,
    audience: seed.audience,
    scene: seed.use_scenario,
    pain: seed.user_pain,
    content_promise: seed.user_need,
    product_bridge: `${seed.pay_trigger}。`,
    why_this_reference_fits: `内容形态为${shape}，与“${card.name}”的展示能力匹配。`,
    novelty: `从${seed.use_scenario}出发，使用不同知识子集和例子完成本次内容。`,
    search_terms: Array.from(new Set([keyword, ...seed.keyword_candidates, ...seed.dynamic_fact_terms])).slice(0, 12),
    content_source_plan: {
      knowledge_base: `先精确读取${seed.anchor_fact_ids.join('、')}，再按${seed.dynamic_fact_terms.join('、')}扩展。`,
      ai_original: seed.ai_original_scope,
    },
    content_shape: shape,
    anchor_fact_ids: seed.anchor_fact_ids,
    dynamic_fact_terms: seed.dynamic_fact_terms,
    ai_original_scope: seed.ai_original_scope,
    title_trigger_types: seed.title_trigger_types,
    page_plan: adaptPagePlan(seed.page_plan, shape),
  };
}

function adaptPagePlan(pagePlan: string[], shape: ContentShape): string[] {
  const shapeLead: Partial<Record<ContentShape, string>> = {
    directory: '先用封面总览建立完整地图',
    phrase: '先从封面短表达中选择本次要练的一组',
    offer: '先说明适用人群和使用场景',
    flashcard: '先辨认词语含义和用法差异',
    book: '先交代本篇专题范围',
    pain: '先让用户确认自己是否处于这个卡点',
    experience: '先从具体学习情境切入',
    document: '先阅读材料片段再开始拆解',
    table: '先解释表格的行列阅读方法',
    roadmap: '先定位当前阶段再进入路径',
  };
  return Array.from(new Set([shapeLead[shape] || '', ...pagePlan])).filter(Boolean).slice(0, 6);
}

function scoreDirection(seed: EditorialSeed, direction: string) {
  const haystack = normalize(`${seed.topic} ${seed.audience} ${seed.user_pain} ${seed.user_need} ${seed.dynamic_fact_terms.join(' ')}`);
  return direction.split(/[\s,，、/]+/).filter(Boolean).reduce((score, term) => score + (haystack.includes(term) ? 10 : 0), 0);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}
