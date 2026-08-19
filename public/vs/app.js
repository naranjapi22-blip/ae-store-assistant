const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const form = document.querySelector('#search-form');
const input = document.querySelector('#barcode');
input.placeholder = 'Escanea o busca por barcode / referencia';
const result = document.querySelector('#result');
const message = document.querySelector('#message');
const scannerView = document.querySelector('#scanner-view');
const catalogView = document.querySelector('#catalog-view');
const catalogToggle = document.querySelector('#catalog-toggle');
const backScanner = document.querySelector('#back-scanner');
const catalogForm = document.querySelector('#catalog-search');
const catalogQuery = document.querySelector('#catalog-query');
const catalogDepartment = document.querySelector('#catalog-department');
const catalogSection = document.querySelector('#catalog-section');
const catalogFamily = document.querySelector('#catalog-family');
const catalogSubfamily = document.querySelector('#catalog-subfamily');
const catalogMessage = document.querySelector('#catalog-message');
const catalogResults = document.querySelector('#catalog-results');
const catalogMore = document.querySelector('#catalog-more');
let currentProduct = null;
let originalScannedBarcode = null;
let returnToCatalog = false;
let catalogState = { offset: 0, limit: 50, hasMore: false };
const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = type; };

const renderImage = data => data.image
  ? `<img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}"><div class="placeholder" hidden>Imagen no disponible</div>`
  : '<div class="placeholder">Imagen no disponible</div>';

const renderSizes = data => (data.sizes || []).map(item => `<li><button class="size ${item.scanned ? 'scanned' : ''} ${item.selected ? 'selected' : ''}" type="button" data-size-barcode="${escapeHtml(item.barcode)}" aria-pressed="${item.selected ? 'true' : 'false'}"><strong>${escapeHtml(item.size || 'Sin talla')}</strong><span>${escapeHtml(item.stock)} unidades</span>${item.scanned ? '<em>Talla escaneada</em>' : ''}${item.selected ? '<em class="selected-label">Seleccionada</em>' : ''}</button></li>`).join('') || '<li class="no-items">No hay tallas disponibles</li>';

const renderColors = data => (data.relatedColors || []).length
  ? `<section class="related-colors" aria-labelledby="related-colors-title"><h3 id="related-colors-title">Otros colores disponibles</h3><div class="color-list">${data.relatedColors.map(item => `<button class="color-option" type="button" data-barcode="${escapeHtml(item.barcode)}"><span class="color-swatch" aria-hidden="true" style="background-image:url('${escapeHtml(item.image || '')}')"></span><span>${escapeHtml(item.color)}</span><small>${escapeHtml(item.stock)} unidades</small></button>`).join('')}</div></section>`
  : '';

const selectSize = sizeBarcode => {
  if (!currentProduct) return;
  const selected = currentProduct.sizes.find(item => item.barcode === sizeBarcode);
  if (!selected) return;
  currentProduct = { ...currentProduct, barcode: selected.barcode, selectedBarcode: selected.barcode, selectedSize: selected.size, stock: selected.stock, totalStock: currentProduct.totalStock, image: selected.image, description: selected.description || currentProduct.description, supplierReference: selected.supplierReference || currentProduct.supplierReference, sizes: currentProduct.sizes.map(item => ({ ...item, selected: item.barcode === selected.barcode })) };
  input.value = selected.barcode; renderProduct(currentProduct); setMessage('Talla seleccionada', 'success');
};

