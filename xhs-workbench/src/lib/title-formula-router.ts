import {
  AudienceCluster,
  CreativeAsset,
  EvidenceAsset,
  NoteFormat,
  PainCluster,
  SellingCluster,
  TitleFormulaOption,
  TitleTriggerType,
} from '@/types/content-planning';

export interface FormulaDef {
  id: string;
  trigger_type: TitleTriggerType;
  formula: string;
  note_formats: NoteFormat[];
  tags: string[];
  risk_flags?: string[];
}

interface TitleRouteInput {
  audience?: AudienceCluster;
  painCluster: PainCluster;
  sellingCluster: SellingCluster;
  detailPain: CreativeAsset;
  evidenceAsset: EvidenceAsset;
  tags: string[];
}

const FORMULAS: FormulaDef[] = [
  { id: '1', trigger_type: 'cognitive_conflict', formula: '为什么 [每个人都觉得很好的事] 其实对你有害？', note_formats: ['knowledge_teaching', 'real_experience'], tags: ['mistake', 'cognitive'] },
  { id: '11', trigger_type: 'curiosity_gap', formula: '关于 [某件事]，[一群人] 太晚知道的 [数字] 个教训', note_formats: ['real_experience', 'knowledge_teaching'], tags: ['lesson', 'mistake'] },
  { id: '12', trigger_type: 'curiosity_gap', formula: '看完这个，你的 [想法] 会不再相同', note_formats: ['knowledge_teaching'], tags: ['cognitive'] },
  { id: '14', trigger_type: 'fear_loss', formula: '[不想要的结果] 的最根本原因', note_formats: ['knowledge_teaching', 'real_experience'], tags: ['mistake', 'pain'] },
  { id: '17', trigger_type: 'fear_loss', formula: '警告！[数字] 件事正让你的 [努力] 白费', note_formats: ['knowledge_teaching', 'self_test'], tags: ['mistake', 'checklist'] },
  { id: '19', trigger_type: 'fear_loss', formula: '[一群人] 常犯的 [数字] 个错误', note_formats: ['knowledge_teaching', 'self_test'], tags: ['mistake', 'number'] },
  { id: '21', trigger_type: 'identity', formula: '给每个 [年龄层/身份] 人的终极 [建议]', note_formats: ['product_showcase', 'knowledge_teaching'], tags: ['identity'] },
  { id: '23', trigger_type: 'identity', formula: '给 [一群人] 的一个忠告', note_formats: ['real_experience', 'product_showcase'], tags: ['identity', 'advice'] },
  { id: '26', trigger_type: 'number_anchor', formula: '[数字] 个达成 [结果] 的小窍门', note_formats: ['knowledge_teaching', 'product_showcase'], tags: ['number', 'checklist'] },
  { id: '27', trigger_type: 'number_anchor', formula: '[话题] 的 [数字] 个步骤', note_formats: ['knowledge_teaching', 'product_showcase'], tags: ['steps', 'planning'] },
  { id: '29', trigger_type: 'number_anchor', formula: '[行动] 时，[数字] 个最有用的词', note_formats: ['product_showcase', 'knowledge_teaching'], tags: ['vocabulary', 'number'] },
  { id: '30', trigger_type: 'number_anchor', formula: '让你更 [结果] 的 [数字] 个方法', note_formats: ['knowledge_teaching', 'product_showcase'], tags: ['number', 'method'] },
  { id: '35', trigger_type: 'result_promise', formula: '我如何在 [时间] 内 [结果]', note_formats: ['real_experience'], tags: ['story'], risk_flags: ['avoid_score_promise'] },
  { id: '38', trigger_type: 'result_promise', formula: '[结果]，头 [数字] 小时你需要做什么', note_formats: ['knowledge_teaching', 'product_showcase'], tags: ['planning', 'rescue'], risk_flags: ['avoid_score_promise'] },
  { id: '41', trigger_type: 'social_proof', formula: '我是如何从 [不想要的结果] 到 [想要的结果]', note_formats: ['real_experience'], tags: ['story', 'pain'] },
  { id: '42', trigger_type: 'social_proof', formula: '从 [经历] 中学到的最重要的教训', note_formats: ['real_experience'], tags: ['story', 'lesson'] },
  { id: '46', trigger_type: 'social_proof', formula: '我差一点就 [负面的事]', note_formats: ['real_experience'], tags: ['story', 'fear'] },
  { id: '47', trigger_type: 'social_proof', formula: '从 [经历] 中我所学到的', note_formats: ['real_experience'], tags: ['story'] },
  { id: '48', trigger_type: 'controversy', formula: '[行动] 是在浪费时间么？', note_formats: ['knowledge_teaching', 'real_experience'], tags: ['controversy', 'action'] },
  { id: '52', trigger_type: 'controversy', formula: '[好的特质] VS [坏的特质] - 如何区分', note_formats: ['knowledge_teaching'], tags: ['table', 'compare'] },
  { id: '54', trigger_type: 'controversy', formula: '停止 [行动]！！开始 [行动]！！', note_formats: ['knowledge_teaching', 'product_showcase'], tags: ['action', 'contrast'] },
  { id: '56', trigger_type: 'scenario', formula: '如果你 [抗拒] [抗拒] [抗拒]，如何解决 [问题]', note_formats: ['knowledge_teaching', 'self_test'], tags: ['scenario', 'pain'] },
  { id: '60', trigger_type: 'scenario', formula: '当你知道你会 [负面情绪]，如何 [结果]', note_formats: ['self_test', 'knowledge_teaching'], tags: ['scenario', 'emotion'] },
  { id: '61', trigger_type: 'action_call', formula: '为什么你应该停止 [行动]', note_formats: ['knowledge_teaching', 'real_experience'], tags: ['action', 'mistake'] },
  { id: '62', trigger_type: 'action_call', formula: '别再关心 [话题]', note_formats: ['knowledge_teaching', 'product_showcase'], tags: ['action'] },
  { id: '63', trigger_type: 'action_call', formula: '别再寻找 [结果]，开始行动才是王道', note_formats: ['real_experience', 'knowledge_teaching'], tags: ['action'] },
  { id: '66', trigger_type: 'action_call', formula: '如何每天 [积极的事]，哪怕你 [不方便] 都可以', note_formats: ['knowledge_teaching'], tags: ['method', 'scenario'] },
  { id: '70', trigger_type: 'authority', formula: '最好的 [一群人] 都做了什么不同的事情？', note_formats: ['knowledge_teaching'], tags: ['authority'], risk_flags: ['avoid_fake_authority'] },
  { id: '72', trigger_type: 'interaction_test', formula: '敢不敢测一测，[话题]', note_formats: ['self_test'], tags: ['self_test', 'interaction'] },
  { id: '75', trigger_type: 'interaction_test', formula: '至关紧要的头 [数字] 分钟 - 如何 [话题]', note_formats: ['self_test', 'knowledge_teaching'], tags: ['rescue', 'planning'] },
];

