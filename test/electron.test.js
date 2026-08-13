import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Electron usa aislamiento, preload y no habilita nodeIntegration', async () => {
  const main = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /contextIsolation:\s*true/);
  assert.match(main, /nodeIntegration:\s*false/);
  assert.match(main, /preload/);
  assert.doesNotMatch(main, /webPreferences:\s*\{[^}]*password/i);
});

test('preload solo expone metadatos de la aplicación, no credenciales', async () => {
  const preload = await readFile(new URL('../electron/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /DB_PASSWORD|password|credential/i);
});

test('la UI de configuración no incluye valores de contraseña en el código', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /\/api\/config\/test/);
  assert.match(app, /\/api\/config\/save/);
  assert.doesNotMatch(app, /PON_AQUI|your_password_here/i);
});

test('la prueba de conexión valida solo los datos SQL y luego habilita almacenes', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /const complete = Boolean\(payload\.server[\s\S]*payload\.password\)/);
  assert.match(app, /const connectionValidationMessage = 'Completa servidor, base de datos, usuario y contraseña\.'/);
  assert.doesNotMatch(app.match(/const connectionValidationMessage[\s\S]*?;/)?.[0] || '', /almac/);
  assert.match(app, /configurationRequest\('\/api\/config\/test', payload\)/);
  assert.match(app, /<option value="">Selecciona una tienda<\/option>/);
  assert.match(app, /warehouseSelect\.disabled = !warehouses\.length/);
  assert.match(app, /connectionValidated = true/);
});

test('la UI exige conexión validada y tienda para guardar', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(app, /Prueba la conexión antes de guardar\./);
  assert.match(app, /Selecciona una tienda\./);
  assert.match(app, /saveConfiguration\.disabled = !\(connectionValidated && warehouseSelect\.value\)/);
});

test('el indicador empieza gris y solo usa verde tras conexión correcta', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.status-dot \{[^}]*background: #a7a7a3/);
  assert.match(styles, /\.status-dot\.is-connected \{[^}]*background: #4c9b6e/);
  assert.match(styles, /\.status-dot\.is-error \{[^}]*background: #bd4a4a/);
  assert.ok(app.indexOf("setConnectionState('idle');\ninitializeConfiguration();") >= 0);
  assert.ok(app.indexOf("setConnectionState('connected')") > app.indexOf("configurationRequest('/api/config/test', payload)"));
});

test('Electron valida automÃ¡ticamente la configuraciÃ³n guardada al iniciar', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const server = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const warehouse = await readFile(new URL('../src/repository/SqlServerWarehouseRepository.js', import.meta.url), 'utf8');
  assert.match(app, /\/api\/config\/health/);
  assert.match(app, /setConnectionState\('idle'\)/);
  assert.match(app, /setConnectionState\('connected'\)/);
  assert.match(app, /setConnectionState\('error'\)/);
  assert.match(app, /updateStoreLabel\(config\)/);
  assert.match(server, /pathname === '\/api\/config\/health'/);
  assert.match(server, /checkConnection\(config\)/);
  assert.match(warehouse, /SELECT DB_NAME\(\) AS databaseName/);
  assert.doesNotMatch(app, /DB_PASSWORD|safeStorage|credentials/i);
});