const renderProduct = data => {
  currentProduct = data;
  result.innerHTML = `<article class="product"><div class="image">${renderImage(data)}</div><div class="details"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2><dl><dt>STYLE</dt><dd>${escapeHtml(data.style || 'No disponible')}</dd><dt>REFPROVEEDOR</dt><dd>${escapeHtml(data.supplierReference || 'No disponible')}</dd><dt>COLOR</dt><dd>${escapeHtml(data.color || 'No disponible')}</dd><dt>TALLA ESCANEADA</dt><dd>${escapeHtml(data.scannedSize || 'No pertenece a este color')}</dd><dt>TALLA SELECCIONADA</dt><dd>${escapeHtml(data.selectedSize || 'No disponible')}</dd><dt>STOCK SELECCIONADO</dt><dd>${escapeHtml(data.stock)}</dd><dt>TEMPORADA</dt><dd>${escapeHtml(data.season || 'No disponible')}</dd><dt>DEPARTAMENTO</dt><dd>${escapeHtml(data.department || 'No disponible')}</dd><dt>SECCIÓN</dt><dd>${escapeHtml(data.section || 'No disponible')}</dd><dt>FAMILIA</dt><dd>${escapeHtml(data.family || 'No disponible')}</dd></dl><h3>${data.sizes?.length === 1 ? 'Talla disponible' : 'Tallas disponibles'}</h3><ul class="sizes">${renderSizes(data)}</ul>${renderColors(data)}<div class="detail-actions"><button class="secondary-action" type="button" data-open-catalog>Explorar catálogo</button><button class="secondary-action" type="button" data-back-scanner>Volver al escáner</button></div></div></article>`;
  const detailList = result.querySelector('.details dl');
  if (detailList) { const totalLabel = document.createElement('dt'); totalLabel.textContent = 'STOCK TOTAL'; const totalValue = document.createElement('dd'); totalValue.textContent = String(data.totalStock ?? 0); detailList.insertBefore(totalLabel, detailList.children[12] ?? null); detailList.insertBefore(totalValue, detailList.children[13] ?? null); }
  const image = result.querySelector('.image img');
  image?.addEventListener('error', () => { image.hidden = true; image.nextElementSibling.hidden = false; });
  result.querySelectorAll('[data-size-barcode]').forEach(button => button.addEventListener('click', () => selectSize(button.dataset.sizeBarcode)));
  result.querySelectorAll('.color-option').forEach(button => button.addEventListener('click', () => loadProduct(button.dataset.barcode, false, returnToCatalog)));
  result.querySelector('[data-open-catalog]')?.addEventListener('click', openCatalog);
  result.querySelector('[data-back-scanner]')?.addEventListener('click', showScanner);
};

const loadProduct = async (barcode, resetOriginal = true, fromCatalog = false) => {
  if (!barcode || form.classList.contains('loading')) return;
  if (resetOriginal) originalScannedBarcode = barcode;
  if (fromCatalog) returnToCatalog = true;
  form.classList.add('loading'); setMessage('Consultando…', 'loading');
  try {
    const query = originalScannedBarcode ? `?scannedBarcode=${encodeURIComponent(originalScannedBarcode)}` : '';
    const response = await fetch(`/api/vs/products/${encodeURIComponent(barcode)}${query}`);
    const data = await response.json();
    if (response.status === 409) {
      result.innerHTML = `<div class="empty"><h2>${escapeHtml(data.error)}</h2><div class="color-list">${(data.options || []).map(option => `<button class="color-option" type="button" data-reference-barcode="${escapeHtml(option.barcode)}"><span>${escapeHtml(option.style)} · ${escapeHtml(option.color)}</span><small>${escapeHtml(option.description)}</small></button>`).join('')}</div></div>`;
      result.querySelectorAll('[data-reference-barcode]').forEach(button => button.addEventListener('click', () => loadProduct(button.dataset.referenceBarcode, true, false)));
      setMessage('Selecciona una opción', 'error'); return;
    }
    if (!response.ok) throw new Error(response.status === 404 ? 'No se encontró ningún producto.' : (data.error || 'No se pudo consultar'));
    data.originalScannedBarcode = originalScannedBarcode; data.returnToCatalog = returnToCatalog; input.value = data.barcode; showScanner(); renderProduct(data); setMessage('Producto encontrado', 'success');
  } catch (error) { result.innerHTML = `<div class="empty"><h2>${escapeHtml(error.message)}</h2></div>`; setMessage('No se pudo completar la consulta', 'error'); }
  finally { form.classList.remove('loading'); focusScanner(); }
};

