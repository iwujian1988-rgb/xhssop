import { callOpenAICompatibleJson } from './ai-client';
import { buildCoverMaterial } from './cover-material-adapter';
import { formatCoverTitle, type SampleNote } from './sample-note-generator';

interface AiTitleCandidate {
  note_title?: unknown;
  cover_lines?: unknown;
  hook_reason?: unknown;
}

interface AiTitleGroup {
  sample_id?: unknown;
  candidates?: unknown;
}

const BANNED = [
  /不是.{0,12}而是/,
  /的人[，,]?/,
  /按\d+类用/,
  /在哪一档/,
  /这一档/,
  /这几个小窍门/,
  /干货满满|建议收藏|码住|宝藏资料/,
  /真实短板|立刻见效|一测就|锁定.{0,6}弱项|瓶颈/,
  /马上不一样|直接套|直接上手|扣小分|按这\d+档走|白忙|凑不齐|被说太平|只差这|背了词不会换/,
  /资深考官|官方建议|致命扣分|救分|重灾区|隐藏评分|自救模板|掌握.{0,12}就够了|照搬.{0,8}扣分/,
  /押题/,
];

const DOMAIN = /法语|DELF\s*B2|B2作文|B2写作/i;

export async function refineSampleTitles(samples: SampleNote[]): Promise<SampleNote[]> {
  if (!process.env.OPENAI_API_KEY || samples.length === 0) return samples;

  const raw = await callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是资深小红书法语考试内容运营，只负责重写标题。',
        '输入中的 formula_reference 来自爆款标题公式库。它只代表心理钩子方向，绝不是填空模板，不得照抄其生硬句式。',
        '请站在刷到笔记的真实备考用户角度写：一眼知道在讲法语/DELF B2，能感到具体问题、反差或马上可拿走的收益。',
        '每条生成 5 个真正不同的候选，分别尝试：痛点冲突、具体收益、好奇缺口、反常识、场景急迫。',
        '标题必须口语自然、前后逻辑成立。人群和场景只在能增强点击时自然融入，不许把标签直接拼进标题。',
        '禁止“不是...而是...”、禁止“按3类用”、禁止“先看你在哪一档”、禁止空泛的小窍门/建议收藏/宝藏资料。',
        '禁止“真实短板、立刻见效、一测就知道、锁定弱项、瓶颈”等AI营销腔。',
        '同样禁止“马上不一样、直接套、直接上手、扣小分、按3档走、复习不再白忙、被说太平”等不自然或夸张表达。',
        '只能围绕 evidence、required_topic 和 concrete_content 写，pain 只用于寻找用户语气。不得把“观点卡”偷换成“范文”，不得把“仿写示例”偷换成“词汇表”。',
        '禁止虚构成绩、时间效果、真人经历、权威背书；只能使用 allowed_numbers 里的数字。',
        '硬要求：每一个 note_title 必须自然包含“法语”或“DELF B2”；每一组 cover_lines 合并后也必须包含“法语”或“DELF B2”。不满足就视为废稿。',
        'note_title 14-28 个中文字符左右，标点自然。程序会自动把同一个标题排成封面，不需要你另写封面句子。',
        '坏例子：“法语B2写作：3档路径里，先选对这一档”“法语B2写作怎么 / 练？”“观点卡别硬背，按3类用”。',
        '好标题要像人会点开的具体判断，例如“法语B2议论文总写空？先给观点配个例子”；只学习这种自然程度，不得照抄示例内容。',
        '只输出严格 JSON：{"groups":[{"sample_id":"...","candidates":[{"note_title":"...","hook_reason":"..."}]}]}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        samples: samples.map(sample => ({
          sample_id: sample.id,
          formula_reference: sample.formula_reference || sample.title,
          title_trigger: sample.title_trigger,
          note_format: sample.note_format,
          audience: sample.audience,
          pain: sample.pain,
          selling_point: sample.selling_point,
          evidence: sample.evidence,
          required_topic: signalWords(sample),
          allowed_numbers: extractNumbers(sample),
          concrete_content: sample.pages.slice(2, 5).map(page => ({
            page_title: page.page_title,
            bullets: page.bullets,
          })),
        })),
      }),
    },
  ]);

  const groups = normalizeGroups(raw);
  return samples.map(sample => {
    const group = groups.find(item => String(item.sample_id || '') === sample.id);
    const candidates = Array.isArray(group?.candidates) ? group.candidates as AiTitleCandidate[] : [];
    const normalized = candidates.map(normalizeCandidate);
    const best = normalized
      .filter((item): item is ValidTitle => item !== null)
      .filter(item => validatesAgainstSample(item, sample))
      .sort((a, b) => scoreTitle(b, sample) - scoreTitle(a, sample))[0];

    const titleAlternatives = normalized
      .filter((item): item is ValidTitle => item !== null)
      .map(item => ({ note_title: item.noteTitle, cover_lines: item.coverLines, issues: titleIssues(item, sample) }));

    return best
      ? { ...applyTitle(sample, best), title_alternatives: titleAlternatives }
      : { ...sample, title_alternatives: titleAlternatives };
  });
}

