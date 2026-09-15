'use client';
import {useEffect,useState} from 'react';
import {displayInnerPages,measureReadablePagePlan,type ReadablePagePlan} from '@/lib/readable-inner-layout';
import type {ReferenceDrivenDraft} from '@/types/reference-workflow';
import {stableHash} from '@/lib/v2/contracts';

export function useReadableInnerPages(draft:ReferenceDrivenDraft){
  const hash=stableHash(draft.inner_pages);
  const [layout,setLayout]=useState<{hash:string;plan?:ReadablePagePlan;error?:string}>({hash:''});
  useEffect(()=>{let cancelled=false;
    document.fonts.ready.then(()=>{
      if(cancelled)return;
      try{setLayout({hash,plan:measureReadablePagePlan(draft.inner_pages)});}
      catch(error){setLayout({hash,error:error instanceof Error?error.message:'内页分页失败'});}
    });
    return()=>{cancelled=true;};
  },[hash]);
  const ready=layout.hash===hash && !!layout.plan;
  const renderedDraft=ready?{...draft,readablePagePlan:layout.plan}:draft;
  return {pages:ready?displayInnerPages(renderedDraft):draft.inner_pages,ready,error:layout.hash===hash?layout.error:undefined,renderedDraft};
}
