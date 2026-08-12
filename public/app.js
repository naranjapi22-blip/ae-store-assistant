const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const form = document.querySelector('#search');
const input = document.querySelector('#barcode');
const clearButton = document.querySelector('#clear');
const result = document.querySelector('#result');
const message = document.querySelector('#message');

const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = `message ${type}`; };
const setLoading = loading => { form.classList.toggle('is-loading', loading); form.querySelector('.primary-button').disabled = loading; };

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
  const sizes = sortedSizes(data.sizes).map(item => `<div class="size-card ${item.size === data.scannedSize ? 'is-scanned' : ''} ${Number(item.stock) === 0 ? 'is-empty' : ''}"><span class="size-name">${escapeHtml(item.size)}</span><span class="size-stock">Stock: ${escapeHtml(item.stock)}</span></div>`).join('');
  const colors = data.relatedColors.length ? `<section class="colors-section"><div class="subsection-heading"><h3>Otros colores disponibles</h3><span>${data.relatedColors.length}</span></div><div class="color-list">${data.relatedColors.map(variant => `<button class="color-chip" type="button" data-reference="${escapeHtml(variant.reference)}"><span>Color: ${escapeHtml(variant.color)}</span><small>Ref: ${escapeHtml(variant.reference)}</small></button>`).join('')}</div></section>` : '';
  result.innerHTML = `<article class="product-card"><div class="product-image-panel"><div class="image-frame"><img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}" /><div class="image-placeholder" hidden><span class="placeholder-mark">AE</span><span>Imagen no disponible</span></div></div><span class="image-caption">Vista del producto</span></div><div class="product-details"><div class="product-title"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2></div><dl class="product-meta"><div><dt>Referencia</dt><dd>${escapeHtml(data.REFERENCIA_STYLO)}</dd></div><div><dt>Style</dt><dd>${escapeHtml(data.STYLE)}</dd></div><div><dt>Color</dt><dd>${escapeHtml(data.color)}</dd></div></dl><div class="scanned-stock"><div><span class="label">Talla escaneada</span><strong>${scannedSize}</strong></div><div class="stock-value"><span class="label">Stock</span><strong>${escapeHtml(data.stock)} <small>unidades</small></strong></div></div></div><section class="sizes-section"><div class="subsection-heading"><h3>Disponibilidad de tallas</h3><span>${data.sizes.length} tallas</span></div><div class="size-grid">${sizes}</div></section>${colors}</article>`;
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
