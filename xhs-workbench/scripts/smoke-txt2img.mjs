import { readFileSync, writeFileSync } from 'fs';

const visual = [
  '3:4竖版小红书封面，法语教材封面风，扁平矢量插画，干净现代。',
  '上半：顶部一条横色带——左侧朱红方块写短品牌词（如FLE），右侧青绿条写等级标签（如OBJECTIF B2）。',
  '中部大白底：左侧竖向深蓝窄条，中间超大深蓝无衬线主标题（中文可换行），其下青绿小字副标题。',
  '下半：满铺青绿色块，一对简化人物剪影面对面交谈，周围多个白色对话气泡，气泡内放简单图标（信封、灯泡、地球、齿轮、@等），至少一个气泡里有短中文说明。',
  '底部角落可有极小出版信息感装饰，但不要真实出版社logo、作者名、二维码。',
  '配色：青绿#3F8880、朱红#C1272D、深蓝#2B547E、纯白。整体像实体法语教材封面，信息疏朗，不是PPT。',
].join('\n');

const prompt = [
  '直接文生图，输出一张完整的3:4竖版小红书封面成品。不要上传参考图，不要图生图编辑。',
  '【模板视觉】',
  visual,
  '【本篇必须写入画面的文案——一字不改地画出来】',
  '主标题：DELF B2写作虚拟式急救手册',
  '副标题：用对虚拟式，论证立刻高级一档',
  '正文内容：',
  '1. 三类必用场景',
  '- bien que｜让步从句用虚拟式',
  '- il faut que｜必要性从句用虚拟式',
  '2. 常见错改',
  '- Bien que je sois fatigué｜尽管我很累',
  '- Il faut que je prenne｜我必须做决定',
  '【硬性要求】',
  '画面必须填满整张图，禁止大片留白或下半截空白。',
  '中文和法语清楚可读、无乱码、无断词、无重叠；标题在手机缩略图仍能看清。',
  '只使用上面的本篇文案，不要编造品牌、出版社、作者、账号、二维码、咨询入口。',
].join('\n\n');

const negative = [
  '不要图生图式半成品，不要大片空白。',
  '不要PPT风、网页卡片风、极简空海报。',
  '不要乱码、错别字、随机英文、文字重叠、断词、过小标题。',
  '不要真实出版社logo、作者签名、二维码、水印、咨询按钮。',
].join('\n');

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

const base = (env.IMAGE_API_BASE_URL || 'https://zexapi.com').replace(/\/$/, '');
const body = {
  model: env.IMAGE_API_MODEL || 'gpt-image-2',
  prompt: `${prompt}\n\n【硬性禁止】\n${negative}`,
  aspect_ratio: '3:4',
};

console.log('submitting text-to-image...');
const res = await fetch(`${base}/v1/videos`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.IMAGE_API_KEY}`,
  },
  body: JSON.stringify(body),
});
const text = await res.text();
console.log('submit', res.status, text.slice(0, 400));
if (!res.ok) process.exit(1);
const task = JSON.parse(text);
writeFileSync('D:/claude_work/waiyuxhssop/book_cover_txt2img_task.json', JSON.stringify(task, null, 2));

for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 5000));
  const poll = await fetch(`${base}/v1/videos/${encodeURIComponent(task.id)}`, {
    headers: { Authorization: `Bearer ${env.IMAGE_API_KEY}` },
  });
  const pt = await poll.text();
  let data;
  try {
    data = JSON.parse(pt);
  } catch {
    console.log('poll raw', poll.status, pt.slice(0, 120));
    continue;
  }
  console.log('poll', i, data.status, data.progress, data.url || '', data.error?.message || '');
  if (data.status === 'completed' || data.status === 'failed') {
    writeFileSync('D:/claude_work/waiyuxhssop/book_cover_txt2img_task.json', JSON.stringify(data, null, 2));
    if (data.url) {
      const img = await fetch(data.url);
      const buf = Buffer.from(await img.arrayBuffer());
      writeFileSync('D:/claude_work/waiyuxhssop/book_cover_txt2img.png', buf);
      console.log('saved', buf.length, 'bytes -> D:/claude_work/waiyuxhssop/book_cover_txt2img.png');
    }
    process.exit(data.status === 'completed' ? 0 : 1);
  }
}
console.log('timeout');
process.exit(1);
