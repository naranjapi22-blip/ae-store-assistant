import sql from 'mssql';
import { sqlConfigFromEnv } from './SqlServerProductRepository.js';

export const WAREHOUSE_QUERY = `
SELECT
    A.CODALMACEN AS warehouseCode,
    LTRIM(RTRIM(A.NOMBREALMACEN)) AS warehouseName
FROM dbo.ALMACEN A
ORDER BY
    CASE WHEN UPPER(A.NOMBREALMACEN) LIKE '%MERMA%' THEN 1 ELSE 0 END,
    LTRIM(RTRIM(A.NOMBREALMACEN)),
    A.CODALMACEN`;

export class SqlServerWarehouseRepository {
  constructor({ pool = null, poolFactory = null, env = process.env, config = sqlConfigFromEnv(env) } = {}) {
    this.pool = pool;
    this.poolPromise = null;
    this.config = config;
    this.poolFactory = poolFactory || (connectionConfig => new sql.ConnectionPool(connectionConfig).connect());
  }

  async getPool() {
    if (this.pool) return this.pool;
    if (!this.poolPromise) this.poolPromise = Promise.resolve(this.poolFactory(this.config));
    this.pool = await this.poolPromise;
    return this.pool;
  }

  async listWarehouses() {
    const request = (await this.getPool()).request();
    request.timeout = this.config.requestTimeout || 3000;
    const result = await request.query(WAREHOUSE_QUERY);
    return (result.recordset || []).map(row => ({
      warehouseCode: String(row.warehouseCode ?? '').trim(),
      warehouseName: String(row.warehouseName ?? '').trim(),
      isLikelySales: !/MERMA/i.test(String(row.warehouseName ?? ''))
    })).filter(row => row.warehouseCode);
  }

  async close() {
    if (this.pool?.close) await this.pool.close();
    this.pool = null;
    this.poolPromise = null;
  }
}

export const testSqlConnection = async (config, { warehouseRepositoryFactory = options => new SqlServerWarehouseRepository(options) } = {}) => {
  const env = {
    DB_SERVER: config.server,
    DB_PORT: String(config.port),
    DB_DATABASE: config.database,
    DB_USER: config.user,
    DB_PASSWORD: config.password,
    DB_ENCRYPT: String(config.encrypt),
    DB_TRUST_SERVER_CERTIFICATE: String(config.trustServerCertificate),
    DB_REQUEST_TIMEOUT_MS: String(config.requestTimeoutMs || 3000),
    DB_CONNECTION_TIMEOUT_MS: String(config.connectionTimeoutMs || 3000)
  };
  const pool = new sql.ConnectionPool(sqlConfigFromEnv(env));
  let warehouseRepository;
  try {
    await pool.connect();
    const request = pool.request();
    request.timeout = config.requestTimeoutMs || 3000;
    const result = await request.query('SELECT DB_NAME() AS databaseName, 1 AS canSelect');
    warehouseRepository = warehouseRepositoryFactory({ pool, env });
    const warehouses = await warehouseRepository.listWarehouses();
    return { databaseName: result.recordset?.[0]?.databaseName || config.database, canSelect: true, warehouses };
  } finally {
    if (warehouseRepository && warehouseRepository.pool !== pool) await warehouseRepository.close();
    else if (pool.close) await pool.close();
  }
};
