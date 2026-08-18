import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import XLSX from 'xlsx';

export async function createSyntheticExcel(rows, prefix = 'excel-fixture-') {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  const file = path.join(directory, 'stock.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Stock');
  XLSX.writeFile(workbook, file);
  return { file, cleanup: () => rm(directory, { recursive: true, force: true }) };
}
