/* eslint-disable no-console */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';

const bridgeDir = process.env.AI_BRIDGE_DIR || path.join(process.cwd(), 'tmp-ai-bridge');
const startedAt = Date.now() - 3000;
const seen = new Set();

const delfFacts = [
  ['正式信', '先写清身份和目的', 'Je vous ecris afin de vous faire part de mon avis.'],
  ['建议信', '建议后面补原因', 'Il serait utile de proposer une solution concrete.'],
  ['论坛投稿', '先表明自己的立场', 'A mon avis, cette mesure est necessaire.'],
  ['投诉信', '描述事实再提出要求', 'Je vous prie de bien vouloir examiner ma demande.'],
  ['观点句', '别只写 je pense que', 'Il me semble que cette solution est raisonnable.'],
  ['解释句', '原因要接得自然', 'Cela s explique par le manque de temps.'],
  ['例子句', '例子落到具体场景', 'Par exemple, les etudiants peuvent travailler en groupe.'],
  ['让步句', '承认另一面再转回', 'Certes, cette idee presente aussi des limites.'],
  ['转折句', '别全篇只用 mais', 'Cependant, il faut aussi tenir compte du cout.'],
  ['总结句', '结尾扣回主题', 'Pour conclure, cette approche reste la plus efficace.'],
  ['称呼结尾', 'tu/vous 保持一致', 'Madame, Monsieur'],
  ['字数范围', '230-280 字先稳住', '230-280 mots'],
  ['连接表达', '每段只承担一个作用', 'En effet'],
  ['时态选择', '叙述经历别乱跳', 'passe compose / imparfait'],
  ['配合检查', '名词形容词一起检查', 'accord'],
  ['拼写检查', '考前最后扫一遍', 'orthographe'],
  ['主题词', '教育/工作/环保先备', 'education, travail, environnement'],
  ['观点库', '先拿立场再写段落', 'argument'],
  ['范文库', '拆结构别整篇硬背', 'modele'],
  ['检查清单', '写完按项排雷', 'checklist'],
];

const tefFacts = [
  ['考试选择', '先分清 TEF 和 TCF', 'TEF ou TCF'],
  ['CLB7', '目标先换算清楚', 'NCLC 7'],
  ['口语任务', '先答观点再补理由', 'expression orale'],
  ['写作任务', '结构比长句更重要', 'production ecrite'],
  ['听力输入', '每天保持短时输入', 'comprehension orale'],
  ['场景词汇', '按移民场景背', 'vocabulaire'],
  ['模板句', '开头结尾先固定', 'formule utile'],
  ['自测表', '先知道差在哪', 'auto-test'],
  ['30天计划', '每天2小时拆任务', '30 jours'],
  ['报名流程', '别到考前才查', 'inscription'],
  ['真题主题', '高频话题优先练', 'sujets frequents'],
  ['口语卡顿', '先练展开顺序', 'developper'],
  ['写作升级', '把短句接成段', 'connecteurs'],
  ['错题复盘', '错因比答案更重要', 'erreurs'],
  ['备考故事', '照着路线少试错', 'experience'],
  ['考场当天', '流程提前过一遍', 'jour J'],
];

const cardProfiles = {
  resource_01_grammar_parchment_red: { family: 'directory', title: 'B2写作考前速查表', subtitle: '5组核心内容一页看清' },
  resource_02_grammar_white_green: { family: 'directory', title: 'B2写作资料别乱背', subtitle: '先按这张表查漏' },
  resource_05_grammar_clean_purple: { family: 'directory', title: 'B2写作高分句型表', subtitle: '能替换的先收藏' },
  resource_15_grammar_grid_purple: { family: 'directory', title: 'B2写作知识体系图', subtitle: '格式/结构/表达/检查' },
  resource_06_notes_course_offer: { family: 'memo', title: '格式分老丢的人看这里', subtitle: '别让称呼和结尾拖后腿' },
  resource_10_plain_text_experience: { family: 'experience', title: '写作一直没起色的人', subtitle: '先别急着背新范文' },
  resource_04_chalkboard_phrase_list: { family: 'phrase', title: 'B2写作先背这几组', subtitle: '比散背模板更能上考场' },
  resource_03_chalkboard_course: { family: 'chalkboard', title: '写作别再平均用力', subtitle: '先补最容易丢分的地方' },
  resource_07_question_words_parchment: { family: 'flashcard', title: '这些法语词别用错', subtitle: '写作里很容易混' },
  resource_09_notebook_warning: { family: 'notebook', title: '写作像A2的人先看', subtitle: '问题可能不在背得少' },
  resource_11_delf_doc_analysis: { family: 'document', title: 'B2素材这样拆才有用', subtitle: '别整篇范文硬背' },
};

