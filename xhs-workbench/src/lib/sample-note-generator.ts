import type { ContentPlanningResult, NoteCandidate, NoteFormat, PageBlueprint } from '@/types/content-planning';
import { buildCoverMaterial, type CoverMaterial } from './cover-material-adapter';
import { matchResourceCovers, type ResourceCoverRef } from './resource-cover-library';

export interface SampleNotePage {
  page_no: number;
  visual_type: PageBlueprint['visual_type'];
  page_title: string;
  main_text: string;
  bullets: string[];
  visual_instruction: string;
}

export interface SampleNote {
  id: string;
  candidate_id: string;
  note_format: NoteFormat;
  title: string;
  cover_title: string;
  cover_subtitle: string;
  audience: string;
  pain: string;
  selling_point: string;
  evidence: string;
  pages: SampleNotePage[];
  cover_material: CoverMaterial;
  caption: string;
  tags: string[];
  recommended_resource_covers: ResourceCoverRef[];
  review_focus: string[];
  title_alternatives?: Array<{ note_title: string; cover_lines: string[]; issues: string[] }>;
  title_source?: 'ai' | 'local';
  formula_reference?: string;
  title_trigger?: string;
}

type EvidenceKind =
  | 'checklist'
  | 'self_test'
  | 'sample'
  | 'roadmap'
  | 'vocab'
  | 'mistake'
  | 'opinion'
  | 'rewrite'
  | 'score'
  | 'letter'
  | 'document';

interface NoteAngle {
  kind: EvidenceKind;
  title: string;
  coverTitle: string;
  coverSubtitle: string;
  visibleHook: string;
  userScene: string;
  proofTitle: string;
  proofRows: string[];
  useSteps: string[];
  tags: string[];
  focusLine?: string;
  formulaReference?: string;
  titleTrigger?: string;
}

export function buildSampleNotes(planning: ContentPlanningResult, count = 5, seed = Date.now()): SampleNote[] {
  return pickReviewCandidates(planning.candidates, count, seed)
    .map((candidate, index) => buildSampleNote(candidate, index + 1, seed + index));
}

