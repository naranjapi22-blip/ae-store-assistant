import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { VsExcelProductRepository } from '../src/repository/VsExcelProductRepository.js';
import { VsProductService } from '../src/service/VsProductService.js';
import { startVsServer } from '../src/vsServer.js';

const vsImageTestRoot = path.resolve('..', '..', 'VSImageTest');
const masterStock = path.join(vsImageTestRoot, 'vs_inventory_master.json');
const currentImages = path.join(vsImageTestRoot, 'catalogo_actual_vs_nuevo.json');
const historicalImages = path.join(vsImageTestRoot, 'historico_vs_nuevo.json');
const styleColorImages = path.join(vsImageTestRoot, 'style_color_recovery_vs.json');
const crImages = path.join(vsImageTestRoot, 'vs_cr_refid_images.json');
const indiaImages = path.join(vsImageTestRoot, 'vs_india_images.json');
const maltaImages = path.join(vsImageTestRoot, 'vs_malta_images.json');
const ready = [masterStock, currentImages, historicalImages, styleColorImages, crImages].every(existsSync);
const indiaReady = [masterStock, currentImages, historicalImages, styleColorImages, crImages, indiaImages].every(existsSync);
const maltaReady = [masterStock, currentImages, historicalImages, styleColorImages, crImages, indiaImages, maltaImages].every(existsSync);

const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2), 'utf8');

test('VS master JSON encuentra 667558739587 por barcode y por referencia', { skip: !ready }, async () => {
  const repository = new VsExcelProductRepository(masterStock, {
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: crImages
  });
  const service = new VsProductService(repository);
  const byBarcode = await repository.findByBarcode('667558739587');
  assert.ok(byBarcode);
  assert.equal(byBarcode.CODBARRAS, '667558739587');
  assert.equal(byBarcode.REFPROVEEDOR, '25158095');
  assert.equal(byBarcode.STYLE, '11233310');
  assert.equal(byBarcode.COLOR, '0086');
  assert.equal(byBarcode.STOCK, 1);
  assert.equal(repository.byBarcode.has('667558739587'), true);
  assert.equal(repository.metrics().barcodesIndexed, 25159);
  const byReference = await service.getProductByQuery('25158095');
  assert.ok(byReference.product);
  assert.equal(byReference.product.barcode, '667558739587');
  assert.equal(byReference.product.supplierReference, '25158095');
  assert.equal(byReference.product.style, '11233310');
  assert.equal(byReference.product.color, '0086');
  assert.equal(byReference.product.stock, 1);
});

