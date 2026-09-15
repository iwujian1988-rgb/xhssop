/* eslint-disable no-console */
import fs from 'node:fs/promises';
import nextEnv from '@next/env';
import { callOpenAICompatibleJsonWithUsage, mergeAiUsage } from '../src/lib/ai-client';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { generateTitlePackage } from '../src/lib/v2/title-stage';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentPackage, TopicOption } from '../src/lib/v2/contracts';

nextEnv.loadEnvConfig(process.cwd());

const batchId = 'batch_title_v3_validation_1788444655678';
const jobId = 'job_001';
const sourcePath = `data/batches/${batchId}/jobs/${jobId}.json`;
const outputPath = '.tmp-cover-title-hierarchy-regression.json';
const job = JSON.parse(await fs.readFile(sourcePath, 'utf8')) as Record<string, any>;
const topic = structuredClone(job.artifacts.selectedTopic.data) as TopicOption;
const content = structuredClone(job.artifacts.content.data) as ContentPackage;
const card = getCompetitorCreativeCard(job.reference_card_id);
if (!card) throw new Error(`找不到创作卡：${job.reference_card_id}`);
const capability = getCapabilityFallback(card);

const headingResult = await callOpenAICompatibleJsonWithUsage<{
  headings?: Array<{ id?: string; heading?: string }>;
}>([
  {
    role: 'system',
    content: [
      '你只修封面局部Section Heading/H2，不生成标题、不改items、不改正文和内页。',
      '每个heading只回答“下面这一组items在讲什么”，必须明显是局部栏目名。',
      'heading使用短、直白、能指向本组items的人话，必须不超过12个可见字；不要写“核心痛点与解题逻辑、核心价值主张、底层逻辑、内容概览、模块拆解、结构化整理”等抽象课程词。',
      '不得重写Mother Topic、Final Public Topic、全篇promise、总Hook、商品总卖点或考试身份。',
      '不得出现DELF、B2、法语B2、B2写作。输出前逐条自检：超12字、含考试身份、抽象课程词或全篇总承诺都必须先重写。不要新增事实，不要改id。',
      '只返回JSON：{headings:[{id,heading}]}，每个输入id恰好返回一次。',
    ].join('\n'),
  },
  {
    role: 'user',
    content: JSON.stringify({
      finalPublicTopic: topic.topic,
      motherTopic: topic.batchEditorialTask?.lockedMotherTopic || topic.topic,
      promise: topic.promise,
      blocks: content.coverBlocks.map(block => ({
        id: block.id,
        currentHeading: block.heading,
        kind: block.kind,
        items: block.items,
      })),
    }),
  },
], { maxTokens: 700, temperature: 0.35, retries: 1 });

const returned = new Map((headingResult.data.headings || [])
  .filter(item => item.id && item.heading)
  .map(item => [item.id!, item.heading!.trim()]));
content.coverBlocks = content.coverBlocks.map(block => ({
  ...block,
  heading: returned.get(block.id) || block.heading,
}));

const titleArtifact = await generateTitlePackage({ topic, capability, content });
const bundles = titleArtifact.data.titleBundles || titleArtifact.data.candidates;
const templateSpec = getCoverTemplateSpec(capability.renderer);
const output = {
  generatedAt: new Date().toISOString(),
  source: { batchId, jobId, sourcePath, referenceCardId: job.reference_card_id },
  topic: {
    finalPublicTopic: topic.topic,
    motherTopic: topic.batchEditorialTask?.lockedMotherTopic || topic.topic,
    promise: topic.promise,
  },
  template: {
    renderer: capability.renderer,
    kickerSupported: templateSpec?.kickerSupported === true,
  },
  oldCoverBlocks: job.artifacts.content.data.coverBlocks,
  newCoverBlocks: content.coverBlocks,
  titleBundles: bundles,
  selectedBundleId: titleArtifact.data.selectedBundleId,
  titleTrace: titleArtifact.data.titleStageTrace,
  warnings: titleArtifact.warnings,
  usage: mergeAiUsage(headingResult.usage, titleArtifact.usage),
};
await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');
console.log(JSON.stringify({
  outputPath,
  renderer: capability.renderer,
  kickerSupported: templateSpec?.kickerSupported === true,
  headings: content.coverBlocks.map(block => ({ id: block.id, heading: block.heading })),
  bundles: bundles.map(bundle => ({
    slotId: bundle.slotId,
    textTitle: bundle.textTitle,
    coverKicker: bundle.coverKicker,
    coverTitle: bundle.coverTitle,
    coverSubtitle: bundle.coverSubtitle,
    clickReason: bundle.clickReason,
  })),
  usage: output.usage,
}, null, 2));
