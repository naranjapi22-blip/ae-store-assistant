const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const form = document.querySelector('#search');
const input = document.querySelector('#barcode');
const clearButton = document.querySelector('#clear');
const result = document.querySelector('#result');
const message = document.querySelector('#message');
const configurationPanel = document.querySelector('#configuration-panel');
const assistantContent = document.querySelector('#assistant-content');
const configurationForm = document.querySelector('#configuration-form');
const configurationMessage = document.querySelector('#configuration-message');
const openSettings = document.querySelector('#open-settings');
const cancelSettings = document.querySelector('#cancel-settings');
const warehouseSelect = document.querySelector('#config-warehouse');
const saveConfiguration = document.querySelector('#save-configuration');
const testConnection = document.querySelector('#test-connection');
const statusDot = document.querySelector('.status-dot');
let activeConfiguration = null;
let connectionValidated = false;
const modeButtons = document.querySelectorAll('[data-mode]');
const catalogTools = document.querySelector('#catalog-tools');
const catalogExplorer = document.querySelector('#catalog-explorer');
const promotionsView = document.querySelector('#promotions-view');
let searchMode = 'query';
const catalogSelection = { department: '', section: '', family: '' };
const promotionState = { selected: null, page: 1, filters: { search: '', department: '', section: '', family: '' } };

const setConfigurationMessage = (text, type = '') => {
  configurationMessage.textContent = text;
  configurationMessage.className = `message ${type}`;
};

const connectionValidationMessage = 'Completa servidor, base de datos, usuario y contraseña.';
const setConnectionState = state => {
  statusDot.classList.remove('is-connected', 'is-error');
  if (state === 'connected') statusDot.classList.add('is-connected');
  if (state === 'error') statusDot.classList.add('is-error');
  statusDot.dataset.connectionState = state;
  statusDot.setAttribute('aria-label', state === 'connected' ? 'Conexión correcta' : state === 'error' ? 'Error de conexión' : 'Sin conexión');
};

const updateSaveButton = () => {
  saveConfiguration.disabled = !(connectionValidated && warehouseSelect.value);
};

const clearWarehouseSelection = () => {
  warehouseSelect.innerHTML = '<option value="">Prueba la conexión primero</option>';
  warehouseSelect.value = '';
  warehouseSelect.disabled = true;
  document.querySelector('#config-warehouse-name').value = '';
  updateSaveButton();
};

const invalidateConnection = () => {
  connectionValidated = false;
  setConnectionState('idle');
  clearWarehouseSelection();
};

const configurationPayload = () => ({
  server: document.querySelector('#config-server').value.trim(),
  port: Number(document.querySelector('#config-port').value || 1433),
  database: document.querySelector('#config-database').value.trim(),
  user: document.querySelector('#config-user').value.trim(),
  password: document.querySelector('#config-password').value,
  tariff: Number(document.querySelector('#config-tariff').value || 5),
  priceFormat: Number(document.querySelector('#config-price-format').value || 0),
  warehouseCode: warehouseSelect.value,
  warehouseName: document.querySelector('#config-warehouse-name').value,
  encrypt: document.querySelector('#config-encrypt').checked,
  trustServerCertificate: document.querySelector('#config-trust').checked
});

const setConfigurationFields = config => {
  if (!config) return;
  document.querySelector('#config-server').value = config.server || 'localhost';
  document.querySelector('#config-port').value = config.port || 1433;
  document.querySelector('#config-database').value = config.database || '';
  document.querySelector('#config-user').value = '';
  document.querySelector('#config-password').value = '';
  document.querySelector('#config-tariff').value = config.tariff || 5;
  document.querySelector('#config-price-format').value = config.priceFormat ?? 0;
  document.querySelector('#config-encrypt').checked = Boolean(config.encrypt);
  document.querySelector('#config-trust').checked = Boolean(config.trustServerCertificate);
  document.querySelector('#config-warehouse-name').value = config.warehouseName || '';
};

const populateWarehouses = warehouses => {
  const salesWarehouses = warehouses.filter(item => item.isLikelySales !== false);
  const selectableWarehouses = salesWarehouses.length ? salesWarehouses : warehouses;
  warehouseSelect.innerHTML = selectableWarehouses.length
    ? ['<option value="">Selecciona una tienda</option>', ...selectableWarehouses.map(item => `<option value="${escapeHtml(item.warehouseCode)}">${escapeHtml(item.warehouseName)} (${escapeHtml(item.warehouseCode)})</option>`)].join('')
    : '<option value="">No hay almacenes disponibles</option>';
  warehouseSelect.disabled = !warehouses.length;
  if (activeConfiguration?.warehouseCode && selectableWarehouses.some(item => item.warehouseCode === activeConfiguration.warehouseCode)) warehouseSelect.value = activeConfiguration.warehouseCode;
  document.querySelector('#config-warehouse-name').value = selectableWarehouses.find(item => item.warehouseCode === warehouseSelect.value)?.warehouseName || '';
  updateSaveButton();
};

