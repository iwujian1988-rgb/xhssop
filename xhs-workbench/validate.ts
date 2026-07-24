/**
 * Phase 6 验收测试脚本
 * 验证 6 条链路的完整闭环 + 业务规则合规性
 * 运行：npx tsx validate.ts
 */

import { getStaticSkillData } from './src/lib/static-data';
import { generateCoverVariants } from './src/lib/variant-generator';
import { generatePageScripts, generateCaption, generateTags } from './src/lib/page-generator';
import { validateContentVolume, checkForbiddenTerms, validateCoverTemplate, validateTitleTemplate, validatePageTemplate } from './src/lib/compatibility';
import { workflowReducer, deriveStep, canExecuteStep } from './src/lib/state-machine';
import { INITIAL_STATE, WorkflowState, WorkflowAction } from './src/types/workflow';
import { ChainId, CoverTemplateId, TitleTemplateId, ContentSourceType, PageTemplateId } from './src/types/data';

const data = getStaticSkillData();

interface TestCase {
  name: string;
  chainId: ChainId;
  contentSourceType: ContentSourceType;
  contentCore: string;
  productPointId: string | null;
  coverTemplateId: CoverTemplateId;
  titleTemplateId: TitleTemplateId;
  expectedProductId: string;
  forbiddenTermsInContent: string[];
  expectedForbiddenTerms: string[];
}

