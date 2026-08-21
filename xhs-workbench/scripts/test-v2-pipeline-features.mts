/* eslint-disable no-console */
/**
 * 阶段 A 离线测试：pipeline-features + product-editorial-map（纯新增模块，零接线）。
 * 运行：npx tsx scripts/test-v2-pipeline-features.mts
 */
import { execSync } from 'node:child_process';
import { resolvePipelineFeatures } from '../src/lib/v2/pipeline-features';
import { getProductEditorialMap } from '../src/lib/v2/product-editorial-map';
import { buildProductShowcaseAssets } from '../src/lib/product-showcase-library';
import { hasForbiddenProductIdentity } from '../src/lib/product-prompt-profiles';
import type { ProductFacts } from '../src/types/content-planning';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`PASS ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// 1. resolvePipelineFeatures 三商品
const delf = resolvePipelineFeatures('delf_b2_writing');
check('商品1 = consensus-v1 + 三开关全开',
  delf.pipelineVersion === 'consensus-v1' && delf.consensusTopicStage && delf.consensusContentBrief && delf.consensusTitleStage);

for (const id of ['tef_tcf_canada', 'tcf_canada_writing_7day'] as const) {
  const f = resolvePipelineFeatures(id);
  check(`${id} = legacy-v2 + 三开关全关`,
    f.pipelineVersion === 'legacy-v2' && !f.consensusTopicStage && !f.consensusContentBrief && !f.consensusTitleStage
      && f.productId === id);
}

// 2. 未知 id throw（绕过类型，模拟脏数据）
let threw = false;
try {
  resolvePipelineFeatures('unknown_product' as never);
} catch (err) {
  threw = true;
  check('未知 id 报错信息带 id', String(err).includes('unknown_product'), String(err));
}
check('未知 id throw', threw);

// 3. 商品1 editorial map
const map = getProductEditorialMap('delf_b2_writing');
check('商品1 map 存在', !!map);
if (map) {
  check('capabilities 非空且每条能力文本非空',
    map.capabilities.length > 0 && map.capabilities.every(c => c.capabilityId && c.capability.trim().length > 0));

  const emptyModules = map.capabilities.filter(c => !c.modules.length || c.modules.some(m => !m.trim()));
  check('每条能力 modules 非空', emptyModules.length === 0, JSON.stringify(emptyModules.map(c => c.capabilityId)));

  // 模块名能在 showcase 库找到对应（sourceFile 拆出的一级模块名）
  const emptyFacts = {
    audiences: [], use_cases: [], raw_pain_points: [], raw_selling_points: [],
    knowledge_assets: [], content_modules: [], displayable_assets: [],
  } as unknown as ProductFacts;
  const assets = buildProductShowcaseAssets('delf_b2_writing', emptyFacts);
  const showcaseModules = new Set<string>();
  for (const asset of assets) {
    for (const part of asset.sourceFile.split(' / ')) showcaseModules.add(part);
  }
  const unmatched: string[] = [];
  for (const c of map.capabilities) {
    for (const m of c.modules) if (!showcaseModules.has(m)) unmatched.push(`${c.capabilityId}: ${m}`);
  }
  check('所有模块名都能在 showcase 库找到对应', unmatched.length === 0, `未命中: ${unmatched.join('; ')}`);

  // buyerMap 三组各 ≥4 条且每条非空
  const { userStages, realStates, motivations } = map.buyerMap;
  check('buyerMap.userStages ≥4 条',
    userStages.length >= 4 && userStages.every(s => s.trim().length >= 8), `实际 ${userStages.length}`);
  check('buyerMap.realStates ≥4 条',
    realStates.length >= 4 && realStates.every(s => s.trim().length >= 8), `实际 ${realStates.length}`);
  check('buyerMap.motivations ≥4 条',
    motivations.length >= 4 && motivations.every(s => s.trim().length >= 8), `实际 ${motivations.length}`);

  // 全文不含商品1 forbiddenIdentityPattern 命中词（TEF/TCF/CLB/NCLC/加拿大移民等）
  const allText = [
    ...map.capabilities.flatMap(c => [c.capabilityId, c.capability, ...c.modules]),
    ...userStages, ...realStates, ...motivations,
  ].join('\n');
  check('map 全文无 forbiddenIdentityPattern 命中', !hasForbiddenProductIdentity('delf_b2_writing', allText));

  // 不含考试边界字段（边界由阶段 B 调 listVerifiedExamFacts）
  check('map 不含考试边界字段',
    !('examFacts' in map) && !('verifiedExamFacts' in map) && !JSON.stringify(map).includes('已确认考试边界'));
}

// 4. 商品2/3 返回 undefined
check('商品2 map = undefined', getProductEditorialMap('tef_tcf_canada') === undefined);
check('商品3 map = undefined', getProductEditorialMap('tcf_canada_writing_7day') === undefined);

// 5. git 自查：3 个新文件均为未跟踪新增；除无关的 .claude/settings.local.json 外，
//    没有任何已跟踪文件被改动（工作区里大量历史未跟踪产物不算改动，不检查）。
const newFiles = [
  'src/lib/v2/pipeline-features.ts',
  'src/lib/v2/product-editorial-map.ts',
  'scripts/test-v2-pipeline-features.mts',
];
for (const f of newFiles) {
  const isNew = execSync(`git status --porcelain -- "${f}"`, { encoding: 'utf8' }).startsWith('??');
  check(`新文件未被跟踪: ${f}`, isNew);
}
const trackedChanges = execSync('git diff --name-only HEAD', { encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean)
  .filter(p => !p.endsWith('.claude/settings.local.json'));
check('无已跟踪文件被改动（除无关 settings.local.json）', trackedChanges.length === 0, trackedChanges.join('; '));

if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
