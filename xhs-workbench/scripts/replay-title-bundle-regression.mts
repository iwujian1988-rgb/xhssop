/* eslint-disable no-console */
import fs from 'node:fs/promises';

type Mode = 'COLLECTION_ASSET' | 'EMOTIONAL_CURIOSITY' | 'PAIN_QUESTION' | 'INSIGHT_CONTRARIAN' | 'COMPARISON_GAP' | 'URGENT_EXAM' | 'SELF_TEST_AVOIDANCE' | 'VOICE_EXPERIENCE' | 'UNKNOWN';
const sourcePath = process.env.TEST_SOURCE || '.tmp-title-bundle-real-regression.json';
const outputPath = process.env.TEST_OUTPUT || '.tmp-title-bundle-replay.json';
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as { rows: Array<any> };

const modes = new Set<Mode>(['COLLECTION_ASSET', 'EMOTIONAL_CURIOSITY', 'PAIN_QUESTION', 'INSIGHT_CONTRARIAN', 'COMPARISON_GAP', 'URGENT_EXAM', 'SELF_TEST_AVOIDANCE', 'VOICE_EXPERIENCE']);
const sourceMap: Record<string, Mode> = { material: 'COLLECTION_ASSET', pain: 'PAIN_QUESTION', emotion: 'EMOTIONAL_CURIOSITY', counter: 'INSIGHT_CONTRARIAN', fast_path: 'URGENT_EXAM', voice: 'VOICE_EXPERIENCE' };
function resolve(raw: any): Mode {
  const value = String(raw?.finalClickMode || raw?.generatorClickMode || raw?.clickMode || '').trim();
  if (modes.has(value as Mode)) return value as Mode;
  const direction = String(raw?.sourceDirection || raw?.mechanism || '').trim();
  if (sourceMap[direction]) return sourceMap[direction];
  if (/资料|整理|大全|清单|速查|词库/.test(`${raw?.textTitle || ''}${raw?.coverTitle || ''}`)) return 'COLLECTION_ASSET';
  if (/为什么|怎么办|卡|痛|没深度/.test(`${raw?.textTitle || ''}${raw?.coverTitle || ''}`)) return 'PAIN_QUESTION';
  if (/不是|别再|不要|误区|死磕/.test(`${raw?.textTitle || ''}${raw?.coverTitle || ''}`)) return 'INSIGHT_CONTRARIAN';
  return 'UNKNOWN';
}

const rows = source.rows.map(row => {
  const beforeUnknown = (row.bundles || []).filter((b: any) => !modes.has(b.clickMode as Mode)).length;
  const bundles = (row.bundles || []).map((bundle: any, index: number) => ({
    ...bundle,
    slotId: bundle.slotId || (['primary', 'secondary', 'emotional', 'alternate'][index] || 'alternate'),
    requestedClickMode: bundle.requestedClickMode || resolve(bundle),
    generatorClickMode: bundle.generatorClickMode || bundle.clickMode || 'UNKNOWN',
    finalClickMode: resolve(bundle),
    clickMode: resolve(bundle),
  }));
  return { ...row, bundles, replay: { beforeUnknown, afterUnknown: bundles.filter((b: any) => b.finalClickMode === 'UNKNOWN').length, modes: [...new Set(bundles.map((b: any) => b.finalClickMode))] } };
});
const all = rows.flatMap(row => row.bundles);
const report = {
  generatedAt: new Date().toISOString(), sourcePath, modelCalls: 0,
  before: { totalBundles: source.rows.reduce((n, row) => n + (row.bundles?.length || 0), 0), unknownClickMode: rows.reduce((n, row) => n + row.replay.beforeUnknown, 0) },
  after: { totalBundles: all.length, unknownClickMode: all.filter(b => b.finalClickMode === 'UNKNOWN').length, mistakenComparisonFallback: all.filter(b => b.generatorClickMode === 'COMPARISON_GAP' && b.finalClickMode !== 'COMPARISON_GAP').length, oldGlobalRuleWarnings: 0 },
  modeDistribution: Object.fromEntries([...new Set(all.map(b => b.finalClickMode))].map(mode => [mode, all.filter(b => b.finalClickMode === mode).length])),
  rows,
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ before: report.before, after: report.after, modeDistribution: report.modeDistribution, outputPath }, null, 2));
