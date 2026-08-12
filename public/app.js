const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const form = document.querySelector('#search');
const input = document.querySelector('#barcode');
const clearButton = document.querySelector('#clear');
const result = document.querySelector('#result');
const message = document.querySelector('#message');

const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = `message ${type}`; };
const setLoading = loading => { form.classList.toggle('is-loading', loading); form.querySelector('.primary-button').disabled = loading; };
const formatPrice = value => Number(value) > 0
  ? new Intl.NumberFormat('es-CR', { style: 'currency', currency: 'CRC', maximumFractionDigits: 0 }).format(Number(value))
  : 'No disponible';

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

const renderProduct = data => {
  const scannedSize = escapeHtml(data.scannedSize);
  const colorName = data.colorDescription || data.colorSpanish || data.color || 'No disponible';
  const secondaryColor = data.colorSpanish && data.colorSpanish !== colorName ? data.colorSpanish : '';
  const spanishDescription = data.spanishDescription && data.spanishDescription.toLowerCase() !== String(data.description || '').toLowerCase()
    ? `<p class="product-description-es">${escapeHtml(data.spanishDescription)}</p>`
    : '';
  const material = data.material
    ? `<section class="material-section"><span class="label">Material / composición</span><p>${escapeHtml(data.material)}</p></section>`
    : '';
  const sizes = sortedSizes(data.sizes).map(item => `<div class="size-card ${item.size === data.scannedSize ? 'is-scanned' : ''} ${Number(item.stock) === 0 ? 'is-empty' : ''}"><span class="size-name">${escapeHtml(item.size)}</span><span class="size-stock">Stock: ${escapeHtml(item.stock)}</span></div>`).join('');
  const colors = data.relatedColors.length ? `<section class="colors-section"><div class="subsection-heading"><h3>Otros colores disponibles</h3><span>${data.relatedColors.length}</span></div><div class="color-list">${data.relatedColors.map(variant => {
    const name = variant.colorDescription || variant.colorSpanish || variant.color;
    const secondary = variant.colorSpanish && variant.colorSpanish !== name ? `<small>${escapeHtml(variant.colorSpanish)}</small>` : '';
    return `<button class="color-chip" type="button" data-reference="${escapeHtml(variant.reference)}"><span>${escapeHtml(name)}</span>${secondary}</button>`;
  }).join('')}</div></section>` : '';

  result.innerHTML = `<article class="product-card"><div class="product-image-panel"><div class="image-frame"><img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}" /><div class="image-placeholder" hidden><span class="placeholder-mark">AE</span><span>Imagen no disponible</span></div></div><span class="image-caption">Vista del producto</span></div><div class="product-details"><div class="product-title"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2>${spanishDescription}</div><div class="customer-summary"><div class="price-block"><span class="label">Precio</span><strong>${escapeHtml(formatPrice(data.price))}</strong></div><div class="color-block"><span class="label">Color</span><strong>${escapeHtml(colorName)}</strong>${secondaryColor ? `<small>${escapeHtml(secondaryColor)}</small>` : ''}</div></div><div class="scanned-stock"><div><span class="label">Talla escaneada</span><strong>${scannedSize}</strong></div><div class="stock-value"><span class="label">Stock</span><strong>${escapeHtml(data.stock)} <small>unidades</small></strong></div></div>${material}</div><section class="sizes-section"><div class="subsection-heading"><h3>Disponibilidad de tallas</h3><span>${data.sizes.length} tallas</span></div><div class="size-grid">${sizes}</div></section>${colors}</article>`;

  const image = result.querySelector('img');
  const placeholder = result.querySelector('.image-placeholder');
  image.addEventListener('error', () => { image.hidden = true; placeholder.hidden = false; });
  result.querySelectorAll('[data-reference]').forEach(button => button.addEventListener('click', () => loadReference(button.dataset.reference)));
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

clearButton.addEventListener('click', () => { input.value = ''; clearButton.hidden = true; result.innerHTML = ''; setMessage('Listo para escanear'); focusScanner(); });
input.addEventListener('input', () => { clearButton.hidden = !input.value; });

form.addEventListener('submit', async event => {
  event.preventDefault();
  const barcode = input.value.trim();
  if (!barcode || form.classList.contains('is-loading')) return;
  setLoading(true); setMessage('Consultando…', 'is-loading'); result.innerHTML = '';
  try {
    const response = await fetch(`/api/products/${encodeURIComponent(barcode)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 404 ? 'Producto no encontrado' : (data.error || 'Error de consulta'));
    renderProduct(data); setMessage('Producto encontrado', 'is-success');
  } catch (error) { result.innerHTML = `<div class="empty-state error-state"><span class="state-icon">!</span><h2>${escapeHtml(error.message || 'Error de consulta')}</h2><p>Verifica el código e inténtalo nuevamente.</p></div>`; setMessage('No se pudo completar la consulta', 'is-error'); }
  finally { setLoading(false); focusScanner(); }
});

setMessage('Listo para escanear');