const showConfiguration = (config = activeConfiguration) => {
  setConfigurationFields(config);
  configurationPanel.hidden = false;
  assistantContent.hidden = true;
  cancelSettings.hidden = !activeConfiguration?.configured;
  setConfigurationMessage(activeConfiguration?.configured ? '' : 'Configura la conexión para comenzar.');
};

const hideConfiguration = () => {
  configurationPanel.hidden = true;
  assistantContent.hidden = false;
};

const updateStoreLabel = config => {
  const name = config?.warehouseName || config?.warehouseCode;
  document.querySelector('#store-label').textContent = name ? `${name} (${config.warehouseCode})` : 'Tienda no configurada';
};

const configurationRequest = async (url, payload) => {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo validar la configuración');
  return data;
};

testConnection.addEventListener('click', async () => {
  const payload = configurationPayload();
  const complete = Boolean(payload.server && Number.isInteger(payload.port) && payload.port > 0 && payload.database && payload.user && payload.password);
  if (!complete) {
    setConnectionState('idle');
    setConfigurationMessage(connectionValidationMessage, 'is-error');
    return;
  }
  connectionValidated = false;
  clearWarehouseSelection();
  setConnectionState('idle');
  testConnection.disabled = true;
  setConfigurationMessage('Probando conexión…', 'is-loading');
  try {
    const data = await configurationRequest('/api/config/test', payload);
    activeConfiguration = { ...(data.config || {}), configured: false };
    connectionValidated = true;
    populateWarehouses(data.warehouses || []);
    setConnectionState('connected');
    setConfigurationMessage('Conexión correcta. Selecciona una tienda.', 'is-success');
  } catch (error) {
    connectionValidated = false;
    setConnectionState('error');
    setConfigurationMessage(error.message || 'No se pudo conectar al servidor', 'is-error');
  } finally {
    testConnection.disabled = false;
    updateSaveButton();
  }
});

configurationForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!connectionValidated) {
    setConfigurationMessage('Prueba la conexión antes de guardar.', 'is-error');
    return;
  }
  if (!warehouseSelect.value) {
    setConfigurationMessage('Selecciona una tienda.', 'is-error');
    return;
  }
  saveConfiguration.disabled = true;
  setConfigurationMessage('Guardando configuración…', 'is-loading');
  try {
    const data = await configurationRequest('/api/config/save', configurationPayload());
    activeConfiguration = data.config;
    updateStoreLabel(activeConfiguration);
    hideConfiguration();
    setMessage('Configuración guardada', 'is-success');
  } catch (error) {
    setConfigurationMessage(error.message || 'No se pudo guardar la configuración', 'is-error');
    saveConfiguration.disabled = false;
  }
});

warehouseSelect.addEventListener('change', () => {
  document.querySelector('#config-warehouse-name').value = warehouseSelect.selectedOptions[0]?.textContent.replace(/\s*\([^)]*\)$/, '') || '';
  updateSaveButton();
});

['#config-server', '#config-port', '#config-database', '#config-user', '#config-password', '#config-encrypt', '#config-trust']
  .map(selector => document.querySelector(selector))
  .forEach(field => field.addEventListener('input', invalidateConnection));
['#config-encrypt', '#config-trust']
  .map(selector => document.querySelector(selector))
  .forEach(field => field.addEventListener('change', invalidateConnection));

openSettings.addEventListener('click', () => showConfiguration());
cancelSettings.addEventListener('click', hideConfiguration);

const initializeConfiguration = async () => {
  let config;
  try {
    const response = await fetch('/api/config/status');
    config = await response.json();
  } catch {
    setConnectionState('idle');
    showConfiguration();
    setConfigurationMessage('No se pudo cargar la configuración local.', 'is-error');
    return;
  }
  activeConfiguration = config;
  updateStoreLabel(config);
  if (!config.configured) {
    setConnectionState('idle');
    showConfiguration(config);
    return;
  }
  setConnectionState('idle');
  try {
    const healthResponse = await fetch('/api/config/health');
    const health = await healthResponse.json();
    if (!healthResponse.ok || health.connection !== 'ready') throw new Error(health.error || 'No se pudo validar la conexión');
    setConnectionState('connected');
  } catch {
    setConnectionState('error');
  }
};

const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = `message ${type}`; };
const setLoading = loading => { form.classList.toggle('is-loading', loading); form.querySelector('.primary-button').disabled = loading; };
const formatPrice = value => {
  if (value == null) return 'Precio no disponible';
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(number)
    : 'Precio no disponible';
};

const stockStatus = value => {
  const stock = Number(value) || 0;
  if (stock <= 0) return { label: 'Sin stock', className: 'stock-none' };
  if (stock <= 2) return { label: 'Últimas unidades', className: 'stock-low' };
  return { label: 'Disponible', className: 'stock-ok' };
};

