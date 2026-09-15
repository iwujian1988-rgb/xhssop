import assert from 'node:assert/strict';
import {
  allocateLockedCoordinates,
  mergeLockedNotes,
  missingLockedNotes,
  normalizeLockedNotesAndValidate,
  type LockedCoordinate,
} from '../src/lib/v2/batch-topic-map';

type RawNote = { coordinateId: string; problemNote?: string; outcomeNote?: string };

const locked = allocateLockedCoordinates(6, [], '');
const complete = locked.map((item, index) => ({
  coordinateId: item.coordinateId,
  problemNote: `具体问题${index + 1}：无法完成对应任务`,
  outcomeNote: `具体结果${index + 1}：形成可执行方案`,
}));

function poolOf(notes: RawNote[]) {
  const pool = new Map<string, Record<string, unknown>>();
  mergeLockedNotes(pool, notes);
  return pool;
}

function snapshot(pool: Map<string, Record<string, unknown>>, ids: string[]) {
  return Object.fromEntries(ids.map(id => [id, JSON.stringify(pool.get(id))]));
}

const results: Array<{ case: string; pass: boolean; detail: string }> = [];
function check(name: string, run: () => void) {
  try {
    run();
    results.push({ case: name, pass: true, detail: 'PASS' });
  } catch (error) {
    results.push({ case: name, pass: false, detail: error instanceof Error ? error.message : String(error) });
  }
}

check('1_one_coord_one_missing_field', () => {
  const initial = complete.map(item => item.coordinateId === 'coord_01' ? { ...item, outcomeNote: '' } : item);
  const pool = poolOf(initial);
  const before = snapshot(pool, locked.slice(1).map(item => item.coordinateId));
  mergeLockedNotes(pool, [{ coordinateId: 'coord_01', outcomeNote: '形成一份可直接执行的检查表' }]);
  assert.equal(normalizeLockedNotesAndValidate([...pool.values()], locked).ok, true);
  assert.deepEqual(snapshot(pool, locked.slice(1).map(item => item.coordinateId)), before);
});

check('2_one_coord_multiple_missing_fields', () => {
  const pool = poolOf(complete.filter(item => item.coordinateId !== 'coord_02'));
  mergeLockedNotes(pool, [{ coordinateId: 'coord_02', problemNote: '审题时无法识别任务要求', outcomeNote: '得到任务要求拆解清单' }]);
  assert.equal(normalizeLockedNotesAndValidate([...pool.values()], locked).ok, true);
});

check('3_multiple_coords_repaired_together', () => {
  const missingIds = new Set(['coord_02', 'coord_04', 'coord_06']);
  const pool = poolOf(complete.filter(item => !missingIds.has(item.coordinateId)));
  const requested = missingLockedNotes(pool, locked).map(item => item.coordinateId);
  assert.deepEqual(requested, ['coord_02', 'coord_04', 'coord_06']);
  mergeLockedNotes(pool, complete.filter(item => missingIds.has(item.coordinateId)));
  assert.equal(normalizeLockedNotesAndValidate([...pool.values()], locked).ok, true);
});

check('4_wrong_coordinate_id_does_not_fill_target', () => {
  const pool = poolOf(complete.filter(item => item.coordinateId !== 'coord_03'));
  mergeLockedNotes(pool, [{ coordinateId: 'coord_99', problemNote: '具体错误', outcomeNote: '具体结果' }]);
  assert.deepEqual(missingLockedNotes(pool, locked).map(item => item.coordinateId), ['coord_03']);
});

check('5_duplicate_coordinate_id_is_rejected', () => {
  const duplicate = [...complete, { ...complete[0], problemNote: '另一套冲突问题' }];
  const pool = poolOf(duplicate);
  const checked = normalizeLockedNotesAndValidate([...pool.values()], locked);
  assert.equal(checked.ok, false, '当前实现把重复 coordinateId 静默合并，未拒绝重复返回');
});

check('6_semantically_duplicate_notes_are_rejected', () => {
  const duplicated = complete.map((item, index) => index < 2
    ? { ...item, problemNote: '写作时不知道该怎么展开', outcomeNote: '得到一套清晰写作方法' }
    : item);
  const checked = normalizeLockedNotesAndValidate(duplicated, locked);
  assert.equal(checked.ok, false, '当前完整地图校验未检查 problemNote/outcomeNote 语义重复');
});

check('7_abstract_nonempty_notes_are_rejected', () => {
  const abstract = complete.map((item, index) => index === 0
    ? { ...item, problemNote: '提升能力', outcomeNote: '改善效果' }
    : item);
  const checked = normalizeLockedNotesAndValidate(abstract, locked);
  assert.equal(checked.ok, false, '当前校验只检查非空，没有识别抽象空话');
});

check('8_two_failed_repairs_become_coordinate_unrecoverable', () => {
  const pool = poolOf(complete.filter(item => item.coordinateId !== 'coord_05'));
  mergeLockedNotes(pool, [{ coordinateId: 'coord_05', problemNote: '', outcomeNote: '' }]);
  mergeLockedNotes(pool, [{ coordinateId: 'coord_05', problemNote: '仍缺结果', outcomeNote: '' }]);
  const missing = missingLockedNotes(pool, locked).map(item => item.coordinateId);
  assert.deepEqual(missing, ['coord_05']);
  assert.fail('当前生产函数最终会整批 throw，尚未返回 COORDINATE_UNRECOVERABLE 的单坐标结果');
});

check('passed_coordinate_is_immutable_during_targeted_repair', () => {
  const pool = poolOf(complete.filter(item => item.coordinateId !== 'coord_06'));
  const before = snapshot(pool, ['coord_01']);
  mergeLockedNotes(pool, [
    { coordinateId: 'coord_01', problemNote: '被错误改写', outcomeNote: '被错误改写' },
    complete[5],
  ]);
  assert.deepEqual(snapshot(pool, ['coord_01']), before, 'Repair 返回额外已通过坐标时，当前 merge 会覆盖其字段');
});

const passed = results.filter(item => item.pass).length;
console.log(JSON.stringify({
  total: results.length,
  passed,
  failed: results.length - passed,
  results,
}, null, 2));

