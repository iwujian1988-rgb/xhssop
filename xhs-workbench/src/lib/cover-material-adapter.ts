import type { NoteFormat, PageVisualType } from '@/types/content-planning';

export type VisualTemplateId =
  | 'parchment_structured'
  | 'grammar_clean_purple'
  | 'grammar_grid_purple'
  | 'grammar_white_green'
  | 'notebook_pain'
  | 'document_analysis';

export type CoverMaterialStatus = 'ready' | 'fallback' | 'blocked';

export interface StructuredSection {
  title: string;
  rows: string[][];
}

export interface CoverMaterial {
  template_id: VisualTemplateId;
  status: CoverMaterialStatus;
  reason: string;
  cover_title: string;
  content_shape: 'table' | 'checklist' | 'big_words' | 'document';
  sections: StructuredSection[];
  main_lines: string[];
  checks: {
    schema_ok: boolean;
    density_ok: boolean;
    text_length_ok: boolean;
    template_fit_ok: boolean;
    issues: string[];
  };
}

interface AdapterInput {
  note_format: NoteFormat;
  cover_title: string;
  cover_subtitle: string;
  evidence: string;
  pages: Array<{
    page_no: number;
    visual_type: PageVisualType;
    page_title: string;
    main_text: string;
    bullets: string[];
  }>;
}

export function buildCoverMaterial(input: AdapterInput): CoverMaterial {
  const text = [
    input.cover_title,
    input.cover_subtitle,
    input.evidence,
    ...input.pages.flatMap(page => [page.page_title, page.main_text, ...page.bullets]),
  ].join(' ');
  const evidenceText = input.evidence;

  const hasTableSignal =
    input.pages.some(page => ['table', 'wrong_right'].includes(page.visual_type)) ||
    /词汇|表达|句型|语法|体系|分类|替换|连接词|疑问|观点|对照/.test(evidenceText);
  const hasChecklistSignal =
    input.note_format === 'self_test' ||
    input.pages.some(page => page.visual_type === 'checklist') ||
    /36|清单|检查|自查|自评|扣分/.test(evidenceText);
  const hasDocumentSignal =
    input.pages.some(page => page.visual_type === 'doc_sample') ||
    /范文|原文|素材|解析|组合示例|仿写/.test(evidenceText);
  const hasFlowSignal = input.pages.some(page => page.visual_type === 'flow') && /路径|计划|步骤|流程/.test(evidenceText);

  if (hasChecklistSignal) {
    return finalize({
      template_id: 'parchment_structured',
      reason: 'content_is_checklist_or_last_minute_audit',
      cover_title: firstLine(input.cover_title),
      content_shape: 'checklist',
      sections: [{
        title: input.pages.some(page => page.visual_type === 'self_test') ? '自测题' : '最后检查',
        rows: input.pages
          .filter(page => ['checklist', 'self_test'].includes(page.visual_type))
          .flatMap(page => page.bullets)
          .slice(0, 14)
          .map(item => [shorten(item, 18), '必查']),
      }],
      main_lines: lines(input.cover_title, 3),
    });
  }

  if (hasDocumentSignal) {
    return finalize({
      template_id: 'document_analysis',
      reason: 'content_is_document_or_sample_breakdown',
      cover_title: firstLine(input.cover_title),
      content_shape: 'document',
      sections: [{
        title: '解析重点',
        rows: input.pages
          .filter(page => ['doc_sample', 'directory'].includes(page.visual_type))
          .flatMap(page => page.bullets)
          .slice(0, 8)
          .map(item => [shorten(item, 20)]),
      }],
      main_lines: lines(input.cover_title, 3),
    });
  }

  if (hasFlowSignal) {
    const proofSteps = input.pages
      .filter(page => page.page_no === 3 || page.page_no === 4)
      .flatMap(page => page.bullets);
    return finalize({
      template_id: 'parchment_structured',
      reason: 'content_is_structured_roadmap',
      cover_title: firstLine(input.cover_title),
      content_shape: 'checklist',
      sections: [{ title: '学习路径', rows: proofSteps.slice(0, 12).map((item, index) => [`${index + 1}`, shorten(item, 18)]) }],
      main_lines: lines(input.cover_title, 3),
    });
  }

  if (hasTableSignal) {
    const template: VisualTemplateId = /体系|语法|疑问/.test(text)
      ? 'grammar_clean_purple'
      : 'grammar_grid_purple';
    return finalize({
      template_id: template,
      reason: template === 'grammar_clean_purple'
        ? 'content_can_be_grouped_as_grammar_rows'
        : 'content_can_be_grouped_as_dense_table',
      cover_title: firstLine(input.cover_title),
      content_shape: 'table',
      sections: tableSections(input, template),
      main_lines: lines(input.cover_title, 3),
    });
  }

  return finalize({
    template_id: 'notebook_pain',
    reason: 'content_is_not_structured_enough_use_big_word_fallback',
    cover_title: firstLine(input.cover_title),
    content_shape: 'big_words',
    sections: [],
    main_lines: lines(input.cover_title, 4),
    fallback: true,
  });
}

