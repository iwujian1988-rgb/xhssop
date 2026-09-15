import type { CreativeCardRenderer } from '@/types/reference-workflow';

export type CoverBlockType = 'kicker' | 'title' | 'subtitle' | 'badge' | 'footer' | 'quantity' | 'section_name' | 'auxiliary';
export type CoverTextAlign = 'left' | 'center' | 'right';
export type CoverFontWeight = 400 | 500 | 600 | 700;

export interface CoverEditableBlock {
  id: string;
  type: CoverBlockType;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontWeight: CoverFontWeight;
  lineHeight: number;
  letterSpacing: number;
  align: CoverTextAlign;
  maxLines: number;
  visible: boolean;
  locked: boolean;
  minFontSize: number;
  maxFontSize: number;
  defaultValue: string;
  color?: string;
  fontFamily?: string;
  fontStyle?: string;
  textShadow?: string;
  webkitTextStroke?: string;
  textDecoration?: string;
  background?: string;
  borderRadius?: string;
  padding?: string;
}

export interface CoverEditSnapshot {
  blocks: CoverEditableBlock[];
  selectedIds: string[];
}

export interface PersistedCoverEditState extends CoverEditSnapshot {
  version: 5;
  updatedAt: string;
}

type CoverPreset = {
  color: string;
  accent: string;
  align: CoverTextAlign;
  title: Pick<CoverEditableBlock, 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'maxLines'>;
  subtitle: Pick<CoverEditableBlock, 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'maxLines'>;
  kicker: Pick<CoverEditableBlock, 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'maxLines'>;
};

const DEFAULT_PRESET: CoverPreset = {
  color: '#171717', accent: '#777', align: 'center',
  kicker: { x: 86, y: 52, width: 908, height: 52, fontSize: 27, maxLines: 1 },
  title: { x: 72, y: 105, width: 936, height: 205, fontSize: 70, maxLines: 3 },
  subtitle: { x: 105, y: 318, width: 870, height: 74, fontSize: 30, maxLines: 2 },
};

function presetFor(renderer?: CreativeCardRenderer): CoverPreset {
  if (renderer === 'white_green_directory') return { ...DEFAULT_PRESET, color: '#07852e', accent: '#397d50', title: { x: 64, y: 42, width: 952, height: 150, fontSize: 66, maxLines: 2 }, subtitle: { x: 100, y: 192, width: 880, height: 58, fontSize: 27, maxLines: 2 }, kicker: { x: 80, y: 16, width: 920, height: 34, fontSize: 20, maxLines: 1 } };
  if (renderer === 'clean_purple_directory' || renderer === 'grid_purple_directory') return { ...DEFAULT_PRESET, color: '#402060', accent: '#76598f' };
  if (renderer === 'parchment_dense_directory') return { ...DEFAULT_PRESET, color: '#54251e', accent: '#855d45' };
  if (renderer === 'blackboard_phrase' || renderer === 'blackboard_offer') return { ...DEFAULT_PRESET, color: '#fff8df', accent: '#f0dfaa' };
  if (renderer === 'pain_quote_big') return { ...DEFAULT_PRESET, align: 'left', title: { x: 78, y: 380, width: 924, height: 420, fontSize: 94, maxLines: 4 }, subtitle: { x: 80, y: 830, width: 900, height: 130, fontSize: 42, maxLines: 3 }, kicker: { x: 80, y: 110, width: 760, height: 55, fontSize: 27, maxLines: 1 } };
  if (renderer === 'plain_experience') return { ...DEFAULT_PRESET, align: 'left', title: { x: 70, y: 125, width: 930, height: 260, fontSize: 86, maxLines: 3 }, subtitle: { x: 70, y: 395, width: 920, height: 115, fontSize: 35, maxLines: 3 }, kicker: { x: 70, y: 70, width: 900, height: 44, fontSize: 24, maxLines: 1 } };
  return DEFAULT_PRESET;
}

function makeBlock(id: string, type: CoverBlockType, text: string, shape: CoverPreset['title'], color: string, align: CoverTextAlign, weight: CoverFontWeight): CoverEditableBlock {
  return { id, type, text, ...shape, fontWeight: weight, lineHeight: type === 'title' ? 1.08 : 1.22, letterSpacing: 0, align, visible: !!text, locked: false, minFontSize: type === 'title' ? 28 : 16, maxFontSize: type === 'title' ? 120 : 64, defaultValue: text, color, fontFamily: '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif' };
}

export function createDefaultCoverBlocks(input: { renderer?: CreativeCardRenderer; kicker?: string; title: string; subtitle?: string }): CoverEditableBlock[] {
  const preset = presetFor(input.renderer);
  return [
    makeBlock('coverKicker', 'kicker', input.kicker || '', preset.kicker, preset.accent, preset.align, 600),
    makeBlock('coverTitle', 'title', input.title, preset.title, preset.color, preset.align, 700),
    makeBlock('coverSubtitle', 'subtitle', input.subtitle || '', preset.subtitle, preset.accent, preset.align, 600),
  ];
}

export function coverEditorStorageKey(draftId: string, bundleId: string) {
  return `xhs-cover-edit:v5:${draftId}:${bundleId}`;
}

export function normalizeCoverBlock(block: CoverEditableBlock): CoverEditableBlock {
  return {
    ...block,
    x: Math.round(block.x), y: Math.round(block.y),
    width: Math.max(24, Math.round(block.width)), height: Math.max(24, Math.round(block.height)),
    fontSize: Math.max(block.minFontSize, Math.min(block.maxFontSize, Math.round(block.fontSize))),
    text: block.text.replace(/\r\n/g, '\n'),
  };
}
