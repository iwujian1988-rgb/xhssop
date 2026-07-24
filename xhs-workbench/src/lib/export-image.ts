'use client';

import { toBlob } from 'html-to-image';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

/**
 * Renders a live DOM node (a code-rendered cover / inner page) into a PNG
 * blob at export resolution. This is the piece that was missing: previously
 * these covers only ever existed as on-screen HTML/CSS with no way to turn
 * them into a file the user could actually post to Xiaohongshu.
 */
export async function nodeToPngBlob(node: HTMLElement, pixelRatio = 3): Promise<Blob> {
  const blob = await toBlob(node, {
    pixelRatio,
    cacheBust: true,
    backgroundColor: '#ffffff',
    skipFonts: false,
  });
  if (!blob) throw new Error('导出失败：无法生成图片');
  return blob;
}

export async function exportNodeAsPng(node: HTMLElement, filename: string, pixelRatio = 3) {
  const blob = await nodeToPngBlob(node, pixelRatio);
  saveAs(blob, filename.endsWith('.png') ? filename : `${filename}.png`);
}

/**
 * For AI text-to-image covers the "content" is already a finished image
 * hosted on a third-party URL, not a DOM node. We try to fetch it as a blob
 * so the browser downloads a real file; if the host doesn't allow
 * cross-origin reads we fall back to opening the raw image in a new tab so
 * the user can save it manually (long-press / right-click save-as).
 */
export async function downloadImageUrl(url: string, filename: string): Promise<'downloaded' | 'opened'> {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    saveAs(blob, filename.endsWith('.png') || filename.endsWith('.jpg') ? filename : `${filename}.png`);
    return 'downloaded';
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    return 'opened';
  }
}

export interface ExportItem {
  filename: string;
  node?: HTMLElement | null;
  url?: string;
}

/**
 * Packs every asset of a finished note (cover + inner pages, whichever mix
 * of code-rendered nodes and AI-generated image URLs) into a single zip so
 * the whole post can be exported in one click.
 */
export async function exportAllAsZip(items: ExportItem[], zipName: string) {
  const zip = new JSZip();
  const failures: string[] = [];

  for (const item of items) {
    try {
      if (item.node) {
        zip.file(item.filename.endsWith('.png') ? item.filename : `${item.filename}.png`, await nodeToPngBlob(item.node));
      } else if (item.url) {
        const response = await fetch(item.url, { mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        zip.file(item.filename.endsWith('.png') || item.filename.endsWith('.jpg') ? item.filename : `${item.filename}.png`, blob);
      }
    } catch {
      failures.push(item.filename);
    }
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  saveAs(zipBlob, zipName.endsWith('.zip') ? zipName : `${zipName}.zip`);
  return { failures };
}
