'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { CreativeCardRenderer, DenseDirectoryCoverPayload, DenseDirectorySection } from '@/types/reference-workflow';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import ParchmentDenseCover from './ParchmentDenseCover';
import WhiteGreenDirectoryCover from './WhiteGreenDirectoryCover';
import PurpleDirectoryCover from './PurpleDirectoryCover';
import { useAutoFitScale } from './useAutoFitScale';

function sectionsFingerprint(payload: DenseDirectoryCoverPayload) {
  return payload.sections.map(s => `${s.heading}:${s.items.length}:${s.items.map(i => `${i.primary}${i.secondary || ''}`).join(',')}`).join('|');
}

interface Props { renderer: CreativeCardRenderer; payload: DenseDirectoryCoverPayload; className?: string; referenceImage?: string }

export default function ReferenceCoverRenderer({ renderer, payload, className = '', referenceImage }: Props) {
  const spec = getCoverTemplateSpec(renderer);
  if (spec?.renderMode === 'image_to_image') {
    return <article className={`reference-image-template ${className}`} aria-label={payload.title}>
      {referenceImage ? <img src={referenceImage} alt={`${spec.name}参考图`} /> : null}
      <div className="reference-image-template__badge">图生图模板</div>
      <div className="reference-image-template__pending">参考图 + 本篇文案<br/>等待图生图</div>
      <div className="reference-image-template__note">
        <b>{spec.name}</b>
        <span>参考图决定风格版式，本篇文案决定内容，一起发给模型图生图</span>
      </div>
      <style>{`.reference-image-template{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;background:#ececec;box-shadow:0 20px 48px rgba(0,0,0,.18)}.reference-image-template>img{width:100%;height:100%;object-fit:cover;filter:saturate(.55) brightness(.75)}.reference-image-template__badge{position:absolute;top:14px;left:14px;padding:7px 10px;background:#111;color:#fff;font-size:12px;font-weight:800}.reference-image-template__pending{position:absolute;top:42%;right:8%;left:8%;padding:16px;background:rgba(0,0,0,.78);color:#fff;text-align:center;font-size:22px;font-weight:900;line-height:1.35}.reference-image-template__note{position:absolute;right:12px;bottom:12px;left:12px;display:flex;flex-direction:column;gap:3px;padding:12px;background:rgba(255,255,255,.96);font-size:12px;line-height:1.35}.reference-image-template__note b{font-size:14px}`}</style>
    </article>;
  }
  if (renderer === 'parchment_dense_directory') return <ParchmentDenseCover payload={payload} className={className} />;
  if (renderer === 'white_green_directory') return <WhiteGreenDirectoryCover payload={payload} className={className} />;
  if (renderer === 'clean_purple_directory') return <PurpleDirectoryCover payload={payload} variant="clean" className={className} />;
  if (renderer === 'grid_purple_directory') return <PurpleDirectoryCover payload={payload} variant="grid" className={className} />;
  if (renderer === 'blackboard_phrase') return <BlackboardPhrase payload={payload} className={className} />;
  if (renderer === 'blackboard_offer') return <BlackboardOffer payload={payload} className={className} />;
  if (renderer === 'memo_offer') return <MemoOffer payload={payload} className={className} />;
  if (renderer === 'word_flashcard') return <WordFlashcard payload={payload} className={className} />;
  if (renderer === 'book_cover') return <BookCover payload={payload} className={className} />;
  if (renderer === 'notebook_big_words') return <NotebookPain payload={payload} className={className} />;
  if (renderer === 'plain_experience') return <PlainExperience payload={payload} className={className} />;
  if (renderer === 'document_analysis') return <DocumentAnalysis payload={payload} className={className} />;
  if (renderer === 'vocab_table') return <VocabTable payload={payload} className={className} />;
  if (renderer === 'course_roadmap') return <CourseRoadmap payload={payload} className={className} />;
  if (renderer === 'collocation_dense') return <CollocationDense payload={payload} className={className} />;
  return <ParchmentDenseCover payload={payload} className={className} />;
}

