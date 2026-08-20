import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductService } from '../src/service/ProductService.js';
import { ProductRepository } from '../src/repository/ProductRepository.js';
import { SqlServerProductRepository, queries } from '../src/repository/SqlServerProductRepository.js';
import { productApi } from '../src/api/productApi.js';

const row = (overrides = {}) => ({
  promotionId: 700,
  priority: 1,
  promotionDescription: '30% OFF DENIM',
  startDate: '2026-08-01',
  endDate: '2026-08-31',
  startTime: null,
  endTime: null,
  weekDays: '1111111',
  clientRequired: 'F',
  clientGroup: 0,
  couponEan: null,
  serializedCoupon: 'F',
  externalValidation: 'F',
  manualPromotion: 'F',
  requestSerializedCoupon: 'F',
  terminalTypeRequired: 'F',
  deliveryPromotion: 'F',
  paymentMethodDiscount: 'F',
  paymentMethodCode: null,
  birthdayRequired: 0,
  applyCount: 0,
  applyCountPerClient: 0,
  applyCountPerClientPeriod: 0,
  applyCountPerClientOffline: 0,
  birthdayDaysBefore: 0,
  birthdayDaysAfter: 0,
  articleCount: 1,
  minimumAmount: 0,
  applicationType: 0,
  applicationCondition: 0,
  applicationMoment: 0,
  actionCount: 1,
  actionType: 4,
  actionValue: '30|0|0|0',
  referenceCount: 2,
  stockUnits: 7,
  totalReferenceCount: 2,
  totalStockUnits: 7,
  serverNow: new Date('2026-08-20T12:00:00Z'),
  ref: '0433-1608-437',
  description: '1608 JEAN',
  additionalDescription: 'Denim Pants',
  colorDescription: 'DARK WASH',
  colorSpanish: 'AZUL',
  color: '437',
  price: 36800,
  department: 'WOMEN',
  section: 'JEANS',
  family: 'DENIM',
  stockTotal: 7,
  sizesWithStock: 4,
  ...overrides
});

const promotionMetadataRow = (overrides = {}) => row({
  promotionGroup: null,
  actionId: 1,
  directArticles: 1,
  groupElements: 0,
  groupConditions: 0,
  stockLinkedArticles: 1,
  currentMatch: 1,
  tariffMatch: 1,
  warehouseMatch: 1,
  ...overrides
});

const mockPool = (...recordsets) => {
  const calls = [];
  return {
    calls,
    request() {
      const params = {};
      const request = {
        timeout: null,
        input(name, _type, value) { params[name] = value; return request; },
        async query(text) { calls.push({ text, params, timeout: request.timeout }); return { recordset: recordsets.shift() || [] }; }
      };
      return request;
    }
  };
};

const assertReadOnly = text => {
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC)\b/i);
  assert.match(text.trim(), /^(WITH|SELECT)\b/i);
};

const request = path => ({ url: path });
const response = () => {
  const state = { status: null, headers: {}, body: '' };
  return { state, setHeader: (key, value) => { state.headers[key] = value; }, writeHead: (status, headers) => { state.status = status; Object.assign(state.headers, headers); }, end: body => { state.body = body ?? ''; } };
};

test('ProductRepository Excel conserva resumen de promociones vacío', async () => {
  assert.deepEqual(await new ProductRepository().getPromotionSummary(), { promotions: [], totals: { referenceCount: 0, stockUnits: 0 } });
  assert.deepEqual(await new ProductRepository().getPromotionProducts(1), { products: [], page: 1, limit: 40, hasMore: false, totalReferences: 0, totalUnits: 0 });
});

test('resumen SQL aplica reglas, cuenta referencias y unidades locales', async () => {
  const pool = mockPool([promotionMetadataRow()], [row({ directPromotionId: 700, explicitGroupId: null, stock: 7 })]);
  const repository = new SqlServerProductRepository({ pool, env: { STORE_WAREHOUSE: 'LOCAL-01' } });
  const result = await repository.getPromotionSummary();
  assert.equal(result.promotions[0].referenceCount, 1);
  assert.equal(result.promotions[0].stockUnits, 7);
  assert.deepEqual(result.totals, { referenceCount: 1, stockUnits: 7 });
  assert.equal(pool.calls.length, 2);
  assert.ok(pool.calls.every(call => call.params.warehouse === 'LOCAL-01'));
  assert.ok(pool.calls.every(call => call.params.tariff === 5));
  assert.match(pool.calls[1].text, /ST\.CODALMACEN\s*=\s*@warehouse/i);
  assert.match(pool.calls[1].text, /ST\.STOCK\s*>\s*0/i);
  assert.doesNotMatch(pool.calls[1].text, /PRECIOSVENTA/i);
  assert.ok(pool.calls.every(call => assertReadOnly(call.text) === undefined));
});

