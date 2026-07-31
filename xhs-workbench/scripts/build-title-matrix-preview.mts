/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { competitorCreativeCards } from '../src/lib/creative-card-library';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { planSeededTopics } from '../src/lib/editorial-seed-library';
import { loadProductFacts } from '../src/lib/product-facts-loader';
import type { CreativeCardRenderer, MigratedTopic } from '../src/types/reference-workflow';
import type { ProductId } from '../src/types/data';

const products: { id: ProductId; label: string; identity: string }[] = [
  { id: 'delf_b2_writing', label: '商品1 DELF B2 写作知识库', identity: 'DELF B2写作' },
  { id: 'tef_tcf_canada', label: '商品2 TEF/TCF Canada 备考资料包', identity: 'TEF/TCF Canada' },
];

const cards = competitorCreativeCards.filter(card => card.supported);

const rows: PreviewRow[] = [];

for (const product of products) {
  const facts = await loadProductFacts(product.id);
  for (const card of cards) {
    const spec = getCoverTemplateSpec(card.renderer_id);
    if (!spec) continue;
    const topics = planSeededTopics({
      productId: product.id,
      card,
      facts,
      direction: '标题预览：每个封面模板给一个适合小红书的选题，标题要有点击欲，封面标题要和模板匹配。',
      limit: 4,
      recentSeedIds: [],
    });
    const topic = pickTopic(topics);
    const pack = buildTitlePack(product, card.renderer_id, topic);
    rows.push({
      product: product.label,
      cardId: card.id,
      template: spec.name,
      renderer: card.renderer_id,
      topic: topic.topic,
      topicType: topic.topic_type || '',
      audience: topic.audience,
      pain: topic.pain,
      coverTitle: pack.coverTitle,
      coverSubtitle: pack.coverSubtitle,
      textTitles: pack.textTitles,
      note: pack.note,
    });
  }
}

const htmlPath = 'title-matrix-preview.html';
const jsonPath = 'title-matrix-preview.json';
await fs.writeFile(jsonPath, JSON.stringify(rows, null, 2), 'utf8');
await fs.writeFile(htmlPath, renderHtml(rows), 'utf8');
console.log(`HTML=${htmlPath}`);
console.log(`JSON=${jsonPath}`);

interface PreviewRow {
  product: string;
  cardId: string;
  template: string;
  renderer: CreativeCardRenderer;
  topic: string;
  topicType: string;
  audience: string;
  pain: string;
  coverTitle: string;
  coverSubtitle: string;
  textTitles: { type: string; title: string; why: string }[];
  note: string;
}

function pickTopic(topics: MigratedTopic[]) {
  const priority = ['product_showcase', 'search_pain', 'selling_point', 'narrow_knowledge'];
  return topics.slice().sort((a, b) => {
    const ai = priority.indexOf(a.topic_type || '');
    const bi = priority.indexOf(b.topic_type || '');
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  })[0] || topics[0];
}