export function getTitleFormulaCatalogForPrompt() {
  return FORMULAS.map(({ id, trigger_type, formula, note_formats, risk_flags }) => ({
    id,
    trigger_type,
    formula,
    note_formats,
    risk_flags: risk_flags || [],
  }));
}

const FORMAT_PRIORITY: Record<NoteFormat, TitleTriggerType[]> = {
  real_experience: ['social_proof', 'fear_loss', 'cognitive_conflict', 'scenario', 'action_call'],
  product_showcase: ['number_anchor', 'curiosity_gap', 'identity', 'action_call', 'scenario'],
  knowledge_teaching: ['cognitive_conflict', 'fear_loss', 'number_anchor', 'action_call', 'scenario', 'controversy'],
  self_test: ['interaction_test', 'identity', 'fear_loss', 'curiosity_gap', 'scenario'],
};

export function recommendNoteFormats(tags: string[]): NoteFormat[] {
  const formats: NoteFormat[] = [];
  if (tags.includes('self_test') || tags.includes('checklist') || tags.includes('mistake')) formats.push('self_test');
  if (tags.includes('document_pack') || tags.includes('sample') || tags.includes('checklist')) formats.push('product_showcase');
  if (tags.includes('mistake') || tags.includes('sentence') || tags.includes('vocabulary')) formats.push('knowledge_teaching');
  formats.push('real_experience');
  return Array.from(new Set(formats)).slice(0, 4);
}