const seedTitleMap = [
  [/coarse|module|模块|全景|地图/i, 'DELF写作模块全景图'],
  [/20|整句|组合|替换/i, 'B2写作20条整句模板'],
  [/phrase|高频|万能句|句型/i, 'B2高频表达万能句'],
  [/tense|时态|过去/i, 'B2写作时态选择表'],
  [/first|第一句|开头|落笔/i, 'B2写作第一句憋不出'],
  [/rescue|救命|空白|应急/i, 'B2写作空白救命题'],
  [/mock|模考|实考|自评|翻车/i, 'B2模考翻车自评表'],
  [/mistake|错题|错句|错误/i, 'B2写作错题集改法'],
];

function facts(productId) {
  return String(productId).includes('tef') ? tefFacts : delfFacts;
}

function productName(productId) {
  return String(productId).includes('tef') ? 'TEF/TCF Canada法语' : 'DELF B2写作';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  await fs.mkdir(bridgeDir, { recursive: true });
  console.log(`[bridge-smart] watching ${bridgeDir}`);
  while (true) {
    await respondOnce();
    await sleep(500);
  }
}

async function respondOnce() {
  const files = await fs.readdir(bridgeDir).catch(() => []);
  for (const file of files) {
    if (!/^req-\d+-\d+\.json$/.test(file)) continue;
    const full = path.join(bridgeDir, file);
    const resp = full.replace(/\.json$/, '.resp.json');
    const err = full.replace(/\.json$/, '.error.json');
    if (seen.has(file) || fss.existsSync(resp) || fss.existsSync(err)) continue;
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || stat.mtimeMs < startedAt) continue;
    seen.add(file);
    try {
      const req = JSON.parse(await fs.readFile(full, 'utf8'));
      const payload = parseUserPayload(req);
      const answer = buildAnswer(payload);
      await fs.writeFile(resp, JSON.stringify(answer, null, 2), 'utf8');
      console.log(`[bridge-smart] ${file} -> ${answer.__stage || 'unknown'}`);
    } catch (error) {
      await fs.writeFile(err, String(error?.stack || error), 'utf8');
      console.error(`[bridge-smart] failed ${file}:`, error?.message || error);
    }
  }
}

function parseUserPayload(req) {
  const messages = Array.isArray(req.messages) ? req.messages : [];
  const msg = [...messages].reverse().find(item => item?.role === 'user');
  if (!msg || typeof msg.content !== 'string') return {};
  try {
    return JSON.parse(msg.content);
  } catch {
    const match = msg.content.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : {};
  }
}

function buildAnswer(data) {
  if (data?.locked_seed_cards) return stage('topic', buildTopics(data));
  if (data?.output_schema?.cover && (data?.output_schema?.brief || data?.output_schema?.title_candidates)) return stage('core', buildCore(data));
  if (data?.locked_cover && (data?.output_schema?.inner_pages || data?.required_output?.inner_pages)) return stage(data?.failed_checks ? 'repair' : 'editorial', buildEditorial(data));
  if (data?.output_schema?.approved) return stage('audit', buildAudit());
  return stage('fallback-audit', buildAudit());
}

function stage(name, value) {
  Object.defineProperty(value, '__stage', { value: name, enumerable: false });
  return value;
}