function pickReviewCandidates(candidates: NoteCandidate[], count: number, seed: number): NoteCandidate[] {
  const preferredKinds: EvidenceKind[] = ['checklist', 'self_test', 'vocab', 'opinion', 'rewrite', 'mistake', 'roadmap'];
  const start = Math.abs(seed) % preferredKinds.length;
  const orderedKinds = preferredKinds.slice(start).concat(preferredKinds.slice(0, start));
  const result: NoteCandidate[] = [];
  const usedKinds = new Set<EvidenceKind>();

  for (const kind of orderedKinds) {
    const matches = candidates.filter(item => detectKind(item) === kind && !result.includes(item));
    const candidate = matches[stableIndex(`${seed}:${kind}`, matches.length)];
    if (!candidate) continue;
    result.push(candidate);
    usedKinds.add(kind);
    if (result.length >= count) return result;
  }

  const remaining = [...candidates].sort((a, b) => stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`));
  for (const candidate of remaining) {
    const kind = detectKind(candidate);
    if (result.includes(candidate) || usedKinds.has(kind)) continue;
    result.push(candidate);
    usedKinds.add(kind);
    if (result.length >= count) break;
  }

  return result.slice(0, count);
}

function buildSampleNote(candidate: NoteCandidate, order: number, seed: number): SampleNote {
  const angle = buildAngle(candidate, seed);
  const noteFormat = chooseFormat(angle.kind, candidate);
  const pages = buildPages(angle, noteFormat);

  return {
    id: `sample_${order}`,
    candidate_id: candidate.id,
    note_format: noteFormat,
    title: angle.title,
    cover_title: angle.coverTitle,
    cover_subtitle: angle.coverSubtitle,
    audience: audienceLabel(candidate),
    pain: candidate.pain_cluster.name,
    selling_point: candidate.selling_cluster.name,
    evidence: candidate.evidence_asset.text,
    pages,
    cover_material: buildCoverMaterial({
      note_format: noteFormat,
      cover_title: angle.coverTitle,
      cover_subtitle: angle.coverSubtitle,
      evidence: candidate.evidence_asset.text,
      pages,
    }),
    caption: buildCaption(angle),
    tags: angle.tags,
    recommended_resource_covers: matchResourceCovers({
      contentKind: angle.kind,
      noteFormat,
      titleIntent: titleIntentForKind(angle.kind),
      scene: angle.userScene,
      limit: 4,
    }),
    review_focus: [
      '3 秒内能不能看出：法语 / DELF B2 / 写作 / 给谁',
      '封面有没有具体场景和点击理由',
      'P1-P3 是否马上给到判断、清单或方法',
      '证据页是不是展示了真实内容，而不是资产名',
      '正文有没有少一点 AI 总结腔，多一点真人口吻',
    ],
    title_source: 'local',
    formula_reference: angle.formulaReference,
    title_trigger: angle.titleTrigger,
  };
}

function buildAngle(candidate: NoteCandidate, seed: number): NoteAngle {
  return personalizeAngle(buildBaseAngle(candidate), candidate, seed);
}

function buildBaseAngle(candidate: NoteCandidate): NoteAngle {
  const kind = detectKind(candidate);
  const scene = sceneLabel(candidate, kind);
  const audience = audienceLabel(candidate);

  if (kind === 'checklist') {
    return {
      kind,
      title: '法语B2作文写完别急着交！先揪这8个扣分点',
      coverTitle: '法语B2作文写完\n别急着交！',
      coverSubtitle: '最后5分钟先揪这8个扣分点',
      visibleHook: '如果你每次写完法语作文，只能凭感觉改，这张清单会比临时再背一篇范文更救急。',
      userScene: '考前 7 天 / 写完一篇作文后 / 最后 5 分钟检查时',
      proofTitle: '36项检查里，先看这8项',
      proofRows: [
        '结构：开头有没有交代身份和目的',
        '主体：每段有没有观点 + 解释 + 例子',
        '让步：有没有一句转折或让步',
        '表达：à mon avis / donc / mais 是否重复',
        '语体：tu / vous 有没有混用',
        '句法：有没有至少 1 个虚拟式或条件式',
        '字数：是否在 230-280 词附近',
        '时间：是否预留 5 分钟检查',
      ],
      useSteps: ['写完先别交', '按 8 项快速勾一遍', '只改最容易扣分的 2-3 处'],
      tags: baseTags(['#写作检查清单', '#考前复习']),
    };
  }

  if (kind === 'self_test') {
    return {
      kind,
      title: '你写的法语作文像B2吗？6题测出来',
      coverTitle: '你写的法语作文\n像B2吗？',
      coverSubtitle: '6题测出来，别再凭感觉改',
      visibleHook: '很多同学资料存了一堆，真正卡住的地方反而是：写完以后看不出自己差在哪。',
      userScene: '写完作文后 / 复盘错题前 / 觉得自己一直没进步时',
      proofTitle: '先问自己这6题',
      proofRows: [
        '我能说出这篇作文的中心观点吗？',
        '每个主体段都有例子吗？',
        '有没有一处明显的中式表达？',
        '连接词是不是只会 donc / mais？',
        '正式信里 tu / vous 是否统一？',
        '下一篇作文我先改哪一类问题？',
      ],
      useSteps: ['先测 6 题', '中 3 条以上就回到对应模块', '下一篇只盯一个问题改'],
      tags: baseTags(['#写作自测', '#作文复盘']),
    };
  }

  if (kind === 'vocab') {
    return {
      kind,
      title: '法语B2作文还像B1？先换这5类词',
      coverTitle: '法语B2作文\n还像B1？',
      coverSubtitle: '先换掉这5类高频普通词',
      visibleHook: 'B2 写作不一定要写很难，但有些词反复出现，会让文章一下子变普通。',
      userScene: '改作文时 / 背表达时 / 想让句子更正式时',
      proofTitle: '这5类词先换',
      proofRows: [
        'important → essentiel / primordial',
        'problème → enjeu / difficulté',
        'beaucoup de → de nombreux / une grande quantité de',
        'donc → par conséquent / ainsi',
        'mais → cependant / toutefois',
        'dire → affirmer / souligner',
        'faire → mettre en place / réaliser',
        'bon → bénéfique / pertinent',
        'mauvais → nuisible / préoccupant',
        'aider → favoriser / contribuer à',
      ],
      useSteps: ['先圈出重复词', '每类只换 1-2 个', '放回原句检查是否自然'],
      tags: baseTags(['#法语词汇', '#表达替换']),
    };
  }

  if (kind === 'opinion') {
    return {
      kind,
      title: '法语B2写作一看到题就没话？用这5类观点救场',
      coverTitle: '法语B2写作一看到题\n就没话？',
      coverSubtitle: '先用这5类观点救场',
      visibleHook: '写议论文时最崩的瞬间，往往不是法语拼不出来，而是连中文观点都想不出来。',
      userScene: '看到题目没观点时 / 写主体段前 / 练 essai argumentatif 时',
      proofTitle: '5类万能观点入口',
      proofRows: [
        '教育：公平机会 / 学习压力 / 自主能力',
        '科技：便利性 / 隐私风险 / 信息过载',
        '环境：个人责任 / 政策约束 / 消费选择',
        '工作：效率 / 身心健康 / 职业稳定',
        '社媒：表达自由 / 焦虑比较 / 虚假信息',
        '城市：公共交通 / 住房成本 / 社区生活',
        '文化：传统保护 / 多元交流 / 商业开发',
        '健康：预防意识 / 医疗资源 / 生活习惯',
      ],
      useSteps: ['先选主题', '再选立场', '最后配一个例子或让步句'],
      tags: baseTags(['#观点素材', '#议论文写作']),
    };
  }

  if (kind === 'rewrite') {
    return {
      kind,
      title: '背了20篇法语范文还不会写？先拆这一步',
      coverTitle: '背了20篇法语范文\n还不会写？',
      coverSubtitle: '别照抄，换题还能用才算真的会',
      visibleHook: '范文整篇背下来，换个题目还是卡住，通常是因为你没有拆出句子的功能。',
      userScene: '背完范文后 / 仿写练习时 / 换题就不会写时',
      proofTitle: '一条句子这样拆',
      proofRows: [
        '原句功能：提出反方担忧',
        '可换主题：教育 / 科技 / 环境',
        '保留结构：Certes..., mais...',
        '替换内容：把具体名词换成当前题目',
        '仿写目标：保留逻辑，不照搬原文',
        '连接作用：让步后回到自己的立场',
        '例子位置：观点后补一个具体场景',
        '检查重点：代词、时态和搭配是否跟着变化',
      ],
      useSteps: ['先判断句子功能', '再替换主题词', '最后自己重写一遍'],
      tags: baseTags(['#范文拆解', '#仿写练习']),
    };
  }

  if (kind === 'mistake') {
    return {
      kind,
      title: '法语B2作文总有低级错？先对照这5组',
      coverTitle: '法语B2作文总有低级错？\n先对照这5组',
      coverSubtitle: '错误句和修改句放一起，差别更明显',
      visibleHook: '很多错误单看规则记不住，放进真实句子里左右对照，反而一眼就能看出问题。',
      userScene: '批改作文后 / 同类错误反复出现时',
      proofTitle: '这5类错最值得先查',
      proofRows: [
        '语体混用 → tu / vous 全文统一',
        '连接重复 → donc / mais 换成功能明确的连接词',
        '搭配生硬 → 按法语固定搭配重写',
        '只有观点 → 补解释和具体例子',
        '句子过长 → 拆成两句再检查逻辑',
        '时态跳跃 → 先确定叙述时间线',
      ],
      useSteps: ['圈出原句问题', '对照修改句找差别', '下一篇只盯同一类错误'],
      tags: baseTags(['#法语错题', '#作文批改']),
    };
  }

  if (kind === 'roadmap') {
    return {
      kind,
      title: '法语B2写作不知道先练什么？按这3档走',
      coverTitle: '法语B2写作\n不知道先练什么？',
      coverSubtitle: '先测完成度，再选对应路径',
      visibleHook: '同样是备考 B2，写不出完整作文和只差最后检查，练法完全不同。',
      userScene: '刚开始备考 / 卡住不知道先练什么时',
      proofTitle: '先看你更接近哪一档',
      proofRows: [
        '基础档：先把任务格式和段落结构写完整',
        '提分档：补观点、例子和表达替换',
        '冲刺档：限时写作 + 检查清单复盘',
        '每周复盘：只记录反复出现的 3 类问题',
        '下一阶段：达标后再增加难度，不全量重学',
        '考前一周：只翻错题和速查页',
      ],
      useSteps: ['先做一次完整写作', '按结果选一档', '一周后再测是否换档'],
      tags: baseTags(['#备考规划', '#学习路径']),
    };
  }

  return {
    kind,
    title: `DELF B2写作${scene}又乱了？先看这份`,
    coverTitle: `DELF B2写作\n${scene}又乱了？`,
    coverSubtitle: `${audience}可以先翻这里`,
    visibleHook: candidate.pain_cluster.user_facing_pain,
    userScene: scene,
    proofTitle: '资料里具体包含这些',
    proofRows: ['范文拆解', '表达替换', '句法结构', '错题对照', '写作检查清单'],
    useSteps: ['先定位问题', '再看对应模块', '最后回到作文里改'],
    tags: baseTags(['#写作资料', '#备考资料']),
  };
}

function personalizeAngle(base: NoteAngle, candidate: NoteCandidate, seed: number): NoteAngle {
  const usableTitles = candidate.title_options.filter(option =>
    option.risk_flags.length === 0 &&
    titleMatchesKind(option.title, base.kind) &&
    !/学到的|教训|我是如何|根本原因可能/.test(option.title) &&
    isNaturalTitle(humanizeTitle(option.title, base.kind)) &&
    coverTitleFrom(humanizeTitle(option.title, base.kind)).split('\n').every(line => line.length <= 18),
  );
  const selected = usableTitles.length
    ? usableTitles[(Math.abs(seed) + stableHash(candidate.id)) % usableTitles.length]
    : undefined;
  const selectedTitle = selected?.title?.trim();
  const proofRows = personalizeProofRows(base.proofRows, candidate, seed, base.kind);
  const focusLine = base.kind === 'opinion'
    ? `本轮主题：${proofRows.slice(0, 3).map(row => row.split(/[：:]/)[0]).join(' / ')}`
    : focusLineFrom(candidate.creative_brief.detail_example);
  const formulaTitle = selectedTitle ? humanizeTitle(selectedTitle, base.kind) : base.title;
  const focusedTitle = focusedTitleFor(base.kind, candidate.creative_brief.detail_example, proofRows, seed);
  const title = focusedTitle || formulaTitle;

  return {
    ...base,
    title,
    coverTitle: coverTitleFrom(title),
    coverSubtitle: subtitleForFocus(base.coverSubtitle, focusLine, base.kind),
    visibleHook: `${candidate.pain_cluster.user_facing_pain.replace(/[。！!?]+$/, '')}。${base.visibleHook}`,
    proofTitle: proofTitleForFocus(base.proofTitle, focusLine, base.kind),
    proofRows,
    focusLine,
    formulaReference: selected?.formula,
    titleTrigger: selected?.trigger_type,
  };
}

function personalizeProofRows(rows: string[], candidate: NoteCandidate, seed: number, kind: EvidenceKind) {
  const offset = stableIndex(`${seed}:${candidate.id}:proof`, rows.length);
  const rotated = rows.slice(offset).concat(rows.slice(0, offset));
  const desiredCount: Partial<Record<EvidenceKind, number>> = {
    checklist: 6,
    self_test: 6,
    vocab: 7,
    opinion: 6,
    rewrite: 6,
    mistake: 6,
    roadmap: 6,
  };
  const detailRow = kind === 'opinion' ? '' : detailProofRow(candidate.creative_brief.detail_example, kind);
  const selected = rotated.slice(0, desiredCount[kind] || 6);

  if (detailRow && !selected.some(item => item.includes(detailRow.split(/[：:]/)[0]))) {
    selected.unshift(detailRow);
  }
  return Array.from(new Set(selected)).slice(0, desiredCount[kind] || 6);
}

function focusedTitleFor(kind: EvidenceKind, detail: string, proofRows: string[], seed: number) {
  const focus = focusSubject(detail);
  if (kind === 'checklist') return pickLocalTitle([
    `法语B2作文${focus}？交卷前这6项别漏`,
    '法语B2作文写完别急着交：这6项漏一项都可惜',
  ], seed);
  if (kind === 'self_test') return pickLocalTitle([
    `法语B2作文${focus}？这6题能查出问题`,
    '写完法语B2作文只剩“感觉还行”？先测这6题',
  ], seed);
  if (kind === 'vocab') return pickLocalTitle([
    `法语B2作文${vocabFocusSubject(detail)}？这7类表达先换掉`,
    '法语B2作文写来写去还是那几个词？这7类先换掉',
  ], seed);
  if (kind === 'opinion') {
    const topics = proofRows.slice(0, 2).map(row => row.split(/[：:]/)[0]).join('、');
    return pickLocalTitle([
      `法语B2议论文没话写？先从${topics}找观点`,
      '法语B2议论文最难的5分钟：题目懂了，观点想不出',
    ], seed);
  }
  if (kind === 'rewrite') return pickLocalTitle([
    '背了法语B2范文，换个题还是不会写？',
    '法语B2范文一换题就失灵？你少练了仿写这一步',
  ], seed);
  if (kind === 'mistake') return pickLocalTitle([
    `法语B2作文${focus}？批改后别只抄正确答案`,
    '法语B2作文批改完就翻篇？同一个错还会再扣分',
  ], seed);
  if (kind === 'roadmap') return pickLocalTitle([
    '法语B2写作越练越乱？你现在可能只该补一项',
    '法语B2写作复习最怕平均用力：先找最弱的一项',
  ], seed);
  return '';
}

function pickLocalTitle(titles: string[], seed: number) {
  return titles[Math.abs(seed) % titles.length];
}

function vocabFocusSubject(detail: string) {
  if (/句式单一/.test(detail)) return '表达太单一';
  if (/开头结尾/.test(detail)) return '开头总卡住';
  if (/词汇贫乏/.test(detail)) return '词总在重复';
  return '表达总用不上';
}

function humanizeTitle(value: string, kind: EvidenceKind) {
  const clean = value.replace(/\s+/g, ' ').replace(/[：:]$/, '').trim();

  if (/敢不敢测一测.*作文像不像B2/.test(clean)) return '你这篇法语作文够B2吗？6题测出来';
  if (/为什么你越堆高级词，越作文不像B2/.test(clean)) return '法语B2作文越堆高级词，反而越不像B2';
  if (/为什么你应该停止凭感觉改作文/.test(clean)) return '法语B2作文别再凭感觉改，先看这几类错';
  if (/警告.*让你改作文全靠猜/.test(clean)) return '法语B2作文总改不对？先避开这3个坑';
  if (/写B2作文时.*先换掉这5类词/.test(clean)) return '法语B2作文，先换掉这5类普通词';
  if (/别整句抄范文.*按这3步仿写/.test(clean)) return '法语B2范文别整句抄，按这3步仿写';
  if (/写作输出薄弱的人常犯的5个.*自查错误/.test(clean)) return '法语B2作文总查不出问题？先看这5处';
  if (/想要模板和例句的人常犯的5个.*范文迁移错误/.test(clean)) return '法语B2范文换题就不会用？先避开这5个坑';
  if (/为什么你越凭感觉改作文，越作文不像B2/.test(clean)) return '法语B2作文越改越乱？问题在这几类错';
  if (/我差点就继续整篇背范文/.test(clean)) return '法语B2范文别整篇背，我踩过这个坑';
  if (/词汇表别硬背.*按3类用/.test(clean)) return '法语B2写作，背词总用不上？先练这3类';
  if (/3档路径里.*先选对这一档|学习路径表.*按3步选/.test(clean)) return '法语B2写作怎么练？先看你在哪一档';
  if (/考前最要紧的5分钟.*看错题/.test(clean)) return '法语B2考前5分钟，最后再查这几类错';
  if (/观点卡别硬背.*按3类场景用/.test(clean)) return '法语B2写作没思路？先拆这3类场景';
  if (/考前最要紧的5分钟.*36项清单/.test(clean)) return '法语B2作文交卷前，先查这6项';
  if (/240条表达里.*先换这5类词/.test(clean)) return '法语B2写作，240条表达先挑这5类';
  if (/50条观点里.*好用的是这5类/.test(clean)) return '法语B2写作没思路？先看这5类观点';
  if (/20条仿写示例里.*5种迁移/.test(clean)) return '法语B2范文不会迁移？先练这5种';
  if (/警告.*背的范文用不上/.test(clean)) return '法语B2范文背了用不上？先避开这3个坑';

  if (/法语|DELF|B2/i.test(clean)) return clean.replace(/法语B2写作[：:]/, '法语B2写作，');
  if (/作文/.test(clean)) return clean.replace('作文', '法语B2作文');
  if (/范文/.test(clean)) return clean.replace('范文', '法语B2范文');

  const fallback: Record<EvidenceKind, string> = {
    checklist: '法语B2作文交卷前，先查这6项',
    self_test: '法语B2作文到底差在哪？6题测出来',
    vocab: '法语B2写作，背词总用不上？先练这3类',
    opinion: '法语B2写作没思路？先看这5类观点',
    rewrite: '法语B2范文不会迁移？先练这5种',
    mistake: '法语B2作文别凭感觉改，错题这样对照',
    roadmap: '法语B2写作怎么练？先看你在哪一档',
    sample: '法语B2范文别整篇背，先拆这5处',
    score: '法语B2作文怎么评分？先看这5项',
    letter: '法语B2正式信怎么写？先顺这7步',
    document: '法语B2写作资料，先看这几页',
  };
  return fallback[kind];
}

function isNaturalTitle(title: string) {
  if ((title.match(/作文/g) || []).length > 1) return false;
  if (/的人常犯的|想要.+的人|别整句抄法语|按\d类用|选对这一档/.test(title)) return false;
  if (/法语B2写作[：:].+[：:]/.test(title)) return false;
  return title.length >= 12 && title.length <= 30;
}

function focusSubject(detail: string) {
  if (/时间分配/.test(detail)) return '总写不完';
  if (/句式单一/.test(detail)) return '全是简单句';
  if (/性数一致/.test(detail)) return '性数总出错';
  if (/论证结构/.test(detail)) return '段落总写散';
  if (/词汇贫乏/.test(detail)) return '词汇总重复';
  if (/开头结尾/.test(detail)) return '首尾总卡住';
  if (/中式法语/.test(detail)) return '总在中式直译';
  if (/时态配合/.test(detail)) return '时态总混用';
  if (/拼写与标点/.test(detail)) return '细节总扣分';
  return '写完不会改';
}

function detailProofRow(detail: string, kind: EvidenceKind) {
  if (/时间分配/.test(detail)) return '时间：读题8分 / 草稿10分 / 正文37分 / 检查5分';
  if (/句式单一/.test(detail)) return kind === 'self_test'
    ? '全文除了简单句，有没有让步、条件或原因句？'
    : '句式：简单句之外补让步 / 条件 / 原因结构';
  if (/性数一致/.test(detail)) return kind === 'self_test'
    ? '名词、形容词和过去分词的一致查过了吗？'
    : '一致：名词 / 形容词 / 过去分词逐项核对';
  if (/论证结构/.test(detail)) return '结构：主题句 / 解释 / 例子 / 让步是否齐全';
  if (/词汇贫乏/.test(detail)) return '重复词：à mon avis / il y a / donc / mais 先圈出';
  if (/开头结尾/.test(detail)) return '首尾：身份目的、立场和总结是否完整';
  if (/中式法语/.test(detail)) return '直译：先找句子主干，再按法语搭配重写';
  if (/时态配合/.test(detail)) return '时态：先定时间线，再查过去时之间的配合';
  if (/拼写与标点/.test(detail)) return '拼写：重音符号和法语标点前空格单独查';
  return '';
}

function focusLineFrom(detail: string) {
  const clean = detail.replace(/[（(].*?[）)]/g, '').replace(/[。；;]/g, '').trim();
  return shortenCopy(clean, 24);
}

function subtitleForFocus(fallback: string, focus: string, kind: EvidenceKind) {
  if (!focus) return fallback;
  if (kind === 'opinion') return '每次换5个主题，先选立场再找例子';
  if (kind === 'vocab') return `这次先处理：${shortenCopy(focus, 15)}`;
  if (kind === 'rewrite') return `换题练习先盯：${shortenCopy(focus, 15)}`;
  return `这次先查：${shortenCopy(focus, 16)}`;
}

function proofTitleForFocus(fallback: string, focus: string, kind: EvidenceKind) {
  if (!focus) return fallback;
  if (kind === 'opinion') return '这次先拆这5个主题';
  if (kind === 'vocab') return '这次换掉这7类普通表达';
  if (kind === 'rewrite') return '这次只练一个迁移动作';
  return `先看：${shortenCopy(focus, 16)}`;
}

function shortenCopy(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function titleMatchesKind(title: string, kind: EvidenceKind) {
  const rules: Record<EvidenceKind, RegExp> = {
    checklist: /清单|检查|自查|扣分|交卷|5分钟/,
    self_test: /测|自评|像不像|完成度/,
    vocab: /词|表达|替换|B1|B2/,
    opinion: /观点|没话|思路|题目|素材/,
    rewrite: /范文|仿写|迁移|组合|照抄/,
    mistake: /错|改|对照|扣分|凭感觉|低级/,
    roadmap: /路径|计划|安排|先练|冲刺|乱学/,
    sample: /范文|拆|原文|素材/,
    score: /评分|分数|标准|扣分/,
    letter: /信|lettre|格式/,
    document: /资料|目录|整理|知识库/,
  };
  return rules[kind].test(title);
}

function coverTitleFrom(title: string) {
  const clean = title.replace(/\s+/g, '').trim();
  const punctuationParts = clean.split(/(?<=[？！，：；])/u).filter(Boolean);
  const lines = punctuationParts.flatMap(part => semanticSplit(part, 13));
  if (lines.length >= 2 && lines.length <= 3) return lines.join('\n');
  return semanticSplit(clean, 12).slice(0, 3).join('\n');
}

export function formatCoverTitle(title: string) {
  return coverTitleFrom(title);
}

function semanticSplit(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const preferred = ['先', '再', '别', '问题', '这', '只', '总', '还', '一换题', '写完', '交卷前'];
  const candidates = preferred
    .map(token => text.indexOf(token, 4))
    .filter(index => index >= 4 && index <= max + 2);
  let splitAt = candidates.sort((a, b) => Math.abs(a - max) - Math.abs(b - max))[0];
  if (splitAt === undefined) splitAt = Math.min(max, text.length - 4);
  const protectedPhrases = ['怎么练', '没思路', '法语B2', '写不完', '用不上', '中式直译', '性数一致', '感觉还行'];
  while (splitAt > 4 && protectedPhrases.some(phrase => {
    const start = text.indexOf(phrase);
    return start >= 0 && splitAt > start && splitAt < start + phrase.length;
  })) splitAt -= 1;
  return [text.slice(0, splitAt), ...semanticSplit(text.slice(splitAt), max)];
}

function stableIndex(key: string, length: number) {
  return length > 0 ? stableHash(key) % length : 0;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildPages(angle: NoteAngle, format: NoteFormat): SampleNotePage[] {
  const proofVisual = visualForKind(angle.kind);
  const template = templateSpec(angle.kind);

  return [
    page(1, 'cover', angle.coverTitle, angle.coverSubtitle, [angle.userScene], template.cover),
    page(
      2,
      'big_text',
      hookPageTitle(angle.kind),
      angle.visibleHook,
      angle.focusLine ? [angle.focusLine, ...sceneBullets(angle.kind)].slice(0, 3) : sceneBullets(angle.kind),
      template.hook,
    ),
    page(3, proofVisual, angle.proofTitle, proofIntro(angle.kind), angle.proofRows.slice(0, 5), template.proof),
    page(4, proofVisual, secondProofTitle(angle.kind), secondProofIntro(angle.kind), angle.proofRows.slice(5), template.proof),
    page(5, 'flow', practicePageTitle(angle.kind), '别从头刷资料，按当前问题调用。', angle.useSteps, template.flow),
    page(6, 'soft_sell', '资料包里对应这些模块', '需要的时候能直接翻到对应页，不用临时翻一堆收藏。', sellBullets(angle.kind), template.sell),
    page(7, 'fit', '这类同学更适合', '适合想自己练、但需要清晰抓手的人。', ['B1-B2、正在准备 DELF B2 写作', '写完不知道怎么改', '不适合：只想要保过承诺的人'], template.fit),
  ];
}

function hookPageTitle(kind: EvidenceKind) {
  if (kind === 'checklist') return '写完作文别只通读一遍';
  if (kind === 'self_test') return '写完觉得还行？先测';
  if (kind === 'vocab') return '这些词太容易写普通';
  if (kind === 'opinion') return '没观点时先别硬写';
  if (kind === 'rewrite') return '范文别整篇背';
  return '你可能卡在这里';
}

function proofIntro(kind: EvidenceKind) {
  if (kind === 'checklist') return '先查最容易影响作文质感的几项。';
  if (kind === 'self_test') return '不用想太复杂，先诚实回答这几题。';
  if (kind === 'vocab') return '先从最常见的表达升级开始。';
  if (kind === 'opinion') return '先有观点入口，主体段才写得下去。';
  if (kind === 'rewrite') return '范文要拆成结构，换题才用得上。';
  return '先看这几项能不能解决你当前的问题。';
}

function secondProofTitle(kind: EvidenceKind) {
  if (kind === 'checklist') return '后面 3 项也别漏';
  if (kind === 'self_test') return '测完看哪里要补';
  if (kind === 'vocab') return '换完要放回句子里';
  if (kind === 'opinion') return '观点要配例子';
  if (kind === 'rewrite') return '照抄没用，先拆功能';
  return '再看这几项';
}

function secondProofIntro(kind: EvidenceKind) {
  if (kind === 'checklist') return '这几项不显眼，但很容易影响作文质感。';
  if (kind === 'vocab') return '词换完以后，句子还要自然。';
  if (kind === 'opinion') return '观点要能写进段落。';
  if (kind === 'rewrite') return '保留逻辑，替换内容，才算真的会用。';
  return '如果前面几条中了，再看这一页。';
}

function practicePageTitle(kind: EvidenceKind) {
  if (kind === 'checklist') return '写完后按这 3 步查';
  if (kind === 'self_test') return '测完后按这 3 步补';
  if (kind === 'vocab') return '表达替换按这 3 步';
  if (kind === 'opinion') return '观点卡按这 3 步用';
  if (kind === 'rewrite') return '仿写按这 3 步练';
  return '按这 3 步用';
}

function page(
  page_no: number,
  visual_type: SampleNotePage['visual_type'],
  page_title: string,
  main_text: string,
  bullets: string[],
  visual_instruction: string,
): SampleNotePage {
  return { page_no, visual_type, page_title, main_text, bullets, visual_instruction };
}

function templateSpec(kind: EvidenceKind) {
  const base = '画面比例 3:4，小红书干货资料风；中文大字必须清晰；不要生成乱码、logo、水印、二维码；内容区要像手工整理的资料页。';
  return {
    cover: `${base} 封面结构：顶部小标签“DELF B2 法语写作”，中间 2-3 行超大标题，底部一行场景说明。背景可用纸张、荧光笔、红圈、便签，但不要空白极简。`,
    hook: `${base} P2 用“大字痛点 + 3 个小标签”结构。标题占上半区，下面三条短句，每条前面用红色勾/叉/圆点。`,
    proof: `${base} 证据页必须排出具体条目，不要只写资料名。${proofLayout(kind)}`,
    flow: `${base} 流程页用 1-2-3 三步卡片，每步一个短标题 + 一句说明，用箭头连接。`,
    sell: `${base} 承接页不要广告海报感。用“资料包里对应模块”小目录样式，展示模块名和使用场景。`,
    fit: `${base} 收尾页用左右分栏：左侧“适合”，右侧“不适合”，用标签贴纸样式。`,
  };
}

function proofLayout(kind: EvidenceKind) {
  if (kind === 'checklist') return '布局：仿检查清单，8 条项目纵向排列，每条左侧空心 checkbox，右侧文字；重点词用红色下划线。';
  if (kind === 'self_test') return '布局：仿自测问卷，6 个问题卡片，每题左侧编号 Q1-Q6，右侧留勾选圆圈。';
  if (kind === 'vocab') return '布局：仿词汇替换表，两列结构，左列“普通写法”，右列“更像B2”；用箭头连接。';
  if (kind === 'opinion') return '布局：仿观点卡片矩阵，5 个主题卡，每张卡含主题、观点方向、例子关键词。';
  if (kind === 'rewrite') return '布局：仿范文拆解页，上方原句功能，下方三行拆解：功能/可替换/仿写。';
  if (kind === 'mistake') return '布局：左右对照，左边红色“常见错法”，右边绿色“更稳写法”。';
  return '布局：仿知识库目录页，左侧目录栏，右侧内容卡片。';
}

function sceneBullets(kind: EvidenceKind) {
  if (kind === 'checklist') return ['写完作文只会通读一遍', '不知道哪些地方最容易扣分', '考前越看资料越乱'];
  if (kind === 'self_test') return ['写完觉得还行，但说不出好在哪', '改作文全靠语感', '下一篇还是重复同样问题'];
  if (kind === 'vocab') return ['important / problème / mais 反复出现', '想写正式一点但怕用错', '背了词却放不进句子'];
  if (kind === 'opinion') return ['看到题目先卡中文思路', '主体段写两句就没话说', '例子总是很空'];
  if (kind === 'rewrite') return ['范文收藏很多', '换题还是不会写', '背过的句子用不上'];
  return ['资料很多但很散', '不知道先看哪一份', '写完缺少检查标准'];
}

function sellBullets(kind: EvidenceKind) {
  if (kind === 'checklist') return ['E1-E7 写作检查清单', '错题对照库', '考前速查模块'];
  if (kind === 'self_test') return ['5分钟诊断问卷', '3档学习路径', '完成度自评表'];
  if (kind === 'vocab') return ['240条表达替换', '按功能和主题分类', '带频率优先级'];
  if (kind === 'opinion') return ['50条观点卡', '10大常考主题', '配例子和适用场景'];
  if (kind === 'rewrite') return ['20条组合示例', '完整法语句 + 中文', '仿写变体'];
  return ['范文库', '句法库', '检查清单'];
}

function buildCaption(angle: NoteAngle) {
  const proof = angle.proofRows.slice(0, 5).map(item => `- ${item}`).join('\n');
  const steps = angle.useSteps.map(item => `- ${item}`).join('\n');
  const focusLead = captionFocusLead(angle);

  if (angle.kind === 'checklist') {
    return `${angle.title}

${focusLead}
写完 DELF B2 作文后，最后 5 分钟很关键。问题是，很多人只会从头读一遍，然后凭感觉改两句。

我会先扫这几项：
${proof}

尤其是这 3 个地方，真的很容易被忽略：
- tu / vous 混用
- donc / mais 重复太多
- 主体段只有观点，没有例子

我的用法：
${steps}

小车里的资料包把这张检查清单和错题对照放在一起。写完以后能直接翻到“该查什么、怎么改”，不用临时在收藏夹里乱找。

适合：考前冲刺、写完不会改、作文总觉得不像 B2 的同学。`;
  }

  if (angle.kind === 'self_test') {
    return `${angle.title}

${focusLead}
如果你每次写完法语作文，只能说“感觉还行”，但说不出哪里好、哪里扣分，可以先用这 6 题测一下。

先问自己：
${proof}

中了 3 条以上，不建议继续盲目背范文。你更需要先定位问题：
${steps}

资料包里有 5 分钟诊断、3 档学习路径和完成度自评表。用它的重点是定位下一篇作文该先练什么：结构、表达、观点，还是检查。`;
  }

  if (angle.kind === 'vocab') {
    return `${angle.title}

${focusLead}
B2 写作不用每句都堆难词。先把几个高频普通词换掉，文章质感会立刻稳一点。

可以先换这几类：
${proof}

不要一次把整篇都改得很花。我的建议是：
${steps}

资料包里的词汇卡会按“观点、原因、结果、对比、让步、正式信开头结尾”等功能分类。写作文时缺哪类表达，就翻哪类，不用整张词表硬背。`;
  }

  if (angle.kind === 'opinion') {
    return `${angle.title}

${focusLead}
很多人写 DELF B2 议论文，一看到题目先空白。法语还没开始组织，中文观点已经卡住了。

先从这 5 类入口找思路：
${proof}

我的写法一般是：
${steps}

资料包里的观点卡会把主题、法语观点句、例子和适用场景放一起。适合那种一看到题目就脑子空，但又不想背死模板的人。`;
  }

  if (angle.kind === 'rewrite') {
    return `${angle.title}

${focusLead}
范文整篇背，很容易换题就失灵。

真正该拆的是这些：
${proof}

练的时候按这个顺序：
${steps}

资料包里的组合示例会给完整法语句、中文意思、来源和仿写变体。练的时候重点看“这句话在段落里起什么作用”，再换成自己的题目。`;
  }

  if (angle.kind === 'mistake') {
    return `${angle.title}

${focusLead}
作文批改完，我最怕只看一眼分数就翻篇。同一种错误，下篇通常还会再来。

我会把原句和修改句并排看：
${proof}

复盘顺序很简单：
${steps}

资料包里的错题对照不是只列语法名称，而是把错误句、修改句和问题类型放在一起。写完作文时按类别回查，比重新翻一遍语法书快得多。`;
  }

  if (angle.kind === 'roadmap') {
    return `${angle.title}

${focusLead}
备考写作最容易浪费时间的地方，是基础没补齐就去刷高级表达，或者已经能写完整篇了，还一直从头学格式。

先看自己在哪一档：
${proof}

接下来这样走：
${steps}

资料包把学习路径、对应模块和检查清单连在一起。测完落在哪一档，就只打开那一档需要的内容，不用每天重新决定学什么。`;
  }

  return `${angle.title}

${focusLead}
${angle.visibleHook}

这条先给你几个能直接用的抓手：
${proof}

用的时候按这个顺序：
${steps}

小车里的资料包会把这些内容放到对应模块里。你写作时能直接找抓手：范文看结构，表达看替换，写完用清单和错题复盘。`;
}

function captionFocusLead(angle: NoteAngle) {
  if (!angle.focusLine || angle.kind === 'opinion') return '';
  if (angle.kind === 'checklist') return `这次不全查，先盯“${angle.focusLine}”。`;
  if (angle.kind === 'self_test') return `这一轮自测，重点看“${angle.focusLine}”。`;
  if (angle.kind === 'vocab') return `这次先处理“${angle.focusLine}”。`;
  if (angle.kind === 'rewrite') return `这次仿写只练“${angle.focusLine}”。`;
  if (angle.kind === 'mistake') return `这次复盘只抓“${angle.focusLine}”。`;
  if (angle.kind === 'roadmap') return `这次先按“${angle.focusLine}”选路径。`;
  return `这次先解决“${angle.focusLine}”。`;
}

function chooseFormat(kind: EvidenceKind, candidate: NoteCandidate): NoteFormat {
  if (kind === 'self_test') return 'self_test';
  if (kind === 'mistake' || kind === 'score') return 'knowledge_teaching';
  if (kind === 'checklist' || kind === 'vocab' || kind === 'opinion' || kind === 'rewrite' || kind === 'roadmap') return 'product_showcase';
  return candidate.recommended_note_formats[0] || 'knowledge_teaching';
}

function detectKind(candidate: NoteCandidate): EvidenceKind {
  const text = candidate.evidence_asset.text;
  if (/36|清单/.test(text)) return 'checklist';
  if (/自评|自测|6 题|6题/.test(text)) return 'self_test';
  if (/范文/.test(text)) return 'sample';
  if (/路径|计划/.test(text)) return 'roadmap';
  if (/词汇|表达/.test(text)) return 'vocab';
  if (/错题|错误句|正确句/.test(text)) return 'mistake';
  if (/观点/.test(text)) return 'opinion';
  if (/组合|仿写/.test(text)) return 'rewrite';
  if (/评分|维度/.test(text)) return 'score';
  if (/lettre|正式信/i.test(text)) return 'letter';
  return 'document';
}

function visualForKind(kind: EvidenceKind): SampleNotePage['visual_type'] {
  if (kind === 'checklist') return 'checklist';
  if (kind === 'self_test') return 'self_test';
  if (kind === 'vocab' || kind === 'opinion' || kind === 'score') return 'table';
  if (kind === 'mistake') return 'wrong_right';
  if (kind === 'roadmap' || kind === 'letter') return 'flow';
  if (kind === 'rewrite' || kind === 'sample') return 'doc_sample';
  return 'directory';
}

function titleIntentForKind(kind: EvidenceKind): string {
  if (kind === 'checklist') return 'collection_done';
  if (kind === 'self_test') return 'pain_warning';
  if (kind === 'vocab') return 'number_list';
  if (kind === 'opinion') return 'personal_method';
  if (kind === 'rewrite' || kind === 'sample') return 'case_breakdown';
  if (kind === 'roadmap') return 'planning';
  if (kind === 'mistake' || kind === 'score') return 'mistake_warning';
  return 'resource_showcase';
}

function audienceLabel(candidate: NoteCandidate) {
  const id = candidate.audience_cluster?.id;
  if (id === 'audience_exam_sprint') return '考前冲刺的 DELF B2 写作考生';
  if (id === 'audience_retake_failed') return 'B2 写作没过、准备复考的人';
  if (id === 'audience_weak_output') return '法语输出不稳定的 B1-B2 学习者';
  if (id === 'audience_template_learner') return '背了范文但不会迁移的人';
  return '正在系统备考 DELF B2 写作的人';
}

function sceneLabel(candidate: NoteCandidate, kind: EvidenceKind) {
  if (kind === 'checklist') return '考前检查';
  if (kind === 'self_test') return '写完作文后';
  if (kind === 'vocab') return '改表达时';
  if (kind === 'opinion') return '看到题目没观点时';
  if (kind === 'rewrite') return '背完范文后';
  if (candidate.pain_cluster.id === 'pain_no_exam_priority') return '考前冲刺';
  return '练作文时';
}

function baseTags(extra: string[]) {
  return ['#法语学习', '#DELF B2', '#法语写作', '#法语作文', ...extra].slice(0, 8);
}
