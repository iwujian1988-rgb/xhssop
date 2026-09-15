/* eslint-disable no-console */
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';

const bridgeDir = process.env.AI_BRIDGE_DIR || path.join(process.cwd(), 'tmp-ai-bridge');
const startedAt = Date.now() - 3000;
const seen = new Set();

const delfItems = [
  ['正式信', '先写清身份和目的', 'Je vous ecris'],
  ['建议信', '建议后面补原因', 'Il serait utile de'],
  ['论坛投稿', '先表明自己的立场', 'A mon avis'],
  ['投诉信', '描述事实再提出要求', 'Je vous prie de'],
  ['观点句', '别只写 je pense que', 'Il me semble que'],
  ['解释句', '原因要接得自然', 'cela s explique par'],
  ['例子句', '例子落到具体场景', 'par exemple'],
  ['让步句', '承认另一面再转回', 'certes'],
  ['转折句', '别全篇只用 mais', 'cependant'],
  ['总结句', '结尾扣回主题', 'pour conclure'],
  ['称呼', 'tu/vous 保持一致', 'Madame, Monsieur'],
  ['字数', '230-280 字先稳住', '230-280 mots'],
  ['连接词', '每段只承担一个作用', 'en effet'],
  ['时态', '叙述经历别乱跳', 'passe compose'],
  ['复数', '名词形容词一起检查', 'accord'],
  ['拼写', '考前最后扫一遍', 'orthographe'],
  ['主题词', '教育/工作/环保先备', 'education'],
  ['观点库', '先拿立场再写段落', 'argument'],
  ['范文库', '拆结构别整篇硬背', 'modele'],
  ['检查表', '写完按项排雷', 'checklist'],
];

const tefItems = [
  ['考试选择', '先分清 TEF 和 TCF', 'TEF ou TCF'],
  ['CLB7', '目标先换算清楚', 'NCLC 7'],
  ['口语任务', '先答观点再补理由', 'expression orale'],
  ['写作任务', '结构比长句更重要', 'production ecrite'],
  ['听力', '每天保持输入', 'comprehension orale'],
  ['词汇', '按移民场景背', 'vocabulaire'],
  ['模板句', '开头结尾先固定', 'formule utile'],
  ['自测', '先知道差在哪', 'auto-test'],
  ['30天计划', '每天2小时拆任务', '30 jours'],
  ['报名流程', '别到考前才查', 'inscription'],
  ['真题主题', '高频话题优先练', 'sujets frequents'],
  ['口语卡顿', '先练展开顺序', 'developper'],
  ['写作升级', '把短句接成段', 'connecteurs'],
  ['错题', '错因比答案更重要', 'erreurs'],
  ['备考故事', '照着路线少试错', 'experience'],
  ['考场当天', '流程提前过一遍', 'jour J'],
];