interface ValidTitle {
  noteTitle: string;
  coverLines: string[];
}

function normalizeGroups(value: unknown): AiTitleGroup[] {
  if (!value || typeof value !== 'object') return [];
  const groups = (value as Record<string, unknown>).groups;
  return Array.isArray(groups) ? groups as AiTitleGroup[] : [];
}

function normalizeCandidate(value: AiTitleCandidate): ValidTitle | null {
  const noteTitle = clean(String(value.note_title || ''));
  if (!noteTitle) return null;
  const coverLines = formatCoverTitle(noteTitle).split('\n').filter(Boolean);
  if (coverLines.length < 2 || coverLines.length > 3) return null;
  return { noteTitle, coverLines };
}

function validatesAgainstSample(title: ValidTitle, sample: SampleNote) {
  return titleIssues(title, sample).length === 0;
}

function titleIssues(title: ValidTitle, sample: SampleNote) {
  const issues: string[] = [];
  const compactLength = title.noteTitle.replace(/[\s，。！？：、,.!?:]/g, '').length;
  if (compactLength < 11 || compactLength > 30) issues.push('note_length');
  if (!DOMAIN.test(title.noteTitle)) issues.push('note_domain');
  if (BANNED.some(pattern => pattern.test(title.noteTitle))) issues.push('note_banned');
  if (title.coverLines.some(line => line.length < 3 || line.length > 13)) issues.push('cover_line_length');
  if (title.coverLines.some(line => BANNED.some(pattern => pattern.test(line)))) issues.push('cover_banned');
  const coverText = title.coverLines.join('');
  if (!DOMAIN.test(coverText)) issues.push('cover_domain');
  if (/怎么\s*$/.test(title.coverLines[0]) || /^练[？?]?/.test(title.coverLines[1])) issues.push('split_phrase');
  if (/没思\s*$/.test(title.coverLines[0]) || /^路/.test(title.coverLines[1])) issues.push('split_phrase');
  if (/押题/.test(`${title.noteTitle}${coverText}`)) issues.push('unsafe_claim');
  const allowedNumbers = new Set(['2', ...extractNumbers(sample)]);
  const usedNumbers = `${title.noteTitle}${coverText}`.match(/\d+/g) || [];
  if (usedNumbers.some(value => !allowedNumbers.has(value))) issues.push('invented_number');

  const contentSignals = signalWords(sample);
  if (!contentSignals.some(signal => title.noteTitle.includes(signal) || coverText.includes(signal))) issues.push('content_mismatch');
  if (!topicMatches(title, sample)) issues.push('topic_conflict');
  return issues;
}

