/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { planSeededTopics } from '../src/lib/editorial-seed-library';
import { callOpenAICompatibleJson, getRecentAiUsage, resetRecentAiUsage } from '../src/lib/ai-client';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import { getProductPromptProfile } from '../src/lib/product-prompt-profiles';
import type { CreativeCardRenderer, MigratedTopic } from '../src/types/reference-workflow';
import type { ProductId } from '../src/types/data';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const allProducts: { id: ProductId; label: string }[] = [
  { id: 'delf_b2_writing', label: '商品1 DELF B2 写作知识库' },
  { id: 'tef_tcf_canada', label: '商品2 TEF/TCF Canada 备考资料包' },
];

const productFilter = process.env.TITLE_MATRIX_PRODUCT as ProductId | undefined;
const products = productFilter ? allProducts.filter(product => product.id === productFilter) : allProducts;
const cardLimit = Math.max(0, Number(process.env.TITLE_MATRIX_CARD_LIMIT || 0));
const supportedCards = competitorCreativeCards.filter(card => card.supported);
const cards = cardLimit > 0 ? supportedCards.slice(0, cardLimit) : supportedCards;
const rows: PreviewRow[] = [];
resetRecentAiUsage();

for (const product of products) {
  const facts = await loadProductFacts(product.id);
  const profile = getProductPromptProfile(product.id);
  const usedTopicKeys = new Set<string>();
  const usedSelectedTitles = new Set<string>();
  const inputs = cards.map((card, index) => {
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (!spec) throw new Error(`missing spec: ${card.renderer_id}`);
    const topics = planSeededTopics({
      productId: product.id,
      card,
      facts,
      direction: '标题矩阵：每个封面模板必须拿到不重复的选题角度；资料型、痛点型、结果型、经验型要分开。',
      limit: 6,
      recentSeedIds: [],
    });
    const topic = pickTopicForRenderer(topics, card.renderer_id, index, usedTopicKeys);
    return {
      product: product.label,
      productId: product.id,
      identity: profile.noteIdentity,
      cardId: card.id,
      renderer: card.renderer_id,
      templateName: spec.name,
      templateFamily: spec.family,
      allowedCoverTitleTypes: spec.allowedCoverTitleTypes || [],
      renderMode: spec.renderMode,
      topic,
      topicType: topic.topic_type || '',
      audience: topic.audience,
      pain: topic.pain,
      searchTerms: topic.search_terms || [],
    };
  });

  console.log(`AI title matrix: ${product.label}, templates=${inputs.length}`);
  const generated = await repairTitlesForProduct(product.id, inputs, []);
  const aiItems = Array.isArray((generated as any)?.items) ? (generated as any).items : [];
  for (const input of inputs) {
    const item = aiItems.find((entry: any) => entry?.card_id === input.cardId) || {};
    const textTitles = normalizeTextTitles(extractPreviewTitlePool(item), input.productId);
    const coverCandidate = pickPreviewCoverTitle(item, input);
    const selectedTextTitle = pickPreviewSelectedTitle(item.selected_text_title, textTitles, input, usedSelectedTitles);
    rows.push({
      product: input.product,
      cardId: input.cardId,
      template: input.templateName,
      renderer: input.renderer,
      renderMode: input.renderMode,
      topic: input.topic.topic,
      topicType: input.topicType,
      audience: input.audience,
      pain: input.pain,
      coverTitle: coverCandidate.title,
      coverSubtitle: coverCandidate.subtitle,
      textTitles,
      selectedTextTitle,
      editorNote: cleanTitle(item.editor_note) || '',
    });
  }
}

const stamp = Date.now();
const htmlPath = 'title-matrix-preview.html';
const jsonPath = `ai-title-matrix-${stamp}.json`;
await fs.writeFile(jsonPath, JSON.stringify({ usage: getRecentAiUsage(), rows }, null, 2), 'utf8');
await fs.writeFile(htmlPath, renderHtml(rows, getRecentAiUsage()), 'utf8');
await fs.copyFile(htmlPath, 'public/title-matrix-preview.html');
console.log(`HTML=${htmlPath}`);
console.log(`PUBLIC=http://localhost:4000/title-matrix-preview.html`);
console.log(`JSON=${jsonPath}`);
console.log(`USAGE=${JSON.stringify(getRecentAiUsage())}`);

