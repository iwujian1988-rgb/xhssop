/* eslint-disable no-console */
// 修复「…三分钟自查法让」悬空截断（仅商品1普通模式共识标题路径）的离线验收。
// 纯函数 + diagnoseTitlePair，不碰真实 LLM。
//
// 隔离承诺（用户 2026-08-22 要求）：
// - trimTitleAtNaturalBoundary 原函数字节锁定：商品2/3 与 showcase 的截断行为不变；
// - 悬空剥离 stripDanglingTitleTail / hasDanglingTitleTail 只被共识路径调用；
// - 闸门级：DELF 普通模式悬空收尾被拦；TEF（legacy）同样文本不新增该失败项。
import { diagnoseTitlePair, hasCutFragmentTail, hasDanglingTitleTail, hasIncompletePhraseTail, stripDanglingTitleTail, trimTitleAtNaturalBoundary, evaluateHumanizedSlot, applyCoverTruncateFallbackForTest } from '../src/lib/v2/title-stage';
import { countVisibleUnits } from '../src/lib/v2/contracts';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import type { ContentPackage, TitlePair, TopicOption } from '../src/lib/v2/contracts';
import type { ProductId } from '../src/types/data';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) {
    console.log(`  ok: ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. 纯函数：legacy 截断字节锁定 + 共识剥离
// ---------------------------------------------------------------------------

// 实测案例（batch_1787325885084 / job_002）：24 字原文按 20 字截断后「让你的」被切半，
// 旧行为保留悬空「让」。此断言锁定旧函数输出不变，防止修复外溢到商品2/3 与 showcase。
const legacyTrimmed = trimTitleAtNaturalBoundary('DELF B2写作写完心慌？三分钟自查法让你安心交卷', 20);
// 注意：该函数会过滤空白单元，输出里「DELF」「B2」之间没有空格——这是修复前就有的旧行为，一并锁定。
// 「截断后身份词空格丢失」是独立存量问题（跑批记录发现5），后续单独小修，不与悬空词修复混合。
assert(legacyTrimmed === 'DELFB2写作写完心慌？三分钟自查法让', `legacy 截断保持原行为（实际：「${legacyTrimmed}」）`);

const consensusTrimmed = stripDanglingTitleTail(legacyTrimmed);
assert(consensusTrimmed === 'DELFB2写作写完心慌？三分钟自查法', `共识剥离去掉悬空「让」（实际：「${consensusTrimmed}」）`);

// 多级剥离 + 剥离后暴露的尾标点也要清掉。
assert(stripDanglingTitleTail('DELF B2写作36项自查清单让在') === 'DELF B2写作36项自查清单', '多级悬空虚词逐层剥离');
assert(stripDanglingTitleTail('DELF B2写作36项自查清单，让') === 'DELF B2写作36项自查清单', '剥离虚词后暴露的尾逗号一并清理');

// 合法结尾不得误伤：「的」名词化收尾是自然中文，不在剥离集合。
assert(!hasDanglingTitleTail('DELF B2写作写给零基础的'), '「…零基础的」名词化结尾不判悬空');
assert(!hasDanglingTitleTail('DELF B2写作没思路的看过来'), '「…看过来」合法结尾不判悬空');
assert(!hasDanglingTitleTail('DELF B2写作三分钟自查法'), '干净结尾不判悬空');
assert(!hasDanglingTitleTail('B2写作草稿打太细，正文根本来不及'), '「来不及」是完整口语，不被单字「及」误杀');
assert(hasDanglingTitleTail('DELF B2写作三分钟自查法让'), '悬空「让」被识别');
assert(hasDanglingTitleTail('TEF/TCF写作口语要按'), '人话改写残句「要按」被识别（真实跑批 batch_1787503057707 job_003）');
assert(hasDanglingTitleTail('TEF/TCF写作按'), '孤立连接词「按」被识别');
assert(!hasDanglingTitleTail('TEF/TCF写作按主题分类'), '完整动作「按主题分类」不误杀');

// ---------------------------------------------------------------------------
// 2. 闸门级隔离：DELF（共识普通模式）拦截；TEF（legacy）保持原行为
// ---------------------------------------------------------------------------

function buildTopic(productId: ProductId): TopicOption {
  const isDelf = productId === 'delf_b2_writing';
  return {
    id: `truncation-test-${productId}`,
    productId,
    templateId: 'plain_experience',
    primaryGoal: 'search',
    topicLane: 'broad_pain',
    topic: isDelf ? 'DELF B2写作写完心慌' : 'TEF还是TCF写完总心慌',
    audienceState: '写完作文心里没底，怕交卷',
    scene: '写完一篇作文不敢提交',
    painOrDesire: '写完心慌，不知道错在哪',
    promise: '拿到写完后的自查方法',
    contentAngle: '解决写完不敢交的问题',
    productBridge: '写作检查清单',
    seo: { primary: isDelf ? 'DELF B2写作' : 'TEF还是TCF', related: [] },
    knowledgeMode: 'mixed',
    factTerms: [],
    seedSignals: [],
    noveltyFingerprint: `truncation|${productId}`,
  };
}

const content: ContentPackage = {
  topicSnapshotHash: 'truncation-test',
  coverBlocks: [{
    id: 'b1',
    kind: 'group',
    heading: '写完心慌三分钟自查',
    items: [{ primary: '写完心慌先自查再交卷' }, { primary: '只剩3周就靠3步砍掉一半常考题' }],
    priority: 1,
    sourceMode: 'general_advice',
    sourceIds: [],
  }],
  innerPages: [],
  captionParts: { opening: '写完心慌很正常，先自查', value: ['三分钟自查法教你确认', '只剩3周就把常考题砍掉一半'], productBridge: '写作检查清单', cta: '' },
  tagMaterial: [],
  factualClaims: [],
  frenchSegments: [],
};

const card = getCompetitorCreativeCard('resource_10_plain_text_experience');
if (!card) throw new Error('缺少测试卡片 resource_10_plain_text_experience');
const capability = getCapabilityFallback(card);

function buildPair(productId: ProductId, withDangling: boolean): TitlePair {
  const isDelf = productId === 'delf_b2_writing';
  const textTitle = isDelf
    ? (withDangling ? 'DELF B2写作写完心慌？三分钟自查法让' : 'DELF B2写作写完心慌？三分钟自查')
    : (withDangling ? 'TEF还是TCF？三步自查法让' : 'TEF还是TCF？三步自查法');
  return {
    textTitle,
    coverTitle: isDelf ? 'DELF B2写完心里没底' : 'TEF/TCF写完心里没底',
    coverSubtitle: '交卷前按清单核对',
    mechanism: '情绪',
    userRelation: '写完作文不敢交卷的考生',
    seoKeyword: isDelf ? 'DELF B2写作自查' : 'TEF TCF自查',
    noveltyFingerprint: `truncation|${withDangling}`,
  };
}

for (const productId of ['delf_b2_writing', 'tef_tcf_canada'] as const) {
  const input = { topic: buildTopic(productId), capability, content };
  const label = productId === 'delf_b2_writing' ? '共识普通模式' : 'legacy（商品2）';
  const danglingFailures = diagnoseTitlePair(buildPair(productId, true), input)
    .filter(message => message.includes('悬空虚词'));
  const cleanFailures = diagnoseTitlePair(buildPair(productId, false), input)
    .filter(message => message.includes('悬空虚词'));
  if (productId === 'delf_b2_writing') {
    assert(danglingFailures.length === 1, `${label}：悬空收尾标题被闸门拦截`);
    assert(cleanFailures.length === 0, `${label}：干净标题不新增悬空失败项`);
  } else {
    assert(danglingFailures.length === 0, `${label}：同样悬空文本不新增该失败项（零变化）`);
    assert(cleanFailures.length === 0, `${label}：干净标题零变化`);
  }
}

// ---------------------------------------------------------------------------
// 3. 阶段F修复轮（batch_1787382741943 用户拒收）：截断残片 + DELFB2 空格丢失
//    口径：残片只识别+硬拦+回退/转人工复核，不剥字伪装合格标题。
//    所有期望值来自 .tmp-probe 探针对真实函数的实测，非手算字数。
// ---------------------------------------------------------------------------

// 3.1 空格保留模式：截断输出不再丢内部空格，且按非空白单元计数。
assert(trimTitleAtNaturalBoundary('DELF B2写作总在完成任务上丢分？怎么破', 20, { keepInnerSpaces: true })
  === 'DELF B2写作总在完成任务上丢分？', 'keepInnerSpaces 截断保留身份词空格并落在问号边界');
assert(trimTitleAtNaturalBoundary('DELF B2写作只剩3周？我靠4步砍掉一半', 20, { keepInnerSpaces: true })
  === 'DELF B2写作只剩3周？', 'keepInnerSpaces 带空格时问号计入位置偏移，边界回退触发收口在问号');
assert(trimTitleAtNaturalBoundary('DELFB2写作只剩3周？我靠4步砍掉一半', 20, { keepInnerSpaces: true })
  === 'DELFB2写作只剩3周？我靠4步砍掉', '词界回退：切进「一半」词段 → 回退到「砍掉」词尾（数字残尾在源头消灭，见 3.7；问号差一位不触发边界回退的行为同时文档化）');
// 默认参数 = legacy 字节锁定：仍丢空格、仍留残片（任务 #11 legacy 存量不修）。
assert(trimTitleAtNaturalBoundary('DELFB2写作只剩3周？我靠4步砍掉一半', 20)
  === 'DELFB2写作只剩3周？我靠4步砍掉一', '默认（legacy）截断行为字节锁定：实测线上残句保持原样（无词界回退）');

// 3.2 截断残片识别：实测两类残句命中；合法结尾不误杀。
assert(hasCutFragmentTail('DELFB2写作只剩3周？我靠4步砍掉一'), '数字残尾「砍掉一」命中（batch_1787382741943 job_002）');
assert(hasCutFragmentTail('我用组合法，把背的句型融进DELFB2作'), '字母词后单字残尾「DELFB2作」命中（job_003）');
assert(!hasCutFragmentTail('B2写作别写penser/dire了'), '拉丁词后的完整口语助词「了」不误杀（v7稳定性复测真实样本）');
assert(hasCutFragmentTail('我用组合法，把背的句型融进B2作'), '白名单扩充后「B2作」（写作切半）仍命中');
assert(!hasCutFragmentTail('DELF B2写作练完这3步'), '「3步」量词收尾不误杀');
assert(!hasCutFragmentTail('法语B2写作速成12周'), '「12周」量词收尾不误杀');
assert(!hasCutFragmentTail('背完50篇范文我悟了'), '「50篇」量词收尾不误杀');
assert(!hasCutFragmentTail('从零到一'), '「从零到一」合法结尾不误杀');
assert(!hasCutFragmentTail('这篇是我的唯一'), '「唯一」合法结尾不误杀');
assert(!hasCutFragmentTail('DELF B2写作总差几十词？先补这3层'), '「3层」收尾不误杀（白名单新增：title-gates 回归夹具实测误拦）');
assert(!hasCutFragmentTail('DELF B2写作没把握？自查5维'), '「5维」收尾不误杀（白名单新增：真实跑批 v2-real-smoke-20260818-r2 产出标题）');
assert(!hasCutFragmentTail('DELF B2写作只剩3周？我靠4步砍掉'), '剥掉残片后的「砍掉」不再命中（但见3.4：不接受剥字产物）');
assert(hasDanglingTitleTail('我用官方评分维度给DELF B2作文做了个'), '「做了个」无宾语残句被识别');
assert(hasDanglingTitleTail('备考DELF B2写作，我连题型都没分清就'), '句尾「就」残句被识别');

// 3.3 闸门级隔离：残片失败项只进共识路径返修诊断，legacy 不新增。
const delfInput = { topic: buildTopic('delf_b2_writing'), capability, content };
const tefInput = { topic: buildTopic('tef_tcf_canada'), capability, content };
const fragmentPair = (productId: 'delf_b2_writing' | 'tef_tcf_canada'): TitlePair => ({
  // 数字只用正文有来源的 3（三分钟→3），排除数字来源闸门的干扰，聚焦残片失败项本身。
  textTitle: productId === 'delf_b2_writing' ? 'DELFB2写作只剩3周？我靠3步砍掉一' : 'TEF还是TCF？我靠3步砍掉一',
  coverTitle: productId === 'delf_b2_writing' ? 'DELF B2写作剩3周' : 'TEF/TCF剩3周',
  coverSubtitle: '先砍一半再练透',
  mechanism: '情绪',
  userRelation: '写完作文不敢交卷的考生',
  seoKeyword: productId === 'delf_b2_writing' ? 'DELF B2写作剩3周' : 'TEF TCF剩3周',
  noveltyFingerprint: 'cut-fragment',
});
const delfFragmentFailures = diagnoseTitlePair(fragmentPair('delf_b2_writing'), delfInput)
  .filter(message => message.includes('截断残片'));
const tefFragmentFailures = diagnoseTitlePair(fragmentPair('tef_tcf_canada'), tefInput)
  .filter(message => message.includes('截断残片'));
assert(delfFragmentFailures.length === 1, '共识普通模式：残片收尾进返修失败项（告诉模型重写完整句）');
assert(tefFragmentFailures.length === 0, 'legacy（商品2）：同样文本不新增残片失败项（零变化）');

// 3.4 封面截断兜底：截出残片必须保留截断前原值 + 转人工复核，不剥字上线。
// 落点对手算敏感（空格计入位置后偏移一位），这里现场用真实函数算出截断值并自检
// 「确实是残片」，再断言端到端行为——夹具失效（截断不再是残片）会先在前置断言暴露。
// 词界回退上线后「砍掉一」类数字残尾在截断源头消灭（见 3.7），本夹具换成回退后
// 仍会暴露的「让+汉字」残尾（「…让心」，词界回退删掉「不慌」后停在使役动词+宾语头）。
const fragmentCover = 'DELF B2写作自查36项清单让心不慌';
const fragmentCoverMeasured = trimTitleAtNaturalBoundary(fragmentCover, 18, { keepInnerSpaces: true });
assert(countVisibleUnits(fragmentCover) > 18, '夹具前置：原封面超 18 字上限（触发截断兜底）');
assert(hasIncompletePhraseTail(fragmentCoverMeasured), `夹具前置：截断值确实是残片（实测截断为「${fragmentCoverMeasured}」，让+汉字残尾）`);
const fragmentCoverPair: TitlePair = {
  ...buildPair('delf_b2_writing', false),
  coverTitle: fragmentCover,
};
const fallback = applyCoverTruncateFallbackForTest([fragmentCoverPair], delfInput, true);
assert(fallback.list[0].coverTitle === fragmentCover, '封面截断成残片时保留截断前原值');
assert(fallback.warnings.some(w => w.includes('转人工复核')), '封面残片截断记转人工复核警告');
assert(!fallback.warnings.some(w => w.includes('已截断兜底')), '残片截断值不得以「已截断兜底」身份上线');
// 干净截断仍正常兜底（同样先实测自检，再断言行为）。文案全部来自正文支撑的
// 「写完心慌/三分钟自查/交卷」，避免数字来源与新增痛点闸门误杀截断值。
const cleanCover = 'DELF B2写作写完心慌？三分钟自查再交卷';
const cleanCoverMeasured = trimTitleAtNaturalBoundary(cleanCover, 18, { keepInnerSpaces: true });
assert(countVisibleUnits(cleanCover) > 18, '夹具前置：原封面超 18 字上限');
assert(!hasCutFragmentTail(cleanCoverMeasured), `夹具前置：截断值干净完整（实测截断为「${cleanCoverMeasured}」）`);
const cleanCoverPair: TitlePair = {
  ...buildPair('delf_b2_writing', false),
  coverTitle: cleanCover,
};
const cleanFallback = applyCoverTruncateFallbackForTest([cleanCoverPair], delfInput, true);
assert(cleanFallback.list[0].coverTitle === cleanCoverMeasured, `干净封面截断正常兜底且保留空格（实际：「${cleanFallback.list[0].coverTitle}」）`);
assert(cleanFallback.warnings.some(w => w.includes('已截断兜底')), '干净截断走已截断兜底警告');

// 3.5 文字标题路径：共识路径不再把超长改写硬切成另一句话；超长槽位直接回退
// 原候选，让后续终审重新写一条完整的短标题。
const spacedVerdict = evaluateHumanizedSlot(
  buildPair('delf_b2_writing', false),
  { index: 0, textTitle: 'DELFB2写作只剩3周？我靠4步砍掉一半', coverTitle: 'DELF B2写作剩3周', coverSubtitle: '先砍一半再练透' },
  delfInput,
  { selected: new Set(), coverTitles: new Set(), styleReferences: [] },
);
assert(spacedVerdict.kept === false && spacedVerdict.pair.textTitle === 'DELF B2写作写完心慌？三分钟自查',
  `超长文字标题不再被程序截断，整槽回退原完整候选（实际：「${spacedVerdict.pair.textTitle}」）`);

// ---------------------------------------------------------------------------
// 3.6 法语重音残尾（batch_1787401381055 job_003 用户拒收项）：é/è/à/ç 不在 ASCII 类，
//     旧剥离与旧闸门都认不出（「…Je vous é」＝「écris」切剩首字母）。口径（用户指示）：
//     Latin Script、不用 \p{L}（含汉字）；截断切进尾部法语短语 → 整短语回退到汉字边界
//     （不得停在「Je vous」语义悬空处）；截断落在完整短语边界 → 原样保留（不误删
//     「…DELF B2」）；单字母成词收尾 → 闸门硬拦。期望值全部来自 .tmp-probe-latin.mts
//     探针实测；误杀面证据：2026-08-22 扫描 29433 个标题字段，合法拉丁收尾全为
//     多字母词（donc/mais/Cordialement/malgré/TEF…），单字母收尾样本全是残片。
// ---------------------------------------------------------------------------

// —— 截断侧：整短语回退 vs 完整短语保留 ——
assert(trimTitleAtNaturalBoundary('DELF B2写作开头只会Je vous écris', 20, { keepInnerSpaces: true })
  === 'DELF B2写作开头只会', '切进 écris 词中：整条尾部法语短语回退到汉字边界（实测）');
assert(trimTitleAtNaturalBoundary('DELF B2开头Je vous écris pour ça', 19, { keepInnerSpaces: true })
  === 'DELF B2开头', 'écris 完整但短语还在继续（后随 pour）：仍整短语回退（实测）');
assert(trimTitleAtNaturalBoundary('DELF B2开头Je vous écris就很高级', 19, { keepInnerSpaces: true })
  === 'DELF B2开头Je vous écris', '截断落在完整短语边界、后续是汉字：尾部法语原样保留（实测）');
assert(trimTitleAtNaturalBoundary('三个月冲刺然后你再去考DELF B2也来得及', 17, { keepInnerSpaces: true })
  === '三个月冲刺然后你再去考DELF B2', '「…DELF B2」完整收尾不得被回退误删（实测）');
assert(trimTitleAtNaturalBoundary('备考TEF/TCFCanada冲刺班', 8, { keepInnerSpaces: true })
  === '备考TEF', '短语回退后悬空的「/」连接符一并清理（实测）');

// —— 截断侧：legacy 字节锁定 ——
assert(trimTitleAtNaturalBoundary('DELF B2写作开头只会Je vous écris', 20)
  === 'DELFB2写作开头只会Jevousé', 'legacy 默认分支：ASCII 剥离认不出 é，输出保持原样（实测锁定，legacy 路径无残片闸门＝存量口径）');

// —— 闸门侧：单字母残尾识别 ——
assert(hasCutFragmentTail('DELF B2写作开头只会Je vous é'), '「Je vous é」空格后单字母残尾命中（job_003 实测）');
assert(hasCutFragmentTail('加拿大法语考试终极选择指南！TEF还是T'), '「TEF还是T」汉字后单字母残尾命中（ai-title-matrix 历史残片）');
assert(hasCutFragmentTail('DELF B2正式信开头为什么不能总用J'), '「总用J」汉字后单字母残尾命中（ai-title-matrix 历史残片）');
assert(hasCutFragmentTail('DELF B2开头别只会l’é'), '省音撇号后单字母残尾命中（l’écris 切半）');

// —— 闸门侧：完整法语词不误杀（真实语料标题）——
assert(!hasCutFragmentTail('DELF B2写作开头只会Je vous écris'), '「Je vous écris」完整短语不拦');
assert(!hasCutFragmentTail('DELF B2写作别再乱用malgré'), '「malgré」重音完整词不拦（真实标题 batch_1785208804204）');
assert(!hasCutFragmentTail('B2写作申请信，别再写passionné'), '「passionné」重音完整词不拦（真实标题 batch_1786589379479）');
assert(!hasCutFragmentTail('DELFB2写作别再只会donc'), '「donc」完整词不拦（真实标题 batch_1787290376848）');
assert(!hasCutFragmentTail('法语B2正式信开头，别再只会Bonjour'), '「Bonjour」完整词不拦');
assert(!hasCutFragmentTail('如何选择TEF/TCF'), '「TEF/TCF」缩写收尾不拦');
assert(!hasCutFragmentTail('DELFB2写作只会premiè'), '「premiè」多字母切半闸门不认——由截断侧整短语回退兜住（分工文档化）');

// —— 闸门级隔离：共识拦截，legacy 零新增 ——
const latinFragmentPair = (productId: 'delf_b2_writing' | 'tef_tcf_canada'): TitlePair => ({
  ...buildPair(productId, false),
  textTitle: productId === 'delf_b2_writing' ? 'DELF B2写作开头只会Je vous é' : 'TEF还是TCF？开头只会Je vous é',
  seoKeyword: productId === 'delf_b2_writing' ? 'DELF B2写作开头' : 'TEF TCF开头',
});
const delfLatinFailures = diagnoseTitlePair(latinFragmentPair('delf_b2_writing'), delfInput)
  .filter(message => message.includes('截断残片'));
const tefLatinFailures = diagnoseTitlePair(latinFragmentPair('tef_tcf_canada'), tefInput)
  .filter(message => message.includes('截断残片'));
assert(delfLatinFailures.length === 1, '共识普通模式：「Je vous é」残尾进返修失败项');
assert(tefLatinFailures.length === 0, 'legacy（商品2）：同样文本不新增残尾失败项（零变化）');

// ---------------------------------------------------------------------------
// 3.7 汉字词切半回退（batch_1787409902266 job_002 用户拒收项）：20字硬切把「写作思路」
//     切成「写作思」。方案（用户 2026-08-22 裁决）：词级分词 Intl.Segmenter word 粒度
//     判定切点是否落在含汉字词段内部 → 回退到该词起点；不加汉字黑名单；数量短语
//     （分词把数字与量词拆独立段）在量词后完整收尾不误伤；无丢弃字符不额外删字；
//     legacy 默认分支零变化。期望值来自 .tmp-probe-wordretreat.mts 探针实测。
// ---------------------------------------------------------------------------

assert(trimTitleAtNaturalBoundary('我把范文按题型归档后，DELF B2写作思路才打开', 20, { keepInnerSpaces: true })
  === '我把范文按题型归档后，DELF B2写作', '「思路」切半：回退到词起点，「写作思」不再出现（job_002 实测案例，实测值）');
assert(trimTitleAtNaturalBoundary('我把范文按题型归档后，DELF B2写作思路才打开', 20)
  === '我把范文按题型归档后，DELFB2写作思', 'legacy 默认分支：同样输入零变化，仍输出「写作思」（字节锁定，legacy 无回退）');
assert(trimTitleAtNaturalBoundary('DELF B2写作考前二十天冲刺背完50篇范文', 20, { keepInnerSpaces: true })
  === 'DELF B2写作考前二十天冲刺背完50篇', '「50篇」量词完整收尾不误伤：截断落在「篇|范」词界（实测值）');
assert(trimTitleAtNaturalBoundary('DELF B2写作没把握？写完自查5维再交卷', 20, { keepInnerSpaces: true })
  === 'DELF B2写作没把握？写完自查5维再', '「5维」保留、「交卷」切半回退到词起点（实测值）');
assert(trimTitleAtNaturalBoundary('DELF B2写作考前二十天突击就练这3步', 20, { keepInnerSpaces: true })
  === 'DELF B2写作考前二十天突击就练这3步', '恰好 20 字完整收尾（无丢弃字符）：不额外删字（实测值）');
// 词界回退与数字残尾闸门的分工：截断源头先回退消灭「砍掉一」；闸门规则保留，
// 继续拦截生成/改写侧直接产出的残尾（3.2 纯函数断言仍生效）。
assert(hasCutFragmentTail('DELFB2写作只剩3周？我靠3步砍掉一'), '闸门侧数字残尾规则不受词界回退影响（分工文档化）');

if (failures) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true }, null, 2));
}