function buildTopics(data) {
  const productId = data.product_id || 'delf_b2_writing';
  const cards = data.locked_seed_cards || [];
  const searchTerms = Array.isArray(data.search_terms) ? data.search_terms : [];
  const topics = cards.map((card, index) => {
    const cardId = card.reference_card_id || card.card_id || card.id || data.reference_card_id;
    const profile = cardProfiles[cardId] || cardProfiles.resource_01_grammar_parchment_red;
    const broad = index % 3 !== 2;
    const search = searchTerms[index % Math.max(1, searchTerms.length)] || productName(productId);
    const core = String(productId).includes('tef') ? 'TEF/TCF备考' : 'DELF B2写作';
    return {
      id: `bridge_topic_${cardId}_${index + 1}`,
      seed_id: card.seed_id || `bridge_seed_${index + 1}`,
      reference_card_id: cardId,
      topic_type: broad ? 'selling_point' : 'knowledge',
      scope_level: broad ? 'broad' : 'narrow',
      topic: broad ? `${core}${profile.title}` : `${core}${facts(productId)[index % facts(productId).length][0]}怎么用`,
      audience: String(productId).includes('tef') ? '准备加拿大移民法语考试的人' : '正在备考DELF B2写作的人',
      scene: broad ? '考前整理资料和查漏补缺' : '练完一篇后不知道怎么复盘',
      pain: broad ? `${search}搜了很多，真正能直接用的资料还是太散` : '细节知道一点，但写到作文里容易乱',
      content_promise: broad ? `把${profile.title}整理成能一眼扫的清单` : '用一个具体例子把用法讲明白',
      product_bridge: String(productId).includes('tef') ? '资料包里有计划、词汇、写作和口语素材' : '知识库里有范文、句型、词汇、观点和检查清单',
      why_this_reference_fits: `${profile.family}模板适合这个选题`,
      novelty: '换成本篇自己的法语备考内容，不照抄参考图文字',
      search_terms: [search, core],
      content_source_plan: { knowledge_base: '短条目上封面，长解释进内页', ai_original: '只补充通用备考建议，法语例句要自洽' },
      content_shape: profile.family,
      anchor_fact_ids: [],
      dynamic_fact_terms: inferAnchors(card.seed_id || '', profile),
      ai_original_scope: '可补充通用备考建议，不能冒充官方或真实成绩',
      title_trigger_types: ['资料', '情绪', '结果'],
      page_plan: ['封面先给短条目', '内页解释怎么用', '正文承接资料包'],
    };
  });
  return { topics };
}

function inferAnchors(seedId, profile) {
  const text = `${seedId} ${profile.title} ${profile.subtitle}`;
  if (/coarse|module|模块|体系|全景|地图/i.test(text)) return ['全景', '模块', '地图'];
  if (/20|整句|组合|替换/i.test(text)) return ['20条', '整句', '替换'];
  if (/phrase|句型|表达|万能/i.test(text)) return ['高频表达', '万能句'];
  if (/tense|时态/i.test(text)) return ['时态选择', '复合过去时'];
  if (/first|开头|第一句/i.test(text)) return ['第一句', '开头'];
  if (/rescue|救命|应急/i.test(text)) return ['救命', '应急'];
  if (/mock|模考|自评|翻车/i.test(text)) return ['模考', '自评'];
  if (/mistake|错题|错误|错句/i.test(text)) return ['错题集', '错句改法'];
  return [profile.title.replace(/[，,].*$/, '').slice(0, 8)];
}

function buildCore(data) {
  const topic = data.confirmed_topic || data.locked_brief || {};
  const productId = data.product_id || topic.product_id || 'delf_b2_writing';
  const cardId = data.reference_card_id || topic.reference_card_id || data.competitor_creative_card?.id || 'resource_01_grammar_parchment_red';
  const profile = cardProfiles[cardId] || cardProfiles.resource_01_grammar_parchment_red;
  const selectedTitle = titleForTopic(productId, topic, profile);
  const cover = buildCover(productId, cardId, coverTitleFor(productId, topic, profile));
  const candidates = titleCandidates(productId, selectedTitle, topic, profile);
  return {
    brief: {
      product_id: productId,
      reference_card_id: cardId,
      topic: topic.topic || selectedTitle,
      audience: topic.audience || '正在备考法语B2的人',
      scene: topic.scene || '考前查漏补缺',
      pain: topic.pain || '资料很多但不知道先看什么',
      content_value: topic.content_promise || '把重点整理成可直接查的短表',
      content_shape: profile.family,
      selling_point: topic.product_bridge || `${productName(productId)}资料已经按模块整理`,
      buying_reason: '省掉到处找资料和反复整理的时间',
      product_claim_limit: '可以写资料好用和节省时间，不冒充官方或真实经历',
      knowledge_base_plan: '封面只放短条目，内页放解释和例子',
      ai_original_plan: '补充通用学习建议，保证法语例句和释义准确',
      cover_requirement: `${profile.title}，标题清楚，信息密度够`,
      difference_from_recent: '换主题、换标题角度、换封面条目',
      seed_id: topic.seed_id || 'bridge_seed',
      page_plan: ['先讲为什么要看', '再给具体例子', '最后承接资料包'],
      public_source_policy: '可写通用备考常识，法语例句需自洽',
    },
    title_candidates: candidates,
    selected_title: candidates[0].title,
    cover,
  };
}

