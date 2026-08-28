import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStyleColor, styleColorFromParts } from '../src/vs-images/VsImageIdentity.js';

test('VS image identity builds canonical STYLE-COLOR', () => {
  assert.equal(styleColorFromParts('11249650', '3xzr'), '11249650-3XZR');
  assert.equal(normalizeStyleColor('11249650-3xzr'), '11249650-3XZR');
});

test('VS image identity rejects non-exact values', () => {
  assert.equal(styleColorFromParts('1124965', '3XZR'), null);
  assert.equal(styleColorFromParts('11249650', '3XZ'), null);
  assert.equal(styleColorFromParts('11249650', '3X-R'), null);
  assert.equal(normalizeStyleColor('112496503XZR'), null);
  assert.equal(normalizeStyleColor(''), null);
});
