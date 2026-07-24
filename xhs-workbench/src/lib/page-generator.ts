import { SkillData, ChainId, PageTemplateId, CopyFormatId } from '@/types/data';
import { PageScript, CoverVariant, PageRole } from '@/types/workflow';

interface PageGenInput {
  chainId: ChainId;
  contentCore: string;
  pageTemplateId: PageTemplateId;
  selectedVariant: CoverVariant;
  data: SkillData;
}

export function generatePageScripts(input: PageGenInput): PageScript[] {
  const { chainId, contentCore, pageTemplateId, selectedVariant, data } = input;
  const chain = data.chains[chainId];
  const product = data.products[chain.product_id];
  const pageTemplate = data.page_templates[pageTemplateId];
  const isDelf = chain.product_id === 'delf_b2_writing';
  const samples = extractSamples(contentCore);

  const pages: PageScript[] = [
    {
      page_no: 1,
      role: 'cover',
      page_title: selectedVariant.cover_title.replace(/\n/g, ' '),
      core_conclusion: selectedVariant.xhs_title,
      support_content: selectedVariant.cover_title_lines,
      copy_format_id: 'conclusion_bullets',
      visual_notes: `封面：${data.cover_templates[selectedVariant.cover_template_id].name}`,
    },
  ];

  Object.entries(pageTemplate.structure).forEach(([key, desc]) => {
    const pageNo = Number(key.replace('P', ''));
    if (pageNo === 1) return;
    pages.push(buildPage(pageNo, desc, mapRole(pageNo), chainId, product.name, isDelf, samples));
  });

  return pages.sort((a, b) => a.page_no - b.page_no);
}

function mapRole(pageNo: number): PageRole {
  if (pageNo === 1) return 'cover';
  if (pageNo === 2) return 'bridge';
  if (pageNo >= 3 && pageNo <= 5) return 'value';
  if (pageNo === 6) return 'soft_sell';
  return 'fit';
}

function buildPage(
  pageNo: number,
  desc: string,
  role: PageRole,
  chainId: ChainId,
  productName: string,
  isDelf: boolean,
  samples: string[],
): PageScript {
  if (role === 'bridge') {
    return {
      page_no: pageNo,
      role,
      page_title: '先说结论',
      core_conclusion: isDelf
        ? 'DELF B2 写作不是越复杂越好，关键是表达、结构和论证要像 B2。'
        : 'TEF/TCF 备考不是越刷越好，关键是先选对考试，再按目标拆任务。',
      support_content: isDelf
        ? ['很多人背了范文，但换题还是不会写。', '问题通常不是没资料，而是不知道怎么迁移。', '先把范文、句型、词汇拆成能直接用的模块。']
        : ['很多人一上来就刷题，但没判断自己离 CLB7 多远。', 'TEF 和 TCF 的适配人群不同，先选错会浪费时间。', '用阶段计划把听说读写拆开练，效率会高很多。'],
      copy_format_id: 'conclusion_bullets',
      visual_notes: `P${pageNo}：${desc}`,
    };
  }

  if (role === 'soft_sell') {
    return {
      page_no: pageNo,
      role,
      page_title: '资料包里怎么整理',
      core_conclusion: isDelf
        ? '我把范文、句型、词汇、错题和检查清单放在同一套路径里，不是让你零散背。'
        : '我把选考、自测、计划、词汇、写作、听说和避坑流程拆成 12 个模块，按阶段用就行。',
      support_content: isDelf
        ? ['20 篇范文：看结构和迁移点。', '240 条词汇 + 100 条句法：用于替换和展开。', '30 条错题 + 36 项清单：写完后自查。']
        : ['先用选考和自测模块判断方向。', '再用 30 天计划安排每天任务。', '最后用写作句型、主题库和避坑清单复盘。'],
      copy_format_id: 'conclusion_bullets',
      visual_notes: `P${pageNo}：${desc}`,
    };
  }

  if (role === 'fit') {
    return {
      page_no: pageNo,
      role,
      page_title: '适合谁',
      core_conclusion: isDelf
        ? '适合能写一点法语，但写出来不像 B2、临考前想系统整理表达的人。'
        : '适合目标 CLB7、时间有限、想把备考路线先理清楚的人。',
      support_content: isDelf
        ? ['B1-B2 过渡，写作经常卡住。', '词汇和句型总停在基础层。', '想把范文拆开用，而不是整篇硬背。']
        : ['不知道 TEF/TCF 怎么选。', '每天能学 1-2 小时，但不知道练什么。', '想少走弯路，按阶段推进。'],
      copy_format_id: 'conclusion_bullets',
      visual_notes: `P${pageNo}：${desc}`,
    };
  }

  return buildValuePage(pageNo, desc, chainId, isDelf, samples);
}

