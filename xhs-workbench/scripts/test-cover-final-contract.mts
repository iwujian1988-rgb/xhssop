import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {coverTemplateIneligibility,coverCopyContractFailure,preferredCoverVisualDensity} from '../src/lib/v2/content-stage';
import {getCoverTemplateSpec,coverCapacityFailure,coverVisualDensity,coverVisualFullnessFailure,getCoverTemplatePrompt} from '../src/lib/cover-template-specs';
import {standardCreativeCards} from '../src/lib/creative-card-library';
const read=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const entries=await read('data/real-cover-abd-retry-20260907-1/prepared.json');
const road=getCoverTemplateSpec('ielts_task1_four_part')!;
const memo=getCoverTemplateSpec('memo_offer')!;
const book=getCoverTemplateSpec('book_cover')!;
for(const e of entries){
  assert.equal(coverTemplateIneligibility(road,e.artifact.data.innerPages),'non_sequential_content_for_roadmap');
  assert.equal(coverTemplateIneligibility(memo,e.artifact.data.innerPages),undefined);
  assert.equal(coverTemplateIneligibility(book,e.artifact.data.innerPages),undefined);
  const snapshot=JSON.stringify(e.artifact.data.innerPages);
  for(const spec of [road,memo,book])coverTemplateIneligibility(spec,e.artifact.data.innerPages);
  assert.equal(JSON.stringify(e.artifact.data.innerPages),snapshot);
}
// Five topics need not map one-to-one to visual groups. Overview/excerpts stay eligible.
assert.equal(coverTemplateIneligibility(book,entries[1].artifact.data.innerPages),undefined);
assert.equal(coverTemplateIneligibility({...memo,minTotalItems:1000},entries[0].artifact.data.innerPages),'inconsistent_capacity_contract');
const cn=[{...entries[0].artifact.data.innerPages[0],page_title:'中文',lead:'说明',bullets:['中文检查']}];
assert.equal(coverTemplateIneligibility({...memo,primaryFrenchOnly:true},cn),'missing_french_source_asset');
assert.equal(coverCopyContractFailure({coverTitle:'B2自查'},memo),'cover_copy_missing_fields');
assert.equal(coverCopyContractFailure({coverSubtitle:''},memo),'cover_copy_missing_fields');
assert.equal(coverCopyContractFailure({coverTitle:[],coverSubtitle:''},memo),'cover_copy_missing_fields');
assert.equal(coverCopyContractFailure({coverTitle:'B2自查',coverSubtitle:''},memo),undefined);
assert.equal(coverCopyContractFailure({coverTitle:'B2自查！',coverSubtitle:''},memo),undefined); // Text and cover titles may intentionally use the same pool item.
assert.equal(coverCopyContractFailure({coverTitle:'交卷前自查',coverSubtitle:''},memo),undefined);
assert.equal(coverCopyContractFailure({coverTitle:'长'.repeat(30),coverSubtitle:''},memo),undefined); // Actual title fitting belongs to render.
const blocks=(counts:number[])=>counts.map(n=>({items:Array.from({length:n},()=>({primary:'检查'}))}));
assert.equal(coverCapacityFailure('memo_offer',blocks([2,2,2,2])),undefined); // Display slots select 6, source keeps 8.
assert.equal(coverCapacityFailure('memo_offer',blocks([1,1,1,1])),undefined);
assert.equal(coverCapacityFailure('ielts_task1_four_part',blocks([3,3,3,3])),'total_capacity');
assert.equal(coverCapacityFailure('ielts_task1_four_part',blocks([3,4,3,3])),undefined); // Structurally full; one below recommended total is visually usable.
assert.equal(coverCapacityFailure('ielts_task1_four_part',blocks([2,4,4,4])),'item_capacity'); // Per-group minimum remains hard.
assert.equal(coverCapacityFailure('book_cover',blocks([1,1])),'total_capacity');
assert.equal(coverCapacityFailure('book_cover',blocks([2,1])),undefined);
// The renderer accepts the three visible separators; the production gate must
// accept the same contract or valid A1 practice-sheet candidates are rejected.
for (const separator of ['｜', '·', '|']) {
  const practice = [{items:Array.from({length:7},()=>({primary:'表达',note:`甲${separator}乙${separator}丙${separator}丁`}))}];
  assert.equal(coverCapacityFailure('french_a1_practice_sheet',practice),undefined,`A1 separator ${separator}`);
}
const thinRoadmap=blocks([3,4,3,3]);
assert.equal(coverVisualFullnessFailure('ielts_task1_four_part',thinRoadmap),'visual_density');
const filledRoadmap=[3,4,3,3].map(n=>({items:Array.from({length:n},()=>({primary:'审题动作',secondary:'圈出任务与对象'}))}));
assert.equal(coverVisualFullnessFailure('ielts_task1_four_part',filledRoadmap),undefined);
assert.equal(coverVisualFullnessFailure('blackboard_offer',blocks([1,1,1])),'visual_density');
assert.equal(coverVisualFullnessFailure('book_cover',blocks([2,1])),undefined); // Artwork-led template.
for(const card of standardCreativeCards){
  assert.equal(card.density,coverVisualDensity(card.renderer_id),`${card.id}: density must come from measured contract`);
  assert.match(getCoverTemplatePrompt(card.renderer_id),/视觉密度：/u,`${card.id}: prompt must expose visual density`);
  const spec=getCoverTemplateSpec(card.renderer_id)!;
  const sectionRange=spec.sectionRange||[spec.sectionCount,spec.sectionCount];
  const itemRange=spec.itemRange||[1,spec.itemsPerSection];
  const counts=Array.from({length:sectionRange[1]},()=>itemRange[0]);
  for(let index=0;counts.reduce((sum,count)=>sum+count,0)<spec.minTotalItems;index++){
    const slot=index%counts.length;
    if(counts[slot]<itemRange[1])counts[slot]++;
  }
  const shortBlocks=counts.map(count=>({items:Array.from({length:count},()=>({primary:'点'}))}));
  const backgroundLed=['showcase_screenshot','book_cover','pain_quote_big'].includes(card.renderer_id);
  assert.equal(coverVisualFullnessFailure(card.renderer_id,shortBlocks),backgroundLed?undefined:'visual_density',`${card.id}: visual fill gate`);
}
for(const renderer of ['blackboard_offer','memo_offer','plain_experience','official_notice'] as const){
  assert.equal(coverVisualDensity(renderer),'low',`${renderer}: sparse layout must not claim medium density`);
}
assert.equal(preferredCoverVisualDensity(entries[0].artifact.data.innerPages),'high');
const source=await fs.readFile('src/lib/v2/content-stage.ts','utf8');
const example=source.split('\n').find(s=>s.includes('只返回JSON：')&&s.includes('"candidates"'))!;
assert.ok(example.includes('"coverTitle"')&&example.includes('"coverSubtitle"'));
assert.ok(!source.includes('const selected = usable.reduce'), 'rotation must not override generated fit order');
const routeSource=await fs.readFile('src/app/api/batch/route.ts','utf8');
assert.match(routeSource,/当前笔记无法把画面填满/u,'manual mismatch must be explained in user language');
console.log(`PASS: ${standardCreativeCards.length} covers share measured density, visual fullness gate, one-item tolerance, and fit-first selection; AI_CALLS=0`);
