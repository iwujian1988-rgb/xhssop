import type { ProductId } from '@/types/data';
import { hasForbiddenProductIdentity } from '@/lib/product-prompt-profiles';

export function normalizeTitleIdentity(value: string, productId?: ProductId) {
  const result = value
    .replace(/法语\s*DELF\s*B2/gi, 'DELF B2')
    .replace(/DELF\s*B2\s*法语/gi, 'DELF B2')
    .replace(/法语\s*B2\s*法语/gi, '法语B2')
    .replace(/B2(?=\d)/gi, 'B2：')
    .replace(/按目的套用语/g, '按目的选表达')
    .replace(/组合法语句/g, '组合表达');
  const reordered = result.replace(/^(.{2,18}[？?!！])\s*(DELF\s*B2写作|法语B2写作|TEF\/TCF(?:\s*Canada)?|TEF\s*Canada|TCF\s*Canada)$/i, '$2：$1');
  // Cross-product contamination is semantic, not cosmetic. Replacing DELF
  // with TEF/TCF can turn an already-wrong task into plausible-looking wrong
  // copy. Drop the title so the product-specific fallback can rebuild it.
  if (productId && hasForbiddenProductIdentity(productId, reordered)) return '';
  return reordered.replace(/DELF B2(?:\s*DELF B2)+/gi, 'DELF B2');
}

