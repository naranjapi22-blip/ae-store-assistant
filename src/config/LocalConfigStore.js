import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const safeJson = value => JSON.stringify(value, null, 2);

export class LocalConfigStore {
  constructor({ directory, fileName = 'config.json', secretsFileName = 'credentials.json', safeStorage }) {
    this.directory = directory;
    this.configPath = path.join(directory, fileName);
    this.secretsPath = path.join(directory, secretsFileName);
    this.safeStorage = safeStorage;
  }

  async load() {
    try {
      const [config, secrets] = await Promise.all([
        readFile(this.configPath, 'utf8').then(JSON.parse),
        readFile(this.secretsPath, 'utf8').then(JSON.parse)
      ]);
      if (!this.safeStorage?.isEncryptionAvailable?.()) return null;
      const user = this.safeStorage.decryptString(Buffer.from(secrets.user, 'base64'));
      const password = this.safeStorage.decryptString(Buffer.from(secrets.password, 'base64'));
      return { config, credentials: { user, password } };
    } catch {
      return null;
    }
  }

  async save({ config, user, password }) {
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('Secure credential storage is unavailable');
    }
    await mkdir(this.directory, { recursive: true });
    const encryptedUser = this.safeStorage.encryptString(String(user));
    const encryptedPassword = this.safeStorage.encryptString(String(password));
    const publicConfig = { ...config };
    delete publicConfig.user;
    delete publicConfig.password;
    await writeFile(this.configPath, safeJson(publicConfig), { encoding: 'utf8', mode: 0o600 });
    await writeFile(this.secretsPath, safeJson({
      user: Buffer.from(encryptedUser).toString('base64'),
      password: Buffer.from(encryptedPassword).toString('base64')
    }), { encoding: 'utf8', mode: 0o600 });
  }
}
