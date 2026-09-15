/* eslint-disable no-console */
import fs from 'node:fs/promises';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { diagnoseTitlePair, passesTitleHardGatesForTest, selectTitleCandidateForTest } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { countVisibleUnits, type ContentPackage, type TitlePair, type TopicOption } from '../src/lib/v2/contracts';

const source = JSON.parse(await fs.readFile('v2-real-acceptance-20260818-full.json', 'utf8')) as { jobs: any[] };
const recent = JSON.parse(await fs.readFile('data/title-usage.json', 'utf8')) as Array<{ title: string; cover_title: string }>;

const cases: Array<{ index: number; label: string; candidates: TitlePair[] }> = [
  {
    index: 0,
    label: 'DELF观点库 / 羊皮纸资料型',
    candidates: [
      pair('DELF B2写作没观点？10大主题直接查', 'DELF B2写作没观点先看这页', '10大主题各有可直接调用的论点', 'search_utility'),
      pair('考场想不出观点？DELF B2这页能救急', 'DELF B2考场没观点先看这页', '教育、环境、科技等高频主题都整理好了', 'loss_tension'),
      pair('DELF B2写作别再硬编观点', 'DELF B2观点不是临场硬想的', '常考主题提前准备，考场才能快速调用', 'cognitive_conflict'),
      pair('DELF B2写作10大主题都有话写', 'DELF B2写作10大主题都有话写', '每个主题都配好论点和适用场景', 'result_gain'),
    ],
  },
  {
    index: 1,
    label: 'DELF审题 / 黑板短语型',
    candidates: [
      pair('DELF B2写作总跑题？审题先做这3步', 'DELF B2写作总跑题先做这3步', '先看文体，再找对象，最后定立场', 'search_utility'),
      pair('DELF B2写作最怕的不是语法错，是跑题', 'DELF B2写作跑题比语法错更亏', '审题时漏掉对象和立场，后面写得再多也会偏', 'loss_tension'),
      pair('DELF B2写作跑题，问题可能不在法语', 'DELF B2跑题可能不是法语问题', '真正容易漏掉的是文体、对象和立场', 'cognitive_conflict'),
      pair('审题做对这3步，DELF B2写作不再跑偏', 'DELF B2审题3步不再写偏', '一套顺序看清题目到底让你写什么', 'result_gain'),
    ],
  },
  {
    index: 2,
    label: 'DELF评分 / 备忘录型',
    candidates: [
      pair('DELF B2写作评分标准，一页看懂', 'DELF B2评分标准考前看懂', '评分不只看语法，5个维度一起决定档位', 'search_utility'),
      pair('DELF B2写作练很多却不提分？先看评分', 'DELF B2写作不提分先看评分', '方向练错了，写再多篇也难发现问题', 'loss_tension'),
      pair('DELF B2写作别只盯着语法错', 'DELF B2写作只改语法还不够', '完成任务、连贯、语域、词汇和句法都要看', 'cognitive_conflict'),
      pair('看懂评分标准，DELF B2练一篇顶三篇', 'DELF B2按评分标准练更省力', '每写一篇都知道该检查什么、下次该练什么', 'result_gain'),
    ],
  },
  {
    index: 5,
    label: 'TEF/TCF选考 / 羊皮纸资料型',
    candidates: [
      pair('TEF还是TCF？报名前先比这4项', 'TEF/TCF报名前先比这4项', '题型、时长、写作和口语形式一次看清', 'search_utility'),
      pair('TEF/TCF选错，备考方向真要重来', 'TEF/TCF怕选错的先看这页', '报名前先看任务差异，别靠别人一句话决定', 'loss_tension'),
      pair('TEF/TCF别跟风选，先试官方样题', 'TEF/TCF不是别人选啥你选啥', '两种考试都被认可，任务形式适不适合你更重要', 'cognitive_conflict'),
      pair('TEF/TCF选对考试，备考少走弯路', 'TEF/TCF选对再开始备考', '先确认项目，再体验样题，最后按自己情况决定', 'result_gain'),
    ],
  },
  {
    index: 6,
    label: 'TEF/TCF选考 / 黑板短语型',
    candidates: [
      pair('TEF/TCF口语写作差在哪？这页讲清', 'TEF/TCF口语写作差异先看清', '任务数量、准备时间和作答方式逐项对照', 'search_utility'),
      pair('TEF/TCF没选对，刷题越多越浪费', 'TEF/TCF刷题前先把考试选对', '两种考试任务不同，资料和练法不能混着用', 'loss_tension'),
      pair('TEF/TCF选哪个，不只看谁更简单', 'TEF/TCF别只问哪个更简单', '先比较任务形式，再看自己更适应哪一种', 'cognitive_conflict'),
      pair('看完口语写作差异，再定TEF还是TCF', 'TEF/TCF看完任务差异再决定', '用真实任务形式帮你排除不适合的选择', 'result_gain'),
    ],
  },
  {
    index: 9,
    label: 'TEF/TCF选考 / 文档解析型',
    candidates: [
      pair('TEF/TCF到底差在哪？任务原表拆给你看', 'TEF/TCF任务差异拆开看', '阅读、听力、写作、口语逐项解析', 'search_utility'),
      pair('TEF/TCF只听别人推荐，很容易选错', 'TEF/TCF别只听别人推荐', '把官方任务摆在一起，你才知道哪种更适合', 'loss_tension'),
      pair('TEF/TCF都被认可，不代表随便选', 'TEF/TCF都认可也不能随便选', '真正要比较的是题型、任务数量和准备方式', 'cognitive_conflict'),
      pair('拆完两套任务，TEF/TCF就好选了', 'TEF/TCF任务拆完就好选了', '先体验官方样题，再按自己的强弱项决定', 'result_gain'),
    ],
  },
];