export function routeTitleFormulas(input: TitleRouteInput, formats = recommendNoteFormats(input.tags)): TitleFormulaOption[] {
  const options = formats.flatMap(format => {
    return FORMULAS
      .filter(formula => formula.note_formats.includes(format))
      .map(formula => ({
        formula,
        score: scoreFormula(formula, format, input),
        format,
      }))
      .filter(item => item.score > 0);
  });

  return options
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ formula, format }) => ({
      formula_id: formula.id,
      trigger_type: formula.trigger_type,
      formula: formula.formula,
      title: fillTitle(formula.id, input),
      note_format: format,
      reason: buildReason(formula, format, input),
      risk_flags: formula.risk_flags ?? [],
    }))
    .filter(option => isTitleSafe(option.title, option.risk_flags))
    .sort((a, b) => titleQualityScore(b.title, input) - titleQualityScore(a.title, input))
    .filter(uniqueTitleOption);
}

function uniqueTitleOption(option: TitleFormulaOption, index: number, options: TitleFormulaOption[]): boolean {
  return options.findIndex(item => item.title === option.title) === index;
}

function scoreFormula(formula: FormulaDef, format: NoteFormat, input: TitleRouteInput): number {
  if (formula.id === '29' && !isVocabularySpecific(input)) return 0;
  if (formula.id === '30' && input.evidenceAsset.asset_type === 'plan') return 0;

  let score = 0;
  const triggerRank = FORMAT_PRIORITY[format].indexOf(formula.trigger_type);
  if (triggerRank >= 0) score += 8 - triggerRank;
  for (const tag of formula.tags) {
    if (input.tags.includes(tag)) score += 2;
    if (input.evidenceAsset.tags.includes(tag)) score += 2;
    if (input.painCluster.tags.includes(tag)) score += 1;
  }
  if (formula.risk_flags?.includes('avoid_score_promise')) score -= 2;
  if (formula.risk_flags?.includes('avoid_fake_authority')) score -= 4;
  return score;
}

function isVocabularySpecific(input: TitleRouteInput): boolean {
  const text = `${input.evidenceAsset.text} ${input.detailPain.text}`;
  return /词汇|表达|替换|高级词|高频词|普通表达|B1/.test(text);
}

function hasAnyTag(input: TitleRouteInput, tags: string[]): boolean {
  return tags.some(tag => input.tags.includes(tag) || input.evidenceAsset.tags.includes(tag) || input.painCluster.tags.includes(tag));
}

function fillTitle(formulaId: string, input: TitleRouteInput): string {
  const pain = input.painCluster.name;
  const audience = input.audience?.name || 'B2写作卡住的人';
  const evidence = cleanEvidenceName(input.evidenceAsset.text);
  const detailTheme = inferDetailTheme(input);
  const weakAction = inferWeakAction(input);
  const betterAction = inferBetterAction(input);
  const currentState = inferCurrentState(input);
  const wantedState = inferWantedState(input);
  const evidenceHook = buildEvidenceHook(input);
  const warningObject = inferWarningObject(input);

  const byId: Record<string, string> = {
    '1': `为什么你越${weakAction}，越${currentState}？`,
    '11': `关于${detailTheme}，B2考生太晚知道的3个教训`,
    '12': `看完${evidence}，你改作文的思路会变`,
    '14': `${pain}，根本原因可能在这里`,
    '17': `警告！${warningObject}`,
    '19': `${audience}常犯的5个${detailTheme}错误`,
    '21': `给每个${audience}的${evidence}`,
    '23': `给${audience}的一个忠告`,
    '26': evidenceHook.numberTitle,
    '27': evidenceHook.stepTitle,
    '29': `写B2作文时，先换掉这5类词`,
    '30': evidenceHook.numberTitle,
    '35': `我如何用${evidence}改作文`,
    '38': `B2写作考前，先看${evidence}`,
    '41': `我是如何从${currentState}到${wantedState}`,
    '42': `从${pain}中学到的教训`,
    '46': `我差点就继续${weakAction}`,
    '47': `从${evidence}里我学到的`,
    '48': `一直${weakAction}是在浪费时间么？`,
    '52': `会写 VS 像B2，差在哪？`,
    '54': `停止${weakAction}！！开始${betterAction}！！`,
    '56': `如果你没时间没方向，先看${evidence}`,
    '60': `考场会紧张，作文先查这几项`,
    '61': `为什么你应该停止${weakAction}`,
    '62': `别再只关心高级词了`,
    '63': `别再找万能模板，先用${evidence}`,
    '66': `每天20分钟，怎么用${evidence}`,
    '70': `B2写作稳的人，先查哪几项？`,
    '72': `敢不敢测一测，你作文像不像B2`,
    '75': evidenceHook.rescueTitle,
  };

  return normalizeTitle(byId[formulaId] || `${pain}，先看${evidence}`).replace('B2写作卡住的人', 'B2考生');
}

