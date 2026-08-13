const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('appShell', Object.freeze({
  isDesktop: true,
  appName: 'AE Store Assistant'
}));
