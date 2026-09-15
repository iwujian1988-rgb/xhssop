'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { CreativeCardRenderer, DenseDirectoryCoverPayload, DenseDirectorySection } from '@/types/reference-workflow';
import { coverDisplayBlocks, getCoverTemplateSpec } from '@/lib/cover-template-specs';
import CoverDisplayFrame from './CoverDisplayFrame';
import ParchmentDenseCover from './ParchmentDenseCover';
import WhiteGreenDirectoryCover from './WhiteGreenDirectoryCover';
import PurpleDirectoryCover from './PurpleDirectoryCover';
import { useAutoFitScale } from './useAutoFitScale';
import UserProvidedCoverRenderer from './UserProvidedCoverRenderer';

function sectionsFingerprint(payload: DenseDirectoryCoverPayload) {
  return payload.sections.map(s => `${s.heading}:${s.items.length}:${s.items.map(i => `${i.primary}${i.secondary || ''}`).join(',')}`).join('|');
}

interface Props { renderer: CreativeCardRenderer; payload: DenseDirectoryCoverPayload; className?: string; referenceImage?: string; skinId?: string | null; previewMode?: 'production' | 'code' }

export default function ReferenceCoverRenderer({ renderer, payload, className = '', referenceImage, skinId, previewMode = 'production' }: Props) {
  const display = {...payload,sections:coverDisplayBlocks(renderer,payload.sections)};
  return <CoverDisplayFrame renderer={renderer} title={payload.title} sourceCount={payload.sections.reduce((n,s)=>n+s.items.length,0)} displayCount={display.sections.reduce((n,s)=>n+s.items.length,0)}>
    <CoverRendererContent renderer={renderer} payload={display} className={className} referenceImage={referenceImage} skinId={skinId} previewMode={previewMode} />
  </CoverDisplayFrame>;
}

