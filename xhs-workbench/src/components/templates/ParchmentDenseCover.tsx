'use client';

import type { DenseDirectoryCoverPayload } from '@/types/reference-workflow';
import { useAutoFitScale } from './useAutoFitScale';

interface ParchmentDenseCoverProps {
  payload: DenseDirectoryCoverPayload;
  className?: string;
}

export default function ParchmentDenseCover({ payload, className = '' }: ParchmentDenseCoverProps) {
  const sectionCount = Math.max(1, payload.sections.length);
  const totalItems = payload.sections.reduce((sum, section) => sum + section.items.length, 0);
  const titleLength = visualLength(payload.title);
  const titleScale = titleLength > 34 ? '3.55cqw'
    : titleLength > 28 ? '4cqw'
      : titleLength > 22 ? '4.48cqw'
        : titleLength > 17 ? '5.08cqw'
        : '5.95cqw';

  const sectionsKey = payload.sections.map(s => `${s.heading}:${s.items.length}:${s.items.map(i => `${i.primary}${i.secondary || ''}`).join(',')}`).join('|');
  const fitRef = useAutoFitScale<HTMLDivElement>([sectionsKey, sectionCount], { min: 0.64, max: 1, step: 0.025 });

  return (
    <article
      className={`parchment-dense-cover ${totalItems <= 14 ? 'parchment-dense-cover--compact' : ''} ${className}`}
      style={{ '--section-count': sectionCount, '--title-scale': titleScale } as React.CSSProperties}
      aria-label={payload.title}
    >
      <img className="parchment-dense-texture" src="/generated/parchment_master_clean_01.png" alt="" />
      <header className="parchment-dense-header">
        <h1>{payload.title}</h1>
        {payload.subtitle ? <p>{payload.subtitle}</p> : null}
      </header>

      <div className="parchment-dense-sections" ref={fitRef}>
        {payload.sections.map((section, sectionIndex) => (
          <section className="parchment-dense-section" key={`${section.heading}-${sectionIndex}`}>
            <div className="parchment-dense-label">
              {splitLabel(section.side_label).map(line => <span key={line}>{line}</span>)}
            </div>
            <div className="parchment-dense-body">
              <h2>{chineseIndex(sectionIndex + 1)}、{section.heading}</h2>
              <div
                className="parchment-dense-grid"
                style={{ '--columns': adaptiveColumns(section) } as React.CSSProperties}
              >
                {section.items.map((item, itemIndex) => (
                  <div className="parchment-dense-item" key={`${item.primary}-${itemIndex}`}>
                    <span className="parchment-dense-dot" />
                    <span className="parchment-dense-copy">
                      <span className="parchment-dense-primary">{item.primary}</span>
                      {item.secondary ? <span className="parchment-dense-secondary">{item.secondary}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ))}
      </div>

      <style>{`
        .parchment-dense-cover {
          position: relative;
          isolation: isolate;
          width: 100%;
          aspect-ratio: 3 / 4;
          overflow: hidden;
          border: 1px solid #b68f63;
          border-radius: 8px;
          background: #e9d1a6;
          box-shadow: 0 24px 55px rgba(74, 43, 22, .26);
          color: #54251e;
          container-type: inline-size;
          font-family: "Noto Serif SC", "STSong", serif;
        }
        .parchment-dense-cover::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            radial-gradient(circle at 76% 9%, rgba(255,247,216,.32), transparent 31%),
            linear-gradient(103deg, rgba(69,29,15,.07), transparent 18%, transparent 73%, rgba(93,48,25,.08));
          mix-blend-mode: multiply;
        }
        .parchment-dense-texture {
          position: absolute;
          inset: 0;
          z-index: -2;
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .parchment-dense-header {
          position: relative;
          height: 14.2%;
          padding: 2.7cqw 4.8cqw 1cqw;
          text-align: center;
        }
        .parchment-dense-header h1 {
          margin: 0;
          color: #76241c;
          font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
          font-size: var(--title-scale);
          font-weight: 900;
          line-height: 1.02;
          letter-spacing: 0;
          white-space: nowrap;
          text-shadow: 0 1px 0 rgba(255,239,204,.45);
        }
        .parchment-dense-header p {
          margin: 1.05cqw 0 0;
          color: #8e5d43;
          font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
          font-size: clamp(13px, 2.08cqw, 20px);
          font-weight: 700;
          line-height: 1.12;
        }
        .parchment-dense-sections {
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          height: 85.8%;
          padding: 0 4.8cqw 2.7cqw;
          overflow: hidden;
        }
        .parchment-dense-cover--compact .parchment-dense-sections {
          justify-content: flex-start;
          gap: 4.8cqw;
          padding-top: 1.2cqw;
        }
        .parchment-dense-cover--compact .parchment-dense-section {
          min-height: 13.5cqw;
        }
        .parchment-dense-cover--compact .parchment-dense-item {
          font-size: clamp(14px, calc(2.9cqw * var(--fit-scale, 1)), 26px);
          line-height: 1.12;
        }
        .parchment-dense-section {
          display: grid;
          flex-shrink: 0;
          grid-template-columns: 10.8cqw minmax(0, 1fr);
        }
        .parchment-dense-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: .25cqw;
          border-right: .18cqw solid rgba(105,36,28,.7);
          color: #3e3028;
          font-family: "Noto Sans SC", "Microsoft YaHei", sans-serif;
          font-size: clamp(16px, calc(2.65cqw * var(--fit-scale, 1)), 25px);
          font-weight: 800;
          line-height: 1.08;
          text-align: center;
        }
        .parchment-dense-body {
          display: flex;
          min-width: 0;
          min-height: 0;
          flex-direction: column;
          justify-content: flex-start;
          padding: calc(.28cqw * var(--fit-scale, 1)) 0 calc(.28cqw * var(--fit-scale, 1)) 2.35cqw;
        }
        .parchment-dense-body h2 {
          margin: 0 0 calc(.55cqw * var(--fit-scale, 1));
          overflow: hidden;
          color: #9b3328;
          font-family: "Source Han Serif SC Heavy", "Noto Serif SC", serif;
          font-size: clamp(16px, calc(2.88cqw * var(--fit-scale, 1)), 28px);
          font-weight: 800;
          line-height: 1.08;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .parchment-dense-grid {
          display: grid;
          grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
          column-gap: 1.75cqw;
          row-gap: calc(.28cqw * var(--fit-scale, 1));
          min-width: 0;
        }
        .parchment-dense-item {
          display: grid;
          grid-template-columns: .88cqw minmax(0, 1fr);
          align-items: start;
          min-width: 0;
          overflow: hidden;
          color: #2f2925;
          font-family: "Noto Serif SC", "STSong", serif;
          font-size: clamp(13px, calc(2.6cqw * var(--fit-scale, 1)), 24px);
          font-weight: 800;
          line-height: 1.06;
          white-space: normal;
        }
        .parchment-dense-dot {
          width: .54cqw;
          height: .54cqw;
          border-radius: 50%;
          background: #78271e;
          margin-top: .5cqw;
        }
        .parchment-dense-copy {
          display: flex;
          min-width: 0;
          flex-direction: column;
          gap: .1cqw;
        }
        .parchment-dense-primary {
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          color: #302824;
          font-weight: 800;
        }
        .parchment-dense-secondary {
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          color: #a33d30;
          font-family: Georgia, "Noto Serif SC", serif;
          font-size: .9em;
          font-weight: 700;
        }
        .parchment-dense-item small {
          display: none;
        }
      `}</style>
    </article>
  );
}

function adaptiveColumns(section: DenseDirectoryCoverPayload['sections'][number]) {
  const averageLength = section.items.reduce(
    (sum, item) => sum + `${item.primary}${item.secondary || ''}`.length / Math.max(section.items.length, 1),
    0,
  );
  const longestVisualItem = Math.max(...section.items.map(item => visualLength(`${item.primary}${item.secondary || ''}`)));
  const longestLatinToken = Math.max(0, ...section.items.flatMap(item =>
    (`${item.primary} ${item.secondary || ''}`.match(/[A-Za-zÀ-ÿ'-]+/g) || []).map(token => token.length),
  ));
  if (averageLength > 14 || longestVisualItem > 22 || longestLatinToken > 8) return 2;
  return Math.min(section.columns, 2);
}

function visualLength(value: string) {
  return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0);
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
