/* eslint-disable no-console */
// 修复「…三分钟自查法让」悬空截断（仅商品1普通模式共识标题路径）的离线验收。
// 纯函数 + diagnoseTitlePair，不碰真实 LLM。
//
// 隔离承诺（用户 2026-08-22 要求）：
// - trimTitleAtNaturalBoundary 原函数字节锁定：商品2/3 与 showcase 的截断行为不变；
// - 悬空剥离 stripDanglingTitleTail / hasDanglingTitleTail 只被共识路径调用；
// - 闸门级：DELF 普通模式悬空收尾被拦；TEF（legacy）同样文本不新增该失败项。
import { diagnoseTitlePair, hasDanglingTitleTail, stripDanglingTitleTail, trimTitleAtNaturalBoundary } from '../src/lib/v2/title-stage';
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
assert(hasDanglingTitleTail('DELF B2写作三分钟自查法让'), '悬空「让」被识别');

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
    heading: '写完心慌自查',
    items: [{ primary: '写完心慌先自查再交卷' }],
    priority: 1,
    sourceMode: 'general_advice',
    sourceIds: [],
  }],
  innerPages: [],
  captionParts: { opening: '写完心慌很正常，先自查', value: ['三分钟自查法教你确认'], productBridge: '写作检查清单', cta: '' },
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

if (failures) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true }, null, 2));
}