test('VS carga el fallback CR como vs-cr-refid', { skip: !ready }, async () => {
  const repository = new VsExcelProductRepository(masterStock, {
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: crImages
  });
  const crRow = await repository.findByBarcode('197575014614');
  assert.ok(crRow);
  assert.equal(crRow.imageSource, 'vs-cr-refid');
  assert.match(crRow.image ?? '', /^https?:\/\//);
  assert.equal(crRow.CODBARRAS, '197575014614');
  assert.equal(repository.metrics().vsCrImagesLoaded, 229);
  assert.equal(repository.metrics().imagesLoaded, 15403);
});

test('VS carga el fallback India como vs-india y respeta la prioridad', { skip: !indiaReady }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'vs-india-fallback-'));
  try {
    const stock = path.join(dir, 'stock.json');
    const current = path.join(dir, 'current.json');
    const empty = path.join(dir, 'empty.json');
    const historical = path.join(dir, 'historical.json');
    const styleColor = path.join(dir, 'style-color.json');
    const cr = path.join(dir, 'cr.json');
    const india = path.join(dir, 'india.json');
    const malta = path.join(dir, 'malta.json');
    const invalidMalta = path.join(dir, 'invalid-malta.json');
    const barcode = '900000000001';
    const baseRow = {
      barcode,
      barcode2: '',
      codigoArticulo: '1',
      referencia: 'REF-1',
      style: '12345678',
      stylo: '87654321',
      descripcion: 'Synthetic product',
      talla: 'M',
      color: '2468',
      temporada: 'TEST',
      departamento: 'BEAUTY',
      seccion: 'BODY',
      familia: 'FRAGRANCE',
      subfamilia: 'MIST',
      stock: 1
    };
    await writeJson(stock, [baseRow]);
    await writeJson(empty, { results: [] });
    await writeJson(current, { results: [{ barcode, clasificacion: 'MATCH_COLOR_ACTUAL', image_url: 'https://example.test/current.jpg', http_status: 200 }] });
    await writeJson(historical, { results: [{ barcode, clasificacion: 'HISTORICA_RECUPERADA', image_url_historica: 'https://example.test/historical.jpg', http_status: 200 }] });
    await writeJson(styleColor, { results: [{ barcode, clasificacion: 'STYLE_COLOR_RECUPERADO', image: 'https://example.test/style-color.jpg' }] });
    await writeJson(cr, { results: [{ CODBARRAS: barcode, imageUrl: 'https://example.test/cr.jpg', resultado: 'MATCHED' }] });
    await writeJson(india, { results: [{ CODBARRAS: barcode, REFPROVEEDOR: 'REF-1', STYLE: '12345678', COLOR: '2468', imageUrl: 'https://example.test/india.jpg', evidence: { itemSizeIdMatchesBarcode: true, itemIdMatchesStyleColor: true, masterStyleMatchesStyle: true } }] });
    await writeJson(malta, { results: [{ barcode, classification: 'MATCHED_SAFE', imageUrl: 'https://example.test/malta.jpg' }] });
    await writeJson(invalidMalta, { results: [
      { barcode, classification: 'NO_IMAGE', imageUrl: 'https://example.test/no-image.jpg' },
      { barcode: '900000000002', classification: 'MATCHED_SAFE', imageUrl: 'not-a-url' }
    ] });

    const withAll = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: current,
      historicalImageFilePath: historical,
      styleColorImageFilePath: styleColor,
      vsCrImageFilePath: cr,
      vsIndiaImageFilePath: india,
      vsMaltaImageFilePath: malta
    });
    assert.equal((await withAll.findByBarcode(barcode)).imageSource, 'current');

    const withHistorical = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: empty,
      historicalImageFilePath: historical,
      styleColorImageFilePath: styleColor,
      vsCrImageFilePath: cr,
      vsIndiaImageFilePath: india,
      vsMaltaImageFilePath: malta
    });
    assert.equal((await withHistorical.findByBarcode(barcode)).imageSource, 'historical');

    const withStyleColor = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: empty,
      historicalImageFilePath: empty,
      styleColorImageFilePath: styleColor,
      vsCrImageFilePath: cr,
      vsIndiaImageFilePath: india,
      vsMaltaImageFilePath: malta
    });
    assert.equal((await withStyleColor.findByBarcode(barcode)).imageSource, 'style-color');

    const withCr = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: empty,
      historicalImageFilePath: empty,
      vsCrImageFilePath: cr,
      vsIndiaImageFilePath: india,
      vsMaltaImageFilePath: malta
    });
    assert.equal((await withCr.findByBarcode(barcode)).imageSource, 'vs-cr-refid');

    const withIndia = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: empty,
      historicalImageFilePath: empty,
      vsIndiaImageFilePath: india,
      vsMaltaImageFilePath: malta
    });
    const indiaRow = await withIndia.findByBarcode(barcode);
    assert.ok(indiaRow);
    assert.equal(indiaRow.imageSource, 'vs-india');
    assert.equal(indiaRow.image, 'https://example.test/india.jpg');
    assert.equal(withIndia.metrics().vsIndiaImagesLoaded, 1);

    const withMalta = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: empty,
      historicalImageFilePath: empty,
      vsMaltaImageFilePath: malta
    });
    const maltaRow = await withMalta.findByBarcode(barcode);
    assert.ok(maltaRow);
    assert.equal(maltaRow.imageSource, 'vs-malta');
    assert.equal(maltaRow.image, 'https://example.test/malta.jpg');
    assert.equal(withMalta.metrics().vsMaltaImagesLoaded, 1);

    const withInvalidMalta = new VsExcelProductRepository(stock, {
      imageCatalogFilePath: empty,
      historicalImageFilePath: empty,
      vsMaltaImageFilePath: invalidMalta
    });
    assert.equal((await withInvalidMalta.findByBarcode(barcode)).image, null);
    assert.equal(withInvalidMalta.metrics().vsMaltaImagesLoaded, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('VS carga 667559451976 desde India cuando el cache está presente', { skip: !indiaReady }, async () => {
  const repository = new VsExcelProductRepository(masterStock, {
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: crImages,
    vsIndiaImageFilePath: indiaImages
  });
  const indiaRow = await repository.findByBarcode('667559451976');
  assert.ok(indiaRow);
  assert.equal(indiaRow.imageSource, 'vs-india');
  assert.match(indiaRow.image ?? '', /^https?:\/\//);
  assert.equal(indiaRow.CODBARRAS, '667559451976');
  assert.equal(repository.metrics().vsIndiaImagesLoaded, 311);
  assert.equal(repository.metrics().imagesLoaded, 15714);
});

test('VS loads 197575415862 exclusively from Malta and reaches expected coverage', { skip: !maltaReady }, async () => {
  const repository = new VsExcelProductRepository(masterStock, {
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: crImages,
    vsIndiaImageFilePath: indiaImages,
    vsMaltaImageFilePath: maltaImages
  });
  const maltaRow = await repository.findByBarcode('197575415862');
  assert.ok(maltaRow);
  assert.equal(maltaRow.imageSource, 'vs-malta');
  assert.match(maltaRow.image ?? '', /^https:\/\/www\.victoriassecret\.mt\/media\/catalog\/product\//);
  assert.equal((await new VsProductService(repository).getProductByBarcode('197575415862')).imageSource, 'vs-malta');
  assert.equal(repository.metrics().barcodesIndexed, 25159);
  assert.equal(repository.metrics().vsMaltaImagesLoaded, 4611);
  assert.equal(repository.metrics().imagesLoaded, 20325);
});

test('VS tolera la ausencia del cache CR', { skip: !existsSync(masterStock) }, async () => {
  const repository = new VsExcelProductRepository(masterStock, {
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: path.resolve(path.dirname(crImages), 'missing-vs-cr.json')
  });
  assert.equal(repository.metrics().vsCrImagesLoaded, 0);
});

test('VS tolera la ausencia del cache India', { skip: !ready }, async () => {
  const repository = new VsExcelProductRepository(masterStock, {
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: crImages,
    vsIndiaImageFilePath: path.resolve(path.dirname(indiaImages), 'missing-vs-india.json')
  });
  assert.equal(repository.metrics().vsIndiaImagesLoaded, 0);
  assert.equal((await repository.findByBarcode('197575012887')).imageSource, 'current');
});

test('VS server starts when the Malta cache is missing', { skip: !indiaReady }, async () => {
  const application = await startVsServer({
    port: 0,
    stockFilePath: masterStock,
    imageCatalogFilePath: currentImages,
    historicalImageFilePath: historicalImages,
    styleColorImageFilePath: styleColorImages,
    vsCrImageFilePath: crImages,
    vsIndiaImageFilePath: indiaImages,
    vsMaltaImageFilePath: path.join(vsImageTestRoot, 'missing-vs-malta.json')
  });
  try {
    assert.equal(application.repository.metrics().vsMaltaImagesLoaded, 0);
    assert.equal((await application.repository.findByBarcode('197575415862')).imageSource, null);
  } finally {
    await application.close();
  }
});
