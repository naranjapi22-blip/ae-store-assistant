import path from 'node:path';
import { existsSync } from 'node:fs';
import { ExcelProductRepository } from './ExcelProductRepository.js';
import { SqlServerProductRepository } from './SqlServerProductRepository.js';

const inventoryCandidates = env => [
  env.INVENTORY_FILE,
  'ae stock.xls',
  'stock de tienda 30-06-2026.xls'
].filter(Boolean);

export const resolveInventoryPath = ({ env = process.env, projectRoot = process.cwd() } = {}) => inventoryCandidates(env)
  .map(file => path.isAbsolute(file) ? file : path.resolve(projectRoot, file))
  .find(existsSync);

export function createProductRepository({
  env = process.env,
  projectRoot = process.cwd(),
  inventoryPath = null,
  requireWarehouse = false,
  excelRepositoryFactory = filePath => new ExcelProductRepository(filePath),
  sqlRepositoryFactory = options => new SqlServerProductRepository(options)
} = {}) {
  if (String(env.DATA_SOURCE || 'excel').trim().toLowerCase() === 'sqlserver') {
    if (requireWarehouse && !String(env.STORE_WAREHOUSE || '').trim()) {
      throw new Error('Warehouse is required for this runtime');
    }
    return sqlRepositoryFactory({ env, requireWarehouse });
  }

  const filePath = inventoryPath || resolveInventoryPath({ env, projectRoot });
  if (!filePath) throw new Error(`No se encontró el archivo de inventario. Probados: ${inventoryCandidates(env).join(', ')}`);
  return excelRepositoryFactory(filePath);
}
