import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { VsExcelProductRepository } from '../src/repository/VsExcelProductRepository.js';

const stockRow = (barcode, style, color) => ({
  barcode, barcode2: '', codigoArticulo: `ART-${barcode}`, referencia: `REF-${barcode}`,
  descripcion: 'Supplemental test product', temporada: 'TEST', talla: 'M', color,
  stock: 1, departamento: 'APPAREL', seccion: 'TOPS', familia: 'TEST', subfamilia: 'TEST', style, stylo: 'STYLO'
});

const supplemental = (barcode, style, color, source = 'vs-australia') => ({
  barcode, style, color, styleColor: `${style}-${color}`, styleColorNormalized: `${style}${color}`,
  imageUrl: `https://images.example.test/${style}${color}.jpg`, classification: 'MATCHED_SAFE', source,
  evidence: { localBarcode: barcode, localStyleColor: `${style}-${color}`, imageValidation: { ok: true, status: 206, contentType: 'image/jpeg', url: `https://images.example.test/${style}${color}.jpg` } }
});

test('supplemental-safe accepts only validated MATCHED_SAFE records, preserves provenance, and stays after existing sources', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-supplemental-'));
  try {
    const stock = path.join(dir, 'stock.json'); const empty = path.join(dir, 'empty.json'); const safe = path.join(dir, 'supplemental.json'); const current = path.join(dir, 'current.json');
    await writeFile(stock, JSON.stringify([stockRow('1001', '11240001', '0LOW'), stockRow('1002', '11240002', '58KG'), stockRow('1003', '11240003', '5TRG')]), 'utf8');
    await writeFile(empty, JSON.stringify([]), 'utf8');
    await writeFile(safe, JSON.stringify([
      supplemental('1001', '11240001', '0LOW', 'vs-australia'),
      supplemental('1002', '11240002', '58KG', 'vs-mena'),
      { ...supplemental('1003', '11240003', '5TRG', 'vs-mexico'), classification: 'NO_MATCH' },
      { ...supplemental('9999', '11249999', '0LOW', 'vs-singapore'), evidence: { localBarcode: 'different', localStyleColor: '11249999-0LOW', imageValidation: { ok: true, status: 200, contentType: 'image/jpeg', url: 'https://images.example.test/112499990LOW.jpg' } } }
    ]), 'utf8');
    await writeFile(current, JSON.stringify([{ barcode: '1001', clasificacion: 'MATCH_COLOR_ACTUAL', image_url: 'https://images.example.test/current.jpg', http_status: 200 }]), 'utf8');

    const repository = new VsExcelProductRepository(stock, { imageCatalogFilePath: current, historicalImageFilePath: empty, styleColorImageFilePath: empty, vsSupplementalImageFilePath: safe });
    assert.equal(repository.metrics().vsSupplementalImagesLoaded, 1);
    assert.equal((await repository.findByBarcode('1001')).imageSource, 'current');
    assert.equal((await repository.findByBarcode('1002')).image, 'https://images.example.test/1124000258KG.jpg');
    assert.equal((await repository.findByBarcode('1002')).imageSource, 'vs-supplemental-safe:vs-mena');
    assert.equal((await repository.findByBarcode('1003')).image, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
