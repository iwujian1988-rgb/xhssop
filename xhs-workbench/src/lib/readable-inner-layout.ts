import type {GeneratedInnerPage,ReferenceDrivenDraft} from '@/types/reference-workflow';
import {stableHash} from '@/lib/v2/contracts';
import {STYLE_CONFIGS} from '@/lib/inner-paper-styles';
import {inlineRuns,appendInlineRuns,publicInnerTitle} from '@/lib/inner-display-text';

export interface ReadableSlice {field:'lead'|'bullet'; index:number; start:number; end:number}
export interface ReadablePagePlan {version:1;sourceHash:string;pages:Array<{sourceIndex:number;slices:ReadableSlice[]}>}
export const readableItemLabel = (layout:GeneratedInnerPage['semanticLayoutType'],index:number) => {
  if(layout==='checklist')return '✓';
  if(layout==='steps'||layout==='timeline')return `STEP ${String(index+1).padStart(2,'0')}`;
  if(layout==='before_after')return index%2===0?'改写前':'改写后';
  if(layout==='comparison')return `对照 ${index+1}`;
  return String(index+1).padStart(2,'0');
};
export const readableStyles = (unit:'px'|'cqw',variant:GeneratedInnerPage['style_variant']='lined-notebook',layout:GeneratedInnerPage['semanticLayoutType']='knowledge_list') => {
  const size=(n:number)=>unit==='px'?`${n}px`:`${n/5.4}cqw`;
  const paper=STYLE_CONFIGS[variant || 'lined-notebook'];
  const accent=variant==='sticky-note'?'#be123c':variant==='draft-paper'?'#b91c1c':variant==='lined-notebook'?'#1d4ed8':variant==='dot-notebook'?'#4338ca':'#047857';
  const cardLayout=['checklist','steps','timeline','comparison','before_after','expression_bank','category_cards','example_breakdown'].includes(layout || '');
  return {
    article:{boxSizing:'border-box' as const,height:size(720),padding:size(32),backgroundColor:paper.backgroundColor,backgroundImage:paper.backgroundImage,backgroundSize:paper.backgroundSize,color:'#292524',fontFamily:'"Microsoft YaHei","Noto Sans SC",sans-serif',overflow:'hidden'},
    header:{fontSize:size(12),lineHeight:'1.4',color:'#777'},
    title:{fontSize:size(30),lineHeight:'1.3',fontWeight:900,margin:`${size(16)} 0 ${size(12)}`,overflowWrap:'anywhere' as const},
    divider:{height:size(1),backgroundColor:accent,marginBottom:size(14)},
    text:{fontSize:size(20),lineHeight:'1.6',margin:`0 0 ${size(10)}`,whiteSpace:'pre-wrap' as const,overflowWrap:'anywhere' as const},
    lead:{fontWeight:700,padding:`${size(8)} ${size(10)}`,borderLeft:`${size(4)} solid ${accent}`,background:'rgba(255,255,255,.58)'},
    item:{display:'grid',gridTemplateColumns:layout==='steps'||layout==='timeline'?`${size(74)} minmax(0,1fr)`:layout==='before_after'||layout==='comparison'?`${size(60)} minmax(0,1fr)`:`${size(28)} minmax(0,1fr)`,gap:size(8),...(cardLayout?{padding:size(10),border:`1px solid rgba(41,37,36,.12)`,borderRadius:size(8),background:'rgba(255,255,255,.68)'}:{})},
    number:{fontWeight:800,color:accent},
  };
};
const textAt=(page:GeneratedInnerPage,s:ReadableSlice)=>s.field==='lead'?page.lead:page.bullets[s.index];

/** Validate offsets against every original field. No text received from the client
 * becomes source content; even whitespace must survive once, in original order. */
