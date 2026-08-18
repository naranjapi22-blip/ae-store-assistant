const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const form = document.querySelector('#search-form');
const input = document.querySelector('#barcode');
const result = document.querySelector('#result');
const message = document.querySelector('#message');
const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = type; };

const renderImage = data => data.image
  ? `<img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}"><div class="placeholder" hidden>Imagen no disponible</div>`
  : '<div class="placeholder">Imagen no disponible</div>';

const renderSizes = data => (data.sizes || []).map(item => `<li class="size ${item.scanned ? 'scanned' : ''}"><strong>${escapeHtml(item.size || 'Sin talla')}</strong><span>${escapeHtml(item.stock)} unidades</span>${item.scanned ? '<em>Talla escaneada</em>' : ''}</li>`).join('') || '<li class="no-items">No hay tallas disponibles</li>';

const renderColors = data => (data.relatedColors || []).length
  ? `<section class="related-colors" aria-labelledby="related-colors-title"><h3 id="related-colors-title">Otros colores disponibles</h3><div class="color-list">${data.relatedColors.map(item => `<button class="color-option" type="button" data-barcode="${escapeHtml(item.barcode)}"><span class="color-swatch" aria-hidden="true" style="background-image:url('${escapeHtml(item.image || '')}')"></span><span>${escapeHtml(item.color)}</span><small>${escapeHtml(item.stock)} unidades</small></button>`).join('')}</div></section>`
  : '';

const renderProduct = data => {
  result.innerHTML = `<article class="product"><div class="image">${renderImage(data)}</div><div class="details"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2><dl><dt>STYLE</dt><dd>${escapeHtml(data.style || 'No disponible')}</dd><dt>REFPROVEEDOR</dt><dd>${escapeHtml(data.supplierReference || 'No disponible')}</dd><dt>COLOR</dt><dd>${escapeHtml(data.color || 'No disponible')}</dd><dt>TALLA ESCANEADA</dt><dd>${escapeHtml(data.scannedSize || 'No disponible')}</dd><dt>STOCK EXACTO</dt><dd>${escapeHtml(data.stock)}</dd><dt>TEMPORADA</dt><dd>${escapeHtml(data.season || 'No disponible')}</dd><dt>DEPARTAMENTO</dt><dd>${escapeHtml(data.department || 'No disponible')}</dd><dt>SECCIÓN</dt><dd>${escapeHtml(data.section || 'No disponible')}</dd><dt>FAMILIA</dt><dd>${escapeHtml(data.family || 'No disponible')}</dd></dl>${renderColors(data)}<h3>${data.sizes?.length === 1 ? 'Talla disponible' : 'Tallas disponibles'}</h3><ul class="sizes">${renderSizes(data)}</ul></div></article>`;
  const image = result.querySelector('.image img');
  image?.addEventListener('error', () => { image.hidden = true; image.nextElementSibling.hidden = false; });
  result.querySelectorAll('.color-option').forEach(button => button.addEventListener('click', () => loadProduct(button.dataset.barcode)));
};

const loadProduct = async barcode => {
  if (!barcode || form.classList.contains('loading')) return;
  form.classList.add('loading'); setMessage('Consultando…', 'loading');
  try {
    const response = await fetch(`/api/vs/products/${encodeURIComponent(barcode)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 404 ? 'No se encontró ningún producto.' : (data.error || 'No se pudo consultar'));
    input.value = barcode; renderProduct(data); setMessage('Producto encontrado', 'success');
  } catch (error) {
    result.innerHTML = `<div class="empty"><h2>${escapeHtml(error.message)}</h2></div>`; setMessage('No se pudo completar la consulta', 'error');
  } finally { form.classList.remove('loading'); focusScanner(); }
};

form.addEventListener('submit', event => { event.preventDefault(); loadProduct(input.value.trim()); });
focusScanner();
