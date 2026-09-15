import type {
  DraftTitleBundle,
  DraftTitlePackage,
  ReferenceDrivenDraft,
} from '@/types/reference-workflow';

export type TitleBundleSource =
  | 'current_title_bundles'
  | 'legacy_candidates'
  | 'legacy_two_bundle_draft';

export interface CanonicalTitlePackage {
  sourceInnerHash?: string;
  mode?: 'text_only';
  fixedCoverTitle?: string;
  humanSelectedTextTitleId?: string | null;
  humanSelectedCoverTitleId?: string | null;
  humanSelectableTextTitles?: DraftTitlePackage['humanSelectableTextTitles'];
  humanSelectedCandidateId?: string | null;
  bundles: DraftTitleBundle[];
  source: TitleBundleSource;
  contentSnapshotHash?: string;
  productionBriefHash?: string;
  schemaVersion?: string;
  titlePackageVersion?: string;
  recommendedBundleId?: string;
  selectedBundleId?: string;
}

function legacyBundles(draft: ReferenceDrivenDraft): DraftTitleBundle[] {
  return (draft.title_candidates || []).map((title, index) => ({
    id: `legacy_${index}`,
    slotId: index === 0 ? 'primary' : index === 1 ? 'secondary' : undefined,
    clickMode: title.trigger_type || '标题',
    clickReason: title.reason || '',
    textTitle: title.title,
    coverTitle: draft.cover_title_candidates?.[index]?.title || draft.cover.title,
    coverSubtitle: draft.cover_title_candidates?.[index]?.subtitle || draft.cover.subtitle,
  }));
}

export function resolveCanonicalTitlePackage(draft: ReferenceDrivenDraft): CanonicalTitlePackage {
  const titlePackage = draft.titlePackage;
  const current = titlePackage?.titleBundles?.length
    ? titlePackage.titleBundles
    : draft.title_bundles?.length
      ? draft.title_bundles
      : undefined;
  const packageCandidates = titlePackage?.candidates?.length ? titlePackage.candidates : undefined;
  const bundles = current || packageCandidates || legacyBundles(draft);
  const source: TitleBundleSource = current
    ? 'current_title_bundles'
    : packageCandidates
      ? 'legacy_candidates'
      : bundles.length === 2
        ? 'legacy_two_bundle_draft'
        : 'legacy_candidates';
  const validIds = new Set(bundles.map(bundle => bundle.id));
  const selectedCandidate = titlePackage?.selectedBundleId || draft.selected_bundle_id;
  const recommendedCandidate = titlePackage?.recommendedBundleId || draft.recommended_bundle_id;

  return {
    bundles,
    sourceInnerHash:titlePackage?.sourceInnerHash,
    mode:titlePackage?.mode,
    fixedCoverTitle:titlePackage?.fixedCoverTitle,
    humanSelectableTextTitles:titlePackage?.humanSelectableTextTitles,
    humanSelectedTextTitleId:titlePackage?.mode==='text_only'
      ? titlePackage.humanSelectableTextTitles?.some(c=>c.id===titlePackage.humanSelectedTextTitleId) ? titlePackage.humanSelectedTextTitleId : null
      : undefined,
    humanSelectedCoverTitleId:titlePackage?.mode==='text_only'
      ? titlePackage.humanSelectableTextTitles?.some(c=>c.id===titlePackage.humanSelectedCoverTitleId) ? titlePackage.humanSelectedCoverTitleId : null
      : undefined,
    humanSelectedCandidateId: titlePackage?.humanSelectedCandidateId == null
      ? titlePackage?.humanSelectedCandidateId
      : validIds.has(titlePackage.humanSelectedCandidateId) ? titlePackage.humanSelectedCandidateId : null,
    source,
    contentSnapshotHash: titlePackage?.contentSnapshotHash,
    productionBriefHash: titlePackage?.productionBriefHash,
    schemaVersion: titlePackage?.schemaVersion,
    titlePackageVersion: titlePackage?.titlePackageVersion,
    recommendedBundleId: recommendedCandidate && validIds.has(recommendedCandidate)
      ? recommendedCandidate
      : undefined,
    selectedBundleId: selectedCandidate && validIds.has(selectedCandidate)
      ? selectedCandidate
      : recommendedCandidate && validIds.has(recommendedCandidate)
        ? recommendedCandidate
        : bundles[0]?.id,
  };
}