const sizeRank = size => {
  const value = String(size ?? '').toUpperCase();
  const number = Number.parseFloat(value);
  const lengthRank = value.includes('SHORT') ? 1 : value.includes('REGULAR') ? 2 : value.includes('LONG') ? 3 : 0;
  return [Number.isNaN(number) ? 999 : number, lengthRank, value];
};

const sortedSizes = sizes => [...sizes].sort((a, b) => {
  const left = sizeRank(a.size); const right = sizeRank(b.size);
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
});
const visibleSizes = sizes => sizes.filter(item => Number(item.stock) > 0);
const visiblePromotions = promotions => (Array.isArray(promotions) ? promotions : [])
  .filter(promotion => promotion
    && promotion.type !== 'unknown'
    && Number.isFinite(Number(promotion.calculatedPrice)))
  .slice(0, 3);
const visibleConditionalPromotions = promotions => (Array.isArray(promotions) ? promotions : [])
  .filter(promotion => promotion
    && promotion.requiresValidation === true
    && promotion.type !== 'unknown'
    && !/\b(?:EMPLEADO|EMPLEADOS|MERCADEO)\b/i.test(String(promotion.description || ''))
    && !String(promotion.description || '').toUpperCase().includes('MOUNT VIEW SCHOOL'))
  .slice(0, 3);

const catalogFetch = async path => {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo');
  return data;
};

const renderCatalogOptions = (title, options, onSelect, back) => {
  catalogExplorer.innerHTML = `<div class="catalog-breadcrumb"><strong>${escapeHtml(title)}</strong>${back ? '<button class="catalog-back" type="button">Volver</button>' : ''}</div><div class="catalog-option-grid">${options.length ? options.map(option => `<button class="catalog-option" type="button" data-option="${escapeHtml(option)}">${escapeHtml(option)}</button>`).join('') : '<p class="empty-state">No hay opciones disponibles.</p>'}</div>`;
  if (back) catalogExplorer.querySelector('.catalog-back').addEventListener('click', back);
  catalogExplorer.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => onSelect(button.dataset.option)));
};

const renderCatalogProductHeader = (title, back) => {
  catalogExplorer.innerHTML = `<div class="catalog-breadcrumb"><strong>${escapeHtml(title)}</strong>${back ? '<button class="catalog-back" type="button">Volver</button>' : ''}</div>`;
  if (back) catalogExplorer.querySelector('.catalog-back').addEventListener('click', back);
};

const showCatalogError = error => { catalogExplorer.innerHTML = `<div class="empty-state error-state"><h2>${escapeHtml(error.message || 'Error de catálogo')}</h2></div>`; };

const loadDepartments = async () => {
  catalogExplorer.hidden = false; catalogExplorer.innerHTML = '<p class="catalog-loading">Cargando departamentos...</p>';
  try { const data = await catalogFetch('/api/catalog/departments'); renderCatalogOptions('Departamento', data.departments || [], selectDepartment); }
  catch (error) { showCatalogError(error); }
};

const selectDepartment = async department => {
  catalogSelection.department = department; catalogSelection.section = ''; catalogSelection.family = '';
  catalogExplorer.innerHTML = '<p class="catalog-loading">Cargando secciones...</p>';
  try { const data = await catalogFetch(`/api/catalog/sections?department=${encodeURIComponent(department)}`); renderCatalogOptions(`Sección · ${department}`, data.sections || [], selectSection, loadDepartments); }
  catch (error) { showCatalogError(error); }
};

const selectSection = async section => {
  catalogSelection.section = section; catalogSelection.family = '';
  catalogExplorer.innerHTML = '<p class="catalog-loading">Cargando familias...</p>';
  try { const data = await catalogFetch(`/api/catalog/families?department=${encodeURIComponent(catalogSelection.department)}&section=${encodeURIComponent(section)}`); renderCatalogOptions(`Familia · ${section}`, data.families || [], selectFamily, () => selectDepartment(catalogSelection.department)); }
  catch (error) { showCatalogError(error); }
};

const selectFamily = async family => {
  catalogSelection.family = family; catalogExplorer.innerHTML = '<p class="catalog-loading">Cargando productos...</p>';
  try {
    const query = new URLSearchParams(catalogSelection);
    const data = await catalogFetch(`/api/catalog/products?${query}`);
    renderCatalogProductHeader(`Productos · ${family}`, () => selectSection(catalogSelection.section));
    renderSearchResults(data);
    if (!(data.results || []).length) result.querySelector('.empty-state h2').textContent = 'No se encontraron productos en esta familia.';
  } catch (error) { showCatalogError(error); }
};