function titleForTopic(productId, topic, profile) {
  const text = `${topic.seed_id || ''} ${topic.topic || ''} ${(topic.dynamic_fact_terms || []).join(' ')} ${profile.title}`;
  for (const [pattern, title] of seedTitleMap) {
    if (pattern.test(text)) return title;
  }
  if (String(productId).includes('tef')) {
    if (/口语/.test(text)) return 'TEF口语卡顿先练展开';
    if (/写作/.test(text)) return 'TEF写作别先堆长句';
    return 'TEF备考资料先看这份';
  }
  if (profile.family === 'memo') return '格式分老丢的人先看';
  if (profile.family === 'experience') return 'B2写作没起色先停下';
  if (profile.family === 'phrase') return 'B2写作先背这几组';
  if (profile.family === 'flashcard') return '这些法语词别用错';
  if (profile.family === 'notebook') return 'B2写作像A2先看';
  if (profile.family === 'document') return 'B2素材这样拆才有用';
  return 'DELF写作考前速查表';
}

function coverTitleFor(productId, topic, profile) {
  const base = String(productId).includes('tef') ? 'TEF/TCF' : 'DELF B2';
  if (profile.family === 'directory') return `${base}${profile.title.replace(/^B2|^DELF B2/, '')}`;
  if (profile.family === 'memo') return String(productId).includes('tef') ? '报名和备考别到考前才查' : '格式分老丢的人先看这里';
  if (profile.family === 'experience') return String(productId).includes('tef') ? '备考越急越别乱换资料' : '写作没起色先停下来';
  if (profile.family === 'phrase') return String(productId).includes('tef') ? '口语展开先背这几组' : 'B2写作先背这几组';
  if (profile.family === 'chalkboard') return String(productId).includes('tef') ? '口语卡壳别再硬背答案' : '写作别再平均用力';
  if (profile.family === 'flashcard') return String(productId).includes('tef') ? 'TEF/TCF这些词别混' : 'B2写作这些词别用错';
  if (profile.family === 'notebook') return String(productId).includes('tef') ? '口语总说不长先看' : '写作像A2的人先看';
  if (profile.family === 'document') return String(productId).includes('tef') ? 'TEF素材这样拆才有用' : 'B2素材这样拆才有用';
  return profile.title;
}

function titleCandidates(productId, selectedTitle, topic, profile) {
  const base = String(productId).includes('tef') ? 'TEF/TCF' : 'DELF B2写作';
  const anchors = (topic.dynamic_fact_terms || inferAnchors(topic.seed_id || '', profile)).slice(0, 2).join('');
  return [
    { title: selectedTitle, trigger_type: '资料型', formula_id: 'bridge_anchor_1', reason: '带选题锚点，和封面内容一致' },
    { title: `${base}${anchors}别散着看`, trigger_type: '反常识', formula_id: 'bridge_anchor_2', reason: '用反常识提高点击欲' },
    { title: `${base}考前7天先查${anchors || '这页'}`, trigger_type: '结果型', formula_id: 'bridge_anchor_3', reason: '给场景和行动' },
  ].map(item => ({ ...item, title: item.title.slice(0, 24) }));
}

function buildCover(productId, cardId, title) {
  const profile = cardProfiles[cardId] || cardProfiles.resource_01_grammar_parchment_red;
  if (profile.family === 'phrase') return phraseCover(productId, title, profile.subtitle);
  if (profile.family === 'flashcard') return flashcardCover(productId, title, profile.subtitle);
  if (profile.family === 'experience') return experienceCover(productId, title, profile.subtitle);
  if (profile.family === 'document') return documentCover(productId, title, profile.subtitle);
  if (profile.family === 'notebook') return notebookCover(productId, title, profile.subtitle);
  if (profile.family === 'memo') return memoCover(productId, title, profile.subtitle);
  return directoryCover(productId, title, profile.subtitle);
}