interface InputRow {
  product: string;
  productId: ProductId;
  identity: string;
  cardId: string;
  renderer: CreativeCardRenderer;
  templateName: string;
  templateFamily: string;
  allowedCoverTitleTypes: string[];
  renderMode: string;
  topic: MigratedTopic;
  topicType: string;
  audience: string;
  pain: string;
  searchTerms: string[];
}

interface PreviewRow {
  product: string;
  cardId: string;
  template: string;
  renderer: CreativeCardRenderer;
  renderMode: string;
  topic: string;
  topicType: string;
  audience: string;
  pain: string;
  coverTitle: string;
  coverSubtitle: string;
  selectedTextTitle: string;
  textTitles: { type: string; title: string; why: string }[];
  editorNote: string;
}

function pickTopicForRenderer(topics: MigratedTopic[], renderer: CreativeCardRenderer, index: number, usedTopicKeys?: Set<string>) {
  const prioritiesByRenderer: Partial<Record<CreativeCardRenderer, string[]>> = {
    parchment_dense_directory: ['product_showcase', 'search_pain', 'selling_point', 'narrow_knowledge'],
    white_green_directory: ['search_pain', 'product_showcase', 'narrow_knowledge', 'selling_point'],
    clean_purple_directory: ['narrow_knowledge', 'search_pain', 'product_showcase', 'selling_point'],
    grid_purple_directory: ['selling_point', 'search_pain', 'narrow_knowledge', 'product_showcase'],
    blackboard_phrase: ['narrow_knowledge', 'selling_point', 'search_pain', 'product_showcase'],
    collocation_dense: ['narrow_knowledge', 'selling_point', 'search_pain', 'product_showcase'],
    memo_offer: ['search_pain', 'selling_point', 'product_showcase', 'narrow_knowledge'],
    notebook_big_words: ['search_pain', 'selling_point', 'narrow_knowledge', 'product_showcase'],
    plain_experience: ['search_pain', 'selling_point', 'product_showcase', 'narrow_knowledge'],
    document_analysis: ['narrow_knowledge', 'search_pain', 'selling_point', 'product_showcase'],
    course_roadmap: ['selling_point', 'search_pain', 'product_showcase', 'narrow_knowledge'],
    vocab_table: ['narrow_knowledge', 'product_showcase', 'search_pain', 'selling_point'],
    word_flashcard: ['narrow_knowledge', 'search_pain', 'selling_point', 'product_showcase'],
    book_cover: ['product_showcase', 'selling_point', 'search_pain', 'narrow_knowledge'],
    blackboard_offer: ['search_pain', 'selling_point', 'product_showcase', 'narrow_knowledge'],
  };
  const priorities = prioritiesByRenderer[renderer] || ['search_pain', 'selling_point', 'product_showcase', 'narrow_knowledge'];
  const sorted = topics.slice().sort((a, b) => {
    const ai = priorities.indexOf(a.topic_type || '');
    const bi = priorities.indexOf(b.topic_type || '');
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const unused = sorted.find(topic => !usedTopicKeys?.has(getTopicKey(topic)));
  const fallback = sorted[index % Math.max(1, Math.min(sorted.length, 4))] || sorted[0] || topics[0];
  const picked = unused || fallback;
  if (picked) usedTopicKeys?.add(getTopicKey(picked));
  return picked;
}

function getTopicKey(topic: MigratedTopic) {
  return `${topic.topic_type || ''}|${topic.topic || ''}`;
}

async function generateTitlesForProduct(productId: ProductId, inputs: InputRow[]) {
  const profile = getProductPromptProfile(productId);
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是资深小红书法语备考账号编辑，只负责生成标题，不生成正文、不生成图片。',
        '你的目标：让用户第一眼觉得“这和我有关、我想点开、我想收藏”。',
        '每个封面模板都要单独判断，不能整批套同一个标题套路。',
        '输出 JSON，不能解释。',
        '',
        '标题分两套：',
        '1. cover_title：封面大字。短、狠、第一眼能停住。必须有法语/DELF/TEF/TCF/CLB 等身份词之一。通常12-18字，最多20字；少于12字会显得太空，除非钩子极强。',
        '2. selected_text_title：小红书发布标题。更完整，负责搜索、推荐流点击和带货承接。通常14-18字，最多20字；中文、英文、数字、空格、全角/半角标点都各算1个字。',
        '',
        '每个模板输出5个 text_titles：资料型、解释型、强钩子型、情绪型、结果型；每个 title 通常14-18字，最多20字。',
        '不要为了不超字数写成10字左右的短标题；标题必须有对象、场景、痛点或结果中的至少2个信息点。',
        '也不要为了凑到20字写成断尾半句；宁可14-18字完整，不要20字卡边截断。禁止结尾悬空，如“别再只盯语”“问题出在”“格式不”“这5个常”“早该”“每”“哪科最”。',
        'selected_text_title 和 text_titles[].title 都必须带商品身份：商品1用法语B2/DELF B2/B2写作，商品2用TEF/TCF/CLB/加拿大法语。',
        '20字符以内也必须是一句完整标题，不能像被截断的半句话；禁止以“这/先/把/的/，/：”等悬空词结尾。',
        '同一商品同一批模板的 selected_text_title 不得重复；即使选题相近，也要根据封面模板改成不同对象、场景或钩子。',
        '句式硬限制：整批结果里带问号的疑问句最多三分之一；“救命”“别再”“为什么”开头的句式整批最多 1 条，其余写陈述句。',
        '允许适当资料强度词：大全、必背、考官视角、7天、最后检查。救命/别再这类呼喊式开头已经严重过量，不要再产出。',
        '但不要冒充官方授权、内部押题、真实保证。',
        '',
        '封面标题按模板匹配：',
        '资料目录/清单/表格：优先 资料、大全、稀缺、时效、收藏。',
        '黑板短语/搭配：优先 高频、必背、别乱背、直接套。',
        '备忘录/手写/经验：优先 情绪、痛点、反常识、损失感。',
        '文档解析：优先 解析、拆解、错题、素材。',
        '路线图：优先 时间、阶段、路径、结果。',
        '',
        '标题必须口语、具体、有对象感。不要“知识库长啥样”“展开速查表”这种说明书味。',
        `商品身份：${profile.noteIdentity}`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: productId,
        product_identity: profile.noteIdentity,
        rows: inputs.map(input => ({
          card_id: input.cardId,
          template: input.templateName,
          renderer: input.renderer,
          family: input.templateFamily,
          allowed_cover_title_types: input.allowedCoverTitleTypes,
          render_mode: input.renderMode,
          topic_type: input.topicType,
          topic: input.topic.topic,
          audience: input.audience,
          pain: input.pain,
          promise: input.topic.content_promise,
          search_terms: input.searchTerms.slice(0, 8),
        })),
        output_schema: {
          items: [{
            card_id: '',
            cover_title: '',
            cover_titles: [{ title: '', subtitle: '', why: '' }],
            cover_subtitle: '',
            selected_text_title: '',
            text_titles: [
              { type: '资料型', title: '', why: '' },
              { type: '解释型', title: '', why: '' },
              { type: '强钩子型', title: '', why: '' },
              { type: '情绪型', title: '', why: '' },
              { type: '结果型', title: '', why: '' },
            ],
            editor_note: '',
          }],
        },
      }),
    },
  ], { maxTokens: 7000, retries: 2, temperature: 0.78 });
}

