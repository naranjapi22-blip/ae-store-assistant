const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const form = document.querySelector('#search-form');
const input = document.querySelector('#barcode');
const result = document.querySelector('#result');
const message = document.querySelector('#message');
const focusScanner = () => { input.focus(); input.select(); };
const setMessage = (text, type = '') => { message.textContent = text; message.className = type; };
const renderProduct = data => {
  const visual = data.image ? `<img src="${escapeHtml(data.image)}" alt="Imagen de ${escapeHtml(data.description)}"><div class="placeholder" hidden>Imagen no disponible</div>` : '<div class="placeholder">Imagen no disponible</div>';
  const sizes = (data.sizes || []).map(item => `<li class="size ${item.size === data.scannedSize ? 'scanned' : ''}"><strong>${escapeHtml(item.size || 'Sin talla')}</strong><span>${escapeHtml(item.stock)} unidades</span>${item.size === data.scannedSize ? '<em>Escaneada</em>' : ''}</li>`).join('');
  const sizeNote = '';
  result.innerHTML = `<article class="product"><div class="image">${visual}</div><div class="details"><p class="eyebrow">PRODUCTO ENCONTRADO</p><h2>${escapeHtml(data.description)}</h2><dl><dt>REFPROVEEDOR</dt><dd>${escapeHtml(data.supplierReference || 'No disponible')}</dd><dt>COLOR</dt><dd>${escapeHtml(data.color || 'No disponible')}</dd><dt>TALLA ESCANEADA</dt><dd>${escapeHtml(data.scannedSize || 'No disponible')}</dd><dt>STOCK EXACTO</dt><dd>${escapeHtml(data.stock)}</dd><dt>TEMPORADA</dt><dd>${escapeHtml(data.season || 'No disponible')}</dd><dt>DEPARTAMENTO</dt><dd>${escapeHtml(data.department || 'No disponible')}</dd><dt>SECCIÓN</dt><dd>${escapeHtml(data.section || 'No disponible')}</dd><dt>FAMILIA</dt><dd>${escapeHtml(data.family || 'No disponible')}</dd></dl><h3>Otras tallas disponibles</h3>${sizeNote}<ul class="sizes">${sizes || '<li>No hay tallas relacionadas</li>'}</ul></div></article>`;
  if (data.sizes?.length === 1) result.querySelector('.details h3').textContent = 'Talla disponible';
  const image = result.querySelector('.image img');
  image?.addEventListener('error', () => { image.hidden = true; image.nextElementSibling.hidden = false; });
};
form.addEventListener('submit', async event => {
  event.preventDefault(); const barcode = input.value.trim(); if (!barcode || form.classList.contains('loading')) return;
  form.classList.add('loading'); result.innerHTML = ''; setMessage('Consultando…', 'loading');
  try { const response = await fetch(`/api/vs/products/${encodeURIComponent(barcode)}`); const data = await response.json(); if (!response.ok) throw new Error(response.status === 404 ? 'No se encontró ningún producto.' : (data.error || 'No se pudo consultar')); renderProduct(data); setMessage('Producto encontrado', 'success'); }
  catch (error) { result.innerHTML = `<div class="empty"><h2>${escapeHtml(error.message)}</h2></div>`; setMessage('No se pudo completar la consulta', 'error'); }
  finally { form.classList.remove('loading'); focusScanner(); }
});
focusScanner();