/** Future Cover Copy callers must use this explicit human selection, never preview. */
export function requireHumanSelectedTextTitle(draft:ReferenceDrivenDraft) {
  const current=resolveCanonicalTitlePackage(draft);
  const selected=current.humanSelectableTextTitles?.find(c=>c.id===current.humanSelectedTextTitleId);
  if(!selected) throw new Error('TEXT_TITLE_AWAITING_HUMAN_CHOICE');
  return selected;
}

export function requireHumanSelectedCoverTitle(draft:ReferenceDrivenDraft) {
  const current=resolveCanonicalTitlePackage(draft);
  const selected=current.humanSelectableTextTitles?.find(c=>c.id===current.humanSelectedCoverTitleId);
  if(!selected) throw new Error('COVER_TITLE_AWAITING_HUMAN_CHOICE');
  return selected;
}

export function hasHumanTitleSelection(draft:ReferenceDrivenDraft) {
  const current=resolveCanonicalTitlePackage(draft);
  return current.mode==='text_only' ? Boolean(current.humanSelectedTextTitleId) : current.humanSelectedCandidateId !== null;
}

export function hasHumanCoverTitleSelection(draft:ReferenceDrivenDraft) {
  const current=resolveCanonicalTitlePackage(draft);
  return current.mode==='text_only' ? Boolean(current.humanSelectedCoverTitleId) : true;
}

export function isTextTitleDeliveryReady(draft:ReferenceDrivenDraft) {
  const current=resolveCanonicalTitlePackage(draft);
  if(current.mode!=='text_only')return true;
  const selected=current.humanSelectableTextTitles?.find(c=>c.id===current.humanSelectedTextTitleId);
  const selectedCover=current.humanSelectableTextTitles?.find(c=>c.id===current.humanSelectedCoverTitleId);
  return Boolean(selected && selectedCover && draft.selected_title===selected.textTitle && draft.manualInnerReview?.status==='locked'
    && current.sourceInnerHash===draft.manualInnerReview.innerHash && draft.coverCopy?.status==='complete'
    && draft.coverCopy.titleId===selected.id && draft.coverCopy.coverTitleId===selectedCover.id
    && draft.coverCopy.coverTitle===selectedCover.textTitle && draft.coverCopy.sourceInnerHash===current.sourceInnerHash
    && draft.coverCopy.requestId && draft.cover.title.trim()
    && (!draft.coverSelection || (draft.coverSelection.downstreamComplete && draft.coverSelection.confirmedTemplateId === draft.selectedCoverTemplateId
      && draft.coverSelection.titleId === selected.id && draft.coverSelection.coverTitleId === selectedCover.id
      && draft.coverSelection.sourceInnerHash === current.sourceInnerHash)));
}

export function withCanonicalTitlePackage(
  draft: ReferenceDrivenDraft,
  packagePatch: Partial<DraftTitlePackage> = {},
): ReferenceDrivenDraft {
  const current = resolveCanonicalTitlePackage(draft);
  const titlePackage: DraftTitlePackage = {
    ...draft.titlePackage,
    ...packagePatch,
    titleBundles: packagePatch.titleBundles || current.bundles,
    recommendedBundleId: packagePatch.recommendedBundleId || current.recommendedBundleId,
    selectedBundleId: packagePatch.selectedBundleId || current.selectedBundleId,
    source: 'current_title_bundles',
  };
  return {
    ...draft,
    titlePackage,
    title_bundles: titlePackage.titleBundles,
    recommended_bundle_id: titlePackage.recommendedBundleId,
    selected_bundle_id: titlePackage.selectedBundleId,
  };
}