export function projectReadablePages(source:GeneratedInnerPage[],plan:ReadablePagePlan):GeneratedInnerPage[] {
  if(plan.version!==1 || plan.sourceHash!==stableHash(source) || !Array.isArray(plan.pages) || plan.pages.length>1000)throw new Error('READABLE_LAYOUT_STALE');
  const cursor=new Map<string,number>();let previousSource=-1;
  for(const part of plan.pages){
    if(!Number.isInteger(part.sourceIndex)||part.sourceIndex<previousSource||!source[part.sourceIndex])throw new Error('READABLE_LAYOUT_ORDER');
    previousSource=part.sourceIndex;
    if(!Array.isArray(part.slices))throw new Error('READABLE_LAYOUT_FIELD');
    for(const s of part.slices){
      if(s.field!=='lead'&&s.field!=='bullet')throw new Error('READABLE_LAYOUT_FIELD');
      if(!Number.isInteger(s.index)||s.index<0||(s.field==='lead'&&s.index!==0))throw new Error('READABLE_LAYOUT_FIELD');
      const page=source[part.sourceIndex],text=textAt(page,s);
      const key=`${part.sourceIndex}:${s.field}:${s.index}`;
      if(typeof text!=='string'||!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.start!==(cursor.get(key)||0)||s.end<=s.start||s.end>text.length)throw new Error('READABLE_LAYOUT_LOSS');
      cursor.set(key,s.end);
    }
  }
  for(let i=0;i<source.length;i++){
    if(!plan.pages.some(p=>p.sourceIndex===i))throw new Error('READABLE_LAYOUT_MISSING_PAGE');
    if(source[i].page_type==='product_bridge'||source[i].showcase_asset_id){if(plan.pages.filter(p=>p.sourceIndex===i).length!==1)throw new Error('READABLE_LAYOUT_DUPLICATE');continue;}
    for(const [field,index,text] of [['lead',0,source[i].lead],...source[i].bullets.map((t,index)=>['bullet',index,t])] as Array<[string,number,string]>) {
      if((cursor.get(`${i}:${field}:${index}`)||0)!==text.length)throw new Error('READABLE_LAYOUT_LOSS');
    }
    const ordered=plan.pages.filter(p=>p.sourceIndex===i).flatMap(p=>p.slices.map(s=>s.field==='lead'?-1:s.index));
    if(ordered.some((n,k)=>k>0&&n<ordered[k-1]))throw new Error('READABLE_LAYOUT_ORDER');
  }
  return plan.pages.map((part,ordinal)=>{
    const page=source[part.sourceIndex];
    if(page.page_type==='product_bridge'||page.showcase_asset_id)return {...page,page_no:ordinal+1};
    const same=plan.pages.filter(p=>p.sourceIndex===part.sourceIndex);
    return {...page,page_no:ordinal+1,renderPayload:undefined,renderPayloadStatus:undefined,
      lead:part.slices.filter(s=>s.field==='lead').map(s=>page.lead.slice(s.start,s.end)).join(''),
      bullets:part.slices.filter(s=>s.field==='bullet').map(s=>page.bullets[s.index].slice(s.start,s.end)),
      readableLayout:{sourcePageNo:page.page_no,part:same.indexOf(part)+1,total:same.length,bulletNumbers:part.slices.filter(s=>s.field==='bullet').map(s=>s.index+1),leadRuns:part.slices.filter(s=>s.field==='lead').flatMap(s=>inlineRuns(page.lead,s.start,s.end)),bulletRuns:part.slices.filter(s=>s.field==='bullet').map(s=>inlineRuns(page.bullets[s.index],s.start,s.end))},
    };
  });
}
export function displayInnerPages(draft:ReferenceDrivenDraft) {
  return draft.readablePagePlan?projectReadablePages(draft.inner_pages,draft.readablePagePlan):draft.inner_pages;
}

/** Browser-only: use real line wrapping at the same 540×720 layout as export.
 * No character-count quota, summary, trimming, or AI. */