function CoverRendererContent({ renderer, payload, className = '', referenceImage, skinId, previewMode = 'production' }: Props) {
  const spec = getCoverTemplateSpec(renderer);
  if (isUserProvidedRenderer(renderer)) {
    return <UserProvidedCoverRenderer renderer={renderer} payload={payload} className={className} />;
  }
  if (renderer === 'showcase_screenshot') {
    return <ShowcaseScreenshotCover payload={payload} className={className} referenceImage={referenceImage} />;
  }
  if (renderer === 'dazibao_html') return <DazibaoHtmlCover payload={payload} className={className} />;
  if (spec?.renderMode === 'image_to_image' && previewMode !== 'code') {
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
  const skinClassName = `${className} cover-skin--${skinId || 'default'}`;
  let cover: ReactNode;
  if (renderer === 'parchment_dense_directory') cover = <ParchmentDenseCover payload={payload} className={skinClassName} />;
  else if (renderer === 'white_green_directory') cover = <WhiteGreenDirectoryCover payload={payload} className={skinClassName} />;
  else if (renderer === 'clean_purple_directory') cover = <PurpleDirectoryCover payload={payload} variant="clean" className={skinClassName} />;
  else if (renderer === 'grid_purple_directory') cover = <PurpleDirectoryCover payload={payload} variant="grid" className={skinClassName} />;
  else if (renderer === 'blackboard_phrase') cover = <BlackboardPhrase payload={payload} className={skinClassName} />;
  else if (renderer === 'blackboard_offer') cover = <BlackboardOffer payload={payload} className={skinClassName} />;
  else if (renderer === 'notebook_big_words') cover = <NotebookPain payload={payload} className={skinClassName} />;
  else cover = null;
  if (cover) return <div className="cover-skin-host">{cover}<CoverSkinStyles /></div>;
  if (renderer === 'memo_offer') return <MemoOffer payload={payload} className={className} />;
  if (renderer === 'word_flashcard') return <WordFlashcard payload={payload} className={className} />;
  if (renderer === 'book_cover') return <BookCover payload={payload} className={className} />;
  if (renderer === 'plain_experience') return <PlainExperience payload={payload} className={className} />;
  if (renderer === 'document_analysis') return <DocumentAnalysis payload={payload} className={className} />;
  if (renderer === 'vocab_table') return <VocabTable payload={payload} className={className} />;
  if (renderer === 'course_roadmap') return <CourseRoadmap payload={payload} className={className} />;
  if (renderer === 'collocation_dense') return <CollocationDense payload={payload} className={className} />;
  if (renderer === 'official_notice') return <OfficialNotice payload={payload} className={className} />;
  if (renderer === 'pain_quote_big') return <PainQuote payload={payload} className={className} />;
  return <ParchmentDenseCover payload={payload} className={className} />;
}

function DazibaoHtmlCover({ payload, className = '' }: { payload: DenseDirectoryCoverPayload; className?: string }) {
  const title = payload.title || '普通内容笔记';
  const subtitle = payload.subtitle || '';
  const badge = /避坑|无用功|不要|别再|反速成/i.test(title) ? '先看这一篇' : '备考笔记';
  return <article className={`dazibao-html ${className}`} aria-label={title}>
    <span className="dazibao-html__badge">{badge}</span><h1>{title}</h1>{subtitle ? <p>{subtitle}</p> : null}
    <i className="dazibao-html__mark" aria-hidden="true" /><style>{`.dazibao-html{position:relative;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;aspect-ratio:3/4;overflow:hidden;padding:11% 9%;background:#f5efe5;color:#171717;font-family:"PingFang SC","Microsoft YaHei",sans-serif}.dazibao-html:before{content:"";position:absolute;inset:4%;border:2px solid #171717;pointer-events:none}.dazibao-html h1{position:relative;z-index:1;max-width:100%;margin:0;font-size:clamp(34px,10cqw,112px);font-weight:950;line-height:1.08;letter-spacing:-.04em;overflow-wrap:anywhere;word-break:break-word}.dazibao-html p{position:relative;z-index:1;margin:5% 0 0;color:#555;font-size:clamp(16px,3.8cqw,40px);font-weight:700;line-height:1.25;overflow-wrap:anywhere}.dazibao-html__badge{position:absolute;top:9%;left:9%;z-index:2;padding:1.8% 3%;background:#e94d35;color:#fff;font-size:clamp(12px,2.8cqw,30px);font-weight:900;transform:rotate(-2deg)}.dazibao-html__mark{position:absolute;right:8%;bottom:9%;width:20%;height:2.2%;background:#f5c542;transform:rotate(-3deg)}`}</style>
  </article>;
}

function isUserProvidedRenderer(renderer: CreativeCardRenderer): renderer is Extract<CreativeCardRenderer,
  | 'ielts_speaking_toc'
  | 'criminal_law_formula'
  | 'english_grammar_grid'
  | 'french_gender_vocab'
  | 'mao_article_notes'
  | 'english_grammar_notebook'
  | 'french_oral_question_bank'
  | 'french_a1_practice_sheet'
  | 'sat_vocab_dictionary'
  | 'ielts_task1_four_part'> {
  return new Set<CreativeCardRenderer>([
    'ielts_speaking_toc', 'criminal_law_formula', 'english_grammar_grid', 'french_gender_vocab',
    'mao_article_notes', 'english_grammar_notebook', 'french_oral_question_bank',
    'french_a1_practice_sheet', 'sat_vocab_dictionary', 'ielts_task1_four_part',
  ]).has(renderer);
}

function ShowcaseScreenshotCover({ payload, className, referenceImage }: CoverProps & { referenceImage?: string }) {
  const variant = showcaseVariant(`${payload.title}|${payload.subtitle}`);
  return <article className={`showcase-screenshot-cover showcase-screenshot-cover--${variant} ${className}`} aria-label={payload.title}>
    {referenceImage ? <img src={referenceImage} alt="商品资料截图" /> : null}
    <div className="showcase-screenshot-cover__veil" />
    <div className="showcase-screenshot-cover__copy">
      <h1>{payload.title}</h1>
      {payload.subtitle ? <p>{payload.subtitle}</p> : null}
    </div>
    <style>{`.showcase-screenshot-cover{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;background:#ddd;container-type:inline-size;box-shadow:0 20px 48px rgba(0,0,0,.18)}.showcase-screenshot-cover>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.showcase-screenshot-cover__veil{position:absolute;inset:0;background:linear-gradient(180deg,transparent 38%,rgba(0,0,0,.12) 100%)}.showcase-screenshot-cover__copy{position:absolute;top:50%;right:3%;left:3%;transform:translateY(-50%);text-align:center}.showcase-screenshot-cover h1{position:relative;margin:0 auto;max-width:96%;font-family:"Arial Black","Noto Sans SC","Microsoft YaHei",sans-serif;font-size:clamp(30px,10.2cqw,82px);font-weight:950;line-height:.98;letter-spacing:-.025em;text-wrap:balance;overflow-wrap:anywhere;color:#ffd51b;-webkit-text-stroke:.34cqw #111;paint-order:stroke fill;text-shadow:0 5px 10px rgba(0,0,0,.42)}.showcase-screenshot-cover p{position:relative;margin:2.5cqw auto 0;max-width:86%;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:clamp(13px,3.5cqw,28px);font-weight:900;line-height:1.1;color:#fff;-webkit-text-stroke:.11cqw #111;paint-order:stroke fill;text-shadow:0 2px 4px rgba(0,0,0,.55)}.showcase-screenshot-cover--highlight h1{font-family:"Arial Black","Noto Sans SC","Microsoft YaHei",sans-serif;color:#ffd51b;-webkit-text-stroke:.42cqw #111}.showcase-screenshot-cover--white h1{font-family:"Arial Black","Noto Sans SC","Microsoft YaHei",sans-serif;color:#fff;-webkit-text-stroke:.38cqw #111}.showcase-screenshot-cover--white .showcase-screenshot-cover__veil{background:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.3) 100%)}.showcase-screenshot-cover--paper .showcase-screenshot-cover__copy{right:5%;left:5%;padding:2.4cqw 1.5cqw;background:rgba(255,255,255,.88);transform:translateY(-50%) rotate(-1deg)}.showcase-screenshot-cover--paper h1{font-family:"Source Han Serif SC Heavy","Noto Serif SC","Songti SC",serif;color:#111;-webkit-text-stroke:.12cqw #fff;text-shadow:1px 2px 0 rgba(255,255,255,.85)}.showcase-screenshot-cover--paper p{font-family:"Source Han Serif SC","Noto Serif SC","Songti SC",serif;color:#222;-webkit-text-stroke:0;text-shadow:none}.showcase-screenshot-cover--ink .showcase-screenshot-cover__copy{padding:2cqw 1cqw;background:rgba(255,255,255,.9)}.showcase-screenshot-cover--ink h1{font-family:"STXinwei","FZShuTi","LXGW WenKai","KaiTi",cursive;color:#111;-webkit-text-stroke:.08cqw #fff;text-shadow:1px 2px 0 rgba(255,255,255,.9)}.showcase-screenshot-cover--ink p{font-family:"LXGW WenKai","KaiTi",cursive;color:#111;-webkit-text-stroke:0;text-shadow:none}.showcase-screenshot-cover--underline h1{font-family:"Source Han Sans CN Heavy","Noto Sans SC","Microsoft YaHei",sans-serif;color:#fff;-webkit-text-stroke:.3cqw #111;text-decoration:underline;text-decoration-color:#f5d63d;text-decoration-thickness:1cqw;text-underline-offset:1.2cqw}.showcase-screenshot-cover--underline p{font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}`}</style>
  </article>;
}

function showcaseVariant(value: string): 'highlight' | 'ink' | 'paper' | 'underline' | 'white' {
  let hash = 2166136261;
  for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (['highlight', 'ink', 'paper', 'underline', 'white'] as const)[(hash >>> 0) % 5];
}

function CoverSkinStyles() { return <style>{`
  .cover-skin-host{width:100%}
  .cover-skin--parchment-cream .parchment-dense-texture{filter:sepia(.08) saturate(.62) brightness(1.12)}
  .cover-skin--parchment-sage .parchment-dense-texture{filter:sepia(.12) saturate(.55) hue-rotate(45deg) brightness(.98)}
  .cover-skin--parchment-rose .parchment-dense-texture{filter:sepia(.2) saturate(.78) hue-rotate(330deg) brightness(.98)}
  .cover-skin--board-charcoal>img{filter:grayscale(.82) brightness(.78) contrast(1.05)}
  .cover-skin--board-teal>img{filter:hue-rotate(32deg) saturate(.72) brightness(.92)}
  .cover-skin--board-navy>img{filter:hue-rotate(82deg) saturate(.62) brightness(.82)}
  .cover-skin--notebook-warm>img{filter:sepia(.24) saturate(.82) brightness(.96)}
  .cover-skin--notebook-gray>img{filter:grayscale(.5) saturate(.45) brightness(1.04)}
  .cover-skin--notebook-sage>img{filter:sepia(.12) saturate(.52) hue-rotate(48deg) brightness(1.01)}
  .cover-skin--paper-warm.white-green-directory{--paper-base:#f8f0df;--paper-mid:#eee2ca}
  .cover-skin--paper-cool.white-green-directory{--paper-base:#f0f5f3;--paper-mid:#e2ece9}
  .cover-skin--paper-recycled.white-green-directory{--paper-base:#e7e1d0;--paper-mid:#dcd4bd}
  .cover-skin--paper-warm.clean-purple-directory,.cover-skin--paper-warm.grid-purple-sheet{background-color:#f1ead9!important}
  .cover-skin--paper-cool.clean-purple-directory,.cover-skin--paper-cool.grid-purple-sheet{background-color:#edf2f1!important}
  .cover-skin--paper-recycled.clean-purple-directory,.cover-skin--paper-recycled.grid-purple-sheet{background-color:#e2decb!important}
`}</style> }

function Frame({ className, label, children, style }: { className: string; label: string; children: ReactNode; style?: CSSProperties }) {
  return <article className={`reference-cover ${className}`} style={style} aria-label={label}>{children}<BaseStyles /></article>;
}

function BlackboardPhrase({ payload, className }: CoverProps) {
  const itemCount = payload.sections.reduce((sum, section) => sum + section.items.length, 0);
  const averageLength = payload.sections.flatMap(section => section.items).reduce((sum, item, _, items) => sum + `${item.primary}${item.secondary || ''}`.length / Math.max(items.length, 1), 0);
  const bodySize = itemCount > 18 || averageLength > 22 ? '3cqw' : itemCount > 15 ? '3.3cqw' : '3.65cqw';
  const titleSize = payload.title.length > 16 ? '7.55cqw' : '8.45cqw';
  return <Frame className={`rc-blackboard ${className}`} label={payload.title} style={{ '--chalk-body': bodySize, '--chalk-title': titleSize } as CSSProperties}>
    <img src="/generated/chalkboard_phrase_master_clean_01.png" alt="" /><header><h1>{payload.title}</h1><p>{payload.subtitle}</p></header>
    <div className="rc-chalk-groups">{payload.sections.map((s, i) => <section key={i}><h2>{s.heading}</h2><div>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b><span>{x.secondary}</span></p>)}</div></section>)}</div>
  </Frame>;
}

