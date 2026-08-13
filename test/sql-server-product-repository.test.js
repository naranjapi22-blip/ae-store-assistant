import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductService } from '../src/service/ProductService.js';
import { ProductRepository } from '../src/repository/ProductRepository.js';
import { queries, SqlServerProductRepository } from '../src/repository/SqlServerProductRepository.js';
import { createProductRepository } from '../src/repository/createProductRepository.js';

const knownRow = (overrides = {}) => ({
  articleCode: 41955,
  supplierRef: '28166932',
  description: '1608 NEW SKINNY WASH ADD BTS',
  additionalDescription: 'Denim Pants',
  season: 'SPRING 2026',
  ref: '0433-1608-437',
  style: '1608',
  colorDescription: 'FRESH BRIGHT',
  colorSpanish: 'AZUL',
  size: '14 REGULAR',
  color: '437',
  CODBARRAS: '400281669321',
  CODBARRAS2: null,
  CODBARRAS3: null,
  stock: 2,
  price: 36800,
  department: 'WOMEN',
  section: 'WOMENS JEANS',
  family: 'HIGH-RISE JEGGING',
  subfamily: null,
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
        async query(text) {
          calls.push({ text, params, timeout: request.timeout });
          return { recordset: recordsets.shift() ?? [] };
        }
      };
      return request;
    }
  };
};

const assertReadOnly = text => {
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC)\b/i);
  assert.doesNotMatch(text, /SELECT\s*\*/i);
  assert.doesNotMatch(text, /LIKE\s*'%/i);
  assert.match(text.trim(), /^(SELECT|WITH)\b/i);
};

const promotionRow = (overrides = {}) => ({
  promotionId: 620,
  priority: 1,
  promotionDescription: 'PP EOSS CR 12000',
  startDate: '2026-06-30',
  endDate: '2026-08-24',
  startTime: null,
  endTime: null,
  weekDays: '1111111',
  promotionGroup: 476,
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
  actionId: 1,
  actionType: 17,
  actionValue: '12000|0|0|0',
  actionValue2: null,
  groupOr: null,
  groupAnd: null,
  includeRule: null,
  conditionTable: null,
  conditionField: null,
  conditionOperator: null,
  conditionValue: null,
  directMatch: 1,
  explicitGroupMatch: 0,
  serverNow: new Date('2026-08-12T12:00:00Z'),
  ...overrides
});

test('consulta barcode con igualdad parametrizada y conserva los datos conocidos', async () => {
  const pool = mockPool([knownRow()]);
  const repository = new SqlServerProductRepository({ pool });
  const result = await repository.findByBarcode('400281669321');

  assert.equal(result.articleCode, '41955');
  assert.equal(result.ref, '0433-1608-437');
  assert.equal(result.supplierRef, '28166932');
  assert.equal(result.price, 36800);
  assert.equal(pool.calls[0].params.query, '400281669321');
  assert.equal(pool.calls[0].params.warehouse, 'V08');
  assert.equal(pool.calls[0].params.tariff, 5);
  assert.match(pool.calls[0].text, /L\.CODBARRAS\s*=\s*@query/);
  assert.match(pool.calls[0].text, /L\.CODBARRAS2\s*=\s*@query/);
  assert.match(pool.calls[0].text, /L\.CODBARRAS3\s*=\s*@query/);
  assertReadOnly(pool.calls[0].text);
});

test('aplica V08 al stock, usa PNETO de la tarifa 5 y conserva stock negativo', async () => {
  const pool = mockPool([knownRow({ stock: -3, price: 36800 })]);
  const repository = new SqlServerProductRepository({ pool });
  const result = await repository.findByQuery('28166932');
  const call = pool.calls[0];

  assert.equal(result.stock, -3);
  assert.equal(result.price, 36800);
  assert.equal(call.params.warehouse, 'V08');
  assert.equal(call.params.tariff, 5);
  assert.match(call.text, /ST\.CODALMACEN\s*=\s*@warehouse/);
  assert.match(call.text, /P\.IDTARIFAV\s*=\s*@tariff/);
  assert.match(call.text, /P\.PNETO/);
  assertReadOnly(call.text);
});

