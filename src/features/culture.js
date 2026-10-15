import './culture.css';
import {cultureDetailMarkup, cultureDetailPath} from '../lib/culture-view.js';

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

function mountPlayer(root, embed) {
  stopPlayer(activePlayer);
  const session = { root, mount: root.querySelector('.culture-player'), controller: null, ready: false, closed: false };
  activePlayer = session;
  const status = root.querySelector('.culture-play-status');
  root.querySelector('.culture-play').addEventListener('click', () => {
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
    if (!api || session.closed || !root.isConnected || activePlayer !== session) return;
    const fallback = session.mount.innerHTML;
    session.mount.replaceChildren();
    try {
      api.createController(session.mount, { uri: `spotify:${kind}:${id}`, width: '100%', height: 152 }, controller => {
        if (session.closed || !root.isConnected || activePlayer !== session) { try { controller.destroy(); } catch { /* The player was removed. */ } return; }
        session.controller = controller;
        controller.addListener('ready', () => {
          if (session.closed || !root.isConnected || activePlayer !== session) return;
          session.ready = true;
          try { controller.play(); } catch { status.textContent = 'Use os controles do Spotify abaixo para reproduzir.'; }
        });
      });
    } catch {
      if (!session.closed && root.isConnected) session.mount.innerHTML = fallback;
    }
  });
  return session;
}

function detailPage(container, ctx, collection, item, label) {
  const embed = spotifyEmbed(item.spotifyUrl);
  container.innerHTML = cultureDetailMarkup(ctx.ui, item, label, embed, ctx.user?.role === 'admin');
  const root = container.querySelector('.culture-entry-page');
  root.querySelector('[data-culture-back]').addEventListener('click', () => ctx.navigate(collection));
  root.querySelector('[data-culture-edit]')?.addEventListener('click', () => editor(ctx, collection, item));
  const session = embed ? mountPlayer(root, embed) : null;
  return () => stopPlayer(session);
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
  if (ctx.route?.[1]) {
    let itemId = ctx.route[1];
    try { itemId = decodeURIComponent(itemId); } catch { /* Keep the literal path segment. */ }
    const item = items.find(entry => String(entry.id) === itemId);
    if (!item) {
      container.innerHTML = `<section class="culture-page">${ctx.ui.empty('Conteúdo não encontrado', 'Este item pode ter sido arquivado ou removido.', `<button class="btn btn-secondary" type="button" data-culture-back>Voltar para ${safe(ctx.ui,label)}</button>`)}</section>`;
      container.querySelector('[data-culture-back]').addEventListener('click', () => ctx.navigate(collection));
      return;
    }
    return detailPage(container, ctx, collection, item, label);
  }
  container.innerHTML = `<section class="culture-page"><header class="page-heading culture-heading"><div><p class="page-kicker">Nossa casa</p><h1 class="page-title">${label}</h1><p class="page-description">${isMembers ? 'Integrantes apresentados pela casa.' : 'Conheça os nomes e conteúdos compartilhados pela casa.'}</p></div>${admin ? `<button class="btn btn-primary culture-add" type="button">${ctx.ui.icon('plus')} Adicionar</button>` : ''}</header><div class="culture-list">${items.length ? items.map((item, index) => `<article class="culture-card ${index % 2 ? 'culture-card-reverse' : ''}" data-id="${safe(ctx.ui, item.id)}"><div class="culture-card-image">${imageMarkup(ctx.ui, item, label)}</div><div class="culture-card-copy"><p class="page-kicker">${isMembers ? 'Integrante' : 'Orixá'}</p><h2><button class="culture-title-open" type="button">${safe(ctx.ui, item.name)}</button></h2>${item.alias ? `<p class="culture-alias">${safe(ctx.ui, item.alias)}</p>` : ''}<p class="culture-excerpt">${item.description ? safe(ctx.ui, item.description) : 'Descrição aguardando conteúdo da casa.'}</p><div class="culture-card-actions"><button class="btn btn-secondary culture-read" type="button">Ler detalhes ${ctx.ui.icon('arrow')}</button>${admin ? `<button class="btn btn-icon culture-edit" type="button" aria-label="Editar ${safe(ctx.ui, item.name)}">${ctx.ui.icon('edit')}</button><button class="btn btn-icon culture-archive" type="button" aria-label="Arquivar ${safe(ctx.ui, item.name)}">${ctx.ui.icon('trash')}</button>` : ''}</div></div></article>`).join('') : ctx.ui.empty('Conteúdo em preparação', isMembers ? 'Os integrantes serão apresentados pela casa.' : 'Os orixás serão apresentados pela casa.')}</div></section>`;
  container.querySelector('.culture-add')?.addEventListener('click', () => editor(ctx, collection));
  container.querySelectorAll('.culture-card').forEach(card => {
    const item = items.find(entry => String(entry.id) === card.dataset.id);
    if (!item) return;
    const openDetail = () => ctx.navigate(cultureDetailPath(collection, item.id));
    card.querySelector('.culture-read').addEventListener('click', openDetail);
    card.querySelector('.culture-title-open').addEventListener('click', openDetail);
    card.querySelector('.culture-edit')?.addEventListener('click', () => editor(ctx, collection, item));
    card.querySelector('.culture-archive')?.addEventListener('click', async () => {
      if (!await ctx.ui.confirm(`Arquivar ${item.name}?`)) return;
      try { await ctx.api(`/api/${collection}/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); ctx.ui.toast('Cadastro arquivado.'); await ctx.refresh(); }
      catch (error) { ctx.ui.toast(error.message, 'error'); }
    });
  });
}