const renderFacets = facets => {
  const fill = (select, values) => {
    const current = select.value;
    const allowed = new Set(values || []);
    select.innerHTML = `<option value="">${select === catalogDepartment ? 'Todos' : 'Todas'}</option>${(values || []).map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`;
    select.value = allowed.has(current) ? current : '';
  };
  fill(catalogDepartment, facets.departments); fill(catalogSection, facets.sections); fill(catalogFamily, facets.families); fill(catalogSubfamily, facets.subfamilies);
};

const renderCatalogItems = items => items.map(item => `<article class="catalog-card"><button class="catalog-card-button" type="button" data-catalog-barcode="${escapeHtml(item.barcode)}"><div class="catalog-card-image">${item.image ? `<img src="${escapeHtml(item.image)}" alt="Imagen de ${escapeHtml(item.description)}"><span class="placeholder" hidden>Imagen no disponible</span>` : '<span class="placeholder">Imagen no disponible</span>'}</div><div class="catalog-card-details"><p class="eyebrow">${escapeHtml(item.style || 'STYLE no disponible')}</p><h3>${escapeHtml(item.description || 'Producto VS')}</h3><p><strong>${escapeHtml(item.color || 'Color no disponible')}</strong></p><span>${escapeHtml(item.stock)} unidades · ${escapeHtml(item.availableSizes)} tallas</span></div></button></article>`).join('');

const loadCatalog = async (reset = true) => {
  const offset = reset ? 0 : catalogState.offset + catalogState.limit;
  const params = new URLSearchParams({ q: catalogQuery.value.trim(), department: catalogDepartment.value, section: catalogSection.value, family: catalogFamily.value, subfamily: catalogSubfamily.value, offset: String(offset), limit: String(catalogState.limit) });
  catalogMessage.textContent = 'Cargando catálogo…';
  try {
    const response = await fetch(`/api/vs/catalog?${params}`); const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el catálogo');
    renderFacets(data.facets || { departments: [], sections: [], families: [], subfamilies: [] });
    catalogState = { offset: data.offset, limit: data.limit, hasMore: data.hasMore };
    if (reset) catalogResults.innerHTML = renderCatalogItems(data.items); else catalogResults.insertAdjacentHTML('beforeend', renderCatalogItems(data.items));
    catalogMessage.textContent = `${data.total} productos STYLE + COLOR disponibles`;
    catalogMore.hidden = !data.hasMore;
    catalogResults.querySelectorAll('[data-catalog-barcode]').forEach(button => button.addEventListener('click', () => loadProduct(button.dataset.catalogBarcode, true, true)));
  } catch (error) { catalogMessage.textContent = error.message; catalogResults.innerHTML = ''; catalogMore.hidden = true; }
};

function openCatalog() { scannerView.hidden = true; catalogView.hidden = false; catalogQuery.focus(); loadCatalog(true); }
function showScanner() { catalogView.hidden = true; scannerView.hidden = false; }

form.addEventListener('submit', event => { event.preventDefault(); returnToCatalog = false; loadProduct(input.value.trim(), true, false); });
catalogToggle.addEventListener('click', openCatalog); backScanner.addEventListener('click', showScanner); catalogForm.addEventListener('submit', event => { event.preventDefault(); loadCatalog(true); }); catalogMore.addEventListener('click', () => loadCatalog(false));
catalogDepartment.addEventListener('change', () => { catalogSection.value = ''; catalogFamily.value = ''; catalogSubfamily.value = ''; loadCatalog(true); });
catalogSection.addEventListener('change', () => { catalogFamily.value = ''; catalogSubfamily.value = ''; loadCatalog(true); });
catalogFamily.addEventListener('change', () => { catalogSubfamily.value = ''; loadCatalog(true); });
catalogSubfamily.addEventListener('change', () => loadCatalog(true));
focusScanner();
