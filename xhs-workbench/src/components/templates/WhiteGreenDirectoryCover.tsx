'use client';

import type { DenseDirectoryCoverPayload, DenseDirectorySection } from '@/types/reference-workflow';
import { useAutoFitScale } from './useAutoFitScale';

interface WhiteGreenDirectoryCoverProps {
  payload: DenseDirectoryCoverPayload;
  className?: string;
}

export default function WhiteGreenDirectoryCover({ payload, className = '' }: WhiteGreenDirectoryCoverProps) {
  const titleScale = payload.title.length > 18 ? '6.6cqw' : payload.title.length > 14 ? '7.5cqw' : '8.3cqw';
  const sectionsKey = payload.sections.map(s => `${s.heading}:${s.items.length}:${s.items.map(i => `${i.primary}${i.secondary || ''}`).join(',')}`).join('|');
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsKey], { min: 0.5, max: 1, step: 0.025 });
  return (
    <article
      className={`white-green-directory ${className}`}
      style={{ '--section-count': Math.max(payload.sections.length, 1), '--title-scale': titleScale } as React.CSSProperties}
      aria-label={payload.title}
    >
      <header className="white-green-header">
        <h1>{payload.title}</h1>
        {payload.subtitle ? <p>{payload.subtitle}</p> : null}
      </header>

      <div className="white-green-sections" ref={fitRef}>
        {payload.sections.map((section, sectionIndex) => (
          <section className="white-green-section" key={`${section.heading}-${sectionIndex}`}>
            <div className="white-green-label">{splitLabel(section.side_label).map(line => <span key={line}>{line}</span>)}</div>
            <div className="white-green-body">
              <h2>{chineseIndex(sectionIndex + 1)}、{section.heading}</h2>
              <div className="white-green-grid" style={{ '--columns': adaptiveColumns(section) } as React.CSSProperties}>
                {section.items.map((item, itemIndex) => (
                  <div className="white-green-item" key={`${item.primary}-${itemIndex}`}>
                    <span className="white-green-dot" />
                    <span className="white-green-copy">
                      <strong>{item.primary}</strong>
                      {item.secondary ? <span>{item.secondary}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

      <style>{`
        .white-green-directory {
          position: relative;
          width: 100%;
          aspect-ratio: 3 / 4;
          overflow: hidden;
          border: 1px solid #dfe8df;
          border-radius: 2px;
          background:
            radial-gradient(circle at 24% 18%, rgba(255,255,255,.9), transparent 28%),
            repeating-radial-gradient(circle at 30% 20%, rgba(20,90,45,.045) 0 1px, transparent 1px 4px),
            linear-gradient(180deg, #fafcf9 0%, #edf3ee 48%, #f7faf6 100%);
          box-shadow: 0 22px 50px rgba(20,32,22,.22);
          color: #087a2d;
          container-type: inline-size;
          font-family: "Noto Serif SC", "STSong", serif;
        }
        .white-green-directory::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background:
            linear-gradient(90deg, rgba(255,255,255,.38), transparent 15%, transparent 84%, rgba(0,0,0,.035)),
            repeating-linear-gradient(115deg, rgba(14,93,43,.026) 0 1px, transparent 1px 5px);
          mix-blend-mode: multiply;
        }
        .white-green-header {
          position: relative;
          z-index: 1;
          padding: 3.2cqw 4.5cqw 1.35cqw;
          text-align: center;
        }
        .white-green-header h1 {
          margin: 0;
          color: #07852e;
          font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
          font-size: clamp(30px, var(--title-scale), 68px);
          font-weight: 900;
          line-height: 1.02;
          letter-spacing: 0;
          text-shadow: 0 1px 0 rgba(255,255,255,.75), 0 .16cqw .12cqw rgba(9,89,37,.1);
        }
        .white-green-header p {
          margin: .9cqw 0 0;
          color: #47975d;
          font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
          font-size: clamp(13px, 2.15cqw, 19px);
          font-weight: 800;
          line-height: 1.15;
        }
        .white-green-sections {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 87.6%;
          padding: 0 4.5cqw 3cqw 2.3cqw;
          overflow: hidden;
        }
        .white-green-section {
          display: grid;
          flex-shrink: 0;
          grid-template-columns: 10.7cqw minmax(0, 1fr);
        }
        .white-green-label {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          color: #315e3f;
          font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
          font-size: clamp(13px, 2.4cqw, 21px);
          font-weight: 800;
          line-height: 1.08;
          text-align: center;
        }
        .white-green-label::after {
          content: "";
          position: absolute;
          top: 14%;
          right: .6cqw;
          width: 1.15cqw;
          height: 72%;
          border-top: .25cqw solid #07852e;
          border-right: .25cqw solid #07852e;
          border-bottom: .25cqw solid #07852e;
        }
        .white-green-body {
          display: flex;
          min-width: 0;
          min-height: 0;
          flex-direction: column;
          justify-content: flex-start;
          padding: calc(.25cqw * var(--fit-scale, 1)) 0 calc(.35cqw * var(--fit-scale, 1)) 1.8cqw;
        }
        .white-green-body h2 {
          margin: 0 0 calc(.65cqw * var(--fit-scale, 1));
          overflow: hidden;
          color: #0b7731;
          font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
          font-size: clamp(14px, calc(3.1cqw * var(--fit-scale, 1)), 27px);
          font-weight: 900;
          line-height: 1.05;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .white-green-grid {
          display: grid;
          grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
          column-gap: 1.65cqw;
          row-gap: calc(.35cqw * var(--fit-scale, 1));
          min-width: 0;
        }
        .white-green-item {
          display: grid;
          grid-template-columns: .85cqw minmax(0, 1fr);
          align-items: start;
          min-width: 0;
          overflow: hidden;
          font-size: clamp(10.5px, calc(2.15cqw * var(--fit-scale, 1)), 19px);
          font-weight: 700;
          line-height: 1.08;
        }
        .white-green-copy strong {
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .white-green-copy span {
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
        }
        .white-green-dot {
          width: .52cqw;
          height: .52cqw;
          margin-top: .48cqw;
          border-radius: 50%;
          background: #07852e;
        }
        .white-green-copy {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: .08cqw;
        }
        .white-green-copy strong,
        .white-green-copy span {
          min-width: 0;
          overflow-wrap: normal;
          word-break: keep-all;
          hyphens: none;
        }
        .white-green-copy strong {
          color: #174b29;
          font-family: Georgia, "Noto Serif SC", serif;
          font-weight: 800;
        }
        .white-green-copy span {
          color: #4f8d60;
          font-size: .9em;
          font-weight: 700;
        }
      `}</style>
    </article>
  );
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