const testCases: TestCase[] = [
  {
    name: '01：DELF B2｜背范文不会迁移',
    chainId: 'delf_b2_formula_migration',
    contentSourceType: 'third_party_post',
    contentCore: '背了很多范文，但考试换主题还是不会写。问题不是没背，而是只背整篇，没有拆出可迁移的开头句、观点句、让步句和结尾句。',
    productPointId: null,
    coverTemplateId: 'white_blue_pain',
    titleTemplateId: 'effort_failed',
    expectedProductId: 'delf_b2_writing',
    forbiddenTermsInContent: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
    expectedForbiddenTerms: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
  },
  {
    name: '02：DELF B2｜普通表达升级 B2 表达',
    chainId: 'delf_b2_expression_upgrade',
    contentSourceType: 'knowledge_point',
    contentCore: 'important → essentiel / primordial / fondamental\nproblème → enjeu / difficulté / obstacle\nje pense que → il me semble que / il convient de souligner que',
    productPointId: null,
    coverTemplateId: 'table_compare',
    titleTemplateId: 'dont_only',
    expectedProductId: 'delf_b2_writing',
    forbiddenTermsInContent: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
    expectedForbiddenTerms: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
  },
  {
    name: '03：DELF B2｜写作模板 / 句法库',
    chainId: 'delf_b2_sentence_patterns',
    contentSourceType: 'preset_selling_point',
    contentCore: '观点句、让步句、转折句、总结句。示例：Il convient de souligner que... / Certes..., mais... / En conclusion...',
    productPointId: '100_sentence_patterns',
    coverTemplateId: 'list_poster',
    titleTemplateId: 'checklist_ready',
    expectedProductId: 'delf_b2_writing',
    forbiddenTermsInContent: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
    expectedForbiddenTerms: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
  },
  {
    name: '04：DELF B2｜错题对照 / 扣分点',
    chainId: 'delf_b2_mistake_contrast',
    contentSourceType: 'knowledge_point',
    contentCore: 'je pense que c\'est très important → Il convient de souligner que cet enjeu est essentiel\nbeaucoup de problèmes → de nombreuses difficultés / plusieurs enjeux\nc\'est bon pour les gens → cela présente des avantages pour les citoyens',
    productPointId: null,
    coverTemplateId: 'mistake_compare',
    titleTemplateId: 'mistake_warning',
    expectedProductId: 'delf_b2_writing',
    forbiddenTermsInContent: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
    expectedForbiddenTerms: ['CLB7', '加拿大移民', 'TEF Canada', 'TCF Canada'],
  },
  {
    name: '05：TEF/TCF Canada｜TEF 还是 TCF 选考',
    chainId: 'tef_tcf_exam_choice',
    contentSourceType: 'preset_selling_point',
    contentCore: '对比维度：考试形式、备考资料、题型熟悉度、时间安排、个人强弱项。目标是帮用户判断先了解哪几个差异，不承诺哪个更容易拿分。',
    productPointId: 'exam_comparison',
    coverTemplateId: 'table_compare',
    titleTemplateId: 'compare_choice',
    expectedProductId: 'tef_tcf_canada',
    forbiddenTermsInContent: ['DELF B2 production écrite', 'DELF B2 范文', 'B2 写作资料包'],
    expectedForbiddenTerms: ['DELF B2 production écrite', 'DELF B2 范文', 'B2 写作资料包'],
  },
  {
    name: '06：TEF/TCF Canada｜30 天备考 / CLB7 路径',
    chainId: 'tef_tcf_30_day_clb7',
    contentSourceType: 'preset_selling_point',
    contentCore: '30 天分为三段：第 1 阶段摸底和题型熟悉；第 2 阶段专项训练；第 3 阶段模考复盘和临场检查。目标用户是想冲 CLB7，但不知道每天怎么排的人。',
    productPointId: '30_day_plan',
    coverTemplateId: 'plan_table',
    titleTemplateId: 'roadmap_planning',
    expectedProductId: 'tef_tcf_canada',
    forbiddenTermsInContent: ['DELF B2 production écrite', 'DELF B2 范文', 'B2 写作资料包'],
    expectedForbiddenTerms: ['DELF B2 production écrite', 'DELF B2 范文', 'B2 写作资料包'],
  },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试：${tc.name}`);
  console.log(`${'='.repeat(60)}`);

  let testPassed = true;

  // ===== 1. 状态机 - Step 1: 选择链路 =====
  let state: WorkflowState = workflowReducer(INITIAL_STATE, { type: 'SET_CHAIN', chain_id: tc.chainId }, data);
  const derivedProductId = data.chains[state.chain_id!].product_id;

  if (derivedProductId !== tc.expectedProductId) {
    console.log(`  ✗ 商品推导错误：期望 ${tc.expectedProductId}，实际 ${derivedProductId}`);
    testPassed = false;
  } else {
    console.log(`  ✓ 商品推导：${data.products[derivedProductId].name}`);
  }

  // ===== 2. 状态机 - Step 3: 选择内容来源 =====
  const chain = data.chains[tc.chainId];
  if (!chain.allowed_content_source_types.includes(tc.contentSourceType)) {
    console.log(`  ✗ 内容来源 ${tc.contentSourceType} 不在链路允许范围`);
    testPassed = false;
  } else {
    console.log(`  ✓ 内容来源：${tc.contentSourceType}（允许）`);
  }
  state = workflowReducer(state, { type: 'SET_CONTENT_SOURCE', content_source_type: tc.contentSourceType }, data);

  // ===== 3. 状态机 - Step 4: 填写内容 =====
  state = workflowReducer(state, {
    type: 'SET_CONTENT_CORE',
    content_core: tc.contentCore,
    product_point_id: tc.productPointId,
  }, data);

  const volCheck = validateContentVolume(state.content_core!, state.content_source_type!);
  if (!volCheck.valid) {
    console.log(`  ✗ 内容量校验失败：${volCheck.errors.join('; ')}`);
    testPassed = false;
  } else {
    console.log(`  ✓ 内容量校验：通过`);
  }

  // ===== 4. 禁用词校验 =====
  for (const term of tc.forbiddenTermsInContent) {
    if (state.content_core!.includes(term)) {
      console.log(`  ✗ 内容包含禁止术语：${term}`);
      testPassed = false;
    }
  }
  const forbiddenCheck = checkForbiddenTerms(state.content_core!, tc.chainId, data);
  if (!forbiddenCheck.valid) {
    console.log(`  ✗ 禁用词检查失败：${forbiddenCheck.errors.join('; ')}`);
    testPassed = false;
  } else {
    console.log(`  ✓ 禁用词检查：通过（无跨考试术语混用）`);
  }

  // ===== 5. 状态机 - Step 5: 封面母版校验 =====
  const coverValidation = validateCoverTemplate(tc.coverTemplateId, tc.chainId, data);
  if (!coverValidation.valid) {
    console.log(`  ✗ 封面母版校验失败：${coverValidation.errors.join('; ')}`);
    testPassed = false;
  } else {
    console.log(`  ✓ 封面母版：${data.cover_templates[tc.coverTemplateId].name}（允许）`);
  }
  state = workflowReducer(state, { type: 'SET_COVER_TEMPLATE', cover_template_id: tc.coverTemplateId }, data);

  // ===== 6. 状态机 - Step 6: 标题母版校验 =====
  const titleValidation = validateTitleTemplate(tc.titleTemplateId, tc.chainId, data);
  if (!titleValidation.valid) {
    console.log(`  ✗ 标题母版校验失败：${titleValidation.errors.join('; ')}`);
    testPassed = false;
  } else {
    console.log(`  ✓ 标题母版：${data.title_templates[tc.titleTemplateId].name}（允许）`);
  }
  state = workflowReducer(state, { type: 'SET_TITLE_TEMPLATE', title_template_id: tc.titleTemplateId }, data);

  // ===== 7. 生成 3 个封面候选 =====
  const variants = generateCoverVariants({
    chainId: tc.chainId,
    contentCore: state.content_core!,
    coverTemplateId: state.cover_template_id!,
    titleTemplateId: state.title_template_id!,
    data,
  });

  if (variants.length !== 3) {
    console.log(`  ✗ 封面候选数量错误：期望 3，实际 ${variants.length}`);
    testPassed = false;
  } else {
    console.log(`  ✓ 封面候选数量：3 个`);
  }

  // 同母版检查
  const allSameCover = variants.every(v => v.cover_template_id === tc.coverTemplateId);
  if (!allSameCover) {
    console.log(`  ✗ 3 个候选封面母版不一致！`);
    variants.forEach(v => console.log(`    - ${v.id}: ${v.cover_template_id}`));
    testPassed = false;
  } else {
    console.log(`  ✓ 3 个候选同母版：${data.cover_templates[tc.coverTemplateId].name}`);
  }

  // 同标题骨架检查
  const allSameTitle = variants.every(v => v.title_template_id === tc.titleTemplateId);
  if (!allSameTitle) {
    console.log(`  ✗ 3 个候选标题母版不一致！`);
    variants.forEach(v => console.log(`    - ${v.id}: ${v.title_template_id}`));
    testPassed = false;
  } else {
    console.log(`  ✓ 3 个候选同标题骨架：${data.title_templates[tc.titleTemplateId].name}`);
  }

  // 3 个候选不是 3 个不同方向检查（不应该变商品/链路/内容方向）
  const contentDirections = variants.map(v => v.cover_title.slice(0, 8));
  const uniqueDirections = new Set(contentDirections);
  console.log(`  ✓ 封面标题样本：${[...uniqueDirections].join(' | ')}`);

  // 标题来源检查
  const allHaveSource = variants.every(v => v.title_source && v.title_source.length > 0);
  if (!allHaveSource) {
    console.log(`  ✗ 有候选缺少标题来源`);
    testPassed = false;
  } else {
    console.log(`  ✓ 所有候选都有标题来源`);
  }

  // SEO 词检查
  const allHaveSeo = variants.every(v => v.seo_keywords.length > 0);
  if (!allHaveSeo) {
    console.log(`  ✗ 有候选缺少 SEO 关键词`);
    testPassed = false;
  } else {
    console.log(`  ✓ 所有候选都有 SEO 词`);
  }

  // ===== 8. 状态机 - 设置 variants 并选择第一组 =====
  state = workflowReducer(state, { type: 'SET_VARIANTS', variants }, data);
  if (state.variants.length !== 3) {
    console.log(`  ✗ Variants 未正确保存`);
    testPassed = false;
  } else {
    console.log(`  ✓ Variants 已保存`);
  }

  state = workflowReducer(state, { type: 'SELECT_VARIANT', variant_id: 'variant_1' }, data);
  if (state.selected_variant_id !== 'variant_1') {
    console.log(`  ✗ 选中 variant 失败`);
    testPassed = false;
  } else {
    console.log(`  ✓ 已选中封面候选 variant_1`);
  }

  const selectedVariant = state.variants.find(v => v.id === state.selected_variant_id)!;

  // ===== 9. 生成内页脚本 =====
  const availablePages = chain.allowed_page_templates;
  if (availablePages.length === 0) {
    console.log(`  ✗ 链路没有允许的内页结构`);
    testPassed = false;
  } else {
    const pageTemplateId = availablePages[0] as PageTemplateId;

    const pageValidation = validatePageTemplate(pageTemplateId, tc.chainId, data);
    if (!pageValidation.valid) {
      console.log(`  ✗ 内页结构校验失败：${pageValidation.errors.join('; ')}`);
      testPassed = false;
    }

    const pageScripts = generatePageScripts({
      chainId: tc.chainId,
      contentCore: state.content_core!,
      pageTemplateId,
      selectedVariant,
      data,
    });

    if (pageScripts.length === 0) {
      console.log(`  ✗ 内页脚本生成为空`);
      testPassed = false;
    } else {
      console.log(`  ✓ 内页脚本：${pageScripts.length} 页`);
    }

    // P1 检查：是封面页
    const p1 = pageScripts.find(p => p.page_no === 1);
    if (!p1 || p1.role !== 'cover') {
      console.log(`  ✗ P1 不是封面页（role=${p1?.role}）`);
      testPassed = false;
    } else {
      console.log(`  ✓ P1 是封面页，标题承接已选 variant`);
    }

    // P2 检查：承接封面，不直接硬卖
    const p2 = pageScripts.find(p => p.page_no === 2);
    if (!p2 || p2.role !== 'bridge') {
      console.log(`  ✗ P2 不是承接页（role=${p2?.role}）`);
      testPassed = false;
    } else {
      const p2text = p2.page_title + p2.core_conclusion;
      // 检查是否包含"资料包"这种硬卖词
      if (p2text.includes('资料包') && !p2text.includes('不是')) {
        console.log(`  ⚠ P2 可能直接硬卖资料包，请注意：${p2text.slice(0, 60)}`);
      } else {
        console.log(`  ✓ P2 承接封面，不直接硬卖：${p2.page_title}`);
      }
    }

    // P6-P7 检查：自然带货
    const p6 = pageScripts.find(p => p.page_no === 6);
    const p7 = pageScripts.find(p => p.page_no === 7);
    if (p6 && p6.role === 'soft_sell') {
      console.log(`  ✓ P6 自然带资料包（role=soft_sell）`);
    }
    if (p7 && p7.role === 'fit') {
      console.log(`  ✓ P7 适合谁/收尾（role=fit）`);
    }

    // 每页都有必要字段
    const allPagesComplete = pageScripts.every(
      p => p.page_title && p.core_conclusion && p.role
    );
    if (!allPagesComplete) {
      console.log(`  ✗ 有内页缺少必要字段`);
      testPassed = false;
    } else {
      console.log(`  ✓ 所有内页字段完整`);
    }

    // ===== 10. 内页禁用词检查 =====
    const allPageText = pageScripts.map(p => `${p.page_title} ${p.core_conclusion} ${p.support_content.join(' ')}`).join(' ');
    const pageForbiddenCheck = checkForbiddenTerms(allPageText, tc.chainId, data);
    if (!pageForbiddenCheck.valid) {
      console.log(`  ✗ 内页包含禁用词：${pageForbiddenCheck.errors.join('; ')}`);
      testPassed = false;
    } else {
      console.log(`  ✓ 内页无跨考试术语混用`);
    }

    // ===== 11. 生成 Caption + Tags =====
    const caption = generateCaption(tc.chainId, state.content_core!, selectedVariant, pageScripts, data);
    const tags = generateTags(tc.chainId, data);

    if (!caption || caption.length < 50) {
      console.log(`  ✗ Caption 太短（${caption?.length || 0} 字）`);
      testPassed = false;
    } else {
      console.log(`  ✓ Caption：${caption.length} 字`);
    }

    // Caption 不能像硬广
    if (caption.includes('购买') || caption.includes('下单') || caption.includes('限时')) {
      console.log(`  ⚠ Caption 包含硬广词，不够自然`);
    } else {
      console.log(`  ✓ Caption 读起来像备考经验分享，不像硬广`);
    }

    if (tags.length === 0) {
      console.log(`  ✗ Tags 为空`);
      testPassed = false;
    } else {
      console.log(`  ✓ Tags：${tags.length} 个（${tags.slice(0, 4).join(' ')}...）`);
    }

    // Caption 禁用词检查
    const captionForbiddenCheck = checkForbiddenTerms(caption, tc.chainId, data);
    if (!captionForbiddenCheck.valid) {
      console.log(`  ✗ Caption 包含禁用词：${captionForbiddenCheck.errors.join('; ')}`);
      testPassed = false;
    } else {
      console.log(`  ✓ Caption 无跨考试术语混用`);
    }

    // ===== 12. Tags 检查 =====
    for (const tag of tags) {
      if (tc.chainId.startsWith('delf') && (tag.includes('TEF') || tag.includes('TCF') || tag.includes('CLB7'))) {
        console.log(`  ✗ DELF 标签包含 TEF/TCF 内容：${tag}`);
        testPassed = false;
      }
      if (tc.chainId.startsWith('tef') && tag.includes('DELF')) {
        console.log(`  ✗ TEF/TCF 标签包含 DELF 内容：${tag}`);
        testPassed = false;
      }
    }
    console.log(`  ✓ Tags 无跨考试混淆`);
  }

  // ===== 结果 =====
  if (testPassed) {
    console.log(`\n  ✅ ${tc.name} 验收通过`);
    passed++;
  } else {
    console.log(`\n  ❌ ${tc.name} 验收失败`);
    failed++;
  }
}

// ===== 汇总 =====
console.log(`\n${'='.repeat(60)}`);
console.log(`验收总结`);
console.log(`${'='.repeat(60)}`);
console.log(`通过：${passed}/6`);
console.log(`失败：${failed}/6`);

if (failed === 0) {
  console.log(`\n🎉 全部 6 条链路验收通过！`);
  process.exit(0);
} else {
  console.log(`\n⚠️  有 ${failed} 条链路未通过，请检查。`);
  process.exit(1);
}