const cardProfiles = {
  resource_01_grammar_parchment_red: { coverMode: '资料型', shape: '目录', titleHint: '考前先查这张表' },
  resource_02_grammar_white_green: { coverMode: '资料型', shape: '语法清单', titleHint: '这张表先收藏' },
  resource_05_grammar_clean_purple: { coverMode: '资料型', shape: '语法资料', titleHint: '别再散着背' },
  resource_15_grammar_grid_purple: { coverMode: '资料型', shape: '体系表', titleHint: '一页看完重点' },
  resource_06_notes_course_offer: { coverMode: '情绪型', shape: '备忘录', titleHint: '别让格式分白丢' },
  resource_10_plain_text_experience: { coverMode: '经验型', shape: '正文经验', titleHint: '先复盘这一步' },
  resource_04_chalkboard_phrase_list: { coverMode: '结果型', shape: '黑板短语表', titleHint: '背这几组就够用' },
  resource_03_chalkboard_course: { coverMode: '情绪型', shape: '黑板大字', titleHint: '别再平均用力' },
  resource_07_question_words_parchment: { coverMode: '解释型', shape: '疑问词卡', titleHint: '别把意思记反了' },
  resource_09_notebook_warning: { coverMode: '痛点型', shape: '手写警告', titleHint: '写不好先看这里' },
  resource_11_delf_doc_analysis: { coverMode: '资料型', shape: '文档解析', titleHint: '范文这样拆才有用' },
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await fs.mkdir(bridgeDir, { recursive: true });
  console.log(`[bridge-auto] watching ${bridgeDir}`);
  while (true) {
    await respondOnce();
    await sleep(700);
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
      const user = parseUserPayload(req);
      const answer = buildAnswer(user);
      await fs.writeFile(resp, JSON.stringify(answer, null, 2), 'utf8');
      console.log(`[bridge-auto] ${file} -> ${answer.__stage || 'unknown'}`);
    } catch (error) {
      await fs.writeFile(err, String(error?.stack || error), 'utf8');
      console.error(`[bridge-auto] failed ${file}:`, error?.message || error);
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
  if (data?.locked_seed_cards) return withStage('topic', buildTopics(data));
  if (data?.output_schema?.cover && (data?.output_schema?.brief || data?.output_schema?.title_candidates)) return withStage('core', buildCore(data));
  if (data?.output_schema?.approved) return withStage('audit', buildAudit());
  if (data?.locked_cover && (data?.output_schema?.inner_pages || data?.required_output?.inner_pages)) {
    return withStage(data?.failed_checks ? 'repair' : 'editorial', buildEditorial(data));
  }
  return withStage('fallback-audit', buildAudit());
}

function withStage(stage, value) {
  Object.defineProperty(value, '__stage', { value: stage, enumerable: false });
  return value;
}

function productName(productId = '') {
  return String(productId).includes('tef') ? 'TEF/TCF Canada法语' : 'DELF B2写作';
}

function sourceItems(productId = '') {
  return String(productId).includes('tef') ? tefItems : delfItems;
}

function buildTopics(data) {
  const productId = data.product_id || 'delf_b2_writing';
  const product = productName(productId);
  const cards = data.locked_seed_cards || [];
  const search = Array.isArray(data.search_terms) ? data.search_terms : [];
  const topics = cards.map((card, index) => {
    const cardId = card.reference_card_id || card.card_id || card.id || data.reference_card_id;
    const profile = cardProfiles[cardId] || { coverMode: '资料型', shape: '资料表', titleHint: '先收藏这张表' };
    const broad = index % 3 !== 2;
    const searchTerm = search[index % Math.max(1, search.length)] || (String(productId).includes('tef') ? '法语B2备考资料' : 'DELF B2写作模板');
    const topic = broad
      ? `${product}${profile.shape}：${profile.titleHint}`
      : `${product}一个细节：${sourceItems(productId)[index % sourceItems(productId).length][0]}怎么用`;
    return {
      id: `topic_${cardId}_${index + 1}`,
      topic,
      audience: String(productId).includes('tef') ? '准备加拿大移民法语考试的人' : '正在备考DELF B2写作的人',
      scene: broad ? '考前整理资料和查漏补缺' : '写完或练完以后不知道怎么复盘',
      pain: broad ? `${searchTerm}搜了一堆，真正能直接用的资料还是散` : '细节知道一点，但写到作文里容易乱',
      content_promise: broad ? `把${profile.shape}整理成能一眼扫的清单` : '用一个具体例子把用法讲明白',
      product_bridge: String(productId).includes('tef') ? 'TEF/TCF资料包里有计划、词汇、写作和口语素材' : 'DELF B2写作知识库里有范文、句型、词汇、观点和检查清单',
      why_this_reference_fits: `${profile.coverMode}适合${profile.shape}，能承接当前选题`,
      novelty: `换成${product}自己的资料结构，不照搬参考图文字`,
      search_terms: [searchTerm, product],
      content_source_plan: ['从本地资料中取短条目上封面', '长解释放到内页和正文'],
      seed_id: card.seed_id || `seed_${index + 1}`,
      content_shape: 'dense_directory',
      anchor_fact_ids: [],
      dynamic_fact_terms: [],
      ai_original_scope: '可以补充通用备考建议，但法语例句和释义必须自洽',
      title_trigger_types: ['资料型', '情绪型', '结果型'],
      page_plan: ['封面给短条目', '内页解释怎么用', '正文承接资料包'],
      reference_card_id: cardId,
    };
  });
  return { topics };
}

function buildCore(data) {
  const topic = data.confirmed_topic || data.locked_brief || {};
  const productId = data.product_id || data.locked_brief?.product_id || topic.product_id || 'delf_b2_writing';
  const cardId = data.reference_card_id || data.competitor_creative_card?.id || data.locked_brief?.reference_card_id || topic.reference_card_id || 'resource_01_grammar_parchment_red';
  const product = productName(productId);
  const profile = cardProfiles[cardId] || { coverMode: '资料型', shape: '资料表', titleHint: '先收藏这张表' };
  const coverTitle = makeCoverTitle(productId, profile);
  const brief = {
    product_id: productId,
    reference_card_id: cardId,
    topic: topic.topic || `${product}${profile.shape}`,
    audience: topic.audience || (String(productId).includes('tef') ? '准备加拿大移民法语考试的人' : '正在备考DELF B2写作的人'),
    scene: topic.scene || '考前查漏补缺',
    pain: topic.pain || '资料很多但不知道先看哪一块',
    content_value: topic.content_promise || '把高频内容整理成能直接查的清单',
    content_shape: 'dense_directory',
    selling_point: topic.product_bridge || `${product}资料包已经按模块整理`,
    buying_reason: '省掉到处找资料和反复整理的时间',
    product_claim_limit: '用具体资料展示价值，不冒充官方资料或真实成绩',
    knowledge_base_plan: '短条目放封面，展开说明放内页',
    ai_original_plan: '补充通用学习建议时保持常识和法语表达准确',
    cover_requirement: `${profile.shape}，信息密度高，标题清楚`,
    difference_from_recent: '换主题词、换标题角度、换封面条目',
    seed_id: topic.seed_id || 'seed_bridge',
    page_plan: ['先解释为什么要看', '再给具体例子', '最后承接资料包'],
    public_source_policy: '可写通用备考常识，法语例句需自洽',
  };
  const candidates = makeTitleCandidates(productId, profile, coverTitle);
  return {
    brief,
    title_candidates: candidates,
    selected_title: candidates[0].title,
    cover: buildCover(productId, cardId, coverTitle),
  };
}

function makeCoverTitle(productId, profile) {
  const isTef = String(productId).includes('tef');
  if (profile.coverMode === '情绪型') return isTef ? 'TEF口语总卡壳的人先看' : 'DELF写作老丢格式分先看';
  if (profile.coverMode === '痛点型') return isTef ? 'TEF口语写不长先看这里' : 'B2写作总写散先看这里';
  if (profile.coverMode === '结果型') return isTef ? 'TEF口语展开先背这几组' : 'B2写作句型先背这几组';
  if (profile.coverMode === '解释型') return isTef ? 'TEF/TCF别先选错考试' : 'B2写作这些词别用错';
  return isTef ? 'TEF/TCF备考资料先收藏' : 'DELF B2写作考前速查';
}

function makeTitleCandidates(productId, profile, coverTitle) {
  const isTef = String(productId).includes('tef');
  const base = isTef ? 'TEF/TCF' : 'DELF B2写作';
  const pool = [
    [`${base}资料别乱找，先看这张表`, '资料型'],
    [`${base}想提分，先补这块`, '结果型'],
    [`${base}总写不好，先查这里`, '情绪型'],
    [`${base}别只背模板，先看结构`, '反常识型'],
    [`${base}考前7天先看这页`, '时效型'],
  ];
  return pool.map(([title, trigger], index) => ({
    title: index === 0 ? trimHumanTitle(coverTitle) : trimHumanTitle(title),
    trigger_type: trigger,
    formula_id: `bridge_${index + 1}`,
    reason: `${profile.coverMode}和${profile.shape}匹配，能让用户知道和自己有关`,
  }));
}

function trimHumanTitle(title) {
  return title.length <= 24 ? title : title.slice(0, 24);
}

function buildCover(productId, cardId, title) {
  const items = sourceItems(productId);
  const sections = [];
  const groupNames = String(productId).includes('tef')
    ? ['选择', '口语', '写作', '词汇', '规划']
    : ['任务', '结构', '表达', '检查', '替换'];
  for (let i = 0; i < 5; i += 1) {
    const list = [];
    for (let j = 0; j < 5; j += 1) {
      const row = items[(i * 4 + j) % items.length];
      list.push({
        primary: row[0],
        secondary: row[1],
        note: row[2],
      });
    }
    sections.push({
      side_label: groupNames[i],
      heading: `${i + 1}. ${sectionHeading(productId, i)}`,
      columns: i === 1 ? 5 : 2,
      items: list,
      source_type: 'knowledge_base',
      source_ids: [],
    });
  }
  return {
    kind: 'dense_directory_cover',
    title,
    subtitle: String(productId).includes('tef') ? '口语/写作/词汇/计划一页扫' : '范文/句型/词汇/检查一页扫',
    sections,
  };
}

function sectionHeading(productId, index) {
  const delf = ['写前先确定任务', '每段按这个顺序', '连接词别只会 donc', '最后5分钟查这些', '让作文更像B2'];
  const tef = ['先看考试和目标', '口语先练展开顺序', '写作先稳住结构', '词汇按场景记', '30天这样拆任务'];
  return (String(productId).includes('tef') ? tef : delf)[index];
}

function buildEditorial(data) {
  const brief = data.locked_brief || {};
  const cover = data.locked_cover || {};
  const productId = brief.product_id || 'delf_b2_writing';
  const isTef = String(productId).includes('tef');
  const product = productName(productId);
  const keyword = isTef ? 'TEF/TCF Canada法语' : 'DELF B2写作';
  const inner_pages = [
    {
      page_no: 2,
      page_type: 'knowledge_list',
      page_title: isTef ? '先看你要补哪一块' : '先看作文卡在哪一块',
      lead: isTef ? '别一上来就平均分配时间，先找当前最拖分的模块。' : '写作不是只靠背范文，先把任务、结构、表达和检查拆开。',
      bullets: [
        isTef ? '口语说不长，先练观点、理由、例子、回扣。' : '正式信先看称呼、目的、结尾，别把格式分送掉。',
        isTef ? '写作没结构，先固定开头、两段理由和结尾。' : '论坛投稿先表态，再用理由和例子把观点撑住。',
        isTef ? '词汇记不住，按工作、教育、生活场景分组。' : '观点句不要只写 je pense que，换成更稳的表达。',
        isTef ? '计划很乱，按听说读写每天拆成小块。' : '写完最后5分钟查 tu/vous、连接词、复数和字数。',
      ],
      source_ids: [],
      style_variant: 'list',
    },
    {
      page_no: 3,
      page_type: 'example_explain',
      page_title: isTef ? '口语展开可以这样练' : '一个句子怎么写得更稳',
      lead: isTef ? '先给答案，再补原因和例子，别只停在一句话。' : '把普通句子换成更清楚的表达，阅卷时更容易看懂你的逻辑。',
      bullets: [
        isTef ? 'Je prefere vivre en ville, parce que les services sont plus proches.' : 'Je pense que 可换成 Il me semble que，语气更稳。',
        isTef ? 'Puis, donne un exemple personnel court, pas une longue histoire.' : 'because 不要乱写，法语里用 parce que 或 car。',
        isTef ? '最后用 donc 回扣问题，答案会更完整。' : '转折不要只靠 mais，可以用 cependant 或 pourtant。',
        isTef ? '每个话题先准备2个理由和1个例子。' : '结尾用 pour conclure，再回到题目要求。',
      ],
      source_ids: [],
      style_variant: 'example',
    },
    {
      page_no: 4,
      page_type: 'wrong_right',
      page_title: isTef ? '这些练法很耗时间' : '这些扣分点最常见',
      lead: isTef ? '复习时最怕看起来很努力，实际没有练到考试会用的东西。' : '很多人不是不会写，而是细节反复丢分。',
      bullets: [
        isTef ? '只背完整答案，换个题就说不出来。' : '称呼写了 tu，正文又切到 vous。',
        isTef ? '只刷听力，不复盘错在哪里。' : '每段没有空行，结构看起来一整坨。',
        isTef ? '单词背很多，但没有按场景调用。' : '例子太空，和观点没有直接关系。',
        isTef ? '计划写得满，真正每天坚持不了。' : '连接词堆太多，句子关系反而不清楚。',
      ],
      source_ids: [],
      style_variant: 'wrong_right',
    },
    {
      page_no: 5,
      page_type: 'product_bridge',
      page_title: isTef ? '资料包适合这样用' : '知识库适合这样用',
      lead: isTef ? '把资料当成备考路线图，不要只当文件夹收藏。' : '把知识库当成写作工具箱，不要只当资料仓库。',
      bullets: [
        isTef ? '先用自测页确定目标和差距。' : '先看使用路径，确定自己要补范文、句型还是检查。',
        isTef ? '再按30天计划拆每天任务。' : '练一篇作文后，对照检查清单改一遍。',
        isTef ? '口语和写作素材按场景反复调用。' : '卡表达时，去句型库和词汇库找替换。',
        isTef ? '考前只翻速查和错题，不重新开新坑。' : '考前只翻速查和错题对照，别再乱找新资料。',
      ],
      source_ids: [],
      style_variant: 'bridge',
    },
  ];
  return {
    inner_pages,
    caption: makeCaption(productId, keyword, brief, cover),
    tags: makeTags(productId, brief, cover),
  };
}

function makeCaption(productId, keyword, brief, cover) {
  const isTef = String(productId).includes('tef');
  if (isTef) {
    return `${keyword}备考最容易乱在两件事：不知道自己该考TEF还是TCF，也不知道口语、写作、词汇和计划应该先补哪一块。今天这页先给你一个整理思路，别把时间平均撒开。口语先练观点、理由、例子、回扣；写作先稳住结构；词汇按移民、工作、生活场景去背；最后再用30天计划把每天任务拆小。很多人复习到后面会一直换资料，其实先把当前短板找出来更重要。先测目标，再排顺序，再练能上考场的表达，效率会稳很多。我的资料包把考试选择、自测、句型、词汇、真题主题和备考计划放在一起，适合想少绕路的人。需要的话可以从下方小车看完整目录。`;
  }
  return `${keyword}备考到后面，很多人手里有范文、有句型、有词汇，但真正写作文时还是不知道先看哪一份。今天这页先帮你把写作拆开：任务格式、段落结构、连接表达、常见扣分点、考前检查。正式信先稳称呼和目的，论坛投稿先稳立场，建议信先把建议和理由接住。写完以后再查 tu/vous、复数、连接词和字数。别把所有资料摊开一起看，先按这一页的顺序过一遍，哪里最容易错就先补哪里。练一篇、改一篇、再回到清单里复查，比单纯背范文更容易发现自己的漏洞。我的写作知识库把范文、句型、词汇、观点、检查清单和错题对照整理到一起，适合想按模块复盘的人。完整目录在下方小车。`;
}

function makeTags(productId) {
  if (String(productId).includes('tef')) {
    return ['#TEFCanada', '#TCFCanada', '#法语备考', '#法语口语', '#法语写作', '#备考资料', '#加拿大移民法语', '#法语学习'];
  }
  return ['#DELFB2写作', '#法语B2写作', '#法语写作', '#写作模板', '#写作范文', '#备考资料', '#检查清单', '#法语学习'];
}

function buildAudit() {
  return {
    approved: true,
    issues: [],
    cover_corrections: [],
    page_corrections: [],
    corrected_caption: '',
  };
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
