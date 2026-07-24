import {
  AudienceCluster,
  CreativeAsset,
  EvidenceAsset,
  NoteFormat,
  NoteFormatPlan,
  PainCluster,
  SellingCluster,
  TitleFormulaOption,
} from '@/types/content-planning';

interface BuildPlanInput {
  audience?: AudienceCluster;
  painCluster: PainCluster;
  sellingCluster: SellingCluster;
  detailPain: CreativeAsset;
  evidenceAsset: EvidenceAsset;
  titleOptions: TitleFormulaOption[];
}

export function buildNoteFormatPlans(input: BuildPlanInput): NoteFormatPlan[] {
  const formats = Array.from(new Set(input.titleOptions.map(option => option.note_format))).slice(0, 4);
  return formats.map(format => {
    const titleOption = input.titleOptions.find(option => option.note_format === format) || input.titleOptions[0];
    return {
      note_format: format,
      title: titleOption?.title || input.painCluster.name,
      title_formula_id: titleOption?.formula_id || '',
      caption_angle: buildCaptionAngle(format, input),
      pages: buildPages(format, titleOption?.title || input.painCluster.name, input),
    };
  });
}

function buildPages(format: NoteFormat, title: string, input: BuildPlanInput) {
  switch (format) {
    case 'real_experience':
      return realExperiencePages(title, input);
    case 'product_showcase':
      return productShowcasePages(title, input);
    case 'self_test':
      return selfTestPages(title, input);
    case 'knowledge_teaching':
    default:
      return teachingPages(title, input);
  }
}

function realExperiencePages(title: string, input: BuildPlanInput) {
  return [
    cover(title, input),
    page(2, 'hook', 'big_text', '我以前也这样学', input.painCluster.user_facing_pain, [
      `表面问题：${input.detailPain.text}`,
      '当时以为再多背一点就好',
    ], '真人经验大字页'),
    page(3, 'turn', 'wrong_right', '后来发现问题不在这', `真正卡住的是：${input.sellingCluster.name}`, [
      '不是资料不够',
      '是资料没有变成可调用的步骤',
    ], '前后认知对照'),
    page(4, 'value', visualForEvidence(input.evidenceAsset), '我开始这样拆', input.sellingCluster.user_facing_value, evidenceBullets(input), '方法拆解页'),
    page(5, 'proof', visualForEvidence(input.evidenceAsset), '给你看具体抓手', input.evidenceAsset.text, evidenceBullets(input), '展示知识库证据资产'),
    page(6, 'soft_sell', 'soft_sell', '资料包里怎么放', '不是让你硬背，而是按模块调用。', [
      '先定位问题',
      '再看对应资料',
      '最后用清单复盘',
    ], '轻带货承接页'),
    fitPage(7, input),
  ];
}

function productShowcasePages(title: string, input: BuildPlanInput) {
  return [
    cover(title, input),
    page(2, 'hook', 'big_text', '为什么要整理这份', input.painCluster.user_facing_pain, [
      '靠临场想很容易乱',
      '靠收藏资料又太散',
    ], '需求共鸣页'),
    page(3, 'value', 'directory', '里面不是一堆文件', '它要解决的是：找得到、看得懂、用得上。', [
      input.sellingCluster.user_facing_value,
      `核心证据：${input.evidenceAsset.text}`,
    ], '目录/模块页'),
    page(4, 'proof', visualForEvidence(input.evidenceAsset), '这一页最适合收藏', input.evidenceAsset.text, evidenceBullets(input), '重点样张页'),
    page(5, 'value', 'flow', '怎么用它', '不要从第一页看到最后一页，按问题调用。', [
      '先选当前问题',
      '再看对应模块',
      '写完后回到清单自查',
    ], '使用流程页'),
    page(6, 'soft_sell', 'soft_sell', '适合放进复习路径', '它的作用是减少你临时搜索和乱整理的时间。', [
      '范文看结构',
      '表达看替换',
      '错题和清单做复盘',
    ], '资料承接页'),
    fitPage(7, input),
  ];
}

function teachingPages(title: string, input: BuildPlanInput) {
  return [
    cover(title, input),
    page(2, 'hook', 'big_text', '先说结论', input.painCluster.user_facing_pain, [
      '你现在卡住的点可能不是表面那个',
      `比如：${input.detailPain.text}`,
    ], '结论页'),
    page(3, 'turn', 'wrong_right', '误区 vs 正确做法', `别只${weakAction(input)}，要${betterAction(input)}。`, [
      `误区：${weakAction(input)}`,
      `更稳：${betterAction(input)}`,
    ], '误区对照页'),
    page(4, 'value', visualForEvidence(input.evidenceAsset), '具体怎么做', input.sellingCluster.user_facing_value, evidenceBullets(input), '干货步骤页'),
    page(5, 'proof', visualForEvidence(input.evidenceAsset), '用这份资料承接', input.evidenceAsset.text, evidenceBullets(input), '证据展示页'),
    page(6, 'soft_sell', 'soft_sell', '资料包的作用', '帮你把这件事从“凭感觉”变成“按步骤”。', [
      '不是承诺提分',
      '是提供路径和检查依据',
      '适合写完后复盘',
    ], '轻转化页'),
    fitPage(7, input),
  ];
}

