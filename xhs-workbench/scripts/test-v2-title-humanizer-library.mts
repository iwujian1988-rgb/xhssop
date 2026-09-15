/* eslint-disable no-console */
import {
  formatTitleHumanizerPair,
  getTitleHumanizerPairs,
  setTitleHumanizerPairsForTest,
  type TitleHumanizerPair,
} from '../src/lib/v2/title-humanizer-library';

let failures = 0;
function assert(condition: unknown, message: string) {
  if (condition) console.log(`  ok: ${message}`);
  else {
    failures += 1;
    console.error(`  FAIL: ${message}`);
  }
}

const real = getTitleHumanizerPairs('delf_b2_writing', 'DELF B2范文换题迁移', 6);
assert(real.length === 6, '真实数据只读取用户本轮确认过的6条前后对照，不额外伪造样本凑数');
assert(real.slice(0, 3).every(pair => pair.topicKeywords.includes('范文') && pair.topicKeywords.includes('迁移')), '按主题关键词优先路由范文迁移样本');
assert(real.every(pair => pair.before && pair.after && pair.clickReason), '每条样本都有前文、真人表达和冻结点击理由');
const formatted = formatTitleHumanizerPair(real[0]!);
assert('editor_voice' in formatted && 'human_voice' in formatted && 'unchanged_click_reason' in formatted, 'prompt schema 明确表达前后变化及不变语义');

const override: TitleHumanizerPair[] = [{
  before: '编辑腔',
  after: '真人表达',
  clickReason: '同一个理由',
  voiceTags: ['轻口语'],
  topicKeywords: ['草稿'],
  track: 'delf_b2_writing',
}];
setTitleHumanizerPairsForTest(override);
assert(getTitleHumanizerPairs('delf_b2_writing', '草稿', 6).length === 1, '测试 override 可隔离文件系统样本');
assert(getTitleHumanizerPairs('tef_tcf_canada', '草稿', 6).length === 0, 'track 隔离生效');
setTitleHumanizerPairsForTest([]);
assert(getTitleHumanizerPairs('delf_b2_writing', '草稿', 6).length === 0, '空 override 可显式关闭 Humanizer');
setTitleHumanizerPairsForTest(null);

if (failures) {
  console.error(`\n${failures} FAILURES`);
  process.exitCode = 1;
} else {
  console.log('\nALL PASS');
}
