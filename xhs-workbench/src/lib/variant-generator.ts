import { SkillData, ChainId, CoverTemplateId, TitleTemplateId } from '@/types/data';
import { CoverVariant } from '@/types/workflow';
import { getCoverStylesForTemplate } from './cover-style-library';
import { getReferenceCoversForStyle } from './reference-cover-library';

interface VariantInput {
  chainId: ChainId;
  contentCore: string;
  coverTemplateId: CoverTemplateId;
  titleTemplateId: TitleTemplateId;
  data: SkillData;
}

interface ContentAnalysis {
  productName: string;
  productShort: string;
  isDelf: boolean;
  target: string;
  pain: string;
  asset: string;
  action: string;
  count: string;
  optionA: string;
  optionB: string;
}

export function generateCoverVariants(input: VariantInput): CoverVariant[] {
  const { chainId, contentCore, coverTemplateId, titleTemplateId, data } = input;
  const chain = data.chains[chainId];
  const titleTemplate = data.title_templates[titleTemplateId];
  const seoData = data.seo_tags[chain.product_id];
  const analysis = analyzeContent(contentCore, chainId, data);
  const styles = getCoverStylesForTemplate(coverTemplateId);
  const seoWords = [...seoData.core_keywords, ...seoData.long_tail_keywords];

  return styles.map((style, index) => {
    const copy = buildCopy(titleTemplateId, analysis, index);
    const refs = getReferenceCoversForStyle(style.id);
    const refSummary = refs
      .map(ref => `${ref.imageFile}:${ref.layoutSignals.join('/')}`)
      .join(' | ');
    const mimicRules = refs.flatMap(ref => ref.mimicRules).slice(0, 5).join('；');
    return {
      id: `variant_${index + 1}`,
      version_type: style.name,
      competitor_style_id: style.id,
      cover_title: copy.coverTitle,
      cover_title_lines: copy.coverTitle.split('\n').filter(Boolean),
      xhs_title: copy.xhsTitle,
      title_source: `标题母版：${titleTemplate.name}`,
      migration_logic: `${copy.logic}；参考竞品信号：${style.benchmarkSignal}`,
      seo_keywords: pickSeo(seoWords, index),
      cover_template_id: coverTemplateId,
      title_template_id: titleTemplateId,
      layout_notes: `style_id=${style.id}; ${style.visualRule}; reference=${refSummary}; mimic_rules=${mimicRules}`,
    };
  });
}

function analyzeContent(contentCore: string, chainId: ChainId, data: SkillData): ContentAnalysis {
  const chain = data.chains[chainId];
  const product = data.products[chain.product_id];
  const isDelf = chain.product_id === 'delf_b2_writing';
  const text = `${contentCore}\n${chain.content_intent}`;
  const number = text.match(/\d+/)?.[0] || (isDelf ? '20' : '30');
  const hasB2Compare = /B2|普通|表达|写法/.test(text);

  return {
    productName: product.public_name_options[0],
    productShort: isDelf ? 'B2写作' : 'TEF/TCF',
    isDelf,
    target: isDelf ? 'B2' : 'CLB7',
    pain: inferPain(text, chainId),
    asset: inferAsset(text, chainId),
    action: inferAction(text, chainId),
    count: number,
    optionA: hasB2Compare ? '普通写法' : 'TEF',
    optionB: hasB2Compare ? 'B2写法' : 'TCF',
  };
}

