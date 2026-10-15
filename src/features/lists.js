import './lists.css';

const MAX_ITEMS = 1000;
const esc = (ui, value) => ui.escape(String(value ?? ''));

function progressFor(state, id) {
  return state.progress?.[id] || { checked: [], completed: false, versions: {} };
}

function checkedIds(list, progress) {
  const checked = new Set(progress.checked || []);
  return new Set((list.items || []).filter(item => checked.has(item.id) &&
    (progress.versions?.[item.id] == null || Number(progress.versions[item.id]) === Number(item.version))).map(item => item.id));
}

function errorText(error) {
  return error?.message || 'Não foi possível salvar. Tente novamente.';
}

function setError(scope, message) {
  const target = scope.querySelector('[data-list-error]');
  if (target) {
    target.textContent = message || '';
    target.hidden = !message;
  }
}

function setBusy(scope, busy) {
  scope.querySelectorAll('[data-list-action], [type="submit"], [data-import-file], [data-import-sheet], [data-import-column]').forEach(control => { control.disabled = busy; });
}

function listCard(list, ctx) {
  const items = list.items || [];
  const count = checkedIds(list, progressFor(ctx.state, list.id)).size;
  return `<article class="card lists-card">
    <div class="lists-card-copy">
      <span class="lists-count">${count} de ${items.length} itens</span>
      <h2>${esc(ctx.ui, list.title)}</h2>
      ${list.description ? `<p>${esc(ctx.ui, list.description)}</p>` : ''}
    </div>
    <div class="lists-card-actions">
      ${ctx.user.role === 'admin' ? `<button class="btn btn-icon lists-edit" type="button" data-list-edit="${esc(ctx.ui, list.id)}" aria-label="Editar ${esc(ctx.ui, list.title)}">${ctx.ui.icon('edit')}</button>` : ''}
      <button class="btn btn-secondary" type="button" data-list-open="${esc(ctx.ui, list.id)}">Abrir lista ${ctx.ui.icon('arrow')}</button>
    </div>
  </article>`;
}

function overview(container, ctx, lists) {
  container.innerHTML = `<section class="lists-page">
    <div class="page-heading lists-heading"><div><p class="page-kicker">Organização pessoal</p><h1 class="page-title">Lista Bori &amp; Ebó</h1><p class="page-description">Acompanhe seus itens no seu tempo. Suas marcações ficam salvas na sua conta.</p></div>
      ${ctx.user.role === 'admin' ? `<button class="btn btn-primary" type="button" data-list-create>${ctx.ui.icon('plus')} Nova lista</button>` : ''}
    </div>
    ${lists.length ? `<div class="lists-grid">${lists.map(list => listCard(list, ctx)).join('')}</div>` : ctx.ui.empty('Nenhuma lista disponível', ctx.user.role === 'admin' ? 'Crie uma lista para começar.' : 'As listas aparecerão aqui quando forem disponibilizadas.')}
  </section>`;
  container.querySelector('[data-list-create]')?.addEventListener('click', () => openEditor(ctx));
  container.querySelectorAll('[data-list-edit]').forEach(button => button.addEventListener('click', () => openEditor(ctx, lists.find(list => list.id === button.dataset.listEdit))));
  container.querySelectorAll('[data-list-open]').forEach(button => button.addEventListener('click', () => ctx.navigate(`lists/${button.dataset.listOpen}`)));
}

