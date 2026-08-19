import type { ReferenceDrivenDraft } from '@/types/reference-workflow';

export interface DraftTitleSelection {
  candidateIndex: number;
  textTitle: string;
  coverTitle: string;
  coverSubtitle: string;
}

export function getDraftTitleSelection(draft: ReferenceDrivenDraft, candidateIndex: number): DraftTitleSelection {
  const safeIndex = Math.max(0, Math.min(candidateIndex, Math.max(draft.title_candidates.length - 1, 0)));
  const textCandidate = draft.title_candidates[safeIndex];
  const coverCandidate = draft.cover_title_candidates?.[safeIndex];
  return {
    candidateIndex: safeIndex,
    textTitle: textCandidate?.title || draft.selected_title,
    coverTitle: coverCandidate?.title || draft.cover.title,
    coverSubtitle: coverCandidate?.subtitle || draft.cover.subtitle,
  };
}

export function findSelectedTitleIndex(draft: ReferenceDrivenDraft) {
  const index = draft.title_candidates.findIndex(candidate => candidate.title === draft.selected_title);
  return index >= 0 ? index : 0;
}

export function applyDraftTitleSelection(draft: ReferenceDrivenDraft, selection?: DraftTitleSelection | null): ReferenceDrivenDraft {
  if (!selection) return draft;
  return {
    ...draft,
    selected_title: selection.textTitle,
    cover: {
      ...draft.cover,
      title: selection.coverTitle,
      subtitle: selection.coverSubtitle,
    },
  };
}
