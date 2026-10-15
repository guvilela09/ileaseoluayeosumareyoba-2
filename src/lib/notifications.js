const escape=(ui,value)=>ui.escape(String(value??''));

export function pendingUsers(users){
  return (Array.isArray(users)?users:[])
    .filter(user=>user?.status==='pending'&&!user.archived)
    .slice()
    .sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||String(a.id||'').localeCompare(String(b.id||'')));
}

export function notificationMarkup(ui,users,isAdmin,open=false){
  if(!isAdmin)return `<button class="btn btn-icon" type="button" data-dashboard aria-label="Ver comunicados e calendário">${ui.icon('bell')}</button>`;
  const pending=pendingUsers(users);
  const count=pending.length;
  const label=`Notificações; ${count} ${count===1?'usuário pendente':'usuários pendentes'}`;
  return `<div class="notification-control"><button class="btn btn-icon notification-trigger" type="button" data-notifications-toggle aria-haspopup="true" aria-expanded="${open?'true':'false'}" aria-label="${escape(ui,label)}" title="${escape(ui,label)}">${ui.icon('bell')}${count?`<span class="notification-count" aria-hidden="true">${count>99?'99+':count}</span>`:''}</button><div class="notification-popover" data-notifications-panel role="region" aria-label="Usuários pendentes" ${open?'':'hidden'}><h2>Usuários pendentes</h2>${count?`<div class="notification-list">${pending.map(user=>`<a class="notification-item" href="#/users/pending" data-notification-link><strong>${escape(ui,user.name||'Sem nome')}</strong><span>${escape(ui,user.email||'Sem e-mail')}</span></a>`).join('')}</div><a class="notification-all" href="#/users/pending" data-notification-link>Revisar ${count===1?'cadastro pendente':`${count} cadastros pendentes`}</a>`:'<p class="notification-empty">Nenhum cadastro aguardando aprovação.</p>'}</div></div>`;
}
