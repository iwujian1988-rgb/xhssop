import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { callOpenAICompatibleJsonWithUsage, type AiResponseTrace } from '../src/lib/ai-client';

const root = process.cwd();
nextEnv.loadEnvConfig(root);
delete process.env.AI_BRIDGE_DIR;

const outputDir = path.join(root, 'data', 'topic-mega-rotation-isolation-20260908');
await fs.mkdir(outputDir, { recursive: true });

type RawTopic = { topic?: string; audienceState?: string; painOrDesire?: string; promise?: string };
type RawResponse = { topics?: RawTopic[] };

const megaTerritoryBatches = [
  ['从审题到交卷的完整写作流程', '贯穿句子、段落与全文的B2写作语法', '按交际目的反复调用的表达与句型', '跨常见社会议题的观点、理由与例证素材'],
  ['B2常见写作任务、文体与格式', '从日常训练到考前冲刺的完整备考', '覆盖审题、结构、论证、语域与语言的失分修正', '写完初稿后的全文检查与自我修改'],
] as const;

const baseSlots = [
  { slot: 1, scope: 'level_1_asset', intent: 'mega_asset' },
  { slot: 2, scope: 'level_1_asset', intent: 'mega_asset' },
  { slot: 3, scope: 'level_2_strategy', intent: 'broad_asset' },
  { slot: 4, scope: 'level_1_asset', intent: 'mega_asset' },
  { slot: 5, scope: 'level_2_strategy', intent: 'broad_asset' },
  { slot: 6, scope: 'level_1_asset', intent: 'mega_asset' },
  { slot: 7, scope: 'level_1_asset', intent: 'broad_problem' },
  { slot: 8, scope: 'level_2_strategy', intent: 'broad_asset' },
  { slot: 9, scope: 'level_1_asset', intent: 'broad_problem' },
  { slot: 10, scope: 'level_2_strategy', intent: 'broad_asset' },
] as const;

const system = [
  '你只策划一篇发什么、给用户什么，不写教学正文。输出10个不同的DELF B2写作小红书选题。',
  'topics必须按顺序兑现scopePlan。每批固定4个mega_asset、2个broad_problem、4个broad_asset。',
  'mega_asset的coverageDomain是范围下限，不是标题模板：公开选题必须覆盖这个大领域，不能缩成其中一个连接词、单一句型、开头、结尾、单段或单一局部技巧；也不要逐字复制coverageDomain。',
  'mega_asset要让用户感觉一篇拿到一整套，但标题必须说人话。每批至少2到3篇有自然捷径感或结果感，可使用看完就理清、背完更稳、3分钟搞懂、直接拿走、考前救急等节奏，但不要照抄示例，也不要全部这样写。',
  '同批公开topic使用系统、体系、操作系统、底层框架、引擎、总成、资产库这一组词合计最多2篇。其余使用用户动作、真实结果或具体获得物。',
  'topic可以适度营销；promise只列5个内页可以真实交付的核心资产，不把营销口号写成考试事实。除非输入已有依据，不虚构官方、考官、必考、常考、高频、固定提分、固定分数或200句/500句等数量。',
  'promise不得每条机械重复同一句式。允许按选题选择清单、地图、对照、流程、代表性材料或一个应用示范，不要求每篇都写“四个模块＋完整应用”。',
  '只返回严格JSON对象：{"topics":[{"topic":"...","audienceState":"...","painOrDesire":"...","promise":"..."}]}。必须正好10项。',
].join('\n');

let totalCalls = 0;
const all: unknown[] = [];
for (let batchIndex = 0; batchIndex < megaTerritoryBatches.length; batchIndex += 1) {
  let megaIndex = 0;
  const scopePlan = baseSlots.map(slot => slot.intent === 'mega_asset'
    ? { ...slot, coverageDomain: megaTerritoryBatches[batchIndex]![megaIndex++] }
    : { ...slot });
  const userPayload = { product: 'DELF B2写作', count: 10, scopePlan };
  const traceFile = path.join(outputDir, `batch-${batchIndex + 1}-response-trace.json`);
  const result = await callOpenAICompatibleJsonWithUsage<RawResponse>([
    { role: 'system', content: system },
    { role: 'user', content: JSON.stringify(userPayload) },
  ], {
    stage: 'topic_rotation_isolation',
    model: 'qwen3.8-max-0902',
    temperature: 0.85,
    maxTokens: 7000,
    retries: 1,
    onResponseTrace: async (trace: AiResponseTrace) => fs.writeFile(traceFile, JSON.stringify(trace, null, 2), 'utf8'),
  });
  totalCalls += result.usage.calls;
  const saved = { batch: batchIndex + 1, scopePlan, topics: result.data.topics || [], usage: result.usage, requestId: result.requestId };
  await fs.writeFile(path.join(outputDir, `batch-${batchIndex + 1}.json`), JSON.stringify(saved, null, 2), 'utf8');
  all.push(saved);
}

await fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ totalCalls, batches: all }, null, 2), 'utf8');
console.log(JSON.stringify({ outputDir, totalCalls, batches: all }, null, 2));