function detail(container, ctx, list) {
  const progress = progressFor(ctx.state, list.id);
  const checked = checkedIds(list, progress);
  const complete = list.items.length > 0 && checked.size === list.items.length;
  container.innerHTML = `<section class="lists-page lists-detail">
    <button class="lists-back" type="button" data-list-back>${ctx.ui.icon('arrow')} Todas as listas</button>
    <div class="page-heading lists-heading"><div><p class="page-kicker">Lista Bori &amp; Ebó</p><h1 class="page-title">${esc(ctx.ui, list.title)}</h1>${list.description ? `<p class="page-description">${esc(ctx.ui, list.description)}</p>` : ''}</div>
      ${ctx.user.role === 'admin' ? `<button class="btn btn-secondary" type="button" data-list-edit-detail>${ctx.ui.icon('edit')} Editar lista</button>` : ''}
    </div>
    <div class="lists-progress"><span>${checked.size} de ${list.items.length} itens marcados</span><progress max="${Math.max(1, list.items.length)}" value="${checked.size}" aria-label="Progresso da lista"></progress></div>
    <div class="card lists-checklist" role="group" aria-label="Itens da lista">${list.items.map((item, index) => `<label class="lists-check-row"><input type="checkbox" data-list-check="${esc(ctx.ui, item.id)}" ${checked.has(item.id) ? 'checked' : ''}><span class="lists-check-box" aria-hidden="true">${ctx.ui.icon('check')}</span><span class="lists-item-number">${String(index + 1).padStart(2, '0')}</span><span class="lists-item-text">${esc(ctx.ui, item.text)}</span></label>`).join('')}</div>
    <div class="lists-footer"><div class="lists-complete" aria-live="polite">${progress.completed && complete ? '<span class="lists-complete-badge">✅ Função Concluir</span>' : complete ? '<button class="btn btn-primary" type="button" data-list-complete>Concluir</button>' : ''}</div>
      ${checked.size || progress.completed ? '<button class="btn btn-secondary" type="button" data-list-reset>Reiniciar minha lista</button>' : ''}</div>
    <p class="lists-inline-error" data-list-error role="alert" hidden></p>
  </section>`;
  container.querySelector('[data-list-back]').addEventListener('click', () => ctx.navigate('lists'));
  container.querySelector('[data-list-edit-detail]')?.addEventListener('click', () => openEditor(ctx, list));
  const view = container.firstElementChild;
  const isCurrentView = () => view?.isConnected && container.firstElementChild === view &&
    window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).join('/') === `lists/${list.id}`;
  let busy = false;
  const update = async (path, body) => {
    if (busy || !isCurrentView()) return;
    busy = true;
    container.querySelectorAll('[data-list-check], [data-list-complete], [data-list-reset]').forEach(el => { el.disabled = true; });
    setError(container, '');
    try {
      const next = await ctx.api(path, { method: path.endsWith('/complete') || path.endsWith('/reset') ? 'POST' : 'PATCH', ...(body ? { body } : {}) });
      ctx.state.progress = { ...(ctx.state.progress || {}), [list.id]: next };
      if (isCurrentView()) detail(container, ctx, list);
    } catch (error) {
      // The server remains authoritative; restore the checkbox after a failed request.
      if (isCurrentView()) {
        detail(container, ctx, list);
        setError(container, errorText(error));
      }
    }
  };
  container.querySelectorAll('[data-list-check]').forEach(input => input.addEventListener('change', () => {
    update(`/api/progress/${encodeURIComponent(list.id)}`, { itemId: input.dataset.listCheck, checked: input.checked });
  }));
  container.querySelector('[data-list-complete]')?.addEventListener('click', () => update(`/api/progress/${encodeURIComponent(list.id)}/complete`));
  container.querySelector('[data-list-reset]')?.addEventListener('click', async () => {
    if (await ctx.ui.confirm('Reiniciar suas marcações desta lista?') && isCurrentView()) update(`/api/progress/${encodeURIComponent(list.id)}/reset`);
  });
}

function rowHtml(ui, item = {}) {
  return `<div class="lists-editor-row" data-list-row ${item.id ? `data-item-id="${esc(ui, item.id)}" data-item-version="${Number(item.version) || 1}"` : ''}>
    <span class="lists-row-handle" aria-hidden="true">⋮⋮</span><input class="lists-row-text" type="text" value="${esc(ui, item.text)}" maxlength="2000" aria-label="Texto do item" placeholder="Descreva um item" required>
    <div class="lists-row-actions"><button class="btn btn-icon" type="button" data-row-up aria-label="Mover item para cima">↑</button><button class="btn btn-icon" type="button" data-row-down aria-label="Mover item para baixo">↓</button><button class="btn btn-icon" type="button" data-row-remove aria-label="Remover item">${ui.icon('trash')}</button></div>
  </div>`;
}