const renderSearchResults = data => {
  const results = data.results || [];
  result.innerHTML = `<section class="catalog-results"><div class="subsection-heading"><h2>Resultados</h2><span>${results.length}</span></div>${results.length ? `<div class="result-grid">${results.map(item => `<article class="result-card"><div class="result-image"><img src="${escapeHtml(item.image || `https://s7d2.scene7.com/is/image/aeo/${String(item.REFERENCIA_STYLO || item.ref || '').replaceAll('-', '_')}_f`)}" alt="" loading="lazy"><span class="result-placeholder">AE</span></div><div class="result-copy"><h3>${escapeHtml(item.description)}</h3><p>${escapeHtml(item.colorDescription || item.colorSpanish || item.color || 'Color no disponible')}</p><p>Ref: ${escapeHtml(item.REFERENCIA_STYLO || item.ref)}</p><strong>${escapeHtml(formatPrice(item.price))}</strong><div class="result-footer"><span>Stock total: ${escapeHtml(item.stockTotal)}</span><span>${escapeHtml(item.sizesWithStock)} tallas</span></div><button class="secondary-button" type="button" data-reference="${escapeHtml(item.REFERENCIA_STYLO || item.ref)}">Ver producto</button></div></article>`).join('')}</div>` : '<div class="empty-state"><h2>No se encontraron productos</h2><p>Prueba con otro código, referencia o STYLE</p></div>'}</section>`;
  result.querySelectorAll('.result-image img').forEach(img => img.addEventListener('error', () => { img.hidden = true; img.nextElementSibling.classList.add('is-visible'); }));
  result.querySelectorAll('[data-reference]').forEach(button => button.addEventListener('click', () => loadReference(button.dataset.reference)));
};

const renderSimilarProducts = products => {
  const container = result.querySelector('#similar-products');
  if (!container) return;
  if (!products.length) { container.hidden = true; container.innerHTML = ''; return; }
  container.hidden = false;
  container.innerHTML = `<section class="similar-section"><div class="subsection-heading"><h3>Productos similares</h3><span>${products.length}</span></div><div class="similar-grid">${products.map(item => { const thumbnail = item.image ? `<div class="color-thumb"><img src="${escapeHtml(item.image)}" alt="" loading="lazy"><span class="color-thumb-fallback">AE</span></div>` : '<div class="color-thumb"><span class="color-thumb-fallback is-visible">AE</span></div>'; return `<article class="similar-card">${thumbnail}<div class="similar-copy"><h4>${escapeHtml(item.description)}</h4><p>${escapeHtml(item.colorDescription || item.colorSpanish || item.color || 'Color no disponible')}</p><p>Ref: ${escapeHtml(item.REFERENCIA_STYLO)}</p><strong>${escapeHtml(formatPrice(item.price))}</strong><div class="result-footer"><span>Stock: ${escapeHtml(item.stockTotal)}</span><span>${escapeHtml(item.sizesWithStock)} tallas</span></div><button class="secondary-button" type="button" data-similar-reference="${escapeHtml(item.REFERENCIA_STYLO)}">Ver producto</button></div></article>`; }).join('')}</div></section>`;
  container.querySelectorAll('.similar-card .color-thumb img').forEach(img => img.addEventListener('error', () => { img.hidden = true; img.nextElementSibling.classList.add('is-visible'); }));
  container.querySelectorAll('[data-similar-reference]').forEach(button => button.addEventListener('click', () => loadReference(button.dataset.similarReference)));
};

const loadSimilarProducts = async reference => {
  const container = result.querySelector('#similar-products');
  if (!container) return;
  try {
    const response = await fetch(`/api/products/reference/${encodeURIComponent(reference)}/similar`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar productos similares');
    renderSimilarProducts(data.results || []);
  } catch { container.hidden = true; container.innerHTML = ''; }
};

const promotionFetch = async path => {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las promociones');
  return data;
};

const numberFormat = value => new Intl.NumberFormat('es-CR').format(Number(value) || 0);

const promotionLabel = promotion => promotion.requiresValidation
  ? (promotion.conditionLabel || 'Validar condiciones en caja')
  : promotion.type === 'percentage'
    ? `${promotion.percentage}% de descuento`
    : promotion.type === 'fixed_price'
      ? `Precio especial ${formatPrice(promotion.promotionalPrice)}`
      : 'Promoción vigente';

const renderPromotionSummary = data => {
  const promotions = Array.isArray(data.promotions) ? data.promotions : [];
  const totals = data.totals || {};
  promotionsView.innerHTML = `<section class="promotion-dashboard"><div class="section-heading"><div><p class="eyebrow">INVENTARIO LOCAL</p><h2>Promociones activas</h2></div><span class="keyboard-hint">Solo tienda configurada</span></div><div class="promotion-total-grid"><div><strong>${numberFormat(promotions.length)}</strong><span>promociones activas</span></div><div><strong>${numberFormat(totals.referenceCount)}</strong><span>referencias con stock</span></div><div><strong>${numberFormat(totals.stockUnits)}</strong><span>unidades en promoción</span></div></div>${promotions.length ? `<div class="promotion-card-grid">${promotions.map(promotion => `<article class="promotion-card"><div><p class="eyebrow">${escapeHtml(promotion.type === 'percentage' ? 'DESCUENTO' : promotion.type === 'fixed_price' ? 'PRECIO ESPECIAL' : 'PROMOCIÓN')}</p><h3>${escapeHtml(promotion.description || 'Promoción vigente')}</h3><p class="promotion-benefit">${escapeHtml(promotionLabel(promotion))}</p></div><div class="promotion-card-stats"><span><strong>${numberFormat(promotion.referenceCount)}</strong> referencias</span><span><strong>${numberFormat(promotion.stockUnits)}</strong> unidades</span></div>${promotion.requiresValidation ? '<p class="promotion-validation">Validar condiciones en caja</p>' : ''}<button class="secondary-button" type="button" data-promotion-id="${escapeHtml(promotion.id)}">Ver productos</button></article>`).join('')}</div>` : '<div class="empty-state"><h2>No hay promociones aplicables</h2><p>No se encontraron promociones vigentes con stock positivo en esta tienda.</p></div>'}</section>`;
  promotionsView.querySelectorAll('[data-promotion-id]').forEach(button => button.addEventListener('click', () => openPromotion(Number(button.dataset.promotionId))));
};

const promotionOptions = (select, values, placeholder, selected = '') => {
  select.innerHTML = `<option value="">${placeholder}</option>${values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
  select.disabled = false;
};

const loadPromotionFilters = async () => {
  const department = promotionsView.querySelector('#promotion-department');
  const section = promotionsView.querySelector('#promotion-section');
  const family = promotionsView.querySelector('#promotion-family');
  if (!department) return;
  try {
    const data = await promotionFetch('/api/catalog/departments');
    promotionOptions(department, data.departments || [], 'Todos los departamentos', promotionState.filters.department);
    department.addEventListener('change', async () => {
      promotionState.filters.department = department.value; promotionState.filters.section = ''; promotionState.filters.family = '';
      section.disabled = true; family.disabled = true;
      const sections = await promotionFetch(`/api/catalog/sections?department=${encodeURIComponent(department.value)}`);
      promotionOptions(section, sections.sections || [], 'Todas las secciones');
      promotionOptions(family, [], 'Todas las familias');
    });
    section.addEventListener('change', async () => {
      promotionState.filters.section = section.value; promotionState.filters.family = '';
      family.disabled = true;
      const families = await promotionFetch(`/api/catalog/families?department=${encodeURIComponent(department.value)}&section=${encodeURIComponent(section.value)}`);
      promotionOptions(family, families.families || [], 'Todas las familias');
    });
    family.addEventListener('change', () => { promotionState.filters.family = family.value; });
  } catch { /* Los filtros siguen disponibles aunque el catálogo no cargue. */ }
};

const renderPromotionDetail = () => {
  const promotion = promotionState.selected;
  promotionsView.innerHTML = `<section class="promotion-dashboard"><div class="section-heading"><div><p class="eyebrow">PROMOCIÓN</p><h2>${escapeHtml(promotion.description || 'Productos promocionados')}</h2><p class="promotion-detail-label">${escapeHtml(promotionLabel(promotion))}</p></div><button id="promotion-back" class="catalog-back" type="button">Volver a promociones</button></div><form id="promotion-filters" class="promotion-filters"><label>Buscar<input name="search" placeholder="Referencia o descripción" value="${escapeHtml(promotionState.filters.search)}"></label><label>Departamento<select id="promotion-department" name="department" disabled><option>Todos los departamentos</option></select></label><label>Sección<select id="promotion-section" name="section" disabled><option>Todas las secciones</option></select></label><label>Familia<select id="promotion-family" name="family" disabled><option>Todas las familias</option></select></label><button class="primary-button" type="submit">Filtrar</button></form><div id="promotion-products" class="promotion-products"><p class="catalog-loading">Cargando productos...</p></div><div id="promotion-pagination" class="promotion-pagination"></div></section>`;
  promotionsView.querySelector('#promotion-back').addEventListener('click', loadPromotionSummary);
  const resultSummary = document.createElement('div');
  resultSummary.id = 'promotion-result-summary';
  resultSummary.className = 'promotion-result-summary';
  resultSummary.setAttribute('aria-live', 'polite');
  promotionsView.querySelector('#promotion-products').before(resultSummary);
  promotionsView.querySelector('#promotion-filters').addEventListener('submit', event => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    promotionState.filters = { search: String(formData.get('search') || '').trim(), department: String(formData.get('department') || ''), section: String(formData.get('section') || ''), family: String(formData.get('family') || '') };
    promotionState.page = 1;
    loadPromotionProducts();
  });
  loadPromotionFilters();
  loadPromotionProducts();
};

const renderPromotionProducts = data => {
  const container = promotionsView.querySelector('#promotion-products');
  const products = data.products || [];
  const resultSummary = promotionsView.querySelector('#promotion-result-summary');
  if (resultSummary) resultSummary.innerHTML = `<strong>${numberFormat(data.totalReferences)}</strong> referencias <strong>${numberFormat(data.totalUnits)}</strong> unidades`;
  container.innerHTML = products.length ? `<div class="promotion-product-grid">${products.map(product => `<article class="promotion-product-card"><div class="promotion-product-image"><img src="${escapeHtml(product.image || '')}" alt="" loading="lazy"><span>AE</span></div><div><h3>${escapeHtml(product.description)}</h3>${product.additionalDescription ? `<p>${escapeHtml(product.additionalDescription)}</p>` : ''}<p>${escapeHtml(product.colorDescription || product.colorSpanish || product.color || 'Color no disponible')}</p><p>Ref: ${escapeHtml(product.REFERENCIA_STYLO)}</p><div class="promotion-prices"><strong>${escapeHtml(formatPrice(product.price))}</strong>${product.promotionalPrice != null ? `<strong class="promotion-price">${escapeHtml(formatPrice(product.promotionalPrice))}</strong>` : ''}</div>${product.requiresValidation ? `<p class="promotion-validation">${escapeHtml(product.conditionLabel || 'Validar condiciones en caja')}</p>` : ''}<div class="result-footer"><span>Stock: ${numberFormat(product.stockTotal)}</span><span>${numberFormat(product.sizesWithStock)} tallas</span></div></div></article>`).join('')}</div>` : '<div class="empty-state"><h2>No hay productos para estos filtros</h2><p>Prueba con otra referencia o categoría.</p></div>';
  container.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.hidden = true; img.nextElementSibling.hidden = false; }));
  container.querySelectorAll('.promotion-product-card').forEach((card, index) => {
    const reference = products[index]?.REFERENCIA_STYLO;
    if (!reference) return;
    const button = document.createElement('button');
    button.className = 'secondary-button';
    button.type = 'button';
    button.textContent = 'Ver producto';
    button.dataset.promotionReference = reference;
    card.lastElementChild.append(button);
  });
  container.querySelectorAll('[data-promotion-reference]').forEach(button => button.addEventListener('click', () => openProductFromPromotion(button.dataset.promotionReference)));
  const pagination = promotionsView.querySelector('#promotion-pagination');
  pagination.innerHTML = `<button class="secondary-button" type="button" ${data.page <= 1 ? 'disabled' : ''} data-page="${data.page - 1}">Anterior</button><span>Página ${data.page}</span><button class="secondary-button" type="button" ${data.hasMore ? '' : 'disabled'} data-page="${data.page + 1}">Siguiente</button>`;
  pagination.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => { promotionState.page = Number(button.dataset.page); loadPromotionProducts(); }));
};

const loadPromotionProducts = async () => {
  if (!promotionState.selected) return;
  const query = new URLSearchParams({ page: String(promotionState.page), limit: '40' });
  Object.entries(promotionState.filters).forEach(([key, value]) => { if (value) query.set(key, value); });
  try { renderPromotionProducts(await promotionFetch(`/api/promotions/${promotionState.selected.id}/products?${query}`)); }
  catch (error) { promotionsView.querySelector('#promotion-products').innerHTML = `<div class="empty-state error-state"><h2>${escapeHtml(error.message)}</h2></div>`; }
};

const openPromotion = promotionId => {
  promotionState.selected = (promotionState.all || []).find(item => Number(item.id) === promotionId) || null;
  if (!promotionState.selected) return;
  promotionState.page = 1;
  renderPromotionDetail();
};

const loadPromotionSummary = async () => {
  promotionState.selected = null; promotionState.page = 1; promotionState.filters = { search: '', department: '', section: '', family: '' };
  promotionsView.hidden = false; promotionsView.innerHTML = '<div class="empty-state"><p>Cargando promociones...</p></div>';
  try {
    const data = await promotionFetch('/api/promotions');
    promotionState.all = data.promotions || [];
    renderPromotionSummary(data);
  } catch (error) { promotionsView.innerHTML = `<div class="empty-state error-state"><h2>${escapeHtml(error.message)}</h2></div>`; }
};

const setMode = mode => {
  searchMode = mode;
  modeButtons.forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); });
  const querying = mode === 'query';
  const promotions = mode === 'promotions';
  document.querySelector('#search-title').textContent = querying ? 'Consultar producto' : 'Explorar catálogo';
  input.placeholder = 'Escanee o ingrese código, referencia o STYLE';
  form.querySelector('.primary-button').textContent = 'Consultar';
  catalogTools.hidden = mode !== 'catalog';
  form.hidden = !querying;
  document.querySelector('#search-title').parentElement.parentElement.hidden = promotions;
  document.querySelector('.keyboard-hint').hidden = promotions;
  message.hidden = promotions;
  result.hidden = promotions;
  promotionsView.hidden = !promotions;
  catalogExplorer.hidden = querying || promotions;
  if (querying) focusScanner();
  else if (mode === 'catalog') { result.innerHTML = ''; loadDepartments(); }
  else if (promotions) loadPromotionSummary();
};

modeButtons.forEach(button => button.addEventListener('click', () => setMode(button.dataset.mode)));

const renderProduct = data => {
  const sizesData = Array.isArray(data.sizes) ? data.sizes : [];
  const relatedColors = Array.isArray(data.relatedColors) ? data.relatedColors : [];
  const scannedSize = escapeHtml(data.scannedSize);
  const scannedStatus = stockStatus(data.stock);
  const relatedColorCount = relatedColors.length;
  const relatedColorLabel = relatedColorCount === 0 ? 'Sin otros colores' : relatedColorCount === 1 ? '1 color alternativo' : `${relatedColorCount} colores alternativos`;
  const colorName = data.colorDescription || data.colorSpanish || data.color || 'No disponible';
  const secondaryColor = data.colorSpanish && data.colorSpanish !== colorName ? data.colorSpanish : '';
  const additionalDescription = data.additionalDescription
    ? `<p class="product-description-es">${escapeHtml(data.additionalDescription)}</p>`
    : '';
  const promotions = visiblePromotions(data.promotions);
  const promotionBlock = promotions.length
    ? `<section class="promotions-section"><div class="subsection-heading"><h3>Promoción</h3><span>${promotions.length}</span></div><div class="promotion-list">${promotions.map(promotion => {
      const benefit = promotion.type === 'percentage'
        ? `${escapeHtml(promotion.percentage)}% de descuento · ${escapeHtml(formatPrice(promotion.calculatedPrice))} con promoción`
        : `${escapeHtml(formatPrice(promotion.calculatedPrice))} con promoción`;
      return `<div class="promotion-item"><strong>${escapeHtml(promotion.description || 'Promoción vigente')}</strong><span>${benefit}</span></div>`;
    }).join('')}</div></section>`
    : '';
  const conditionalPromotions = visibleConditionalPromotions(data.conditionalPromotions);
  const conditionalPromotionBlock = conditionalPromotions.length
    ? `<section class="conditional-promotions-section"><div class="subsection-heading"><h3>Promociones con condiciones</h3><span>${conditionalPromotions.length}</span></div><div class="promotion-list">${conditionalPromotions.map(promotion => {
      const benefit = promotion.type === 'percentage'
        ? `${escapeHtml(promotion.percentage)}%${promotion.conditionType === 'serialized_coupon' ? ' con cupón' : ''}`
        : promotion.type === 'fixed_price'
          ? escapeHtml(formatPrice(promotion.promotionalPrice))
          : 'Promoción condicionada';
      return `<div class="conditional-promotion-item"><strong>${escapeHtml(promotion.description || 'Promoción vigente')}</strong><span>${benefit}</span><small>${escapeHtml(promotion.conditionLabel || 'Validar condiciones en caja')}</small></div>`;
    }).join('')}</div></section>`
    : '';
  const quickSummary = `<section class="quick-summary ${scannedStatus.className}" aria-label="Consulta rápida"><div class="quick-summary-item"><span class="label">Talla consultada</span><strong>${scannedSize}</strong></div><div class="quick-summary-item"><span class="label">Stock exacto</span><strong>${escapeHtml(data.stock)} <small>unidades</small></strong></div><div class="quick-summary-item"><span class="label">Colores alternativos</span><strong>${escapeHtml(relatedColorLabel)}</strong></div><span class="quick-status">${escapeHtml(scannedStatus.label)}</span></section>`;
  const operationalDetails = `${quickSummary}<div class="operational-details"><div><span class="label">Temporada</span><strong>${escapeHtml(data.season || 'No disponible')}</strong></div><div><span class="label">Referencia</span><strong>${escapeHtml(data.REFERENCIA_STYLO || 'No disponible')}</strong></div><div><span class="label">Código de barras</span><strong>${escapeHtml(data.barcode || 'No disponible')}</strong></div></div>`;
  const orderedSizes = sortedSizes(visibleSizes(sizesData));
  const sizes = orderedSizes.map((item, index) => {
    const status = stockStatus(item.stock);
    return `<button class="size-card ${item.size === data.scannedSize ? 'is-scanned' : ''} ${status.className}" type="button" data-size-index="${index}"><span class="size-name">${escapeHtml(item.size)}</span><span class="size-status">${escapeHtml(status.label)}</span><span class="size-stock">${escapeHtml(item.stock)} unidades</span></button>`;
  }).join('');
  const colors = relatedColors.length ? `<section class="colors-section"><div class="subsection-heading"><h3>Otros colores disponibles</h3><span>${relatedColors.length}</span></div><div class="color-list">${relatedColors.map(variant => {
    const name = variant.colorDescription || variant.colorSpanish || variant.color;
    const secondary = variant.colorSpanish && variant.colorSpanish !== name ? `<small>${escapeHtml(variant.colorSpanish)}</small>` : '';
    const thumb = variant.image
      ? `<div class="color-thumb"><img src="${escapeHtml(variant.image)}" alt="${escapeHtml(name)}" loading="lazy"><span class="color-thumb-fallback">AE</span></div>`
      : `<div class="color-thumb"><span class="color-thumb-fallback is-visible">AE</span></div>`;
    return `<button class="color-chip" type="button" data-reference="${escapeHtml(variant.reference)}">${thumb}<span class="color-chip-copy"><strong>${escapeHtml(name)}</strong>${secondary}</span></button>`;
  }).join('')}</div></section>` : '';

  result.innerHTML = `<article class="product-card"><div class="product-image-panel"><div class="image-frame"><img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}" /><div class="image-placeholder" hidden><span class="placeholder-mark">AE</span><span>Imagen no disponible</span></div></div><span class="image-caption">Vista del producto</span></div><div class="product-details"><div class="product-title"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2>${additionalDescription}</div><div class="customer-summary"><div class="price-block"><span class="label">Precio</span><strong>${escapeHtml(formatPrice(data.price))}</strong></div><div class="color-block"><span class="label">Color</span><strong>${escapeHtml(colorName)}</strong>${secondaryColor ? `<small>${escapeHtml(secondaryColor)}</small>` : ''}</div></div>${operationalDetails}${promotionBlock}${conditionalPromotionBlock}</div><section class="sizes-section"><div class="subsection-heading"><h3>Disponibilidad de tallas</h3><span>${orderedSizes.length} tallas</span></div><div class="size-grid">${sizes}</div></section>${colors}<div id="similar-products" hidden></div></article>`;

  const applySize = item => {
    const status = stockStatus(item.stock);
    const summary = result.querySelector('.quick-summary');
    summary.classList.remove('stock-ok', 'stock-low', 'stock-none');
    summary.classList.add(status.className);
    result.querySelector('.quick-size').textContent = item.size || 'No disponible';
    result.querySelector('.quick-stock').textContent = `${item.stock} unidades`;
    result.querySelector('.quick-status').textContent = status.label;
    result.querySelector('.detail-barcode').textContent = item.barcode || item.barcode2 || 'No disponible';
    result.querySelectorAll('[data-size-index]').forEach(button => button.classList.toggle('is-scanned', button.dataset.sizeIndex === String(orderedSizes.indexOf(item))));
  };
  result.querySelector('.quick-summary-item strong')?.classList.add('quick-size');
  result.querySelectorAll('.quick-summary-item')[1]?.querySelector('strong')?.classList.add('quick-stock');
  result.querySelector('.quick-status')?.classList.add('quick-status');
  result.querySelector('.operational-details > div:last-child strong')?.classList.add('detail-barcode');
  result.querySelectorAll('[data-size-index]').forEach(button => button.addEventListener('click', () => applySize(orderedSizes[Number(button.dataset.sizeIndex)])));

  const image = result.querySelector('.image-frame img');
  const placeholder = result.querySelector('.image-placeholder');
  image.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; });
  result.querySelectorAll('.color-thumb img').forEach(img => img.addEventListener('error', () => {
    img.hidden = true;
    img.nextElementSibling?.classList.add('is-visible');
  }));
  result.querySelectorAll('[data-reference]').forEach(button => button.addEventListener('click', () => loadReference(button.dataset.reference)));
  loadSimilarProducts(data.REFERENCIA_STYLO);
};