export function getPublicEditorialRiskIssues(editorialText: string, caption = editorialText) {
  const issues: string[] = [];
  // AI 套话检测：原 6 种 + 新增常见 LLM 套路。
  // 原：不是 X 而是 Y / 不在于 X 而在于 Y / 问题出在 / 问题的关键 / 很多备考同学 / 其实，
  // 新增：
  //   - "X，让你的 Y 更 Z"——AI 喜欢的"提升体"
  //   - "X 不仅仅是 Y，更是 Z"——递进式空话
  //   - "在 X 的过程中，Y"——翻译腔
  //   - "X 才是 Y 的关键/核心/根本"——结论式空话
  //   - "通过 X，Y 才能 Z"——条件式空话
  //   - "X，让 Y 不再 Z"——制造焦虑式
  //   - "X 的重要性不言而喻"——结论空话
  //   - "X 是一个需要 Y 的过程"——循环定义
  //   - "综上所述/总而言之/总的来说"——AI 议论文尾段标志
  //   - "首先.*其次.*最后"——AI 议论文中段标志（在同一句/段落里出现）
  if (/不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|不仅仅是.{1,18}.{0,4}更是|在.{1,18}的过程中|才是.{1,12}(?:关键|核心|根本)|通过.{1,18}，.{1,12}才能|让.{1,12}不再|重要性不言而喻|是一个需要.{1,18}的过程|综上所述|^总而言之|^总的来说|首先[，,][^。]{0,80}其次[，,][^。]{0,80}最后[，,]/.test(caption)) issues.push('caption_ai_cliche');
  if (/(商品|资料)(里|中|内).{0,10}(有|没有|包含|不含|收录|未收录)/.test(editorialText)) issues.push('public_inventory_relation_claim');
  if (/(?:挽回|提高|提升|多拿|少丢).{0,8}\d+(?:\s*[-~至]\s*\d+)?\s*分|(?:省下|节省).{0,8}(?:至少)?\s*\d+\s*分钟/.test(editorialText)) issues.push('unsupported_score_or_time_claim');
  if (/精准提分|效率翻倍|分数卡在\s*\d+\s*分左右|考前[^。；\n]{0,20}就能/.test(editorialText)) issues.push('unsupported_outcome_claim');
  if (/用\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24}(?:代替|替换|换成)|(?:mais|donc|bien que|en revanche).{0,8}(?:换|替换).{0,18}/i.test(editorialText)) issues.push('unsafe_mechanical_language_replacement');
  if (/(?:正式信|论坛投稿|DELF|B2).{0,18}(?:严禁|一律|必须)/.test(editorialText)) issues.push('overabsolute_public_rule');
  if (/(?:我的|我们的).{0,12}(?:资料|资料包)(?:里|中)|(?:资料|资料包)(?:里|中).{0,10}(?:整理|收录|包含)/.test(editorialText)) issues.push('public_inventory_relation_claim');
  if (/来自.{0,18}(?:资料|资料包|商品)|(?:资料|资料包)(?:里|中|内|提供)/.test(editorialText)) issues.push('public_inventory_relation_claim');
  if (/拿高分|高分句|立刻升级|保证提分|稳拿高分|提分的?关键/.test(editorialText)) issues.push('unsupported_outcome_claim');
  if (/直接套用|直接调用|直接调取|调用功能块|换词就能迁移|替换主题词[，,]?\s*就能|主题词一换/.test(editorialText)) issues.push('overmechanical_content_method');
  if (/230\s*[-~至]\s*280\s*词|(?:至少|≥)\s*\d+\s*(?:个|种|类)?\s*(?:论据|主题词|B2(?:级)?(?:词汇|表达)|虚拟式|条件式|关系从句|连接词|时态)|(?:B2(?:级)?替换|B2(?:级)?表达|主题词|虚拟式|条件式|关系从句|连接词|时态)\s*(?:≥|至少)\s*\d+|每段(?:开头)?\s*(?:必须|都要|至少|有)\s*(?:一个?)?\s*连接词|每段有主题句/.test(editorialText)) issues.push('invented_exam_quantity_rule');
  if (/(?:TEF|TCF|CLB|NCLC).{0,24}(?:官方评分标准|通常要求\s*\d+\s*[-~至]\s*\d+\s*词|三大(?:评分)?维度|少于\s*\d+\s*词)/i.test(editorialText)) issues.push('unsupported_exam_official_rule');
  if (/全程\s*用\s*vous|避免泛指\s*on|正式信.{0,12}(?:不能|禁止|避免).{0,6}\bon\b/i.test(editorialText)) issues.push('overabsolute_register_rule');
  if (/把\s*[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s'’.-]{1,24}换成\s*[A-Za-zÀ-ÿ]/i.test(editorialText)) issues.push('unsafe_mechanical_language_replacement');
  if (/替代\s*(?:donc|mais|on|à mon avis)|强制.{0,20}(?:每段|\d+\s*个?词|虚拟式|条件式|连接词)/i.test(editorialText)) issues.push('unsafe_mechanical_language_replacement');
  if (/观点文.{0,10}(?:有|必须|需要).{0,4}让步段|每个论点.{0,10}(?:例子|解释|数据)/.test(editorialText)) issues.push('overabsolute_public_rule');
  if (/这(?:份|套).{0,12}(?:资料|体系).{0,8}(?:包含|收录|提供)/.test(editorialText)) issues.push('public_inventory_relation_claim');
  if (/(?:开头|结尾|审题|草稿).{0,12}(?:控制|完成|限制).{0,6}\d+\s*分钟|各.{0,8}\d+\s*分钟/.test(editorialText)) issues.push('unsupported_fixed_time_advice');
  if (/正式信.{0,18}(?:大多数情况|任何情况|都适用)|(?:最通用|最标准).{0,12}(?:礼貌|结尾|开头)/.test(editorialText)) issues.push('overabsolute_register_rule');
  if (/(?:上级|长辈).{0,10}(?:结尾|敬语)|非正式一点的正式信/.test(editorialText)) issues.push('misleading_register_explanation');
  return Array.from(new Set(issues));
}

export function hasUnsupportedProductNumberClaim(editorialText: string, evidenceValues: string[]) {
  const evidenceText = evidenceValues.join(' ').replace(/\s+/g, '');
  const claimSentences = editorialText
    .split(/[。！？；\n]/)
    .filter(sentence => /资料|资料包|词汇库|句法库|范文库|示例库|错题库|检查清单|商品/.test(sentence));
  for (const sentence of claimSentences) {
    for (const match of sentence.matchAll(/(\d+)\s*(\+)?\s*(条|项|篇|个|组|类|句|页|结构|表达|示例)/g)) {
      const [, count, plus = '', unit] = match;
      if (!evidenceText.includes(`${count}${plus}${unit}`) && !evidenceText.includes(`${count}${unit}`)) return true;
    }
  }
  return false;
}
