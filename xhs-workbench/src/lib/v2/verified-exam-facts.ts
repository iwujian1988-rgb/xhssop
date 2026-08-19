import type { ProductId } from '@/types/data';
import type { EvidenceSnippet, MigratedTopic } from '@/types/reference-workflow';

const VERIFIED_FACTS: Record<ProductId, EvidenceSnippet[]> = {
  delf_b2_writing: [
    fact('OFF-DELF-WRITE-001', 'DELF B2 写作', 'DELF B2 笔试写作包含 1 道写作题，考试时间 1 小时，至少写 250 词。', '1 exercise; 1 hour; minimum 250 words', 'https://www.france-education-international.fr/diplome/delf-tout-public/niveau-b2'),
    fact('OFF-DELF-WRITE-002', 'DELF B2 写作形式', 'DELF B2 写作要求围绕给定主题表达并论证个人立场，题目可能采用论坛投稿、正式信件、评论文章或报告等形式。', 'Personal argued position; possible forms include forum contribution, formal letter, critical article or report.', 'https://www.france-education-international.fr/document/manuel-candidat-delf-b2'),
    fact('OFF-DELF-WRITE-003', 'DELF B2 写作组织', '官方考生手册建议先分析题目与写作情境，再组织引言、展开和结论，并用具体例子支撑观点。', 'Analyse the prompt and situation; organise introduction, development and conclusion; support ideas with examples.', 'https://www.france-education-international.fr/document/manuel-candidat-delf-b2'),
    fact('OFF-DELF-WRITE-004', 'DELF B2 写作评分维度', 'DELF B2 写作官方评分表包含 5 个维度：完成任务、连贯与衔接、社会语言得体性、词汇、形态句法。每个维度按表现档位评为 0、1、3 或 5 分，并非按错误逐项扣分。', 'Official criteria: réalisation de la tâche; cohérence et cohésion; adéquation sociolinguistique; lexique; morphosyntaxe. Performance levels are scored 0, 1, 3 or 5.', 'https://www.france-education-international.fr/document/grille-pe-b2'),
    fact('OFF-DELF-WRITE-005', 'DELF B2 写作评分说明', '官方评分说明中，0分档表示未作答、内容不足以评价、水平明显低于目标或存在严重异常；1分档表示低于目标水平、整体更接近B1；3分档表示达到B2的最低要求；5分档表示对B2掌握稳健或深入。具体评价仍分别落在完成任务、连贯衔接、语域得体、词汇和形态句法5个维度。', 'Official performance columns: non-response or insufficient production; below target level (closer to B1); at target B2; robust or deeper mastery of B2. Applied across the five criteria.', 'https://www.france-education-international.fr/document/explic-grille-pe-b2'),
  ],
  tef_tcf_canada: [
    fact('OFF-IRCC-FRENCH-001', '加拿大移民法语考试', '加拿大移民、难民及公民部把 TEF Canada 和 TCF Canada 列为认可的法语语言考试；具体项目所需等级应以对应项目的官方要求为准。', 'IRCC lists TEF Canada and TCF Canada among the approved French language tests.', 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents/language-test.html'),
    fact('OFF-TEF-CANADA-001', 'TEF Canada 科目', 'TEF Canada 包含 4 项必考：阅读 40 题 60 分钟、听力 40 题 40 分钟、写作 2 部分 60 分钟、口语 2 部分 15 分钟。', 'Reading: 40 questions/60 min; listening: 40 questions/40 min; writing: 2 sections/60 min; speaking: 2 sections/15 min.', 'https://www.lefrancaisdesaffaires.fr/candidat/test-evaluation-francais/tef-canada/'),
    fact('OFF-TEF-CANADA-002', 'TEF Canada 写作', 'TEF Canada 写作共 2 部分：A 部分续写新闻类文本，至少 80 词；B 部分表达并论证观点，至少 200 词。', 'Section A: continue an article, minimum 80 words; section B: express and justify a point of view, minimum 200 words.', 'https://www.lefrancaisdesaffaires.fr/candidat/test-evaluation-francais/tef-canada/'),
    fact('OFF-TEF-CANADA-003', 'TEF Canada 口语', 'TEF Canada 口语为与考官面对面进行的 2 部分考试，总时长 15 分钟：A 部分 5 分钟，任务是获取信息；B 部分 10 分钟，任务是论证并说服对方。', 'Face-to-face speaking test; section A: obtain information, 5 minutes; section B: argue to persuade, 10 minutes; 15 minutes total.', 'https://www.lefrancaisdesaffaires.fr/candidat/test-evaluation-francais/tef-canada/presentation/'),
    fact('OFF-TCF-CANADA-001', 'TCF Canada 科目', 'TCF Canada 包含 4 项必考：听力 39 题 35 分钟、阅读 39 题 60 分钟、写作 3 道题 60 分钟、口语 3 道题 12 分钟。', 'Listening: 39 questions/35 min; reading: 39 questions/60 min; writing: 3 tasks/60 min; speaking: 3 tasks/12 min.', 'https://www.france-education-international.fr/test/tcf-canada'),
    fact('OFF-TCF-CANADA-002', 'TCF Canada 口语', 'TCF Canada 口语与考官面对面进行，共 3 道题，总时长 12 分钟：第 1 题为无准备的引导式面谈；第 2 题为有 2 分钟准备时间的互动任务；第 3 题为无准备地表达观点。', 'Face-to-face with an examiner; task 1 guided interview without preparation; task 2 interaction with 2 minutes preparation; task 3 express a point of view without preparation; 12 minutes total.', 'https://www.france-education-international.fr/test/tcf-canada'),
    fact('OFF-TCF-CANADA-003', 'TCF Canada 重考间隔', '两次参加 TCF（包括不同版本）之间必须间隔至少 20 天。', 'A minimum waiting period of 20 days applies between two TCF sessions, regardless of version.', 'https://www.france-education-international.fr/test/tcf-canada'),
  ],
  tcf_canada_writing_7day: [
    fact('OFF-TCF-CANADA-001', 'TCF Canada 科目', 'TCF Canada 包含 4 项必考：听力 39 题 35 分钟、阅读 39 题 60 分钟、写作 3 道题 60 分钟、口语 3 道题 12 分钟。', 'Listening: 39 questions/35 min; reading: 39 questions/60 min; writing: 3 tasks/60 min; speaking: 3 tasks/12 min.', 'https://www.france-education-international.fr/test/tcf-canada'),
  ],
};

function fact(id: string, section: string, text: string, evidence: string, url: string): EvidenceSnippet {
  return {
    id,
    category: 'official_exam_fact',
    text,
    evidence,
    source_file: url,
    source_section: section,
    score: 50,
    source_role: 'dynamic',
    usage_caution: '仅可按本条明确内容表述，不得外推新的考试规则、分数换算、报名日期或费用。',
  };
}

export function retrieveVerifiedExamFacts(productId: ProductId, topic: MigratedTopic, limit = 4) {
  const query = normalize([
    topic.topic,
    topic.content_promise,
    topic.pain,
    ...(topic.search_terms || []),
    ...(topic.dynamic_fact_terms || []),
  ].join(' '));
  const mandatoryIds = mandatoryFactIds(productId, query);
  const mandatory = mandatoryIds
    .map(id => VERIFIED_FACTS[productId].find(item => item.id === id))
    .filter((item): item is EvidenceSnippet => Boolean(item));
  const ranked = VERIFIED_FACTS[productId]
    .map(item => ({ item, score: score(item, query) }))
    .filter(entry => entry.score > 0 && !mandatoryIds.includes(entry.item.id))
    .sort((a, b) => b.score - a.score)
    .map(entry => ({ ...entry.item, score: entry.score }));
  return [...mandatory, ...ranked].slice(0, limit);
}

function mandatoryFactIds(productId: ProductId, query: string) {
  if (productId === 'delf_b2_writing') return ['OFF-DELF-WRITE-001'];
  const hasTef = query.includes('tef');
  const hasTcf = query.includes('tcf');
  const ids = ['OFF-IRCC-FRENCH-001'];
  if (hasTef) ids.push('OFF-TEF-CANADA-001');
  if (hasTcf) ids.push('OFF-TCF-CANADA-001');
  if (hasTef && hasTcf) {
    ids.push('OFF-TEF-CANADA-002', 'OFF-TEF-CANADA-003', 'OFF-TCF-CANADA-002');
    return ids;
  }
  if (query.includes('口语')) {
    if (hasTef) ids.push('OFF-TEF-CANADA-003');
    if (hasTcf) ids.push('OFF-TCF-CANADA-002');
  } else if (query.includes('写作') && hasTef) {
    ids.push('OFF-TEF-CANADA-002');
  }
  return ids;
}

export function listVerifiedExamFacts(productId: ProductId) {
  return VERIFIED_FACTS[productId].map(item => ({ ...item }));
}

function score(item: EvidenceSnippet, query: string) {
  const source = normalize(`${item.source_section} ${item.text}`);
  const queryHasTef = query.includes('tef');
  const queryHasTcf = query.includes('tcf');
  if (queryHasTef && !queryHasTcf && source.includes('tcf')) return 0;
  if (queryHasTcf && !queryHasTef && source.includes('tef')) return 0;
  let total = 0;
  const semanticTerms = [
    '评分', '档位', '形式', '题型', '组织', '结构', '字数', '词数',
    '口语', '听力', '阅读', '重考', '间隔', '科目', '选考',
    '获取信息', '说服', '表达观点', '正式信', '论坛', '报告',
  ];
  for (const term of semanticTerms) if (query.includes(term) && source.includes(term)) total += 4 + term.length;
  const identityTokens = new Set(['delf', 'b2', 'tef', 'tcf', 'canada', '法语', '考试', '备考', '写作']);
  for (const token of tokens(query)) {
    if (!identityTokens.has(token) && source.includes(token)) total += Math.min(8, token.length);
  }
  return total;
}

function tokens(value: string) {
  return Array.from(new Set(value.split(/[^\p{L}\p{N}]+/u).map(normalize).filter(item => item.length >= 2)));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, '');
}
