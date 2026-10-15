import './settings.css';

const tabs = [['profile', 'Perfil'], ['appearance', 'Aparência'], ['notifications', 'Notificações'], ['accessibility', 'Acessibilidade']];
const choices = (name, options, selected, e) => `<div class="settings-choice">${options.map(([value, label, swatch]) => `<label class="choice-option"><input type="radio" name="${name}" value="${e(value)}" ${String(selected) === String(value) ? 'checked' : ''}>${swatch ? `<span class="color-swatch" style="--swatch:${swatch}"></span>` : ''}<span>${e(label)}</span></label>`).join('')}</div>`;

function avatar(user, e) {
  return user.photoUrl ? `<img class="user-avatar settings-avatar" src="${e(user.photoUrl)}" alt="Foto de ${e(user.name || 'perfil')}">`
    : `<span class="user-avatar settings-avatar" aria-label="Sem foto de perfil">${e((user.name || user.email || '?').trim().charAt(0).toUpperCase())}</span>`;
}

async function saveProfile(ctx, body, success) {
  const result = await ctx.api('/api/profile', { method: 'PATCH', body });
  ctx.onUserUpdated?.(result.user);
  ctx.ui.toast(success);
  return result.user;
}

export async function render(container, ctx) {
  const e = ctx.ui.escape;
  let current = ctx.user;
  let active = 'profile';
  const admin = current.role === 'admin';
  let integrationConfig = null;
  let loadingIntegration = false;
  const allTabs = admin ? [...tabs, ['integrations', 'Integrações']] : tabs;

  function panel() {
    const pref = current.preferences || {};
    if (active === 'profile') return `<section class="card settings-card" role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-profile"><h2>Seus dados</h2><div class="settings-avatar-row">${avatar(current, e)}<div><strong>${e(current.name || 'Seu perfil')}</strong><p>${e(current.email || '')}</p><label class="btn btn-secondary settings-upload" for="settings-photo">${ctx.ui.icon('upload')} Escolher foto</label><input id="settings-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden><span id="settings-file-name" class="settings-file-name" aria-live="polite"></span></div></div>
      <form id="settings-profile-form" class="settings-form"><label class="form-field"><span>Nome</span><input name="name" autocomplete="name" maxlength="120" required value="${e(current.name || '')}"></label><label class="form-field"><span>E-mail</span><input type="email" value="${e(current.email || '')}" disabled></label><p class="settings-help">A foto aceita PNG, JPEG ou WebP de até 5 MB.</p><button class="btn btn-primary" type="submit">Salvar perfil</button></form>
      <div class="settings-password"><h3>Senha</h3><p>Para contas com e-mail e senha, informe a senha atual. Contas Google gerenciam a senha no Google.</p><form id="settings-password-form" class="settings-form"><label class="form-field"><span>Senha atual</span><input name="oldPassword" type="password" autocomplete="current-password" required></label><label class="form-field"><span>Nova senha</span><input name="newPassword" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn btn-secondary" type="submit">Alterar senha</button></form><button class="settings-link" type="button" data-action="reset-password">Enviar recuperação de senha por e-mail</button></div></section>`;
    if (active === 'appearance') return `<section class="card settings-card" role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-appearance"><h2>Aparência</h2><form id="settings-preferences-form" class="settings-form"><fieldset><legend>Tema</legend>${choices('theme', [['light','Claro'],['dark','Escuro'],['system','Automático']], pref.theme || 'light', e)}</fieldset><fieldset><legend>Cor de destaque</legend>${choices('accent', [['orange','Laranja','#b94f21'],['copper','Cobre','#a36540'],['terracotta','Terracota','#ae6756']], pref.accent || 'copper', e)}</fieldset><button class="btn btn-primary" type="submit">Salvar aparência</button></form></section>`;
    if (active === 'notifications') return `<section class="card settings-card" role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-notifications"><h2>Notificações</h2><form id="settings-preferences-form" class="settings-form"><label class="settings-toggle"><span><strong>Comunicados por e-mail</strong><p>Receber e-mails quando um novo comunicado for publicado.</p></span><input type="checkbox" name="emailNotifications" ${pref.emailNotifications !== false ? 'checked' : ''} aria-label="Receber comunicados por e-mail"></label><button class="btn btn-primary" type="submit">Salvar notificações</button></form></section>`;
    if (active === 'accessibility') return `<section class="card settings-card" role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-accessibility"><h2>Acessibilidade</h2><form id="settings-preferences-form" class="settings-form"><fieldset><legend>Tamanho do texto</legend>${choices('fontScale', [[1,'Padrão'],[1.1,'Maior'],[1.2,'Muito maior']], pref.fontScale || 1, e)}</fieldset><label class="settings-toggle"><span><strong>Reduzir movimento</strong><p>Limitar animações e movimentos do portal.</p></span><input type="checkbox" name="reducedMotion" ${pref.reducedMotion ? 'checked' : ''} aria-label="Reduzir movimento"></label><button class="btn btn-primary" type="submit">Salvar acessibilidade</button></form></section>`;
    const configured = integrationConfig?.configured === true;
    return `<section class="card settings-card" role="tabpanel" id="settings-panel" aria-labelledby="settings-tab-integrations"><h2>Integrações</h2><p class="settings-help">Estado de conexão do portal. Esta tela não mostra credenciais.</p><div class="settings-integration-row"><strong>Banco e autenticação</strong><span class="badge">Supabase</span></div><div class="settings-integration-row"><strong>Conexão</strong><span>${integrationConfig ? configured ? 'Configurado' : 'Configuração pendente' : 'Verificando…'}</span></div><div class="settings-integration-row"><strong>E-mail</strong><span>Envio depende da configuração do Resend no servidor</span></div></section>`;
  }

  function paint() {
    container.innerHTML = `<div class="settings-page"><header class="page-heading"><div><p class="page-kicker">Sua experiência</p><h1 class="page-title">Configurações</h1><p class="page-description">Atualize seus dados e escolha como prefere usar o portal.</p></div></header><nav class="settings-tabs" role="tablist" aria-label="Seções de configurações">${allTabs.map(([key,label]) => `<button id="settings-tab-${key}" class="settings-tab ${active === key ? 'active' : ''}" type="button" role="tab" tabindex="${active === key ? 0 : -1}" aria-selected="${active === key}" aria-controls="settings-panel" data-tab="${key}">${label}</button>`).join('')}</nav>${panel()}</div>`;
  }

  async function updatePreferences(form) {
    const prefs = { ...current.preferences };
    if (active === 'appearance') { prefs.theme = form.elements.theme.value; prefs.accent = form.elements.accent.value; }
    if (active === 'notifications') prefs.emailNotifications = form.elements.emailNotifications.checked;
    if (active === 'accessibility') { prefs.fontScale = Number(form.elements.fontScale.value); prefs.reducedMotion = form.elements.reducedMotion.checked; }
    current = await saveProfile(ctx, { preferences: prefs }, 'Preferências salvas.');
    paint();
  }

  container.onclick = async event => {
    const tab = event.target.closest('[data-tab]');
    if (tab && container.contains(tab)) {
      active = tab.dataset.tab;
      paint();
      container.querySelector(`#settings-tab-${active}`)?.focus();
      if (active === 'integrations' && !integrationConfig && !loadingIntegration) {
        loadingIntegration = true;
        try { integrationConfig = await ctx.api('/api/config'); }
        catch (problem) { ctx.ui.toast(problem.message || 'Não foi possível consultar as integrações.', 'error'); }
        finally { loadingIntegration = false; if (active === 'integrations') paint(); }
      }
      return;
    }
    if (event.target.closest('[data-action="reset-password"]')) {
      try { await ctx.auth.resetPassword(current.email); ctx.ui.toast('Solicitação de recuperação enviada. Confira seu e-mail.'); }
      catch (problem) { ctx.ui.toast(problem.message, 'error'); }
    }
  };
  container.onkeydown = event => {
    const tab = event.target.closest('[data-tab]');
    if (!tab || !container.contains(tab)) return;
    const index = allTabs.findIndex(([key]) => key === tab.dataset.tab);
    const next = event.key === 'ArrowRight' ? (index + 1) % allTabs.length : event.key === 'ArrowLeft' ? (index - 1 + allTabs.length) % allTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? allTabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    container.querySelector(`#settings-tab-${allTabs[next][0]}`)?.click();
  };
  container.onchange = event => {
    if (event.target.id === 'settings-photo') {
      const file = event.target.files?.[0];
      const label = container.querySelector('#settings-file-name');
      if (label) label.textContent = file ? file.name : '';
    }
  };
  container.onsubmit = async event => {
    const form = event.target;
    if (!['settings-profile-form', 'settings-preferences-form', 'settings-password-form'].includes(form.id)) return;
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      if (form.id === 'settings-profile-form') {
        const name = form.elements.name.value.trim();
        if (!name) throw new Error('Informe seu nome.');
        const file = container.querySelector('#settings-photo')?.files?.[0];
        const body = { name };
        if (file) {
          if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) throw new Error('Escolha PNG, JPEG ou WebP de até 5 MB.');
          const upload = await ctx.api.upload(file, 'image');
          body.photoPath = upload.path;
        }
        current = await saveProfile(ctx, body, 'Perfil atualizado.');
        paint();
      } else if (form.id === 'settings-preferences-form') await updatePreferences(form);
      else {
        await ctx.auth.changePassword(form.elements.oldPassword.value, form.elements.newPassword.value);
        form.reset();
        ctx.ui.toast('Senha atualizada.');
      }
    } catch (problem) { ctx.ui.toast(problem?.message || 'Não foi possível salvar.', 'error'); }
    finally { if (button.isConnected) button.disabled = false; }
  };
  paint();
}
