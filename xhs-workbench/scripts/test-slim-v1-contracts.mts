import assert from 'node:assert/strict';
import { auditContentPackage, repairContentPackage, publicProductFact } from '../src/lib/v2/content-stage';
import { compileCover, compileDraft } from '../src/lib/v2/pipeline';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { coverCapacityFailure, getCoverTemplateSpec } from '../src/lib/cover-template-specs';
import { emptyAiUsage, callOpenAICompatibleJsonWithUsage } from '../src/lib/ai-client';
import { stableHash, type ContentPackage, type TopicOption, type VersionedArtifact } from '../src/lib/v2/contracts';
process.env.OPENAI_API_KEY = 'unit-test-no-network';
delete process.env.AI_BRIDGE_DIR;
let answer: unknown;
let requests = 0;
globalThis.fetch = async () => {
  requests++;
  return new Response(JSON.stringify({id:'unit',choices:[{message:{content:JSON.stringify(answer)}}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}}),{status:200});
};
const topic = {productId:'delf_b2_writing',topic:'表达观点',audienceState:'备考',promise:'用完整句子表达观点',
  scene:'',painOrDesire:'句子不完整',id:'unit',seo:{primary:'DELF B2',related:[]},factTerms:[],templateId:'notebook_big_words',primaryGoal:'save',topicLane:'broad_pain',contentAngle:'',productBridge:'',knowledgeMode:'mixed',seedSignals:[],noveltyFingerprint:'unit'} satisfies TopicOption;
const data: ContentPackage = {
  topicSnapshotHash:'unit',coverBlocks:[],innerPages:[{
    page_no:1,page_type:'knowledge_list',page_title:'观点',lead:'',bullets:['Je pense that cette mesure est utile.'],source_ids:[],
    renderPayload:{semanticLayoutType:'knowledge_list',items:['stale']} as any,
  }],captionParts:{opening:'',value:[],productBridge:'',cta:''},tagMaterial:[],factualClaims:[],frenchSegments:[],
};
const original: VersionedArtifact<ContentPackage> = {data,schema_version:'2.0.0',prompt_version:'unit',input_hash:'unit',created_at:'unit',warnings:[],usage:emptyAiUsage()};
answer={blockingIssues:[{path:'innerPages[0].bullets[0]',type:'grammar',issue:'Je pense that是明确语法错误，B2里应改为que，替代英语词'}],warnings:[{issue:'Mais不够高级'}],corrections:[]};
const audited=await auditContentPackage(original,{topic,evidence:[]});
assert.equal(requests,1);
assert.equal(audited.data.finalTeachingQa?.status,'FAIL');
assert.deepEqual(audited.data.innerPages,original.data.innerPages);
const card=getCompetitorCreativeCard('resource_09_notebook_warning')!;
const capability=getCapabilityFallback(card);
answer={corrections:[{path:'innerPages[0].bullets[0]',text:'Je pense que cette mesure est utile.'}]};
const repaired=await repairContentPackage(audited,{topic,evidence:[],capability},[]);
assert.equal(repaired.data.innerPages[0].bullets[0],'Je pense que cette mesure est utile.');
assert.equal(repaired.data.innerPages[0].renderPayload,undefined);
answer={blockingIssues:[],warnings:[{issue:'Mais不够B2，更推荐Cependant'}],corrections:[{path:'innerPages[0].bullets[0]',text:'Do not apply'}]};
const rechecked=await auditContentPackage(repaired,{topic,evidence:[]});
assert.equal(rechecked.data.finalTeachingQa?.status,'PASS');
assert.deepEqual(rechecked.data.innerPages,repaired.data.innerPages);
assert.equal(requests,3);
answer={blockingIssues:[{path:'innerPages[99].bullets[0]',type:'grammar',issue:'明确语法错误'}]};
const invalid=await auditContentPackage(original,{topic,evidence:[]});
assert.equal(invalid.data.finalTeachingQa?.status,'FAIL');
assert.equal(invalid.data.finalTeachingQa?.rejectedPatches.length,1);
assert.ok(!/B1|B7|CH-085|JF-001/.test(publicProductFact('B1 表达观点；B7 表达总结；CH-085；JF-001')));
for(const id of ['resource_08_book_cover_fle','resource_12_delf_vocab_table_overlay','resource_13_course_roadmap_blue','resource_16_official_notice'])
  assert.equal(getCoverTemplateSpec(getCompetitorCreativeCard(id)!.renderer_id)?.renderMode,'image_to_image');