test('productos de promoción agrupan referencias, excluyen stock no positivo y limitan página', async () => {
  const pool = mockPool(
    [promotionMetadataRow()],
    [row({ directPromotionId: 700, explicitGroupId: null, stock: 7 })],
    [row({ stock: 4, size: 'S' }), row({ ref: '0433-1608-438', stock: 3, size: 'M' })]
  );
  const repository = new SqlServerProductRepository({ pool, env: { STORE_WAREHOUSE: 'LOCAL-01' } });
  const result = await repository.getPromotionProducts(700, { page: 2, limit: 40, search: '0433-1608-437', department: 'WOMEN' });
  assert.equal(result.page, 2);
  assert.equal(result.limit, 40);
  assert.equal(result.products.length, 0);
  assert.equal(pool.calls[2].params.promotionId, 700);
  assert.equal(pool.calls[2].params.offset, 40);
  assert.equal(pool.calls[2].params.limit, 41);
  assert.equal(pool.calls[2].params.search, '0433-1608-437');
  assert.equal(pool.calls[2].params.department, 'WOMEN');
  assert.match(pool.calls[2].text, /ST\.STOCK\s*>\s*0/i);
  assert.ok(pool.calls[2].text.includes('ARTICPROMOCION'));
  assertReadOnly(pool.calls[2].text);
});

test('totales de productos promocionales cubren todo el conjunto filtrado y no dependen de la página', async () => {
  const pool = mockPool(
    [promotionMetadataRow()],
    [
      row({ stock: 5, directPromotionId: 700, ref: 'REF-001', department: 'WOMEN', section: 'TOPS', family: 'DENIM' }),
      row({ stock: 313, directPromotionId: 700, ref: 'REF-002', department: 'WOMEN', section: 'TOPS', family: 'DENIM' })
    ],
    [row({ stock: 5, ref: 'REF-001', department: 'WOMEN', section: 'TOPS', family: 'DENIM' })]
  );
  const repository = new SqlServerProductRepository({ pool, env: { STORE_WAREHOUSE: 'LOCAL-01' } });
  const result = await repository.getPromotionProducts(700, {
    page: 3,
    limit: 40,
    search: '',
    department: 'WOMEN',
    section: 'TOPS',
    family: 'DENIM'
  });
  assert.equal(result.totalReferences, 2);
  assert.equal(result.totalUnits, 318);
  assert.equal(pool.calls[2].params.offset, 80);
  assert.equal(pool.calls.length, 3);
  assert.equal(pool.calls[2].params.search, '');
  assert.equal(pool.calls[2].params.department, 'WOMEN');
  assert.match(pool.calls[1].text, /ST\.CODALMACEN\s*=\s*@warehouse/i);
  assertReadOnly(pool.calls[2].text);
});

test('promociones condicionadas no calculan precio promocional', async () => {
  const conditional = row({ externalValidation: 'T', referenceCount: 1, stockUnits: 2 });
  const pool = mockPool([promotionMetadataRow({ externalValidation: 'T' })], [row({ directPromotionId: 700, stock: 2 })]);
  const result = await new ProductService(new SqlServerProductRepository({ pool })).getPromotionSummary();
  assert.equal(result.promotions[0].requiresValidation, true);
  assert.equal(result.promotions[0].conditionLabel, 'Validar condiciones en caja');
});

test('promoción dinámica soportada aparece usando condiciones y stock local', async () => {
  const promotionMetadata = promotionMetadataRow({
    promotionId: 607,
    promotionDescription: '20% OFF AERIE NEW ARRIVAL ESCAZU CRI',
    promotionGroup: 468,
    directArticles: 0,
    groupElements: 0,
    groupConditions: 1,
    conditionTable: '0',
    conditionField: 'DPTO',
    conditionOperator: '=',
    conditionValue: '10',
    includeRule: 'T',
    groupOr: 1,
    groupAnd: 1
  });
  const article = row({ articleCode: 10, size: 'S', color: '1', stock: 5, departmentCode: 10, directPromotionId: null, explicitGroupId: null });
  const repository = new SqlServerProductRepository({ pool: mockPool([promotionMetadata], [article]), env: { STORE_WAREHOUSE: 'LOCAL-01' } });
  const result = await repository.getPromotionSummary();
  assert.equal(result.promotions[0].id, 607);
  assert.equal(result.promotions[0].stockUnits, 5);
});

test('productos de promoción reutiliza la misma pertenencia dinámica del resumen', async () => {
  const promotionMetadata = promotionMetadataRow({
    promotionId: 607,
    promotionGroup: 468,
    conditionTable: '0',
    conditionField: 'DPTO',
    conditionOperator: '=',
    conditionValue: '10',
    includeRule: 'T'
  });
  const article = row({ articleCode: 10, size: 'S', color: '1', stock: 5, departmentCode: 10, directPromotionId: null, explicitGroupId: null });
  const detail = row({ articleCode: 10, stock: 5, size: 'S', color: '1', ref: '607-REF-001', department: 'WOMEN', section: 'JEANS', family: 'DENIM' });
  const repository = new SqlServerProductRepository({ pool: mockPool([promotionMetadata], [article], [detail]), env: { STORE_WAREHOUSE: 'LOCAL-01' } });
  const result = await repository.getPromotionProducts(607, { page: 1, limit: 40 });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].promotionId, 607);
  assert.equal(result.products[0].stockTotal, 5);
});

