import { readFileSync, writeFileSync } from 'fs';

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
const negative = [
  '不要图生图式半成品，不要大片空白。',
  '不要PPT风、网页卡片风、极简空海报。',
  '不要乱码、错别字、随机英文、文字重叠、断词、过小标题。',
  '不要真实出版社logo、作者签名、二维码、水印、咨询按钮。',
].join('\n');

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

const jobs = [
  {
    id: 'vocab_table',
    out: 'D:/claude_work/waiyuxhssop/vocab_table_txt2img.png',
    prompt: [
      '直接文生图，输出一张完整的3:4竖版小红书封面成品。不要上传参考图，不要图生图编辑。',
      '【模板骨架·必须保持一致】',
      [
        '3:4竖版小红书封面，主题词汇表压屏风。',
        '骨架固定：背景是真实感很强的蓝白双语词汇表格截图（多段表格、深蓝表头、细灰边框、法语词+中文释义密排）→ 正中央叠超大白字黑描边中文主标题。',
        '配色固定：冷色蓝白为主，表头深蓝，标题白字黑描边。整体高密度、资料厚重感，不像网页UI。',
        '标题处理固定：字号极大，手机缩略图一眼能看清；压在表格之上但不把表格纹理完全遮死。',
      ].join('\n'),
      `【本次允许变化的细节·只改这些】\n${pick([
        '本次细节：右上角小页码气泡写1/8；表格分两段主题，表头略深。',
        '本次细节：右上角页码气泡写2/10；表格三段，中间段略浅灰底。',
        '本次细节：标题略偏上三分之一；表格四列清晰，右下角有轻微纸张阴影。',
      ])}\n注意：主体风格、配色、标题字号层级和版式骨架不要变。`,
      '【本篇必须写入画面的文案——一字不改地画出来】',
      '主标题：DELF B2主题词汇',
      '副标题：按场景整理的写作表达',
      '正文内容：\n1. 教育与工作\n- formation｜培训\n- candidature｜申请材料\n2. 生活与关系\n- entourage｜周围的人\n- solidarité｜互助',
      '【硬性要求】\n画面必须填满整张图，禁止大片留白。中文和法语清楚可读。',
    ].join('\n\n'),
  },
  {
    id: 'course_roadmap',
    out: 'D:/claude_work/waiyuxhssop/course_roadmap_txt2img.png',
    prompt: [
      '直接文生图，输出一张完整的3:4竖版小红书封面成品。不要上传参考图，不要图生图编辑。',
      '【模板骨架·必须保持一致】',
      [
        '3:4竖版小红书封面，浅蓝信息图学习路径风。',
        '骨架固定：顶部大号深蓝中文主标题 → 主体两栏（左适合人群 / 右四阶段卡片）→ 底部资料承接条。',
        '配色固定：浅蓝底#E6F0FF、深蓝标题、白卡片、少量黄色点缀。扁平信息图，干净不幼稚。',
        '标题处理固定：顶部居中大号深蓝无衬线标题，清晰醒目。',
      ].join('\n'),
      `【本次允许变化的细节·只改这些】\n${pick([
        '本次细节：右侧四张阶段卡错落排列；插画是坐着看书的人。',
        '本次细节：右侧阶段卡呈轻微阶梯下落；插画是走路捧书的人。',
        '本次细节：阶段卡之间用细箭头串联；底部承接条带一盏小黄灯泡点缀。',
      ])}\n注意：主体风格、配色、标题字号层级和版式骨架不要变。`,
      '【本篇必须写入画面的文案——一字不改地画出来】',
      '主标题：法语B2写作复习路径',
      '副标题：从会写到会检查的4阶段',
      '正文内容：\n1. 适合人群\n- 会写但不会改｜总在同一类错误上反复扣分\n- 考前1个月｜需要清晰复习顺序\n2. 四阶段\n- 01 找薄弱点｜先测再练\n- 02 拆范文｜看懂段落作用\n- 03 限时写｜记录真实卡点\n- 04 清单复查｜只改最常犯的问题',
      '【硬性要求】\n画面必须填满整张图。底部承接只写资料包/练习路径，禁止一对一、直播课、老师批改、无限答疑。',
    ].join('\n\n'),
  },
];

async function runOne(job) {
  console.log('submitting', job.id);
  const res = await fetch(`${base}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.IMAGE_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.IMAGE_API_MODEL || 'gpt-image-2',
      prompt: `${job.prompt}\n\n【硬性禁止】\n${negative}`,
      aspect_ratio: '3:4',
    }),
  });
  const text = await res.text();
  console.log(job.id, 'submit', res.status, text.slice(0, 200));
  if (!res.ok) throw new Error(`${job.id} submit failed`);
  const task = JSON.parse(text);

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
      console.log(job.id, 'poll raw', poll.status, pt.slice(0, 100));
      continue;
    }
    console.log(job.id, 'poll', i, data.status, data.progress || 0);
    if (data.status === 'completed' || data.status === 'failed') {
      if (data.status !== 'completed' || !data.url) throw new Error(`${job.id} failed: ${data.error?.message || data.status}`);
      const img = await fetch(data.url);
      const buf = Buffer.from(await img.arrayBuffer());
      writeFileSync(job.out, buf);
      console.log(job.id, 'saved', buf.length, '->', job.out);
      return;
    }
  }
  throw new Error(`${job.id} timeout`);
}

for (const job of jobs) {
  await runOne(job);
}
