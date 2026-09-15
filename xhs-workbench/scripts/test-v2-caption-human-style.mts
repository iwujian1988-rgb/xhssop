import assert from 'node:assert/strict';

import { inspectForPublish, isReleaseBlockingIssue, isRepairableQualityIssue } from '../src/lib/v2/publish-guard';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import type { ContentPackage, TopicOption } from '../src/lib/v2/contracts';
import type { CompetitorCreativeCard } from '../src/types/reference-workflow';

const card = {
  id: 'caption-style-card',
  name: '目录测试卡',
  renderer_id: 'parchment_dense_directory',
  content_mechanism: '多分组知识体系',
  click_mechanism: '资料整理完整感',
} as CompetitorCreativeCard;
const capability = getCapabilityFallback(card);

const topic = {
  id: 'caption-style-test',
  productId: 'delf_b2_writing',
  templateId: capability.renderer,
  primaryGoal: 'save',
  topicLane: 'broad_pain',
  topic: 'DELF B2写作连接词怎么避免堆砌',
  seo: { primary: 'DELF B2写作', related: [] },
  knowledgeMode: 'educational_original',
} as unknown as TopicOption;

const content = {
  coverBlocks: [{
    id: 'one', kind: capability.acceptedBlockKinds[0], heading: '连接词检查',
    items: [{ primary: '先判断关系', secondary: '再选择表达' }, { primary: '删掉重复词', secondary: '保留必要衔接' }],
    priority: 1, sourceMode: 'generated', sourceIds: [],
  }],
  innerPages: Array.from({ length: 5 }, (_, index) => ({
    page_no: index + 1, page_type: 'knowledge_list', page_title: `第${index + 1}页`, lead: '具体判断。', bullets: ['错误句', '修改句', '检查动作'], source_ids: [],
  })),
  captionParts: {
    opening: 'DELF B2写作：你是不是一动笔就把连接词塞满整段？',
    value: [
      '第一步先找一个连接词，第二步再找一个连接词，第三步把它们都放进去。这样像承重墙一样撑住文章。',
      '最后回头检查一次，避免把同一个词重复写三遍；把连接词对应的逻辑关系写清楚。',
    ],
    productBridge: '',
    cta: '现在挑一个相近题目练一次，并按本篇顺序逐项检查。',
  },
  tagMaterial: [], factualClaims: [], frenchSegments: [],
} as unknown as ContentPackage;

const inspection = inspectForPublish(content, {
  productId: 'delf_b2_writing', topic, capability, evidence: [],
  recentCaptionEndings: ['现在挑一个相近题目练一次，并按本篇顺序逐项检查。'],
});
const codes = new Set(inspection.hardIssues.map(issue => issue.code));
for (const code of ['caption_numbered_scaffold', 'caption_decorative_metaphor', 'caption_generic_pain_opening', 'caption_generic_cta', 'caption_recent_cta_repeat']) {
  assert.ok(codes.has(code), `应识别 ${code}`);
  assert.ok(isRepairableQualityIssue({ code, message: '' }), `${code} 应进入定向返修`);
  assert.ok(!isReleaseBlockingIssue({ code, message: '' }), `${code} 不应拦截整条任务`);
}

console.log('caption human-style guard: PASS');