export function measureReadablePagePlan(source:GeneratedInnerPage[]):ReadablePagePlan {
  const host=document.createElement('div');host.style.cssText='position:fixed;left:-10000px;top:0;width:540px;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const plan:ReadablePagePlan={version:1,sourceHash:stableHash(source),pages:[]};
  try {
    for(let sourceIndex=0;sourceIndex<source.length;sourceIndex++){
      const page=source[sourceIndex];
      const style=readableStyles('px',page.style_variant,page.semanticLayoutType);
      if(page.page_type==='product_bridge'||page.showcase_asset_id){plan.pages.push({sourceIndex,slices:[]});continue;}
      const measure=(slices:ReadableSlice[])=>{
        const article=document.createElement('article');Object.assign(article.style,style.article);
        const header=document.createElement('header');Object.assign(header.style,style.header);header.textContent=`P999 · ${page.product_identity || '法语考试学习资料'}`;
        const title=document.createElement('h3');Object.assign(title.style,style.title);appendInlineRuns(title,inlineRuns(publicInnerTitle(page.page_title)));
        const divider=document.createElement('div');Object.assign(divider.style,style.divider);
        article.append(header,title,divider);
        for(const slice of slices){
          const p=document.createElement('p');Object.assign(p.style,style.text,slice.field==='lead'?style.lead:undefined);
          const runs=inlineRuns(textAt(page,slice),slice.start,slice.end);
          if(slice.field==='bullet'){
            Object.assign(p.style,style.item);
            const number=document.createElement('span');Object.assign(number.style,style.number);number.textContent=readableItemLabel(page.semanticLayoutType,slice.index);
            const body=document.createElement('span');appendInlineRuns(body,runs);p.append(number,body);
          }else{p.style.fontWeight='600';appendInlineRuns(p,runs);}
          article.append(p);
        }
        host.replaceChildren(article);
        const articleRect=article.getBoundingClientRect();
        const last=article.lastElementChild?.getBoundingClientRect();
        const bottomPadding=Number.parseFloat(getComputedStyle(article).paddingBottom)||0;
        const used=last?Math.min(1,(last.bottom-articleRect.top+bottomPadding)/article.clientHeight):0;
        return {fits:article.scrollHeight<=article.clientHeight,used};
      };
      const fits=(slices:ReadableSlice[])=>measure(slices).fits;
      let slices:ReadableSlice[]=[];
      const flush=()=>{plan.pages.push({sourceIndex,slices});slices=[];};
      const sourcePlanStart=plan.pages.length;
      const fields:ReadableSlice[]=[{field:'lead' as const,index:0,start:0,end:page.lead.length},...page.bullets.map((text,index)=>({field:'bullet' as const,index,start:0,end:text.length}))].filter(s=>s.end>0);
      if(!fits([]))throw new Error(`READABLE_TITLE_TOO_LARGE:P${page.page_no}`);
      for(const field of fields){
        const text=textAt(page,field);let start=0;
        while(start<text.length){
          const remainder={...field,start};
          if(fits([...slices,remainder])){slices.push(remainder);break;}
          const boundaries=Array.from(new Intl.Segmenter('fr',{granularity:'sentence'}).segment(text.slice(start)),s=>start+s.index+s.segment.length);
          let end=boundaries.filter(end=>fits([...slices,{...field,start,end}])).at(-1);
          {
            const words=Array.from(new Intl.Segmenter('fr',{granularity:'word'}).segment(text.slice(start)),s=>start+s.index+s.segment.length);
            let lo=0,hi=words.length-1,wordEnd:number|undefined;
            while(lo<=hi){const mid=(lo+hi)>>1;if(fits([...slices,{...field,start,end:words[mid]}])){wordEnd=words[mid];lo=mid+1;}else hi=mid-1;}
            // Prefer a sentence boundary when nearby, otherwise fill the page
            // at a word boundary instead of leaving a large blank region.
            if(wordEnd && (!end || wordEnd-end>80))end=wordEnd;
          }
          if(!end||end<=start){if(slices.length){flush();continue;}throw new Error(`READABLE_UNBREAKABLE_TEXT:P${page.page_no}`);}
          slices.push({...field,start,end});flush();start=end;
        }
      }
      if(slices.length || !fields.length)flush();
      // Greedy filling can leave only one short clause on a continuation page.
      // When the final two pages split the same field, move the split point back
      // to balance both pages. This preserves every character and the readable
      // font size while preventing a nearly empty orphan tail.
      const sourceParts=plan.pages.slice(sourcePlanStart);
      if(sourceParts.length>=2){
        const previous=sourceParts[sourceParts.length-2],last=sourceParts[sourceParts.length-1];
        const previousTail=previous.slices.at(-1),lastHead=last.slices[0];
        const lastUsage=measure(last.slices).used;
        if(lastUsage<0.42&&previousTail&&lastHead){
          let best:{score:number;previous:ReadableSlice[];last:ReadableSlice[]}|undefined;
          const coalesce=(items:ReadableSlice[])=>items.reduce<ReadableSlice[]>((result,item)=>{
            const tail=result.at(-1);
            if(tail&&tail.field===item.field&&tail.index===item.index&&tail.end===item.start)result[result.length-1]={...tail,end:item.end};
            else result.push(item);
            return result;
          },[]);
          const consider=(candidatePrevious:ReadableSlice[],candidateLast:ReadableSlice[])=>{
            candidatePrevious=coalesce(candidatePrevious);candidateLast=coalesce(candidateLast);
            const previousMetrics=measure(candidatePrevious),lastMetrics=measure(candidateLast);
            if(!candidatePrevious.length||!candidateLast.length||!previousMetrics.fits||!lastMetrics.fits||previousMetrics.used<0.34)return;
            const score=Math.min(previousMetrics.used,lastMetrics.used)-Math.abs(previousMetrics.used-lastMetrics.used)*0.15;
            if(!best||score>best.score)best={score,previous:candidatePrevious,last:candidateLast};
          };
          const combined=[...previous.slices,...last.slices];
          // A whole final bullet can be the orphan. Moving one or more complete
          // slices is preferable to splitting a sentence when it balances both.
          for(let cut=1;cut<combined.length;cut++)consider(combined.slice(0,cut),combined.slice(cut));
          if(previousTail.field===lastHead.field&&previousTail.index===lastHead.index&&previousTail.end===lastHead.start){
            const text=textAt(page,previousTail);
            const segment=text.slice(previousTail.start,lastHead.end);
            const boundaries=Array.from(new Intl.Segmenter('fr',{granularity:'word'}).segment(segment),part=>previousTail.start+part.index+part.segment.length)
              .filter(point=>point>previousTail.start&&point<lastHead.end);
            for(const point of boundaries)consider(
              [...previous.slices.slice(0,-1),{...previousTail,end:point}],
              [{...lastHead,start:point},...last.slices.slice(1)],
            );
          }
          if(best&&measure(best.last).used>lastUsage+0.05){previous.slices=best.previous;last.slices=best.last;}
        }
      }
    }
    projectReadablePages(source,plan);return plan;
  } finally {host.remove();}
}