async function repairTitlesForProduct(productId: ProductId, inputs: InputRow[], draftItems: any[]) {
  const profile = getProductPromptProfile(productId);
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书标题终审编辑。你只修标题，不改选题，不生成正文或图片，只返回JSON。',
        '这是成句修稿，不是截字：任何超长标题都要整句重写，绝不能从第20字直接切断。',
        '计数规则：汉字、英文字母、数字、空格、全角/半角标点各算1字。文字标题14-18字优先、最多20字；封面标题12-18字优先、最多20字。',
        '每句必须语义完整、读出声自然；禁止以“先、把、的、在、还、最、这、怎么、问题出在”等悬空词结尾。',
        '每个文字标题都要保留领域身份。商品1用“DELF B2/法语B2/B2写作”；商品2用“TEF/TCF/CLB7/加拿大法语”。',
        '每个标题至少包含两个有效信息点：对象/阶段/场景/痛点/反常识/损失/数字/结果/行动。身份词不算信息点。',
        '75个爆款公式只提供心理触发结构。先选最适合当前选题的触发器，再自然仿写，禁止为了套公式写成人话不通的标题。',
        '五类文字标题必须明显不同：资料型突出大全、稀缺、时效或收藏；解释型解释真正卡点；强钩子型用冲突、反常识或损失；情绪型让用户对号入座；结果型给阶段或结果期待。',
        '不要所有标题都用问号，也不要都写成“AAA？BBB”。问句最多2条。',
        '封面标题必须匹配模板，并让用户第一眼知道“这和我有关”；不是资料文件名，也不是内部选题说明。',
        '允许“大全、必背、万能、稳过、7天、提分、救命、别再、白练”等强词，但不得冒充官方授权或内部押题。',
        '同一商品不同模板的标题不能换汤不换药。',
        `商品身份：${profile.noteIdentity}`,
        'Candidate-pool rule: for every row return 15 text_titles, exactly three complete alternatives for each of the five types. Also return three cover_titles. The program, not the model, will enforce visible-character length.',
        'Do not shorten or truncate a sentence to fit. Every candidate must be independently complete and natural. Aim text titles at 14-18 visible characters and cover titles at 12-18.',
        'Put the 15 text alternatives in text_title_pools using these exact English keys: material, explanation, strong_hook, emotion, result. Each key must contain exactly three objects with title and why.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: productId,
        rows: inputs.map(input => ({
          card_id: input.cardId,
          template: input.templateName,
          renderer: input.renderer,
          allowed_cover_title_types: input.allowedCoverTitleTypes,
          topic_type: input.topicType,
          topic: input.topic.topic,
          audience: input.audience,
          pain: input.pain,
          search_terms: input.searchTerms.slice(0, 5),
          draft: draftItems.find(item => item?.card_id === input.cardId) || {},
        })),
        output_schema: {
          items: [{
            card_id: '',
            cover_title: '',
            cover_titles: [{ title: '', subtitle: '', why: '' }],
            cover_subtitle: '',
            text_title_pools: {
              material: [{ title: '', why: '' }],
              explanation: [{ title: '', why: '' }],
              strong_hook: [{ title: '', why: '' }],
              emotion: [{ title: '', why: '' }],
              result: [{ title: '', why: '' }],
            },
            selected_text_title: '',
            text_titles: [
              { type: '资料型', title: '', why: '' },
              { type: '解释型', title: '', why: '' },
              { type: '强钩子型', title: '', why: '' },
              { type: '情绪型', title: '', why: '' },
              { type: '结果型', title: '', why: '' },
            ],
            editor_note: '',
          }],
        },
      }),
    },
  ], { maxTokens: 7000, retries: 2, temperature: 0.62 });
}