const loadReference = async reference => {
  if (!reference || form.classList.contains('is-loading')) return;
  setLoading(true); setMessage('Consultando…', 'is-loading');
  try {
    const response = await fetch(`/api/products/reference/${encodeURIComponent(reference)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 404 ? 'Variante no encontrada' : (data.error || 'Error de consulta'));
    renderProduct(data); setMessage('Variante cargada', 'is-success');
  } catch (error) { setMessage(error.message || 'Error de consulta', 'is-error'); }
  finally { setLoading(false); focusScanner(); }
};

const openProductFromPromotion = reference => {
  setMode('query');
  loadReference(reference);
};

clearButton.addEventListener('click', () => { input.value = ''; clearButton.hidden = true; result.innerHTML = ''; setMessage('Listo para consultar'); focusScanner(); });
input.addEventListener('input', () => { clearButton.hidden = !input.value; });

form.addEventListener('submit', async event => {
  event.preventDefault();
  const barcode = input.value.trim();
  if (!barcode || form.classList.contains('is-loading')) return;
  setLoading(true); setMessage('Consultando…', 'is-loading'); result.innerHTML = '';
  try {
    const response = await fetch(`/api/products/${encodeURIComponent(barcode)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 404 ? 'No se encontró ningún producto.' : (data.error || 'Error de consulta'));
    if (data.results) { renderSearchResults(data); setMessage(`${data.results.length} referencias encontradas`, 'is-success'); }
    else { renderProduct(data); setMessage('Producto encontrado', 'is-success'); }
  } catch (error) { result.innerHTML = `<div class="empty-state error-state"><span class="state-icon">!</span><h2>${escapeHtml(error.message || 'Error de consulta')}</h2><p>Verifica el valor e inténtalo nuevamente.</p></div>`; setMessage('No se pudo completar la consulta', 'is-error'); }
  finally { setLoading(false); focusScanner(); }
});

setMessage('Listo para consultar');
setConnectionState('idle');
initializeConfiguration();
