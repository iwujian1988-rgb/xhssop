'use client';

import {useEffect, useState} from 'react';
import type {ContentPackage} from '@/lib/v2/contracts';
import type {ReferenceDrivenDraft} from '@/types/reference-workflow';
import {getCompetitorCreativeCard,standardCreativeCards} from '@/lib/creative-card-library';
import {getCoverTemplateSpec} from '@/lib/cover-template-specs';
import {resolveCanonicalTitlePackage} from '@/lib/canonical-title-package';

export function CoverCandidatePicker({draft,candidates,batchId,jobId,onSaved,onContinue,continueBusy=false,batchAdvanceMode=false}: {
  draft:ReferenceDrivenDraft; candidates:NonNullable<ContentPackage['coverCandidates']>;
  batchId:string;jobId:string;onSaved:(draft:ReferenceDrivenDraft)=>void;
  onContinue:()=>void|Promise<void>;continueBusy?:boolean;batchAdvanceMode?:boolean;
}) {
  const [selected,setSelected]=useState(draft.selectedCoverTemplateId || '');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [densityFilter,setDensityFilter]=useState<'all'|'dense'|'medium'|'low'>('all');
  useEffect(()=>{setSelected(draft.selectedCoverTemplateId || '');},[draft.selectedCoverTemplateId,draft.coverCopy?.requestId]);
  const valid=candidates.filter(c=>!c.rejectionReason);
  const confirmed=draft.coverSelection?.confirmedTemplateId;
  const confirmedCandidate=valid.find(candidate=>candidate.templateId===confirmed);
  const selectedIsConfirmed=Boolean(confirmedCandidate && confirmed===selected);
  const [alternativesOpen,setAlternativesOpen]=useState(false);
  const titlePackage=resolveCanonicalTitlePackage(draft);
  const selectedText=titlePackage.humanSelectableTextTitles?.find(item=>item.id===titlePackage.humanSelectedTextTitleId);
  const selectedCoverText=titlePackage.humanSelectableTextTitles?.find(item=>item.id===titlePackage.humanSelectedCoverTitleId);
  const visibleCandidates=confirmed && !alternativesOpen ? valid.filter(candidate=>candidate.templateId===confirmed) : valid;
  const downstreamComplete=Boolean(selectedIsConfirmed
    && draft.coverSelection?.downstreamComplete
    && draft.selectedCoverTemplateId===confirmed
    && draft.coverSelection?.titleId===draft.coverCopy?.titleId
    && draft.coverSelection?.sourceInnerHash===draft.coverCopy?.sourceInnerHash);
  const libraryCards=standardCreativeCards.filter(card=>card.supported
    && getCoverTemplateSpec(card.renderer_id)?.productionFit!=='disabled'
    && (densityFilter==='all'||(densityFilter==='dense'?(card.density==='high'||card.density==='very_high'):card.density===densityFilter)));
  const isGeneratedCandidate=(templateId:string)=>valid.some(candidate=>candidate.templateId===templateId);
  async function confirm() {
    setBusy(true);setMessage('正在保存封面选择…');
    try {
      const response=await fetch('/api/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        action:'update_draft_state',batch_id:batchId,job_id:jobId,selected_cover_template_id:selected,
        expected_cover_request_id:draft.coverCopy?.requestId,
      })});
      const result=await response.json();
      if (!response.ok || !result.job?.draft) throw new Error(result.error || '封面选择保存失败');
      onSaved(result.job.draft);
      setMessage(batchAdvanceMode?'封面模板已确认。现在可在下方人工修改封面；全部选完后再批量生成。':'封面模板已确认。现在可在下方人工修改封面，或直接生成成品。');
    } catch(error) {setMessage(error instanceof Error?error.message:'保存失败');}
    finally {setBusy(false);}
  }
  return <section className="border border-neutral-300 bg-white p-4" data-testid="cover-candidate-picker">
    <h2 className="font-black">{downstreamComplete?`封面方案 · 共${valid.length}个可选 · 成品已完成`:confirmed?`封面已选择 · 共${valid.length}个可换选方案`:`封面尚未选择 · 系统已匹配${valid.length}个方案`}</h2>
    <p className="mt-1 text-sm text-neutral-600">{downstreamComplete?'当前模板已经生成最终成品；如需换封面，可点击“修改封面”查看其他模板。':'先选模板并确认；确认后只保留当前封面，点击“修改封面”才展开其他选项。排版封面可改文字与排版，图生图封面只显示图片生成状态。'}</p>
    <div className="mt-3 border border-cyan-200 bg-cyan-50 p-3" data-testid="previous-title-selection">
      <div className="text-xs font-black text-cyan-900">上一步已选的标题</div>
      <div className="mt-2 grid gap-1 text-sm"><div><span className="font-bold">文字标题：</span>{selectedText?.textTitle || draft.selected_title || '未显示'}</div><div><span className="font-bold">封面标题：</span>{selectedCoverText?.textTitle || draft.cover.title || '未显示'}</div></div>
    </div>
    {confirmed && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-green-200 bg-green-50 p-3"><span className="text-sm font-black text-green-900">本篇已确认封面：{confirmedCandidate ? getCompetitorCreativeCard(confirmedCandidate.templateId)?.name || confirmedCandidate.templateId : confirmed}</span><button type="button" disabled={busy||continueBusy} onClick={()=>setAlternativesOpen(open=>!open)} className="min-h-10 border border-green-800 bg-white px-3 py-2 text-sm font-black text-green-900">{alternativesOpen?'收起其他封面':'修改封面（查看其他选项）'}</button></div>}
    {valid.length === 1 && <p role="status" className="mt-3 border border-amber-300 bg-amber-50 p-3 text-sm font-bold text-amber-900">本篇当前只有1个通过结构校验的封面，没有可换选项。后续新生成会要求至少提供2个合格候选。</p>}
    <div role="radiogroup" aria-label="选择封面方案" className="mt-4 grid gap-3 sm:grid-cols-3">
      {visibleCandidates.map((candidate,index)=>{
        const card=getCompetitorCreativeCard(candidate.templateId);
        return <label key={candidate.templateId} className={`min-w-0 cursor-pointer border-2 p-3 ${selected===candidate.templateId?'border-neutral-900 bg-amber-50':'border-neutral-200'}`}>
          <div className="flex items-start gap-2"><input type="radio" name={`cover-${jobId}`} value={candidate.templateId} checked={selected===candidate.templateId} disabled={busy||continueBusy} onChange={()=>setSelected(candidate.templateId)} className="mt-1 h-4 w-4"/><span className="text-sm font-bold">{card?.name || candidate.templateId}{index===0?' · 自动推荐':''}{confirmed===candidate.templateId?' · 已确认':''}</span></div>
          {card?.reference_image && <img src={card.reference_image} alt={`${card.name}模板参考图`} className="mt-3 h-40 w-full object-contain"/>}
          <p className="mt-2 text-xs text-neutral-500">{candidate.renderMode==='image_to_image'?'图生图 · 确认后生成时有图片调用':'排版封面'}</p>
          <p className="mt-2 text-sm font-bold break-words">{candidate.coverTitle}</p>
          <p className="mt-1 text-xs break-words">{candidate.coverSubtitle}</p>
          <p className="mt-2 text-xs leading-relaxed text-neutral-600">{candidate.fitReason}</p>
        </label>;
      })}
    </div>
    <div className="mt-4 border-t border-neutral-200 pt-4">
      <button type="button" disabled={busy||continueBusy} onClick={()=>setLibraryOpen(open=>!open)} aria-expanded={libraryOpen} className="min-h-11 border border-neutral-900 bg-white px-4 py-2 text-sm font-black text-neutral-900 disabled:opacity-40">
        {libraryOpen?'收起全部模板':`查看全部封面模板（${standardCreativeCards.filter(card=>card.supported&&getCoverTemplateSpec(card.renderer_id)?.productionFit!=='disabled').length}个）`}
      </button>
      <p className="mt-2 text-xs text-neutral-600">推荐里没有合适的，可以从完整模板库选择；系统只重新适配这个封面，不会改正文和文字标题。</p>
      {libraryOpen && <div className="mt-3 border border-neutral-300 bg-neutral-50 p-3" data-testid="full-cover-library">
        <div className="flex flex-wrap gap-2" aria-label="按信息密度筛选">
          {(['all','dense','medium','low'] as const).map(value=><button key={value} type="button" onClick={()=>setDensityFilter(value)} className={`min-h-9 border px-3 py-1 text-sm font-bold ${densityFilter===value?'border-neutral-900 bg-neutral-900 text-white':'border-neutral-300 bg-white'}`}>{value==='all'?'全部':value==='dense'?'高信息密度':value==='medium'?'中等密度':'简洁封面'}</button>)}
        </div>
        <div role="radiogroup" aria-label="全部封面模板" className="mt-3 grid max-h-[620px] gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
          {libraryCards.map(card=>{
            const generated=isGeneratedCandidate(card.id);
            return <label key={card.id} className={`min-w-0 cursor-pointer border-2 p-3 ${selected===card.id?'border-neutral-900 bg-amber-50':'border-neutral-200 bg-white'}`}>
              <div className="flex items-start gap-2"><input type="radio" name={`cover-library-${jobId}`} value={card.id} checked={selected===card.id} disabled={busy||continueBusy} onChange={()=>{setSelected(card.id);setMessage(generated?'该模板已有适配文案，可以直接确认。':'确认后会只为这个模板适配一次封面文案。');}} className="mt-1 h-4 w-4"/><span className="text-sm font-bold">{card.name}</span></div>
              {card.reference_image && <img src={card.reference_image} alt={`${card.name}模板参考图`} className="mt-3 h-36 w-full object-contain"/>}
              <p className="mt-2 text-xs text-neutral-600">{card.density==='very_high'?'超高信息密度':card.density==='high'?'高信息密度':card.density==='medium'?'中等密度':'简洁'} · {getCoverTemplateSpec(card.renderer_id)?.renderMode==='image_to_image'?'图生图':'排版封面'}{generated?' · 已有适配文案':' · 选择后适配'}</p>
            </label>;
          })}
        </div>
      </div>}
    </div>
    <p className="mt-3 text-xs text-neutral-600">换选不会重写正文和文字标题。若已生成旧封面，换选会使旧图片和导出状态失效；旧文件保留。</p>
    <button type="button" disabled={busy || continueBusy || !selected || confirmed===selected} onClick={confirm} className="mt-3 min-h-11 border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{busy?'正在适配并保存…':confirmed===selected?'封面模板已确认':isGeneratedCandidate(selected)?'使用这个封面':'适配并使用这个封面'}</button>
    {message && <p role="status" aria-live="polite" className="mt-2 text-sm">{message}</p>}
    {selectedIsConfirmed && downstreamComplete && <div className="mt-4 border-2 border-green-700 bg-green-50 p-4" data-testid="cover-complete-state">
      <p className="text-sm font-black text-green-900">封面成品已完成</p>
      <p className="mt-1 text-xs leading-relaxed text-green-900">当前模板已经用于最终成品，无需再次生成。需要更换时，请选择上方其他模板并确认。</p>
    </div>}
    {selectedIsConfirmed && !downstreamComplete && <div className="mt-4 border-2 border-green-700 bg-green-50 p-4" data-testid="cover-next-action">
      <p className="text-sm font-black text-green-900">封面已选定，现在生成成品</p>
      <p className="mt-1 text-xs leading-relaxed text-green-900">{batchAdvanceMode?'本篇已准备好。全部选完后，使用列表顶部或底部的“一键生成成品”。':confirmedCandidate!.renderMode==='image_to_image'?'将提交一次图片生成任务，完成后显示最终图片封面。':'这是排版封面，不调用图片模型；继续后会完成检查并显示可导出的最终封面。'}</p>
      {!batchAdvanceMode && <button type="button" disabled={busy||continueBusy} onClick={()=>onContinue()} className="mt-3 min-h-12 w-full bg-green-800 px-4 py-3 text-sm font-black text-white disabled:opacity-50">{continueBusy?'正在生成，请勿重复点击…':confirmedCandidate!.renderMode==='image_to_image'?'生成图片封面（会调用图片模型）':'生成排版封面'}</button>}
    </div>}
  </section>;
}
