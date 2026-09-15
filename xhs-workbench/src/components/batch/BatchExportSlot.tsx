'use client';

import { useEffect, useRef } from 'react';
import { InnerPageRenderer } from '@/components/templates/inner-pages/InnerPageRenderer';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';
import type { BatchJob } from '@/lib/batch-store';
import type { CompetitorCreativeCard } from '@/types/reference-workflow';
import { CoverTextEditor } from '@/components/draft/CoverTextEditor';
import { resolveCanonicalTitlePackage } from '@/lib/canonical-title-package';
import {displayInnerPages} from '@/lib/readable-inner-layout';

export interface ExportNodes {
  coverNode: HTMLElement | null;
  innerNodes: Map<number, HTMLElement>;
}

interface Props {
  job: BatchJob;
  card?: CompetitorCreativeCard;
  skinId?: string;
  onReady: (nodes: ExportNodes) => void;
}

const SLOT_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: '1080px',
  opacity: 0,
  pointerEvents: 'none',
  zIndex: -1,
  background: '#fff',
};

export function BatchExportSlot({ job, card, skinId, onReady }: Props) {
  const coverRef = useRef<HTMLDivElement | null>(null);
  const innerRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await document.fonts.ready;
      } catch {
        // ignore font loading failures
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (cancelled) return;
      onReady({
        coverNode: coverRef.current,
        innerNodes: new Map(innerRefs.current),
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  if (!job.draft || job.draft.downstreamStale || job.draft.manualInnerReview?.status === 'needs_review') return null;

  const spec = card ? getCoverTemplateSpec(card.renderer_id) : undefined;
  const isImageCover = !!card && spec?.renderMode === 'image_to_image';
  const hasImageUrl = !!job.cover_image_url;
  const renderCoverNode = !isImageCover || hasImageUrl;
  const titlePackage = resolveCanonicalTitlePackage(job.draft);
  const selectedBundleId = titlePackage.selectedBundleId || 'default';

  return (
    <div style={SLOT_STYLE} aria-hidden>
      {renderCoverNode ? (
        <div ref={coverRef}>
          {isImageCover && hasImageUrl ? (
            <img
              src={job.cover_image_url!}
              alt={job.draft.cover.title}
              style={{ width: '1080px', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }}
              crossOrigin="anonymous"
            />
          ) : (
            <CoverTextEditor
              key={`${job.draft.id}:${selectedBundleId}:${skinId || 'default'}`}
              draftId={job.draft.id}
              bundleId={selectedBundleId}
              renderer={card?.renderer_id || 'parchment_dense_directory'}
              payload={job.draft.cover}
              kicker={titlePackage.bundles.find(bundle => bundle.id === selectedBundleId)?.coverKicker}
              referenceImage={card?.reference_image}
              skinId={skinId}
              initialBlocks={job.draft.coverEditStates?.[selectedBundleId]?.blocks as never[] | undefined}
              registerCanvas={node => { coverRef.current = node; }}
              onStateChange={() => undefined}
            />
          )}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 540px)', gap: '16px', marginTop: '16px' }}>
        {displayInnerPages(job.draft).map(page => (
          <InnerPageRenderer
            key={page.page_no}
            page={page}
            registerNode={node => {
              if (node) innerRefs.current.set(page.page_no, node);
              else innerRefs.current.delete(page.page_no);
            }}
          />
        ))}
      </div>
    </div>
  );
}