function Frame({ className, label, children, style }: { className: string; label: string; children: ReactNode; style?: CSSProperties }) {
  return <article className={`reference-cover ${className}`} style={style} aria-label={label}>{children}<BaseStyles /></article>;
}

function BlackboardPhrase({ payload, className }: CoverProps) {
  const itemCount = payload.sections.reduce((sum, section) => sum + section.items.length, 0);
  const averageLength = payload.sections.flatMap(section => section.items).reduce((sum, item, _, items) => sum + `${item.primary}${item.secondary || ''}`.length / Math.max(items.length, 1), 0);
  const bodySize = itemCount > 18 || averageLength > 22 ? '2.75cqw' : itemCount > 15 ? '3.05cqw' : '3.38cqw';
  const titleSize = payload.title.length > 16 ? '7.05cqw' : '7.9cqw';
  return <Frame className={`rc-blackboard ${className}`} label={payload.title} style={{ '--chalk-body': bodySize, '--chalk-title': titleSize } as CSSProperties}>
    <img src="/generated/chalkboard_phrase_master_clean_01.png" alt="" /><header><h1>{payload.title}</h1><p>{payload.subtitle}</p></header>
    <div className="rc-chalk-groups">{payload.sections.map((s, i) => <section key={i}><h2>{s.heading}</h2><div>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b><span>{x.secondary}</span></p>)}</div></section>)}</div>
  </Frame>;
}

function BlackboardOffer({ payload, className }: CoverProps) {
  const titleSize = payload.title.length > 18 ? '6.85cqw' : payload.title.length > 13 ? '7.45cqw' : '8.25cqw';
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.55, max: 1, step: 0.025 });
  return <Frame className={`rc-blackboard rc-offer ${className}`} label={payload.title} style={{ '--offer-title': titleSize } as CSSProperties}>
    <img src="/generated/chalkboard_phrase_master_clean_01.png" alt="" /><header><h1>{payload.title}</h1><p>{payload.subtitle}</p></header>
    <div className="rc-offer-groups" ref={fitRef}>{payload.sections.map((s,i)=><section key={i}><h2>{s.heading}</h2>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b>{x.secondary ? `：${x.secondary}` : ''}</p>)}</section>)}</div>
  </Frame>;
}

function MemoOffer({ payload, className }: CoverProps) {
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.55, max: 1, step: 0.025 });
  return <Frame className={`rc-memo ${className}`} label={payload.title}><div className="rc-memo-status"><b>9:41</b><span>● ◒ ▰</span></div><div className="rc-memo-bar"><span>‹　备忘录</span><span className="rc-memo-actions">⌕　＋　☷</span></div><h1>{payload.title}</h1><p className="rc-subtitle">{payload.subtitle}</p><div className="rc-memo-sections" ref={fitRef}>{payload.sections.map((s,i)=><section key={i}><h2>{s.heading}</h2>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b>{x.secondary ? `：${x.secondary}` : ''}</p>)}</section>)}</div></Frame>;
}

function WordFlashcard({ payload, className }: CoverProps) {
  const items = payload.sections.flatMap(s => s.items).slice(0, 9);
  const fingerprint = items.map(x => `${x.primary}|${x.secondary || ''}|${x.note || ''}`).join(',');
  const fitRef = useAutoFitScale<HTMLDivElement>([fingerprint], { min: 0.5, max: 1, step: 0.03 });
  return <Frame className={`rc-flashcard ${className}`} label={payload.title}><img src="/generated/parchment_master_clean_01.png" alt=""/><h1>{payload.title}</h1><div className="rc-word-grid" ref={fitRef}>{items.map((x,i)=><div className={i===0?'featured':''} key={i}><strong>{x.primary}</strong><span>{x.secondary}</span><em>{x.note}</em></div>)}</div></Frame>;
}