const spec=getCoverTemplateSpec(card.renderer_id)!;
const sections=spec.sectionRange?.[0] || spec.sectionCount;
const perSection=Math.max(spec.itemRange?.[0] || 1,Math.ceil(spec.minTotalItems/sections));
const blocks=Array.from({length:sections},(_,i)=>({id:String(i),kind:'group' as const,priority:1 as const,sourceMode:'general_advice' as const,sourceIds:[],
  heading:'观点',items:Array.from({length:perSection},()=>({primary:'观点',secondary:'说明'}))}));
assert.equal(coverCapacityFailure(card.renderer_id,blocks),undefined);
assert.deepEqual(compileCover(capability,blocks).sections.flatMap(x=>x.items),blocks.flatMap(x=>x.items));
assert.ok(coverCapacityFailure(card.renderer_id,[]));
const content={...rechecked.data,coverBlocks:blocks};
const selected={textTitle:'观点写不出来？',coverTitle:'B2观点速查',coverSubtitle:'练习用',mechanism:'unit',userRelation:'',noveltyFingerprint:'unit'};
const draft=compileDraft({productId:'delf_b2_writing',card,topic,capability,content,titles:{
  contentSnapshotHash:stableHash(content),productionBriefHash:'unit',candidates:[selected],selected},evidence:[],auditWarnings:[],
  endingShowcasePlan:{mode:'product_showcase',angle:{id:'unit',label:'unit',instruction:'unit',preferredTypes:[]},coverAsset:{
    id:'random_showcase_asset',productId:'delf_b2_writing',type:'sample_analysis',label:'随机样张',image:'/showcase/random.jpg',
    sourceFactIds:['random'],sourceFile:'unit',sourceSection:'unit',realContent:'unit',userValue:'unit',suitableAngles:[],canBeCover:true,canBeInnerPage:true,
  },innerAssets:[]},
});
assert.deepEqual(draft.inner_pages.slice(0,-1).map(x=>[x.page_title,x.lead,x.bullets]),content.innerPages.map(x=>[x.page_title,x.lead,x.bullets]));
assert.equal(draft.inner_pages.at(-1)?.page_type,'product_bridge');
assert.equal(draft.inner_pages.at(-1)?.showcase_asset_id,'fixed_product_library_collage');
assert.equal(draft.inner_pages.at(-1)?.showcase_asset_image,'/generated-cover-backgrounds/delf-b2-product-library-collage.png');
assert.ok(!draft.inner_pages.some(x=>x.page_title==='把这一篇接着用下去'));
let attempts=0;
globalThis.fetch=async()=> {attempts++;return new Response(JSON.stringify({
  choices:[{message:{content:attempts===1?'':'{"ok":true}'}}],usage:{total_tokens:attempts===1?4:6},
}),{status:200});};
const retried=await callOpenAICompatibleJsonWithUsage([],{stage:'test',retries:20});
assert.equal(retried.usage.calls,2);
assert.equal(retried.usage.technical_retries,1);
assert.equal(retried.usage.total_tokens,10);
for (const broken of ['{"bullets":["first"],"bullets":["lost"]}', '{"ok":true}', '{"innerPages":[{']) {
  attempts=0;
  globalThis.fetch=async()=> {attempts++;return new Response(JSON.stringify({
    choices:[{finish_reason:attempts===1 && broken==='{"ok":true}'?'length':'stop',message:{content:attempts===1?broken:'{"ok":true}'}}],usage:{total_tokens:3},
  }),{status:200});};
  const result=await callOpenAICompatibleJsonWithUsage([],{stage:'test',retries:2});
  assert.equal(result.usage.calls,2);
  assert.equal(result.usage.total_tokens,6);
}
console.log('PASS: read-only QA, one repair/recheck, invalid paths, source-preserving compile, product codes, routes, bounded retry');
