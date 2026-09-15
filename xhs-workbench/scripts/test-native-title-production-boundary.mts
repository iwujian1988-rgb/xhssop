/** Production entry + actual fetch boundary. Default: zero network calls.
 * --live: one native Title request + one narrow semantic review per saved note
 * (6 calls total), no other AI stages.
 * All source jobs are read-only; results go to an isolated acceptance directory.
 */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import nextEnv from '@next/env';
import {buildNativeTitlePrompt, extractNativeTitleCandidates} from '../src/lib/v2/native-title-skill';
import {generateTitlePackage, filterTextTitleCandidates, TEXT_PRODUCTION_VERSION} from '../src/lib/v2/title-stage';
import {stableHash} from '../src/lib/v2/contracts';
import {getCompetitorCreativeCard} from '../src/lib/creative-card-library';
import {getCapabilityFallback} from '../src/lib/v2/topic-stage';
import {getDraftTitleSelection, applyDraftTitleSelection} from '../src/lib/draft-title-selection';
import {requireHumanSelectedTextTitle, requireHumanSelectedCoverTitle} from '../src/lib/canonical-title-package';

const live=process.argv.includes('--live');
const reviewExisting=process.argv.includes('--review-existing');
nextEnv.loadEnvConfig(process.cwd());
delete process.env.AI_BRIDGE_DIR;
if(!live) process.env.OPENAI_API_KEY='offline-test-only';
const runId=`${Date.now()}-${live?'live':'offline'}`;
const out=`data/native-title-boundary-acceptance/${runId}`;
await mkdir(out,{recursive:true});
const allSpecs=[
  ['DELF','batch_1789084467363','job_001'],
  ['TEF','batch_1789113735313','job_001'],
  ['TCF','batch_1789113738166','job_001'],
];
const only=process.argv.find(value=>value.startsWith('--only='))?.slice('--only='.length);
const specs=only ? allSpecs.filter(([label])=>label===only) : allSpecs;
assert.ok(specs.length,`unknown --only label: ${only}`);
const fetchOriginal=globalThis.fetch;
let calls=0;
let providerCalls=0;
const summaries:unknown[]=[];
try {
  for(const [label,batch,jobId] of specs) {
    const source=`data/batches/${batch}/jobs/${jobId}.json`;
    const before=await readFile(source,'utf8');
    const job=JSON.parse(before);
    const input={topic:job.artifacts.selectedTopic.data,content:structuredClone(job.artifacts.content.data),
      capability:getCapabilityFallback(getCompetitorCreativeCard(job.reference_card_id)!)};
    const prompt=buildNativeTitlePrompt(input);
    assert.equal(prompt.systemPrompt,await readFile(prompt.skillPath,'utf8'));
    for(const value of [input.topic.scene,input.topic.painOrDesire,input.topic.audienceState]) {
      if(value) assert.ok(prompt.userPrompt.includes(value),'specific audience/task missing');
    }
    assert.ok(prompt.userPrompt.includes(JSON.stringify(prompt.titleCoreInput.pageRoles)) || !prompt.titleCoreInput.pageRoles.length);
    for(const page of input.content.innerPages) for(const bullet of page.bullets) {
      assert.ok(prompt.userPrompt.includes(typeof bullet==='string'?bullet:JSON.stringify(bullet)));
    }
    assert.ok(!/约\s*2.?3\s*条|5.?6条稳|shortApprovedStyleReferences/.test(prompt.userPrompt));
    const oldRaw=await readFile(`data/final-content-traces/${job.artifacts.titles.request_id}/31_NATIVE_SKILL_RESULT.md`,'utf8');
    const oldParsed=extractNativeTitleCandidates(oldRaw);
    assert.ok(oldParsed.length>=4);
    const withBlank=oldRaw.replace(/(\|\s*1\s*\|[^\n]*)\n/,'$1\n\n');
    assert.deepEqual(extractNativeTitleCandidates(withBlank),oldParsed,'blank line dropped titles');
    const synthetic=['B2作文写完不放心？先看检查顺序','每天只有两小时，法语备考先练什么？','B2写作别急着落笔，想清楚再写','备考法语，总在开头卡住怎么办？'];
    const broad={...input,content:{...input.content,wholeNoteCore:'整篇写作全流程'}};
    const scopeResult=filterTextTitleCandidates(synthetic.map(textTitle=>({textTitle})),broad);
    assert.ok(scopeResult.evaluated.every(r=>!r.filterReasons.includes('LOCAL_PAGE_PROMOTED_TO_WHOLE_TITLE')));
    const long=filterTextTitleCandidates([{textTitle:'法语作文写完还是不放心？这份检查顺序可以在动笔前再看一次'}],input).evaluated[0];
    assert.ok(long.warnings.includes('TEXT_TITLE_OVER_20'));
    assert.ok(!long.filterReasons.includes('TEXT_TITLE_OVER_20'));
    let perNote=0;
    globalThis.fetch=async(url,init)=>{
      assert.ok(++perNote<=2,'unexpected retry/additional stage');
      assert.ok(++calls<=specs.length*2);
      const request=JSON.parse(String(init?.body));
      assert.match(String(url),/\/chat\/completions$/);
      const semanticReview=/语义边界闸门/.test(request.messages?.[0]?.content || '');
      assert.equal(request.model,'deepseek-flash');
      assert.equal(request.temperature,semanticReview ? 0 : .72);
      assert.equal(request.max_tokens,semanticReview ? 2500 : 10000);
      if (!semanticReview) {
        assert.equal(request.response_format,undefined,'native report must not be forced into JSON');
        assert.deepEqual(request.messages,[{role:'system',content:prompt.systemPrompt},{role:'user',content:prompt.userPrompt}]);
      } else {
        assert.deepEqual(request.response_format,{type:'json_object'});
        const payload=JSON.parse(request.messages[1].content);
        assert.ok(Array.isArray(payload.candidates) && payload.candidates.length>=4 && payload.candidates.length<=20);
        assert.ok(payload.fullNote.includes(input.content.innerPages[0].page_title));
      }
      await writeFile(`${out}/${label}-${semanticReview?'semantic-review':'native'}-request.json`,JSON.stringify(request,null,2));
      if(live && !(reviewExisting && !semanticReview)) {
        providerCalls+=1;
        const response=await fetchOriginal(url,init);
        await writeFile(`${out}/${label}-${semanticReview?'semantic-review':'native'}-provider.json`,await response.clone().text());
        return response;
      }
      if (semanticReview) {
        const payload=JSON.parse(request.messages[1].content);
        const decisions=payload.candidates.map((candidate:any,index:number)=>({id:candidate.id,decision:index===0?'DROP':'KEEP',...(index===0?{reason:'测试：将限定建议扩大成绝对结论',evidence:'原文说明“不要只靠”而非禁止。'}:{})}));
        return new Response(JSON.stringify({id:`semantic-boundary-${runId}-${label}`,
          choices:[{message:{content:JSON.stringify({decisions})},finish_reason:'stop'}],
          usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
      }
      const existingRaw=reviewExisting
        ? await readFile('data/native-title-boundary-acceptance/1789119591455-live/TCF-native-provider.json','utf8').then(value=>JSON.parse(value).choices[0].message.content)
        : oldRaw;
      return new Response(JSON.stringify({id:`native-boundary-${runId}-${label}`,
        choices:[{message:{content:existingRaw},finish_reason:'stop'}],
        usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0}}));
    };
    try {
      const result=await generateTitlePackage(input);
      assert.equal(perNote,2);
      assert.equal(result.prompt_version,TEXT_PRODUCTION_VERSION);
      await writeFile(`${out}/${label}-result.json`,JSON.stringify(result,null,2));
      await writeFile(`${out}/${label}-native.md`,result.data.nativeSkillReport!);
      const trace=JSON.parse(await readFile(`data/final-content-traces/${result.request_id}/30_TEXT_TITLE_CANDIDATES.json`,'utf8'));
      assert.equal(trace.providerTraceVerified,true);
      const reviewTrace=JSON.parse(await readFile(`data/final-content-traces/${result.request_id}/32_TITLE_SEMANTIC_BOUNDARY_REVIEW.json`,'utf8'));
      assert.equal(result.input_hash,stableHash({nativeTitleRequest:trace.requestHash,semanticReviewRequest:reviewTrace.requestHash}));
      const parsed=extractNativeTitleCandidates(result.data.nativeSkillReport!);
      assert.equal(trace.rawCandidateCount,parsed.length);
      assert.equal(trace.evaluated.length,parsed.length,'every raw row needs an explained disposition');
      const pool=result.data.humanSelectableTextTitles!;
      assert.equal(result.data.semanticBoundaryReview?.reviewedCandidateCount,trace.evaluated.filter((r:any)=>!r.filterReasons.length).length);
      const rejected=result.data.semanticBoundaryReview?.rejectedCandidates || [];
      if (live && reviewExisting) {
        assert.ok(rejected.some(candidate=>candidate.textTitle.includes('别再零散背句型')),
          'real semantic review did not catch the known qualifier-to-ban drift');
      } else {
        assert.equal(rejected.length,1);
      }
      assert.equal(pool.length,trace.evaluated.filter((r:any)=>!r.filterReasons.length).length-rejected.length);
      for (const candidate of rejected) assert.ok(!pool.some(c=>c.id===candidate.id));
      for(const c of pool) assert.ok(parsed.some(p=>p.textTitle===c.textTitle),'rewritten title');
      const draft=structuredClone(job.draft);
      draft.titlePackage=result.data;
      assert.throws(()=>requireHumanSelectedTextTitle(draft),/AWAITING_HUMAN/);
      const chosen=applyDraftTitleSelection(draft,getDraftTitleSelection(draft,0),true);
      // Independent cover selection from the same immutable native pool.
      chosen.titlePackage!.humanSelectedCoverTitleId=pool[1].id;
      const serialized=JSON.parse(JSON.stringify(chosen));
      assert.equal(requireHumanSelectedTextTitle(serialized).textTitle,pool[0].textTitle);
      assert.equal(requireHumanSelectedCoverTitle(serialized).textTitle,pool[1].textTitle);
      assert.equal(serialized.titlePackage.nativeSkillReport,result.data.nativeSkillReport);
      assert.equal(result.data.sourceInnerHash,stableHash(input.content.innerPages));
      summaries.push({label,pass:true,raw:parsed.length,visible:pool.length,requestId:result.request_id,
        filtered:trace.evaluated.filter((r:any)=>r.filterReasons.length),titles:pool.map(c=>c.textTitle),usage:result.usage});
    } catch(error) {
      summaries.push({label,pass:false,error:String(error)});
      if(!live) throw error;
    } finally {
      assert.equal(await readFile(source,'utf8'),before,'production job was modified');
    }
  }
} finally {
  globalThis.fetch=fetchOriginal;
  await writeFile(`${out}/summary.json`,JSON.stringify({live,calls:live?calls:0,providerCalls:live?providerCalls:0,mockedCalls:live?calls-providerCalls:calls,summaries},null,2));
  console.log(JSON.stringify({out,live,calls,providerCalls,summaries},null,2));
}
assert.equal(calls,specs.length*2);
assert.ok(summaries.every((s:any)=>s.pass));
