import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/check-title-matrix.mjs <json>');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const badEnding = /(?:先|把|给|的|和|与|在|还|最|这|这个|这里|怎么|问题出在|别再|早该|每|直|高频主|这\d+个常|先看这张)$/u;
const issues = [];
const selectedSeen = new Map();

function hasIdentity(value, product) {
  return product.startsWith('商品1')
    ? /DELF\s*B2|法语\s*B2|B2\s*写作|B2\s*作文|法语写作/i.test(value)
    : /TEF\s*\/\s*TCF|TEF|TCF|CLB\s*7|加拿大法语/i.test(value);
}

for (const row of data.rows) {
  const titles = [
    ['cover', row.coverTitle],
    ['selected', row.selectedTextTitle],
    ...row.textTitles.map((item, index) => [`text${index}`, item.title]),
  ];
  for (const [role, value] of titles) {
    const length = Array.from(value).length;
    const min = role === 'cover' ? 10 : 13;
    if (length < min || length > 20 || badEnding.test(value) || !hasIdentity(value, row.product)) {
      issues.push({ card: row.cardId, role, length, value });
    }
    if (role === 'selected') {
      const key = value.replace(/[\s，,。；;：:！？!?]/g, '').toLowerCase();
      selectedSeen.set(key, [...(selectedSeen.get(key) || []), row.cardId]);
    }
  }
}

console.log(JSON.stringify({
  rows: data.rows.length,
  issues,
  duplicateSelected: [...selectedSeen].filter(([, cards]) => cards.length > 1),
  samples: data.rows.map(row => ({
    product: row.product.startsWith('商品1') ? 'P1' : 'P2',
    card: row.cardId,
    cover: row.coverTitle,
    selected: row.selectedTextTitle,
  })),
}, null, 2));
