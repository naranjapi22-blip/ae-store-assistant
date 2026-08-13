import dotenv from 'dotenv';

export const loadEnvironment = (env = process.env) => {
  dotenv.config({ quiet: true });
  return env;
};

export const booleanFromEnv = (value, fallback) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'si'].includes(String(value).trim().toLowerCase());
};

export const configFromEnv = (env = process.env) => ({
  server: env.DB_SERVER || 'localhost',
  port: Number(env.DB_PORT || 1433),
  database: env.DB_DATABASE || '',
  user: env.DB_USER || '',
  password: env.DB_PASSWORD || '',
  warehouseCode: env.STORE_WAREHOUSE || '',
  warehouseName: env.STORE_WAREHOUSE_NAME || '',
  tariff: Number(env.SALES_TARIFF_ID || 5),
  priceFormat: env.SALES_PRICE_FORMAT === '' || env.SALES_PRICE_FORMAT == null ? null : Number(env.SALES_PRICE_FORMAT),
  encrypt: booleanFromEnv(env.DB_ENCRYPT, true),
  trustServerCertificate: booleanFromEnv(env.DB_TRUST_SERVER_CERTIFICATE, false),
  requestTimeoutMs: Number(env.DB_REQUEST_TIMEOUT_MS || 3000),
  connectionTimeoutMs: Number(env.DB_CONNECTION_TIMEOUT_MS || 3000)
});

export const envFromConfig = config => ({
  DATA_SOURCE: 'sqlserver',
  DB_SERVER: config.server,
  DB_PORT: String(config.port),
  DB_DATABASE: config.database,
  DB_USER: config.user,
  DB_PASSWORD: config.password,
  DB_ENCRYPT: String(config.encrypt),
  DB_TRUST_SERVER_CERTIFICATE: String(config.trustServerCertificate),
  STORE_WAREHOUSE: config.warehouseCode,
  STORE_WAREHOUSE_NAME: config.warehouseName || '',
  SALES_TARIFF_ID: String(config.tariff),
  SALES_PRICE_FORMAT: config.priceFormat == null ? '' : String(config.priceFormat),
  DB_REQUEST_TIMEOUT_MS: String(config.requestTimeoutMs || 3000),
  DB_CONNECTION_TIMEOUT_MS: String(config.connectionTimeoutMs || 3000)
});

export const publicConfig = config => ({
  server: config.server,
  port: config.port,
  database: config.database,
  warehouseCode: config.warehouseCode,
  warehouseName: config.warehouseName || '',
  tariff: config.tariff,
  priceFormat: config.priceFormat,
  encrypt: config.encrypt,
  trustServerCertificate: config.trustServerCertificate,
  hasUser: Boolean(config.user),
  configured: isUsableConfig(config)
});

export const isConnectionConfig = config => {
  const password = String(config?.password || '');
  const placeholder = /^(PON_AQUI_|your_password_here$)/i.test(password);
  return Boolean(
    config?.server
    && Number.isInteger(Number(config?.port))
    && Number(config.port) > 0
    && config?.database
    && config?.user
    && password
    && !placeholder
  );
};

export const isUsableConfig = config => {
  return isConnectionConfig(config) && Boolean(config?.warehouseCode);
};
