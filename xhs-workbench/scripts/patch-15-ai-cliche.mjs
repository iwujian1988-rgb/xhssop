/* eslint-disable no-console */
/**
 * 修补 5 个 caption 含 AI 套话的 jobs。
 * 重写 caption，去除"其实""别只看X，更要看Y"等套话，保留事实信息。
 *
 * 用法：node scripts/patch-15-ai-cliche.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const PATCHES = {
  // resource_02: 去 "其实" + 缩短
  'data/batches/batch_1785854296934/jobs/job_002.json': {
    caption: [
      'DELF B2写作别再乱存资料了。手机里几十个语法帖，真到写的时候还是不知道用哪个。',
      '正式信开头结尾就那么几类，按场景分好组，考场上按语境调用就行。',
      '开头：给机构用 Madame, Monsieur + Je me permets de vous écrire；',
      '回复广告用 Suite à votre annonce；投诉用 J\'ai l\'honneur de vous adresser。',
      '结尾：正式用 Je vous prie d\'agréer...，期待回复用 Dans l\'attente de votre réponse。',
      '别死背，要按功能分组。表达观点用 À mon avis、Je pense que；连接用 Tout d\'abord、Ensuite、Cependant。',
      '考前1-2周集中按功能过一遍，比刷整本资料管用得多。',
    ].join(''),
  },
  // resource_04: 去 "其实你只需要"
  'data/batches/batch_1785854296934/jobs/job_007.json': {
    caption: [
      'DELF B2写作，开头结尾别再临时拼凑。',
      '资料越多越乱？你需要的是一套按场景分类的表达库，而不是再多存几篇范文。',
      '这篇笔记整理了正式信开头和结尾的常用表达，按场景分组：',
      '回应公告、回复来信、提出请求、表达感谢，各配了例句。',
      '结尾分正式、礼貌、期待回复三种语气，参考后按题目改写。',
      '用法：先判断题目是投诉、申请还是建议，选对应开头；再根据和对方的关系选结尾。',
      '写之前先定好开头结尾，再补主体，效率高很多。',
      '全文至少250词，开头结尾各一小段即可。别用口语化的Salut，也别把Cordialement当结尾。',
    ].join(''),
  },
  // resource_12: 去 "别只看X，更要看Y"
  'data/batches/batch_1785854296934/jobs/job_013.json': {
    caption: [
      'DELF B2写作，没思路和有想法却写不出都是常见问题。',
      '主题词汇表能帮你解决：按环保、科技、教育等5大主题分类，每个词配中文释义，参考后按题目改写。',
      '比如写环保，用「le développement durable」「la pollution」展开观点，比干巴巴的「il faut protéger」强得多。',
      '使用时先看题目主题，选3-5个词写进提纲，再连成句子。',
      '正式信通常用「vous」，论坛投稿可根据对象选择「tu」或「vous」，别混。',
      '使用时可以先看封面总览，再按教育、环境、科技、工作逐项核对。',
      '容易混淆的地方单独抄下来，下一篇练习时优先检查。',
      '这样复盘会更具体，也方便看出自己反复出错的位置。',
    ].join(''),
  },
  // resource_13: 去 "别只看X，更要看Y"
  'data/batches/batch_1785854296934/jobs/job_014.json': {
    caption: [
      'DELF B2写作总卡壳？模板不够多和知识太零散都是常见原因。',
      '每次练习都要翻找格式、范文、语法笔记，时间全浪费在找资料上。',
      '按题型整理一个知识库，才能更容易调用：',
      '先识别任务类型（正式信、论坛投稿、议论文等），再对应结构、语体和常用表达。',
      '比如正式信要用vous和礼貌结尾，论坛投稿可以更口语化。',
      '写前花2分钟自查：文体判断对吗？称呼合适吗？结构完整吗？字数至少250词。',
      '范文库覆盖4种官方文体，5类任务识别对照表，20条组合示例，帮你快速定位。',
      '使用时可以先看封面总览，再按5类题型一眼判、三类文体流程、范文库覆盖、20条组合示例逐项核对。',
      '容易混淆的地方单独抄下来，下一篇练习时优先检查；确认已经掌握的内容再划掉。',
    ].join(''),
  },
  // resource_15: 去 "别只看X，更要看Y" + 避 "让X更Y" 误报（含 "让步" + "更" 的句子）
  'data/batches/batch_1786421005085/jobs/job_001.json': {
    caption: [
      'DELF B2写作资料囤了很多，但翻开就头疼？',
      '资料不够和缺少一张把优先级讲清楚的体系图，是两个不同的问题。',
      '官方对写作的硬性要求只有一条：至少250词。除此之外，结构、语言、内容怎么安排，更多是策略问题。',
      '建议先抓结构，再补语言，最后丰富内容。',
      '结构上，开头段明确身份和目的，主体段用论据支撑观点，结尾段礼貌收尾。',
      '语言上，开头结尾句型最值得优先积累，能帮你快速进入状态。',
      '内容上，回应题目、给出具体例子、加一段反方观点并回应，文章会更饱满。',
      '复习时，先熟悉框架，再积累句型，然后限时写作，最后批改复盘。',
      '这样按优先级推进，比盲目翻资料更有效。',
    ].join(''),
  },
};

const AI_CLICHE_RE = /不是.{0,40}而是|不在于.{0,40}而在于|问题(?:就)?出在|问题的关键|很多(?:备考.{0,12})?同学|其实[，,]?|别只看.{0,20}更要看|让.{1,12}更.{1,8}|不仅仅是.{1,18}.{0,4}更是|在.{1,18}的过程中|才是.{1,12}(?:关键|核心|根本)|通过.{1,18}，.{1,12}才能|让.{1,12}不再|重要性不言而喻|是一个需要.{1,18}的过程|综上所述|^总而言之|^总的来说|首先[，,][^。]{0,80}其次[，,][^。]{0,80}最后[，,]/;

for (const [file, patch] of Object.entries(PATCHES)) {
  const full = path.resolve(file);
  const job = JSON.parse(fs.readFileSync(full, 'utf8'));
  const before = job.draft.caption;
  console.log(`Patching ${file}`);
  console.log(`  before len=${before.length} cliche=${AI_CLICHE_RE.test(before)}`);
  for (const [key, value] of Object.entries(patch)) {
    job.draft[key] = value;
  }
  const after = job.draft.caption;
  console.log(`  after  len=${after.length} cliche=${AI_CLICHE_RE.test(after)}`);
  fs.writeFileSync(full, JSON.stringify(job, null, 2), 'utf8');
}

console.log('\n=== 验证 ===');
const ALL_CARDS = {
  resource_02_grammar_white_green: 'data/batches/batch_1785854296934/jobs/job_002.json',
  resource_04_chalkboard_phrase_list: 'data/batches/batch_1785854296934/jobs/job_007.json',
  resource_12_delf_vocab_table_overlay: 'data/batches/batch_1785854296934/jobs/job_013.json',
  resource_13_course_roadmap_blue: 'data/batches/batch_1785854296934/jobs/job_014.json',
  resource_15_grammar_grid_purple: 'data/batches/batch_1786421005085/jobs/job_001.json',
};
for (const [card, file] of Object.entries(ALL_CARDS)) {
  const job = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const c = job.draft.caption;
  const still = AI_CLICHE_RE.test(c);
  console.log(`${still ? '⚠️' : '✅'} ${card} len=${c.length} cliche=${still}`);
}
