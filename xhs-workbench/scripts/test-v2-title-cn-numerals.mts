/* eslint-disable no-console */
// 修复3（中文数字归一化）的离线验收：数字来源闸门两侧口径一致。
// 纯函数 + diagnoseTitlePair，不碰真实 LLM。
//
// 隔离承诺（用户 2026-08-22 要求）：
// - 归一化只在共识标题路径（商品1普通模式）启用；
// - 商品2/3 与 showcase 仍走旧逻辑：同样文本维持原拦截结论；
// - 闸门语义不变：正文没有对应数字时仍然拦截。
import { diagnoseTitlePair, normalizeCnNumeralsBeforeUnit } from '../src/lib/v2/title-stage';
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
// 1. 纯函数：数字+单位归一
// ---------------------------------------------------------------------------

assert(normalizeCnNumeralsBeforeUnit('三分钟') === '3分钟', '三分钟 -> 3分钟');
assert(normalizeCnNumeralsBeforeUnit('十一步') === '11步', '十一步 -> 11步');
assert(normalizeCnNumeralsBeforeUnit('二十篇') === '20篇', '二十篇 -> 20篇');
assert(normalizeCnNumeralsBeforeUnit('两遍') === '2遍', '两遍 -> 2遍');
assert(normalizeCnNumeralsBeforeUnit('十分有用') === '十分有用', '十分有用保持不变（分不是独立单位）');
assert(normalizeCnNumeralsBeforeUnit('总差几十词') === '总差几十词', '几十词是不定概数，不归一');
assert(normalizeCnNumeralsBeforeUnit('数十题没练') === '数十题没练', '数十题是不定概数，不归一');

// ---------------------------------------------------------------------------
// 2. 闸门级：商品1普通模式口径拉齐；商品2 / showcase 仍走旧逻辑
// ---------------------------------------------------------------------------

function buildTopic(productId: ProductId, showcase: boolean): TopicOption {
  const isDelf = productId === 'delf_b2_writing';
  return {
    id: `cn-numeral-test-${productId}-${showcase ? 'showcase' : 'standard'}`,
    productId,
    templateId: 'plain_experience',
    primaryGoal: showcase ? 'conversion' : 'search',
    topicLane: showcase ? 'product_value' : 'broad_pain',
    topic: isDelf ? 'DELF B2写作写完心慌' : 'TEF还是TCF写完总心慌',
    audienceState: '写完作文心里没底，怕交卷',
    scene: '写完一篇作文不敢提交',
    painOrDesire: '写完心慌，不知道错在哪',
    promise: isDelf ? '拿到三分钟自查法' : '拿到写完后的自查方法',
    contentAngle: '解决写完不敢交的问题',
    productBridge: '写作检查清单',
    seo: { primary: isDelf ? 'DELF B2写作' : 'TEF还是TCF', related: [] },
    knowledgeMode: 'mixed',
    factTerms: [],
    seedSignals: [],
    noveltyFingerprint: `cn-numeral|${productId}|${showcase}`,
  };
}

const content = (productId: ProductId): ContentPackage => {
  const isDelf = productId === 'delf_b2_writing';
  return {
    topicSnapshotHash: 'cn-numeral-test',
    coverBlocks: [{
      id: 'b1',
      kind: 'group',
      heading: isDelf ? '三分钟自查流程' : '写完心慌自查',
      items: [{ primary: '写完先对照清单自查' }],
      priority: 1,
      sourceMode: 'general_advice',
      sourceIds: [],
    }],
    innerPages: [],
    captionParts: {
      opening: '写完心慌很正常，先自查',
      value: isDelf ? ['三分钟走完自查清单'] : ['按清单逐项核对'],
      productBridge: '写作检查清单',
      cta: '',
    },
    tagMaterial: [],
    factualClaims: [],
    frenchSegments: [],
  };
};

const card = getCompetitorCreativeCard('resource_10_plain_text_experience');
if (!card) throw new Error('缺少测试卡片 resource_10_plain_text_experience');
const capability = getCapabilityFallback(card);

function buildPair(productId: ProductId, titleTail: string): TitlePair {
  const isDelf = productId === 'delf_b2_writing';
  return {
    textTitle: isDelf ? `DELF B2写完心慌？${titleTail}` : `TEF还是TCF写完心慌？${titleTail}`,
    coverTitle: isDelf ? 'DELF B2写完心里没底' : 'TEF/TCF写完心里没底',
    coverSubtitle: '交卷前按清单核对',
    mechanism: '情绪',
    userRelation: '写完作文不敢交卷的考生',
    seoKeyword: isDelf ? 'DELF B2写作自查' : 'TEF TCF自查',
    noveltyFingerprint: `cn-numeral|${titleTail}`,
  };
}

function numberFailures(pair: TitlePair, productId: ProductId, showcase: boolean) {
  return diagnoseTitlePair(pair, { topic: buildTopic(productId, showcase), capability, content: content(productId) })
    .filter(message => message.includes('正文没有的数字'));
}

// 商品1普通模式：正文写「三分钟」，标题写「3分钟」——修复前全灭，修复后口径一致放行。
assert(numberFailures(buildPair('delf_b2_writing', '3分钟自查'), 'delf_b2_writing', false).length === 0, '商品1普通模式：标题3分钟+正文三分钟不再误拦');
// 闸门语义不变：正文只有「三分钟」，标题新编「5分钟」仍然拦截。
assert(numberFailures(buildPair('delf_b2_writing', '5分钟自查'), 'delf_b2_writing', false).length === 1, '商品1普通模式：正文没有的5分钟仍然拦截');

// 商品2（legacy）：同样文本保持修复前行为——「3分钟」在旧口径下就是正文没有的数字。
assert(numberFailures(buildPair('tef_tcf_canada', '3分钟自查'), 'tef_tcf_canada', false).length === 1, '商品2：同样3分钟文本维持原拦截（零变化）');
assert(numberFailures(buildPair('tef_tcf_canada', '自查再交卷'), 'tef_tcf_canada', false).length === 0, '商品2：无数字标题零变化');

// showcase：商品1的话题但走知识库介绍模式，共识门控关闭，数字闸门仍是旧逻辑。
assert(numberFailures(buildPair('delf_b2_writing', '3分钟自查'), 'delf_b2_writing', true).length === 1, 'showcase：同样3分钟文本维持原拦截（零变化）');

if (failures) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true }, null, 2));
}
