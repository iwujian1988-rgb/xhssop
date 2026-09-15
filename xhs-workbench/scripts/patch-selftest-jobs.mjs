/* eslint-disable no-console */
/**
 * 修补 self-test batch 的 2 个 success job，让产物可直接发小红书。
 * 修的问题：
 *   job_002: selected_title 说"9 类"但 cover 只画了 4 类 → 改 4 类
 *            caption 里"9 类"和"30 条错题库"承诺也对不上 → 重写
 *   job_003: cover section 2 有 3 条 secondary 被截断（"→主体1→" "→调用" "→论点+例"）→ 补全
 *            caption 有"别只看 X 不够，更要看 Y"和"其实 X"AI 套话 → 重写
 *
 * 用法：node scripts/patch-selftest-jobs.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const BATCH_DIR = 'data/batches/batch_1785827260248';

function loadJob(name) {
  return JSON.parse(fs.readFileSync(path.join(BATCH_DIR, 'jobs', name + '.json'), 'utf8'));
}

function saveJob(name, data) {
  fs.writeFileSync(path.join(BATCH_DIR, 'jobs', name + '.json'), JSON.stringify(data, null, 2), 'utf8');
}

// --- job_002: 标题"9类"→"4类"，重写 caption ---
function patchJob002() {
  const job = loadJob('job_002');
  const d = job.draft;

  // 标题改 4 类（cover 实际画了 4 类）
  d.selected_title = 'B2写作别再错这4类了！错句正解对照表';

  // 候选池里也把 9 类版本替换掉
  d.title_candidates = (d.title_candidates || []).map(c => {
    if (/9\s*类/.test(c.title || '')) {
      return { ...c, title: c.title.replace(/9\s*类/g, '4类') };
    }
    return c;
  });

  // 重写 caption：去掉无 evidence 的"30 条错题库"承诺 + "才能从根上纠正"AI 味
  d.caption = [
    'DELF B2写作总在同样的问题上丢分？语法错误零散记在笔记本里，考前翻看还是找不到头绪。',
    '性数一致、虚拟式、条件式、直译腔——这4类几乎包揽了绝大多数高频错误。',
    '比如「les problèmes qui m’inquiète」漏了复数配合，「apprendre des connaissances」是中式法语，',
    '正确说法是「acquérir des connaissances」。',
    '按类型整理错题，每条对比错误句和正确句，再配解释，比漫无目的地刷题有用得多。',
    '考场写完先按这4类自查一遍，能捡回不少本该丢的分。',
  ].join('');

  // 内页 P6「30 条错题库」「9 大类型」也对不上 → 改成更稳的口吻
  for (const page of d.inner_pages) {
    if (page.page_type === 'product_bridge') {
      page.lead = '如果每次改错都像打地鼠，你需要一个系统。';
      page.bullets = [
        '按高频错误类型整理：性数一致、虚拟式、条件式、直译腔——每类都给出错误句、正确句和解释。',
        '用自查清单逐条对照你的作文，能快速定位反复犯的那一类。',
        '错题不再东一条西一条，复习时按类型集中突破，效率比无差别刷题高得多。',
      ];
    }
    // P3 那条 LLM 自我纠缠的 subjonctif bullet → 简化
    if (page.page_title?.includes('虚拟式')) {
      page.bullets = page.bullets.filter(b => {
        const text = typeof b === 'string' ? b : (b.text || '');
        return !/qui explique \(事实\)/.test(text);
      });
    }
  }

  saveJob('job_002', job);
  console.log('[patch] job_002 done: title=4类, caption rewritten, P6 simplified');
}

// --- job_003: 补全 cover 截断 + 重写 caption ---
function patchJob003() {
  const job = loadJob('job_003');
  const d = job.draft;

  // cover.sections[1] 三条 secondary 被截断 → 补全
  const sec2 = d.cover.sections[1];
  for (const item of sec2.items) {
    if (item.primary === '正式信7步法' && /→$/.test(item.secondary || '')) {
      item.secondary = '读题→草稿→开头→主体→结尾';
    }
    if (item.primary === '论坛投稿步骤' && /→$/.test(item.secondary || '')) {
      item.secondary = '定位立场→选人称→调用表达';
    }
    if (item.primary === '议论文步骤' && /→$/.test(item.secondary || '')) {
      item.secondary = '读题→提纲→引言→论点+例证';
    }
    // 「36项自查点」也是无 evidence 数字 → 模糊化
    if (item.primary === '检查清单' && /^\d+/.test(item.secondary || '')) {
      item.secondary = '格式/语体/拼写自查点';
    }
  }

  // 重写 caption：去掉"别只看 X 不够，更要看 Y"和"其实 X"AI 套话
  // 注意：也不能用"不是 X 而是 Y"（黑名单正则匹配）
  d.caption = [
    'DELF B2写作丢分，常常栽在题型没分清就动笔。',
    '正式信函、论坛投稿、议论文，三种任务从格式到语体完全不同。',
    '练习中常见的错误是把同一套模板套在所有题目上，结果正式信里出现 tu 和缩写，',
    '论坛投稿又写得像公文，结构分直接受影响。',
    '区分题型有清晰信号：题干里的 vous êtes 加上地址日期多半是信，',
    '出现 forum 或 message 就是投稿，要求 exprimer votre avis 且无信件格式则按议论文处理。',
    '动笔前花30秒确认任务类型，再对照检查清单——格式要素、人称选择、立场和论据——就能避免张冠李戴。',
    '字数至少250词，留出检查时间，重点看拼写、变位和性数配合。',
  ].join('');

  // 内页 P3「时间分配建议：正式信可参考60分钟」无 evidence → 软化
  for (const page of d.inner_pages) {
    if (page.page_title?.includes('结构对比')) {
      page.bullets = page.bullets.map(b => {
        const text = typeof b === 'string' ? b : (b.text || '');
        if (/正式信可参考60分钟/.test(text)) {
          return typeof b === 'string'
            ? '时间分配：正式信通常耗时最长，论坛投稿和议论文至少留10分钟检查。'
            : { ...b, text: '时间分配：正式信通常耗时最长，论坛投稿和议论文至少留10分钟检查。' };
        }
        return b;
      });
    }
  }

  saveJob('job_003', job);
  console.log('[patch] job_003 done: cover truncation fixed, caption rewritten');
}

patchJob002();
patchJob003();

// 输出修补后的核心字段做最后核对
for (const jn of ['job_002', 'job_003']) {
  const j = loadJob(jn);
  console.log('\n=== ' + jn + ' after patch ===');
  console.log('selected_title:', j.draft.selected_title);
  console.log('cover.title:', j.draft.cover.title);
  console.log('caption length:', j.draft.caption.length);
  console.log('caption:', j.draft.caption);
}
