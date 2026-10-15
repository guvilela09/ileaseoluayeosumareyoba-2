import './content.css';

const priorityNames = { important: 'Importante', normal: 'Normal', less: 'Menos importante' };
const priorityOrder = { important: 0, normal: 1, less: 2 };
const calendarTitle = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
const weekday = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function saoPauloToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateFromIso(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function calendar(month, events, today, ui) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1, 12).getDay();
  const days = new Date(year, monthIndex + 1, 0, 12).getDate();
  const byDay = new Map();
  for (const item of events) {
    if (item.date?.slice(0, 7) !== `${year}-${String(monthIndex + 1).padStart(2, '0')}`) continue;
    const day = Number(item.date.slice(-2));
    byDay.set(day, [...(byDay.get(day) || []), item]);
  }
  const cells = Array.from({ length: first }, () => '<span class="content-calendar-blank" aria-hidden="true"></span>');
  for (let day = 1; day <= days; day++) {
    const iso = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const count = byDay.get(day)?.length || 0;
    const names = (byDay.get(day) || []).map(item => item.title).join(', ');
    cells.push(count ? `<button type="button" data-day="${iso}" class="content-calendar-day is-action ${iso === today ? 'is-today' : ''} has-event" aria-label="${ui.escape(`${day} de ${calendarTitle.format(month).split(' de ')[0]}, ${count} evento${count > 1 ? 's' : ''}: ${names}`)}"><span>${day}</span><i aria-hidden="true"></i></button>`
      : `<div class="content-calendar-day ${iso === today ? 'is-today' : ''}" aria-label="${ui.escape(`${day} de ${calendarTitle.format(month).split(' de ')[0]}, sem eventos`)}"><span>${day}</span></div>`);
  }
  return `<div class="content-calendar"><div class="content-calendar-head"><h3 aria-live="polite">${ui.escape(calendarTitle.format(month))}</h3><div class="content-calendar-arrows"><button type="button" class="btn btn-icon" data-calendar="previous" aria-label="Mês anterior">${ui.icon('chevron')}</button><button type="button" class="btn btn-icon" data-calendar="next" aria-label="Próximo mês">${ui.icon('chevron')}</button></div></div>
    <div class="content-calendar-grid" role="group" aria-label="Calendário de ${ui.escape(calendarTitle.format(month))}">${weekday.map(day => `<strong>${day}</strong>`).join('')}${cells.join('')}</div>
    <p class="content-calendar-key"><span aria-hidden="true"></span> Dia com evento</p></div>`;
}

