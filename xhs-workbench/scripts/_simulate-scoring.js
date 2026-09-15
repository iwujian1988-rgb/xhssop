// 端到端打分模拟：配置前 vs 配置后，#6 的 5 个候选谁赢？
// 用下午 DELF batch #6 (seed=delf_time_allocation) 的真实候选

// 假设 delf_time_allocation 配置后的关键词（演示用）
const TIME_ALLOC_KW = ['时间分配', '时间表', '60分钟', '时间坑', '时间花错', '分钟'];

function isAnchored(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.some(kw => /^[a-z]+$/i.test(kw) ? lower.includes(kw.toLowerCase()) : title.includes(kw));
}
function countHits(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.reduce((n, kw) => n + (/^[a-z]+$/i.test(kw) ? (lower.includes(kw.toLowerCase()) ? 1 : 0) : (title.includes(kw) ? 1 : 0)), 0);
}

// 复刻 titleImpactScore 的核心规则
function impactScore(title, seedId, keywords) {
  let s = 0;
  if (/写不好|说不长|听不懂|背了也用不上|一直在扣分|老丢分|扣分|写不出来|用不上|没方向/.test(title)) s += 4;
  if (/法语|DELF|B2|TEF|TCF/i.test(title)) s += 3;
  if (/[？?!！]/.test(title)) s += 2;
  if (/\d/.test(title)) s += 2;
  if (/别再|先别|停止|警告|常犯|错误|避坑|白费|漏|错|跑题|卡住|乱|不懂|不会|差在哪|问题在这|根本原因/i.test(title)) s += 5;
  if (/为什么|其实|反而|不是|到底|真的|原来|看懂也会|背了还|资料越多/.test(title)) s += 4;
  if (/大全|必背|万能|考官|稳过|提分|冲刺|急救|救命|白考|白费|别乱|别硬背|别再|官方必背|最爱看/.test(title)) s += 4;
  if (/交卷前|考前|写完|一到考场|刚开始|没时间|零基础|B2考生/.test(title)) s += 3;
  if (/一页|这张表|这几类|这\d+[处类项步句个]|清单|体系|地图/.test(title)) s += 2;
  if (/怎么准备|这样准备|学习方案|知识点|指南|手册|内容整理/.test(title)) s -= 5;
  if (title.length > 20) s -= 2;
  if (title.length < 9) s -= 1;

  // seed 锚定（新逻辑：传入 keywords）
  if (keywords && keywords.length > 0) {
    if (isAnchored(title, keywords)) {
      s += 2;
      if (countHits(title, keywords) >= 2) s += 1;
    } else {
      s -= 8;
    }
  } else {
    // 未配置 → 自动 +2（即当前的 bug 行为）
    s += 2;
  }
  // 产品身份 DELF/B2/写作 都在
  if (/DELF|B2|写作/.test(title)) s += 3;
  return s;
}

const candidates = [
  'B2写作时间分配表，60分钟拆到分钟',
  'B2写作总写不完？时间花错了地方',
  'B2写作写不完？先查这3个时间坑',
  '救命，DELF B2写作不是不会写',
  'DELF B2写作60分钟这样分，稳写完',
];

console.log('========== DELF #6 候选打分对比 ==========\n');
console.log('seed = delf_time_allocation\n');

console.log('--- 现状（未配置关键词，bug 触发）---');
const scoresNow = candidates.map(t => ({ t, s: impactScore(t, 'delf_time_allocation', null) }));
scoresNow.sort((a, b) => b.s - a.s);
scoresNow.forEach((c, i) => console.log('  ' + (i===0?'🏆':'  ') + ' +' + String(c.s).padStart(3) + '  ' + c.t));
console.log('  → 系统挑: ' + scoresNow[0].t);

console.log('\n--- 配置关键词后 ---');
const scoresFixed = candidates.map(t => ({ t, s: impactScore(t, 'delf_time_allocation', TIME_ALLOC_KW) }));
scoresFixed.sort((a, b) => b.s - a.s);
scoresFixed.forEach((c, i) => console.log('  ' + (i===0?'🏆':'  ') + ' +' + String(c.s).padStart(3) + '  ' + c.t));
console.log('  → 系统挑: ' + scoresFixed[0].t);
