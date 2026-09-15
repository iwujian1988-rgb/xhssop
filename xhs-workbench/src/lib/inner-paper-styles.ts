import type {CSSProperties} from 'react';
import type {InnerPageStyleVariant} from '@/types/reference-workflow';
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

export const STYLE_CONFIGS: Record<InnerPageStyleVariant, StyleConfig> = {
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