function BookCover({ payload, className }: CoverProps) {
  const titleSize = payload.title.length > 18 ? '4.6cqw' : payload.title.length > 13 ? '5.6cqw' : '7cqw';
  return <Frame className={`rc-book ${className}`} label={payload.title} style={{ '--book-title': titleSize } as CSSProperties}><div className="rc-book-top"><b>FLE</b><span>OBJECTIF B2</span></div><div className="rc-book-main"><small>CAHIER PRATIQUE</small><h1>{payload.title}</h1><p>{payload.subtitle}</p></div><div className="rc-book-bottom">{payload.sections.flatMap(s=>s.items).slice(0,4).map((x,i)=><span key={i}><em>{x.primary}</em></span>)}</div></Frame>;
}

function NotebookPain({ payload, className }: CoverProps) {
  const lines = [payload.subtitle, payload.title, ...payload.sections.map(s=>s.items[0]?.primary || s.heading)].filter(Boolean).slice(0,5);
  const fitRef = useAutoFitScale<HTMLDivElement>([lines.join('|')], { min: 0.55, max: 1, step: 0.025 });
  return <Frame className={`rc-notebook ${className}`} label={payload.title}><img src="/generated/notebook_paper_master_clean_02.png" alt=""/><div className="rc-notebook-lines" ref={fitRef}>{lines.map((line,i)=><div className={i===1?'big':''} key={i}><span>{line}</span></div>)}</div></Frame>;
}

function PlainExperience({ payload, className }: CoverProps) {
  const paragraphs = payload.sections.slice(0,2).map(section => section.items.map(item => `${item.primary}${item.secondary ? `，${item.secondary}` : ''}`).join('。'));
  const titleSize = payload.title.length > 16 ? '6.4cqw' : '8.2cqw';
  const fitRef = useAutoFitScale<HTMLDivElement>([paragraphs.join('|')], { min: 0.5, max: 1, step: 0.025 });
  return <Frame className={`rc-experience ${className}`} label={payload.title} style={{ '--exp-title': titleSize } as CSSProperties}><div className="rc-rule"/><h1>{payload.title}</h1><p className="rc-experience-lead">{payload.subtitle}</p><div className="rc-experience-body" ref={fitRef}>{paragraphs.map((paragraph,index)=><p className="rc-experience-paragraph" key={index}>{paragraph}。</p>)}</div></Frame>;
}

function DocumentAnalysis({ payload, className }: CoverProps) {
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.5, max: 1, step: 0.025 });
  return <Frame className={`rc-document ${className}`} label={payload.title}><div className="rc-doc-frame"><h1>{payload.title}</h1><div className="rc-doc-subject">{payload.subtitle}</div><div className="rc-doc-meta"><span>≡　编号</span><b>范例 01</b></div><div className="rc-doc-content" ref={fitRef}>{payload.sections.map((s,i)=><section key={i}><h2>{i === 0 ? '题目' : s.heading}</h2><p>{s.items.map((x,j)=><span className={/[A-Za-zÀ-ÿ]{8}/.test(x.primary)?'fr':''} key={j}>{x.primary}{x.secondary ? `　${x.secondary}` : ''}{j < s.items.length - 1 ? '。' : ''}</span>)}</p></section>)}</div><footer>{payload.subtitle} · DELF B2 写作素材页 <span>1</span></footer></div></Frame>;
}

function VocabTable({ payload, className }: CoverProps) {
  const rows=payload.sections.flatMap(s=>s.items.map(x=>[s.side_label||s.heading,x.primary,x.secondary||'',x.note||'']));
  const half=Math.ceil(rows.length/2);
  const rowSize = rows.length > 16 ? '1.35cqw' : rows.length > 12 ? '1.5cqw' : '1.62cqw';
  return <Frame className={`rc-vocab ${className}`} label={payload.title} style={{ '--vocab-row': rowSize } as CSSProperties}><img src="/generated/vocab_table_master_clean_01.png" alt=""/><Table rows={rows.slice(0,half)}/><div className="rc-vocab-hook"><b>{payload.title}</b><span>{payload.subtitle}</span></div><Table rows={rows.slice(half)}/></Frame>;
}

function Table({rows}:{rows:string[][]}) { return <div className="rc-table">{rows.map((r,i)=><div key={i}>{r.map((c,j)=><span key={j}>{c}</span>)}</div>)}</div> }

