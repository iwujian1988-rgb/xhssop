/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
import { callOpenAICompatibleJson, getRecentAiUsage, resetRecentAiUsage } from '../src/lib/ai-client';
import type { ProductId } from '../src/types/data';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const sourceFile = process.argv[2];
if (!sourceFile) throw new Error('usage: npx tsx scripts/repair-existing-title-matrix.mts <json>');
const source = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
const rows = Array.isArray(source.rows) ? source.rows : [];
resetRecentAiUsage();

for (const productId of ['delf_b2_writing', 'tef_tcf_canada'] as ProductId[]) {
  const productRows = rows.filter((row: any) => productId === 'delf_b2_writing'
    ? String(row.product).startsWith('商品1')
    : String(row.product).startsWith('商品2'));
  let result = await repairGroup(productId, productRows, false);
  let items = normalizeItems(Array.isArray((result as any)?.items) ? (result as any).items : [], productId);
  const firstIssue = validateGroup(items, productRows, productId);
  if (firstIssue) {
    console.warn(`[title-repair] ${productId} first pass failed: ${firstIssue}; retrying once`);
    result = await repairGroup(productId, productRows, true);
    items = normalizeItems(Array.isArray((result as any)?.items) ? (result as any).items : [], productId);
  }
  const selectedKeys = new Set<string>();
  for (const row of productRows) {
    const item = items.find((entry: any) => entry?.card_id === row.cardId);
    const issue = validateItem(item, productId, selectedKeys);
    if (issue) throw new Error(`${row.cardId}: ${issue}`);
    row.coverTitle = clean(item.cover_title);
    row.coverSubtitle = clean(item.cover_subtitle);
    row.selectedTextTitle = clean(item.selected_text_title);
    row.textTitles = item.text_titles.map((title: any) => ({
      type: clean(title.type),
      title: clean(title.title),
      why: clean(title.why),
    }));
    row.editorNote = clean(item.editor_note);
  }
}

const stamp = Date.now();
const outputFile = `ai-title-matrix-repaired-${stamp}.json`;
await fs.writeFile(outputFile, JSON.stringify({ usage: getRecentAiUsage(), rows }, null, 2), 'utf8');
const html = renderHtml(rows, getRecentAiUsage());
await fs.writeFile('title-matrix-preview.html', html, 'utf8');
await fs.writeFile('public/title-matrix-preview.html', html, 'utf8');
await fs.writeFile('public/title-matrix-preview.json', JSON.stringify({ usage: getRecentAiUsage(), rows }, null, 2), 'utf8');
console.log(`JSON=${outputFile}`);
console.log('PUBLIC=http://localhost:4000/title-matrix-preview.html');
console.log(`USAGE=${JSON.stringify(getRecentAiUsage())}`);