function tableSections(input: AdapterInput, template: VisualTemplateId): StructuredSection[] {
  const proofPages = input.pages.filter(page => ['table', 'wrong_right', 'directory'].includes(page.visual_type));
  const rows = proofPages.flatMap(page => page.bullets).map(toCells).filter(row => row.length >= 2);
  const midpoint = Math.max(1, Math.ceil(rows.length / 2));

  if (template === 'grammar_clean_purple') {
    return [
      { title: proofPages[0]?.page_title || '核心内容', rows: rows.slice(0, midpoint) },
      { title: proofPages[1]?.page_title || '继续整理', rows: rows.slice(midpoint) },
    ];
  }

  return [
    { title: proofPages[0]?.page_title || '一、核心整理', rows: rows.slice(0, midpoint) },
    { title: proofPages[1]?.page_title || '二、继续整理', rows: rows.slice(midpoint) },
  ];
}

function toCells(value: string) {
  const normalized = value.replace(/\s*[→⇒]\s*/g, '|').replace(/[：:]/, '|');
  const cells = normalized.split('|').map(cell => shorten(cell, 20)).filter(Boolean);
  return cells.length >= 2 ? cells : [shorten(value, 20), ''];
}

function finalize(input: {
  template_id: VisualTemplateId;
  reason: string;
  cover_title: string;
  content_shape: CoverMaterial['content_shape'];
  sections: StructuredSection[];
  main_lines: string[];
  fallback?: boolean;
}): CoverMaterial {
  const issues: string[] = [];
  const schemaOk = input.content_shape === 'big_words' || input.sections.every(section => section.title && Array.isArray(section.rows));
  const rowCount = input.sections.reduce((sum, section) => sum + section.rows.length, 0);
  const densityOk = input.content_shape === 'big_words' || rowCount >= 6;
  const textLengthOk =
    input.sections.every(section => section.rows.every(row => row.every(cell => cell.length <= 20))) &&
    input.main_lines.every(line => line.length <= 18);
  const templateFitOk = input.content_shape !== 'table' || input.sections.length >= 2;

  if (!schemaOk) issues.push('schema_incomplete');
  if (!densityOk) issues.push('density_too_low');
  if (!textLengthOk) issues.push('text_too_long_for_template');
  if (!templateFitOk) issues.push('template_shape_mismatch');

  return {
    template_id: input.template_id,
    status: issues.length ? 'blocked' : input.fallback ? 'fallback' : 'ready',
    reason: input.reason,
    cover_title: input.cover_title,
    content_shape: input.content_shape,
    sections: input.sections,
    main_lines: input.main_lines,
    checks: {
      schema_ok: schemaOk,
      density_ok: densityOk,
      text_length_ok: textLengthOk,
      template_fit_ok: templateFitOk,
      issues,
    },
  };
}

function firstLine(value: string) {
  return lines(value, 1)[0] || value;
}

function lines(value: string, max: number) {
  return value.split('\n').map(item => item.trim()).filter(Boolean).slice(0, max);
}

function shorten(value: string, max: number) {
  const text = value.replace(/[，。；：]/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) : text;
}