function buildReason(formula: FormulaDef, format: NoteFormat, input: TitleRouteInput): string {
  const formatName: Record<NoteFormat, string> = {
    real_experience: '真人经验',
    product_showcase: '资料展示',
    knowledge_teaching: '干货教学',
    self_test: '自测诊断',
  };
  return `${formatName[format]}型，适合用「${input.painCluster.name}」钩住用户，再用「${input.evidenceAsset.text}」承接。`;
}

function cleanEvidenceName(text: string): string {
  return text
    .replace(/（.*?）/g, '')
    .replace(/\s+/g, '')
    .replace('可勾选', '')
    .slice(0, 14);
}

function inferDetailTheme(input: TitleRouteInput): string {
  const text = `${input.detailPain.text} ${input.evidenceAsset.text} ${input.tags.join(' ')}`;
  if (/范文|迁移|仿写/.test(text)) return '范文迁移';
  if (/词汇|表达|替换/.test(text)) return '表达替换';
  if (/句式|句型|句法|虚拟|条件|让步/.test(text)) return '句式升级';
  if (/错题|错误|扣分|自查|检查/.test(text)) return '作文自查';
  if (/时间|考前|冲刺|救命/.test(text)) return '考前复盘';
  if (/结构|论证|主题句/.test(text)) return '论证结构';
  return 'B2写作';
}

function inferWeakAction(input: TitleRouteInput): string {
  const text = `${input.painCluster.name} ${input.detailPain.text} ${input.evidenceAsset.text}`;
  if (/范文|迁移/.test(text)) return '整篇背范文';
  if (/高级词|词汇|表达/.test(text)) return '堆高级词';
  if (/模板|句型/.test(text)) return '找万能模板';
  if (/检查|自查|扣分|错/.test(text)) return '凭感觉改作文';
  if (/考前|时间|冲刺/.test(text)) return '考前乱翻资料';
  return '盲目刷写作';
}

function inferBetterAction(input: TitleRouteInput): string {
  const text = `${input.sellingCluster.name} ${input.evidenceAsset.text} ${input.tags.join(' ')}`;
  if (/范文|样张|sample/.test(text)) return '拆范文表达';
  if (/清单|检查|checklist/.test(text)) return '逐项自查';
  if (/错题|错误|mistake/.test(text)) return '做错题对照';
  if (/词汇|表达|vocabulary/.test(text)) return '换表达';
  if (/路径|计划|planning/.test(text)) return '按路径复盘';
  return '拆成能用的模块';
}

function inferCurrentState(input: TitleRouteInput): string {
  if (input.painCluster.id === 'pain_no_self_check') return '乱改作文';
  if (input.painCluster.id === 'pain_cannot_reuse_material') return '背了也不会用';
  if (input.painCluster.id === 'pain_no_exam_priority') return '考前乱补';
  if (input.painCluster.id === 'pain_chinese_french') return '写得像中文翻译';
  if (input.painCluster.id === 'pain_material_messy') return '资料越攒越乱';
  return '作文不像B2';
}

function inferWantedState(input: TitleRouteInput): string {
  if (input.sellingCluster.id === 'sell_self_check') return '会按清单自查';
  if (input.sellingCluster.id === 'sell_reuse_samples') return '会拆范文复用';
  if (input.sellingCluster.id === 'sell_exam_priority') return '知道先补哪里';
  if (input.sellingCluster.id === 'sell_b2_expression') return '表达更像B2';
  if (input.sellingCluster.id === 'sell_system_pack') return '资料能调用';
  return '复习更有路径';
}

