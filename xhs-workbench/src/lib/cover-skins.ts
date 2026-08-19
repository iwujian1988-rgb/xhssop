import type { CreativeCardRenderer } from '@/types/reference-workflow';

export interface CoverSkinOption {
  id: string;
  label: string;
  swatch: string;
}

const SKINS: Partial<Record<CreativeCardRenderer, CoverSkinOption[]>> = {
  parchment_dense_directory: [
    { id: 'parchment-warm', label: '暖黄旧纸', swatch: '#d8b982' },
    { id: 'parchment-cream', label: '奶油浅纸', swatch: '#eee1c3' },
    { id: 'parchment-sage', label: '灰绿旧纸', swatch: '#c8c7a6' },
    { id: 'parchment-rose', label: '浅棕红纸', swatch: '#d3ad98' },
  ],
  blackboard_phrase: blackboardSkins(),
  blackboard_offer: blackboardSkins(),
  notebook_big_words: [
    { id: 'notebook-ivory', label: '象牙白本', swatch: '#ddd5c0' },
    { id: 'notebook-warm', label: '暖黄纸本', swatch: '#d8c39b' },
    { id: 'notebook-gray', label: '灰白纸本', swatch: '#c8c8c2' },
    { id: 'notebook-sage', label: '浅绿纸本', swatch: '#c7ceba' },
  ],
  white_green_directory: paperSkins(),
  clean_purple_directory: paperSkins(),
  grid_purple_directory: paperSkins(),
};

function blackboardSkins(): CoverSkinOption[] {
  return [
    { id: 'board-forest', label: '墨绿黑板', swatch: '#173f2d' },
    { id: 'board-charcoal', label: '黑灰黑板', swatch: '#303331' },
    { id: 'board-teal', label: '青绿黑板', swatch: '#24504b' },
    { id: 'board-navy', label: '深蓝黑板', swatch: '#263c50' },
  ];
}

function paperSkins(): CoverSkinOption[] {
  return [
    { id: 'paper-original', label: '原版纸张', swatch: '#f7f7f2' },
    { id: 'paper-warm', label: '暖白纸张', swatch: '#f1ead9' },
    { id: 'paper-cool', label: '冷白纸张', swatch: '#edf2f1' },
    { id: 'paper-recycled', label: '再生纸色', swatch: '#e2decb' },
  ];
}

export function getCoverSkins(renderer?: CreativeCardRenderer): CoverSkinOption[] {
  return renderer ? SKINS[renderer] || [] : [];
}

export function getDefaultCoverSkin(renderer?: CreativeCardRenderer): string | null {
  return getCoverSkins(renderer)[0]?.id || null;
}

export function normalizeCoverSkin(renderer: CreativeCardRenderer | undefined, skinId?: string | null): string | null {
  const skins = getCoverSkins(renderer);
  if (!skins.length) return null;
  return skins.some(skin => skin.id === skinId) ? skinId! : skins[0].id;
}