function signalWords(sample: SampleNote) {
  const text = `${sample.evidence} ${sample.pages.map(page => `${page.page_title} ${page.bullets.join(' ')}`).join(' ')}`;
  const rules: Array<[RegExp, string[]]> = [
    [/清单|检查|自查/, ['检查', '自查', '交卷', '扣分']],
    [/词汇|表达|替换/, ['词', '表达', '替换', '重复']],
    [/观点|论点|主题/, ['观点', '思路', '主题', '没话写']],
    [/范文|仿写|迁移/, ['范文', '仿写', '迁移', '换题']],
    [/错题|错误|改错/, ['错', '改', '扣分', '问题']],
    [/路径|计划|阶段/, ['练', '复习', '路径', '计划']],
    [/评分|标准|维度/, ['评分', '标准', '扣分']],
  ];
  const matched = rules.flatMap(([pattern, words]) => pattern.test(text) ? words : []);
  return Array.from(new Set([...matched, '写作', '作文']));
}

function extractNumbers(sample: SampleNote) {
  const text = `${sample.evidence} ${sample.pages.slice(2, 5).map(page => `${page.page_title} ${page.bullets.join(' ')}`).join(' ')}`;
  return Array.from(new Set(text.match(/\d+/g) || []));
}

function topicMatches(title: ValidTitle, sample: SampleNote) {
  const output = `${title.noteTitle}${title.coverLines.join('')}`;
  const evidence = sample.evidence;
  if (/观点|论点|主题/.test(evidence)) return /观点|思路|主题|没话写/.test(output) && !/范文|词汇表|错题/.test(output);
  if (/范文|仿写|组合示例|迁移/.test(evidence)) return /范文|仿写|迁移|换题|句子功能/.test(output) && !/观点卡|词汇表/.test(output);
  if (/词汇|表达|词表/.test(evidence)) return /词|表达|替换|重复/.test(output) && !/范文|观点卡/.test(output);
  if (/错题|错误|改错/.test(evidence)) return /错|改|扣分|对照/.test(output);
  if (/清单|检查|自查/.test(evidence)) return /检查|自查|交卷|扣分/.test(output);
  if (/路径|计划|阶段/.test(evidence)) return /练|复习|路径|计划|卡在/.test(output);
  return true;
}

function scoreTitle(title: ValidTitle, sample: SampleNote) {
  const text = title.noteTitle;
  let score = 0;
  if (/[？?]/.test(text)) score += 3;
  if (/别|总|还|只会|用不上|写不完|扣分|换题|交卷/.test(text)) score += 4;
  if (/\d+/.test(text)) score += 2;
  if (signalWords(sample).some(word => text.includes(word))) score += 5;
  if (/错题|错句|对比/.test(sample.evidence) && /错题|错句|对比/.test(text)) score += 5;
  if (/观点/.test(sample.evidence) && /观点|没话写/.test(text)) score += 5;
  if (/范文|仿写|组合示例/.test(sample.evidence) && /范文|仿写|换题/.test(text)) score += 5;
  if (/词汇|表达/.test(sample.evidence) && /词|表达|重复/.test(text)) score += 5;
  if (extractNumbers(sample).some(number => number !== '2' && text.includes(number))) score += 3;
  if (/^法语B2写作[：:,，]/.test(text)) score -= 3;
  if (text.length >= 15 && text.length <= 25) score += 2;
  return score;
}

function applyTitle(sample: SampleNote, title: ValidTitle): SampleNote {
  const coverTitle = title.coverLines.join('\n');
  const pages = sample.pages.map(page => page.page_no === 1 ? { ...page, page_title: coverTitle } : page);
  const caption = replaceCaptionTitle(sample.caption, sample.title, title.noteTitle);
  return {
    ...sample,
    title_source: 'ai',
    title: title.noteTitle,
    cover_title: coverTitle,
    pages,
    caption,
    cover_material: buildCoverMaterial({
      note_format: sample.note_format,
      cover_title: coverTitle,
      cover_subtitle: sample.cover_subtitle,
      evidence: sample.evidence,
      pages,
    }),
  };
}

function replaceCaptionTitle(caption: string, oldTitle: string, newTitle: string) {
  if (caption.startsWith(oldTitle)) return `${newTitle}${caption.slice(oldTitle.length)}`;
  const lines = caption.split('\n');
  lines[0] = newTitle;
  return lines.join('\n');
}

function clean(value: string) {
  return value.replace(/[“”]/g, '').replace(/\s+/g, ' ').trim();
}
