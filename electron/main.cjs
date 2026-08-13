const { app, BrowserWindow, safeStorage } = require('electron');
const path = require('node:path');

let application;

const createWindow = async () => {
  const [{ startServer }, { LocalConfigStore }] = await Promise.all([
    import('../src/server.js'),
    import('../src/config/LocalConfigStore.js')
  ]);
  const configStore = new LocalConfigStore({ directory: app.getPath('userData'), safeStorage });
  const stored = await configStore.load();
  const initialConfig = stored ? { ...stored.config, ...stored.credentials } : null;
  application = await startServer({
    env: { DATA_SOURCE: 'sqlserver' },
    initialConfig,
    configStore,
    requireWarehouse: true,
    port: 0,
    projectRoot: path.resolve(__dirname, '..')
  });
  const port = application.server.address().port;
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 980,
    minHeight: 720,
    title: 'AE Store Assistant',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
};

app.whenReady().then(createWindow).catch(error => {
  console.error('No se pudo iniciar AE Store Assistant:', error.message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', async event => {
  if (!application) return;
  event.preventDefault();
  const current = application;
  application = null;
  await current.close();
  app.quit();
});
