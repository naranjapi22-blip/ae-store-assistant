import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/vs/app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/vs/styles.css', import.meta.url), 'utf8');

test('VS detail renders model and color references as distinct labeled blocks', () => {
  assert.match(app, /REFERENCIA DEL COLOR/);
  assert.match(app, /Mismo modelo en otro color\/estampado/);
  assert.match(app, /El tono puede variar según el material y la pantalla/);
  assert.match(app, /renderColorReference\(data\)/);
  assert.match(styles, /\.color-reference/);
});

test('VS catalog presents colorReference as a labeled secondary thumbnail, never as the main product image', () => {
  assert.match(app, /catalog-color-reference/);
  assert.match(app, /Referencia color \$\{escapeHtml\(item\.color\)\}/);
  assert.match(styles, /\.catalog-color-reference/);
  assert.doesNotMatch(app, /item\.colorReference\.image[^]*catalog-card-image/);
});
