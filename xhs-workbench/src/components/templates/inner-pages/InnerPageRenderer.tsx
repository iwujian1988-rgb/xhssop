'use client';

import type { CSSProperties } from 'react';
import type { GeneratedInnerPage, InnerPageStyleVariant } from '@/types/reference-workflow';
import { useAutoFitScale } from '@/components/templates/useAutoFitScale';

interface StyleConfig {
  backgroundColor: string;
  backgroundImage?: string;
  backgroundSize?: string;
  borderColor: string;
  titleColor: string;
  leadColor: string;
  bulletColor: string;
  bulletAccent: string;
  dividerColor: string;
  headerColor: string;
  wrapperStyle?: CSSProperties;
  articleClass?: string;
  showPunchHoles?: boolean;
  punchHoleColor?: string;
}

const STYLE_CONFIGS: Record<InnerPageStyleVariant, StyleConfig> = {
  'lined-notebook': {
    backgroundColor: '#fdfcf7',
    backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, rgba(31, 99, 187, 0.18) 31px, rgba(31, 99, 187, 0.18) 32px)',
    borderColor: 'border-neutral-200',
    titleColor: 'text-neutral-900',
    leadColor: 'text-neutral-700',
    bulletColor: 'text-neutral-800',
    bulletAccent: 'text-blue-700',
    dividerColor: 'bg-neutral-900',
    headerColor: 'text-neutral-400',
    articleClass: 'shadow-sm',
  },
  'grid-notebook': {
    backgroundColor: '#fbfbfd',
    backgroundImage:
      'repeating-linear-gradient(to right, rgba(80, 80, 95, 0.10) 0, rgba(80, 80, 95, 0.10) 1px, transparent 1px, transparent 32px),' +
      'repeating-linear-gradient(to bottom, rgba(80, 80, 95, 0.10) 0, rgba(80, 80, 95, 0.10) 1px, transparent 1px, transparent 32px)',
    borderColor: 'border-neutral-200',
    titleColor: 'text-neutral-900',
    leadColor: 'text-neutral-700',
    bulletColor: 'text-neutral-800',
    bulletAccent: 'text-emerald-700',
    dividerColor: 'bg-emerald-800',
    headerColor: 'text-neutral-400',
    articleClass: 'shadow-sm',
  },
  'dot-notebook': {
    backgroundColor: '#fcfcfd',
    backgroundImage: 'radial-gradient(rgba(60, 70, 95, 0.22) 1px, transparent 1.5px)',
    backgroundSize: '22px 22px',
    borderColor: 'border-neutral-200',
    titleColor: 'text-neutral-900',
    leadColor: 'text-neutral-700',
    bulletColor: 'text-neutral-800',
    bulletAccent: 'text-indigo-700',
    dividerColor: 'bg-indigo-900',
    headerColor: 'text-neutral-400',
    articleClass: 'shadow-sm',
  },
  'sticky-note': {
    backgroundColor: '#fff7c4',
    backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 28px, rgba(180, 140, 40, 0.10) 28px, rgba(180, 140, 40, 0.10) 29px)',
    borderColor: 'border-amber-300',
    titleColor: 'text-amber-950',
    leadColor: 'text-amber-900',
    bulletColor: 'text-amber-950',
    bulletAccent: 'text-rose-700',
    dividerColor: 'bg-amber-700',
    headerColor: 'text-amber-700',
    wrapperStyle: { transform: 'rotate(-1.5deg)' },
    articleClass: 'shadow-md',
  },
  'draft-paper': {
    backgroundColor: '#f7f3e8',
    backgroundImage:
      'repeating-linear-gradient(to bottom, transparent 0, transparent 30px, rgba(120, 100, 60, 0.10) 30px, rgba(120, 100, 60, 0.10) 31px)',
    borderColor: 'border-stone-300',
    titleColor: 'text-stone-900',
    leadColor: 'text-stone-700',
    bulletColor: 'text-stone-900',
    bulletAccent: 'text-red-700',
    dividerColor: 'bg-stone-800',
    headerColor: 'text-stone-500',
    articleClass: 'shadow-sm',
  },
  'loose-leaf': {
    backgroundColor: '#fefdfa',
    backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 30px, rgba(30, 99, 60, 0.12) 30px, rgba(30, 99, 60, 0.12) 31px)',
    borderColor: 'border-neutral-200',
    titleColor: 'text-neutral-900',
    leadColor: 'text-neutral-700',
    bulletColor: 'text-neutral-800',
    bulletAccent: 'text-emerald-700',
    dividerColor: 'bg-emerald-900',
    headerColor: 'text-neutral-400',
    articleClass: 'shadow-sm',
    showPunchHoles: true,
    punchHoleColor: 'rgba(40, 60, 50, 0.18)',
  },
  'kraft-paper': {
    backgroundColor: '#d9b888',
    backgroundImage:
      'linear-gradient(135deg, rgba(80, 50, 20, 0.08) 0%, transparent 40%),' +
      'linear-gradient(45deg, rgba(255, 230, 200, 0.18) 0%, transparent 50%),' +
      'radial-gradient(rgba(60, 35, 12, 0.10) 1px, transparent 1.5px)',
    backgroundSize: 'auto, auto, 14px 14px',
    borderColor: 'border-amber-900/30',
    titleColor: 'text-amber-950',
    leadColor: 'text-amber-900',
    bulletColor: 'text-amber-950',
    bulletAccent: 'text-emerald-900',
    dividerColor: 'bg-emerald-900',
    headerColor: 'text-amber-800',
    articleClass: 'shadow-md',
  },
};

