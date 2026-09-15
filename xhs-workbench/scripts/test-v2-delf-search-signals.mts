/* eslint-disable no-console */
import { buildDelfB2SearchTags, getDelfB2RelatedSearchPhrases } from '../src/lib/v2/delf-search-signals';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) console.log(`  ok: ${message}`);
  else { failures += 1; console.error(`  FAIL: ${message}`); }
}

const context = 'DELF B2正式信范文迁移方法：先拆段落结构，再把模板用到新题。';
const phrases = getDelfB2RelatedSearchPhrases(context);
assert(phrases.includes('法语写作') && phrases.includes('法语作文模板'), '结构内容映射到实测存在的写作和模板词');
assert(!phrases.some(item => item.includes('DELF B2写作模板') || item.includes('DELF B2写作信件')), '不再返回人为拼接的低流量长尾词');

const tags = buildDelfB2SearchTags(context, ['模板', '观点库_36条']);
assert(tags.length === 6, '最终固定输出6个已有大词/真实相关搜索标签');
assert(tags.includes('#法语写作') && tags.includes('#delfb2作文'), '结构内容输出真实的写作大词和精准词');
assert(!tags.includes('#观点库_36条'), '内容 tagMaterial 中未验证的小众词不进入标签');
assert(!tags.some(tag => /_\d+条|资料库|观点库|词汇库|DELFB2写作(?:模板|句型|连接词|表达)/u.test(tag)), '不输出内部资料名和自造冷门tag');

const generic = buildDelfB2SearchTags('DELF B2写作里如何避免句子生硬');
assert(generic.length === 6, '没有具体长尾命中时仍固定输出6个强相关话题');
assert(generic.includes('#法语写作'), '无具体主题时也保留真实的写作大词');
assert(!generic.some(tag => /句子生硬|避免句子|资料库|观点库/u.test(tag)), '不把正文里的细碎说法直接制造成新tag');

const sentenceTags = buildDelfB2SearchTags('用连接词和句型让论证更清楚', [], new Map(), 'job-a');
const correctionTags = buildDelfB2SearchTags('写完以后按评分项批改和纠错', [], new Map(), 'job-b');
assert(sentenceTags.includes('#法语语法') && sentenceTags.includes('#法语表达'), '句型/论证内容落到真实语法和表达话题');
assert(correctionTags.includes('#法语备考冲刺') && correctionTags.includes('#delfb2题库'), '批改类内容输出真实的备考和题库词');
assert(sentenceTags.join('|') !== correctionTags.join('|'), '不同选题不再输出完全相同的标签组');

const used = new Map<string, number>([['法语', 8], ['学习法语', 0], ['法语写作', 7], ['法语作文', 0]]);
const rotated = buildDelfB2SearchTags('DELF B2写作如何学', [], used, 'job-c');
assert(rotated.includes('#学习法语') && rotated.includes('#法语作文'), '同层大词会参考近30天使用次数轮换');

if (failures) {
  console.error(`\n${failures} FAILURES`);
  process.exitCode = 1;
} else {
  console.log('\nALL PASS');
}
