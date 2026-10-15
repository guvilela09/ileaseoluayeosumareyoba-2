import './content.css';

const dayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function currentDate() {
  const p = todayInSaoPaulo();
  return `${p.year}-${p.month}-${p.day}`;
}

function eventDate(item) {
  const [year, month, day] = String(item.date || '').split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function sorted(items) {
  return [...items].sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`));
}

function editEvent(ctx, item) {
  const e = ctx.ui.escape;
  const modal = ctx.ui.openModal({
    title: item ? 'Editar compromisso' : 'Novo compromisso',
    submitLabel: item ? 'Salvar alterações' : 'Adicionar à agenda',
    body: `<div class="content-form-stack">
      <label class="form-field"><span>Título</span><input name="title" required maxlength="160" value="${e(item?.title || '')}" placeholder="Nome do compromisso"></label>
      <label class="form-field"><span>Descrição</span><textarea name="description" rows="4" maxlength="2000" placeholder="Informações para os membros">${e(item?.description || '')}</textarea></label>
      <div class="field-grid"><label class="form-field"><span>Data</span><input name="date" type="date" required value="${e(item?.date || currentDate())}"></label>
      <label class="form-field"><span>Horário</span><input name="time" type="time" required value="${e(item?.time || '09:00')}"></label></div>
      <label class="form-field"><span>Local (opcional)</span><input name="location" maxlength="200" value="${e(item?.location || '')}" placeholder="Onde será realizado"></label>
      <p class="content-form-note">Datas e horários são exibidos no fuso de São Paulo.</p>
    </div>`,
    onSubmit: async form => {
      const value = name => form.querySelector(`[name="${name}"]`).value.trim();
      const body = { title: value('title'), description: value('description'), date: value('date'), time: value('time'), location: value('location') };
      if (!body.title || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || !/^\d{2}:\d{2}$/.test(body.time)) {
        ctx.ui.toast('Informe título, data e horário válidos.', 'error'); return;
      }
      try {
        await ctx.api(item ? `/api/events/${encodeURIComponent(item.id)}` : '/api/events', { method: item ? 'PATCH' : 'POST', body });
        modal.close();
        ctx.ui.toast(item ? 'Compromisso atualizado.' : 'Compromisso adicionado à agenda.');
        await ctx.refresh();
      } catch (problem) { ctx.ui.toast(problem?.message || 'Não foi possível salvar o compromisso.', 'error'); }
    }
  });
}

async function archiveEvent(ctx, item) {
  if (!await ctx.ui.confirm(`Arquivar “${item.title}”?`)) return;
  try {
    await ctx.api(`/api/events/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
    ctx.ui.toast('Compromisso arquivado.');
    await ctx.refresh();
  } catch (problem) { ctx.ui.toast(problem?.message || 'Não foi possível arquivar o compromisso.', 'error'); }
}

export async function render(container, ctx) {
  const admin = ctx.user?.role === 'admin';
  const e = ctx.ui.escape;
  const events = sorted((ctx.state?.events || []).filter(item => !item.archived));
  const now = currentDate();
  const upcoming = events.filter(item => item.date >= now);
  const past = events.filter(item => item.date < now).reverse();
  const eventCard = item => `<article class="card content-event-card" data-id="${e(item.id)}">
    <div class="content-date-tile"><span>${e(eventDate(item).toLocaleString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase())}</span><strong>${e(item.date.slice(-2))}</strong></div>
    <div class="content-event-body"><p class="content-event-weekday">${e(dayFormat.format(eventDate(item)))} · ${e(item.time)} · São Paulo</p><h3>${e(item.title)}</h3>${item.description ? `<p>${e(item.description)}</p>` : ''}${item.location ? `<p class="content-event-location">${ctx.ui.icon('location')} ${e(item.location)}</p>` : ''}</div>
    ${admin ? `<div class="content-card-actions"><button type="button" class="btn btn-icon" data-action="edit" aria-label="Editar ${e(item.title)}" title="Editar">${ctx.ui.icon('edit')}</button><button type="button" class="btn btn-icon" data-action="archive" aria-label="Arquivar ${e(item.title)}" title="Arquivar">${ctx.ui.icon('trash')}</button></div>` : ''}
  </article>`;
  container.innerHTML = `<div class="content-page content-agenda"><header class="page-heading content-page-heading"><div><p class="page-kicker">Encontros e compromissos</p><h1 class="page-title">Agenda</h1><p class="page-description">Datas e horários no fuso de São Paulo.</p></div>
    ${admin ? `<button type="button" class="btn btn-primary" data-action="new">${ctx.ui.icon('plus')} Novo compromisso</button>` : ''}</header>
    <section class="content-agenda-section" aria-labelledby="agenda-upcoming"><div class="content-section-heading"><h2 id="agenda-upcoming">Próximos eventos</h2><span>${upcoming.length} ${upcoming.length === 1 ? 'compromisso' : 'compromissos'}</span></div>
      ${upcoming.length ? `<div class="content-event-list">${upcoming.map(eventCard).join('')}</div>` : ctx.ui.empty('Nenhum evento programado', admin ? 'Adicione o primeiro compromisso da agenda.' : 'Novos compromissos aparecerão aqui.')}</section>
    ${past.length ? `<section class="content-agenda-section" aria-labelledby="agenda-past"><div class="content-section-heading"><h2 id="agenda-past">Eventos anteriores</h2></div><div class="content-event-list content-past-events">${past.map(eventCard).join('')}</div></section>` : ''}
  </div>`;
  container.onclick = event => {
    const button = event.target.closest('button[data-action]');
    if (!button || !container.contains(button) || !admin) return;
    if (button.dataset.action === 'new') { editEvent(ctx); return; }
    const item = events.find(entry => entry.id === button.closest('[data-id]')?.dataset.id);
    if (!item) return;
    if (button.dataset.action === 'edit') editEvent(ctx, item);
    if (button.dataset.action === 'archive') archiveEvent(ctx, item);
  };
}
