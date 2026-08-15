import type { BatchJob } from '@/lib/batch-store';

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

  const sections: string[] = [];

  sections.push(divider('选中标题'));
  sections.push(draft.selected_title || '（空）');

  if (draft.title_candidates?.length) {
    sections.push(divider(`候选标题（共 ${draft.title_candidates.length} 条）`));
    sections.push(
      draft.title_candidates
        .map(tc => {
          const head = `[${tc.trigger_type || tc.title_type || '未分类'}] ${tc.title}`;
          const meta = `  公式 #${tc.formula_id}${tc.reason ? ` · ${tc.reason}` : ''}`;
          return `${head}\n${meta}`;
        })
        .join('\n'),
    );
  }

  if (draft.cover_title_candidates?.length) {
    sections.push(divider(`备用封面标题（共 ${draft.cover_title_candidates.length} 条）`));
    sections.push(
      draft.cover_title_candidates
        .map(c => {
          const lines = [`${c.template_id} · ${c.title_type || '封面'}`, `  ${c.title}`];
          if (c.subtitle) lines.push(`  副标题：${c.subtitle}`);
          if (c.reason) lines.push(`  理由：${c.reason}`);
          return lines.join('\n');
        })
        .join('\n'),
    );
  }

  sections.push(divider(`正文（${draft.caption.length} 字）`));
  sections.push(draft.caption);

  sections.push(divider('Tag（直接粘贴到小红书）'));
  sections.push(draft.tags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(' '));

  if (draft.seo_keywords?.length) {
    sections.push(divider('搜索关键词'));
    sections.push(draft.seo_keywords.join(', '));
  }

  sections.push(divider('封面'));
  sections.push(formatCoverStatus(options.coverStatus ?? inferCoverStatus(job)));

  return sections.join('\n\n');
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

function formatCoverStatus(status: CoverStatus): string {
  switch (status.kind) {
    case 'dom':
      return '代码渲染封面（已随包导出 PNG）';
    case 'image':
      return status.downloaded
        ? `AI 文生图（已随包导出）\n原 URL：${status.url}`
        : `AI 文生图跨域下载失败，封面未入包。\n请手动打开以下 URL 保存：\n${status.url}`;
    case 'image_missing':
      return 'AI 文生图模板，但封面未生成（cover_image_url 为空）。';
    case 'unknown':
      return '封面状态未知。';
  }
}