function buildCopy(templateId: TitleTemplateId, a: ContentAnalysis, index: number) {
  const n = index % 2;
  switch (templateId) {
    case 'checklist_ready':
      return n === 0
        ? seed(`${a.asset}\n我整理好了`, `${a.productName}${a.asset}整理好了，直接按模块看`, '整理好 + 降低搜索成本')
        : seed(`${a.productShort}\n这份清单先收好`, `${a.productShort}备考这份${a.asset}先收好，考前也能翻`, '收藏感 + 资料包价值');
    case 'compare_choice':
      return n === 0
        ? seed(`${a.optionA}还是${a.optionB}\n先看这张表`, `${a.optionA}还是${a.optionB}？先看这张对照表再决定`, 'A/B选择 + 决策降低成本')
        : seed(`别选完才后悔\n先看${a.count}个差别`, `${a.productShort}别选完才后悔，先看这${a.count}个关键差别`, '后悔规避 + 表格承接');
    case 'dont_only':
      return n === 0
        ? seed(`别再${a.action}了`, `${a.productName}别再${a.action}了，先把${a.asset}用对`, '停止低效动作')
        : seed(`停止乱学\n先看这份资料`, `${a.productShort}停止乱学，先用这份${a.asset}把方向理清`, '停止 + 替代动作');
    case 'mistake_warning':
      return n === 0
        ? seed(`${a.productShort}\n这些写法很掉分`, `${a.productName}这些写法看着没错，但容易拉低质感`, '隐藏错误提醒')
        : seed(`看着没错\n但不像${a.target}`, `${a.productShort}这些表达看着没错，但写出来不像${a.target}`, '认知冲突 + 错对对照');
    case 'exam_rescue':
      return n === 0
        ? seed(`考前${a.count}天\n先看这份清单`, `${a.productShort}考前${a.count}天先看这份清单，别再全量乱复习`, '时间压力 + 清单急救')
        : seed(`${a.target}冲刺\n重点别抓错`, `${a.productName}${a.target}冲刺阶段，重点别抓错`, '目标冲刺 + 优先级');
    case 'roadmap_planning':
      return n === 0
        ? seed(`${a.count}天\n怎么冲${a.target}`, `${a.productName}${a.count}天怎么安排？别再每天瞎刷题`, '时间 + 目标路径')
        : seed(`${a.productShort}\n三阶段备考路线`, `${a.productName}三阶段备考路线：摸底、专项、模考复盘`, '路径感 + 执行感');
    case 'effort_failed':
      return n === 0
        ? seed(`${a.action}\n还是${a.pain}？`, `${a.productName}${a.action}还是${a.pain}，问题可能不在努力少`, '努力动作 + 失败结果')
        : seed(`你不是不努力\n是资料没拆对`, `${a.productShort}备考不是只靠努力，先把资料拆成能用的步骤`, '反转努力无效');
    case 'not_a_but_b':
    default:
      return n === 0
        ? seed(`最怕的不是不会\n是${a.pain}`, `${a.productName}最怕的不是不会，而是${a.pain}`, '不是A而是B')
        : seed(`不是资料不够\n是没整理成能用`, `${a.productShort}卡住时，先别继续囤资料，重点是整理成能用`, '资料过载反转');
  }
}

function inferPain(text: string, chainId: ChainId): string {
  if (/范文|模板/.test(text) || chainId === 'delf_b2_formula_migration') return '换题还是不会写';
  if (/important|probleme|problème|替换|表达|词/.test(text) || chainId === 'delf_b2_expression_upgrade') return '表达一直像B1';
  if (/错|扣分|中式|不像/.test(text) || chainId === 'delf_b2_mistake_contrast') return '看着没错但很掉分';
  if (/TEF|TCF|选择|区别/.test(text) || chainId === 'tef_tcf_exam_choice') return '选错考试才后悔';
  if (/30|计划|CLB7|阶段/.test(text) || chainId === 'tef_tcf_30_day_clb7') return '每天刷题但没方向';
  return '努力很多但效果不明显';
}

function inferAsset(text: string, chainId: ChainId): string {
  if (/范文/.test(text) || chainId === 'delf_b2_formula_migration') return '范文拆解表';
  if (/句型|句法/.test(text) || chainId === 'delf_b2_sentence_patterns') return '高频句型清单';
  if (/错|扣分/.test(text) || chainId === 'delf_b2_mistake_contrast') return '错题对照表';
  if (/TEF|TCF|选择|区别/.test(text) || chainId === 'tef_tcf_exam_choice') return 'TEF/TCF对照表';
  if (/30|计划|CLB7/.test(text) || chainId === 'tef_tcf_30_day_clb7') return '30天备考表';
  if (/词|替换|important|probl/.test(text)) return 'B2替换词清单';
  return '备考清单';
}

function inferAction(text: string, chainId: ChainId): string {
  if (chainId === 'delf_b2_formula_migration') return '整篇背范文';
  if (chainId === 'delf_b2_expression_upgrade') return '把普通词写到底';
  if (chainId === 'delf_b2_sentence_patterns') return '硬背模板';
  if (chainId === 'delf_b2_mistake_contrast') return '忽略这些写法';
  if (chainId === 'tef_tcf_exam_choice') return '盲选考试';
  if (chainId === 'tef_tcf_30_day_clb7') return '每天瞎刷题';
  return '低效备考';
}

function seed(coverTitle: string, xhsTitle: string, logic: string) {
  return { coverTitle, xhsTitle, logic };
}

function pickSeo(words: string[], index: number): string[] {
  if (words.length <= 2) return words;
  const start = index * 2;
  return words.slice(start, start + 2).concat(words.slice(0, 1)).slice(0, 3);
}
