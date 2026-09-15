/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { compressTextTitleForTest, hasCutFragmentTail, hasDanglingTitleTail } from '../src/lib/v2/title-stage';
import { countVisibleUnits } from '../src/lib/v2/contracts';

type Bundle = Record<string, any>;
const inputPath = process.env.TEST_INPUT || '.tmp-title-bundle-real-3-verified.json';
const outputPath = process.env.TEST_OUTPUT || '.tmp-title-final-acceptance.json';
const source = JSON.parse(await fs.readFile(inputPath, 'utf8')) as { rows: Array<Record<string, any>> };

const rows = source.rows || [];
const changed: Array<Record<string, unknown>> = [];
const allBundles = rows.flatMap(row => (row.bundles || []) as Bundle[]);
const over20Before = allBundles.filter(bundle => countVisibleUnits(String(bundle.textTitle || '')) > 20).length;
for (const bundle of allBundles) {
  const before = String(bundle.textTitle || '');
  const after = compressTextTitleForTest(before);
  bundle.textTitle = after;
  if (before !== after) changed.push({
    jobId: rows.find(row => (row.bundles || []).includes(bundle))?.jobId,
    bundleId: bundle.id,
    clickMode: bundle.clickMode,
    before,
    beforeChars: countVisibleUnits(before),
    after,
    afterChars: countVisibleUnits(after),
    b2IdentityPreserved: /DELF\s*B2|法语\s*B2|B2写作/i.test(after),
    brokenTail: hasCutFragmentTail(after) || hasDanglingTitleTail(after),
  });
}

const edges = [
  'DELF B2写作资料整理好了',
  'DELF B2写作考前最后一周自查清单',
  'DELF B2写作别瞎练先看这份清单',
  'DELF B2写作终于搞懂套路了啊啊',
  'DELF B2 writing：Je vous remercie pour votre réponse',
  '我全踩了：DELF B2写作别再背模板',
  'DELF B2写作？考前救命清单',
  'DELF B2写作3步检查语法和衔接问题',
];
const edgeResults = edges.map(before => {
  const after = compressTextTitleForTest(before);
  return { before, after, beforeChars: countVisibleUnits(before), afterChars: countVisibleUnits(after), unchangedWithinLimit: countVisibleUnits(before) <= 20 ? before === after : undefined, overLimit: countVisibleUnits(after) > 20, brokenTail: hasCutFragmentTail(after) || hasDanglingTitleTail(after), identityPreserved: !/DELF|B2/i.test(before) || /DELF\s*B2|法语\s*B2|B2写作/i.test(after) };
});

const report = {
  totalJobs: rows.length,
  totalBundles: allBundles.length,
  over20Before,
  over20After: allBundles.filter(bundle => countVisibleUnits(String(bundle.textTitle || '')) > 20).length,
  changedCount: changed.length,
  changed,
  edgeResults,
  sourcePath: inputPath,
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({
  totalJobs: report.totalJobs,
  totalBundles: report.totalBundles,
  over20Before: report.over20Before,
  over20After: report.over20After,
  changedCount: report.changedCount,
  edgeFailures: edgeResults.filter(item => item.overLimit || item.brokenTail || !item.identityPreserved).length,
  outputPath,
}, null, 2));
