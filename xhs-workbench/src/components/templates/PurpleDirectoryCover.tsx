'use client';

import type { DenseDirectoryCoverPayload, DenseDirectorySection } from '@/types/reference-workflow';
import { useAutoFitScale } from './useAutoFitScale';

interface PurpleDirectoryCoverProps {
  payload: DenseDirectoryCoverPayload;
  variant: 'clean' | 'grid';
  className?: string;
}

export default function PurpleDirectoryCover({ payload, variant, className = '' }: PurpleDirectoryCoverProps) {
  if (variant === 'grid') return <GridPurpleDirectory payload={payload} className={className} />;
  return <CleanPurpleDirectory payload={payload} className={className} />;
}

function sectionsFingerprint(payload: DenseDirectoryCoverPayload) {
  return payload.sections.map(s => `${s.heading}:${s.items.length}:${s.items.map(i => `${i.primary}${i.secondary || ''}`).join(',')}`).join('|');
}

function CleanPurpleDirectory({ payload, className }: { payload: DenseDirectoryCoverPayload; className: string }) {
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint(payload)], { min: 0.5, max: 1, step: 0.025 });
  return <article className={`clean-purple-directory ${className}`} style={{ '--section-count': Math.max(payload.sections.length, 1) } as React.CSSProperties} aria-label={payload.title}>
    <header><h1>{payload.title}</h1>{payload.subtitle ? <p>{payload.subtitle}</p> : null}</header>
    <div className="clean-purple-sections" ref={fitRef}>{payload.sections.map((section, sectionIndex) => <section key={`${section.heading}-${sectionIndex}`}>
      <h2>{section.heading}</h2>
      <div className="clean-purple-bracket"><div className="clean-purple-grid" style={{ '--columns': adaptiveColumns(section) } as React.CSSProperties}>
        {section.items.map((item, itemIndex) => <div className="clean-purple-item" key={`${item.primary}-${itemIndex}`}><i/><span><strong>{item.primary}</strong>{item.secondary ? <em>{item.secondary}</em> : null}</span></div>)}
      </div></div>
    </section>)}</div>
    <div className="clean-purple-page">1/5</div>
    <style>{`
      .clean-purple-directory{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;border:1px solid #e5dfeb;background:#fff;box-shadow:0 22px 50px rgba(45,25,55,.18);color:#673287;container-type:inline-size;font-family:"Noto Serif SC","STSong",serif;letter-spacing:0}
      .clean-purple-directory *{box-sizing:border-box;min-width:0}.clean-purple-directory header{padding:3.2cqw 5.2cqw 1.2cqw;text-align:center}.clean-purple-directory h1{margin:0;color:#68308a;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:6.6cqw;font-weight:900;line-height:1;white-space:nowrap}.clean-purple-directory header p{margin:.75cqw 0 0;color:#9d426c;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:2.05cqw;font-weight:800}
      .clean-purple-sections{display:flex;flex-direction:column;justify-content:space-between;height:88%;padding:0 5.6cqw 3.6cqw;overflow:hidden}.clean-purple-sections section{display:flex;flex-shrink:0;flex-direction:column;justify-content:flex-start}.clean-purple-sections h2{margin:0 0 calc(.85cqw * var(--fit-scale, 1));color:#71318d;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:clamp(13px, calc(3.3cqw * var(--fit-scale, 1)), 26px);font-weight:900;line-height:1.05}.clean-purple-bracket{position:relative;margin-left:6.1cqw;padding:calc(1.15cqw * var(--fit-scale, 1)) 0 calc(1.15cqw * var(--fit-scale, 1)) 3cqw}.clean-purple-bracket:before{content:"";position:absolute;top:.4cqw;bottom:.4cqw;left:0;width:1.35cqw;border-top:.32cqw solid #73318f;border-bottom:.32cqw solid #73318f;border-left:.32cqw solid #73318f}
      .clean-purple-grid{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));column-gap:2cqw;row-gap:calc(.82cqw * var(--fit-scale, 1))}.clean-purple-item{display:grid;grid-template-columns:1.3cqw minmax(0,1fr);align-items:start;overflow:hidden;font-size:clamp(11px, calc(3cqw * var(--fit-scale, 1)), 24px);font-weight:700;line-height:1.12}.clean-purple-item i{width:.78cqw;height:.78cqw;margin-top:.48cqw;border-radius:50%;background:#77318f}.clean-purple-item span{display:flex;overflow:hidden;flex-direction:column;gap:.1cqw;min-width:0}.clean-purple-item strong{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#9f426c;font-family:Georgia,"Noto Serif SC",serif;font-weight:700}.clean-purple-item em{overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;margin-left:0;color:#673287;font-family:"Noto Serif SC","STSong",serif;font-size:.88em;font-style:normal;font-weight:800}.clean-purple-page{position:absolute;top:-1.1cqw;right:-1.1cqw;display:grid;width:6.3cqw;height:6.3cqw;place-items:center;border-radius:50%;background:rgba(105,105,105,.72);color:#fff;font:800 2.1cqw Arial,sans-serif}
    `}</style>
  </article>;
}