function BlackboardOffer({ payload, className }: CoverProps) {
  const titleSize = payload.title.length > 18 ? '7.3cqw' : payload.title.length > 13 ? '7.95cqw' : '8.8cqw';
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.62, max: 1, step: 0.025 });
  return <Frame className={`rc-blackboard rc-offer ${className}`} label={payload.title} style={{ '--offer-title': titleSize } as CSSProperties}>
    <img src="/generated/chalkboard_phrase_master_clean_01.png" alt="" /><header><h1>{payload.title}</h1><p>{payload.subtitle}</p></header>
    <div className="rc-offer-groups" ref={fitRef}>{payload.sections.map((s,i)=><section key={i}><h2>{s.heading}</h2>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b>{x.secondary ? `：${x.secondary}` : ''}</p>)}</section>)}</div>
  </Frame>;
}

function MemoOffer({ payload, className }: CoverProps) {
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.55, max: 1, step: 0.025 });
  const titleLength = visualLength(payload.title);
  const titleSize = titleLength > 30 ? '7.2cqw' : titleLength > 24 ? '8.1cqw' : titleLength > 18 ? '9cqw' : '10.2cqw';
  return <Frame className={`rc-memo ${className}`} label={payload.title} style={{ '--memo-title': titleSize } as CSSProperties}><div className="rc-memo-status"><b>9:41</b><span>● ◒ ▰</span></div><div className="rc-memo-bar"><span>‹　备忘录</span><span className="rc-memo-actions">⌕　＋　☷</span></div><h1>{payload.title}</h1><p className="rc-subtitle">{payload.subtitle}</p><div className="rc-memo-sections" ref={fitRef}>{payload.sections.map((s,i)=><section key={i}><h2>{s.heading}</h2>{s.items.map((x,j)=><p key={j}><b>{x.primary}</b>{x.secondary ? `：${x.secondary}` : ''}</p>)}</section>)}</div></Frame>;
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
  // This is a big-word ruled-paper cover. Tiny browser rounding differences
  // must not shrink the whole composition to half size.
  const fitRef = useAutoFitScale<HTMLDivElement>([lines.join('|')], { min: 0.86, max: 1, step: 0.02 });
  return <Frame className={`rc-notebook ${className}`} label={payload.title}><img src="/generated/notebook_paper_master_clean_02.png" alt=""/><div className="rc-notebook-lines" ref={fitRef}>{lines.map((line,i)=><div className={i===1?'big':''} key={i}><span>{line}</span></div>)}</div></Frame>;
}

function PlainExperience({ payload, className }: CoverProps) {
  const paragraphs = payload.sections.flatMap(section => section.items)
    .map(item => `${item.primary}${item.secondary ? `，${item.secondary}` : ''}`)
    .filter(Boolean)
    .slice(0, 4);
  const titleLength = visualLength(payload.title);
  const titleSize = titleLength > 30 ? '9.2cqw' : titleLength > 22 ? '10.2cqw' : '11.2cqw';
  const fitRef = useAutoFitScale<HTMLDivElement>([paragraphs.join('|')], { min: 0.5, max: 1, step: 0.025 });
  return <Frame className={`rc-experience ${className}`} label={payload.title} style={{ '--exp-title': titleSize } as CSSProperties}>
    <div className="rc-experience-kicker">EXAM NOTE</div>
    <h1>{payload.title}</h1>
    <p className="rc-experience-lead">{payload.subtitle}</p>
    <div className="rc-experience-body" ref={fitRef}>{paragraphs.map((paragraph,index)=><div className="rc-experience-point" key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{paragraph.replace(/[。]+$/u, '')}。</p></div>)}</div>
  </Frame>;
}