function directoryCover(productId, title, subtitle) {
  const source = facts(productId);
  const headings = String(productId).includes('tef')
    ? ['一、考试选择', '二、口语展开', '三、写作结构', '四、词汇场景', '五、30天安排']
    : ['一、任务与格式', '二、段落结构', '三、连接表达', '四、常见扣分', '五、考前检查'];
  return {
    kind: 'dense_directory_cover',
    title,
    subtitle,
    sections: headings.map((heading, i) => ({
      side_label: `第${i + 1}组`,
      heading,
      columns: i === 1 ? 5 : 2,
      items: Array.from({ length: 5 }, (_, j) => {
        const row = source[(i * 4 + j) % source.length];
        return { primary: row[0], secondary: row[1], note: row[2], source_type: 'knowledge_base', source_ids: [] };
      }),
      source_type: 'knowledge_base',
      source_ids: [],
    })),
  };
}

function phraseCover(productId, title, subtitle) {
  const rows = String(productId).includes('tef')
    ? [['exprimer mon opinion', '表达观点'], ['donner un exemple', '举例展开'], ['a mon avis', '在我看来'], ['parce que', '因为'], ['par exemple', '例如'], ['en conclusion', '总结'], ['je prefere', '我更倾向'], ['il est important de', '重要的是'], ['tout d abord', '首先'], ['ensuite', '然后'], ['en revanche', '相反'], ['cela depend de', '这取决于'], ['dans mon cas', '就我而言'], ['le plus difficile', '最难的是'], ['je voudrais ajouter', '我想补充'], ['pour finir', '最后']]
    : [['Il me semble que', '我认为'], ['A mon avis', '在我看来'], ['Cela s explique par', '原因是'], ['Par exemple', '例如'], ['Certes', '诚然'], ['Cependant', '然而'], ['Pour conclure', '总结'], ['Je vous prie de', '请您'], ['En effet', '事实上'], ['De plus', '此外'], ['Pourtant', '然而'], ['Il faut souligner que', '需要强调'], ['Autrement dit', '换句话说'], ['Dans ce cas', '在这种情况下'], ['Il serait utile de', '会有帮助'], ['Je reste convaincu que', '我仍认为']]
  return {
    kind: 'phrase_list_cover',
    title,
    subtitle,
    sections: [
      { side_label: '表达', heading: '观点和解释', columns: 2, items: rows.slice(0, 8).map(pairItem), source_type: 'ai_derived', source_ids: [] },
      { side_label: '衔接', heading: '举例和结尾', columns: 2, items: rows.slice(8, 16).map(pairItem), source_type: 'ai_derived', source_ids: [] },
    ],
  };
}

function pairItem([primary, secondary]) {
  return { primary, secondary, note: '可直接替换到句子里', source_type: 'ai_derived', source_ids: [] };
}

function flashcardCover(productId, title, subtitle) {
  const rows = String(productId).includes('tef')
    ? [['pourquoi', '为什么', '解释理由'], ['comment', '怎么做', '说明方法'], ['combien', '多少', '说数量'], ['quand', '什么时候', '说时间'], ['quel', '哪个', '限定对象'], ['ou', '哪里', '说地点'], ['qui', '谁', '说人物'], ['que', '什么', '说对象'], ['combien de temps', '多久', '说时长']]
    : [['qui', '谁', '主语/人'], ['que', '什么', '宾语/事'], ['quand', '什么时候', '时间'], ['ou', '哪里', '地点'], ['pourquoi', '为什么', '原因'], ['comment', '怎么', '方式'], ['combien', '多少', '数量'], ['quel', '哪个', '限定'], ['d ou', '从哪里', '来源']];
  return {
    kind: 'flashcard_cover',
    title,
    subtitle,
    sections: [
      { side_label: '一', heading: '人和事', columns: 3, items: rows.slice(0, 3).map(([primary, secondary, note]) => ({ primary, secondary, note, source_type: 'ai_derived', source_ids: [] })), source_type: 'ai_derived', source_ids: [] },
      { side_label: '二', heading: '时间地点', columns: 3, items: rows.slice(3, 6).map(([primary, secondary, note]) => ({ primary, secondary, note, source_type: 'ai_derived', source_ids: [] })), source_type: 'ai_derived', source_ids: [] },
      { side_label: '三', heading: '数量限定', columns: 3, items: rows.slice(6, 9).map(([primary, secondary, note]) => ({ primary, secondary, note, source_type: 'ai_derived', source_ids: [] })), source_type: 'ai_derived', source_ids: [] },
    ],
  };
}

