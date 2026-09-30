import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../src/slugify.js';

test('folds accents', () => {
  assert.equal(slugify('Canción del Ñandú'), 'cancion-del-nandu');
  assert.equal(slugify('Crème Brûlée à la carte'), 'creme-brulee-a-la-carte');
});

test('collapses separators and trims', () => {
  assert.equal(slugify('  --Hello,   World!!  '), 'hello-world');
  assert.equal(slugify('a_b.c/d'), 'a-b-c-d');
});

test('empty and symbol-only input', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify('!!! ###'), '');
});

test('maxLength cuts at a word boundary', () => {
  const out = slugify('the quick brown fox jumps over the lazy dog', { maxLength: 20 });
  assert.equal(out, 'the-quick-brown-fox');
  assert.ok(out.length <= 20);
  assert.ok(!out.endsWith('-'));
});

test('default maxLength is 60', () => {
  const out = slugify('word '.repeat(40));
  assert.ok(out.length <= 60);
  assert.ok(!out.endsWith('-'));
});

test('hard-cuts a single long word', () => {
  assert.equal(slugify('a'.repeat(100), { maxLength: 10 }), 'aaaaaaaaaa');
});

test('custom separator', () => {
  assert.equal(slugify('Hello big World', { separator: '_' }), 'hello_big_world');
  assert.equal(slugify('a b c d e f', { separator: '_', maxLength: 5 }), 'a_b_c');
});

test('non-string input throws TypeError', () => {
  assert.throws(() => slugify(42), TypeError);
  assert.throws(() => slugify(null), TypeError);
});