function editorBody(ctx, list) {
  const items = list?.items?.length ? list.items : [{}];
  return `<div class="lists-editor">
    <div class="field-grid"><label class="form-field">Título <input name="title" type="text" maxlength="180" value="${esc(ctx.ui, list?.title)}" required></label>
      <label class="form-field">Descrição <textarea name="description" rows="3" maxlength="2000">${esc(ctx.ui, list?.description)}</textarea></label></div>
    <div class="lists-import card"><div><h3>Importar itens de um arquivo</h3><p>DOCX, XLSX ou PDF com texto, até 10 MB. Revise os itens antes de salvar.</p></div>
      <div class="lists-import-pick"><label class="form-field">Arquivo <input type="file" accept=".docx,.xlsx,.pdf" data-import-file></label><button class="btn btn-secondary" type="button" data-import-upload data-list-action>${ctx.ui.icon('upload')} Extrair itens</button></div>
      <div data-import-options></div><p class="lists-import-status" data-import-status aria-live="polite"></p><div class="lists-import-warnings" data-import-warnings></div></div>
    <div class="lists-editor-top"><div><h3>Itens para revisão</h3><p>Edite, adicione, remova ou reorganize os itens.</p></div><button class="btn btn-secondary" type="button" data-row-add data-list-action>${ctx.ui.icon('plus')} Adicionar item</button></div>
    <div class="lists-editor-rows" data-list-rows>${items.map(item => rowHtml(ctx.ui, item)).join('')}</div>
    <p class="lists-inline-error" data-list-error role="alert" hidden></p>
  </div>`;
}

