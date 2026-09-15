/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { applyDraftTitleSelection, getDraftTitleSelection } from '../src/lib/draft-title-selection';
import type { ReferenceDrivenDraft } from '../src/types/reference-workflow';

const draft = {
  selected_title: '原文字标题',
  title_candidates: [
    { title: '原文字标题' },
    { title: '新文字标题' },
  ],
  cover_title_candidates: [
    { title: '原封面标题', subtitle: '原副标题' },
    { title: '新封面标题', subtitle: '新副标题' },
  ],
  cover: { title: '原封面标题', subtitle: '原副标题' },
} as unknown as ReferenceDrivenDraft;

const selection = getDraftTitleSelection(draft, 1);
const updated = applyDraftTitleSelection(draft, selection);

assert.equal(updated.selected_title, '新文字标题');
assert.equal(updated.cover.title, '新封面标题');
assert.equal(updated.cover.subtitle, '新副标题');
assert.equal(draft.selected_title, '原文字标题', '临时选择不能修改原始 draft');
console.log(JSON.stringify({ ok: true, selection, original_unchanged: true }, null, 2));