function CourseRoadmap({ payload, className }: CoverProps) {
  const maxItemsPerSection = Math.max(1, ...payload.sections.map(s => s.items.length));
  const avgLength = payload.sections.flatMap(s => s.items).reduce((sum, item, _, items) => sum + `${item.primary}${item.secondary || ''}`.length / Math.max(items.length, 1), 0);
  const bodySize = maxItemsPerSection > 4 || avgLength > 20 ? '1.95cqw' : maxItemsPerSection > 3 || avgLength > 14 ? '2.2cqw' : '2.45cqw';
  return <Frame className={`rc-roadmap ${className}`} label={payload.title} style={{ '--roadmap-body': bodySize } as CSSProperties}><header><h1>{payload.title}</h1><p>{payload.subtitle}</p></header><div className="rc-roadmap-grid">{payload.sections.map((s,i)=><section key={i}><strong>{String(i+1).padStart(2,'0')}</strong><h2>{s.heading}</h2>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b>{x.secondary ? ` ${x.secondary}` : ''}</p>)}</section>)}</div></Frame>;
}

function CollocationDense({ payload, className }: CoverProps) {
  const cols=[payload.sections.slice(0,2),payload.sections.slice(2,4),payload.sections.slice(4,6)];
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.45, max: 1, step: 0.025 });
  return <Frame className={`rc-collocation ${className}`} label={payload.title}><h1>{payload.title}</h1><p className="rc-collocation-sub">{payload.subtitle}</p><div className="rc-collocation-cols" ref={fitRef}>{cols.map((groups,i)=><div key={i}>{groups.map((s,j)=><section key={j}><h2>{s.heading}</h2>{s.items.map((x,k)=><p key={k}><b>{x.primary}</b><span>{x.secondary}</span></p>)}</section>)}</div>)}</div></Frame>;
}

type CoverProps={payload:DenseDirectoryCoverPayload;className?:string};