function openEditor(ctx, list = null) {
  const imported = { path: '', filename: '', sheet: '', columns: [] };
  let importGeneration = 0;
  let importBusy = false;
  const modal = ctx.ui.openModal({ title: list ? 'Editar lista' : 'Nova lista', body: editorBody(ctx, list), submitLabel: list ? 'Salvar alterações' : 'Criar lista', wide: true,
    onSubmit: async (form) => {
      const scope = modal.element;
      const title = form.querySelector('[name="title"]').value.trim();
      const description = form.querySelector('[name="description"]').value.trim();
      const rows = [...scope.querySelectorAll('[data-list-row]')];
      const items = rows.map(row => ({ text: row.querySelector('.lists-row-text').value.trim(), ...(row.dataset.itemId ? { id: row.dataset.itemId, version: Number(row.dataset.itemVersion) || 1 } : {}) }));
      if (!title) { setError(scope, 'Informe o título da lista.'); form.querySelector('[name="title"]').focus(); return; }
      if (!items.length || items.some(item => !item.text) || items.length > MAX_ITEMS) {
        setError(scope, `Mantenha entre 1 e ${MAX_ITEMS} itens com texto.`);
        rows.find(row => !row.querySelector('.lists-row-text').value.trim())?.querySelector('input')?.focus();
        return;
      }
      setError(scope, '');
      const submit = scope.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      try {
        await ctx.api(list ? `/api/lists/${encodeURIComponent(list.id)}` : '/api/lists', { method: list ? 'PATCH' : 'POST', body: { title, description, items } });
        modal.close();
        ctx.ui.toast(list ? 'Lista atualizada.' : 'Lista criada.');
        await ctx.refresh();
      } catch (error) {
        setError(scope, errorText(error));
      } finally {
        if (submit?.isConnected) submit.disabled = false;
      }
    } });
  const scope = modal.element;
  const rows = scope.querySelector('[data-list-rows]');
  scope.querySelector('[data-row-add]').addEventListener('click', () => {
    if (rows.children.length >= MAX_ITEMS) return setError(scope, `Limite de ${MAX_ITEMS} itens.`);
    rows.insertAdjacentHTML('beforeend', rowHtml(ctx.ui));
    rows.lastElementChild.querySelector('input').focus();
    setError(scope, '');
  });
  rows.addEventListener('click', event => {
    const button = event.target.closest('button');
    const row = button?.closest('[data-list-row]');
    if (!row) return;
    if (button.matches('[data-row-remove]')) row.remove();
    if (button.matches('[data-row-up]') && row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
    if (button.matches('[data-row-down]') && row.nextElementSibling) rows.insertBefore(row.nextElementSibling, row);
  });

  const status = scope.querySelector('[data-import-status]');
  const warnings = scope.querySelector('[data-import-warnings]');
  const options = scope.querySelector('[data-import-options]');
  const currentImport = generation => scope.isConnected && generation === importGeneration;
  const showPreview = data => {
    const candidates = (data.items || []).slice(0, MAX_ITEMS);
    rows.innerHTML = candidates.map(item => rowHtml(ctx.ui, item)).join('');
    warnings.innerHTML = (data.warnings || []).map(message => `<p>${esc(ctx.ui, message)}</p>`).join('');
    status.textContent = `${candidates.length} ${candidates.length === 1 ? 'item extraído' : 'itens extraídos'} para revisão.`;
    if (!candidates.length) {
      rows.insertAdjacentHTML('beforeend', rowHtml(ctx.ui));
      status.textContent = 'Nenhum item extraído. Você pode preencher a lista manualmente.';
    }
    if (imported.filename.toLowerCase().endsWith('.xlsx')) {
      const sheets = data.sheets || [];
      const columns = data.columns || [];
      options.innerHTML = `<div class="lists-import-options"><label class="form-field">Aba <select data-import-sheet>${sheets.map(name => `<option value="${esc(ctx.ui, name)}" ${name === imported.sheet ? 'selected' : ''}>${esc(ctx.ui, name)}</option>`).join('')}</select></label>
        <fieldset><legend>Colunas para extrair</legend><div class="lists-columns">${columns.map(col => `<label><input type="checkbox" data-import-column value="${Number(col.index)}" ${imported.columns.includes(Number(col.index)) || (!imported.columns.length && Number(col.index) === 0) ? 'checked' : ''}> ${esc(ctx.ui, col.label)}</label>`).join('')}</div></fieldset></div>`;
      if (!imported.sheet) imported.sheet = sheets[0] || '';
    } else options.innerHTML = '';
  };
  const preview = async generation => {
    if (!imported.path || !currentImport(generation)) return;
    importBusy = true;
    setBusy(scope, true);
    setError(scope, '');
    status.textContent = 'Extraindo itens…';
    try {
      const body = { path: imported.path, filename: imported.filename };
      if (imported.sheet) body.sheet = imported.sheet;
      if (imported.columns.length) body.columns = imported.columns;
      const data = await ctx.api('/api/imports/preview', { method: 'POST', body });
      if (currentImport(generation)) showPreview(data);
    } catch (error) {
      if (currentImport(generation)) {
        status.textContent = '';
        setError(scope, `${errorText(error)} Você pode preencher os itens manualmente.`);
      }
    } finally {
      if (currentImport(generation)) { importBusy = false; setBusy(scope, false); }
    }
  };
  scope.querySelector('[data-import-upload]').addEventListener('click', async () => {
    if (importBusy) return;
    const file = scope.querySelector('[data-import-file]').files?.[0];
    if (!file) return setError(scope, 'Escolha um arquivo DOCX, XLSX ou PDF.');
    if (!/\.(docx|xlsx|pdf)$/i.test(file.name)) return setError(scope, 'Use um arquivo DOCX, XLSX ou PDF.');
    if (file.size > 10 * 1024 * 1024) return setError(scope, 'O arquivo deve ter até 10 MB.');
    const generation = ++importGeneration;
    importBusy = true;
    setBusy(scope, true);
    setError(scope, '');
    status.textContent = 'Enviando arquivo…';
    try {
      const upload = await ctx.api.upload(file, 'import');
      if (!currentImport(generation)) return;
      imported.path = upload.path;
      imported.filename = upload.filename || file.name;
      imported.sheet = '';
      imported.columns = [];
      if (!scope.querySelector('[name="title"]').value.trim()) scope.querySelector('[name="title"]').value = file.name.replace(/\.[^.]+$/, '');
      await preview(generation);
    } catch (error) {
      if (currentImport(generation)) {
        status.textContent = '';
        setError(scope, `${errorText(error)} Você pode preencher os itens manualmente.`);
      }
    } finally {
      if (currentImport(generation)) { importBusy = false; setBusy(scope, false); }
    }
  });
  options.addEventListener('change', async event => {
    if (importBusy || !event.target.matches('[data-import-sheet], [data-import-column]')) return;
    imported.sheet = options.querySelector('[data-import-sheet]')?.value || '';
    imported.columns = event.target.matches('[data-import-sheet]') ? []
      : [...options.querySelectorAll('[data-import-column]:checked')].map(input => Number(input.value));
    if (!event.target.matches('[data-import-sheet]') && !imported.columns.length) {
      setError(scope, 'Escolha ao menos uma coluna.');
      return;
    }
    await preview(++importGeneration);
  });
}

export async function render(container, ctx) {
  const lists = ctx.state.lists || [];
  const id = ctx.route?.[1];
  if (!id) return overview(container, ctx, lists);
  const list = lists.find(entry => entry.id === id);
  if (list) return detail(container, ctx, list);
  container.innerHTML = `<section class="lists-page"><div class="page-heading"><h1 class="page-title">Lista não encontrada</h1></div>${ctx.ui.empty('Lista não encontrada', 'Ela pode ter sido removida ou está indisponível.', '<button class="btn btn-secondary" type="button" data-list-back>Ver listas</button>')}</section>`;
  container.querySelector('[data-list-back]')?.addEventListener('click', () => ctx.navigate('lists'));
}