function experienceCover(productId, title, subtitle) {
  const isTef = String(productId).includes('tef');
  return {
    kind: 'plain_experience_cover',
    title,
    subtitle,
    sections: [
      {
        side_label: '复盘',
        heading: '先停下来判断问题',
        columns: 1,
        items: [
          { primary: isTef ? '很多人备考到后面越来越急，其实不是资料不够，而是没有先分清自己最拖分的是口语展开和写作结构' : '很多人写作练到后面越来越急，其实不是范文背得少，而是没有先分清自己卡在格式还是结构', secondary: '先判断问题再决定今天练什么这一步不做后面很容易越练越散也很难知道资料到底有没有用起来', note: '', source_type: 'ai_derived', source_ids: [] },
          { primary: isTef ? '如果每天都换资料短期会觉得很努力但真正上考场时还是容易说不长也写不稳' : '如果每次都从头背新范文短期会觉得很努力但真正写作文时还是不知道怎么迁移', secondary: '资料要被使用不只是收藏先把一套结构练熟比囤新资料更重要也更容易发现重复错误', note: '', source_type: 'ai_derived', source_ids: [] },
        ],
        source_type: 'ai_derived',
        source_ids: [],
      },
      {
        side_label: '建议',
        heading: '按一条线往下练',
        columns: 1,
        items: [
          { primary: isTef ? '建议先用一张表把考试选择目标等级每天任务和高频话题串起来再把口语和写作分开练' : '建议先用一张表把格式结构连接词和检查项串起来再把每篇作文按同一套顺序复盘', secondary: '每天只补一块反馈会更清楚也能减少反复换资料的焦虑感不用一上来就全部重学', note: '', source_type: 'ai_derived', source_ids: [] },
          { primary: isTef ? '后面再补具体表达效率会比一口气囤很多资料更稳先建框架再填内容' : '后面再补句型和词汇效率会比一口气背很多范文更稳先建框架再填内容', secondary: '知识库和资料包才会真的被用起来不然再好的资料也只是多一个收藏夹里的文件', note: '', source_type: 'ai_derived', source_ids: [] },
        ],
        source_type: 'ai_derived',
        source_ids: [],
      },
    ],
  };
}

function documentCover(productId, title, subtitle) {
  const isTef = String(productId).includes('tef');
  const rows = isTef
    ? [['Je voudrais expliquer mon choix en trois points.', '把选择拆成三点说明', '适合口语展开'], ['Cette experience m a permis de mieux comprendre le probleme.', '用经历引出观点', '适合个人例子'], ['Il faut tenir compte du temps disponible.', '说明时间限制', '适合规划类题']]
    : [['Il me semble que cette mesure est raisonnable.', '表达立场', '比 je pense que 更稳'], ['Cela s explique par le manque de temps.', '解释原因', '原因段可迁移'], ['Pour conclure, cette solution reste efficace.', '总结观点', '结尾回扣主题']];
  return {
    kind: 'document_analysis_cover',
    title,
    subtitle,
    sections: [
      { side_label: '原句', heading: '素材原句怎么拆', columns: 1, items: rows.map(([primary, secondary, note]) => ({ primary, secondary, note, source_type: 'ai_derived', source_ids: [] })), source_type: 'ai_derived', source_ids: [] },
      { side_label: '迁移', heading: '能放进作文的地方', columns: 1, items: rows.map(([primary, secondary, note]) => ({ primary: note, secondary, note: primary, source_type: 'ai_derived', source_ids: [] })), source_type: 'ai_derived', source_ids: [] },
    ],
  };
}