function buildValuePage(
  pageNo: number,
  desc: string,
  chainId: ChainId,
  isDelf: boolean,
  samples: string[],
): PageScript {
  const sampleContent = samples.slice(0, 4);

  if (chainId === 'delf_b2_expression_upgrade') {
    const pageMap = [
      ['先从高频词开始换', '不要一上来背冷门词，先替换作文里反复出现的基础词。'],
      ['替换词要放进句子里', '词汇升级只有进入完整句子，才会真的改变作文质感。'],
      ['最后用清单自查', '写完后检查是否一直重复同一个词、同一种句型。'],
    ];
    return valuePage(pageNo, desc, pageMap[pageNo - 3] || pageMap[0], sampleContent, 'table');
  }

  if (chainId === 'delf_b2_mistake_contrast') {
    const pageMap = [
      ['为什么看着没错也掉分', 'B2 不是只看语法对不对，还看表达丰富度和论证层次。'],
      ['错误写法 vs 优化写法', '左边是学生常见写法，右边是更像 B2 的改法。'],
      ['改完以后怎么复查', '每次写完后按词汇、连接、论证、格式四项自查。'],
    ];
    return valuePage(pageNo, desc, pageMap[pageNo - 3] || pageMap[0], sampleContent, 'wrong_right');
  }

  if (chainId === 'tef_tcf_exam_choice') {
    const pageMap = [
      ['先看核心差异', 'TEF 和 TCF 不是谁绝对更简单，而是谁更适合你的基础和节奏。'],
      ['按这几项判断', '看考试形式、备考资料、个人强弱项、可报名时间。'],
      ['别踩这些坑', '不要只听别人说哪个容易，先按自己的目标和时间做判断。'],
    ];
    return valuePage(pageNo, desc, pageMap[pageNo - 3] || pageMap[0], sampleContent, 'table');
  }

  if (chainId === 'tef_tcf_30_day_clb7') {
    const pageMap = [
      ['第 1 阶段：摸底', '先测当前水平和各项差距，不要一上来盲目刷题。'],
      ['第 2 阶段：专项', '把最拖后腿的项目单独练，每天固定复盘。'],
      ['第 3 阶段：模考', '最后阶段减少新内容，重点做全真模考和错题复盘。'],
    ];
    return valuePage(pageNo, desc, pageMap[pageNo - 3] || pageMap[0], sampleContent, 'steps');
  }

  const fallback = isDelf
    ? [
        ['把范文拆开，不要整篇背', '真正能迁移的是结构、句型和观点，不是原文。'],
        ['按功能整理句型', '开头、观点、让步、转折、总结分开记，使用时更快。'],
        ['写完后用清单复查', '先看论证，再看表达，最后看格式和连接词。'],
      ]
    : [
        ['先判断目标差距', '目标 CLB7 前，先知道自己哪一项最弱。'],
        ['按阶段用资料', '不同阶段用不同模块，不要一开始全看完。'],
        ['复盘比刷题更重要', '每次练习后要知道错在哪里、下次怎么改。'],
      ];

  return valuePage(pageNo, desc, fallback[pageNo - 3] || fallback[0], sampleContent, 'conclusion_bullets');
}

function valuePage(
  pageNo: number,
  desc: string,
  pair: string[],
  samples: string[],
  format: CopyFormatId,
): PageScript {
  return {
    page_no: pageNo,
    role: 'value',
    page_title: pair[0],
    core_conclusion: pair[1],
    support_content: samples.length > 0 ? samples : ['先看结论，再看例子。', '不要只收藏，要按步骤用。', '每次练完做一次复盘。'],
    copy_format_id: format,
    visual_notes: `P${pageNo}：${desc}`,
  };
}

function extractSamples(content: string): string[] {
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('//'));
  if (lines.length >= 3) return lines.slice(0, 5);
  if (lines.length > 0) return lines;
  return [];
}

export function generateCaption(
  chainId: ChainId,
  contentCore: string,
  selectedVariant: CoverVariant,
  pageScripts: PageScript[],
  data: SkillData,
): string {
  const chain = data.chains[chainId];
  const product = data.products[chain.product_id];
  const isDelf = product.id === 'delf_b2_writing';
  const valuePoints = pageScripts
    .filter(p => p.role === 'value')
    .slice(0, 2)
    .map(p => `- ${p.core_conclusion}`)
    .join('\n');

  if (isDelf) {
    return `${selectedVariant.xhs_title}

很多人准备 DELF B2 写作，会先去背范文、背句子。
但写出来不像 B2，有时不是因为不会写，而是常用表达一直停在基础层，句子结构也太单一。

${valuePoints}

我整理这套资料时，把范文、替换词、句法、错题和检查清单放在一条路径里。
不是让你硬背高级词，而是知道每类表达应该放到哪种句子里。

适合 B1-B2 之间、能写一点但写不出 B2 感、临考前想集中整理写作表达的人。`;
  }

  return `${selectedVariant.xhs_title}

准备 TEF/TCF Canada 的时候，最容易踩的坑不是不够努力，而是方向没先定好。
尤其是目标 CLB7 的同学，先判断考试、差距和阶段任务，比一上来刷题更重要。

${valuePoints}

这套资料把选考、自测、30 天计划、词汇、写作、听力口语和避坑经验拆成 12 个模块。
不是让你全部看完，而是按阶段该用什么就用什么。

适合目标 CLB7、备考时间碎片化、想用更清楚路径推进的人。`;
}

export function generateTags(chainId: ChainId, data: SkillData): string[] {
  const chain = data.chains[chainId];
  return data.products[chain.product_id].default_tags;
}