test('no elige arbitrariamente el menor CODFORMATO cuando el precio es ambiguo', async () => {
  const pool = mockPool([knownRow({ price: null })]);
  const result = await new SqlServerProductRepository({ pool }).findByBarcode('400281669321');
  const call = pool.calls[0];

  assert.equal(result.price, null);
  assert.match(call.text, /PV\.PNETO\s+AS\s+price/i);
  assert.doesNotMatch(call.text, /COALESCE\(PV\.PNETO\s*,\s*0\)/i);
  assert.match(call.text, /NOT EXISTS\s*\(\s*SELECT 1\s+FROM dbo\.PRECIOSVENTA P2/i);
  assert.match(call.text, /P2\.CODFORMATO\s*<>\s*P\.CODFORMATO/);
  assert.doesNotMatch(call.text, /ORDER BY P\.CODFORMATO/i);
  assert.equal(call.params.priceFormat, null);
});

test('ausencia total de PRECIOSVENTA devuelve precio null', async () => {
  const pool = mockPool([knownRow({ price: null })]);
  const result = await new SqlServerProductRepository({ pool }).findByBarcode('400281669321');

  assert.equal(result.price, null);
});

test('conserva PNETO real cero como precio cero', async () => {
  const pool = mockPool([knownRow({ price: 0 })]);
  const result = await new SqlServerProductRepository({ pool }).findByBarcode('400281669321');

  assert.equal(result.price, 0);
});

test('conserva PNETO real 36800', async () => {
  const pool = mockPool([knownRow({ price: 36800 })]);
  const result = await new SqlServerProductRepository({ pool }).findByBarcode('400281669321');

  assert.equal(result.price, 36800);
});

test('permite seleccionar explícitamente CODFORMATO 0', async () => {
  const pool = mockPool([knownRow({ price: 36800 })]);
  const repository = new SqlServerProductRepository({ pool, env: { SALES_PRICE_FORMAT: '0' } });
  const result = await repository.findByBarcode('400281669321');
  const call = pool.calls[0];

  assert.equal(result.price, 36800);
  assert.equal(call.params.priceFormat, 0);
  assert.match(call.text, /P\.CODFORMATO\s*=\s*@priceFormat/);
});

test('ausencia de fila de stock se convierte en stock cero', async () => {
  const pool = mockPool([knownRow({ stock: null })]);
  const result = await new SqlServerProductRepository({ pool }).findByReference('0433-1608-437');
  assert.equal(result[0].stock, 0);
  assert.match(pool.calls[0].text, /COALESCE\(ST\.STOCK, 0\)/);
});

test('REFERENCIA_STYLO devuelve múltiples CODARTICULO y sus tallas', async () => {
  const pool = mockPool([
    knownRow({ articleCode: 41955, size: '14 REGULAR', CODBARRAS: '400281669321' }),
    knownRow({ articleCode: 60339, size: '14 SHORT', CODBARRAS: '400281670396' }),
    knownRow({ articleCode: 107306, size: '10 LONG', CODBARRAS: '400281668331' })
  ]);
  const result = await new SqlServerProductRepository({ pool }).findByReference('0433-1608-437');
  assert.deepEqual(result.map(row => [row.articleCode, row.size, row.CODBARRAS]), [
    ['41955', '14 REGULAR', '400281669321'],
    ['60339', '14 SHORT', '400281670396'],
    ['107306', '10 LONG', '400281668331']
  ]);
  assert.equal(pool.calls[0].params.reference, '0433-1608-437');
});

test('ProductService agrupa las tallas del repository SQL sin consultas por talla', async () => {
  const pool = mockPool(
    [knownRow()],
    [knownRow({ size: '14 REGULAR', stock: 2 }), knownRow({ size: '16 REGULAR', stock: -1, CODBARRAS: '400281669322' })],
    []
  );
  const repository = new SqlServerProductRepository({ pool });
  const result = await new ProductService(repository).getProductByBarcode('400281669321');

  assert.deepEqual(result.sizes.map(({ size, stock }) => ({ size, stock })), [
    { size: '14 REGULAR', stock: 2 },
    { size: '16 REGULAR', stock: -1 }
  ]);
  assert.equal(pool.calls.length, 4);
  assert.equal(pool.calls.filter(call => /FROM dbo\.PROMOCIONES\s+P/i.test(call.text)).length, 1);
  assert.equal(pool.calls.filter(call => /L\.TALLA\s*=\s*@/.test(call.text)).length, 0);
});

test('promociones usa una consulta parametrizada, V08/tarifa 5 y no hace N+1', async () => {
  const pool = mockPool([promotionRow({
    promotionId: 574,
    promotionDescription: '40% OFF MULTIPACK CR',
    actionType: 17,
    actionValue: '12000|0|0|0'
  })]);
  const repository = new SqlServerProductRepository({ pool });
  const result = await repository.findApplicablePromotions(knownRow({
    departmentCode: 2,
    sectionCode: 43,
    familyCode: 433,
    price: 36800
  }));

  assert.equal(pool.calls.length, 1);
  assert.equal(pool.calls[0].params.articleCode, 41955);
  assert.equal(pool.calls[0].params.warehouse, 'V08');
  assert.equal(pool.calls[0].params.tariff, 5);
  assert.deepEqual(result.promotions[0], {
    id: 574,
    description: '40% OFF MULTIPACK CR',
    type: 'fixed_price',
    percentage: null,
    promotionalPrice: 12000,
    calculatedPrice: 12000,
    startDate: '2026-06-30',
    endDate: '2026-08-24',
    priority: 1,
    source: 'sqlserver'
  });
  assert.equal(result.bestPromotionalPrice, 12000);
  assert.match(pool.calls[0].text, /P\.IDTARIFAV\s*=\s*@tariff/i);
  assert.match(pool.calls[0].text, /PROMOCIONESTARIFAS/i);
  assert.match(pool.calls[0].text, /GRUPOSALMACENLIN/i);
  assert.match(pool.calls[0].text, /GAL\.CODALMACEN\s*=\s*@warehouse/i);
  assertReadOnly(pool.calls[0].text);
});

test('una promoción con cupón va a conditionalPromotions y no modifica el precio', async () => {
  const pool = mockPool([promotionRow({
    promotionId: 574,
    promotionDescription: '40% OFF MULTIPACK CR',
    actionType: 17,
    actionValue: '12000|0|0|0',
    requestSerializedCoupon: 'T'
  })]);
  const repository = new SqlServerProductRepository({ pool });
  const result = await repository.findApplicablePromotions(knownRow({ price: 36800 }));

  assert.deepEqual(result.promotions, []);
  assert.equal(result.conditionalPromotions.length, 1);
  assert.deepEqual(result.conditionalPromotions[0], {
    id: 574,
    description: '40% OFF MULTIPACK CR',
    type: 'fixed_price',
    percentage: null,
    promotionalPrice: 12000,
    calculatedPrice: null,
    startDate: '2026-06-30',
    endDate: '2026-08-24',
    priority: 1,
    source: 'sqlserver',
    conditionType: 'serialized_coupon',
    conditionTypes: ['serialized_coupon'],
    conditionLabel: 'Requiere cupón',
    requiresValidation: true
  });
  assert.equal(result.bestPromotionalPrice, null);
});

test('promociones internas de empleados o mercadeo no llegan a ningún resultado', async () => {
  for (const description of ['20% EMPLEADOS GD CRI', '30% EMPLEADOS GD PAISES', '30% MERCADEO GD', '15% OFF MOUNT VIEW SCHOOL']) {
    const pool = mockPool([promotionRow({ promotionDescription: description, requestSerializedCoupon: 'T' })]);
    const result = await new SqlServerProductRepository({ pool }).findApplicablePromotions(knownRow());
    assert.deepEqual(result.promotions, []);
    assert.deepEqual(result.conditionalPromotions, []);
  }
});

test('286 y 607 comerciales condicionadas permanecen visibles si el producto es elegible', async () => {
  const pool = mockPool([
    promotionRow({ promotionId: 286, promotionDescription: '20% OFF NEW ARRIVAL ESCAZU CRI', requestSerializedCoupon: 'T' }),
    promotionRow({ promotionId: 607, promotionDescription: '20% OFF AERIE NEW ARRIVAL ESCAZU CRI', requestSerializedCoupon: 'T' })
  ]);
  const result = await new SqlServerProductRepository({ pool }).findApplicablePromotions(knownRow());
  assert.deepEqual(result.promotions, []);
  assert.deepEqual(result.conditionalPromotions.map(promotion => promotion.id), [286, 607]);
  assert.ok(result.conditionalPromotions.every(promotion => promotion.conditionType === 'serialized_coupon'));
});

test('las exclusiones conocidas por ID no llegan a promotions ni conditionalPromotions', async () => {
  for (const promotionId of [2, 3, 4, 361, 541, 620, 621, 622]) {
    const pool = mockPool([promotionRow({
      promotionId,
      promotionDescription: `Promoción comercial ${promotionId}`,
      requestSerializedCoupon: 'T'
    })]);
    const result = await new SqlServerProductRepository({ pool }).findApplicablePromotions(knownRow());
    assert.deepEqual(result.promotions, [], `promotions para ${promotionId}`);
    assert.deepEqual(result.conditionalPromotions, [], `conditionalPromotions para ${promotionId}`);
  }
});

test('las promociones comerciales 286 y 607 siguen permitidas por ID', async () => {
  const pool = mockPool([
    promotionRow({ promotionId: 286, promotionDescription: '20% OFF NEW ARRIVAL ESCAZU CRI', requestSerializedCoupon: 'T' }),
    promotionRow({ promotionId: 607, promotionDescription: '20% OFF AERIE NEW ARRIVAL ESCAZU CRI', requestSerializedCoupon: 'T' })
  ]);
  const result = await new SqlServerProductRepository({ pool }).findApplicablePromotions(knownRow());
  assert.deepEqual(result.conditionalPromotions.map(promotion => promotion.id), [286, 607]);
});

test('ARTICPROMOCION directo y ELEMENTOSGRUPO explícito son fuentes válidas', async () => {
  const directPool = mockPool([promotionRow({ promotionId: 574, directMatch: 1, explicitGroupMatch: 0 })]);
  const explicitPool = mockPool([promotionRow({ promotionId: 574, explicitGroupMatch: 1, directMatch: 0 })]);
  const context = knownRow({ departmentCode: 2, sectionCode: 43, familyCode: 433, price: 36800 });

  assert.equal((await new SqlServerProductRepository({ pool: directPool }).findApplicablePromotions(context)).promotions.length, 1);
  assert.equal((await new SqlServerProductRepository({ pool: explicitPool }).findApplicablePromotions(context)).promotions.length, 1);
});

test('grupo dinámico evalúa el estado actual y descarta reglas no soportadas', async () => {
  const pool = mockPool([
    promotionRow({
      promotionId: 606,
      promotionDescription: '40% OFF NEW ARRIVAL ESCAZU CRI',
      actionType: 4,
      actionValue: '40|0||0|0',
      directMatch: 0,
      explicitGroupMatch: 0,
      promotionGroup: 468,
      groupOr: 3,
      groupAnd: 0,
      includeRule: 'T',
      conditionTable: 0,
      conditionField: 'DPTO',
      conditionOperator: '=',
      conditionValue: '2'
    }),
    promotionRow({
      promotionId: 606,
      actionType: 4,
      actionValue: '40|0||0|0',
      directMatch: 0,
      explicitGroupMatch: 0,
      promotionGroup: 468,
      groupOr: 3,
      groupAnd: 1,
      includeRule: 'T',
      conditionTable: 0,
      conditionField: 'TEMPORADA',
      conditionOperator: 'LIKE1',
      conditionValue: '2026'
    })
  ]);
  const result = await new SqlServerProductRepository({ pool }).findApplicablePromotions(knownRow({
    departmentCode: 2,
    season: 'SPRING 2026',
    price: 36800
  }));
  assert.equal(result.promotions[0].type, 'percentage');
  assert.equal(result.promotions[0].calculatedPrice, 22080);

  const unsupportedPool = mockPool([promotionRow({
    directMatch: 0,
    explicitGroupMatch: 0,
    conditionField: 'UNKNOWN_FIELD'
  })]);
  const unsupportedResult = await new SqlServerProductRepository({ pool: unsupportedPool }).findApplicablePromotions(knownRow());
  assert.deepEqual(unsupportedResult.promotions, []);
  assert.deepEqual(unsupportedResult.conditionalPromotions, []);
});

test('fecha vencida, tarifa/acción especial y precio base se manejan conservadoramente', async () => {
  const expired = mockPool([promotionRow({ endDate: '2026-08-11' })]);
  const expiredResult = await new SqlServerProductRepository({ pool: expired }).findApplicablePromotions(knownRow());
  assert.deepEqual(expiredResult.promotions, []);
  assert.deepEqual(expiredResult.conditionalPromotions, []);

  const special = mockPool([promotionRow({ promotionId: 574, requestSerializedCoupon: 'T' })]);
  const specialResult = await new SqlServerProductRepository({ pool: special }).findApplicablePromotions(knownRow());
  assert.deepEqual(specialResult.promotions, []);
  assert.equal(specialResult.conditionalPromotions.length, 1);

  const unknown = mockPool([promotionRow({ actionType: 3, actionValue: '50|0|0' })]);
  const unknownResult = await new SqlServerProductRepository({ pool: unknown }).findApplicablePromotions(knownRow({ price: 36800 }));
  assert.deepEqual(unknownResult.promotions, []);
  assert.deepEqual(unknownResult.conditionalPromotions, []);
  assert.equal(unknownResult.bestPromotionalPrice, null);

  const multiple = mockPool([
    promotionRow(),
    promotionRow({ promotionId: 621, promotionDescription: 'PP EOSS CR 10000', actionValue: '10000|0|0|0' })
  ]);
  assert.equal((await new SqlServerProductRepository({ pool: multiple }).findApplicablePromotions(knownRow())).bestPromotionalPrice, null);

  const service = new ProductService({
    findByReference: async () => [],
    findByStyle: async () => [],
    findApplicablePromotions: async () => ({
      promotions: [],
      conditionalPromotions: [{ id: 620, conditionLabel: 'Requiere cupón', requiresValidation: true }],
      bestPromotionalPrice: null
    })
  });
  const serviceProduct = await service.getProduct(knownRow({ price: 36800 }));
  assert.equal(serviceProduct.price, 36800);
  assert.equal(serviceProduct.conditionalPromotions.length, 1);
});

test('Excel/base repository devuelve promociones vacías por compatibilidad', async () => {
  assert.deepEqual(await new ProductRepository().findApplicablePromotions({}), []);
});

test('la consulta de promociones es SELECT parametrizado y no usa histórico', () => {
  assertReadOnly(queries.promotions);
  assert.match(queries.promotions, /@articleCode/);
  assert.match(queries.promotions, /@warehouse/);
  assert.match(queries.promotions, /@tariff/);
  assert.doesNotMatch(queries.promotions, /ALBVENTALINPROMOCIONES/i);
});

test('ProductService conserva precio desconocido como null y precio cero como 0', async () => {
  const service = new ProductService({
    findByReference: async () => [],
    findByStyle: async () => []
  });

  assert.equal((await service.getProduct(knownRow({ price: null }))).price, null);
  assert.equal((await service.getProduct(knownRow({ price: 0 }))).price, 0);
});

test('related colors excluye otra familia aunque comparta STYLE', async () => {
  const current = knownRow({ ref: '1177-1541-001', style: '1541', color: '001', stock: 1 });
  const sameFamily = knownRow({ ref: '1177-1541-100', style: '1541', color: '100', stock: 2 });
  const differentFamily = knownRow({ ref: '0433-1541-100', style: '1541', color: '100', stock: 5 });
  const pool = mockPool([current], [current, sameFamily, differentFamily]);
  const repository = new SqlServerProductRepository({ pool });

  const result = await new ProductService(repository).getProduct(current);

  assert.deepEqual(result.relatedColors.map(color => color.reference), ['1177-1541-100']);
  assert.match(pool.calls[1].text, /CL\.STYLE\s*=\s*@style/);
  assert.equal(pool.calls[1].params.style, '1541');
});

test('clasificación nullable se mapea sin romper el contrato', async () => {
  const pool = mockPool([knownRow({ department: null, section: null, family: null, subfamily: null })]);
  const result = await new SqlServerProductRepository({ pool }).findByBarcode('400281669321');
  assert.equal(result.department, '');
  assert.equal(result.section, '');
  assert.equal(result.family, '');
  assert.equal(result.subfamily, '');
});

test('STYLE y búsquedas de catálogo usan igualdad exacta sin LIKE', async () => {
  const pool = mockPool([{ ref: '0433-1608-437', style: '1608', stockTotal: 2, sizesWithStock: 1, price: 36800 }]);
  const result = await new SqlServerProductRepository({ pool }).searchProducts('1608', 20);
  const call = pool.calls[0];

  assert.equal(result[0].ref, '0433-1608-437');
  assert.equal(result[0].stockTotal, 2);
  assert.match(call.text, /CL\.STYLE\s*=\s*@query/);
  assert.doesNotMatch(call.text, /LIKE\s+/i);
  assert.match(call.text, /HAVING\s+SUM\(stock\)\s*>\s*0/i);
  assert.equal(call.params.query, '1608');
  assertReadOnly(call.text);
});

test('categorías, productos y similares son consultas parametrizadas de solo lectura', async () => {
  const pool = mockPool(
    [{ value: 'WOMEN' }],
    [{ value: 'WOMENS JEANS' }],
    [{ value: 'HIGH-RISE JEGGING' }],
    [{ ref: '0433-1608-437', stockTotal: 2, sizesWithStock: 1 }],
    [{ ref: '0433-9999-100', stockTotal: 4, sizesWithStock: 2 }]
  );
  const repository = new SqlServerProductRepository({ pool });
  assert.deepEqual(await repository.getDepartments(), ['WOMEN']);
  assert.deepEqual(await repository.getSections('WOMEN'), ['WOMENS JEANS']);
  assert.deepEqual(await repository.getFamilies('WOMEN', 'WOMENS JEANS'), ['HIGH-RISE JEGGING']);
  assert.equal((await repository.getProductsByCategory('WOMEN', 'WOMENS JEANS', 'HIGH-RISE JEGGING'))[0].stockTotal, 2);
  assert.equal((await repository.findSimilarProducts({ department: 'WOMEN', section: 'WOMENS JEANS', family: 'HIGH-RISE JEGGING', excludeReference: '0433-1608-437' }))[0].ref, '0433-9999-100');
  for (const call of pool.calls) assertReadOnly(call.text);
  assert.equal(pool.calls[3].params.department, 'WOMEN');
  assert.equal(pool.calls[3].params.limit, 20);
  assert.equal(pool.calls[4].params.excludeReference, '0433-1608-437');
  assert.equal(pool.calls[3].params.warehouse, 'V08');
  assert.match(pool.calls[3].text, /ST\.CODALMACEN\s*=\s*@warehouse/);
  assert.doesNotMatch(pool.calls[3].text, /M08/);
  assert.match(pool.calls[3].text, /HAVING\s+SUM\(COALESCE\(ST\.STOCK, 0\)\)\s*>\s*0/i);
  assert.match(pool.calls[4].text, /HAVING\s+SUM\(COALESCE\(ST\.STOCK, 0\)\)\s*>\s*0/i);
  assert.equal(pool.calls[0].params.hiddenDepartment, 'muebles');
});

test('consulta exacta conserva stock cero y el catálogo solo acepta referencias vendibles', async () => {
  const pool = mockPool(
    [knownRow({ stock: 0 })],
    [{ ref: 'SELLABLE', stockTotal: 1, sizesWithStock: 1 }]
  );
  const repository = new SqlServerProductRepository({ pool });
  assert.equal((await repository.findByBarcode('400281669321')).stock, 0);
  assert.deepEqual((await repository.getProductsByCategory('WOMEN', 'WOMENS JEANS', 'HIGH-RISE JEGGING')).map(row => row.ref), ['SELLABLE']);
  assert.match(pool.calls[1].text, /HAVING\s+SUM\(COALESCE\(ST\.STOCK, 0\)\)\s*>\s*0/i);
  assert.match(pool.calls[1].text, /ST\.CODALMACEN\s*=\s*@warehouse/);
  assert.doesNotMatch(pool.calls[0].text, /hiddenDepartment|muebles/i);
});

test('PRECIOSVENTA se resuelve con OUTER APPLY y no puede multiplicar stock por CODFORMATO', async () => {
  const activePriceRows = [
    { CODFORMATO: 0, PNETO: 36800 },
    { CODFORMATO: 1, PNETO: 37000 }
  ];
  const pool = mockPool([{ ref: '0433-1608-437', stockTotal: 2, sizesWithStock: 1, price: 36800 }]);
  const result = await new SqlServerProductRepository({ pool }).getProductsByCategory('WOMEN', 'WOMENS JEANS', 'HIGH-RISE JEGGING');
  const call = pool.calls[0];

  assert.equal(activePriceRows.length, 2);
  assert.equal(result[0].stockTotal, 2);
  assert.match(call.text, /OUTER APPLY\s*\(\s*SELECT P\.PNETO/i);
  assert.match(call.text, /NOT EXISTS\s*\(\s*SELECT 1\s+FROM dbo\.PRECIOSVENTA P2/i);
  assert.match(call.text, /MAX\(PV\.PNETO\)\s+AS\s+price/i);
  assert.doesNotMatch(call.text, /JOIN\s+dbo\.PRECIOSVENTA\s+P\b/i);
  assert.match(call.text, /SUM\(COALESCE\(ST\.STOCK, 0\)\)/i);
  assert.equal(call.params.warehouse, 'V08');
  assertReadOnly(call.text);
});

test('selector conserva Excel como default y selecciona SQL solo explícitamente', () => {
  const excel = createProductRepository({
    env: {},
    inventoryPath: 'fixture.xls',
    excelRepositoryFactory: filePath => ({ source: 'excel', filePath })
  });
  assert.deepEqual(excel, { source: 'excel', filePath: 'fixture.xls' });

  const sql = createProductRepository({
    env: { DATA_SOURCE: 'sqlserver' },
    sqlRepositoryFactory: ({ env }) => ({ source: 'sqlserver', env })
  });
  assert.equal(sql.source, 'sqlserver');
});

test('configura timeout y variables de conexión sin incluir secretos en SQL', () => {
  const pool = mockPool([]);
  const repository = new SqlServerProductRepository({
    pool,
    env: {
      DB_SERVER: 'db-host', DB_DATABASE: 'AEStore', DB_USER: 'reader', DB_PASSWORD: 'secret',
      DB_ENCRYPT: 'false', DB_TRUST_SERVER_CERTIFICATE: 'true', STORE_WAREHOUSE: 'V08', SALES_TARIFF_ID: '5', DB_REQUEST_TIMEOUT_MS: '3000'
    }
  });
  assert.equal(repository.config.server, 'db-host');
  assert.equal(repository.config.database, 'AEStore');
  assert.equal(repository.config.user, 'reader');
  assert.equal(repository.config.options.encrypt, false);
  assert.equal(repository.config.options.trustServerCertificate, true);
  return repository.findByBarcode('400281669321').then(() => {
    assert.equal(pool.calls[0].timeout, 3000);
    assert.doesNotMatch(pool.calls[0].text, /secret/);
  });
});