function notebookCover(productId, title, subtitle) {
  const isTef = String(productId).includes('tef');
  return {
    kind: 'notebook_big_words_cover',
    title,
    subtitle,
    sections: [
      { side_label: '提醒', heading: '别急着换资料', columns: 1, items: [{ primary: isTef ? '口语说不长' : '写作总像A2', secondary: '先别急着背新东西', note: '', source_type: 'ai_derived', source_ids: [] }], source_type: 'ai_derived', source_ids: [] },
      { side_label: '判断', heading: '先找真正卡点', columns: 1, items: [{ primary: isTef ? '可能是不会展开' : '可能是结构没搭好', secondary: '不是单词越多越好', note: '', source_type: 'ai_derived', source_ids: [] }], source_type: 'ai_derived', source_ids: [] },
      { side_label: '行动', heading: '今天只补一块', columns: 1, items: [{ primary: isTef ? '先练观点理由例子' : '先检查格式和段落', secondary: '练完再回资料表', note: '', source_type: 'ai_derived', source_ids: [] }], source_type: 'ai_derived', source_ids: [] },
    ],
  };
}

function memoCover(productId, title, subtitle) {
  const isTef = String(productId).includes('tef');
  return {
    kind: 'memo_offer_cover',
    title,
    subtitle,
    sections: [
      { side_label: '先看', heading: isTef ? '考试选择' : '格式任务', columns: 1, items: [{ primary: isTef ? 'TEF/TCF先分清' : '正式信/论坛/建议信先分清', secondary: isTef ? '别到报名时才查' : '别把称呼和结尾写混', note: '', source_type: 'knowledge_base', source_ids: [] }, { primary: isTef ? '目标换算CLB7' : '题目要求先圈出', secondary: isTef ? '分数目标别凭感觉' : '别写偏任务类型', note: '', source_type: 'knowledge_base', source_ids: [] }], source_type: 'knowledge_base', source_ids: [] },
      { side_label: '再练', heading: isTef ? '口语写作' : '段落结构', columns: 1, items: [{ primary: isTef ? '口语按观点-理由-例子' : '观点-解释-例子-让步-总结', secondary: '按顺序复盘更快', note: '', source_type: 'knowledge_base', source_ids: [] }, { primary: isTef ? '写作用短句接段' : '每段只做一件事', secondary: '不要堆复杂句', note: '', source_type: 'knowledge_base', source_ids: [] }], source_type: 'knowledge_base', source_ids: [] },
      { side_label: '补漏', heading: isTef ? '词汇主题' : '表达替换', columns: 1, items: [{ primary: isTef ? '移民/工作/生活' : '别只写je pense que', secondary: '按场景整理', note: '', source_type: 'knowledge_base', source_ids: [] }, { primary: isTef ? '高频话题优先练' : '连接词按作用背', secondary: '别平均用力', note: '', source_type: 'knowledge_base', source_ids: [] }], source_type: 'knowledge_base', source_ids: [] },
      { side_label: '最后', heading: isTef ? '考前速查' : '考前检查', columns: 1, items: [{ primary: isTef ? '流程/错题/高频词' : 'tu/vous/复数/连接词/字数', secondary: '最后5分钟只查这些', note: '', source_type: 'knowledge_base', source_ids: [] }, { primary: isTef ? '口语展开顺序' : '格式和结尾再扫', secondary: '别临场重学', note: '', source_type: 'knowledge_base', source_ids: [] }], source_type: 'knowledge_base', source_ids: [] },
    ],
  };
}

