import './users.css';

const statusNames = { pending: 'Pendente', approved: 'Aprovado', blocked: 'Bloqueado' };
const roleNames = { admin: 'Administrador', member: 'Membro' };

function photoUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function avatar(ui, user) {
  const url = photoUrl(user.photoUrl);
  return url
    ? `<img class="user-avatar" src="${ui.escape(url)}" alt="Foto de ${ui.escape(user.name || user.email || 'usuário')}" loading="lazy">`
    : `<span class="user-avatar" aria-hidden="true">${ui.escape((user.name || user.email || '?').trim().charAt(0).toLocaleUpperCase('pt-BR'))}</span>`;
}

function normalized(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function presenceOf(user, presence) {
  if (!presence) return null;
  if (!Object.prototype.hasOwnProperty.call(presence, user.id)) return false;
  const value = presence[user.id];
  return typeof value === 'boolean' ? value : Boolean(value?.connections && Object.keys(value.connections).length);
}

function editUser(ctx, user) {
  const { ui, api } = ctx;
  const modal = ui.openModal({
    title: `Editar acesso de ${user.name || user.email || 'usuário'}`,
    submitLabel: 'Salvar acesso',
    body: `<p class="users-modal-identity">${ui.escape(user.email || 'Sem e-mail cadastrado')}</p><div class="field-grid"><label class="form-field"><span>Situação</span><select name="status"><option value="pending" ${user.status === 'pending' ? 'selected' : ''}>Pendente</option><option value="approved" ${user.status === 'approved' ? 'selected' : ''}>Aprovado</option><option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>Bloqueado</option></select></label><label class="form-field"><span>Perfil</span><select name="role"><option value="member" ${user.role === 'member' ? 'selected' : ''}>Membro</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label></div><p class="form-note">O servidor protege o último administrador aprovado.</p>`,
    onSubmit: async form => {
      const status = form.elements.status.value;
      const role = form.elements.role.value;
      if (status === user.status && role === user.role) { modal.close(); return; }
      if (status === 'blocked' && user.status !== 'blocked') {
        if (!await ui.confirm(`Bloquear o acesso de ${user.name || user.email}?`)) return;
      }
      if (role === 'admin' && user.role !== 'admin') {
        if (!await ui.confirm(`Promover ${user.name || user.email} a administrador?`)) return;
      }
      await api(`/api/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: { status, role } });
      modal.close();
      ui.toast('Acesso atualizado.');
      await ctx.refresh();
    },
  });
}

async function resetPassword(ctx, user) {
  if (!await ctx.ui.confirm(`Solicitar recuperação de senha para ${user.email}?`)) return;
  try {
    const result = await ctx.api(`/api/users/${encodeURIComponent(user.id)}/password-reset`, { method: 'POST' });
    ctx.ui.toast(result.message || 'Solicitação de recuperação enfileirada.');
  } catch (error) { ctx.ui.toast(error.message, 'error'); }
}

export async function render(container, ctx) {
  if (ctx.user?.role !== 'admin' || ctx.user?.status !== 'approved') {
    container.innerHTML = ctx.ui.empty('Acesso restrito', 'Somente administradores aprovados podem consultar usuários.');
    return;
  }
  const { ui } = ctx;
  let users = Array.isArray(ctx.state?.users) ? ctx.state.users : [];
  let loadError = '';
  if (!Array.isArray(ctx.state?.users)) {
    try { users = await ctx.api('/api/users'); }
    catch (error) { loadError = error.message; }
  }
  let presence = null;
  if (typeof ctx.auth?.getPresence === 'function') {
    try { presence = await ctx.auth.getPresence(); }
    catch { presence = null; }
  }
  container.innerHTML = `<section class="users-page"><header class="page-heading users-heading"><div><p class="page-kicker">Gestão de acesso</p><h1 class="page-title">Usuários</h1><p class="page-description users-count"></p></div><button type="button" class="btn btn-secondary users-refresh">Atualizar</button></header><div class="users-toolbar"><label class="users-search"><span class="sr-only">Buscar por nome ou e-mail</span>${ui.icon('search')}<input type="search" placeholder="Buscar nome ou e-mail" autocomplete="off"></label><label class="users-filter"><span class="sr-only">Filtrar por situação</span><select aria-label="Filtrar por situação"><option value="all">Todos</option><option value="pending">Pendentes</option><option value="approved">Aprovados</option><option value="blocked">Bloqueados</option></select></label></div><div class="users-results" aria-live="polite"></div></section>`;
  const results = container.querySelector('.users-results');
  const search = container.querySelector('.users-search input');
  const filter = container.querySelector('.users-filter select');
  const count = container.querySelector('.users-count');
  function draw() {
    const pending = users.filter(user => user.status === 'pending').length;
    count.textContent = `${users.length} ${users.length === 1 ? 'pessoa cadastrada' : 'pessoas cadastradas'} · ${pending} ${pending === 1 ? 'pendente' : 'pendentes'}`;
    if (loadError) { results.innerHTML = ui.empty('Não foi possível carregar os usuários', loadError); return; }
    const query = normalized(search.value.trim());
    const selected = filter.value;
    const visible = users.filter(user => (selected === 'all' || user.status === selected) && (!query || normalized(`${user.name || ''} ${user.email || ''}`).includes(query)));
    if (!visible.length) { results.innerHTML = ui.empty('Nenhum usuário encontrado', users.length ? 'Altere a busca ou o filtro para ver outros cadastros.' : 'Ainda não há usuários cadastrados.'); return; }
    results.innerHTML = `<div class="card users-table-wrap"><table class="users-table"><thead><tr><th scope="col">Pessoa</th><th scope="col">Situação</th><th scope="col">Perfil</th><th scope="col">Presença</th><th scope="col">Ações</th></tr></thead><tbody>${visible.map(user => {
      const online = presenceOf(user, presence);
      const presenceText = online === null ? 'Indisponível' : online ? 'Online' : 'Offline';
      return `<tr data-id="${ui.escape(user.id)}"><td><div class="users-person">${avatar(ui, user)}<div><strong>${ui.escape(user.name || 'Sem nome')}</strong><small>${ui.escape(user.email || 'Sem e-mail')}</small></div></div></td><td><span class="badge users-status users-status-${ui.escape(user.status)}">${ui.escape(statusNames[user.status] || user.status || 'Desconhecida')}</span></td><td>${ui.escape(roleNames[user.role] || user.role || 'Desconhecido')}</td><td><span class="users-presence"><span class="presence-dot ${online === true ? 'online' : ''}" aria-hidden="true"></span>${presenceText}</span></td><td><div class="users-actions"><button type="button" class="btn btn-icon" data-action="edit" aria-label="Editar acesso de ${ui.escape(user.name || user.email || 'usuário')}" title="Editar acesso">${ui.icon('edit')}</button><button type="button" class="btn btn-icon" data-action="reset" aria-label="Solicitar recuperação de senha para ${ui.escape(user.name || user.email || 'usuário')}" title="Recuperar senha" ${user.email ? '' : 'disabled'}>${ui.icon('mail')}</button></div></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  search.addEventListener('input', draw);
  filter.addEventListener('change', draw);
  container.querySelector('.users-refresh').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      users = await ctx.api('/api/users');
      loadError = '';
      if (typeof ctx.auth?.getPresence === 'function') {
        try { presence = await ctx.auth.getPresence(); } catch { presence = null; }
      }
      draw();
    } catch (error) { ui.toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  results.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const user = users.find(entry => String(entry.id) === button.closest('[data-id]')?.dataset.id);
    if (!user) return;
    if (button.dataset.action === 'edit') editUser(ctx, user);
    if (button.dataset.action === 'reset') resetPassword(ctx, user);
  });
  draw();
}