function BaseStyles() { return <style>{`
  .reference-cover{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;background:#fff;container-type:inline-size;box-shadow:0 20px 48px rgba(0,0,0,.18);letter-spacing:0}.reference-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.reference-cover h1,.reference-cover h2,.reference-cover p{margin:0}.reference-cover *{box-sizing:border-box;min-width:0;overflow-wrap:normal;word-break:keep-all;hyphens:none}
  .rc-blackboard{color:#fff;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-blackboard:after{content:"";position:absolute;inset:0;background:rgba(0,35,20,.12)}.rc-blackboard header,.rc-chalk-groups,.rc-offer-groups{position:relative;z-index:1}.rc-blackboard header{padding:4.1cqw 4.8cqw 1.15cqw;text-align:center}.rc-blackboard header h1{font-family:"STXinwei","FZShuTi",serif;font-size:var(--chalk-title);font-weight:500;line-height:1.03}.rc-blackboard header p{margin-top:1cqw;color:#ffd84a;font-size:3.25cqw;font-weight:850}.rc-chalk-groups{display:grid;grid-template-columns:repeat(2,1fr);gap:3.4cqw;height:78.5%;padding:1.45cqw 4.9cqw 2.7cqw}.rc-chalk-groups section{display:flex;min-height:0;flex-direction:column}.rc-chalk-groups h2{display:inline-block;align-self:flex-start;margin-bottom:.85cqw;border-bottom:.45cqw solid #f7c52e;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:3.85cqw;line-height:1.03}.rc-chalk-groups section>div{display:flex;min-height:0;flex:1;flex-direction:column;justify-content:space-evenly}.rc-chalk-groups p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;padding:.32cqw 0;border-bottom:.12cqw dashed rgba(255,255,255,.3);font-size:var(--chalk-body);line-height:1.08;white-space:normal}.rc-chalk-groups b{font-family:Georgia,"Noto Serif SC",serif}.rc-chalk-groups span{margin-left:.5cqw;color:#f4e8bc;font-size:.88em}.rc-offer header{padding-bottom:.6cqw}.rc-offer header h1{font-size:var(--offer-title)}.rc-offer-groups{display:flex;flex-direction:column;justify-content:space-between;height:72.5%;padding:.55cqw 6.4cqw 2.7cqw;overflow:hidden}.rc-offer-groups section{display:flex;flex-shrink:0;flex-direction:column;justify-content:flex-start;padding-bottom:.35cqw;border-bottom:.16cqw dashed rgba(255,255,255,.34)}.rc-offer-groups h2{align-self:flex-start;padding:.45cqw 1.15cqw;background:#f1c735;color:#173c2c;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:clamp(15px, calc(3.75cqw * var(--fit-scale, 1)), 31px);line-height:1.08}.rc-offer-groups p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:calc(.75cqw * var(--fit-scale, 1));font-size:clamp(13px, calc(3.48cqw * var(--fit-scale, 1)), 29px);font-weight:650;line-height:1.18;white-space:normal}.rc-offer-groups p b{color:#fff;font-weight:900}
  .rc-memo{display:flex;flex-direction:column;height:100%;padding:1.8% 4.2% 4%;background:#fff;color:#171717;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-memo-status{flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 .4cqw;color:#111;font-size:2.75cqw;font-weight:800}.rc-memo-bar{flex:none;display:flex;align-items:center;justify-content:space-between;margin-top:1.9cqw;color:#c4a800;font-size:4.65cqw;font-weight:650;line-height:1}.rc-memo-actions{font-family:Arial,"Noto Sans SC",sans-serif;font-size:4.35cqw;letter-spacing:.08em}.rc-memo>h1{flex:none;margin-top:3.6cqw;text-align:center;font-size:7.65cqw;font-weight:900;line-height:1.06}.rc-subtitle{flex:none;margin-top:1.2cqw;text-align:center;color:#6b6b6b;font-size:3.35cqw;font-weight:600}.rc-memo-sections{flex:1 1 auto;min-height:0;overflow:hidden;margin-top:5cqw}.rc-memo-sections section{margin-bottom:calc(4.1cqw * var(--fit-scale, 1))}.rc-memo-sections h2{display:inline-block;padding:.35cqw .85cqw;background:#ffdc62;font-size:clamp(14px, calc(4.55cqw * var(--fit-scale, 1)), 34px);font-weight:900;line-height:1.12}.rc-memo-sections p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;margin-top:calc(1.15cqw * var(--fit-scale, 1));font-size:clamp(11px, calc(3.95cqw * var(--fit-scale, 1)), 30px);font-weight:500;line-height:1.42;white-space:normal}.rc-memo-sections b{font-weight:850}
  .rc-flashcard{background:#d9bd8e}.rc-flashcard:after{content:"";position:absolute;z-index:1;top:14.2%;right:4%;left:4%;height:.22cqw;background:#55483d}.rc-flashcard>h1{position:absolute;z-index:2;top:4.8%;left:4%;right:4%;color:#18130e;text-align:center;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:5.65cqw;line-height:1.1}.rc-word-grid{position:absolute;z-index:2;top:18%;right:5%;bottom:5%;left:5%;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);column-gap:2cqw;overflow:hidden}.rc-word-grid div{display:flex;position:relative;overflow:hidden;flex-direction:column;align-items:center;justify-content:center;text-align:center}.rc-word-grid div.featured:before{content:"";position:absolute;inset:11% 4%;border:.32cqw dashed #d33124;border-radius:1.2cqw}.rc-word-grid strong{display:block;position:relative;max-width:100%;overflow:hidden;font-family:Georgia,"Noto Serif SC",serif;font-size:clamp(14px, calc(6.25cqw * var(--fit-scale, 1)), 50px);font-weight:500;line-height:1.05;text-overflow:ellipsis;white-space:nowrap}.rc-word-grid span{display:block;position:relative;margin-top:calc(1.05cqw * var(--fit-scale, 1));color:#a32019;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:clamp(9px, calc(3.05cqw * var(--fit-scale, 1)), 24px);font-weight:900}.rc-word-grid em{position:relative;margin-top:calc(.65cqw * var(--fit-scale, 1));overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;color:#211a15;font-family:"Noto Serif SC","STSong",serif;font-size:clamp(8px, calc(2.55cqw * var(--fit-scale, 1)), 20px);font-style:normal}
  .rc-book{font-family:"Arial",sans-serif;background:linear-gradient(#fff 0 49%,#4a9b8a 49%)}.rc-book-top{display:flex;height:13cqw;align-items:center;justify-content:space-between;background:#4a9b8a;color:#fff;font-size:4cqw;font-weight:900}.rc-book-top b{display:flex;height:100%;align-items:center;padding:0 5cqw;background:#b91435;font-size:7cqw}.rc-book-top span{padding-right:5cqw}.rc-book-main{padding:7cqw 8cqw 5cqw}.rc-book-main small{color:#225f7e;font-weight:900}.rc-book-main h1{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;margin-top:2cqw;color:#216384;font-size:var(--book-title,7cqw);line-height:1.15;white-space:normal}.rc-book-main p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:3cqw;color:#4a9b8a;font-size:2.7cqw;font-weight:800;white-space:normal}.rc-book-bottom{position:relative;display:grid;grid-template-columns:repeat(2,1fr);gap:5cqw 4cqw;padding:9cqw 8cqw;color:#fff}.rc-book-bottom:before{content:"···  ✉  ◉  @  ◔  ···";position:absolute;top:2cqw;left:0;right:0;color:rgba(255,255,255,.9);text-align:center;font-size:4.5cqw;word-spacing:2cqw}.rc-book-bottom span{display:flex;overflow:hidden;min-height:9cqw;align-items:center;justify-content:center;padding:1cqw 2cqw;border:.25cqw solid #fff;border-radius:50%;text-align:center;font-size:2.5cqw;font-weight:800}.rc-book-bottom span em{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;font-style:normal;white-space:normal}
  .rc-notebook{background:#d5cdb7}.rc-notebook-lines{position:absolute;left:24%;right:0;top:14.7%;bottom:6%;display:grid;grid-template-rows:.85fr 1.7fr .85fr .85fr .85fr;overflow:hidden;font-family:"LXGW WenKai","KaiTi",cursive}.rc-notebook-lines>div{display:flex;overflow:hidden;min-width:0;align-items:flex-end;border-bottom:.24cqw solid #29231d;padding:0 2.2cqw 1.18cqw;transform-origin:left bottom}.rc-notebook-lines>div:nth-child(2){transform:rotate(-.35deg)}.rc-notebook-lines>div:nth-child(3){transform:rotate(.22deg)}.rc-notebook-lines>div:nth-child(4){transform:rotate(-.18deg)}.rc-notebook-lines>div:nth-child(5){transform:rotate(.28deg)}.rc-notebook-lines span{display:block;max-width:100%;overflow:hidden;color:#17130f;font-size:clamp(12px, calc(4.65cqw * var(--fit-scale, 1)), 37px);font-weight:500;line-height:1.02;letter-spacing:.035em;text-overflow:ellipsis;text-shadow:.02em .02em 0 rgba(20,15,10,.14);white-space:nowrap}.rc-notebook-lines .big{align-items:center}.rc-notebook-lines .big span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:clamp(16px, calc(6.4cqw * var(--fit-scale, 1)), 51px);font-weight:500;line-height:1.14;white-space:normal}
  .rc-experience{position:relative;display:flex;overflow:hidden;height:100%;flex-direction:column;padding:6.2cqw 6.4cqw;background:#fff;color:#161616;font-family:"PingFang SC","Microsoft YaHei",sans-serif}.rc-rule{flex:0 0 auto;height:.18cqw;margin-top:8cqw;background:#aaa}.rc-experience h1{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:0 0 auto;margin-top:5.4cqw;color:#161616;font-size:var(--exp-title,8.2cqw);font-weight:950;line-height:1.22;overflow-wrap:anywhere;word-break:normal;text-decoration:underline;text-decoration-thickness:.35cqw;text-underline-offset:1.1cqw}.rc-experience-lead{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:0 0 auto;margin-top:8.5cqw;color:#242424;font-size:4.25cqw;font-weight:500;line-height:1.6;overflow-wrap:anywhere;word-break:normal}.rc-experience-body{display:flex;overflow:hidden;flex:1 1 auto;flex-direction:column;justify-content:space-between;min-height:0;color:#171717}.rc-experience-paragraph{overflow:hidden;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;flex-shrink:0;margin-top:calc(5cqw * var(--fit-scale, 1))!important;color:#171717;font-size:clamp(12px, calc(4.5cqw * var(--fit-scale, 1)), 36px);line-height:1.68;overflow-wrap:anywhere!important;word-break:normal!important}
  .rc-document{padding:6.5% 7% 4.5%;background:#fff;color:#111;font-family:Arial,"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-doc-frame{position:relative;overflow:hidden;display:flex;height:100%;flex-direction:column;padding:0 7cqw 5.5cqw;border:.35cqw solid #111}.rc-doc-frame:before,.rc-doc-frame:after{content:"";position:absolute;top:-.35cqw;width:5.5cqw;height:3.2cqw;border-top:.9cqw solid #111}.rc-doc-frame:before{left:-.35cqw;border-left:.9cqw solid #111}.rc-doc-frame:after{right:-.35cqw;border-right:.9cqw solid #111}.rc-doc-frame h1{overflow:visible;margin-top:-1.1cqw;padding:.4cqw 1.7cqw 0;background:#fff;color:#cf2137;text-align:center;font-family:"Source Han Serif SC Heavy","Noto Sans SC",sans-serif;font-size:5.65cqw;font-weight:900;line-height:1.08;text-overflow:ellipsis;white-space:nowrap}.rc-doc-subject{margin-top:5.4cqw;font-size:4.2cqw;font-weight:900;line-height:1.12;text-transform:uppercase}.rc-doc-meta{display:flex;width:max-content;margin-top:3.6cqw;border:1px solid #e5e5e5;color:#777;font-size:1.85cqw}.rc-doc-meta span,.rc-doc-meta b{padding:.55cqw .8cqw}.rc-doc-meta b{border-left:1px solid #e5e5e5;color:#333}.rc-doc-content{display:flex;overflow:hidden;flex:1 1 auto;flex-direction:column;justify-content:space-between;min-height:0;margin-top:2.4cqw}.rc-doc-content section{overflow:hidden;flex-shrink:0;margin-top:calc(1.4cqw * var(--fit-scale, 1))}.rc-doc-content h2{overflow:hidden;font-size:clamp(9px, calc(2.5cqw * var(--fit-scale, 1)), 20px);font-weight:900;white-space:nowrap}.rc-doc-content p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;margin-top:calc(.5cqw * var(--fit-scale, 1))!important;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:clamp(9px, calc(3.1cqw * var(--fit-scale, 1)), 25px);font-weight:450;line-height:1.34}.rc-doc-content p span{display:inline}.rc-doc-content .fr{font-family:Arial,Georgia,sans-serif}.rc-doc-frame footer{position:relative;flex:0 0 auto;display:flex;justify-content:space-between;margin-top:.9cqw;border-top:.12cqw solid #ddd;padding-top:.9cqw;color:#777;font-size:1.35cqw}
  .rc-vocab{display:flex;flex-direction:column;justify-content:space-between;padding:3.5cqw 2.5cqw;background:#f8fbfd}.rc-vocab>img{opacity:.35}.rc-table,.rc-vocab-hook{position:relative}.rc-table{display:flex;height:38%;flex-direction:column}.rc-table>div{display:grid;grid-template-columns:.8fr 1.25fr 1fr .8fr;flex:1;overflow:hidden;min-height:0;border-bottom:.12cqw solid #7c9bb1}.rc-table span{display:-webkit-box;overflow:hidden;align-items:center;padding:0 .5cqw;border-right:.12cqw solid #7c9bb1;font-size:var(--vocab-row,1.62cqw);-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}.rc-vocab-hook{text-align:center}.rc-vocab-hook b{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:7.2cqw;-webkit-text-stroke:.8cqw #fff;paint-order:stroke fill;white-space:normal}.rc-vocab-hook span{display:inline-block;overflow:hidden;padding:.5cqw 1.2cqw;background:#234f6d;color:#fff;font-size:2.3cqw}
  .rc-roadmap{padding:4cqw;background:#eaf4ff;color:#174e87;font-family:"Microsoft YaHei",sans-serif}.rc-roadmap header{text-align:center}.rc-roadmap header h1{overflow:hidden;font-size:6.2cqw;white-space:nowrap}.rc-roadmap header p{overflow:hidden;font-size:2.5cqw;white-space:nowrap}.rc-roadmap-grid{display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:2.5cqw;height:78%;margin-top:4cqw}.rc-roadmap-grid section{position:relative;display:flex;overflow:hidden;flex-direction:column;min-height:0;padding:5cqw 2.5cqw 2cqw;border:.3cqw solid #2668a6;border-radius:1.3cqw;background:#fff}.rc-roadmap-grid strong{position:absolute;top:-2.3cqw;right:2cqw;color:#9bc5e8;font-size:6cqw}.rc-roadmap-grid h2{overflow:hidden;flex:0 0 auto;font-size:3.2cqw;white-space:nowrap;text-overflow:ellipsis}.rc-roadmap-grid p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:0 0 auto;margin-top:2cqw;font-size:var(--roadmap-body,2.45cqw);line-height:1.3;white-space:normal}
  .rc-collocation{padding:4cqw 2.2cqw 2.5cqw;background:#fff;color:#203220}.rc-collocation>h1{text-align:center;color:#2e5a2e;font-size:6.4cqw}.rc-collocation-sub{text-align:center;color:#5c963e;font-size:2.65cqw}.rc-collocation-cols{display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;gap:2cqw;height:84%;margin-top:2cqw;overflow:hidden}.rc-collocation-cols>div{display:flex;flex-direction:column;justify-content:space-between;gap:1.5cqw;min-height:0}.rc-collocation section{display:flex;flex-shrink:0;flex-direction:column;justify-content:flex-start}.rc-collocation h2{overflow:hidden;flex:0 0 auto;padding:calc(.6cqw * var(--fit-scale, 1));background:#57933d;color:#fff;text-align:center;font-size:clamp(9px, calc(2.7cqw * var(--fit-scale, 1)), 21px);white-space:nowrap;text-overflow:ellipsis}.rc-collocation section p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:0 0 auto;border-bottom:.1cqw solid #d9e6d1;font-family:"FangSong",serif;font-size:clamp(8.5px, calc(2.3cqw * var(--fit-scale, 1)), 18px);line-height:1.14;white-space:normal}.rc-collocation section b{font-weight:700}.rc-collocation section span{margin-left:.4cqw;color:#4a684a}
  .rc-memo>h1{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#181818;font-size:clamp(54px,11.5cqw,96px);line-height:1.02;white-space:normal;overflow-wrap:anywhere}.rc-memo-sections{margin-top:3.1cqw}.rc-memo-sections p{line-height:1.34}
  .rc-doc-frame{padding:0 6cqw 5.2cqw}.rc-doc-frame h1{font-size:5.35cqw}.rc-doc-subject{margin-top:4.4cqw;font-size:4.35cqw}.rc-doc-meta{margin-top:2.8cqw}.rc-doc-content{margin-top:2cqw}.rc-doc-content p{line-height:1.33}.rc-doc-content p span{margin-bottom:.3cqw}
  .rc-collocation{padding:3.2cqw 2.2cqw 2.2cqw}.rc-collocation>h1{font-size:6.1cqw;line-height:1.05}.rc-collocation-sub{font-size:2.35cqw}.rc-collocation-cols{gap:1.25cqw;height:85.5%;margin-top:1.5cqw}.rc-collocation-cols>div{gap:.9cqw}.rc-collocation h2{line-height:1.05}.rc-collocation section p{line-height:1.15}
`}</style> }
