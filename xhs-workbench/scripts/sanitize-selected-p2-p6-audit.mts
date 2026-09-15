import fs from 'node:fs/promises';

const path = '.tmp-selected-p2-p6-audit.json';
const data = JSON.parse(await fs.readFile(path, 'utf8'));
function clean(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/万能开场白/g, '常用开场表达').replace(/万能例子/g, '常用例子').replace(/万能模板/g, '可复用句型').replace(/万能/g, '常用').replace(/In deed/gi, 'En effet');
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  return value;
}
const sanitized = clean(data) as any;
sanitized.sanitization = ['仅做离线措辞统一：万能→常用/可复用；In deed→En effet；未重新调用模型'];
await fs.writeFile(path, JSON.stringify(sanitized, null, 2), 'utf8');
console.log('SANITIZED_SELECTED_P2_P6');
