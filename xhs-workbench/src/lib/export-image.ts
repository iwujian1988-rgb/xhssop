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
export interface PngExportOptions {
  targetWidth?: number;
  targetHeight?: number;
}

const DEFAULT_EXPORT_SIZE = { targetWidth: 1080, targetHeight: 1440 } as const;

async function normalizePngSize(blob: Blob, targetWidth: number, targetHeight: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width === targetWidth && bitmap.height === targetHeight) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('导出失败：无法创建固定尺寸画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    const normalized = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!normalized) throw new Error('导出失败：无法生成固定尺寸图片');
    return normalized;
  } finally {
    bitmap.close();
  }
}

export async function nodeToPngBlob(
  node: HTMLElement,
  options: PngExportOptions = DEFAULT_EXPORT_SIZE,
): Promise<Blob> {
  const targetWidth = options.targetWidth ?? DEFAULT_EXPORT_SIZE.targetWidth;
  const targetHeight = options.targetHeight ?? DEFAULT_EXPORT_SIZE.targetHeight;
  const previousExportState = node.getAttribute('data-exporting');
  const editorOnlyNodes = Array.from(node.querySelectorAll<HTMLElement>('[data-editor-only]'));
  const editableTextNodes = Array.from(node.querySelectorAll<HTMLElement>('[data-cover-block-id]'));
  const originalEditorStyles = editorOnlyNodes.map(element => element.style.cssText);
  const originalTextStyles = editableTextNodes.map(element => element.style.cssText);
  node.setAttribute('data-exporting', 'true');
  editorOnlyNodes.forEach(element => element.style.setProperty('display', 'none', 'important'));
  editableTextNodes.forEach(element => {
    element.style.setProperty('box-shadow', 'none', 'important');
    element.style.setProperty('outline', 'none', 'important');
  });
  try {
    if (document.fonts?.ready) await document.fonts.ready;
    // WYSIWYG: visual-fit diagnostics must not veto the user's edited layout.
    // Preserve text and geometry; crop overflow at the existing canvas edge.
    const countedNodes = Array.from(node.querySelectorAll<HTMLElement>('[data-source-item-count]'));
    for (const counted of countedNodes) {
      const sourceCount = Number(counted.dataset.sourceItemCount || 0);
      const renderedCount = counted.querySelectorAll('[data-render-item="true"]').length;
      if (sourceCount !== renderedCount) throw new Error(`导出失败：页面内容项被静默丢失（source=${sourceCount}, rendered=${renderedCount}）`);
    }
    const sourceWidth = Math.max(node.offsetWidth, node.getBoundingClientRect().width, 1);
    const sourceHeight = Math.max(node.offsetHeight, node.getBoundingClientRect().height, 1);
    const renderPixelRatio = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight, 1);
    const blob = await toBlob(node, {
      pixelRatio: renderPixelRatio,
      cacheBust: true,
      backgroundColor: '#ffffff',
      skipFonts: false,
      // Applied only to the export clone; the live editor is not resized.
      style: { overflow: 'hidden' },
    });
    if (!blob) throw new Error('导出失败：无法生成图片');
    return await normalizePngSize(blob, targetWidth, targetHeight);
  } finally {
    editorOnlyNodes.forEach((element, index) => { element.style.cssText = originalEditorStyles[index]; });
    editableTextNodes.forEach((element, index) => { element.style.cssText = originalTextStyles[index]; });
    if (previousExportState === null) node.removeAttribute('data-exporting');
    else node.setAttribute('data-exporting', previousExportState);
  }
}

export async function exportNodeAsPng(node: HTMLElement, filename: string, options?: PngExportOptions) {
  const blob = await nodeToPngBlob(node, options);
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
  text?: string;
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
      if (typeof item.text === 'string') {
        zip.file(item.filename, item.text);
      } else if (item.node) {
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
