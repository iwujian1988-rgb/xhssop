export interface InlineRun {text:string;kind:'text'|'strong'|'em'}
// Parse only paired emphasis, never HTML. Slice against ORIGINAL offsets so
// emphasis remains correct even when the opening marker is on a prior page.
export function inlineRuns(source:string,start=0,end=source.length):InlineRun[]{
  const runs:InlineRun[]=[];let cursor=0;
  const add=(a:number,b:number,kind:InlineRun['kind'])=>{const lo=Math.max(a,start),hi=Math.min(b,end);if(hi>lo)runs.push({text:source.slice(lo,hi),kind});};
  for(const m of source.matchAll(/\*\*([^*\n]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)/g)){
    const pos=m.index!;add(cursor,pos,'text');const size=m[1]!==undefined?2:1;
    add(pos+size,pos+m[0].length-size,size===2?'strong':'em');cursor=pos+m[0].length;
  }
  add(cursor,source.length,'text');return runs;
}
export function publicInnerTitle(text:string){return text.replace(/^改写资产(?=\s*[：:])/,'改写对照');}
export function appendInlineRuns(node:HTMLElement,runs:InlineRun[]){
  for(const run of runs){const element=document.createElement(run.kind==='strong'?'strong':run.kind==='em'?'em':'span');element.textContent=run.text;node.appendChild(element);}
}
