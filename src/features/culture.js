import './culture.css';

const COLLECTIONS = new Set(['orixas', 'members']);
const safe = (ui, value) => ui.escape(String(value ?? ''));
let spotifyApiPromise;
let activePlayer;

function loadSpotifyApi() {
  if (spotifyApiPromise) return spotifyApiPromise;
  spotifyApiPromise = new Promise(resolve => {
    let settled = false;
    const finish = api => { if (!settled) { settled = true; resolve(api); } };
    window.onSpotifyIframeApiReady = api => finish(api);
    const script = document.createElement('script');
    script.src = 'https://open.spotify.com/embed/iframe-api/v1';
    script.async = true;
    script.onerror = () => finish(null);
    document.head.append(script);
  });
  return spotifyApiPromise;
}

function stopPlayer(session) {
  if (!session || session.closed) return;
  session.closed = true;
  try { session.controller?.pause(); } catch { /* The Embed may already be gone. */ }
  try { session.controller?.destroy(); } catch { /* Removing the iframe below still stops it. */ }
  session.mount?.replaceChildren();
  if (activePlayer === session) activePlayer = null;
}

function imageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function spotifyEmbed(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || parts.length !== 2 || !['track', 'playlist'].includes(parts[0]) || !/^[A-Za-z0-9]{22}$/.test(parts[1])) return '';
    return `https://open.spotify.com/embed/${parts[0]}/${parts[1]}`;
  } catch { return ''; }
}

function imageMarkup(ui, item, label) {
  const url = imageUrl(item?.imageUrl);
  return url
    ? `<img src="${safe(ui, url)}" alt="${safe(ui, item.name || label)}" loading="lazy">`
    : `<div class="culture-image-empty" aria-label="Imagem aguardando envio pela casa"><span aria-hidden="true">✦</span><small>Imagem em preparação</small></div>`;
}

function readDialog(ctx, item, label) {
  const { ui } = ctx;
  const dialog = document.createElement('dialog');
  dialog.className = 'culture-detail';
  const embed = spotifyEmbed(item.spotifyUrl);
  dialog.innerHTML = `<div class="culture-detail-head"><div><p class="page-kicker">${safe(ui, label)}</p><h2>${safe(ui, item.name)}</h2>${item.alias ? `<p class="culture-alias">${safe(ui, item.alias)}</p>` : ''}</div><button class="btn btn-icon culture-close" type="button" aria-label="Fechar detalhe">${ui.icon('close')}</button></div><div class="culture-detail-image">${imageMarkup(ui, item, label)}</div><div class="culture-description">${item.description ? safe(ui, item.description).replace(/\r?\n/g, '<br>') : '<p class="culture-pending">Descrição aguardando conteúdo da casa.</p>'}</div>${embed ? `<div class="culture-music"><h3>Música</h3><button class="btn btn-secondary culture-play" type="button">${ui.icon('music')} Reproduzir música</button><p class="culture-play-status" aria-live="polite">Se a reprodução não iniciar, use os controles do Spotify abaixo.</p><div class="culture-player"><iframe title="Spotify: ${safe(ui, item.name)}" src="${embed}" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div></div>` : ''}`;
  document.body.append(dialog);
  stopPlayer(activePlayer);
  const session = embed ? { dialog, mount: dialog.querySelector('.culture-player'), controller: null, ready: false, closed: false } : null;
  if (session) activePlayer = session;
  const close = () => dialog.close();
  dialog.querySelector('.culture-close').addEventListener('click', close);
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  dialog.addEventListener('close', () => { stopPlayer(session); dialog.remove(); }, { once: true });
  dialog.showModal();
  if (!session) return;
  const status = dialog.querySelector('.culture-play-status');
  dialog.querySelector('.culture-play').addEventListener('click', () => {
    if (session.ready && session.controller) {
      try { session.controller.play(); status.textContent = 'Se a reprodução for bloqueada, use os controles do Spotify abaixo.'; }
      catch { status.textContent = 'Use os controles do Spotify abaixo para reproduzir.'; }
    } else {
      status.textContent = 'Use os controles do Spotify abaixo para reproduzir.';
      session.mount.querySelector('iframe')?.focus();
    }
  });
  const [, , kind, id] = new URL(embed).pathname.split('/');
  loadSpotifyApi().then(api => {
    if (!api || session.closed || !dialog.isConnected || activePlayer !== session) return;
    const fallback = session.mount.innerHTML;
    session.mount.replaceChildren();
    try {
      api.createController(session.mount, { uri: `spotify:${kind}:${id}`, width: '100%', height: 152 }, controller => {
        if (session.closed || !dialog.isConnected || activePlayer !== session) { try { controller.destroy(); } catch { /* The player was removed. */ } return; }
        session.controller = controller;
        controller.addListener('ready', () => {
          if (session.closed || !dialog.isConnected || activePlayer !== session) return;
          session.ready = true;
          try { controller.play(); } catch { status.textContent = 'Use os controles do Spotify abaixo para reproduzir.'; }
        });
      });
    } catch {
      if (!session.closed && dialog.isConnected) session.mount.innerHTML = fallback;
    }
  });
}