export async function render(container, ctx) {
  const e = ctx.ui.escape;
  const today = saoPauloToday();
  const name = (ctx.user?.name || '').trim().split(/\s+/)[0] || 'bem-vindo';
  const events = (ctx.state?.events || []).filter(item => !item.archived).sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`));
  const upcoming = events.filter(item => item.date >= today);
  const notices = (ctx.state?.announcements || []).filter(item => item.published && !item.archived)
    .sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
      || String(b.publishedAt || b.updatedAt || '').localeCompare(String(a.publishedAt || a.updatedAt || '')));
  let allNotices = false;
  let allEvents = false;
  const noticeCards = () => (allNotices ? notices : notices.slice(0, 3)).map(item => `<article class="card content-dashboard-notice"><span class="badge content-priority-${e(item.priority)}">${priorityNames[item.priority] || priorityNames.normal}</span><h3>${e(item.title)}</h3><div class="content-rich">${ctx.ui.rich(item.content)}</div><button type="button" class="content-text-button" data-notice="${e(item.id)}">Abrir comunicado ${ctx.ui.icon('arrow')}</button></article>`).join('');
  const eventCards = () => (allEvents ? upcoming : upcoming.slice(0, 4)).map(item => `<li><span class="content-next-date"><strong>${e(item.date.slice(-2))}</strong><small>${e(dateFromIso(item.date).toLocaleString('pt-BR', { month: 'short' }).replace('.', ''))}</small></span><div><h3>${e(item.title)}</h3><p>${e(item.time)} · São Paulo${item.location ? ` · ${e(item.location)}` : ''}</p><button type="button" class="content-text-button" data-event="${e(item.id)}">Ver detalhes</button></div></li>`).join('');
  function readEvent(item) {
    const modal = ctx.ui.openModal({ title: 'Detalhes do evento', submitLabel: 'Fechar', body: `<article class="content-read-detail"><p class="page-kicker">${e(dateFromIso(item.date).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · ${e(item.time)} · São Paulo</p><h3>${e(item.title)}</h3>${item.description ? `<p>${e(item.description)}</p>` : ''}${item.location ? `<p><strong>Local:</strong> ${e(item.location)}</p>` : ''}</article>`, onSubmit: () => modal.close() });
  }
  function readNotice(item) {
    const modal = ctx.ui.openModal({ title: 'Comunicado', submitLabel: 'Fechar', wide: true, body: `<article class="content-read-detail"><span class="badge content-priority-${e(item.priority)}">${priorityNames[item.priority] || priorityNames.normal}</span><h3>${e(item.title)}</h3><div class="content-rich">${ctx.ui.rich(item.content)}</div></article>`, onSubmit: () => modal.close() });
  }
  function readDay(date) {
    const dayEvents = events.filter(item => item.date === date);
    const modal = ctx.ui.openModal({ title: `Eventos de ${dateFromIso(date).toLocaleDateString('pt-BR')}`, submitLabel: 'Fechar', body: `<div class="content-day-events">${dayEvents.map(item => `<article><h3>${e(item.title)}</h3><p>${e(item.time)} · São Paulo</p>${item.description ? `<p>${e(item.description)}</p>` : ''}${item.location ? `<p><strong>Local:</strong> ${e(item.location)}</p>` : ''}</article>`).join('')}</div>`, onSubmit: () => modal.close() });
  }
  let month = dateFromIso(today);
  month = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const longDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' }).format(new Date());
  container.innerHTML = `<div class="content-page content-dashboard"><header class="content-welcome"><div><p class="page-kicker">${e(longDate)}</p><h1 class="page-title">Olá, ${e(name)}.</h1><p class="page-description">Acompanhe os comunicados e as próximas datas da casa.</p></div><div class="content-welcome-mark" aria-hidden="true">${ctx.ui.icon('home')}</div></header>
    <div class="content-dashboard-grid"><section class="content-dashboard-main" aria-labelledby="dashboard-notices"><div class="content-section-heading"><div><p class="page-kicker">Para acompanhar</p><h2 id="dashboard-notices">Comunicados</h2></div>${ctx.user?.role === 'admin' ? `<button type="button" class="content-text-button" data-route="announcements">Gerenciar ${ctx.ui.icon('arrow')}</button>` : ''}</div>
      ${notices.length ? `<div class="content-dashboard-notices">${noticeCards()}</div>${notices.length > 3 ? `<button type="button" class="content-text-button content-expand" data-action="notices">Ver todos os comunicados</button>` : ''}` : ctx.ui.empty('Sem comunicados publicados', 'Novos avisos aparecerão aqui quando forem publicados.')}
    </section><aside class="content-dashboard-side" aria-label="Agenda resumida"><section class="card content-calendar-card">${calendar(month, events, today, ctx.ui)}</section><section class="content-next-section"><div class="content-section-heading"><h2>Próximos eventos</h2>${ctx.user?.role === 'admin' ? `<button type="button" class="content-text-button" data-route="agenda">Gerenciar ${ctx.ui.icon('arrow')}</button>` : ''}</div>
      ${upcoming.length ? `<ol class="content-next-events">${eventCards()}</ol>${upcoming.length > 4 ? `<button type="button" class="content-text-button content-expand" data-action="events">Ver todos os próximos eventos</button>` : ''}` : `<div class="card content-next-empty">Nenhum evento programado.</div>`}</section></aside></div></div>`;
  container.onclick = event => {
    const routeButton = event.target.closest('[data-route]');
    if (routeButton && container.contains(routeButton)) { ctx.navigate(routeButton.dataset.route); return; }
    const noticeButton = event.target.closest('[data-notice]');
    if (noticeButton && container.contains(noticeButton)) { const item = notices.find(entry => entry.id === noticeButton.dataset.notice); if (item) readNotice(item); return; }
    const eventButton = event.target.closest('[data-event]');
    if (eventButton && container.contains(eventButton)) { const item = events.find(entry => entry.id === eventButton.dataset.event); if (item) readEvent(item); return; }
    const dayButton = event.target.closest('[data-day]');
    if (dayButton && container.contains(dayButton)) { readDay(dayButton.dataset.day); return; }
    const actionButton = event.target.closest('[data-action]');
    if (actionButton && container.contains(actionButton)) {
      if (actionButton.dataset.action === 'notices') { allNotices = !allNotices; container.querySelector('.content-dashboard-notices').innerHTML = noticeCards(); actionButton.textContent = allNotices ? 'Mostrar menos comunicados' : 'Ver todos os comunicados'; }
      if (actionButton.dataset.action === 'events') { allEvents = !allEvents; container.querySelector('.content-next-events').innerHTML = eventCards(); actionButton.textContent = allEvents ? 'Mostrar menos eventos' : 'Ver todos os próximos eventos'; }
      return;
    }
    const monthButton = event.target.closest('[data-calendar]');
    if (!monthButton || !container.contains(monthButton)) return;
    month = new Date(month.getFullYear(), month.getMonth() + (monthButton.dataset.calendar === 'next' ? 1 : -1), 1, 12);
    container.querySelector('.content-calendar-card').innerHTML = calendar(month, events, today, ctx.ui);
  };
}
