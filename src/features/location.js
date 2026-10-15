import './culture.css';

const safe = (ui, value) => ui.escape(String(value ?? ''));

function photoUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function googleEmbed(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !['www.google.com', 'google.com', 'maps.google.com'].includes(host) || url.pathname !== '/maps/embed') return '';
    return url.href;
  } catch { return ''; }
}

function editLocation(ctx, site) {
  const { ui, api } = ctx;
  const body = `<label class="form-field">Endereço <textarea name="address" rows="3" placeholder="Endereço fornecido pela casa">${safe(ui, site.address)}</textarea></label><label class="form-field">URL do mapa incorporado <input type="url" name="mapUrl" placeholder="https://www.google.com/maps/embed?..." value="${safe(ui, site.mapUrl)}"><small>Cole o endereço HTTPS do Google Maps para incorporação, sem código iframe.</small></label><label class="form-field">Foto da fachada <input type="file" name="photo" accept="image/png,image/jpeg,image/webp"><small>PNG, JPEG ou WebP, até 5 MB.</small></label>`;
  ui.openModal({ title: 'Editar localização', body, onSubmit: async (form, modal) => {
    const data = new FormData(form);
    const mapUrl = String(data.get('mapUrl') || '').trim();
    if (mapUrl && !googleEmbed(mapUrl)) { ui.toast('Use uma URL HTTPS de incorporação do Google Maps.', 'error'); return; }
    const payload = { address: String(data.get('address') || '').trim(), mapUrl };
    const file = data.get('photo');
    try {
      if (file instanceof File && file.size) {
        if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { ui.toast('Escolha PNG, JPEG ou WebP de até 5 MB.', 'error'); return; }
        const upload = await api.upload(file, 'image');
        payload.photoPath = upload.path;
      }
      await api('/api/site', { method: 'PATCH', body: payload });
      modal.close();
      ui.toast('Localização atualizada.');
      await ctx.refresh();
    } catch (error) { ui.toast(error.message, 'error'); }
  } });
}

export async function render(container, ctx) {
  const site = ctx.state?.site || {};
  const photo = photoUrl(site.photoUrl);
  const map = googleEmbed(site.mapUrl);
  const address = String(site.address || '').trim();
  const directions = address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}` : '';
  container.innerHTML = `<section class="culture-page location-page"><header class="page-heading culture-heading"><div><p class="page-kicker">Nossa casa</p><h1 class="page-title">Localização</h1><p class="page-description">Informações de visita compartilhadas pela casa.</p></div>${ctx.user?.role === 'admin' ? `<button class="btn btn-secondary location-edit" type="button">${ctx.ui.icon('edit')} Editar</button>` : ''}</header><div class="location-layout"><div class="location-visual">${photo ? `<img src="${safe(ctx.ui, photo)}" alt="Fachada da casa" loading="lazy">` : '<div class="culture-image-empty"><span aria-hidden="true">✦</span><small>Foto da fachada em preparação</small></div>'}</div><div class="location-details"><div class="card location-address"><span class="location-icon" aria-hidden="true">${ctx.ui.icon('location')}</span><h2>Endereço</h2><p>${address ? safe(ctx.ui, address).replace(/\r?\n/g, '<br>') : 'Endereço aguardando informação da casa.'}</p>${directions ? `<a class="btn btn-primary" href="${safe(ctx.ui, directions)}" target="_blank" rel="noopener noreferrer">Abrir trajeto ${ctx.ui.icon('arrow')}</a>` : ''}</div></div></div><div class="location-map">${map ? `<iframe title="Mapa da localização da casa" src="${safe(ctx.ui, map)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>` : '<div class="location-map-empty"><span aria-hidden="true">⌖</span><p>Mapa aguardando endereço da casa.</p></div>'}</div></section>`;
  container.querySelector('.location-edit')?.addEventListener('click', () => editLocation(ctx, site));
}