function DocumentAnalysis({ payload, className }: CoverProps) {
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.5, max: 1, step: 0.025 });
  return <Frame className={`rc-document ${className}`} label={payload.title}><div className="rc-doc-frame"><h1>{payload.title}</h1><div className="rc-doc-subject">{payload.subtitle}</div><div className="rc-doc-meta"><span>≡　编号</span><b>范例 01</b></div><div className="rc-doc-content" ref={fitRef}>{payload.sections.map((s,i)=><section key={i}><h2>{i === 0 ? '题目' : s.heading}</h2>{s.items.map((x,j)=><p key={j}><span className={/[A-Za-zÀ-ÿ]{8}/.test(x.primary)?'fr':''}>{x.primary}</span>{x.secondary ? `　${x.secondary}` : ''}</p>)}</section>)}</div><footer>{payload.subtitle} · {payload.productIdentity || '法语写作素材页'} <span>1</span></footer></div></Frame>;
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

function OfficialNotice({ payload, className }: CoverProps) {
  const notices = payload.sections.flatMap(section => section.items)
    .map(item => `${item.primary}${item.secondary ? `：${item.secondary}` : ''}`)
    .filter(Boolean)
    .slice(0, 3);
  const fitRef = useAutoFitScale<HTMLDivElement>([payload.title, payload.subtitle, notices.join('|')], { min: 0.72, max: 1, step: 0.025 });
  return <Frame className={`rc-notice ${className}`} label={payload.title}>
    <div className="rc-notice-label">备考通知</div>
    <h1>{payload.title}</h1>
    {payload.subtitle ? <p className="rc-notice-sub">{payload.subtitle}</p> : null}
    <div className="rc-notice-body" ref={fitRef}>{notices.map((notice, index) => <p key={index}><b>{String(index + 1).padStart(2, '0')}</b><span>{notice}</span></p>)}</div>
    <div className="rc-notice-stamp">备考<br/>专用</div>
  </Frame>;
}

