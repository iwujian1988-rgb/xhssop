import fs from 'node:fs/promises';

const sourcePath = '.tmp-selected-p2-p6-audit.json';
const outPath = '.tmp-selected-p2-p6-audit-final.json';
const data = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const replacements: Record<string, string> = {
  '这种写法体现了对法国行政体系礼仪的尊重。如果只写“Bonjour”或“Cher Monsieur”，在B2级别会被视为语域掌握不足。': '这种写法符合正式信的常见语域。如果只写“Bonjour”或“Cher Monsieur”，在正式任务中可能显得不够正式。',
  '切勿使用“À qui de droit”（致相关人士），这在现代法语中显得过于陈旧且冷漠。': '一般不建议使用“À qui de droit”（致相关人士），因为它在现代书信中可能显得生硬。',
  '这两部分缺一不可。很多考生只写“Cordialement”，这在B2正式信考试中是严重的文体失误，仅适用于熟人间的非正式邮件。': '这两部分合在一起更完整。Cordialement 适合关系较熟的邮件；面对正式机构时，使用完整敬语通常更稳妥。',
  '它展示了你的合作态度和解决问题的诚意，特别是在咨询信或申请信中，这种开放性姿态能给阅卷人留下良好印象。': '它能表达合作态度，特别适合咨询或申请类信件。',
  '在考试中，写全这一句能确保你在“语言资源”维度上不丢分。': '写全这一句更容易保持正式语域和表达完整。',
  '如果时间紧迫，至少不能漏掉“salutations distinguées”这个核心词汇。': '如果时间紧迫，优先保留完整的“salutations distinguées”敬语结构。',
  'B2写作：1小时极限挑战的底层逻辑': 'DELF B2写作：1小时怎么分配',
  '遗漏任何一点都会导致任务完成度扣分。': '遗漏任何一点都容易影响任务完成度。',
  '少于250词会直接影响Respect de la consigne（遵守指令）维度的得分。': '少于250词可能影响Respect de la consigne（遵守指令）这一项的完成度。',
  '有效的应急策略能帮助你在有限时间内最大化得分，避免因慌乱而导致整体表现崩盘。': '这些应急动作能帮助你减少慌乱造成的失误。',
  '“Selon une étude récente, les déchets plastiques dans les océans ont augmenté de 30% ces dix dernières années. Ce phénomène touche particulièrement les zones côtières.”': '“Pour donner un exemple concret, la pollution plastique peut menacer les écosystèmes côtiers et la santé publique.”',
  '完整素材库包含50条观点及对应句型，覆盖教育、健康、城市生活等更多主题。': '资料库还按教育、健康、城市生活等主题继续整理观点和对应句型。',
  '导致结构错误，失分严重。': '容易影响任务完成度和文体一致性。',
  '展示正确的审题思路和修正后的写作方向': '展示更合适的审题思路和写作方向',
  '得分较高。': '完成度更高。',
  '为什么直接背整篇范文是最低效的学习方式？': '为什么直接背整篇范文不一定高效？',
  '考官一眼就能识别出模板痕迹，这种缺乏个人思考和自然表达的文本很难在“词汇丰富度”和“连贯性”上拿到高分。': '整篇套用容易留下模板痕迹，也可能让词汇和衔接显得机械。',
  '例如只记住le fait que，却忘记它后面必须跟陈述式indicatif，或者混淆了pour que后需跟虚拟式subjonctif的用法。': '例如只记住 le fait que，却忽略它的语式要结合语境判断；而 pour que 后通常接虚拟式 subjonctif。',
  '虽意思相近但搭配习惯不同，易被判定为中式法语。': '两者都可以使用，但常见搭配和语义侧重点不同，需根据句意选择。',
  '对比浅层抱怨与深层制度分析的两个写作片段': '对比只描述现象与进一步解释原因的两个写作片段',
};

function walk(value: unknown): unknown {
  if (typeof value === 'string') {
    let next = value;
    for (const [from, to] of Object.entries(replacements)) next = next.replaceAll(from, to);
    return next.replaceAll('多维视角', '经济、生态和代际三个角度').replaceAll('博弈', '权衡');
  }
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
  return value;
}

const result = walk(data) as any;
const firstJob = result.jobs.find((job: any) => job.id === 'batch_resource_01_grammar_parchment_red_1');
const finalPage = firstJob?.pages.find((page: any) => page.page_no === 6);
if (finalPage) {
  finalPage.page_title = 'P6｜正式信交卷前30秒核对';
  finalPage.lead = '最后不要再补新句子，只核对最容易漏掉的格式和语域。';
  finalPage.bullets = [
    '称呼：收信人明确时写 Monsieur/Madame + 职务；不明确时优先用 Madame, Monsieur。',
    '目的：开头是否已经说清写信原因，而不是停留在寒暄？',
    '结尾：是否同时有期待回复或后续行动，以及完整的礼貌收尾？',
    '语域：删掉 Salut、bah 等口语词，再通读一遍检查人称和敬语是否前后一致。',
  ];
}
result.finalEditorialQA = {
  status: 'LOCAL_MINIMAL_REPAIR',
  modelCalls: 0,
  repairedCategories: ['FACT_CLAIM_RISK', 'FRENCH_LANGUAGE_ACCURACY', 'EXAM_CLAIM_STRENGTH', 'ASSET_PROMISE_CONSISTENCY', 'PAGE_REDUNDANCY', 'AI_COURSE_LANGUAGE'],
  changes: [
    '删除未核验的塑料污染30%数字，改为非统计型写作示例',
    '将 le fait que 的绝对语式说法改为语境说明',
    '降低考官、扣分、失分、高分等过强考试判断',
    '删除“完整素材库50条”资产承诺',
    '将课程化表达改为学生可理解的人话',
    'P6重复内容保留结构但改为应用/核对动作',
  ],
};
await fs.writeFile(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log('FINAL_PAGE_QA_WRITTEN');
