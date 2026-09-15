/* eslint-disable no-console */
// title-style-library 离线验收（不碰 LLM）：
// - 只读 data/title-style-user-approved.json，30 条真实样本可读；
// - DELFB2 / DELF B2 两种写法只算身份词差异，不算照抄；
// - 空格差异下的整句照抄仍命中；
// - 样本中的强承诺词、数字可复用，不作为禁词误杀；
// - cwd 在项目根目录和临时目录两种情况都能读到样本
//   （对应实现 resolveUserApprovedPath 的 cwd 优先 + 模块相对兜底，不复制样本到临时目录）。
import os from 'node:os';
import {
  setTitleStyleReferencesForTest,
  getTitleStyleReferences,
  formatStyleReferenceForPrompt,
  findStylePlagiarism,
  longestCommonSubstring,
} from '../src/lib/v2/title-style-library';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) {
    console.log(`  ok: ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}

// 1. 真实样本读取（cwd 在项目根目录：走 process.cwd() 路径）
const all = getTitleStyleReferences('delf_b2_writing', 30);
assert(all.length === 30, `读到 30 条用户认可样本（实际 ${all.length}）`);
assert(all.every((ref) => ref.track === 'delf_b2_writing'), '全部样本 track 都是 delf_b2_writing');
assert(all.every((ref) => ref.styleTags.length >= 1), '全部样本带 style_tags');

// 2. 等距抽样覆盖多家族
const spread = getTitleStyleReferences('delf_b2_writing', 8);
assert(spread.length === 8, '默认等距抽样 8 条');
assert(new Set(spread.map((ref) => ref.title)).size === 8, '8 条互不重复');

// 3. 跨赛道不借用
assert(getTitleStyleReferences('tef_tcf_canada', 30).length === 0, 'tef_tcf_canada 不借用 DELF 样本（严格 track 隔离）');

// 4. 测试注入与还原
setTitleStyleReferencesForTest([{ title: '测试样本', styleTags: ['口语感'], track: '' }]);
assert(getTitleStyleReferences('any_product', 8).length === 1, 'override 注入生效');
setTitleStyleReferencesForTest(null);
assert(getTitleStyleReferences('delf_b2_writing', 30).length === 30, 'override 置 null 还原为真实文件');

// 5. 启动目录兜底：cwd 切到临时目录（那里没有样本文件，也不复制）仍读到 30 条
const originalCwd = process.cwd();
try {
  process.chdir(os.tmpdir());
  const fallback = getTitleStyleReferences('delf_b2_writing', 30);
  assert(fallback.length === 30, `cwd 在临时目录时模块相对路径兜底成功（实际 ${fallback.length}）`);
} finally {
  process.chdir(originalCwd);
}

// 6. LCS 基础（含 emoji 码点）
assert(longestCommonSubstring('abcde', 'xbcdy') === 'bcd', 'LCS 基础正确');
assert(longestCommonSubstring('写作😭自查', '😭自查清单') === '😭自查', 'LCS 按 Unicode 码点计数（emoji 不截半）');

// 7. DELFB2 / DELF B2 写法差异不算照抄（身份词+通用词共用放行）
assert(findStylePlagiarism('DELFB2写作备考锦囊请收好', all).length === 0,
  'DELFB2 连写 vs 样本 DELF B2 带空格：仅身份写法差异，不判照抄');
assert(findStylePlagiarism('DELF B2写作攻略自查清单', all).length === 0,
  'DELF B2 带空格候选与多条样本只共享身份/通用词，不判照抄');

// 8. 空格差异下的整句照抄仍命中
const exactHits = findStylePlagiarism('关于我把 DELF B2 写作攻略 整理成 资料库 这件事', all);
assert(exactHits.length === 1 && exactHits[0].span === '整句相同', '空格打散的整句照抄命中「整句相同」');

// 9. 只换词的骨架照抄命中（独特短语残留）
const swapHits = findStylePlagiarism('关于我把TEF写作攻略整理成资料库这件事', all);
assert(swapHits.length >= 1 && swapHits.some((hit) => hit.span.includes('整理成')),
  '换科目词照搬句式骨架（整理成…）命中独特片段');

// 10. 强承诺词风格可复用，不作为禁词
assert(findStylePlagiarism('26年TEF考试最新范文库', all).length === 0, '复用「最新/范文库」强承诺词不误杀');
assert(findStylePlagiarism('两周速成TEF写作提分', all).length === 0, '复用「两周速成」不误杀');

// 11. 数字复用不误杀
assert(findStylePlagiarism('50篇范文我都刷完了', all).length === 0, '共用「50篇范文」数字短语不误杀');

// 12. 近逐字骨架照抄仍命中（独特词「方式」残留）
const skeletonHits = findStylePlagiarism('进步最快的方式就是反复啃50篇范文', all);
assert(skeletonHits.length >= 1 && skeletonHits.some((hit) => hit.span.includes('进步最快')),
  '照搬「进步最快的方式…50篇范文」骨架命中');

// 13. prompt 渲染带 style_tags
const sampleForFormat = all.find((ref) => ref.title === '后悔了，怎么没早点刷到这篇B2写作攻略');
assert(
  sampleForFormat !== undefined
    && formatStyleReferenceForPrompt(sampleForFormat) === '「后悔了，怎么没早点刷到这篇B2写作攻略」（后悔感/分享感/口语感）',
  'formatStyleReferenceForPrompt 渲染「标题（标签/标签/标签）」',
);

if (failures) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true }, null, 2));
}
