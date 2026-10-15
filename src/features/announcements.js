import './content.css';

const labels = { important: 'Importante', normal: 'Normal', less: 'Menos importante' };
const order = { important: 0, normal: 1, less: 2 };

function sorted(items) {
  return [...items].sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1)
    || String(b.publishedAt || b.updatedAt || '').localeCompare(String(a.publishedAt || a.updatedAt || '')));
}

function plainText(delta) {
  return (delta?.ops || []).map(op => typeof op.insert === 'string' ? op.insert : '').join('').trim();
}

function error(ctx, problem) {
  ctx.ui.toast(problem?.message || 'Não foi possível salvar o comunicado.', 'error');
}

function destroyWhenClosed(modal, editor) {
  const observer = new MutationObserver(() => {
    if (!modal.element.isConnected) {
      observer.disconnect();
      editor.destroy();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function editAnnouncement(ctx, item) {
  const ui = ctx.ui;
  const e = ui.escape;
  const modal = ui.openModal({
    title: item ? 'Editar comunicado' : 'Novo comunicado',
    wide: true,
    submitLabel: item ? 'Salvar alterações' : 'Salvar rascunho',
    body: `<div class="content-form-stack">
      <label class="form-field"><span>Classificação</span>
        <select name="priority" required>
          <option value="important" ${item?.priority === 'important' ? 'selected' : ''}>Importante</option>
          <option value="normal" ${!item || item.priority === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="less" ${item?.priority === 'less' ? 'selected' : ''}>Menos importante</option>
        </select>
      </label>
      <label class="form-field"><span>Título</span><input name="title" required maxlength="160" value="${e(item?.title || '')}" placeholder="Título do comunicado"></label>
      <div class="form-field"><label for="announcement-editor">Mensagem</label><div id="announcement-editor" class="content-editor" aria-label="Mensagem do comunicado"></div></div>
      <p class="content-form-note">${item?.published ? 'Alterações neste comunicado não enviam novos e-mails.' : 'Salve o rascunho e revise antes de publicar.'}</p>
    </div>`,
    onSubmit: async (form) => {
      const title = form.querySelector('[name="title"]').value.trim();
      const priority = form.querySelector('[name="priority"]').value;
      const content = editor.getValue();
      if (!title || !plainText(content)) {
        ui.toast('Informe o título e a mensagem.', 'error');
        return;
      }
      try {
        await ctx.api(item ? `/api/announcements/${encodeURIComponent(item.id)}` : '/api/announcements', {
          method: item ? 'PATCH' : 'POST', body: { title, priority, content }
        });
        modal.close();
        ui.toast(item ? 'Comunicado atualizado.' : 'Rascunho salvo. Revise antes de publicar.');
        await ctx.refresh();
      } catch (problem) { error(ctx, problem); }
    }
  });
  const editor = ui.editor(modal.element.querySelector('#announcement-editor'), item?.content);
  destroyWhenClosed(modal, editor);
}

function previewAnnouncement(ctx, item) {
  const e = ctx.ui.escape;
  const modal = ctx.ui.openModal({
    title: 'Prévia do comunicado',
    wide: true,
    submitLabel: 'Fechar',
    body: `<article class="content-preview">
      <div class="content-preview-meta"><span class="badge content-priority-${e(item.priority)}">${labels[item.priority] || labels.normal}</span><span class="badge">${item.published ? 'Publicado' : 'Rascunho'}</span></div>
      <h2>${e(item.title)}</h2><div class="content-rich">${ctx.ui.rich(item.content)}</div>
      </article>`,
    onSubmit: () => modal.close()
  });
}

async function publishAnnouncement(ctx, item) {
  if (!await ctx.ui.confirm(`Publicar “${item.title}”? O envio de e-mails será solicitado apenas nesta publicação.`)) return;
  try {
    const result = await ctx.api(`/api/announcements/${encodeURIComponent(item.id)}/publish`, { method: 'POST' });
    const status = result?.emailStatus;
    const message = status === 'queued' ? 'Comunicado publicado. E-mails enfileirados para envio.'
      : status === 'preview' ? 'Comunicado publicado na prévia. Nenhum e-mail foi enviado.'
      : status === 'already-published' ? 'O comunicado já estava publicado; nenhum novo envio foi solicitado.'
      : 'Comunicado publicado. Consulte o status de e-mail na administração.';
    ctx.ui.toast(message);
    await ctx.refresh();
  } catch (problem) { error(ctx, problem); }
}

async function archiveAnnouncement(ctx, item) {
  if (!await ctx.ui.confirm(`Arquivar “${item.title}”?`)) return;
  try {
    await ctx.api(`/api/announcements/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    ctx.ui.toast('Comunicado arquivado.');
    await ctx.refresh();
  } catch (problem) { error(ctx, problem); }
}

export async function render(container, ctx) {
  const admin = ctx.user?.role === 'admin';
  const e = ctx.ui.escape;
  const announcements = sorted((ctx.state?.announcements || []).filter(item => !item.archived && (admin || item.published)));
  container.innerHTML = `<div class="content-page content-announcements">
    <header class="page-heading content-page-heading"><div><p class="page-kicker">Mural da casa</p><h1 class="page-title">Comunicados</h1><p class="page-description">Avisos e novidades para a comunidade.</p></div>
    ${admin ? `<button class="btn btn-primary" type="button" data-action="new">${ctx.ui.icon('plus')} Novo comunicado</button>` : ''}</header>
    ${announcements.length ? `<div class="content-announcement-list">${announcements.map(item => `<article class="card content-announcement" data-id="${e(item.id)}">
      <div class="content-announcement-top"><div class="content-meta"><span class="badge content-priority-${e(item.priority)}">${labels[item.priority] || labels.normal}</span>${admin ? `<span class="badge ${item.published ? 'content-published' : 'content-draft'}">${item.published ? 'Publicado' : 'Rascunho'}</span>` : ''}</div>
      ${admin ? `<div class="content-card-actions"><button class="btn btn-icon" type="button" data-action="edit" aria-label="Editar ${e(item.title)}" title="Editar">${ctx.ui.icon('edit')}</button><button class="btn btn-icon" type="button" data-action="archive" aria-label="Arquivar ${e(item.title)}" title="Arquivar">${ctx.ui.icon('trash')}</button></div>` : ''}</div>
      <h2>${e(item.title)}</h2><div class="content-rich">${ctx.ui.rich(item.content)}</div>
      <div class="content-announcement-bottom"><button class="content-text-button" type="button" data-action="preview">Ver prévia ${ctx.ui.icon('arrow')}</button>${admin && !item.published ? `<button class="btn btn-secondary" type="button" data-action="publish">Publicar comunicado</button>` : ''}</div>
    </article>`).join('')}</div>` : ctx.ui.empty(admin ? 'Nenhum comunicado ainda' : 'Nenhum comunicado publicado', admin ? 'Crie um rascunho para começar.' : 'Os comunicados aparecerão aqui quando forem publicados.')}
  </div>`;
  container.onclick = event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !container.contains(button)) return;
    const item = announcements.find(entry => entry.id === button.closest('[data-id]')?.dataset.id);
    const action = button.dataset.action;
    if (action === 'new' && admin) editAnnouncement(ctx);
    if (!item) return;
    if (action === 'preview') previewAnnouncement(ctx, item);
    if (admin && action === 'edit') editAnnouncement(ctx, item);
    if (admin && action === 'publish') publishAnnouncement(ctx, item);
    if (admin && action === 'archive') archiveAnnouncement(ctx, item);
  };
}
