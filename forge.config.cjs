const path = require('node:path');
const electronZipDir = path.resolve(
  process.env.LOCALAPPDATA,
  'electron/Cache/63857c95525ff62c967a319a9c3921773c3420b77c6ebce7f47c8c76e68d9e11'
);

module.exports = {
  packagerConfig: {
    name: 'AE Store Assistant',
    executableName: 'ae-store-assistant',
    electronZipDir,
    asar: true,
    ignore: [
      /[\\/]\.env(?:\..*)?$/,
      /[\\/]test(?:[\\/]|$)/,
      /[\\/](?:out|packages|\.packager-diagnostic)(?:[\\/]|$)/
    ]
  },
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: { name: 'ae_store_assistant' }
    }
  ]
};
