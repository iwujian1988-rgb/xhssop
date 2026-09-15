/* eslint-disable no-console */
import assert from 'node:assert/strict';
import { getCoverSkins, normalizeCoverSkin } from '../src/lib/cover-skins';

const parchment = getCoverSkins('parchment_dense_directory');
const blackboard = getCoverSkins('blackboard_phrase');
const notebook = getCoverSkins('notebook_big_words');
const paper = getCoverSkins('white_green_directory');

assert.equal(parchment.length, 4);
assert.equal(blackboard.length, 4);
assert.equal(notebook.length, 4);
assert.equal(paper.length, 4);
assert.equal(normalizeCoverSkin('parchment_dense_directory', 'parchment-sage'), 'parchment-sage');
assert.equal(normalizeCoverSkin('parchment_dense_directory', 'bad-value'), 'parchment-warm');
assert.equal(normalizeCoverSkin('book_cover', 'anything'), null);

console.log(JSON.stringify({ ok: true, parchment, blackboard, notebook, paper }, null, 2));
