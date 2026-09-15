import type { BatchJob } from '@/lib/batch-store';
import type { ReferenceDrivenDraft } from '@/types/reference-workflow';
import { resolveCanonicalTitlePackage, isTextTitleDeliveryReady } from '@/lib/canonical-title-package';

const INVALID_FOLDER_CHARS = /[\\/:*?"<>|]/g;
const TITLE_LIMIT = 30;

export function safeFolderName(raw: string): string {
  const cleaned = (raw || '').replace(INVALID_FOLDER_CHARS, '').trim();
  return cleaned.slice(0, TITLE_LIMIT) || 'untitled';
}

export function seqFolderName(index: number, total: number, title: string): string {
  const width = Math.max(2, String(total).length);
  const seq = String(index + 1).padStart(width, '0');
  return `${seq}-${safeFolderName(title)}`;
}

export async function fetchUrlAsBlobOrNull(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } catch {
    return null;
  }
}

function divider(title: string): string {
  return `==================================\n${title}\n==================================`;
}

export function buildBatchTxt(job: BatchJob, options: { coverStatus?: CoverStatus } = {}): string {
  const draft = job.draft;
  if (!draft) return '（无 draft 数据）';

  return buildDraftTxt(draft, options.coverStatus ?? inferCoverStatus(job));
}

/** 用户发布时真正需要复制的完整文字包。批量与单篇导出共用，避免生图任务漏字段。 */
export function assertDraftTitleReadyForExport(draft:ReferenceDrivenDraft, options: { allowStale?: boolean } = {}):void {
  if ((draft.downstreamStale && !options.allowStale) || draft.manualInnerReview?.status === 'needs_review') throw new Error('REVIEWED_DOWNSTREAM_STALE');
  const titlePackage = resolveCanonicalTitlePackage(draft);
  if(titlePackage.mode==='text_only') {
    if(!titlePackage.humanSelectedTextTitleId)throw new Error('TEXT_TITLE_AWAITING_HUMAN_CHOICE');
    if(!isTextTitleDeliveryReady(draft)) throw new Error('TEXT_TITLE_COVER_COPY_PENDING:请先在封面区确认模板并生成封面');
    return;
  }
  if (titlePackage.humanSelectedCandidateId === null) throw new Error('TITLE_AWAITING_HUMAN_CHOICE:请先人工选择标题');
}

export function buildDraftTxt(draft: ReferenceDrivenDraft, _coverStatus?: CoverStatus, options: { allowStale?: boolean } = {}): string {
  assertDraftTitleReadyForExport(draft, options);
  return [
    divider('标题'),
    draft.selected_title || '（空）',
    divider('封面标题'),
    [draft.cover.title || '（空）', draft.cover.subtitle ? `副标题：${draft.cover.subtitle}` : ''].filter(Boolean).join('\n'),
    divider('正文'),
    draft.caption,
  ].join('\n\n');
}

export type CoverStatus =
  | { kind: 'dom' }
  | { kind: 'image'; url: string; downloaded: boolean }
  | { kind: 'image_missing' }
  | { kind: 'unknown' };

function inferCoverStatus(job: BatchJob): CoverStatus {
  if (job.cover_image_url) return { kind: 'image', url: job.cover_image_url, downloaded: true };
  return { kind: 'dom' };
}
