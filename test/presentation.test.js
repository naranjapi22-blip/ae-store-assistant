import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    const shouldHave = force === undefined ? !this.values.has(value) : force;
    if (shouldHave) this.values.add(value); else this.values.delete(value);
    return shouldHave;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor() {
    this.classList = new FakeClassList();
    this.dataset = {};
    this.handlers = {};
    this.children = [];
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.innerHTML = '';
  }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  setAttribute() {}
  focus() {}
  select() {}
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
}

class ResultElement extends FakeElement {
  set innerHTML(value) {
    this.html = value;
    this.children = [];
    if (typeof value !== 'string') return;
    const indexes = [...value.matchAll(/data-size-index="(\d+)"/g)].map(match => match[1]);
    this.children = indexes.map(index => {
      const button = new FakeElement();
      button.dataset.sizeIndex = index;
      return button;
    });
  }
  get innerHTML() { return this.html; }
  querySelector(selector) {
    if (selector === '.quick-summary') return this.quickSummary;
    if (selector === '.quick-status') return this.quickStatus;
    if (selector === '.quick-size') return this.quickSize;
    if (selector === '.quick-stock') return this.quickStock;
    if (selector === '.detail-barcode') return this.detailBarcode;
    if (selector === '#similar-products') return this.similarProducts;
    if (selector === '.image-frame img') return new FakeElement();
    if (selector === '.image-placeholder') return new FakeElement();
    if (selector === '.quick-summary-item strong') return this.quickSize;
    if (selector === '.operational-details > div:last-child strong') return this.detailBarcode;
    return new FakeElement();
  }
  querySelectorAll(selector) {
    if (selector === '[data-size-index]') return this.children;
    if (selector === '.quick-summary-item') return [
      { querySelector: () => this.quickSize },
      { querySelector: () => this.quickStock }
    ];
    return [];
  }
  prepareProductNodes() {
    this.quickSummary = new FakeElement();
    this.quickSize = new FakeElement();
    this.quickStock = new FakeElement();
    this.quickStatus = new FakeElement();
    this.detailBarcode = new FakeElement();
    this.similarProducts = new FakeElement();
    this.similarProducts.querySelectorAll = () => [];
  }
}

const createBrowserContext = payload => {
  const form = new FakeElement();
  const primaryButton = new FakeElement();
  form.querySelector = () => primaryButton;
  const input = new FakeElement();
  const clearButton = new FakeElement();
  const result = new ResultElement();
  result.prepareProductNodes();
  const message = new FakeElement();
  const catalogTools = new FakeElement();
  const catalogExplorer = new FakeElement();
  const searchTitle = new FakeElement();
  const elements = { '#search': form, '#barcode': input, '#clear': clearButton, '#result': result, '#message': message, '#catalog-tools': catalogTools, '#catalog-explorer': catalogExplorer, '#search-title': searchTitle };
  const document = {
    querySelector: selector => elements[selector] || new FakeElement(),
    querySelectorAll: () => []
  };
  const fetch = async path => ({
    ok: true,
    async json() {
      return path.includes('/similar') ? { results: [] } : payload;
    }
  });
  const context = vm.createContext({ document, fetch, URLSearchParams, Intl, console });
  vm.runInContext(appSource, context);
  return { form, input, result };
};

const productPayload = sizes => ({
  description: 'Producto',
  data: undefined,
  scannedSize: 'AGOTADA',
  stock: 0,
  price: 100,
  sizes,
  relatedColors: [],
  REFERENCIA_STYLO: '0433-1608-437',
  STYLE: '1608',
  barcode: '000',
  season: 'SPRING 2026'
});

test('Disponibilidad de tallas muestra solo stock positivo y el contador coincide', async () => {
  const { form, input, result } = createBrowserContext(productPayload([
    { size: 'S', stock: 5, barcode: '005' },
    { size: 'M', stock: 1, barcode: '001' },
    { size: 'L', stock: 0, barcode: '000' },
    { size: 'XL', stock: -1, barcode: '-01' }
  ]));
  input.value = '000';

  await form.handlers.submit({ preventDefault() {} });

  assert.equal((result.html.match(/data-size-index=/g) || []).length, 2);
  assert.match(result.html, />2 tallas</);
  assert.match(result.html, /class="size-name">S<\/span>/);
  assert.match(result.html, /class="size-name">M<\/span>/);
  assert.doesNotMatch(result.html, /class="size-name">L<\/span>/);
  assert.doesNotMatch(result.html, /class="size-name">XL<\/span>/);
  assert.match(result.html, /Stock exacto<\/span><strong>0/);
});