test('promoción dinámica con condición unsupported permanece fuera', async () => {
  const promotionMetadata = promotionMetadataRow({
    promotionId: 17,
    promotionGroup: 468,
    directArticles: 0,
    groupElements: 0,
    groupConditions: 1,
    conditionTable: '9',
    conditionField: 'CAMPO_NO_SOPORTADO',
    conditionOperator: '=',
    conditionValue: 'X',
    includeRule: 'T'
  });
  const article = row({ stock: 5, directPromotionId: null, explicitGroupId: null });
  const repository = new SqlServerProductRepository({ pool: mockPool([promotionMetadata], [article]), env: { STORE_WAREHOUSE: 'LOCAL-01' } });
  const result = await repository.getPromotionSummary();
  assert.deepEqual(result.promotions, []);
});

test('stock cero no produce match dinámico y referencias repetidas no duplican totales', async () => {
  const first = promotionMetadataRow({ promotionId: 607, promotionGroup: 468, conditionTable: '0', conditionField: 'DPTO', conditionOperator: '=', conditionValue: '10', includeRule: 'T' });
  const second = promotionMetadataRow({ promotionId: 608, promotionDescription: '10% OFF', promotionGroup: 469, conditionTable: '0', conditionField: 'DPTO', conditionOperator: '=', conditionValue: '10', includeRule: 'T' });
  const sameReference = row({ stock: 5, departmentCode: 10, directPromotionId: 607, explicitGroupId: null });
  const sameReferenceSecondPromotion = row({ stock: 5, departmentCode: 10, directPromotionId: 608, explicitGroupId: null });
  const zeroStock = row({ stock: 0, departmentCode: 10, directPromotionId: 607, explicitGroupId: null });
  const repository = new SqlServerProductRepository({
    pool: mockPool([first, second], [sameReference, sameReferenceSecondPromotion, zeroStock]),
    env: { STORE_WAREHOUSE: 'LOCAL-01' }
  });
  const result = await repository.getPromotionSummary();
  assert.equal(result.promotions.length, 2);
  assert.deepEqual(result.totals, { referenceCount: 1, stockUnits: 5 });
});

test('API expone resumen y productos con filtros y paginación', async () => {
  const service = {
    getPromotionSummary: async () => ({ promotions: [{ id: 700 }], totals: { referenceCount: 1, stockUnits: 2 } }),
    getPromotionProducts: async (id, options) => ({ products: [{ id }], page: options.page, limit: options.limit, hasMore: false })
  };
  const summary = response();
  await productApi(service)(request('/api/promotions'), summary);
  assert.equal(summary.state.status, 200);
  assert.equal(JSON.parse(summary.state.body).totals.stockUnits, 2);
  const products = response();
  await productApi(service)(request('/api/promotions/700/products?page=3&limit=99&department=WOMEN&section=JEANS&family=DENIM&search=0433-1608-437'), products);
  assert.equal(products.state.status, 200);
  assert.deepEqual(JSON.parse(products.state.body), { products: [{ id: 700 }], page: 3, limit: 50, hasMore: false });
});

test('queries nuevas permanecen parametrizadas y read-only', () => {
  assertReadOnly(queries.promotionSummaryQuery);
  assertReadOnly(queries.promotionMetadataQuery);
  assertReadOnly(queries.promotionProductsQuery);
  for (const query of [queries.promotionSummaryQuery, queries.promotionMetadataQuery, queries.promotionProductsQuery]) {
    assert.match(query, /@warehouse/);
    assert.match(query, /@tariff/);
    assert.doesNotMatch(query, /SELECT\s*\*/i);
  }
  assert.match(queries.promotionMetadataQuery, /CONDICIONESGRUPOSARTICULOS/i);
  assert.match(queries.promotionMetadataQuery, /ARTICPROMOCION/i);
  assert.match(queries.promotionMetadataQuery, /ELEMENTOSGRUPO\s+EG/i);
  assert.match(queries.promotionMetadataQuery, /EG\.IDGRUPO\s*=\s*P\.IDGRUPO/i);
  assert.match(queries.promotionMetadataQuery, /ST\.CODALMACEN\s*=\s*@warehouse/i);
  assert.doesNotMatch(queries.promotionMetadataQuery, /PRECIOSVENTA/i);
});

test('el resumen usa promotionId de la CTE y no atribuye IDPROMOCION a ELEMENTOSGRUPO', () => {
  const summary = queries.promotionSummaryQuery;
  assert.match(summary, /PromotionArticleLinks[\s\S]*ELEMENTOSGRUPO[\s\S]*EG\.IDGRUPO\s*=\s*P\.IDGRUPO/i);
  assert.match(summary, /PromotionReferenceStock[\s\S]*L\.promotionId\s+AS\s+promotionId/i);
  assert.doesNotMatch(summary, /L\.IDPROMOCION\b/i);
  assert.doesNotMatch(summary, /EG\.IDPROMOCION\b/i);
});