function selfTestPages(title: string, input: BuildPlanInput) {
  const questions = selfTestQuestions(input);
  return [
    cover(title, input),
    page(2, 'hook', 'self_test', '先测一下', '如果这几条中了，说明你不是单纯缺资料。', questions.slice(0, 2), '自测题前半'),
    page(3, 'value', 'self_test', '继续测', '重点看你写完作文后能不能自己定位问题。', questions.slice(2, 4), '自测题后半'),
    page(4, 'turn', 'big_text', '中了越多，越要先自查', input.painCluster.user_facing_pain, [
      `对应问题：${input.detailPain.text}`,
      `解决抓手：${input.evidenceAsset.text}`,
    ], '结果解释页'),
    page(5, 'proof', visualForEvidence(input.evidenceAsset), '对应资料在这里', input.evidenceAsset.text, evidenceBullets(input), '资料对应页'),
    page(6, 'soft_sell', 'soft_sell', '怎么补', input.sellingCluster.user_facing_value, [
      '先定位问题',
      '再看对应资料',
      '最后回到清单检查',
    ], '补救路径页'),
    fitPage(7, input),
  ];
}

function cover(title: string, input: BuildPlanInput) {
  return page(1, 'cover', 'cover', title, input.painCluster.name, [
    input.sellingCluster.name,
    input.evidenceAsset.text,
  ], '封面页，后续绑定竞品参考图');
}

function fitPage(pageNo: number, input: BuildPlanInput) {
  return page(pageNo, 'fit', 'fit', '适合谁', input.audience?.user_state || '正在准备 DELF B2 写作，但复习抓手不够清楚。', [
    input.audience?.name || 'B2写作卡住的人',
    '想要资料有路径，而不是零散收藏',
    '能接受自己练习和复盘，不适合想要保过承诺的人',
  ], '适合人群页');
}

function page(
  page_no: number,
  role: 'cover' | 'hook' | 'turn' | 'value' | 'proof' | 'soft_sell' | 'fit',
  visual_type: NoteFormatPlan['pages'][number]['visual_type'],
  page_title: string,
  main_text: string,
  bullets: string[],
  asset_hint: string,
) {
  return { page_no, role, visual_type, page_title, main_text, bullets, asset_hint };
}

function visualForEvidence(evidence: EvidenceAsset): NoteFormatPlan['pages'][number]['visual_type'] {
  if (evidence.asset_type === 'checklist') return 'checklist';
  if (evidence.asset_type === 'table') return 'table';
  if (evidence.asset_type === 'mistake_compare') return 'wrong_right';
  if (evidence.asset_type === 'plan') return 'flow';
  if (evidence.asset_type === 'sample') return 'doc_sample';
  return 'directory';
}

function evidenceBullets(input: BuildPlanInput): string[] {
  const text = input.evidenceAsset.text;
  if (/36|检查清单/.test(text)) return ['结构先查', '表达再查', '最后查格式和时间'];
  if (/6 题|自评/.test(text)) return ['能不能定位问题', '能不能说出下一步', '能不能写完后复盘'];
  if (/20 篇|范文/.test(text)) return ['看结构', '拆表达', '换主题复用'];
  if (/错题|错误句/.test(text)) return ['左边看常见错法', '右边看优化写法', '写完后对照修改'];
  if (/词汇|表达/.test(text)) return ['先换高频词', '再放进句子', '最后检查是否自然'];
  if (/路径|计划/.test(text)) return ['先判断时间', '再选节奏', '最后安排每天任务'];
  return [input.evidenceAsset.text, input.sellingCluster.name, input.detailPain.text];
}

function selfTestQuestions(input: BuildPlanInput): string[] {
  if (input.evidenceAsset.asset_type === 'checklist') {
    return ['写完后你会查结构吗？', '你知道哪类错误最扣质感吗？', '你会预留5分钟检查吗？', '你能说出下一篇先改什么吗？'];
  }
  if (/范文/.test(input.evidenceAsset.text)) {
    return ['你背完范文会拆结构吗？', '你能换主题复用句子吗？', '你知道哪些表达能替换吗？', '你会仿写而不是照抄吗？'];
  }
  return ['你知道自己卡在哪里吗？', '你写完后会复盘吗？', '你有固定检查顺序吗？', '你知道下一步该补什么吗？'];
}

function weakAction(input: BuildPlanInput): string {
  if (/范文/.test(input.evidenceAsset.text) || input.painCluster.id === 'pain_cannot_reuse_material') return '整篇背范文';
  if (/检查|自评|错题/.test(input.evidenceAsset.text)) return '凭感觉改作文';
  if (input.painCluster.id === 'pain_no_exam_priority') return '考前乱翻资料';
  return '盲目刷写作';
}

function betterAction(input: BuildPlanInput): string {
  if (/范文/.test(input.evidenceAsset.text)) return '拆结构和表达';
  if (/检查|自评/.test(input.evidenceAsset.text)) return '按清单自查';
  if (/错题/.test(input.evidenceAsset.text)) return '做错题对照';
  if (/路径|计划/.test(input.evidenceAsset.text)) return '先定复习路径';
  return '按模块复盘';
}

function buildCaptionAngle(format: NoteFormat, input: BuildPlanInput): string {
  if (format === 'real_experience') return `用真人经验口吻讲：以前${weakAction(input)}，后来改成${betterAction(input)}。`;
  if (format === 'product_showcase') return `重点展示「${input.evidenceAsset.text}」怎么承接「${input.sellingCluster.name}」。`;
  if (format === 'self_test') return `用自测题让用户先代入，再引出「${input.evidenceAsset.text}」。`;
  return `先讲误区，再给方法，最后用「${input.evidenceAsset.text}」做证据。`;
}