function buildEditorial(data) {
  const brief = data.locked_brief || {};
  const productId = brief.product_id || 'delf_b2_writing';
  const isTef = String(productId).includes('tef');
  const keyword = isTef ? 'TEF/TCF Canada法语' : 'DELF B2写作';
  return {
    inner_pages: [
      page(2, isTef ? '先看你卡在哪一块' : '先看作文卡在哪一块', [
        isTef ? '口语说不长，先练观点、理由、例子、回扣。' : '正式信先稳称呼、目的和结尾，别把格式分送掉。',
        isTef ? '写作没结构，先固定开头、两段理由和结尾。' : '论坛投稿先表态，再用理由和例子撑住观点。',
        isTef ? '词汇记不住，按工作、生活、移民场景分组。' : '观点句不要只写 je pense que，可以换成 Il me semble que。',
        isTef ? '计划很乱，按每天2小时拆成小块。' : '写完最后5分钟查 tu/vous、复数、连接词和字数。',
      ]),
      page(3, isTef ? '一个回答怎么展开' : '一个句子怎么写得更稳', [
        isTef ? 'Je prefere vivre en ville, parce que les services sont plus proches.' : 'Je pense que 可以换成 Il me semble que，语气更稳。',
        isTef ? '再补一个短例子，不要讲成长故事。' : '原因句可以用 Cela s explique par...，逻辑更清楚。',
        isTef ? '最后用 donc 回扣问题，答案会更完整。' : '转折不要只靠 mais，可以用 cependant 或 pourtant。',
        isTef ? '每个话题先准备2个理由和1个例子。' : '结尾用 Pour conclure，再回到题目要求。',
      ]),
      page(4, isTef ? '这些练法很耗时间' : '这些扣分点最常见', [
        isTef ? '只背完整答案，换个题就说不出来。' : '称呼写 tu，正文又切到 vous。',
        isTef ? '只刷听力，不复盘错在哪。' : '每段没有空行，结构看起来一整坨。',
        isTef ? '单词背很多，但没有按场景调用。' : '例子太空，和观点没有直接关系。',
        isTef ? '计划写得满，真正每天坚持不了。' : '连接词堆太多，句子关系反而不清楚。',
      ]),
      page(5, isTef ? '资料包适合这样用' : '知识库适合这样用', [
        isTef ? '先用自测页确定目标和差距。' : '先看使用路径，确定自己要补范文、句型还是检查。',
        isTef ? '再按30天计划拆每天任务。' : '练一篇作文后，对照检查清单改一遍。',
        isTef ? '口语和写作素材按场景反复调用。' : '卡表达时，去句型库和词汇库找替换。',
        isTef ? '考前只翻速查和错题，不重新开新坑。' : '考前只翻速查和错题对照，别再乱找新资料。',
      ]),
    ],
    caption: captionFor(productId, keyword),
    tags: tagsFor(productId),
  };
}

function page(page_no, page_title, bullets) {
  return { page_no, page_type: 'knowledge_list', page_title, lead: bullets[0], bullets, source_ids: [], style_variant: 'list' };
}

function captionFor(productId, keyword) {
  if (String(productId).includes('tef')) {
    return `${keyword}备考最怕一上来就平均用力。口语、写作、词汇、计划都想抓，最后每天都很忙，但真正上考场还是说不长、写不稳。建议先分清当前最拖分的一块：口语卡顿就练观点、理由、例子、回扣；写作混乱就先固定结构；词汇记不住就按工作、生活、移民场景背。资料包的价值不是让你再囤一堆文件，而是帮你把选择、自测、句型、词汇、真题主题和30天安排放到一条线上。先测差距，再按计划练，最后只翻速查和错题。适合已经开始准备、但不知道怎么排顺序的人先收藏。你不用一次把所有材料啃完，先把最影响分数的那一块练顺，后面会省很多时间。#TEFCanada #TCFCanada #法语备考 #加拿大移民法语 #法语口语 #法语写作`;
  }
  return `${keyword}备考到后面，很多人手里有范文、有句型、有词汇，但真正写作文时还是不知道先看哪一份。可以先把写作拆成几块：任务格式、段落结构、连接表达、常见扣分点、考前检查。正式信先稳称呼和目的，论坛投稿先稳立场，建议信先把建议和理由接住。写完以后再查 tu/vous、复数、连接词和字数。别把所有资料摊开一起看，先按这张表的顺序过一遍，哪里最容易错就先补哪里。适合考前想快速查漏、也适合平时每练完一篇就复盘。你不用一次背完所有范文，先把最容易丢分的地方补上，后面再补句型和词汇会更稳。#DELFB2写作 #法语B2写作 #法语写作 #写作模板 #写作范文 #备考资料`;
}

function tagsFor(productId) {
  return String(productId).includes('tef')
    ? ['#TEFCanada', '#TCFCanada', '#法语备考', '#法语口语', '#法语写作', '#加拿大移民法语']
    : ['#DELFB2写作', '#法语B2写作', '#法语写作', '#写作模板', '#写作范文', '#备考资料'];
}

function buildAudit() {
  return { approved: true, issues: [], cover_corrections: [], page_corrections: [], corrected_caption: '' };
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