function normalizeTextTitles(value: unknown, productId: ProductId) {
  const items = Array.isArray(value) ? value : [];
  const valid = items.map((item: any) => ({
    type: cleanTitle(item?.type) || '候选',
    title: acceptTitle(item?.title, productId, 'text'),
    why: cleanTitle(item?.why),
  })).filter(item => item.title);
  const typeOrder = ['\u8d44\u6599\u578b', '\u89e3\u91ca\u578b', '\u5f3a\u94a9\u5b50\u578b', '\u60c5\u7eea\u578b', '\u7ed3\u679c\u578b'];
  const selected = typeOrder
    .map(type => valid.filter(item => item.type === type).sort((a, b) => previewTitleScore(b.title) - previewTitleScore(a.title))[0])
    .filter(Boolean);
  const rest = valid
    .filter(item => !selected.some(selectedItem => selectedItem.title === item.title))
    .sort((a, b) => previewTitleScore(b.title) - previewTitleScore(a.title));
  return [...selected, ...rest].slice(0, 5);
}

function extractPreviewTitlePool(item: any) {
  const pool = item?.text_title_pools;
  if (!pool || typeof pool !== 'object') return item?.text_titles;
  const labels: Record<string, string> = {
    material: '\u8d44\u6599\u578b',
    explanation: '\u89e3\u91ca\u578b',
    strong_hook: '\u5f3a\u94a9\u5b50\u578b',
    emotion: '\u60c5\u7eea\u578b',
    result: '\u7ed3\u679c\u578b',
  };
  return Object.entries(labels).flatMap(([key, type]) => {
    const values = Array.isArray(pool[key]) ? pool[key] : [];
    return values.map((entry: any) => typeof entry === 'string'
      ? { type, title: entry, why: '' }
      : { ...entry, type });
  });
}

