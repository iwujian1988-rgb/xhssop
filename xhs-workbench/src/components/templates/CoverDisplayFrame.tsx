'use client';

import {useLayoutEffect,useRef,type ReactNode,type CSSProperties} from 'react';
import {getCoverTemplateSpec} from '@/lib/cover-template-specs';
import type {CreativeCardRenderer} from '@/types/reference-workflow';

/** Cover preview layout only: never changes a source string. */
export default function CoverDisplayFrame({renderer,title,sourceCount,displayCount,children}:{renderer:CreativeCardRenderer;title:string;sourceCount:number;displayCount:number;children:ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  const policy=getCoverTemplateSpec(renderer)?.displayPolicy;
  useLayoutEffect(()=>{
    const host=ref.current;if(!host)return;
    if(getCoverTemplateSpec(renderer)?.renderMode==='image_to_image') {host.dataset.coverVisual='not_tested';return;}
    let disposed=false;
    const fit=()=>{
      if(disposed)return;
      const art=host.querySelector<HTMLElement>('article')||host.firstElementChild as HTMLElement;
      if(!art)return;
      const core=Array.from(host.querySelectorAll<HTMLElement>('h1,.rc-notebook-lines .big span'));
      let valid=core.length>0;
      for(const el of core){
        el.dataset.coverCore='true';
        if(!el.dataset.coverBaseFont)el.dataset.coverBaseFont=String(parseFloat(getComputedStyle(el).fontSize));
        const base=Number(el.dataset.coverBaseFont);
        const min=policy?.minFontScale??0.8;
        const fits=()=>{
          const s=getComputedStyle(el),r=el.getBoundingClientRect(),a=art.getBoundingClientRect();
          const line=parseFloat(s.lineHeight)||parseFloat(s.fontSize)*1.15;
          const range=document.createRange();range.selectNodeContents(el);
          const boxes=Array.from(range.getClientRects());
          return el.scrollWidth<=el.clientWidth+2 && el.offsetHeight<=line*(policy?.titleMaxLines??2)+3
            && boxes.every(b=>b.left>=a.left-2&&b.right<=a.right+2&&b.top>=a.top-2&&b.bottom<=a.bottom+2)
            && !boxes.some(b=>{for(let p=el.parentElement;p&&p!==host;p=p.parentElement){const ps=getComputedStyle(p),pr=p.getBoundingClientRect();if(/hidden|clip/.test(ps.overflowY)&&(b.bottom>pr.bottom+3||b.top<pr.top-3))return true;if(/hidden|clip/.test(ps.overflowX)&&(b.right>pr.right+3||b.left<pr.left-3))return true;}return false;});
        };
        el.style.fontSize=base+'px';
        for(let scale=0.98;!fits()&&scale>=min-0.001;scale-=0.02)el.style.fontSize=(base*Math.max(min,scale))+'px';
        if(el.textContent?.trim()!==title.trim()||!fits())valid=false;
      }
      host.dataset.coverVisual=valid?'pass':'core_overflow';
    };
    const ro=new ResizeObserver(fit);ro.observe(host);
    document.fonts.ready.then(fit);const frame=requestAnimationFrame(fit);
    return()=>{disposed=true;ro.disconnect();cancelAnimationFrame(frame);};
  },[renderer,title,displayCount,policy?.minFontScale,policy?.titleMaxLines]);
  return <div ref={ref} className="cover-display-policy" data-cover-visual="pending" data-cover-source-count={sourceCount} data-cover-display-count={displayCount}
    style={{'--cover-preview-lines':policy?.previewLines??3,'--cover-subtitle-lines':policy?.subtitleLines??2,'--cover-min-scale':policy?.minFontScale??0.8} as CSSProperties}>
    {children}
    <style>{`
      .cover-display-policy{width:100%}
      .cover-display-policy h1,.cover-display-policy .rc-notebook-lines .big span{display:block!important;-webkit-line-clamp:unset!important;overflow:visible!important;text-overflow:clip!important;white-space:normal!important;overflow-wrap:break-word;word-break:normal}
      /* The document frame clips its children: keep the core title inside it, not on its old negative-margin border. */
      .cover-display-policy .rc-doc-frame h1{flex-shrink:0;margin-top:.8cqw}
      .cover-display-policy :is(header>p,.rc-subtitle,.rc-experience-lead){display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:var(--cover-subtitle-lines);overflow:hidden!important}
      .cover-display-policy :is(.rc-word-grid strong,.rc-word-grid span,.rc-memo-sections p,.rc-offer-groups p,.rc-chalk-groups p,.rc-notebook-lines>div:not(.big) span){display:-webkit-box!important;-webkit-box-orient:vertical;-webkit-line-clamp:var(--cover-preview-lines);white-space:normal!important;overflow:hidden!important;overflow-wrap:normal;word-break:normal}
      .cover-display-policy .rc-word-grid strong{font-size:clamp(18px,4.1cqw,42px);line-height:1.15}
      .cover-display-policy .rc-word-grid span{font-size:clamp(13px,2.6cqw,28px);line-height:1.25}
      .cover-display-policy .rc-memo-sections{display:flex;flex-direction:column;justify-content:space-around}
      .cover-display-policy .rc-memo-sections section{margin-bottom:0;min-height:0;overflow:hidden}
    `}</style>
  </div>;
}