const report: Array<{
  label: string;
  topic: string;
  inspected: Array<{
    candidate: TitlePair;
    textUnits: number;
    coverUnits: number;
    hardPass: boolean;
    failures: string[];
  }>;
  selected: TitlePair | null;
}> = [];
let failed = false;
for (const testCase of cases) {
  const job = source.jobs[testCase.index];
  const topic = job.artifacts.selectedTopic.data as TopicOption;
  const content = job.artifacts.content.data as ContentPackage;
  const card = getCompetitorCreativeCard(job.reference_card_id);
  if (!card) throw new Error(`找不到竞品卡：${job.reference_card_id}`);
  const input = { topic, content, capability: getCapabilityFallback(card) };
  const inspected = testCase.candidates.map(candidate => ({
    candidate,
    textUnits: countVisibleUnits(candidate.textTitle),
    coverUnits: countVisibleUnits(candidate.coverTitle),
    hardPass: passesTitleHardGatesForTest(candidate, input),
    failures: diagnoseTitlePair(candidate, input),
  }));
  const valid = inspected.filter(item => item.hardPass).map(item => item.candidate);
  if (!valid.length) failed = true;
  const selected = valid.length ? selectTitleCandidateForTest(valid, input, recent) : null;
  report.push({ label: testCase.label, topic: topic.topic, inspected, selected });
}

await fs.writeFile('tmp-own-ai-title-quality.json', JSON.stringify(report, null, 2), 'utf8');
await fs.writeFile('own-ai-title-quality-review.html', renderHtml(report), 'utf8');
for (const item of report) {
  console.log(`\n[${item.label}]`);
  console.log(`选题：${item.topic}`);
  for (const row of item.inspected) {
    console.log(`${row.hardPass ? '√' : '×'} ${row.candidate.mechanism} | ${row.candidate.textTitle} | ${row.candidate.coverTitle} | ${row.textUnits}/${row.coverUnits}${row.failures.length ? ` | 质量诊断：${row.failures.join(',')}` : ''}`);
  }
  console.log(`最终：${item.selected ? `${item.selected.textTitle} / ${item.selected.coverTitle}` : '无候选通过'}`);
}
if (failed) process.exitCode = 1;

function pair(
  textTitle: string,
  coverTitle: string,
  coverSubtitle: string,
  mechanism: TitlePair['mechanism'],
): TitlePair {
  return {
    textTitle,
    coverTitle,
    coverSubtitle,
    mechanism,
    userRelation: '标题直接对应当前用户处境、风险或马上可获得的结果',
    seoKeyword: textTitle.includes('TEF') ? 'TEF/TCF' : 'DELF B2写作',
    noveltyFingerprint: `${mechanism}|${coverTitle}`,
  };
}

function renderHtml(items: typeof report) {
  const cards = items.map(item => `
    <section>
      <div class="eyebrow">${escapeHtml(item.label)}</div>
      <h2>${escapeHtml(item.topic)}</h2>
      <div class="winner">
        <span>本地选拔器最终选择</span>
        <strong>${escapeHtml(item.selected?.textTitle || '无')}</strong>
        <b>${escapeHtml(item.selected?.coverTitle || '无')}</b>
      </div>
      <div class="grid">
        ${item.inspected.map(row => `
          <article class="${row.hardPass ? 'pass' : 'fail'}">
            <header>${escapeHtml(row.candidate.mechanism)} <i>${row.textUnits}/${row.coverUnits}字</i></header>
            <h3>${escapeHtml(row.candidate.textTitle)}</h3>
            <p class="cover">封面：${escapeHtml(row.candidate.coverTitle)}</p>
            <p>${escapeHtml(row.candidate.coverSubtitle || '')}</p>
            <small>${row.hardPass ? '硬门通过' : '硬门未通过'}${row.failures.length ? ` · ${escapeHtml(row.failures.join('；'))}` : ''}</small>
          </article>`).join('')}
      </div>
    </section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>标题阶段离线质量验收</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f6f8;color:#1d2430;font-family:"Microsoft YaHei",system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:36px 28px 80px}h1{font-size:30px;margin:0 0 8px}.intro{color:#667085;margin:0 0 28px}section{background:white;border:1px solid #dfe3e8;border-radius:8px;padding:24px;margin:0 0 22px}.eyebrow{font-size:13px;color:#067647;font-weight:700}h2{font-size:20px;margin:7px 0 16px}.winner{display:grid;grid-template-columns:150px 1fr 1fr;gap:12px;align-items:center;background:#ecfdf3;border-left:4px solid #17b26a;padding:13px 16px;margin-bottom:18px}.winner span{font-size:13px;color:#067647}.winner strong,.winner b{font-size:17px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}article{border:1px solid #dfe3e8;padding:15px;min-height:178px}article.fail{background:#fff7f6;border-color:#f6cfc9}article header{font-size:12px;text-transform:uppercase;color:#475467;font-weight:700}article i{float:right;font-style:normal;color:#98a2b3}h3{font-size:18px;margin:12px 0 8px}.cover{font-weight:700;color:#344054}article p{margin:6px 0;font-size:14px;line-height:1.5}small{display:block;color:#667085;margin-top:12px;line-height:1.45}@media(max-width:800px){.grid{grid-template-columns:1fr}.winner{grid-template-columns:1fr}main{padding:20px 12px}}
  </style></head><body><main><h1>标题阶段离线质量验收</h1><p class="intro">我的模型能力生成候选；生产代码负责硬门、历史去重和最终选拔。未调用 DeepSeek。</p>${cards}</main></body></html>`;
}

function escapeHtml(value: string) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}