function pickPreviewCoverTitle(item: any, input: InputRow) {
  const candidates = [
    ...(Array.isArray(item?.cover_titles) ? item.cover_titles : []),
    { title: item?.cover_title, subtitle: item?.cover_subtitle },
  ].map((entry: any) => ({
    title: acceptTitle(entry?.title, input.productId, 'cover'),
    subtitle: cleanTitle(entry?.subtitle),
  })).filter(entry => entry.title)
    .sort((a, b) => previewTitleScore(b.title) - previewTitleScore(a.title));
  return candidates[0] || {
    title: buildPreviewFallbackTitle(input, 'cover'),
    subtitle: '按当前阶段直接用',
  };
}

function previewTitleScore(title: string) {
  let score = Math.min(Array.from(title).length, 18);
  if (isUnnaturalPreviewTitle(title)) score -= 12;
  if (/写不好|说不长|听不懂|背了也用不上|一直在扣分|老丢分|扣分|写不出来|用不上|没方向/.test(title)) score += 4;
  if (/\d/.test(title)) score += 2;
  if (/[?!？！]/.test(title)) score += 2;
  if (/别再|先别|总丢|卡住|白背|致命|反而|大全|必背|稀缺|考前|冲刺/.test(title)) score += 4;
  return score;
}

function cleanTitle(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[“”"]/g, '')
    .replace(/法语B2B2/g, '法语B2')
    .replace(/DELF\s*B2B2/gi, 'DELF B2')
    .replace(/B2写作写作/g, 'B2写作')
    .replace(/法语B2搞懂B2/g, '法语B2搞懂')
    .replace(/TEF\/TCFTEF\/TCF/gi, 'TEF/TCF')
    .replace(/TEF\/TCF\s*TEF\/TCF/gi, 'TEF/TCF')
    .replace(/考官推荐/g, '考场更稳')
    .replace(/考官都让背/g, '高频就背')
    .replace(/直接套用/g, '照着改写')
    .replace(/直接用/g, '照着用')
    .replace(/([，,、：:；;？！?])\1+/g, '$1')
    .replace(/资料太散/g, '资料太乱')
    .replace(/总卡住|卡住/g, '写不好')
    .replace(/正在拖后腿|拖后腿/g, '一直在扣分')
    .replace(/正在白背|白背/g, '背了也用不上')
    .replace(/你的DELF\s*B2格式/g, 'DELF B2格式')
    .replace(/你的DELF\s*B2范文/g, 'DELF B2范文')
    .replace(/你的法语B2/g, '法语B2')
    .replace(/写作任务/g, '写作题型')
    .replace(/三类任务/g, '三类题型')
    .trim();
}

function acceptTitle(value: unknown, productId: ProductId, role: 'cover' | 'text') {
  const title = compactPreviewTitle(value, productId);
  const length = Array.from(title).length;
  const min = role === 'cover' ? 10 : 13;
  if (!title || length < min || length > 20) return '';
  if (isUnnaturalPreviewTitle(title)) return '';
  if (!hasPreviewProductIdentity(title, productId)) return '';
  if (hasIncompleteTitleEnding(title)) return '';
  return title;
}

function isUnnaturalPreviewTitle(title: string) {
  return /资料太散|正在拖后腿|拖后腿|正在白背|白背|写作任务|你的DELF\s*B2|你的法语B2|卡住/.test(title);
}

function compactPreviewTitle(value: unknown, productId: ProductId) {
  let title = cleanTitle(value);
  if (Array.from(title).length <= 20) return title;
  const replacements: [RegExp, string][] = productId === 'delf_b2_writing'
    ? [[/DELF\s*B2写作/gi, 'B2写作'], [/DELF\s*B2作文/gi, 'B2作文'], [/法语\s*B2写作/gi, 'B2写作'], [/法语\s*B2作文/gi, 'B2作文']]
    : [[/TEF\s*\/\s*TCF写作/gi, 'TEF写作'], [/TEF\s*\/\s*TCF口语/gi, 'TEF口语'], [/TEF\s*\/\s*TCF听力/gi, 'TCF听力'], [/TEF\s*\/\s*TCF备考/gi, 'TEF法语备考']];
  for (const [pattern, replacement] of [...replacements, [/为什么/g, '为何'] as [RegExp, string], [/不要再/g, '别再'] as [RegExp, string], [/一开始/g, '开局'] as [RegExp, string], [/每次练/g, '练'] as [RegExp, string], [/都要/g, '总要'] as [RegExp, string]]) {
    if (Array.from(title).length <= 20) break;
    title = title.replace(pattern, replacement);
  }
  if (Array.from(title).length > 20 && productId === 'delf_b2_writing' && /DELF\s*B2/i.test(title)) {
    const rest = title.replace(/DELF\s*B2/ig, '');
    title = title.replace(/DELF\s*B2/ig, /\u5199\u4f5c|\u4f5c\u6587/.test(rest) ? 'B2' : 'B2\u5199\u4f5c');
  }
  if (Array.from(title).length > 20 && productId === 'tef_tcf_canada' && /TEF\s*\/\s*TCF/i.test(title)) {
    title = title.replace(/TEF\s*\/\s*TCF/ig, 'TEF');
  }
  return cleanTitle(title);
}

function hasPreviewProductIdentity(title: string, productId: ProductId) {
  return productId === 'tef_tcf_canada'
    ? /TEF\s*\/\s*TCF|TEF|TCF|CLB\s*7|加拿大法语/i.test(title)
    : /DELF\s*B2|法语\s*B2|B2\s*写作|B2\s*作文|法语写作/i.test(title);
}

function hasIncompleteTitleEnding(title: string) {
  return /(?:先|把|给|的|和|与|在|还|最|这|这个|这里|怎么|问题出在|别再|早该|每|直|高频主|这\d+个常|先看这张)$/u.test(title)
    || /[，,、：:；;。\s]$/u.test(title);
}

function buildPreviewFallbackTitle(input: InputRow, role: 'cover' | 'text') {
  if (input.productId === 'tef_tcf_canada') {
    return role === 'cover' ? 'TEF/TCF备考别再乱刷题' : 'TEF/TCF备考最怕一开始就走错';
  }
  return role === 'cover' ? 'DELF B2写作考前先查这页' : 'DELF B2写作总丢分先查这几项';
}

function pickPreviewSelectedTitle(
  requested: unknown,
  textTitles: PreviewRow['textTitles'],
  input: InputRow,
  used: Set<string>,
) {
  const candidates = [
    ...textTitles.map(item => item.title),
    acceptTitle(requested, input.productId, 'text'),
  ].filter(Boolean).sort((a, b) => previewTitleScore(b) - previewTitleScore(a));
  const picked = candidates.find(title => !used.has(normalizeTitleKey(title)))
    || buildPreviewFallbackTitle(input, 'text');
  used.add(normalizeTitleKey(picked));
  return picked;
}

function normalizeTitleKey(value: string) {
  return value.replace(/[\s，,。；;：:！？!?]/g, '').toLowerCase();
}

function renderHtml(data: PreviewRow[], usage: unknown) {
  const grouped = products.map(product => ({
    ...product,
    rows: data.filter(row => row.product === product.label),
  }));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>AI标题矩阵预览</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f6f4ef; color: #1f1f1f; }
    header { position: sticky; top: 0; z-index: 2; background: rgba(246,244,239,.96); border-bottom: 1px solid #ddd5ca; padding: 18px 28px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .tip { color: #675f55; font-size: 14px; line-height: 1.5; }
    section { padding: 24px 28px 8px; }
    h2 { margin: 0 0 14px; font-size: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(390px, 1fr)); gap: 14px; }
    .card { background: #fff; border: 1px solid #ded8ce; border-radius: 10px; padding: 16px; box-shadow: 0 8px 24px rgba(40,30,20,.06); }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; color: #756b61; font-size: 12px; margin-bottom: 10px; }
    .pill { background: #eee9df; border-radius: 999px; padding: 3px 8px; }
    .topic { color: #40362f; line-height: 1.55; font-size: 14px; margin-top: 6px; }
    .cover { background: #1f1c19; border-radius: 8px; padding: 14px; margin: 12px 0; }
    .cover-title { font-size: 26px; font-weight: 900; line-height: 1.15; color: #ffe96a; text-shadow: 2px 2px 0 #000; }
    .cover-sub { margin-top: 7px; font-size: 14px; color: #f7eddd; }
    .selected { background: #fff6d6; border: 1px solid #e5cc76; padding: 10px; border-radius: 8px; margin: 10px 0; font-weight: 900; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    td { border-top: 1px solid #eee7dc; padding: 8px 4px; vertical-align: top; }
    td:first-child { width: 72px; color: #9b2e2e; font-weight: 800; }
    .why { color: #777; font-size: 12px; margin-top: 2px; }
    .note { margin-top: 10px; color: #796f66; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>AI标题矩阵预览</h1>
    <div class="tip">只调用标题生成，不生成正文/内页/图片。用途：验收每个封面模板的封面标题和文字标题方向。usage: ${escapeHtml(JSON.stringify(usage))}</div>
  </header>
  ${grouped.map(group => `<section>
    <h2>${escapeHtml(group.label)} · ${group.rows.length} 个封面</h2>
    <div class="grid">
      ${group.rows.map(row => `<article class="card">
        <div class="meta">
          <span class="pill">${escapeHtml(row.cardId)}</span>
          <span class="pill">${escapeHtml(row.template)}</span>
          <span class="pill">${escapeHtml(row.renderMode)}</span>
          <span class="pill">${escapeHtml(row.topicType || 'topic')}</span>
        </div>
        <div class="topic"><b>选题：</b>${escapeHtml(row.topic)}</div>
        <div class="topic"><b>用户痛点：</b>${escapeHtml(row.pain)}</div>
        <div class="cover">
          <div class="cover-title">${escapeHtml(row.coverTitle)}</div>
          <div class="cover-sub">${escapeHtml(row.coverSubtitle)}</div>
        </div>
        <div class="selected">文字标题：${escapeHtml(row.selectedTextTitle)}</div>
        <table>
          ${row.textTitles.map(item => `<tr>
            <td>${escapeHtml(item.type)}</td>
            <td><b>${escapeHtml(item.title)}</b><div class="why">${escapeHtml(item.why)}</div></td>
          </tr>`).join('')}
        </table>
        <div class="note">${escapeHtml(row.editorNote)}</div>
      </article>`).join('')}
    </div>
  </section>`).join('')}
</body>
</html>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
