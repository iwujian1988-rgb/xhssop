import nextEnv from '@next/env';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { callOpenAICompatibleJsonWithUsage, type AiResponseTrace } from '../src/lib/ai-client';
import { buildProductionTextTitlePrompt, filterTextTitleCandidates, TEXT_MODEL } from '../src/lib/v2/title-stage';
import { getCompetitorCreativeCard } from '../src/lib/creative-card-library';
import { getCapabilityFallback } from '../src/lib/v2/topic-stage';

const root=process.cwd();
nextEnv.loadEnvConfig(root);
const batchId=process.argv[2]||'batch_1788970269058';
const jobId=process.argv[3]||'job_001';
const job=JSON.parse(await readFile(path.join(root,'data','batches',batchId,'jobs',`${jobId}.json`),'utf8'));
const card=getCompetitorCreativeCard(job.reference_card_id);
if(!card)throw new Error('REFERENCE_CARD_NOT_FOUND');
const input={
  topic:job.artifacts.selectedTopic.data,
  capability:getCapabilityFallback(card),
  content:job.artifacts.content.data,
  recentGeneratedTextTitles:[],
};
const prompt=buildProductionTextTitlePrompt(input);
let responseTrace:AiResponseTrace|undefined;
const result=await callOpenAICompatibleJsonWithUsage<{candidates?:Array<Record<string,unknown>>}>([
  {role:'system',content:prompt.systemPrompt},
  {role:'user',content:JSON.stringify(prompt.titleCoreInput)},
],{stage:'title_progressive_method_cards_test',model:TEXT_MODEL,maxTokens:4200,temperature:0.82,retries:1,thinking:false,
  onResponseTrace:trace=>{responseTrace=trace;}});
const raw=Array.isArray(result.data.candidates)?result.data.candidates:[];
const filtered=filterTextTitleCandidates(raw,input);
const outputDir=path.join(root,'data','creator-buddy-progressive-one',batchId,jobId);
await mkdir(outputDir,{recursive:true});
await writeFile(path.join(outputDir,'request.json'),JSON.stringify(prompt,null,2),'utf8');
await writeFile(path.join(outputDir,'result.json'),JSON.stringify({raw,...filtered},null,2),'utf8');
await writeFile(path.join(outputDir,'usage.json'),JSON.stringify(result.usage,null,2),'utf8');
if(responseTrace)await writeFile(path.join(outputDir,'response-trace.json'),JSON.stringify(responseTrace,null,2),'utf8');
console.log(JSON.stringify({status:'ok',batchId,jobId,model:TEXT_MODEL,selectedMethods:prompt.titleCoreInput.selectedMethodCards.map(card=>card.name),rawCount:raw.length,survivalCount:filtered.survivalCount,titles:raw.map(item=>item.textTitle),usage:result.usage,outputDir},null,2));
