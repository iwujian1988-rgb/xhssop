import assert from 'node:assert/strict';
import { allocateLockedCoordinates, normalizeAndValidate } from '../src/lib/v2/batch-topic-map';
import { coordinateHash, TOPIC_DOMAINS, TOPIC_PROBLEMS, TOPIC_OBJECTS, TOPIC_SCENES, PROBLEM_DOMAIN, PROBLEM_MECHANISMS } from '../src/lib/v2/topic-coordinate-taxonomy';

const raw = Array.from({ length: 10 }, (_, index) => {
  const problemId = TOPIC_PROBLEMS[index];
  const domainId = PROBLEM_DOMAIN[problemId];
  const mechanismId = PROBLEM_MECHANISMS[problemId][0];
  return { coordinateId: `c${index}`, domainId, problemId, objectId: TOPIC_OBJECTS[index], mechanismId, sceneId: TOPIC_SCENES[index], scale: index < 3 ? 'broad' : index < 6 ? 'strategy' : 'specific', contentType: index % 2 ? 'guide' : 'reference', problemNote: `问题${index}`, outcomeNote: `结果${index}` };
});
const result = normalizeAndValidate(raw, 10);
assert.equal(result.ok, true);
if (result.ok) assert.equal(result.coordinates[0].coordinateHash, coordinateHash(result.coordinates[0]));

const duplicate = [...raw];
duplicate[9] = { ...duplicate[8], coordinateId: 'c9' };
assert.equal(normalizeAndValidate(duplicate, 10).ok, false);

const mismatched = raw.map(item => ({ ...item }));
mismatched[0].mechanismId = 'lexical_choice_map';
assert.equal(normalizeAndValidate(mismatched, 10).ok, false);

const fifty = allocateLockedCoordinates(50, []);
assert.equal(fifty.length, 50);
assert.equal(new Set(fifty.map(item => `${item.domainId}|${item.problemId}|${item.objectId}|${item.mechanismId}|${item.sceneId}`)).size, 50);
assert.equal(new Set(fifty.map(item => `${item.problemId}|${item.mechanismId}`)).size, 39);
assert.equal(new Set(fifty.map(item => item.domainId)).size, 13);

const firstTen = allocateLockedCoordinates(10, []);
const usedHints = firstTen.map(item => ({
  coordinateKey: `${item.domainId}|${item.problemId}|${item.objectId}|${item.mechanismId}|${item.sceneId}`,
  useCount: 1,
  lastSuccessAt: '2026-08-30T00:00:00.000Z',
}));
const nextTen = allocateLockedCoordinates(10, usedHints);
assert.equal(nextTen.filter(item => usedHints.some(hint => hint.coordinateKey === `${item.domainId}|${item.problemId}|${item.objectId}|${item.mechanismId}|${item.sceneId}`)).length, 0);

const formalLetterFocus = allocateLockedCoordinates(10, [], '正式信专题攻略');
assert.equal(formalLetterFocus.filter(item => item.domainId === 'register_genre').length, 3);
assert.ok(formalLetterFocus.some(item => item.objectId === 'formal_letter'));
assert.ok(formalLetterFocus.every(item => item.contentType === 'guide' && item.scale === 'strategy'));

console.log('test-v2-batch-topic-map passed');
