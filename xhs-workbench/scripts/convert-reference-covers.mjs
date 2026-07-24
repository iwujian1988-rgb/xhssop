import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const outputDir = join(projectRoot, 'public', 'reference-covers');
const converter = 'C:\\Users\\imwuj\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\bin\\heif-convert.cmd';
const competitorRoot = 'D:\\claude_work\\taolun\\法语付费资料\\_xhs_competitor';

const refs = [
  ['ref_list_01', 'TCFgo法语加拿大', '6a0306e9000000003502a26e.heif'],
  ['ref_list_02', 'TCFgo法语加拿大', '6a04b77100000000380366ce.heif'],
  ['ref_table_01', 'TCFgo法语加拿大', '6807e7ed000000000b02ff95.heif'],
  ['ref_table_02', 'TCFgo法语加拿大', '6a035d560000000036030bbf.heif'],
  ['ref_pain_01', 'TCFgo法语加拿大', '6a01f1e6000000003701c932.heif'],
  ['ref_pain_02', 'TCFgo法语加拿大', '6a0de7e100000000370340ec.heif'],
  ['ref_doc_01', 'TCFgo法语加拿大', '6a0c9fff00000000380353d3.heif'],
  ['ref_doc_02', 'TCFgo法语加拿大', '6a11ddc9000000003700dfb8.heif'],
  ['ref_practice_01', 'TCFgo法语加拿大', '6a0f39070000000036003090.heif'],
  ['ref_practice_02', 'TCFgo法语加拿大', '6a15c429000000003501ca0f.heif'],
  ['ref_rescue_01', '英语冲九分伟学', '698460bc000000000a032d07.heif'],
  ['ref_rescue_02', 'TCFgo法语加拿大', '6a04b77100000000380366ce.heif'],
];

mkdirSync(outputDir, { recursive: true });

if (!existsSync(converter)) {
  throw new Error(`Missing HEIF converter: ${converter}`);
}

for (const [id, account, imageFile] of refs) {
  const input = join(competitorRoot, account, 'images', imageFile);
  const output = join(outputDir, `${id}.png`);

  if (!existsSync(input)) {
    console.error(`missing: ${id} -> ${input}`);
    process.exitCode = 1;
    continue;
  }

  const result = spawnSync(converter, [input, output], { encoding: 'utf8', shell: true });
  if (result.status !== 0) {
    console.error(`failed: ${id}`);
    if (result.error) console.error(result.error.message);
    if (result.stdout) console.error(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exitCode = 1;
    continue;
  }

  console.log(`converted: ${id}`);
}