function GridPurpleDirectory({ payload, className }: { payload: DenseDirectoryCoverPayload; className: string }) {
  const sections = payload.sections.slice(0, 4);
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsFingerprint({ ...payload, sections })], { min: 0.5, max: 1, step: 0.025 });
  return <article className={`grid-purple-sheet ${className}`} aria-label={payload.title}>
    <div className="grid-purple-tools" aria-hidden="true"><b>╱</b><b>▣</b><b>✎</b><b>⌁</b><i/><i/><i/><i/><i/></div>
    <header><h1>{payload.title}</h1><p>{payload.subtitle}</p></header>
    <div className="grid-purple-sections" ref={fitRef}>{sections.map((section,index)=><section key={`${section.heading}-${index}`}><h2>{chineseIndex(index+1)}、{section.heading}</h2><div className="grid-purple-table">{section.items.map((item,itemIndex)=><div key={`${item.primary}-${itemIndex}`}><strong>{item.primary}</strong>{item.secondary ? <span>{item.secondary}</span> : null}</div>)}</div></section>)}</div>
    <style>{`
      .grid-purple-sheet{position:relative;width:100%;aspect-ratio:3/4;overflow:hidden;border:1px solid #d9d2e0;background-color:#fbfaf0;background-image:linear-gradient(rgba(117,80,145,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(117,80,145,.12) 1px,transparent 1px);background-size:3.8cqw 3.8cqw;box-shadow:0 22px 50px rgba(50,30,70,.2);color:#3e2d49;container-type:inline-size;font-family:"Noto Serif SC","STSong",serif;letter-spacing:0}
      .grid-purple-sheet *{box-sizing:border-box}.grid-purple-sheet header{padding:3.2cqw 3.5cqw 1.2cqw 8.5cqw;text-align:center}.grid-purple-sheet h1{margin:0;color:#5d2a86;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;font-size:7.5cqw;font-weight:900;line-height:1}.grid-purple-sheet header p{margin:.8cqw 0 0;color:#a34b76;font-family:"Noto Sans SC","Microsoft YaHei",sans-serif;font-size:2.45cqw;font-weight:800}.grid-purple-sections{display:flex;flex-direction:column;justify-content:space-between;height:84.5%;padding:0 3.5cqw 2.5cqw 8.5cqw;overflow:hidden}.grid-purple-sections section{display:flex;flex-shrink:0;flex-direction:column;justify-content:flex-start}.grid-purple-sections h2{margin:0 0 calc(.65cqw * var(--fit-scale, 1));color:#713184;font-family:"Source Han Serif SC Heavy","Noto Serif SC",serif;text-align:left;font-size:clamp(13px, calc(3.1cqw * var(--fit-scale, 1)), 25px);line-height:1.05}.grid-purple-table{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:.18cqw solid #70458e;border-left:.18cqw solid #70458e;background:rgba(255,255,255,.5)}.grid-purple-sections section:nth-child(n+3) .grid-purple-table{grid-template-columns:repeat(2,minmax(0,1fr))}.grid-purple-table>div{display:flex;min-height:calc(4.2cqw * var(--fit-scale, 1));align-items:center;gap:.4cqw;padding:.35cqw .7cqw;border-right:.18cqw solid #70458e;border-bottom:.18cqw solid #70458e;overflow:hidden;flex-wrap:wrap;font-size:clamp(10px, calc(2.15cqw * var(--fit-scale, 1)), 17px);line-height:1.12}.grid-purple-table strong{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;color:#3e2949}.grid-purple-table span{overflow:hidden;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;color:#a84572;font-size:.85em}.grid-purple-tools{position:absolute;top:0;bottom:0;left:0;display:flex;width:6.4cqw;flex-direction:column;align-items:center;gap:3.2cqw;padding-top:5cqw;border-right:.12cqw solid rgba(105,65,139,.16);background:rgba(255,255,255,.52);font-family:Arial,sans-serif}.grid-purple-tools b{font-size:2.4cqw;font-weight:500}.grid-purple-tools i{width:2.25cqw;height:2.25cqw;border-radius:50%;background:#62c5d8}.grid-purple-tools i:nth-of-type(2){background:#1fa9dc}.grid-purple-tools i:nth-of-type(3){background:#ffd94c}.grid-purple-tools i:nth-of-type(4){background:#e8ad62}.grid-purple-tools i:nth-of-type(5){background:#222}
    `}</style>
  </article>;
}

function adaptiveColumns(section: DenseDirectorySection) {
  const longestLatinToken = Math.max(0, ...section.items.flatMap(item =>
    (`${item.primary} ${item.secondary || ''}`.match(/[A-Za-zÀ-ÿ'-]+/g) || []).map(token => token.length),
  ));
  const longestItem = Math.max(...section.items.map(item => `${item.primary}${item.secondary || ''}`.length));
  if (longestLatinToken > 9 || longestItem > 22) return 2;
  return Math.min(section.columns, 3);
}

function splitLabel(value: string) {
  if (/[\/｜|\n]/.test(value)) return value.split(/[\/｜|\n]/).map(item => item.trim()).filter(Boolean);
  if (value.length <= 2) return [value];
  const midpoint = Math.ceil(value.length / 2);
  return [value.slice(0, midpoint), value.slice(midpoint)];
}

function chineseIndex(index: number) {
  return ['一', '二', '三', '四', '五', '六', '七'][index - 1] || String(index);
}
