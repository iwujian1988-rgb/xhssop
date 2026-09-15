import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getMarketTopicReferences } from '../src/lib/v2/market-topic-pool';
import { callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';

const refs = (await getMarketTopicReferences('delf_b2_writing', 10)).map((ref, index) => ({ index: index + 1, ...ref }));
const result = await callOpenAICompatibleJsonWithUsage<{ results?: Array<Record<string, unknown>> }>([
  { role: 'system', content: [
    '你是小红书法语备考内容编辑，只做一次DELF B2写作Market Topic实验。',
    '对每条真实Market Reference先用一句人话回答whyPeopleClick：用户为什么会点这篇；不要使用心理学术语、ClickMode或Archetype。',
    '然后把点击理由迁移到DELF B2写作范围。只能使用DIRECT_TRANSFER或CLICK_REASON_TRANSFER。没有真实作者经历时必须去掉我、我的、亲测、上岸、通过和高分身份。',
    '知识库只提供一个边界：最终必须是DELF B2写作；不要从词汇、句法、范文、观点、正式信或评分模块反推Topic。Market必须像整篇小红书笔记的大入口，不得写成课程章节、单个语法点、某段技巧、某个批改动作。',
    '输出前逐条自问：这是用户会点进去看的整篇笔记主题，还是课程目录标题？若更像课程目录，换成周期、路线、避坑、短期冲刺、在职、强度、资料、范文、评分、考前复习或现实预期等市场入口；如果该参考无法自然迁移到写作，仍需保留点击理由并合理转成写作入口。',
    '只返回JSON：{"results":[{"referenceTitle":"原题逐字复制","whyPeopleClick":"一句人话","transferMode":"DIRECT_TRANSFER或CLICK_REASON_TRANSFER","finalTopic":"DELF B2写作市场大入口","whyThisTransfer":"一句说明"}]}，恰好10条，顺序与输入一致。',
  ].join('\n') },
  { role: 'user', content: JSON.stringify({ contentBoundary: 'DELF B2写作', references: refs }) },
], { stage: 'topic-experiment', model: 'deepseek-flash', temperature: 0.55, maxTokens: 7000, retries: 1 });

const outDir = path.join(process.cwd(), 'artifacts', 'delf-market-transfer-experiment-20260914');
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'result.json'), JSON.stringify({ references: refs, result }, null, 2), 'utf8');
console.log(JSON.stringify({ output: path.join(outDir, 'result.json'), results: result.data.results || [] }, null, 2));
