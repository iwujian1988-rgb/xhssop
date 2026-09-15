import fs from 'node:fs';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/build-quality-latest.mjs <summary.json>');
  process.exit(1);
}

const jobs = JSON.parse(fs.readFileSync(input, 'utf8'));

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const rows = jobs.map((job, index) => {
  const statusClass = job.status === 'success' ? 'ok' : 'bad';
  return `<section class="job ${statusClass}">
    <h2>#${index + 1} ${esc(job.suite)} / ${esc(job.card)} / ${esc(job.status)}</h2>
    <p><b>选题</b>：${esc(job.topic)}</p>
    <p><b>封面标题</b>：${esc(job.cover || '')}</p>
    <p><b>封面副标题</b>：${esc(job.subtitle || '')}</p>
    <p><b>文字标题</b>：${esc(job.title || '')}</p>
    <p><b>标签</b>：${esc((job.tags || []).join(' '))}</p>
    <p><b>失败原因</b>：${esc(job.fail || '')}</p>
    <p><b>用量</b>：${esc(JSON.stringify(job.usage || {}))}</p>
  </section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>小批量质量验收</title>
<style>
body{font-family:Arial,"Microsoft YaHei",sans-serif;background:#f6f3ef;margin:0;padding:24px;color:#222}
h1{max-width:1100px;margin:0 auto 18px}
.job{background:#fff;border:1px solid #ddd;border-left:8px solid #999;border-radius:10px;padding:16px;margin:14px auto;max-width:1100px}
.job.ok{border-left-color:#16864f}.job.bad{border-left-color:#c0392b}
h2{font-size:18px;margin:0 0 10px}p{line-height:1.7;margin:6px 0}b{color:#513629}
</style>
</head>
<body>
<h1>小批量质量验收</h1>
${rows}
</body>
</html>`;

fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/quality-acceptance-latest.html', html, 'utf8');
console.log('http://localhost:4010/quality-acceptance-latest.html');
