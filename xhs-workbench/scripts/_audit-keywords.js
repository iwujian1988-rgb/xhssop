// 5 个样例 seed 关键词的质量审计 + 下午数据回测
const fs = require('fs');

// 1. 从 seed-topic-anchor.ts 解析现有的 25 个已配置 seed
const anchorSrc = fs.readFileSync('src/lib/seed-topic-anchor.ts', 'utf8');
const existingKw = {};
const seedBlockMatch = anchorSrc.slice(
  anchorSrc.indexOf('const SEED_TOPIC_KEYWORDS'),
  anchorSrc.indexOf('};', anchorSrc.indexOf('const SEED_TOPIC_KEYWORDS'))
);
for (const m of seedBlockMatch.matchAll(/^  ([a-z_]+):\s*\[([^\]]+)\]/gm)) {
  existingKw[m[1]] = m[2].split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
}
console.log('已配置 seed 数:', Object.keys(existingKw).length);

// 2. 我提案的 5 个新 seed 关键词
const newKw = {
  tef_ee_score_bonus: ['EE', 'EE法语', 'CRS', '法语加分', '法语单抽', '算分'],
  tcf_writing_t1_template: ['Tâche 1', 'T1', '写作骨架', '11场景', 'T1救急', '骨架'],
  tef_pain_speaking_silent: ['口语冷场', '冷场', '救场', '卡壳', '陌生话题', '不冷场'],
  tef_theme_immigration: ['移民主题', '移民论据', '移民词块', '移民词'],
  tef_selling_t3_prediction: ['T3高概率', 'T3真题', '月度真题', '按月整理', '月度更新', '高概率真题'],
};

// 3. 模拟 isTitleAnchoredToSeed
function isAnchored(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.some(kw => {
    if (/^[a-z]+$/i.test(kw)) return lower.includes(kw.toLowerCase());
    return title.includes(kw);
  });
}

// 4. 两两重叠检查（新 vs 新 + 新 vs 已配置）
console.log('\n========== 两两关键词重叠检查 ==========\n');
const allKw = { ...existingKw, ...newKw };
let collisionCount = 0;
for (const newSeed of Object.keys(newKw)) {
  console.log('--- ' + newSeed + ' ---');
  console.log('  关键词: ' + newKw[newSeed].join(', '));
  for (const otherSeed of Object.keys(allKw)) {
    if (otherSeed === newSeed) continue;
    const overlap = newKw[newSeed].filter(kw => allKw[otherSeed].includes(kw));
    if (overlap.length > 0) {
      const pct = (overlap.length / newKw[newSeed].length * 100).toFixed(0);
      console.log('  ⚠ 与 ' + otherSeed + ' 重叠 ' + pct + '%: ' + overlap.join(', '));
      if (parseInt(pct) >= 30) collisionCount++;
    }
  }
  console.log('');
}
console.log('超过 30% 重叠的 seed 数:', collisionCount, '(应为 0)');

// 5. 下午数据回测：错位标题必须 NOT 命中锚定
console.log('\n========== 下午数据回测 ==========\n');
const afternoonCases = [
  // [seed, 实际出的错位标题, 期望(错位标题不应该锚定), 说明]
  ['tef_ee_score_bonus', '3个月冲CLB7，TEF/TCF先这样排', false, '错位成 clb7_self_test 主题'],
  ['tef_ee_score_bonus', 'EE法语加分怎么算？CLB7能加多少', true, '正面：精准命中 EE 主题'],
  ['tcf_writing_t1_template', 'TEF/TCF Canada范文到底怎么', false, '错位 + 截断'],
  ['tcf_writing_t1_template', 'TCF CA写作T1骨架，11场景都套得上', true, '正面：命中 T1 + 骨架'],
  ['tef_pain_speaking_silent', 'TEF/TCF别再硬背模板', false, '错位成 writing_patterns'],
  ['tef_pain_speaking_silent', 'TEF/TCF口语冷场？3句救场不扣分', true, '正面：命中 冷场 + 救场'],
  ['tef_theme_immigration', 'TEF/TCF备考词块整理好了', false, '通用，没提到移民'],
  ['tef_theme_immigration', '移民主题词块这样攒，写作口语直接套', true, '正面：命中 移民主题'],
  ['tef_selling_t3_prediction', 'TEF/TCF口语怎么准备', false, '通用'],
  ['tef_selling_t3_prediction', 'TCF口语T3高概率真题，按月整理好了', true, '正面：命中 T3高概率 + 按月'],
];

let pass = 0, fail = 0;
for (const [seed, title, expected, note] of afternoonCases) {
  const kw = newKw[seed];
  if (!kw) continue;
  const hit = isAnchored(title, kw);
  const ok = hit === expected;
  const status = ok ? '✓ PASS' : '✗ FAIL';
  const expectStr = expected ? '应命中' : '不应命中';
  const actualStr = hit ? '命中' : '未命中';
  console.log(status + ' | ' + seed.padEnd(28) + ' | ' + expectStr + '/' + actualStr + ' | "' + title + '"');
  console.log('       (' + note + ')');
  if (ok) pass++; else fail++;
}
console.log('\n回测结果: ' + pass + ' 通过 / ' + fail + ' 失败（应为 ' + pass + '/0）');