test('click en talla visible mantiene cambio local de stock y barcode', async () => {
  const { form, input, result } = createBrowserContext(productPayload([
    { size: 'S', stock: 5, barcode: '005' },
    { size: 'M', stock: 1, barcode: '001' },
    { size: 'AGOTADA', stock: 0, barcode: '000' }
  ]));
  input.value = '000';

  await form.handlers.submit({ preventDefault() {} });
  await result.children[1].handlers.click();

  assert.equal(result.quickSize.textContent, 'S');
  assert.equal(result.quickStock.textContent, '5 unidades');
  assert.equal(result.detailBarcode.textContent, '005');
  assert.equal(result.quickStatus.textContent, 'Disponible');
});

test('muestra solo promociones seguras y no muestra acciones desconocidas', async () => {
  const { form, input, result } = createBrowserContext({
    ...productPayload([{ size: 'S', stock: 5, barcode: '005' }]),
    promotions: [
      { id: 1, description: '20% OFF', type: 'percentage', percentage: 20, calculatedPrice: 80 },
      { id: 2, description: 'Acción sin interpretar', type: 'unknown', calculatedPrice: null }
    ]
  });
  input.value = '005';

  await form.handlers.submit({ preventDefault() {} });

  assert.match(result.html, /Promoci/);
  assert.match(result.html, /20% de descuento/);
  assert.match(result.html, /80/);
  assert.doesNotMatch(result.html, /AcciÃ³n sin interpretar/);
});

test('muestra promociones de precio fijo y conserva visible el precio base', async () => {
  const { form, input, result } = createBrowserContext({
    ...productPayload([{ size: 'S', stock: 5, barcode: '005' }]),
    price: 100,
    promotions: [{ id: 2, description: 'Precio fijo especial', type: 'fixed_price', promotionalPrice: 120, calculatedPrice: 120 }]
  });
  input.value = '005';

  await form.handlers.submit({ preventDefault() {} });

  assert.match(result.html, /Precio fijo especial/);
  assert.match(result.html, /₡120 con promoción/);
  assert.match(result.html, /<span class="label">Precio<\/span><strong>₡100<\/strong>/);
});

test('promotions=[] no renderiza bloque ni contenido vacío de promociones', async () => {
  const { form, input, result } = createBrowserContext({
    ...productPayload([{ size: 'S', stock: 5, barcode: '005' }]),
    promotions: [],
    conditionalPromotions: []
  });
  input.value = '005';

  await form.handlers.submit({ preventDefault() {} });

  assert.doesNotMatch(result.html, /promotions-section/);
  assert.doesNotMatch(result.html, /promotion-list/);
  assert.match(result.html, /<span class="label">Precio<\/span><strong>₡100<\/strong>/);
});

test('muestra promociones condicionadas con validación en caja sin afirmar aplicación', async () => {
  const { form, input, result } = createBrowserContext({
    ...productPayload([{ size: 'S', stock: 5, barcode: '005' }]),
    price: 36800,
    promotions: [],
    conditionalPromotions: [{
      id: 286,
      description: '20% OFF NEW ARRIVAL',
      type: 'percentage',
      percentage: 20,
      promotionalPrice: null,
      calculatedPrice: null,
      conditionType: 'serialized_coupon',
      conditionLabel: 'Requiere cupón',
      requiresValidation: true
    }]
  });
  input.value = '005';

  await form.handlers.submit({ preventDefault() {} });

  assert.match(result.html, /Promociones con condiciones/);
  assert.match(result.html, /20% con cupón/);
  assert.match(result.html, /Requiere cupón/);
  assert.match(result.html, /Precio<\/span><strong>₡36\s800<\/strong>/);
  assert.doesNotMatch(result.html, /Precio final|Descuento aplicado|Ahorras/);
});

test('la UI no renderiza promociones internas aunque lleguen accidentalmente', async () => {
  const { form, input, result } = createBrowserContext({
    ...productPayload([{ size: 'S', stock: 5, barcode: '005' }]),
    promotions: [],
    conditionalPromotions: [
      { id: 2, description: '20% EMPLEADOS GD CRI', type: 'percentage', percentage: 20, requiresValidation: true },
      { id: 3, description: '30% MERCADEO GD', type: 'percentage', percentage: 30, requiresValidation: true },
      { id: 541, description: '15% OFF MOUNT VIEW SCHOOL', type: 'percentage', percentage: 15, requiresValidation: true }
    ]
  });
  input.value = '005';

  await form.handlers.submit({ preventDefault() {} });

  assert.doesNotMatch(result.html, /EMPLEADOS|MERCADEO/);
  assert.doesNotMatch(result.html, /conditional-promotions-section/);
});
