import fs from 'node:fs';
import path from 'node:path';

const sourcePath = path.join(process.cwd(), 'src', 'lib', 'reference-compose.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

const start = source.indexOf('export function buildLocalHumanTitlePool');
const end = source.indexOf('function getPreferredTitleTypesForTemplate', start);
if (start < 0 || end < 0) {
  throw new Error('Cannot locate local title insurance block.');
}

const block = source.slice(start, end);
const badSurface = /资料太散|拖后腿|白背|写作任务|卡住|卡在这一步|长啥样|一次看懂|先看哪份资料|备考这次具体练什么|备考先查这张表|怎么准备|这样准备/;
const strings = Array.from(block.matchAll(/'([^'\n]{6,32})'/g), match => match[1])
  .filter(text => /[一-鿿]/.test(text))
  .filter(text => !/directory|table|document|book|roadmap|cover|text|delf_|tef_|tcf_/.test(text));

const titles = strings.filter(text =>
  /DELF|B2|TEF|TCF|CLB|法语|加拿大|作文|写作|口语|听力|阅读|词汇|范文|格式|交卷|考前/.test(text)
);

const failures = [];
for (const title of titles) {
  const length = Array.from(title).length;
  const hasIdentity = /DELF|B2|TEF|TCF|CLB|法语|加拿大/.test(title);
  const okLength = length >= 8 && length <= 24;
  const okSurface = !badSurface.test(title);
  if (!hasIdentity || !okLength || !okSurface) {
    failures.push(`${title} len=${length} identity=${hasIdentity} surface=${okSurface}`);
  }
}

console.log(`checked ${titles.length} local title strings`);
for (const title of titles.slice(0, 40)) console.log(`- ${title} (${Array.from(title).length})`);

if (failures.length) {
  console.error('\nFAILURES');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('\nStatic title insurance audit passed.');