function PainQuote({ payload, className }: CoverProps) {
  const parts = splitPainTitle(payload.title);
  const titleLength = visualLength(payload.title);
  const titleSize = titleLength > 22 ? '12.6cqw' : titleLength > 16 ? '14.2cqw' : '17cqw';
  return <Frame className={`rc-pain-quote ${className}`} label={payload.title} style={{ '--pain-title': titleSize } as CSSProperties}>
    <div className="rc-pain-quote-kicker">EXAM NOTE</div>
    <h1>{parts.map((part, index) => part.highlight ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</h1>
    {payload.subtitle ? <p>{payload.subtitle}</p> : null}
    <div className="rc-pain-wave" />
  </Frame>;
}

function splitExamKeyword(value: string) {
  const match = value.match(/DELF\s*B2(?:写作|口语)?|TCF(?:\s*Canada)?(?:写作|听力)?|TEF(?:\s*Canada)?(?:写作|听力)?|法语B2(?:写作|口语)?/i);
  if (!match || match.index === undefined) return [{ text: value, highlight: false }];
  const start = match.index;
  const end = start + match[0].length;
  return [
    { text: value.slice(0, start), highlight: false },
    { text: value.slice(start, end), highlight: true },
    { text: value.slice(end), highlight: false },
  ].filter(part => part.text);
}

function splitPainTitle(value: string) {
  return splitExamKeyword(value).flatMap(part => {
    if (part.highlight) return [part];
    const tokens = Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(part.text), item => item.segment)
      .flatMap(token => {
        const units = Array.from(token);
        if (units.length <= 6) return [token];
        const chunks: string[] = [];
        let offset = 0;
        while (units.length - offset > 6) {
          const remaining = units.length - offset;
          const size = remaining - 6 === 1 ? 5 : 6;
          chunks.push(units.slice(offset, offset + size).join(''));
          offset += size;
        }
        chunks.push(units.slice(offset).join(''));
        return chunks;
      });
    const lines: Array<{ text: string; highlight: boolean }> = [];
    for (const token of tokens) {
      if (!token) continue;
      const previous = lines[lines.length - 1];
      const punctuation = /^[，。！？、；：,.!?]+$/u.test(token);
      const particle = /^[着了过的地得吗呢吧啊呀]+$/u.test(token);
      if (previous && punctuation) {
        previous.text += token;
      } else if (previous && particle && Array.from(`${previous.text}${token}`).length > 6) {
        const previousUnits = Array.from(previous.text);
        const stem = previousUnits.pop() || '';
        previous.text = previousUnits.join('');
        lines.push({ text: `${stem}${token}`, highlight: false });
      } else if (previous && (particle || Array.from(`${previous.text}${token}`).length <= 6)) {
        previous.text += token;
      } else {
        lines.push({ text: token, highlight: false });
      }
    }
    return lines;
  });
}

type CoverProps={payload:DenseDirectoryCoverPayload;className?:string};

function visualLength(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
}

function BaseStyles() { return <style>{`
  .reference-cover{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;background:#fff;container-type:inline-size;box-shadow:0 20px 48px rgba(0,0,0,.18);letter-spacing:0}.reference-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.reference-cover h1,.reference-cover h2,.reference-cover p{margin:0}.reference-cover *{box-sizing:border-box;min-width:0;overflow-wrap:normal;word-break:keep-all;hyphens:none}
  .rc-blackboard{color:#fff;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-blackboard:after{content:"";position:absolute;inset:0;background:rgba(0,35,20,.12)}.rc-blackboard header,.rc-chalk-groups,.rc-offer-groups{position:relative;z-index:1}.rc-blackboard header{padding:4.1cqw 4.8cqw 1.15cqw;text-align:center}.rc-blackboard header h1{font-family:"STXinwei","FZShuTi",serif;font-size:var(--chalk-title);font-weight:500;line-height:1.03}.rc-blackboard header p{margin-top:1cqw;color:#ffd84a;font-size:3.25cqw;font-weight:850}.rc-chalk-groups{display:grid;grid-template-columns:repeat(2,1fr);gap:3.4cqw;height:78.5%;padding:1.45cqw 4.9cqw 2.7cqw}.rc-chalk-groups section{display:flex;min-height:0;flex-direction:column}.rc-chalk-groups h2{display:inline-block;align-self:flex-start;margin-bottom:.85cqw;border-bottom:.45cqw solid #f7c52e;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:3.85cqw;line-height:1.03}.rc-chalk-groups section>div{display:flex;min-height:0;flex:1;flex-direction:column;justify-content:space-evenly}.rc-chalk-groups p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;padding:.32cqw 0;border-bottom:.12cqw dashed rgba(255,255,255,.3);font-size:var(--chalk-body);line-height:1.08;white-space:normal}.rc-chalk-groups b{font-family:Georgia,"Noto Serif SC",serif}.rc-chalk-groups span{margin-left:.5cqw;color:#f4e8bc;font-size:.88em}.rc-offer header{padding-bottom:.6cqw}.rc-offer header h1{font-size:var(--offer-title)}.rc-offer-groups{display:flex;flex-direction:column;justify-content:space-between;height:72.5%;padding:.55cqw 6.4cqw 2.7cqw;overflow:hidden}.rc-offer-groups section{display:flex;flex-shrink:0;flex-direction:column;justify-content:flex-start;padding-bottom:.35cqw;border-bottom:.16cqw dashed rgba(255,255,255,.34)}.rc-offer-groups h2{align-self:flex-start;padding:.45cqw 1.15cqw;background:#f1c735;color:#173c2c;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:clamp(15px, calc(3.75cqw * var(--fit-scale, 1)), 31px);line-height:1.08}.rc-offer-groups p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:calc(.75cqw * var(--fit-scale, 1));font-size:clamp(13px, calc(3.48cqw * var(--fit-scale, 1)), 29px);font-weight:650;line-height:1.18;white-space:normal}.rc-offer-groups p b{color:#fff;font-weight:900}
  .rc-memo{display:flex;flex-direction:column;height:auto;padding:1.8% 4.2% 4%;background:#fff;color:#171717;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-memo-status{flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 .4cqw;color:#111;font-size:2.75cqw;font-weight:800}.rc-memo-bar{flex:none;display:flex;align-items:center;justify-content:space-between;margin-top:1.9cqw;color:#c4a800;font-size:4.65cqw;font-weight:650;line-height:1}.rc-memo-actions{font-family:Arial,"Noto Sans SC",sans-serif;font-size:4.35cqw;letter-spacing:.08em}.rc-memo>h1{flex:none;margin-top:3.6cqw;text-align:center;font-size:7.65cqw;font-weight:900;line-height:1.06}.rc-subtitle{flex:none;margin-top:1.2cqw;text-align:center;color:#6b6b6b;font-size:3.35cqw;font-weight:600}.rc-memo-sections{flex:1 1 auto;min-height:0;overflow:hidden;margin-top:5cqw}.rc-memo-sections section{margin-bottom:calc(4.1cqw * var(--fit-scale, 1))}.rc-memo-sections h2{display:inline-block;padding:.35cqw .85cqw;background:#ffdc62;font-size:clamp(14px, calc(4.55cqw * var(--fit-scale, 1)), 34px);font-weight:900;line-height:1.12}.rc-memo-sections p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;margin-top:calc(1.15cqw * var(--fit-scale, 1));font-size:clamp(11px, calc(3.95cqw * var(--fit-scale, 1)), 30px);font-weight:500;line-height:1.42;white-space:normal}.rc-memo-sections b{font-weight:850}
  .rc-flashcard{background:#d9bd8e}.rc-flashcard:after{content:"";position:absolute;z-index:1;top:14.2%;right:4%;left:4%;height:.22cqw;background:#55483d}.rc-flashcard>h1{position:absolute;z-index:2;top:4.8%;left:4%;right:4%;color:#18130e;text-align:center;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:5.65cqw;font-weight:900;line-height:1.1}.rc-word-grid{position:absolute;z-index:2;top:18%;right:5%;bottom:5%;left:5%;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);column-gap:2cqw;overflow:hidden}.rc-word-grid div{display:flex;position:relative;overflow:hidden;flex-direction:column;align-items:center;justify-content:center;text-align:center}.rc-word-grid div.featured:before{content:"";position:absolute;inset:11% 4%;border:.32cqw dashed #d33124;border-radius:1.2cqw}.rc-word-grid strong{display:block;position:relative;max-width:100%;overflow:hidden;font-family:Georgia,"Noto Sans SC",sans-serif;font-size:clamp(14px, calc(6.25cqw * var(--fit-scale, 1)), 50px);font-weight:500;line-height:1.05;text-overflow:ellipsis;white-space:nowrap}.rc-word-grid span{display:block;position:relative;margin-top:calc(1.05cqw * var(--fit-scale, 1));color:#a32019;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:clamp(9px, calc(3.05cqw * var(--fit-scale, 1)), 24px);font-weight:900}.rc-word-grid em{position:relative;margin-top:calc(.65cqw * var(--fit-scale, 1));overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;color:#211a15;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:clamp(8px, calc(2.55cqw * var(--fit-scale, 1)), 20px);font-style:normal}
  .rc-book{font-family:"Arial",sans-serif;background:linear-gradient(#fff 0 49%,#4a9b8a 49%)}.rc-book-top{display:flex;height:13cqw;align-items:center;justify-content:space-between;background:#4a9b8a;color:#fff;font-size:4cqw;font-weight:900}.rc-book-top b{display:flex;height:100%;align-items:center;padding:0 5cqw;background:#b91435;font-size:7cqw}.rc-book-top span{padding-right:5cqw}.rc-book-main{padding:7cqw 8cqw 5cqw}.rc-book-main small{color:#225f7e;font-weight:900}.rc-book-main h1{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;margin-top:2cqw;color:#216384;font-size:var(--book-title,7cqw);line-height:1.15;white-space:normal}.rc-book-main p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:3cqw;color:#4a9b8a;font-size:2.7cqw;font-weight:800;white-space:normal}.rc-book-bottom{position:relative;display:grid;grid-template-columns:repeat(2,1fr);gap:5cqw 4cqw;padding:9cqw 8cqw;color:#fff}.rc-book-bottom:before{content:"···  ✉  ◉  @  ◔  ···";position:absolute;top:2cqw;left:0;right:0;color:rgba(255,255,255,.9);text-align:center;font-size:4.5cqw;word-spacing:2cqw}.rc-book-bottom span{display:flex;overflow:hidden;min-height:9cqw;align-items:center;justify-content:center;padding:1cqw 2cqw;border:.25cqw solid #fff;border-radius:50%;text-align:center;font-size:2.5cqw;font-weight:800}.rc-book-bottom span em{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;font-style:normal;white-space:normal}
  .rc-notebook{background:#d5cdb7}.rc-notebook-lines{position:absolute;left:24%;right:0;top:14.7%;bottom:6%;display:grid;grid-template-rows:.95fr 1.45fr .95fr .95fr .95fr;overflow:hidden;font-family:"LXGW WenKai","KaiTi",cursive}.rc-notebook-lines>div{display:flex;overflow:hidden;min-width:0;align-items:center;border-bottom:.24cqw solid #29231d;padding:0 2.2cqw;transform-origin:left bottom}.rc-notebook-lines>div:nth-child(2){transform:rotate(-.35deg)}.rc-notebook-lines>div:nth-child(3){transform:rotate(.22deg)}.rc-notebook-lines>div:nth-child(4){transform:rotate(-.18deg)}.rc-notebook-lines>div:nth-child(5){transform:rotate(.28deg)}.rc-notebook-lines span{display:block;max-width:100%;color:#17130f;font-size:clamp(26px, calc(6.6cqw * var(--fit-scale, 1)), 46px);font-weight:650;line-height:1.08;letter-spacing:0;text-shadow:.02em .02em 0 rgba(20,15,10,.14);white-space:normal;overflow-wrap:anywhere;word-break:normal}.rc-notebook-lines .big span{font-size:clamp(42px, calc(11.2cqw * var(--fit-scale, 1)), 72px);font-weight:800;line-height:1.02}
  .rc-experience{position:relative;display:flex;overflow:hidden;height:auto;flex-direction:column;padding:6.2cqw 6.4cqw 6.2cqw;background:#f7f6f2;color:#161616;font-family:"PingFang SC","Microsoft YaHei",sans-serif}.rc-experience-kicker{flex:0 0 auto;border-bottom:.22cqw solid #181818;padding-bottom:1.6cqw;color:#666;font-family:Arial,sans-serif;font-size:2.7cqw;font-weight:800;letter-spacing:.14em}.rc-experience h1{flex:0 0 auto;margin-top:4.2cqw;color:#111;font-size:clamp(27px,var(--exp-title,9cqw),52px);font-weight:950;line-height:1.08;overflow-wrap:normal;word-break:keep-all}.rc-experience-lead{flex:0 0 auto;margin-top:3.2cqw;border-left:.8cqw solid #d72b38;padding-left:2.2cqw;color:#333;font-size:clamp(15px,4.25cqw,30px);font-weight:700;line-height:1.38;overflow-wrap:anywhere;word-break:normal}.rc-experience-body{display:grid;overflow:hidden;flex:1 1 auto;grid-template-rows:repeat(2,minmax(0,1fr));align-content:stretch;gap:0;min-height:0;margin-top:3.2cqw;color:#171717}.rc-experience-point{display:grid;grid-template-columns:6.2cqw minmax(0,1fr);align-content:center;gap:2cqw;border-top:.16cqw solid #aaa;padding:2.2cqw 0}.rc-experience-point>span{color:#d72b38;font-family:Georgia,serif;font-size:clamp(13px,3.3cqw,24px);font-weight:800}.rc-experience-point>p{margin:0!important;color:#171717;font-size:clamp(16px, calc(4.6cqw * var(--fit-scale, 1)), 38px);font-weight:620;line-height:1.42;overflow-wrap:anywhere!important;word-break:normal!important}
  .rc-document{padding:6.5% 7% 4.5%;background:#fff;color:#111;font-family:Arial,"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-doc-frame{position:relative;overflow:hidden;display:flex;height:100%;flex-direction:column;padding:0 7cqw 5.5cqw;border:.35cqw solid #111}.rc-doc-frame:before,.rc-doc-frame:after{content:"";position:absolute;top:-.35cqw;width:5.5cqw;height:3.2cqw;border-top:.9cqw solid #111}.rc-doc-frame:before{left:-.35cqw;border-left:.9cqw solid #111}.rc-doc-frame:after{right:-.35cqw;border-right:.9cqw solid #111}.rc-doc-frame h1{overflow:visible;margin-top:-1.1cqw;padding:.4cqw 1.7cqw 0;background:#fff;color:#cf2137;text-align:center;font-family:"Source Han Serif SC Heavy","Noto Sans SC",sans-serif;font-size:5.65cqw;font-weight:900;line-height:1.08;text-overflow:ellipsis;white-space:nowrap}.rc-doc-subject{margin-top:5.4cqw;font-size:4.2cqw;font-weight:900;line-height:1.12;text-transform:uppercase}.rc-doc-meta{display:flex;width:max-content;margin-top:3.6cqw;border:1px solid #e5e5e5;color:#777;font-size:1.85cqw}.rc-doc-meta span,.rc-doc-meta b{padding:.55cqw .8cqw}.rc-doc-meta b{border-left:1px solid #e5e5e5;color:#333}.rc-doc-content{display:flex;overflow:hidden;flex:1 1 auto;flex-direction:column;justify-content:space-between;min-height:0;margin-top:2.4cqw}.rc-doc-content section{overflow:hidden;flex-shrink:0;margin-top:calc(1.4cqw * var(--fit-scale, 1))}.rc-doc-content h2{overflow:hidden;font-size:clamp(9px, calc(2.5cqw * var(--fit-scale, 1)), 20px);font-weight:900;white-space:nowrap}.rc-doc-content p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;margin-top:calc(.5cqw * var(--fit-scale, 1))!important;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:clamp(9px, calc(3.1cqw * var(--fit-scale, 1)), 25px);font-weight:450;line-height:1.34}.rc-doc-content p span{display:inline}.rc-doc-content .fr{font-family:Arial,Georgia,sans-serif}.rc-doc-frame footer{position:relative;flex:0 0 auto;display:flex;justify-content:space-between;margin-top:.9cqw;border-top:.12cqw solid #ddd;padding-top:.9cqw;color:#777;font-size:1.35cqw}
  .rc-vocab{display:flex;flex-direction:column;justify-content:space-between;padding:3.5cqw 2.5cqw;background:#f8fbfd}.rc-vocab>img{opacity:.35}.rc-table,.rc-vocab-hook{position:relative}.rc-table{display:flex;height:38%;flex-direction:column}.rc-table>div{display:grid;grid-template-columns:.8fr 1.25fr 1fr .8fr;flex:1;overflow:hidden;min-height:0;border-bottom:.12cqw solid #7c9bb1}.rc-table span{display:-webkit-box;overflow:hidden;align-items:center;padding:0 .5cqw;border-right:.12cqw solid #7c9bb1;font-size:var(--vocab-row,1.62cqw);-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal}.rc-vocab-hook{text-align:center}.rc-vocab-hook b{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:7.2cqw;-webkit-text-stroke:.8cqw #fff;paint-order:stroke fill;white-space:normal}.rc-vocab-hook span{display:inline-block;overflow:hidden;padding:.5cqw 1.2cqw;background:#234f6d;color:#fff;font-size:2.3cqw}
  .rc-roadmap{padding:4cqw;background:#eaf4ff;color:#174e87;font-family:"Microsoft YaHei",sans-serif}.rc-roadmap header{text-align:center}.rc-roadmap header h1{font-size:6.2cqw;line-height:1.06;white-space:normal}.rc-roadmap header p{margin-top:.8cqw;font-size:2.5cqw;line-height:1.2;white-space:normal}.rc-roadmap-grid{display:grid;grid-template-columns:repeat(2,1fr);grid-template-rows:repeat(2,1fr);gap:2.5cqw;height:75%;margin-top:3cqw}.rc-roadmap-grid section{position:relative;display:flex;overflow:hidden;flex-direction:column;min-height:0;padding:5cqw 2.5cqw 2cqw;border:.3cqw solid #2668a6;border-radius:1.3cqw;background:#fff}.rc-roadmap-grid strong{position:absolute;top:-2.3cqw;right:2cqw;color:#9bc5e8;font-size:6cqw}.rc-roadmap-grid h2{flex:0 0 auto;font-size:3.2cqw;line-height:1.12;white-space:normal}.rc-roadmap-grid p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:0 0 auto;margin-top:2cqw;font-size:var(--roadmap-body,2.45cqw);line-height:1.3;white-space:normal}
  .rc-collocation{padding:4cqw 2.2cqw 2.5cqw;background:#fff;color:#203220;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif}.rc-collocation>h1{text-align:center;color:#2e5a2e;font-size:6.4cqw}.rc-collocation-sub{text-align:center;color:#5c963e;font-size:2.65cqw}.rc-collocation-cols{display:grid;grid-template-columns:repeat(3,1fr);align-items:stretch;gap:2cqw;height:84%;margin-top:2cqw;overflow:hidden}.rc-collocation-cols>div{display:flex;flex-direction:column;justify-content:space-between;gap:1.5cqw;min-height:0}.rc-collocation section{display:flex;flex-shrink:0;flex-direction:column;justify-content:flex-start}.rc-collocation h2{overflow:hidden;flex:0 0 auto;padding:calc(.6cqw * var(--fit-scale, 1));background:#57933d;color:#fff;text-align:center;font-size:clamp(9px, calc(2.7cqw * var(--fit-scale, 1)), 21px);white-space:nowrap;text-overflow:ellipsis}.rc-collocation section p{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;flex:0 0 auto;border-bottom:.1cqw solid #d9e6d1;font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;font-size:clamp(8.5px, calc(2.3cqw * var(--fit-scale, 1)), 18px);line-height:1.14;white-space:normal}.rc-collocation section b{font-weight:700}.rc-collocation section span{margin-left:.4cqw;color:#4a684a}
  .rc-memo>h1{display:block;overflow:visible;padding-bottom:.12em;color:#181818;font-size:var(--memo-title,9cqw);line-height:1.12;white-space:normal;overflow-wrap:anywhere}.rc-memo-sections{margin-top:3.1cqw}.rc-memo-sections p{line-height:1.34}
  .rc-flashcard>h1{top:4.2%;display:block;overflow:visible;font-size:5.9cqw;line-height:1.18;white-space:normal}.rc-flashcard:after{top:15.2%}.rc-word-grid{top:18.5%}
  .rc-doc-frame{padding:0 6cqw 5.2cqw}.rc-doc-frame h1{display:block;overflow:visible;margin-top:-1.1cqw;font-size:5.7cqw;line-height:1.18;text-overflow:clip;white-space:normal}.rc-doc-subject{margin-top:3.2cqw;font-size:4.35cqw}.rc-doc-meta{margin-top:2.8cqw}.rc-doc-content{margin-top:2cqw}.rc-doc-content p{line-height:1.33}.rc-doc-content p span{margin-bottom:.3cqw}
  .rc-collocation{padding:3.2cqw 2.2cqw 2.2cqw}.rc-collocation>h1{font-size:6.1cqw;line-height:1.05}.rc-collocation-sub{font-size:2.35cqw}.rc-collocation-cols{gap:1.25cqw;height:85.5%;margin-top:1.5cqw}.rc-collocation-cols>div{gap:.9cqw}.rc-collocation h2{line-height:1.05}.rc-collocation section p{line-height:1.15}
  .rc-notice{display:flex;flex-direction:column;padding:7cqw 8cqw 7cqw;background:#fff0f0;color:#171313;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-notice:before{content:"";position:absolute;inset:2.2cqw;border:1.4cqw solid #83552f;box-shadow:inset 0 0 0 .4cqw #c99968;pointer-events:none}.rc-notice-label{position:relative;text-align:center;color:#8b1818;font-size:3.2cqw;font-weight:900;letter-spacing:.18em}.rc-notice h1{position:relative;margin:4cqw auto 0;max-width:84%;text-align:center;font-size:clamp(25px,7.45cqw,40px);font-weight:950;line-height:1.14;white-space:normal;overflow-wrap:anywhere;word-break:normal}.rc-notice-sub{position:relative;margin:2.2cqw auto 0;max-width:86%;text-align:center;color:#8a4b4b;font-size:clamp(14px,3.65cqw,26px);font-weight:750;line-height:1.28}.rc-notice-body{position:relative;display:flex;flex:1 1 auto;flex-direction:column;justify-content:center;gap:5.8cqw;margin:3cqw 3cqw 13cqw}.rc-notice-body p{display:grid;grid-template-columns:6cqw minmax(0,1fr);gap:2cqw;font-size:clamp(16px,calc(4.65cqw * var(--fit-scale,1)),35px);font-weight:700;line-height:1.38}.rc-notice-body b{color:#b12828;font-family:Georgia,serif}.rc-notice-stamp{position:absolute;right:9cqw;bottom:7cqw;display:grid;width:15cqw;height:15cqw;place-items:center;border:.75cqw double #c8281c;border-radius:50%;color:#c8281c;text-align:center;font-size:3.2cqw;font-weight:950;line-height:1.05;transform:rotate(-8deg)}
  .rc-pain-quote{display:flex;flex-direction:column;justify-content:center;padding:9cqw 8cqw;background:#fff;color:#111;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}.rc-pain-quote-kicker{position:absolute;top:8cqw;left:8cqw;border-bottom:.22cqw solid #111;padding-bottom:1cqw;color:#777;font-family:Arial,sans-serif;font-size:2.8cqw;font-weight:800;letter-spacing:.14em}.rc-pain-quote h1{max-width:100%;font-size:clamp(38px,var(--pain-title),72px);font-weight:750;line-height:1.16;letter-spacing:0;white-space:normal;overflow-wrap:anywhere!important;word-break:break-word!important}.rc-pain-quote h1 span,.rc-pain-quote h1 mark{background:transparent;color:inherit;white-space:normal;overflow-wrap:anywhere!important;word-break:break-word!important}.rc-pain-quote h1 mark{padding:0 .35cqw;background:linear-gradient(transparent 60%,#ffd83d 60% 92%,transparent 92%)}.rc-pain-quote p{margin-top:5cqw!important;color:#333;font-size:clamp(17px,5cqw,34px);font-weight:750;line-height:1.35}.rc-pain-wave{width:32cqw;height:2.4cqw;margin-top:5cqw;background:radial-gradient(ellipse at center,#ff7a31 0 42%,transparent 45%) 0 0/6cqw 2.2cqw repeat-x;transform:rotate(-2deg)}
  /* feedTextMode=all_readable：内容超出时交给实测缩放，不允许省略号或行数裁切伪装成“已适配”。 */
  .rc-chalk-groups p,.rc-offer-groups p,.rc-memo-sections p{display:block;overflow:visible;-webkit-line-clamp:unset}
  .rc-word-grid strong{overflow:visible;text-overflow:clip;white-space:normal;overflow-wrap:anywhere;font-size:clamp(13px,calc(5.45cqw * var(--fit-scale,1)),44px)}
  .rc-word-grid em{display:block;overflow:visible;-webkit-line-clamp:unset;white-space:normal}
  /* Production overrides: dense lists must fill continuously; sparse document groups share the available page height. */
  .rc-memo-sections{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);align-content:stretch;gap:1.8cqw 3.2cqw}
  .rc-memo-sections section{display:flex;min-height:0;flex-direction:column;justify-content:flex-start;margin-bottom:0;padding-top:.2cqw}
  .rc-collocation-cols>div{justify-content:flex-start;gap:.55cqw}
  .rc-collocation section{flex:1 1 0;min-height:0}
  .rc-collocation section p{display:flex;min-height:0;flex:1 1 0;align-items:center;-webkit-line-clamp:unset}
  .rc-doc-content{justify-content:flex-start;gap:1.1cqw}
  .rc-doc-content section{display:flex;min-height:0;flex:0 0 auto;flex-direction:column;justify-content:flex-start;margin-top:0}
  .rc-pain-quote{padding:7cqw 6.2cqw}
  .rc-pain-quote h1{font-size:clamp(48px,var(--pain-title),88px);font-weight:900;line-height:1.08;letter-spacing:-.02em}
  .rc-offer-groups{justify-content:flex-start;gap:4cqw}
  .rc-offer-groups section{min-height:0;flex:1 1 0;justify-content:center;padding:.8cqw 0}
  .rc-offer-groups h2{font-size:clamp(16px,calc(4.05cqw * var(--fit-scale,1)),33px)}
  .rc-offer-groups p{font-size:clamp(14px,calc(3.75cqw * var(--fit-scale,1)),31px);font-weight:700;line-height:1.2}
  .rc-experience{padding:5.2cqw 6.4cqw}
  .rc-experience h1{margin-top:3.2cqw}
  .rc-experience-lead{margin-top:2.2cqw;font-size:clamp(15px,3.8cqw,28px);line-height:1.3}
  .rc-experience-body{grid-template-rows:repeat(4,minmax(0,1fr));margin-top:2.2cqw}
  .rc-experience-point{grid-template-columns:5.2cqw minmax(0,1fr);gap:1.5cqw;padding:1.15cqw 0}
  .rc-experience-point{overflow:hidden}
  .rc-experience-point>p{font-size:clamp(10px,calc(3.25cqw * var(--fit-scale,1)),27px);font-weight:650;line-height:1.24}
  .rc-pain-quote h1 mark{display:inline-block;white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important}
  .rc-pain-quote h1 span{display:inline-block;white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important}
`}</style> }
