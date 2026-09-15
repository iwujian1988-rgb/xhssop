import { stableHash, type ContentPackage } from './contracts';

export interface FinalOutputFailure { code: string; path?: string; message: string }

const INTERNAL_BRIDGE = /引导用户|用户目前|用户需要|商品提供|本篇免费内容|弥补不足|获取完整支持|转化|承接|商品价值/u;
const MARKUP = /(?:\*\*|__|```|`|<\/?[a-z][^>]*>|\|\s*:?-{3,}:?\s*\||｜\s*:?-{3,}:?\s*｜)/iu;

export function inspectFinalOutput(content: ContentPackage): FinalOutputFailure[] {
  const failures: FinalOutputFailure[] = [];
  const add = (code: string, message: string, path?: string) => failures.push({ code, message, path });
  const entries: Array<{ path: string; text: string }> = [];
  content.innerPages.forEach((page, i) => {
    entries.push({ path: `innerPages[${i}].page_title`, text: page.page_title }, { path: `innerPages[${i}].lead`, text: page.lead });
    page.bullets.forEach((text, j) => entries.push({ path: `innerPages[${i}].bullets[${j}]`, text }));
  });
  entries.push({ path: 'captionParts.opening', text: content.captionParts.opening });
  content.captionParts.value.forEach((text, i) => entries.push({ path: `captionParts.value[${i}]`, text }));
  entries.push({ path: 'captionParts.productBridge', text: content.captionParts.productBridge }, { path: 'captionParts.cta', text: content.captionParts.cta });
  for (const entry of entries) {
    if (MARKUP.test(entry.text)) add('raw_markup_residue', '用户可见内容含 Markdown/HTML', entry.path);
    if (isFragment(entry.text)) add('visible_dangling_fragment', '用户可见内容是残句', entry.path);
  }
  const roots = new Set<string>();
  for (const [index, page] of content.innerPages.entries()) {
    if (page.page_type === 'product_bridge') continue;
    const match = page.page_title.match(/(误区|步骤|第)\s*([一二三四五六七八九十\d]+)/u);
    const root = match ? `${match[1]}:${match[2]}` : '';
    if (root && roots.has(root)) add('root_structure_duplicate', `重复结构标题：${page.page_title}`, `innerPages[${index}]`);
    if (root) roots.add(root);
    const countMatch = `${page.page_title} ${page.lead}`.match(/([二两三四五六七八九十]|\d+)\s*(?:个|项|种|类|维|大)?(?:误区|检查|自查|步骤|主题|文体|观点|方法)/u);
    const expected = countMatch ? parseCount(countMatch[1]) : 0;
    if (expected > 1 && page.bullets.length < expected) add('promised_count_unfulfilled', `承诺${expected}项但仅交付${page.bullets.length}项`, `innerPages[${index}]`);
  }
  const qa = content.finalTeachingQa;
  if (!qa || qa.status !== 'PASS' || !qa.approved || qa.unresolvedBlockingIssues.length) add('final_teaching_qa_failed', 'Final Teaching QA 未通过', 'finalTeachingQa');
  if (!content.captionContentSnapshotHash || content.captionContentSnapshotHash !== stableHash(content.innerPages)) add('caption_stale', 'Caption 页面快照已过期', 'captionContentSnapshotHash');
  if (content.bridgePlan && INTERNAL_BRIDGE.test(Object.values(content.bridgePlan).join('\n'))) add('bridge_internal_language', 'Bridge 泄漏内部运营语言', 'bridgePlan');
  return failures;
}

export function assertFinalOutput(content: ContentPackage) {
  const failures = inspectFinalOutput(content);
  if (failures.length) throw new Error(`FINAL_COMPILE_CHECK_FAILED:${failures.map(item => `${item.code}${item.path ? `@${item.path}` : ''}`).join('；')}`);
}

function isFragment(value: string) {
  const text = value.trim();
  if (/^(?:总结|注意|示例|重点)[：:]?$/u.test(text) || /[“‘（(《【]$/.test(text)) return true;
  return ([['“', '”'], ['‘', '’'], ['（', '）'], ['(', ')'], ['《', '》'], ['【', '】']] as const)
    .some(([left, right]) => text.split(left).length > text.split(right).length);
}

function parseCount(value: string) {
  return Number(value) || ({ 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 } as Record<string, number>)[value] || 0;
}