function buildTitlePack(
  product: { id: ProductId; identity: string },
  renderer: CreativeCardRenderer,
  topic: MigratedTopic,
) {
  const identity = product.identity;
  const object = inferObject(topic, product.id);
  const scene = inferScene(topic, product.id);
  const pain = inferPain(topic, product.id);
  const time = inferTime(topic, product.id);
  const isDirectory = ['parchment_dense_directory', 'white_green_directory', 'clean_purple_directory', 'grid_purple_directory', 'vocab_table', 'collocation_dense', 'book_cover'].includes(renderer);
  const isEmotion = ['notebook_big_words', 'plain_experience', 'memo_offer', 'blackboard_offer'].includes(renderer);

  let coverTitle = `${identity}${object}速查`;
  let coverSubtitle = `${scene}先看这张表`;
  let note = '资料型封面：优先大全、速查、稀缺、时效。';

  if (renderer === 'parchment_dense_directory') {
    coverTitle = `${identity}${object}大全`;
    coverSubtitle = `${time}先收藏这张体系表`;
  } else if (renderer === 'white_green_directory' || renderer === 'clean_purple_directory' || renderer === 'grid_purple_directory') {
    coverTitle = `${identity}${object}清单`;
    coverSubtitle = `${scene}照着查，别散着背`;
  } else if (renderer === 'blackboard_phrase' || renderer === 'collocation_dense') {
    coverTitle = `${identity}${object}别乱背`;
    coverSubtitle = `按场景分类，写作口语都能套`;
  } else if (renderer === 'memo_offer') {
    coverTitle = `${identity}${pain}一直在扣分`;
    coverSubtitle = `这页备忘录先存起来`;
    note = '备忘录模板：封面标题必须先打痛点，再补资料。';
  } else if (renderer === 'notebook_big_words') {
    coverTitle = `${identity}${pain}的人先看`;
    coverSubtitle = `不是努力少，是方向没对`;
    note = '手写痛点模板：封面标题要像提醒/警告。';
  } else if (renderer === 'plain_experience') {
    coverTitle = `${identity}${pain}真的别硬扛`;
    coverSubtitle = `先把方法换一下`;
    note = '真人经验模板：封面标题要有关系感，不做资料名。';
  } else if (renderer === 'document_analysis') {
    coverTitle = `${identity}${object}解析`;
    coverSubtitle = `把高分表达拆给你看`;
  } else if (renderer === 'course_roadmap') {
    coverTitle = `${identity}${time}这样排`;
    coverSubtitle = `先补短板，再刷题`;
  } else if (renderer === 'word_flashcard') {
    coverTitle = `${identity}${object}必背`;
    coverSubtitle = `这几个别再混`;
  }

  const textTitles = [
    {
      type: '资料型',
      title: `${identity}${object}整理好了，${scene}直接翻这页`,
      why: '承接搜索词和资料获得感。',
    },
    {
      type: '解释型',
      title: `${identity}${pain}，多数人卡在这一步`,
      why: '解释痛点来源，适合正文展开。',
    },
    {
      type: '强钩子型',
      title: `别再乱练${identity}了，先把${object}补上`,
      why: '反常识+行动建议，比“怎么练”更有停留。',
    },
    {
      type: '情绪型',
      title: `${identity}${pain}的人，看完真的会少走弯路`,
      why: '和用户状态绑定，适合经验/痛点模板。',
    },
    {
      type: '结果型',
      title: `${time}${identity}想冲上去，先抓${object}`,
      why: '给阶段目标和结果感，适合带货承接。',
    },
  ];

  if (isDirectory) {
    textTitles[0].title = `${identity}${object}大全，${scene}先收藏`;
    textTitles[2].title = `${identity}${object}别散着背，这张表够你查`;
  }
  if (isEmotion) {
    textTitles[1].title = `${identity}${pain}，不是你一个人这样`;
    textTitles[3].title = `${identity}${pain}的人，先别急着刷题`;
  }

  return {
    coverTitle: clipCover(coverTitle),
    coverSubtitle: clipSubtitle(coverSubtitle),
    textTitles: textTitles.map(item => ({ ...item, title: clipTextTitle(item.title) })),
    note,
  };
}

function inferObject(topic: MigratedTopic, productId: ProductId) {
  const text = `${topic.seed_id} ${topic.topic} ${topic.content_promise} ${topic.search_terms?.join(' ')}`;
  if (/TEF|TCF|选考|选择/.test(text)) return productId === 'tef_tcf_canada' ? '选考表' : '题型表';
  if (/CLB|自测|差距/.test(text)) return '自测表';
  if (/口语|开口|展开/.test(text)) return '口语展开';
  if (/听力/.test(text)) return '听力训练';
  if (/词汇|单词|vocab/i.test(text)) return '词汇表';
  if (/句型|句法|表达|短语|连接词|开头|结尾/.test(text)) return '表达库';
  if (/范文|素材|解析/.test(text)) return '素材库';
  if (/评分|检查|自查|错误|错题|扣分/.test(text)) return '扣分点';
  if (/计划|路径|30天|安排/.test(text)) return '备考路径';
  return productId === 'tef_tcf_canada' ? '备考资料' : '写作资料';
}

function inferScene(topic: MigratedTopic, productId: ProductId) {
  const text = `${topic.scene} ${topic.search_terms?.join(' ')}`;
  if (/考前|冲刺|最后|临考/.test(text)) return '考前';
  if (/报名|选考|TEF|TCF/.test(text)) return productId === 'tef_tcf_canada' ? '报名前' : '写作前';
  if (/写完|检查|复盘/.test(text)) return '写完后';
  if (/自学|零基础|开始/.test(text)) return '刚开始';
  return productId === 'tef_tcf_canada' ? '备考前' : '练作文前';
}

