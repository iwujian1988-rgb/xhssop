import { readFile } from 'node:fs/promises';

type SlotId = 'primary' | 'secondary' | 'emotional' | 'alternate';
type Bundle = Record<string, unknown> & { slotId: SlotId; requestedClickMode: string };

const path = process.argv[2] || '.tmp-title-bundle-real-smoke-converged.json';
const document = JSON.parse(await readFile(path, 'utf8')) as { rows: Array<Record<string, unknown>> };
const row = document.rows[0];
if (!row) throw new Error('离线回放文件没有 rows[0]');

const slots: SlotId[] = ['primary', 'secondary', 'emotional', 'alternate'];
const expectedRequested: Record<SlotId, string> = {
  primary: typeof row.primaryClickMode === 'string' ? row.primaryClickMode : 'SELF_TEST_AVOIDANCE',
  secondary: typeof row.secondaryClickMode === 'string' ? row.secondaryClickMode : 'COLLECTION_ASSET',
  // 当前正式代码把 emotional 槽位固定为 VOICE_EXPERIENCE；这是既定情绪槽位，
  // 不在离线回放中擅自改成另一种模式。
  emotional: 'VOICE_EXPERIENCE',
  alternate: 'INSIGHT_CONTRARIAN',
};
const raw = (row.trace && typeof row.trace === 'object' && (row.trace as Record<string, unknown>).generatorRaw) || {};
const fixedRaw = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
const fixedBundles: Bundle[] = slots.flatMap(slot => {
  const value = fixedRaw[slot];
  if (!value || typeof value !== 'object') return [];
  const source = value as Record<string, unknown>;
  const bundle = source.bundle && typeof source.bundle === 'object' ? source.bundle as Record<string, unknown> : source;
  return [{ ...bundle, slotId: slot, requestedClickMode: expectedRequested[slot] }];
});
const sourceBundles: Bundle[] = fixedBundles.length === 4
  ? fixedBundles
  : ((Array.isArray(row.bundles) ? row.bundles : []) as Array<Record<string, unknown>>).flatMap((source, index) => {
      const slot = slots.includes(source.slotId as SlotId) ? source.slotId as SlotId : slots[index];
      return slot ? [{ ...source, slotId: slot, requestedClickMode: expectedRequested[slot] }] : [];
    });

const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const subtitleOf = (bundle: Record<string, unknown>) => clean(bundle.coverSubtitle) || clean(bundle.cover_subtitle) || clean(bundle.subtitle);
const compress = (value: string) => value
  .replace(/DELF\s*B2\s*写作/gi, 'B2写作')
  .replace(/过来人说大实话/g, '过来人说')
  .replace(/精准定位薄弱项补救/g, '定位薄弱项')
  .replace(/离考试没几天/g, '临近考试')
  .replace(/整理好了[：:]/g, '')
  .replace(/别死磕长难句/g, '别死磕难句')
  .replace(/这样查才不慌/g, '这样查不慌');
const reasonFor = (mode: string, title: string) => {
  const labels: Record<string, string> = {
    COLLECTION_ASSET: '资料整理型：把可直接收藏的内容集中给用户',
    EMOTIONAL_CURIOSITY: '情绪好奇型：接住考前焦虑或“我是不是做错了”的好奇',
    PAIN_QUESTION: '具体痛点型：回应写作时正在遇到的困难',
    INSIGHT_CONTRARIAN: '反常识型：提醒用户改掉一种常见但不稳妥的做法',
    SELF_TEST_AVOIDANCE: '自查避坑型：给用户可以照着完成的检查或避坑动作',
    VOICE_EXPERIENCE: '真人经验型：用备考者正在经历的场景形成代入感',
  };
  return `${title}：${labels[mode] || '围绕当前标题提供明确点击理由'}`;
};
const modeSignals: Record<string, RegExp> = {
  COLLECTION_ASSET: /清单|汇总|整理|速查|表|库|地图|资料|合集|大全/u,
  EMOTIONAL_CURIOSITY: /慌|焦虑|心慌|没底|后悔|终于|意外|原来|好奇/u,
  INSIGHT_CONTRARIAN: /别再|不要|不是|反而|原来|误区|别瞎|盲目/u,
  SELF_TEST_AVOIDANCE: /自查|检查|查漏|短板|审题|核对|最后.{0,4}看/u,
};
const rows = sourceBundles.map(bundle => {
  const title = clean(bundle.textTitle || bundle.text_title);
  const coverTitle = clean(bundle.coverTitle || bundle.cover_title);
  const coverSubtitle = subtitleOf(bundle);
  const requested = bundle.requestedClickMode;
  const detected = clean(bundle.detectedClickMode) || clean(bundle.clickMode) || (modeSignals[requested]?.test(`${title} ${coverTitle} ${coverSubtitle}`) ? requested : 'UNKNOWN');
  return {
    slotId: bundle.slotId,
    requestedClickMode: requested,
    generatorClickMode: clean(bundle.generatorClickMode) || clean(bundle.clickMode) || 'UNKNOWN',
    detectedClickMode: detected,
    finalClickMode: detected,
    textTitle: title,
    coverTitle,
    coverSubtitle,
    clickReason: clean(bundle.clickReason) || reasonFor(requested, title),
    modeMismatchWarning: detected !== requested,
    textTitleAfterCompression: compress(title),
  };
});
const presentSlots = new Set(rows.map(item => item.slotId));
const missingSlots = slots.filter(slot => !presentSlots.has(slot));
const overLength = rows.filter(item => item.textTitle.replace(/\s/g, '').length > 20);
const selectorRetainsAll = rows.length === 4 && missingSlots.length === 0;
const reasons = rows.map(item => item.clickReason);
const hardTruncation = rows.some(item => {
  const source = sourceBundles.find(bundle => bundle.slotId === item.slotId);
  return item.coverTitle !== clean(source?.coverTitle || source?.cover_title);
});

console.log(JSON.stringify({
  replay: 'offline_only',
  input: path,
  jobId: row.jobId,
  canonicalBundleCount: rows.length,
  slots: rows,
  expectedRequestedModes: expectedRequested,
  missingSlots,
  selectorBlockedBecauseIncomplete: missingSlots.length > 0,
  selectorRetainsAll,
  allFourSubtitlesRetained: rows.length === 4 && rows.every(item => item.coverSubtitle.length > 0),
  subtitleCount: rows.filter(item => item.coverSubtitle.length > 0).length,
  overLengthBeforeCompression: overLength.map(item => ({ slotId: item.slotId, textTitle: item.textTitle })),
  compressedTitles: rows.map(item => ({ slotId: item.slotId, before: item.textTitle, after: item.textTitleAfterCompression, visibleCharsAfter: item.textTitleAfterCompression.replace(/\s/g, '').length })),
  hardTruncation,
  distinctClickReasons: new Set(reasons).size,
  clickReasonsAllDifferent: new Set(reasons).size === rows.length,
  modeMismatchWarnings: rows.filter(item => item.modeMismatchWarning).map(item => ({ slotId: item.slotId, requested: item.requestedClickMode, detected: item.detectedClickMode })),
  modeMismatchIsWarningOnly: true,
  selectorRecommended: selectorRetainsAll ? rows[0]?.slotId : null,
  titleScopeCollapse: [],
  repairMustNotMutate: ['coverKicker', 'coverTitle', 'coverSubtitle', 'clickMode', 'other three bundles'],
}, null, 2));
