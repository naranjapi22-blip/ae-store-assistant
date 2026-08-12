import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 3100 + Math.floor(Math.random() * 1000);
const baseUrl = `http://localhost:${port}`;

test('una ruta estática inexistente devuelve 404 y el servidor sigue funcionando', async t => {
  const server = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(port) } });
  t.after(() => server.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('El servidor no inició a tiempo')), 5000);
    server.stdout.on('data', data => { if (data.toString().includes('AE Store Assistant')) { clearTimeout(timeout); resolve(); } });
    server.once('error', reject);
  });
  const missing = await fetch(`${baseUrl}/favicon.ico`);
  assert.equal(missing.status, 404);
  const home = await fetch(`${baseUrl}/`);
  assert.equal(home.status, 200);
});
