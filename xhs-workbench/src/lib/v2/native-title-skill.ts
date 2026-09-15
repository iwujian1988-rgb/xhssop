import { readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import type { TitleStageInput } from './title-stage';
import { currentNoteBoundary } from './note-fact-boundary';
import { getProductPromptProfile } from '@/lib/product-prompt-profiles';
import { examScopeContext } from '@/lib/product-exam-context';
import { formatStyleReferenceForPrompt, getTitleStyleReferences } from './title-style-library';

export const NATIVE_TITLE_INPUT_VERSION = 'native-draft-context-2';

export function buildNativeTitlePrompt(input: TitleStageInput) {
  const skillPath = path.join(homedir(), '.codex', 'skills', 'space-xhs-title', 'SKILL.md');
  const systemPrompt = readFileSync(skillPath, 'utf8');
  const profile = getProductPromptProfile(input.topic.productId);
  const examContext = examScopeContext(input.topic.productId, input.topic.examScope);
  const note = input.content.innerPages.map(page => [
    `## 第${page.page_no}页：${page.page_title}`,
    page.lead || '',
    ...page.bullets.map(value => typeof value === 'string' ? value : JSON.stringify(value)),
  ].join('\n')).join('\n\n');
  const titleCoreInput = {
    inputVersion: NATIVE_TITLE_INPUT_VERSION,
    topic: input.topic.topic,
    examIdentity: examContext?.displayIdentity || profile.titleExamIdentity,
    targetAudience: examContext?.audience || profile.titleAudience,
    sourceContext: {
      audienceState: input.topic.audienceState,
      scene: input.topic.scene,
      painOrDesire: input.topic.painOrDesire,
      plannedPromise: input.topic.promise,
      searchTerms: input.topic.seo,
    },
    wholeNoteCore: input.content.wholeNoteCore || input.topic.topic,
    pageRoles: input.content.pagePlan?.map(page => ({ pageId: page.pageId, pageRole: page.pageRole, contributionToCore: page.contributionToCore })) || [],
    platform: '小红书',
    note,
    factBoundary: currentNoteBoundary(input.content),
    previousBatchTitles: (input.recentGeneratedTextTitles || []).slice(-40),
    ...(input.productNoteContext ? { productNote: input.productNoteContext } : {}),
    // Product-specific approval evidence is style-only. Never leak DELF
    // examples into TEF/TCF titles while their own libraries are empty.
    approvedStyleReferences: input.topic.productId === 'delf_b2_writing'
      ? getTitleStyleReferences('delf_b2_writing', Number.MAX_SAFE_INTEGER).map(formatStyleReferenceForPrompt)
      : [],
  };
  const userPrompt = [
    '请完整执行Skill，并按Skill规定的默认标准输出；不要额外凑候选数量、方法数量或风格配额。',
    `赛道身份：这是小红书上的${titleCoreInput.examIdentity}内容，面向${titleCoreInput.targetAudience}。${input.topic.productId === 'delf_b2_writing' ? '' : `\n商品边界：${profile.editorialScopePrompt}`}\n选题：${titleCoreInput.topic}`,
    `选题阶段的读者与任务背景（不是已完成的内容简报；计划承诺须用正文核实）：\n${JSON.stringify(titleCoreInput.sourceContext)}`,
    ...(examContext ? [`考试身份边界：${examContext.rule} 不得把TEF和TCF拼成一个考试名称。`] : []),
    `整篇内容定位：${titleCoreInput.wholeNoteCore}\n主线用于判断标题承诺是否兑现，不是要求每条复述主线。可用正文支持的具体场景、痛点、细节作点击入口，不把局部数量说成整篇数量。请由Skill根据下方完整草稿自行建立内容简报、选择方法并输出全部原生结果；不要求每条塞入考试全称。`,
    ...(input.productNoteContext ? [`商品笔记边界：这是 product_note，不是课程知识笔记。Selling Angle=${input.productNoteContext.angleLabel}；targetBuyer=${input.productNoteContext.targetBuyer}；buyerMoment=${input.productNoteContext.buyerMoment}；mainClaim=${input.productNoteContext.mainClaim}；supportingBenefits=${JSON.stringify(input.productNoteContext.supportingBenefits)}；confirmedProofAssets=${JSON.stringify(input.productNoteContext.assets)}。标题必须围绕已确认商品展示稿和真实素材证明的购买理由，不得把商品写成泛知识课，也不得改变 selling angle。`] : []),
    '生成标题前，先在内容简报中列出5至6个彼此不同、且都由整篇正文兑现的点击理由；再用Skill的方法表达这些理由。候选矩阵至少覆盖5个不同点击理由。不得把单页内容、样本数字或局部练习伪装成整篇交付。',
    titleCoreInput.approvedStyleReferences.length
      ? `以下是用户认可的标题风格样本，只学习人话感、节奏、具体感和情绪强度；绝不复制主题、句子、事实、数字、经历，也不是当前笔记的事实依据：\n${JSON.stringify(titleCoreInput.approvedStyleReferences)}`
      : '',
    `以下是已确认的完整正文（内容事实以正文为准）：\n\n${note}`,
    titleCoreInput.pageRoles.length ? `页面职责（辅助理解组织关系，不是标题句式）：\n${JSON.stringify(titleCoreInput.pageRoles)}` : '',
    titleCoreInput.factBoundary ? `辅助事实边界（不是替代正文的简报，不规定写法；数量须保留对象与来源范围）：\n${JSON.stringify(titleCoreInput.factBoundary)}` : '',
    titleCoreInput.previousBatchTitles.length ? `以下仅用于避免重复句子和反复套同一种开头，不是模仿样本：\n${JSON.stringify(titleCoreInput.previousBatchTitles)}` : '',
  ].filter(Boolean).join('\n\n');
  return { systemPrompt, userPrompt, titleCoreInput, skillPath };
}

/** Extract only the native candidate matrix; never rewrite or re-rank a title. */
export function extractNativeTitleCandidates(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const candidates: Array<{textTitle:string;method:string;hookOrSearchTerm:string;score?:number;risk:string}> = [];
  let columns: string[] | undefined;
  for (const line of lines) {
    // Blank lines inside a matrix must not silently discard its remaining rows.
    if (!line.trim()) continue;
    if (!line.trim().startsWith('|')) { if(candidates.length) break; continue; }
    const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(s=>s.trim());
    const plain = cells.map(s=>s.replace(/\*\*|`/g,''));
    if (plain.some(s=>/候选标题/.test(s)) && plain.some(s=>/方法/.test(s))) { columns=plain; continue; }
    if (!columns || cells.every(s=>/^[-:\s]+$/.test(s))) continue;
    if (!/^\d+$/.test(plain[0] || '')) continue;
    if (cells.length !== columns.length) {
      throw new Error(`NATIVE_TITLE_MATRIX_INVALID:row ${plain[0]} has ${cells.length}/${columns.length} columns; raw report retained`);
    }
    const field=(pattern:RegExp)=>cells[columns!.findIndex(c=>pattern.test(c))] || '';
    const textTitle=field(/候选标题/).replace(/^\*\*(.*)\*\*$/, '$1').replace(/^`(.*)`$/, '$1').replace(/\\\|/g,'|');
    if (!textTitle) continue;
    const score=Number.parseFloat(field(/评分|得分/));
    candidates.push({textTitle,method:field(/方法/),hookOrSearchTerm:field(/钩子|搜索词/),risk:field(/风险/),...(Number.isFinite(score)?{score}:{})});
  }
  return candidates;
}