const PUNCH_HOLE_STYLE: CSSProperties = {
  position: 'absolute',
  left: '8px',
  width: '14px',
  height: '14px',
  borderRadius: '50%',
  background: 'rgba(40, 60, 50, 0.20)',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.25)',
};

export interface InnerPageRendererProps {
  page: GeneratedInnerPage;
  registerNode?: (node: HTMLElement | null) => void;
  /** When provided, the renderer will also expose its scaled node via this ref. */
  fitRefOverride?: ReturnType<typeof useAutoFitScale<HTMLElement>>;
}

export function InnerPageRenderer({ page, registerNode }: InnerPageRendererProps) {
  const variant: InnerPageStyleVariant = page.style_variant ?? 'lined-notebook';
  const cfg = STYLE_CONFIGS[variant];

  const fingerprint = `${page.page_title}|${page.lead}|${page.bullets.join('|')}|${variant}`;
  const fitRef = useAutoFitScale<HTMLElement>([fingerprint], { min: 0.4, max: 1, step: 0.025 });

  const articleStyle: CSSProperties = {
    containerType: 'inline-size',
    backgroundColor: cfg.backgroundColor,
    backgroundImage: cfg.backgroundImage,
    backgroundSize: cfg.backgroundSize,
    padding: 'calc(8% * var(--fit-scale, 1))',
    ...cfg.wrapperStyle,
  };

  return (
    <article
      ref={(node) => { fitRef.current = node; registerNode?.(node); }}
      className={`aspect-[3/4] overflow-hidden border ${cfg.borderColor} ${cfg.articleClass ?? ''} flex flex-col relative`}
      style={articleStyle}
    >
      {cfg.showPunchHoles ? (
        <>
          <span style={{ ...PUNCH_HOLE_STYLE, top: '14%' }} />
          <span style={{ ...PUNCH_HOLE_STYLE, top: '50%' }} />
          <span style={{ ...PUNCH_HOLE_STYLE, top: '86%' }} />
        </>
      ) : null}

      <div className={`flex flex-shrink-0 items-center justify-between font-bold ${cfg.headerColor}`} style={{ fontSize: 'clamp(9px, calc(2.4cqw * var(--fit-scale, 1)), 11px)' }}>
        <span>P{page.page_no}</span>
        <span>{page.page_type}</span>
      </div>
      <h3 className={`flex-shrink-0 font-black leading-tight ${cfg.titleColor}`} style={{ marginTop: 'calc(1.25rem * var(--fit-scale, 1))', fontSize: 'clamp(14px, calc(6.2cqw * var(--fit-scale, 1)), 38px)' }}>
        {page.page_title}
      </h3>
      <div className={`h-px flex-shrink-0 ${cfg.dividerColor}`} style={{ marginTop: 'calc(0.75rem * var(--fit-scale, 1))' }} />
      <p className={`flex-shrink-0 font-semibold leading-relaxed ${cfg.leadColor}`} style={{ marginTop: 'calc(1rem * var(--fit-scale, 1))', fontSize: 'clamp(10px, calc(4.05cqw * var(--fit-scale, 1)), 21px)' }}>
        {page.lead}
      </p>
      <ul className={`flex-shrink-0 leading-relaxed ${cfg.bulletColor}`} style={{ marginTop: 'calc(1.25rem * var(--fit-scale, 1))', fontSize: 'clamp(10px, calc(4.05cqw * var(--fit-scale, 1)), 21px)' }}>
        {page.bullets.slice(0, 6).map((bullet, index) => (
          <li className="grid grid-cols-[24px_1fr] gap-2" style={{ marginBottom: 'calc(0.75rem * var(--fit-scale, 1))' }} key={`${bullet}-${index}`}>
            <span className={`font-black ${cfg.bulletAccent}`}>{String(index + 1).padStart(2, '0')}</span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
