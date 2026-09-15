import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import JSZip from 'jszip';

import { NextRequest, NextResponse } from 'next/server';
import { loadAllJobs } from '@/lib/batch-store';
import { assertDraftTitleReadyForExport } from '@/lib/batch-export';
import { stableHash } from '@/lib/v2/contracts';

export const runtime = 'nodejs';

const EXPORT_ROOT = path.resolve(process.cwd(), 'data/batch-exports');

function safeSessionId(value: unknown): string {
  const id = String(value || '');
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(id)) throw new Error('导出会话无效');
  return id;
}

function safeRelativePath(value: unknown): string {
  const segments = String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment === '.' || segment === '..' || /[\0:*?"<>|]/.test(segment))) {
    throw new Error('导出文件路径无效');
  }
  return segments.join(path.sep);
}

function sessionDir(sessionId: string) {
  const resolved = path.resolve(EXPORT_ROOT, sessionId);
  if (!resolved.startsWith(`${EXPORT_ROOT}${path.sep}`)) throw new Error('导出目录越界');
  return resolved;
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const sessionId = safeSessionId(form.get('session_id'));
      const relativePath = safeRelativePath(form.get('relative_path'));
      const file = form.get('file');
      if (!(file instanceof File)) throw new Error('缺少导出文件');

      const root = path.join(sessionDir(sessionId), 'files');
      const destination = path.resolve(root, relativePath);
      if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('导出文件路径越界');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, Buffer.from(await file.arrayBuffer()));
      return NextResponse.json({ ok: true });
    }

    const body = await request.json() as {
      action?: string;
      batch_id?: string;
      session_id?: string;
      expected_files?: string[];
      ready_job_ids?: string[];
      stale_export_confirmed_job_ids?: string[];
    };
    if (body.action === 'init') {
      const batchId = String(body.batch_id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || 'batch';
      const sessionId = `${batchId}_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const jobs = await loadAllJobs(batchId);
      const reviewedInnerHashes = Object.fromEntries(jobs.map(job => [job.id, job.artifacts?.content?.data.manualInnerReview?.innerHash || null]));
      const reviewedTitleHashes = Object.fromEntries(jobs.map(job=>[job.id,stableHash({selected:job.draft?.titlePackage?.humanSelectedTextTitleId,copy:job.draft?.coverCopy})]));
      await fs.mkdir(path.join(sessionDir(sessionId), 'files'), { recursive: true });
      await fs.writeFile(path.join(sessionDir(sessionId), 'session.json'), JSON.stringify({ batchId, reviewedInnerHashes, reviewedTitleHashes }), 'utf8');
      return NextResponse.json({ session_id: sessionId });
    }

    if (body.action === 'finalize') {
      const sessionId = safeSessionId(body.session_id);
      const root = sessionDir(sessionId);
      const filesDir = path.join(root, 'files');
      const zipPath = path.join(root, 'batch-export.zip');
      const session = JSON.parse(await fs.readFile(path.join(root, 'session.json'), 'utf8')) as { batchId?: string; reviewedInnerHashes?: Record<string, string | null>; reviewedTitleHashes?:Record<string,string> };
      const requestedReadyIds = Array.isArray(body.ready_job_ids) ? body.ready_job_ids.map(String) : [];
      const staleConfirmedIds = new Set(Array.isArray(body.stale_export_confirmed_job_ids) ? body.stale_export_confirmed_job_ids.map(String) : []);
      const jobs = session.batchId ? await loadAllJobs(session.batchId) : [];
      if (jobs.some(job => requestedReadyIds.includes(job.id) && job.artifacts?.content?.data.manualInnerReview
        && session.reviewedInnerHashes?.[job.id] !== job.artifacts.content.data.manualInnerReview.innerHash)) {
        return NextResponse.json({ error: '正文审校版本已变化，请重新导出，不能复用旧导出会话' }, { status: 409 });
      }
      for (const job of jobs.filter(job=>requestedReadyIds.includes(job.id))) {
        if (!job.draft) throw new Error('EXPORT_DRAFT_MISSING');
        const stale = Boolean(job.draft.downstreamStale);
        if (stale && !staleConfirmedIds.has(job.id)) throw new Error('STALE_EXPORT_CONFIRMATION_REQUIRED');
        assertDraftTitleReadyForExport(job.draft, { allowStale: stale && staleConfirmedIds.has(job.id) });
        if(job.draft.titlePackage?.mode==='text_only' && session.reviewedTitleHashes?.[job.id]!==stableHash({selected:job.draft.titlePackage.humanSelectedTextTitleId,copy:job.draft.coverCopy})) throw new Error('EXPORT_TITLE_VERSION_CHANGED');
      }
      const actualReady = new Set(jobs.filter(job => job.commercial?.status === 'READY' || (job.draft?.downstreamStale && staleConfirmedIds.has(job.id))).map(job => job.id));
      if (!requestedReadyIds.length || requestedReadyIds.some(id => !actualReady.has(id))) {
        return NextResponse.json({ error: '最终商用ZIP只能包含当前状态为READY的Job' }, { status: 409 });
      }
      await fs.access(filesDir);
      const expectedFiles = Array.isArray(body.expected_files)
        ? body.expected_files.map(safeRelativePath)
        : [];
      if (!expectedFiles.length) {
        return NextResponse.json({ error: 'ZIP导出清单为空，已停止生成空压缩包' }, { status: 409 });
      }
      const missingFiles: string[] = [];
      const emptyFiles: string[] = [];
      for (const relativePath of expectedFiles) {
        const target = path.resolve(filesDir, relativePath);
        if (!target.startsWith(`${filesDir}${path.sep}`)) throw new Error('导出清单路径越界');
        try {
          const stat = await fs.stat(target);
          if (!stat.isFile() || stat.size === 0) emptyFiles.push(relativePath.split(path.sep).join('/'));
        } catch {
          missingFiles.push(relativePath.split(path.sep).join('/'));
        }
      }
      if (missingFiles.length) {
        return NextResponse.json({
          error: `ZIP缺页：${missingFiles.join('、')}`,
          missing_files: missingFiles,
        }, { status: 409 });
      }
      if (emptyFiles.length) {
        return NextResponse.json({
          error: `ZIP包含空文件：${emptyFiles.join('、')}`,
          empty_files: emptyFiles,
        }, { status: 409 });
      }
      const staleManifest = Object.fromEntries(jobs.filter(job => requestedReadyIds.includes(job.id) && job.draft?.downstreamStale).map(job => [job.id, {
        stale: true,
        currentInnerHash: job.draft?.manualInnerReview?.innerHash || null,
        artifactSourceInnerHash: job.draft?.downstreamSourceInnerHash || null,
      }]));
      await fs.writeFile(path.join(root, 'page-manifest.json'), JSON.stringify({ expectedFiles, missingFiles: [], staleArtifacts: staleManifest, verifiedAt: new Date().toISOString() }, null, 2), 'utf8');
      // Build from the verified READY manifest only. JSZip writes standard
      // UTF-8 ZIP entries without tar.exe's "./" root entry, which Windows
      // Explorer can reject when Chinese/emoji paths are present.
      const zip = new JSZip();
      for (const relativePath of expectedFiles) {
        const source = path.resolve(filesDir, relativePath);
        const archivePath = relativePath.split(path.sep).join('/');
        zip.file(archivePath, createReadStream(source));
      }
      await pipeline(
        zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE', platform: 'DOS' }),
        createWriteStream(zipPath),
      );
      const zipStat = await fs.stat(zipPath);
      if (!zipStat.isFile() || zipStat.size === 0) throw new Error('ZIP生成结果为空');
      const verifiedZip = await JSZip.loadAsync(await fs.readFile(zipPath), { checkCRC32: true });
      const archiveEntries = Object.keys(verifiedZip.files);
      if (archiveEntries.some(entry => entry === '/' || entry === './' || entry.startsWith('./'))) {
        throw new Error('ZIP包含Windows不兼容的根目录项');
      }
      const missingArchiveEntries = expectedFiles
        .map(relativePath => relativePath.split(path.sep).join('/'))
        .filter(relativePath => !verifiedZip.file(relativePath));
      if (missingArchiveEntries.length) throw new Error(`ZIP打包后缺页：${missingArchiveEntries.join('、')}`);
      return NextResponse.json({
        download_url: `/api/batch-export?session_id=${encodeURIComponent(sessionId)}`,
        missing_files: [],
        file_count: expectedFiles.length,
        zip_size: zipStat.size,
      });
    }

    return NextResponse.json({ error: '未知导出动作' }, { status: 400 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '批量导出失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const sessionId = safeSessionId(request.nextUrl.searchParams.get('session_id'));
    const zipPath = path.join(sessionDir(sessionId), 'batch-export.zip');
    const stat = await fs.stat(zipPath);
    const stream = Readable.toWeb(createReadStream(zipPath));
    return new NextResponse(stream as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename="batch-${sessionId}.zip"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '导出文件不存在';
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