async function repairGroup(productId: ProductId, productRows: any[], rewrite: boolean) {
  const identity = productId === 'delf_b2_writing'
    ? '商品1：DELF B2/法语B2写作'
    : '商品2：TEF/TCF/CLB7/加拿大法语';
  return callOpenAICompatibleJson([
    {
      role: 'system',
      content: [
        '你是小红书法语赛道的标题总编。只返回JSON，只修标题，不改选题。',
        '这次必须交付可直接发布的完整标题，不允许截断、缩写成资料名或统一套同一句。',
        '“字数”按肉眼计数：汉字、英文字母、数字、空格、全角/半角标点各算1字。',
        '文字标题每条13-20字，优先14-18字；封面标题每条10-20字，优先12-18字。不要故意都写成10字，也不要卡20字写半句。',
        '每条必须语义完整、口语自然，不得以“先、把、给、的、在、还、最、这、怎么、别再、问题出在”等词结尾。',
        `当前${identity}。每一条文字标题和封面标题都必须清楚带对应身份词。`,
        '每个模板返回5个文字标题，顺序固定为：资料型、解释型、强钩子型、情绪型、结果型。五条必须是不同心理机制，不能只换两三个词。',
        '每个标题至少有两个有效信息点：用户阶段/使用场景/真实痛点/反常识/损失/数字/结果/行动。考试身份词不算信息点。',
        '75个爆款公式只做结构参考。优先匹配：资料用数字锚定/好奇缺口，纠错用损失规避，方法用结果承诺，经验用身份代入/反转，观点用认知冲突。禁止硬套。',
        '问号标题最多2条；禁止全部写成“AAA？BBB”。',
        'selected_text_title必须从本行5个文字标题中原样选择1条。全批次selected_text_title不得重复。',
        '封面标题根据模板写：目录清单强调大全/收藏/稀缺/时效；黑板强调高频/必背/别乱背；备忘录手写经验强调用户痛点/损失/反常识；文档强调拆解/错误；路线图强调时间/阶段/结果。',
        '允许强表达：大全、必背、万能、稳过、7天、提分、救命、别再、白练；禁止冒充官方授权或内部押题。',
        '输出前自行逐字计数并检查完整性。不要输出length字段，不要解释。',
        rewrite ? '这是返修：上一次存在字数、断尾、身份或重复问题。请逐条重写，不得原样返回上一版。' : '',
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        product_id: productId,
        rows: productRows.map(row => ({
          card_id: row.cardId,
          template: row.template,
          renderer: row.renderer,
          topic_type: row.topicType,
          topic: row.topic,
          audience: row.audience,
          pain: row.pain,
          current_cover_title: row.coverTitle,
          current_valid_candidates: row.textTitles,
        })),
        output_schema: {
          items: [{
            card_id: '',
            cover_title: '',
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
  ], { maxTokens: 8000, retries: 2, temperature: rewrite ? 0.52 : 0.64 });
}

function validateGroup(items: any[], productRows: any[], productId: ProductId) {
  const selectedKeys = new Set<string>();
  for (const row of productRows) {
    const item = items.find((entry: any) => entry?.card_id === row.cardId);
    const issue = validateItem(item, productId, selectedKeys);
    if (issue) return `${row.cardId}: ${issue}`;
  }
  return '';
}

function normalizeItems(items: any[], productId: ProductId) {
  return items.map(item => ({
    ...item,
    cover_title: compactTitle(item?.cover_title, productId),
    selected_text_title: compactTitle(item?.selected_text_title, productId),
    text_titles: Array.isArray(item?.text_titles)
      ? item.text_titles.map((entry: any) => ({ ...entry, title: compactTitle(entry?.title, productId) }))
      : [],
  }));
}

function compactTitle(value: unknown, productId: ProductId) {
  let title = clean(value);
  if (Array.from(title).length <= 20) return title;
  const replacements: [RegExp, string][] = productId === 'delf_b2_writing'
    ? [
        [/DELF\s*B2写作/gi, 'B2写作'],
        [/DELF\s*B2作文/gi, 'B2作文'],
        [/法语\s*B2写作/gi, 'B2写作'],
        [/法语\s*B2作文/gi, 'B2作文'],
      ]
    : [
        [/TEF\s*\/\s*TCF写作/gi, 'TEF写作'],
        [/TEF\s*\/\s*TCF口语/gi, 'TEF口语'],
        [/TEF\s*\/\s*TCF听力/gi, 'TCF听力'],
        [/TEF\s*\/\s*TCF备考/gi, 'TEF法语备考'],
      ];
  const common: [RegExp, string][] = [
    [/为什么/g, '为何'],
    [/不要再/g, '别再'],
    [/一开始/g, '开局'],
    [/每次练/g, '练'],
    [/都要/g, '总要'],
    [/常见的/g, '常见'],
    [/真正的/g, '真正'],
    [/一次性/g, '一次'],
  ];
  for (const [pattern, replacement] of [...replacements, ...common]) {
    if (Array.from(title).length <= 20) break;
    title = title.replace(pattern, replacement);
  }
  return clean(title);
}

function validateItem(item: any, productId: ProductId, selectedKeys: Set<string>) {
  if (!item) return 'AI未返回该模板';
  if (!validTitle(item.cover_title, productId, 'cover')) return `封面标题不合格：${item.cover_title}`;
  if (!validTitle(item.selected_text_title, productId, 'text')) return `文字标题不合格：${item.selected_text_title}`;
  if (!Array.isArray(item.text_titles) || item.text_titles.length !== 5) return '文字标题候选不是5条';
  const expected = ['资料型', '解释型', '强钩子型', '情绪型', '结果型'];
  const titles = item.text_titles.map((entry: any) => clean(entry.title));
  if (item.text_titles.some((entry: any, index: number) => clean(entry.type) !== expected[index])) return '五类标题顺序或类型错误';
  if (titles.some((title: string) => !validTitle(title, productId, 'text'))) return `存在不合格候选：${titles.join(' | ')}`;
  if (new Set(titles.map(titleKey)).size !== 5) return '同一模板内候选标题重复';
  if (!titles.includes(clean(item.selected_text_title))) return 'selected_text_title没有从5条候选中选择';
  const selectedKey = titleKey(item.selected_text_title);
  if (selectedKeys.has(selectedKey)) return `全批次文字标题重复：${item.selected_text_title}`;
  selectedKeys.add(selectedKey);
  return '';
}

function validTitle(value: unknown, productId: ProductId, role: 'cover' | 'text') {
  const title = clean(value);
  const length = Array.from(title).length;
  const min = role === 'cover' ? 10 : 13;
  const identity = productId === 'delf_b2_writing'
    ? /DELF\s*B2|法语\s*B2|B2\s*写作|B2\s*作文|法语写作/i
    : /TEF\s*\/\s*TCF|TEF|TCF|CLB\s*7|加拿大法语/i;
  return length >= min
    && length <= 20
    && identity.test(title)
    && !/(?:先|把|给|的|和|与|在|还|最|这|这个|这里|怎么|问题出在|别再|早该|每|直|高频主|这\d+个常|先看这张)$/u.test(title)
    && !/[，,、：:；;。\s]$/u.test(title);
}

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').replace(/[“”"]/g, '').trim();
}

function titleKey(value: unknown) {
  return clean(value).replace(/[\s，,。；;：:！？!?]/g, '').toLowerCase();
}

function renderHtml(data: any[], usage: unknown) {
  const groups = ['商品1', '商品2'].map(prefix => ({ prefix, rows: data.filter(row => String(row.product).startsWith(prefix)) }));
  const escape = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>标题矩阵终审</title><style>
  body{margin:0;background:#f5f2ec;color:#1f1f1f;font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}header{position:sticky;top:0;z-index:2;padding:18px 28px;background:#f5f2ecf2;border-bottom:1px solid #d9d1c6}h1{margin:0 0 6px;font-size:24px}.tip{font-size:13px;color:#71675c}section{padding:24px 28px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(410px,1fr));gap:14px}.card{background:#fff;border:1px solid #ddd5ca;border-radius:8px;padding:16px}.meta{font-size:12px;color:#71675c}.topic{margin:8px 0;font-size:14px;line-height:1.5}.cover{margin:12px 0;padding:16px;border-radius:7px;background:#201d1a;color:#fff}.cover b{display:block;color:#ffe56a;font-size:26px;line-height:1.2}.cover span{display:block;margin-top:7px;color:#eee5d5}.selected{padding:10px;background:#fff3c7;border:1px solid #dfc263;border-radius:6px;font-weight:800}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:14px}td{padding:8px 4px;border-top:1px solid #eee8df;vertical-align:top}td:first-child{width:72px;color:#a12e2e;font-weight:800}.len{color:#8b8177;font-size:11px;margin-left:5px}.why{color:#80766d;font-size:12px;margin-top:3px}</style></head><body><header><h1>两商品标题矩阵终审</h1><div class="tip">每个模板独立选题；文字标题13-20字，封面标题10-20字；无截断。usage: ${escape(JSON.stringify(usage))}</div></header>${groups.map(group => `<section><h2>${group.prefix} · ${group.rows.length}个模板</h2><div class="grid">${group.rows.map(row => `<article class="card"><div class="meta">${escape(row.cardId)} · ${escape(row.template)} · ${escape(row.topicType)}</div><div class="topic"><b>选题：</b>${escape(row.topic)}</div><div class="topic"><b>痛点：</b>${escape(row.pain)}</div><div class="cover"><b>${escape(row.coverTitle)} <small class="len">${Array.from(row.coverTitle).length}字</small></b><span>${escape(row.coverSubtitle)}</span></div><div class="selected">文字标题：${escape(row.selectedTextTitle)} <small class="len">${Array.from(row.selectedTextTitle).length}字</small></div><table>${row.textTitles.map((item: any) => `<tr><td>${escape(item.type)}</td><td><b>${escape(item.title)}</b><small class="len">${Array.from(item.title).length}字</small><div class="why">${escape(item.why)}</div></td></tr>`).join('')}</table></article>`).join('')}</div></section>`).join('')}</body></html>`;
}
