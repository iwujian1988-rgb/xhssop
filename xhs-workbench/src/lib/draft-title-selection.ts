import type { ReferenceDrivenDraft } from '@/types/reference-workflow';
import { resolveCanonicalTitlePackage, withCanonicalTitlePackage } from '@/lib/canonical-title-package';

export interface DraftTitleSelection {
  candidateIndex: number;
  bundleId?: string;
  textTitle: string;
  coverKicker?: string;
  coverTitle: string;
  coverSubtitle: string;
}

export function getDraftTitleSelection(draft: ReferenceDrivenDraft, candidateIndex: number): DraftTitleSelection {
  const titlePackage = resolveCanonicalTitlePackage(draft);
  const safeIndex = Math.max(0, Math.min(candidateIndex, Math.max(titlePackage.bundles.length - 1, 0)));
  const bundle = titlePackage.bundles[safeIndex];
  const textCandidate = draft.title_candidates[safeIndex];
  const coverCandidate = draft.cover_title_candidates?.[safeIndex];
  return {
    candidateIndex: safeIndex,
    bundleId: bundle?.id,
    textTitle: bundle?.textTitle || textCandidate?.title || draft.selected_title,
    coverKicker: bundle?.coverKicker,
    coverTitle: bundle?.coverTitle || coverCandidate?.title || draft.cover.title,
    coverSubtitle: bundle?.coverSubtitle || coverCandidate?.subtitle || draft.cover.subtitle,
  };
}

export function findSelectedTitleIndex(draft: ReferenceDrivenDraft) {
  const titlePackage = resolveCanonicalTitlePackage(draft);
  if (titlePackage.selectedBundleId) {
    const bundleIndex = titlePackage.bundles.findIndex(item => item.id === titlePackage.selectedBundleId);
    if (bundleIndex >= 0) return bundleIndex;
  }
  const index = draft.title_candidates.findIndex(candidate => candidate.title === draft.selected_title);
  return index >= 0 ? index : 0;
}

export function applyDraftTitleSelection(draft: ReferenceDrivenDraft, selection?: DraftTitleSelection | null, humanConfirmed = false): ReferenceDrivenDraft {
  if (!selection) return draft;
  const current = resolveCanonicalTitlePackage(draft);
  if(current.mode==='text_only') {
    const candidate=current.humanSelectableTextTitles?.find(c=>c.id===selection.bundleId);
    if(!candidate)throw new Error('TEXT_TITLE_CANDIDATE_NOT_FOUND');
    // Ignore caller-supplied text/cover fields; selection is from the immutable pool.
    const chosenId=humanConfirmed?candidate.id:current.humanSelectedTextTitleId;
    const chosen=current.humanSelectableTextTitles?.find(c=>c.id===chosenId);
    const changed=humanConfirmed && current.humanSelectedTextTitleId!==candidate.id;
    return withCanonicalTitlePackage({...draft,selected_title:chosen?.textTitle || '',selected_bundle_id:candidate.id,
      ...(changed?{coverSelection:undefined,coverCopy:undefined,cover:{kind:'dense_directory' as const,title:'',subtitle:'',sections:[]},coverEditStates:undefined,cover_edit_meta:undefined}:{}),
    },{
      selectedBundleId:candidate.id,
      humanSelectedTextTitleId:chosenId || null,
      humanSelectedCandidateId:null,
    });
  }
  if (humanConfirmed && !current.bundles.some(b => b.id === selection.bundleId)) throw new Error('TITLE_CANDIDATE_NOT_FOUND');
  return withCanonicalTitlePackage({
    ...draft,
    selected_title: selection.textTitle,
    selected_bundle_id: selection.bundleId,
    cover: {
      ...draft.cover,
      title: selection.coverTitle,
      subtitle: selection.coverSubtitle,
    },
  }, { selectedBundleId: selection.bundleId,
    ...(current.humanSelectedCandidateId !== undefined ? { humanSelectedCandidateId: humanConfirmed
      ? selection.bundleId! : current.humanSelectedCandidateId === selection.bundleId ? current.humanSelectedCandidateId : null } : {}),
  });
}
