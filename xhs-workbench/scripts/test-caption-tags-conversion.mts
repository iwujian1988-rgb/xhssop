import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { generateFinalCaptionAndBridge, captionProductFacts, neutralCaptionLabel, captionPageInventory, buildCommercialCaptionInput } from '../src/lib/v2/content-stage';
import { tagSemanticFamily } from '../src/lib/v2/delf-search-signals';
import { buildV2Tags, compileDraft } from '../src/lib/v2/pipeline';
import { CAPTION_LINK_CTA, CONVERSION_ENDINGS, resolveConversionMode, appendConversionTransition, singleCaptionCta, assembleFinalCaption, ensureCaptionSeo, type ConversionMode } from '../src/lib/v2/conversion';
import { selectProductPromo, approvedPromoByText } from '../src/lib/v2/product-promo';
import { stableHash } from '../src/lib/v2/contracts';
import { teachingPages } from '../src/lib/manual-inner-review';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';

const live = process.argv.includes('--live');
if (live) nextEnv.loadEnvConfig(process.cwd());
else process.env.OPENAI_API_KEY = 'offline-no-network';
delete process.env.AI_BRIDGE_DIR;
const output = await fs.mkdtemp(path.join(process.cwd(), live ? 'data/caption-v5-' : '.tmp-caption-v5-'));
const oldRoot = path.join(process.cwd(), 'data/caption-v4-OeCN6h');
const frozenFiles = ['src/lib/v2/delf-search-signals.ts','src/lib/v2/conversion.ts','src/lib/v2/pipeline.ts'];
const frozenBytes = await Promise.all(frozenFiles.map(file=>fs.readFile(file,'utf8')));
const batchRoot = path.join(process.cwd(), 'data/batches/batch_human_review_1788691220835');
const sources = JSON.parse(await fs.readFile(path.join(batchRoot, 'review-sources.json'), 'utf8'));
const pool = JSON.parse(await fs.readFile('data/xhs-tag-research/2026-08-31-creator-suggestions.json', 'utf8'));
const poolTags = new Set(pool.groups.flatMap((g: any) => g.suggestions.map((t: any) => t.tag)));
assert.equal(poolTags.size, 529);
const networkFetch = globalThis.fetch;
let calls = 0;
let activeOutput = output;
globalThis.fetch = async (url, options) => {
  if (++calls > 3) throw new Error('THREE_CALL_LIMIT');
  const request = JSON.parse(String(options?.body));
  assert.equal(request.messages.length, 2);
  assert.ok(request.messages[0].content.includes('图文笔记下方的本篇正文'));
  const payload = JSON.parse(request.messages[1].content);
  assert.equal(payload.audienceState, undefined);
  assert.equal(payload.painOrDesire, undefined);
  assert.deepEqual(Object.keys(payload).sort(), ['neutralTopic','neutralPageInventory','seoKeywords'].sort());
  const oldRequest = JSON.parse(await fs.readFile(path.join(oldRoot, path.basename(activeOutput), 'request.json'), 'utf8'));
  const oldInput = JSON.parse(oldRequest.messages[1].content);
  assert.deepEqual(payload.neutralPageInventory,oldInput.noteOverview.pages);
  assert.equal(payload.neutralTopic,oldInput.noteOverview.topic);
  assert.ok(payload.seoKeywords.length>=2 && payload.seoKeywords.length<=4);
  for(const word of payload.seoKeywords) assert.ok(poolTags.has('#'+word));
  assert.ok(!/"(?:bullets|lead|renderPayload|source_ids)"|Par la présente|Afin d'améliorer|Toutefois|bénéfique|nuisible|tenir à|souhaiter que|donc|par conséquent|虚拟式|扣分|考官|高级|低级|升级|caution/.test(JSON.stringify(payload)));
  await fs.writeFile(path.join(activeOutput, 'V4_REQUEST.json'), JSON.stringify(oldRequest,null,2));
  await fs.writeFile(path.join(activeOutput, 'V5_REQUEST.json'), JSON.stringify(request,null,2));
  await fs.writeFile(path.join(activeOutput, 'REQUEST_DIFF.json'), JSON.stringify({system:{old:oldRequest.messages[0].content,new:request.messages[0].content},changes:Object.keys({...oldInput,...payload}).filter(key=>JSON.stringify(oldInput[key])!==JSON.stringify(payload[key])).map(key=>({field:key,old:oldInput[key],new:payload[key]}))},null,2));
  await fs.writeFile(path.join(activeOutput, 'request.json'), JSON.stringify(request, null, 2));
  if (!live) return new Response(JSON.stringify({id:`offline-caption-${calls}`,choices:[{message:{content:JSON.stringify({captionParts:{opening:'写信时找不到合适的材料？',value:['收藏后按场景查开场和收尾，练习时选一组试写。'],productBridge:'完整资料也可以作为练习参考。',cta:'查看完整资料。'},bridgePlan:{freeSolves:'找到材料。',userStillNeeds:'继续练习。',whyProduct:'查资料。',naturalCta:'看资料。'},transitionText:'下一页放了资料概览，想继续练习可以看看。',tagMaterial:['法语写作'],factualClaims:[]})}}],usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
  const response = await networkFetch(url, options);
  await fs.writeFile(path.join(activeOutput, 'provider-response.json'), await response.clone().text());
  return response;
};
const modes: ConversionMode[] = ['image_product_page','product_card','comment_link'];
const recent = new Map<string, number>();
const reports: any[] = [];
const recentPromos: string[] = [];
for (let index = 0; index < 3; index++) {
  const id = `job_00${index + 1}`;
  const jobPath = path.join(batchRoot, 'jobs', id + '.json');
  const originalBytes = await fs.readFile(jobPath, 'utf8');
  const job = JSON.parse(originalBytes);
  const artifact = job.artifacts.content;
  const topicBefore = stableHash(job.artifacts.selectedTopic.data);
  const hash = stableHash(artifact.data.innerPages);
  assert.equal(hash, ['149d2z1','1n0315l','17n9jbz'][index]);
  if (artifact.data.manualInnerReview?.status !== 'locked') { reports.push({ id, skipped: 'NOT_LOCKED' }); continue; }
  assert.equal(artifact.data.manualInnerReview.innerHash, hash);
  const historical = JSON.parse(await fs.readFile(sources.provenance[index].source, 'utf8'));
  const evidence = (historical.draft?.evidence || []).filter((e: any) => e.category !== 'official_exam_fact');
  activeOutput = path.join(output, id); await fs.mkdir(activeOutput);
  await fs.writeFile(path.join(activeOutput, 'locked-input.json'), JSON.stringify({ reviewedInnerHash: hash, review: artifact.data.manualInnerReview, innerPages: artifact.data.innerPages, evidence, conversionMode: modes[index] }, null, 2));
  try {
    const projected=buildCommercialCaptionInput(job.artifacts.selectedTopic.data.topic,'DELF B2写作',artifact.data.innerPages,captionProductFacts(evidence));
    await fs.writeFile(path.join(activeOutput,'seo-sources.json'),JSON.stringify(projected.seoSources,null,2));
    const result = await generateFinalCaptionAndBridge(artifact, { topic: job.artifacts.selectedTopic.data, evidence, conversionMode: modes[index], jobId: id, recentProductPromos: recentPromos });
    assert.equal(stableHash(result.data.innerPages), hash);
    const tags = await buildV2Tags(job.product_id, job.artifacts.selectedTopic.data, result.data, recent);
    const savedSources = structuredClone(result.data.finalTagSources!);
    assert.equal(new Set(tags.map(tagSemanticFamily)).size, tags.length);
    for (const tag of tags) { assert.ok(poolTags.has(tag)); recent.set(tag, (recent.get(tag) || 0) + 1); }
    const poisoned = { ...job.artifacts.selectedTopic.data, audienceState: '词汇量不够 高频词汇', painOrDesire: '词汇', scene: '词汇' };
    assert.deepEqual(await buildV2Tags(job.product_id, poisoned, result.data), await buildV2Tags(job.product_id, job.artifacts.selectedTopic.data, result.data));
    // Restore provenance corresponding to the final, recent-aware selection.
    result.data.finalTagSources = savedSources;
    assert.equal(savedSources.length, tags.length);
    for (const source of savedSources) assert.ok(pool.groups.some((g: any) => g.query === source.sourceQuery && g.suggestions.some((s: any) => s.tag === source.tag && s.rank === source.rank && s.views === source.views)));
    const promo = approvedPromoByText(result.data.captionParts.productBridge);
    assert.ok(promo);
    assert.equal(selectProductPromo(job.product_id,id,promo.text,['changed history'])?.text,promo.text);
    recentPromos.push(promo.text);
    const caption = assembleFinalCaption(result.data.captionParts,tags);
    const noteBody = [result.data.captionParts.opening,...result.data.captionParts.value].filter(Boolean).join('\n\n');
    assert.ok(caption.endsWith(`${tags.join(' ')}\n\n${promo.text}\n\n${CAPTION_LINK_CTA}`));
    assert.ok(!/最终标签：|Tags：|推荐标签：|SEO关键词：|productPromo：|CTA：|商品承接：|productBridge：/.test(caption));
    assert.ok(projected.payload.seoKeywords.some(word=>noteBody.replace(/\s+/gu,'').toLowerCase().includes(word.replace(/\s+/gu,'').toLowerCase())));
    assert.equal(result.data.captionParts.cta,CAPTION_LINK_CTA);
    assert.equal(caption.split(CAPTION_LINK_CTA).length-1,1);
    assert.equal(result.data.transitionText,'');
    const perCall = { prompt_tokens: result.usage.prompt_tokens - artifact.usage.prompt_tokens, completion_tokens: result.usage.completion_tokens - artifact.usage.completion_tokens, total_tokens: result.usage.total_tokens - artifact.usage.total_tokens, calls: result.usage.calls - artifact.usage.calls };
    if (index === 0) {
      assert.ok(!tags.some(t => /词汇/.test(t)));
      // Pure compiler fixture reuses historical cover/title/QA only to inspect page assembly.
      // It is NOT a freshly title/QA-approved production artifact.
      const fixture = structuredClone(result.data);
      fixture.finalTeachingQa = { ...artifact.data.finalTeachingQa, status: 'PASS', sourceInnerHash: hash };
      fixture.coverSourceInnerHash = hash;
      const titles = structuredClone(historical.artifacts.titles.data); titles.contentSnapshotHash = stableHash(fixture);
      assert.ok(fixture.selectedCoverTemplateId);
      const card = getCompetitorCreativeCard(fixture.selectedCoverTemplateId)!;
      const compiled = compileDraft({productId:job.product_id,card,topic:job.artifacts.selectedTopic.data,capability:getCapabilityFallback(card),content:fixture,titles,evidence,auditWarnings:[],prebuiltTags:tags});
      assert.equal(compiled.inner_pages.some(page=>page.pageId==='conversion_transition'),false);
      assert.equal(compiled.caption,caption);
      assert.equal(compiled.inner_pages.at(-1)?.page_type, 'product_bridge');
      assert.equal(compiled.inner_pages.filter(p => p.page_type === 'product_bridge').length, 1);
      assert.deepEqual(teachingPages(compiled.inner_pages).map(p => [p.page_title,p.lead,p.bullets]), artifact.data.innerPages.map((p:any)=>[p.page_title,p.lead,p.bullets]));
      await fs.writeFile(path.join(activeOutput, 'assembly-only.json'), JSON.stringify({offlineAssemblyOnly:true,pages:compiled.inner_pages},null,2));
    }
    for (const mode of Object.keys(CONVERSION_ENDINGS) as ConversionMode[]) {
      assert.equal(resolveConversionMode(mode), mode);
      assert.ok(!/conversionMode|CTA|product_card/.test(CONVERSION_ENDINGS[mode]));
      const pages = appendConversionTransition(result.data.innerPages, {...result.data,conversionMode:mode});
      assert.equal(pages.length, result.data.innerPages.length);
      assert.equal(singleCaptionCta({...result.data.captionParts,cta:'MODEL_CTA'},mode).cta,CAPTION_LINK_CTA);
    }
    assert.throws(()=>resolveConversionMode('AI_decides'));
    const cleaned = singleCaptionCta({opening:'存图备查。',value:['写草稿时放旁边。需要资料可以点商品卡。'],productBridge:'资料里有范文库。需要完整资料，可以看评论区链接。',cta:'评论区见。'},modes[index]);
    assert.equal(cleaned.productBridge,'资料里有范文库。');
    assert.deepEqual(cleaned.value,['写草稿时放旁边。']);
    assert.deepEqual(singleCaptionCta(cleaned,modes[index]),cleaned);
    assert.deepEqual(captionProductFacts([{id:'x',category:'official_exam_fact',text:'评分要求',evidence:'250词'}] as any),[]);
    await fs.writeFile(path.join(activeOutput, 'result.json'), JSON.stringify(result,null,2));
    await fs.writeFile(path.join(activeOutput,'final-caption.txt'),caption);
    reports.push({id,reviewedInnerHash:hash,caption,noteBody,bodyHanCount:(noteBody.match(/\p{Script=Han}/gu)||[]).length,promo,seoSources:projected.seoSources,tags,tagSources:savedSources,transitionText:result.data.transitionText,usage:perCall});
  } catch (error) {
    await fs.writeFile(path.join(activeOutput,'failure.json'),JSON.stringify({message:String(error),usage:(error as any).usage},null,2));
    reports.push({id,reviewedInnerHash:hash,error:String(error)});
  }
  assert.equal(await fs.readFile(jobPath,'utf8'), originalBytes);
  assert.equal(stableHash(job.artifacts.selectedTopic.data),topicBefore);
  await fs.writeFile(path.join(output,'summary.json'),JSON.stringify({live,aiCalls:live?calls:0,reports},null,2));
}
assert.equal(neutralCaptionLabel('虚拟式让考官喜欢'),'');
const seoTest = {opening:'写作时按需查阅。',value:[],productBridge:'',cta:''};
assert.equal(ensureCaptionSeo(seoTest,['法语写作']),true);
assert.equal(ensureCaptionSeo(seoTest,['法语写作']),false);
const firstPromo = selectProductPromo('delf_b2_writing','stable-job')!;
assert.ok(firstPromo);
assert.equal(selectProductPromo('delf_b2_writing','stable-job')?.id,firstPromo.id);
assert.notEqual(selectProductPromo('delf_b2_writing','stable-job','',[firstPromo.text])?.id,firstPromo.id);
assert.equal(neutralCaptionLabel('unknown French example','DELF B2写作资料'),'DELF B2写作资料');
const noRead = {page_title:'考官要求虚拟式',page_no:1,page_type:'knowledge_list',bullets:new Proxy(['PRIVATE'],{get(target,key){if(key==='length')return 1;throw new Error('BULLET_TEXT_READ');}}),get lead(){throw new Error('LEAD_READ');}};
assert.equal(captionPageInventory([noRead] as any)[0].pageTitleNeutral,'');
assert.deepEqual(await Promise.all(frozenFiles.map(file=>fs.readFile(file,'utf8'))),frozenBytes);
console.log(JSON.stringify({output,live,aiCalls:live?calls:0,reports},null,2));
