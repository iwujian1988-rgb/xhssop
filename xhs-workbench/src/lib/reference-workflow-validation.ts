import type {
  CreativeCardRenderer,
  DenseDirectoryCoverPayload,
  DenseDirectorySection,
  ReferenceDrivenDraft,
} from '@/types/reference-workflow';
import { getCoverTemplateSpec } from '@/lib/cover-template-specs';

export function normalizeDenseDirectoryCover(value: unknown): DenseDirectoryCoverPayload {
  const input = asRecord(value);
  const sections = Array.isArray(input.sections)
    ? input.sections.map(normalizeSection).filter(Boolean) as DenseDirectorySection[]
    : [];

  return {
    kind: 'dense_directory',
    // 保留 LLM 的完整句子给后续标题编辑器判断。这里如果先截断，
    // 后续只能看到半句话，无法判断原意并正确返修。
    title: cleanPublicText(asString(input.title)),
    subtitle: cleanPublicText(asString(input.subtitle)),
    sections: sections.slice(0, 6),
  };
}

export function validateReferenceDraft(draft: ReferenceDrivenDraft, renderer: CreativeCardRenderer): ReferenceDrivenDraft['checks'] {
  const issues: string[] = [];
  const spec = getCoverTemplateSpec(renderer);
  const sectionCount = draft.cover.sections.length;
  const itemCount = draft.cover.sections.reduce((sum, section) => sum + section.items.length, 0);
  const flexibleCapacity = Boolean(spec) && ['directory', 'document', 'offer', 'experience', 'pain', 'roadmap'].includes(spec!.family);
  const sectionCountOk = Boolean(spec) && (flexibleCapacity
    ? sectionCount >= Math.max(2, spec!.sectionCount - 1) && sectionCount <= spec!.sectionCount + 1
    : sectionCount === spec!.sectionCount);
  const sectionItemsOk = Boolean(spec) && draft.cover.sections.every(section => flexibleCapacity
    ? section.items.length >= Math.max(1, spec!.itemsPerSection - 2) && section.items.length <= spec!.itemsPerSection + 2
    : section.items.length === spec!.itemsPerSection);
  const templateCapacityOk = Boolean(spec)
    && sectionCountOk
    && sectionItemsOk;
  const contentDensityOk = Boolean(spec) && itemCount >= (spec?.minTotalItems || 0);
  const titleCoverConsistent = keywordOverlap(draft.selected_title, `${draft.cover.title} ${draft.cover.subtitle} ${draft.brief.topic}`) >= 1;
  const productClaimsGrounded = !hasUnsupportedClaim(draft.caption)
    || draft.evidence.some(item => /raw_selling_points|content_modules|displayable_assets/.test(item.category));

  if (!templateCapacityOk) issues.push('template_capacity_invalid');
  if (!contentDensityOk) issues.push('cover_density_too_low');
  if (!titleCoverConsistent) issues.push('title_cover_topic_mismatch');
  if (!productClaimsGrounded) issues.push('product_claim_without_evidence');

  return {
    title_cover_consistent: titleCoverConsistent,
    template_capacity_ok: templateCapacityOk,
    product_claims_grounded: productClaimsGrounded,
    content_density_ok: contentDensityOk,
    issues,
  };
}

function normalizeSection(value: unknown): DenseDirectorySection | null {
  const input = asRecord(value);
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const items = Array.isArray(input.items)
    ? input.items.map(item => {
        const row = asRecord(item);
        return {
          primary: clip(cleanPublicText(asString(row.primary)), 46),
          secondary: clip(cleanPublicText(asString(row.secondary)), 54) || undefined,
          note: clip(cleanPublicText(asString(row.note)), 72) || undefined,
        };
      }).filter(item => item.primary)
    : [];
  const columns = Number(input.columns);
  const itemLimit = Math.min(12, Math.max(8, rawItems.length));
  return {
    side_label: clip(cleanPublicText(asString(input.side_label)), 6),
    heading: clip(cleanPublicText(asString(input.heading)), 20),
    columns: ([2, 3, 4, 5].includes(columns) ? columns : 3) as 2 | 3 | 4 | 5,
    items: items.slice(0, itemLimit),
    source_type: normalizeSourceType(asString(input.source_type)),
    source_ids: Array.isArray(input.source_ids) ? input.source_ids.map(asString).filter(Boolean).slice(0, 8) : [],
  };
}

function normalizeSourceType(value: string): DenseDirectorySection['source_type'] {
  if (value === 'knowledge_base' || value === 'ai_derived' || value === 'ai_original' || value === 'mixed') return value;
  return 'mixed';
}

function keywordOverlap(a: string, b: string) {
  const tokensA = tokenize(a);
  const tokensB = new Set(tokenize(b));
  return tokensA.filter(token => tokensB.has(token)).length;
}

function tokenize(value: string) {
  const compact = value.toLowerCase().replace(/[，。！？：；、,.!?:;\s]/g, '');
  const chunks: string[] = [];
  for (let index = 0; index < compact.length - 1; index += 1) chunks.push(compact.slice(index, index + 2));
  return chunks;
}

function hasUnsupportedClaim(value: string) {
  return /百分之百|100%|真人批改|一对一/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(value: string, max: number) {
  if (value.length <= max) return value;
  // 截断时优先在词边界收口；中文/无空格场景退化为硬切。
  // 留 1 字符位给省略号，避免视觉上像意外残词（如 "l'expressio"）。
  const budget = max - 1;
  const head = value.slice(0, budget);
  const boundary = head.search(/[^\s，。、；：]+$/);
  let cut: number;
  if (boundary <= 0 || head.length - boundary > Math.min(18, head.length / 2)) {
    cut = head.length;
  } else {
    cut = boundary;
  }
  return value.slice(0, cut).trimEnd() + '…';
}

function cleanPublicText(value: string) {
  return value
    .replace(/考官追着给分/g, 'B2高阶表达')
    .replace(/考官最想要/g, '评分标准看重')
    .replace(/考官/g, '评分标准')
    .replace(/万能/g, '常用')
    .replace(/白考/g, '复习白费')
    .replace(/扣\s*\d+\s*分/g, '容易丢分');
}