function buildEvidenceHook(input: TitleRouteInput): { numberTitle: string; stepTitle: string; rescueTitle: string } {
  const evidence = cleanEvidenceName(input.evidenceAsset.text);
  const text = input.evidenceAsset.text;

  if (/评分|评估|维度|score|criteria|critères/i.test(text)) {
    return {
      numberTitle: 'B2作文到底扣哪？先看这5个维度',
      stepTitle: '评分表别收藏吃灰，按这3步查',
      rescueTitle: '考前先看评分维度，别只背模板',
    };
  }

  if (/观点|论点|适用场景|argument|opinion/i.test(text)) {
    return {
      numberTitle: '50条观点里，真正好用的是这5类',
      stepTitle: '观点卡别硬背，按3类场景用',
      rescueTitle: '考前缺观点，先抓这5类主题',
    };
  }

  if (/lettre|正式信|formelle|流程图|步骤流程/i.test(text)) {
    return {
      numberTitle: '正式信最容易丢分的，其实是这7步',
      stepTitle: 'lettre formelle 按这7步写，不容易乱',
      rescueTitle: '考前别乱背信件模板，先过这7步',
    };
  }

  if (/组合示例|仿写|变体|完整法语句/i.test(text)) {
    return {
      numberTitle: '20条仿写示例里，先练这5种迁移',
      stepTitle: '别整句抄范文，按这3步仿写',
      rescueTitle: '考前不会迁移，先练组合示例',
    };
  }

  if (/完成度自评|自评表|诊断/.test(text)) {
    return {
      numberTitle: '这6个问题，能看出作文卡在哪',
      stepTitle: '写完作文，先问自己这6个问题',
      rescueTitle: '考前最要紧的5分钟：先自查',
    };
  }

  if (/检查清单|36/.test(text)) {
    return {
      numberTitle: '36项清单里，先查这5项',
      stepTitle: '36项检查清单，按这3步用',
      rescueTitle: '考前最要紧的5分钟：用36项清单',
    };
  }

  if (/范文|20篇/.test(text)) {
    return {
      numberTitle: '20篇范文里，真正该看这5处',
      stepTitle: '范文别整篇背，按3层拆',
      rescueTitle: '考前别背新范文，先拆旧范文',
    };
  }

  if (/错题|错误句|正确句/.test(text)) {
    return {
      numberTitle: '30条错题里，最容易漏这5类',
      stepTitle: '错题对照表，按这3步改作文',
      rescueTitle: '考前最要紧的5分钟：看错题',
    };
  }

  if (/词汇|词/.test(text)) {
    return {
      numberTitle: '240条表达里，先换这5类词',
      stepTitle: '词汇表别硬背，按3类用',
      rescueTitle: '考前别背新词，先换高频词',
    };
  }

  if (/路径|计划|阶段/.test(text)) {
    return {
      numberTitle: '3档路径里，先选对这一档',
      stepTitle: '学习路径表，按3步选',
      rescueTitle: '考前别乱补，先定路径',
    };
  }

  return {
    numberTitle: `${evidence}，先看这5处`,
    stepTitle: `${evidence}，按3步用`,
    rescueTitle: `考前先看${evidence}`,
  };
}

function inferWarningObject(input: TitleRouteInput): string {
  const text = `${input.painCluster.name} ${input.detailPain.text} ${input.evidenceAsset.text}`;
  if (/范文|迁移/.test(text)) return '这3件事让你背的范文用不上';
  if (/句式|句型|句法/.test(text)) return '这3件事让你背的句型用不上';
  if (/词汇|表达|替换/.test(text)) return '这3件事让你的表达一直像B1';
  if (/检查|自查|扣分|错/.test(text)) return '这3件事让你改作文全靠猜';
  if (/考前|时间|冲刺/.test(text)) return '这3件事让你考前越补越乱';
  return '这3件事让你的B2写作白练';
}

function isTitleSafe(title: string, riskFlags: string[]): boolean {
  if (/必过|保过|提分|押题|高分|唯一办法/.test(title)) return false;
  if (riskFlags.includes('avoid_fake_authority') && /名师|考官|官方|权威/.test(title)) return false;
  return title.length <= 32;
}

function titleQualityScore(title: string, input: TitleRouteInput): number {
  let score = 0;
  if (/[0-9０-９]/.test(title)) score += 2;
  if (/为什么|警告|敢不敢|差点|停止|别再|VS|先/.test(title)) score += 3;
  if (title.includes('B2')) score += 1;
  if (title.includes(cleanEvidenceName(input.evidenceAsset.text).slice(0, 2))) score += 3;
  if (/小窍门|方法/.test(title) && !/清单|错题|范文|词|表达|考前|自查/.test(title)) score -= 5;
  if (/让作文更像B2/.test(title) && !/先|这|错题|清单|表达/.test(title)) score -= 4;
  return score;
}

function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, '').replace(/，/g, '，').trim();
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
