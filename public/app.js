const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const form = document.querySelector('#search');
const input = document.querySelector('#barcode');
const clearButton = document.querySelector('#clear');
const result = document.querySelector('#result');
const message = document.querySelector('#message');
const modeButtons = document.querySelectorAll('[data-mode]');
const catalogTools = document.querySelector('#catalog-tools');
const catalogExplorer = document.querySelector('#catalog-explorer');
let searchMode = 'query';
const catalogSelection = { department: '', section: '', family: '' };

const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = `message ${type}`; };
const setLoading = loading => { form.classList.toggle('is-loading', loading); form.querySelector('.primary-button').disabled = loading; };
const formatPrice = value => Number(value) > 0
  ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(Number(value))
  : 'No disponible';

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

const setMode = mode => {
  searchMode = mode;
  modeButtons.forEach(button => { const active = button.dataset.mode === mode; button.classList.toggle('is-active', active); button.setAttribute('aria-selected', String(active)); });
  const querying = mode === 'query';
  document.querySelector('#search-title').textContent = querying ? 'Consultar producto' : 'Explorar catálogo';
  input.placeholder = 'Escanee o ingrese código, referencia o STYLE';
  form.querySelector('.primary-button').textContent = 'Consultar';
  catalogTools.hidden = mode !== 'catalog';
  form.hidden = !querying;
  catalogExplorer.hidden = querying;
  if (querying) focusScanner();
  else { result.innerHTML = ''; loadDepartments(); }
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
  const quickSummary = `<section class="quick-summary ${scannedStatus.className}" aria-label="Consulta rápida"><div class="quick-summary-item"><span class="label">Talla consultada</span><strong>${scannedSize}</strong></div><div class="quick-summary-item"><span class="label">Stock exacto</span><strong>${escapeHtml(data.stock)} <small>unidades</small></strong></div><div class="quick-summary-item"><span class="label">Colores alternativos</span><strong>${escapeHtml(relatedColorLabel)}</strong></div><span class="quick-status">${escapeHtml(scannedStatus.label)}</span></section>`;
  const operationalDetails = `${quickSummary}<div class="operational-details"><div><span class="label">Temporada</span><strong>${escapeHtml(data.season || 'No disponible')}</strong></div><div><span class="label">Referencia</span><strong>${escapeHtml(data.REFERENCIA_STYLO || 'No disponible')}</strong></div><div><span class="label">Style</span><strong>${escapeHtml(data.STYLE || 'No disponible')}</strong></div></div>`;
  const sizes = sortedSizes(sizesData).map(item => {
    const status = stockStatus(item.stock);
    return `<div class="size-card ${item.size === data.scannedSize ? 'is-scanned' : ''} ${status.className}"><span class="size-name">${escapeHtml(item.size)}</span><span class="size-status">${escapeHtml(status.label)}</span><span class="size-stock">${escapeHtml(item.stock)} unidades</span></div>`;
  }).join('');
  const colors = relatedColors.length ? `<section class="colors-section"><div class="subsection-heading"><h3>Otros colores disponibles</h3><span>${relatedColors.length}</span></div><div class="color-list">${relatedColors.map(variant => {
    const name = variant.colorDescription || variant.colorSpanish || variant.color;
    const secondary = variant.colorSpanish && variant.colorSpanish !== name ? `<small>${escapeHtml(variant.colorSpanish)}</small>` : '';
    const thumb = variant.image
      ? `<div class="color-thumb"><img src="${escapeHtml(variant.image)}" alt="${escapeHtml(name)}" loading="lazy"><span class="color-thumb-fallback">AE</span></div>`
      : `<div class="color-thumb"><span class="color-thumb-fallback is-visible">AE</span></div>`;
    return `<button class="color-chip" type="button" data-reference="${escapeHtml(variant.reference)}">${thumb}<span class="color-chip-copy"><strong>${escapeHtml(name)}</strong>${secondary}</span></button>`;
  }).join('')}</div></section>` : '';

  result.innerHTML = `<article class="product-card"><div class="product-image-panel"><div class="image-frame"><img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}" /><div class="image-placeholder" hidden><span class="placeholder-mark">AE</span><span>Imagen no disponible</span></div></div><span class="image-caption">Vista del producto</span></div><div class="product-details"><div class="product-title"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2>${additionalDescription}</div><div class="customer-summary"><div class="price-block"><span class="label">Precio</span><strong>${escapeHtml(formatPrice(data.price))}</strong></div><div class="color-block"><span class="label">Color</span><strong>${escapeHtml(colorName)}</strong>${secondaryColor ? `<small>${escapeHtml(secondaryColor)}</small>` : ''}</div></div>${operationalDetails}</div><section class="sizes-section"><div class="subsection-heading"><h3>Disponibilidad de tallas</h3><span>${sizesData.length} tallas</span></div><div class="size-grid">${sizes}</div></section>${colors}<div id="similar-products" hidden></div></article>`;

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