function inferPain(topic: MigratedTopic, productId: ProductId) {
  const text = `${topic.pain} ${topic.topic}`;
  if (/资料|零散|混乱|到处翻/.test(text)) return '资料太乱';
  if (/卡|不会|想不出|展开/.test(text)) return '写不好';
  if (/错误|扣分|漏|检查/.test(text)) return '老丢分';
  if (/方向|选错|平均用力/.test(text)) return '方向错';
  if (/背|记不住/.test(text)) return '背了用不上';
  return productId === 'tef_tcf_canada' ? '备考没方向' : '写作没思路';
}

function inferTime(topic: MigratedTopic, productId: ProductId) {
  const text = `${topic.topic} ${topic.scene} ${topic.search_terms?.join(' ')}`;
  if (/2026/.test(text)) return '2026年';
  if (/30天|一个月|1个月/.test(text)) return '30天内';
  if (/考前|最后|临考|冲刺/.test(text)) return '考前7天';
  return productId === 'tef_tcf_canada' ? '备考前' : '考前';
}

function clipCover(value: string) {
  return value.length > 20 ? value.slice(0, 20) : value;
}

function clipSubtitle(value: string) {
  return value.length > 26 ? value.slice(0, 26) : value;
}

function clipTextTitle(value: string) {
  return value.length > 32 ? value.slice(0, 32) : value;
}

function renderHtml(data: PreviewRow[]) {
  const grouped = products.map(product => ({
    ...product,
    rows: data.filter(row => row.product === product.label),
  }));
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>标题矩阵预览</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; background: #f6f4ef; color: #1f1f1f; }
    header { position: sticky; top: 0; z-index: 2; background: rgba(246,244,239,.95); border-bottom: 1px solid #ddd5ca; padding: 18px 28px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .tip { color: #675f55; font-size: 14px; }
    section { padding: 24px 28px 8px; }
    h2 { margin: 0 0 14px; font-size: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 14px; }
    .card { background: #fff; border: 1px solid #ded8ce; border-radius: 10px; padding: 16px; box-shadow: 0 8px 24px rgba(40,30,20,.06); }
    .meta { display: flex; gap: 8px; flex-wrap: wrap; color: #756b61; font-size: 12px; margin-bottom: 10px; }
    .pill { background: #eee9df; border-radius: 999px; padding: 3px 8px; }
    .cover { background: #211d1a; color: #fff5df; border-radius: 8px; padding: 14px; margin: 10px 0; }
    .cover-title { font-size: 25px; font-weight: 900; line-height: 1.15; color: #ffe66d; text-shadow: 2px 2px 0 #000; }
    .cover-sub { margin-top: 7px; font-size: 14px; color: #f6f0e0; }
    .topic { color: #40362f; line-height: 1.55; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 14px; }
    td { border-top: 1px solid #eee7dc; padding: 8px 4px; vertical-align: top; }
    td:first-child { width: 72px; color: #9b2e2e; font-weight: 800; }
    .why { color: #777; font-size: 12px; margin-top: 2px; }
    .note { margin-top: 10px; color: #796f66; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <h1>每个封面模板的标题预览</h1>
    <div class="tip">0 token 规则预览：用于看“封面模板 × 选题 × 封面标题 × 文字标题”的匹配方向。不是完整图文生成结果。</div>
  </header>
  ${grouped.map(group => `<section>
    <h2>${escapeHtml(group.label)} · ${group.rows.length} 个封面</h2>
    <div class="grid">
      ${group.rows.map(row => `<article class="card">
        <div class="meta">
          <span class="pill">${escapeHtml(row.cardId)}</span>
          <span class="pill">${escapeHtml(row.template)}</span>
          <span class="pill">${escapeHtml(row.topicType || 'topic')}</span>
        </div>
        <div class="topic"><b>选题：</b>${escapeHtml(row.topic)}</div>
        <div class="topic"><b>用户痛点：</b>${escapeHtml(row.pain)}</div>
        <div class="cover">
          <div class="cover-title">${escapeHtml(row.coverTitle)}</div>
          <div class="cover-sub">${escapeHtml(row.coverSubtitle)}</div>
        </div>
        <table>
          ${row.textTitles.map(item => `<tr>
            <td>${escapeHtml(item.type)}</td>
            <td><b>${escapeHtml(item.title)}</b><div class="why">${escapeHtml(item.why)}</div></td>
          </tr>`).join('')}
        </table>
        <div class="note">${escapeHtml(row.note)}</div>
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
