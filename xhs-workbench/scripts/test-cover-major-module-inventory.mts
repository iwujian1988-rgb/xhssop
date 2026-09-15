import assert from 'node:assert/strict';
import { buildCoverMajorModuleInventory } from '../src/lib/v2/content-stage';
import type { GeneratedInnerPage } from '../src/types/reference-workflow';

const pages: GeneratedInnerPage[] = [
  { pageId: 'p1', page_no: 2, page_type: 'knowledge_list', page_title: '三种议论文骨架', lead: '正反对比、问题解决、递进深化', bullets: ['内容'], source_ids: [] },
  { pageId: 'p2', page_no: 3, page_type: 'knowledge_list', page_title: '四类衔接表达', lead: '因果、转折、递进、对比', bullets: ['内容'], source_ids: [] },
  { pageId: 'p3', page_no: 4, page_type: 'example_explain', page_title: '完整示例：引言与支持段', lead: '远程办公议论文', bullets: ['内容'], source_ids: [] },
  { pageId: 'p4', page_no: 5, page_type: 'example_explain', page_title: '完整示例：反对与结论', lead: '继续完成同一篇范文', bullets: ['内容'], source_ids: [] },
  { pageId: 'product', page_no: 6, page_type: 'product_bridge', page_title: '完整资料', lead: '商品承接', bullets: ['内容'], source_ids: [] },
];

const inventory = buildCoverMajorModuleInventory(pages);
assert.equal(inventory.length, 4, '商品承接页不得进入封面主要模块地图');
assert.deepEqual(inventory.map(item => item.title), [
  '三种议论文骨架',
  '四类衔接表达',
  '完整示例：引言与支持段',
  '完整示例：反对与结论',
]);
assert.ok(inventory.every(item => !('bullets' in item)), '封面模块地图不得复制完整正文 bullets');

console.log('PASS: cover matching receives whole-note modules, excludes product pages, and does not copy full bullets');