function editor(ctx, collection, item = null) {
  const { ui, api } = ctx;
  const isEdit = Boolean(item);
  const body = `<div class="field-grid"><label class="form-field">Nome <input name="name" required maxlength="160" value="${safe(ui, item?.name)}"></label><label class="form-field">Nome alternativo <input name="alias" maxlength="160" value="${safe(ui, item?.alias)}"></label></div><label class="form-field">Descrição <textarea name="description" rows="8">${safe(ui, item?.description)}</textarea></label><label class="form-field">Imagem <input name="image" type="file" accept="image/png,image/jpeg,image/webp"><small>PNG, JPEG ou WebP, até 5 MB. Se não selecionar arquivo, a imagem atual permanece.</small></label><label class="form-field">Link do Spotify <input name="spotifyUrl" type="url" inputmode="url" placeholder="https://open.spotify.com/track/..." value="${safe(ui, item?.spotifyUrl)}"><small>Aceita faixa ou playlist do Spotify.</small></label>`;
  const modal = ui.openModal({
    title: isEdit ? `Editar ${collection === 'members' ? 'integrante' : 'orixá'}` : `Adicionar ${collection === 'members' ? 'integrante' : 'orixá'}`,
    body,
    onSubmit: async (form, current) => {
      const data = new FormData(form);
      const spotifyUrl = String(data.get('spotifyUrl') || '').trim();
      if (spotifyUrl && !spotifyEmbed(spotifyUrl)) { ui.toast('Use um link HTTPS de faixa ou playlist do Spotify.', 'error'); return; }
      const payload = {
        name: String(data.get('name') || '').trim(),
        alias: String(data.get('alias') || '').trim(),
        description: String(data.get('description') || '').trim(),
        spotifyUrl,
      };
      if (!payload.name) { ui.toast('Informe o nome.', 'error'); return; }
      const file = data.get('image');
      try {
        if (file instanceof File && file.size) {
          if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { ui.toast('Escolha PNG, JPEG ou WebP de até 5 MB.', 'error'); return; }
          const uploaded = await api.upload(file, 'image');
          payload.imagePath = uploaded.path;
        }
        await api(`/api/${collection}${isEdit ? `/${encodeURIComponent(item.id)}` : ''}`, { method: isEdit ? 'PATCH' : 'POST', body: payload });
        current.close();
        ui.toast(isEdit ? 'Cadastro atualizado.' : 'Cadastro criado.');
        await ctx.refresh();
      } catch (error) { ui.toast(error.message, 'error'); }
    },
  });
  return modal;
}

export async function render(container, ctx) {
  const collection = COLLECTIONS.has(ctx.route?.[0]) ? ctx.route[0] : 'orixas';
  const isMembers = collection === 'members';
  const label = isMembers ? 'Ilé Asé' : 'Itáns e Orixás';
  const items = (ctx.state?.[collection] || []).filter(item => !item.archived);
  const admin = ctx.user?.role === 'admin';
  container.innerHTML = `<section class="culture-page"><header class="page-heading culture-heading"><div><p class="page-kicker">Nossa casa</p><h1 class="page-title">${label}</h1><p class="page-description">${isMembers ? 'Integrantes apresentados pela casa.' : 'Conheça os nomes e conteúdos compartilhados pela casa.'}</p></div>${admin ? `<button class="btn btn-primary culture-add" type="button">${ctx.ui.icon('plus')} Adicionar</button>` : ''}</header><div class="culture-list">${items.length ? items.map((item, index) => `<article class="culture-card ${index % 2 ? 'culture-card-reverse' : ''}" data-id="${safe(ctx.ui, item.id)}"><div class="culture-card-image">${imageMarkup(ctx.ui, item, label)}</div><div class="culture-card-copy"><p class="page-kicker">${isMembers ? 'Integrante' : 'Orixá'}</p><h2>${safe(ctx.ui, item.name)}</h2>${item.alias ? `<p class="culture-alias">${safe(ctx.ui, item.alias)}</p>` : ''}<p class="culture-excerpt">${item.description ? safe(ctx.ui, item.description) : 'Descrição aguardando conteúdo da casa.'}</p><div class="culture-card-actions"><button class="btn btn-secondary culture-read" type="button">Ler detalhes ${ctx.ui.icon('arrow')}</button>${admin ? `<button class="btn btn-icon culture-edit" type="button" aria-label="Editar ${safe(ctx.ui, item.name)}">${ctx.ui.icon('edit')}</button><button class="btn btn-icon culture-archive" type="button" aria-label="Arquivar ${safe(ctx.ui, item.name)}">${ctx.ui.icon('trash')}</button>` : ''}</div></div></article>`).join('') : ctx.ui.empty('Conteúdo em preparação', isMembers ? 'Os integrantes serão apresentados pela casa.' : 'Os orixás serão apresentados pela casa.')}</div></section>`;
  container.querySelector('.culture-add')?.addEventListener('click', () => editor(ctx, collection));
  container.querySelectorAll('.culture-card').forEach(card => {
    const item = items.find(entry => String(entry.id) === card.dataset.id);
    if (!item) return;
    card.querySelector('.culture-read').addEventListener('click', () => readDialog(ctx, item, label));
    card.querySelector('.culture-edit')?.addEventListener('click', () => editor(ctx, collection, item));
    card.querySelector('.culture-archive')?.addEventListener('click', async () => {
      if (!await ctx.ui.confirm(`Arquivar ${item.name}?`)) return;
      try { await ctx.api(`/api/${collection}/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); ctx.ui.toast('Cadastro arquivado.'); await ctx.refresh(); }
      catch (error) { ctx.ui.toast(error.message, 'error'); }
    });
  });
}
