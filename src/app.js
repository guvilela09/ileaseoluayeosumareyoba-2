import './styles.css';
import './features/notifications.css';
import {createApi} from './lib/api.js';
import {shouldPreserveModalOnSessionSync,shouldSyncSessionForAuthEvent} from './lib/auth-events.js';
import {ui} from './lib/ui.js';
import {mountAssistant} from './lib/assistant.js';
import {notificationMarkup} from './lib/notifications.js';
import {render as dashboard} from './features/dashboard.js';
import {render as lists} from './features/lists.js';
import {render as agenda} from './features/agenda.js';
import {render as announcements} from './features/announcements.js';
import {render as culture} from './features/culture.js';
import {render as location} from './features/location.js';
import {render as about} from './features/about.js';
import {render as users} from './features/users.js';
import {render as settings} from './features/settings.js';

const routes={dashboard,lists,agenda,announcements,orixas:culture,members:culture,location,about,users,settings};
const navigation=[['dashboard','Dashboard','home'],['lists','Lista Bori & Ebó','list'],['agenda','Agenda','calendar',true],['announcements','Comunicados','bell',true],['orixas','Itáns e Orixás','book'],['location','Localização','location'],['about','Quem somos nós','user'],['members','Ilé Asé','users'],['users','Usuários','users',true],['settings','Configurações','settings']];
const adminRoutes=new Set(['agenda','announcements','users']);
const app=document.querySelector('#app');
let config,auth,api,user,state,assistant,pollTimer,authUnsubscribe,routeCleanup,sessionVersion=0,notificationOpen=false;
const systemTheme=window.matchMedia('(prefers-color-scheme:dark)');

function applyPreferences() {
  const p=user?.preferences||{};
  document.documentElement.dataset.theme=p.theme==='dark'||(p.theme==='system'&&systemTheme.matches)?'dark':'light';
  document.documentElement.dataset.accent=p.accent||'copper';
  document.documentElement.dataset.reducedMotion=String(Boolean(p.reducedMotion));
  document.documentElement.style.setProperty('--font-scale',String([1,1.1,1.2].includes(Number(p.fontScale))?Number(p.fontScale):1));
}
systemTheme.addEventListener('change',applyPreferences);
const navigate=path=>{notificationOpen=false;updateNotificationControl();window.location.hash=`/${path}`;};
function avatar(person,className=''){return person.photoUrl?`<img class="user-avatar ${className}" src="${ui.escape(person.photoUrl)}" alt="Foto de ${ui.escape(person.name)}">`:`<span class="user-avatar ${className}" aria-hidden="true">${ui.escape((person.name||'U').slice(0,1).toUpperCase())}</span>`;}
function updateNotificationControl(){const control=document.querySelector('[data-notification-control]');if(control)control.innerHTML=notificationMarkup(ui,state?.users,user?.role==='admin',notificationOpen);}

function renderLogin(errorMessage='') {
  cleanupPortal();
  applyPreferences();
  const ready=config?.configured&&config.mode==='supabase';
  app.innerHTML=`<main class="login-page" id="page-content"><section class="login-brand-panel"><img class="login-logo" src="/assets/logo.png" alt="Logo do Ilé Asé"><h1>Ilé Asé Oluaye<br>Osumare Yoba</h1><p>Nosso espaço de encontro, memória e cuidado com a comunidade.</p></section><section class="login-form-panel"><div class="login-card"><p class="page-kicker">Bem-vindo à nossa casa</p><h2>Entre no seu espaço.</h2><p>Os conteúdos da casa são reservados aos membros aprovados.</p><button class="btn btn-secondary" type="button" id="google-login" ${ready?'':'disabled'}><span aria-hidden="true">G</span> Continuar com Google</button><div class="login-divider">ou use seu e-mail</div><form id="login-form"><label class="form-field">E-mail<input name="email" type="email" autocomplete="username" placeholder="seuemail@exemplo.com" required ${ready?'':'disabled'}></label><label class="form-field">Senha<input name="password" type="password" minlength="8" autocomplete="current-password" placeholder="Sua senha" required ${ready?'':'disabled'}></label><p class="auth-error" role="alert">${ui.escape(errorMessage)}</p><button class="btn btn-primary" type="submit" ${ready?'':'disabled'}>Entrar ${ui.icon('arrow')}</button></form><div class="login-links"><button class="link-button" id="register-account" type="button" ${ready?'':'disabled'}>Solicitar acesso</button><button class="link-button" id="forgot-password" type="button" ${ready?'':'disabled'}>Esqueci minha senha</button></div>${!ready?'<div class="login-notice"><strong>Aguardando configuração da casa</strong><p>O responsável precisa conectar o Supabase para liberar o acesso. Nenhum cadastro foi criado automaticamente.</p></div>':''}</div></section></main>`;
  document.querySelector('#google-login').addEventListener('click',async()=>{try{await auth.loginGoogle();}catch(error){ui.toast(error.message,'error');}});
  document.querySelector('#login-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('[type=submit]');button.disabled=true;const data=new FormData(event.currentTarget);try{await auth.loginEmail(data.get('email'),data.get('password'));}catch(error){ui.toast(error.message,'error');button.disabled=false;}});
  document.querySelector('#forgot-password').addEventListener('click',()=>ui.openModal({title:'Recuperar senha',submitLabel:'Enviar orientação',body:'<label class="form-field">E-mail da conta<input name="email" type="email" required autocomplete="email"></label><p class="form-note">Para contas Google, recupere a senha no Google.</p>',onSubmit:async(form,modal)=>{await auth.resetPassword(form.elements.email.value);modal.close();ui.toast('Se houver uma conta com senha para este e-mail, você receberá as orientações.');}}));
  document.querySelector('#register-account').addEventListener('click',()=>ui.openModal({title:'Solicitar acesso',submitLabel:'Criar conta e solicitar acesso',body:'<label class="form-field">Seu nome<input name="name" required maxlength="120" autocomplete="name"></label><label class="form-field">E-mail<input name="email" type="email" required autocomplete="email"></label><label class="form-field">Senha<input name="password" type="password" minlength="8" required autocomplete="new-password"></label><p class="form-note">Confirme seu e-mail e aguarde a aprovação dos administradores.</p>',onSubmit:async(form,modal)=>{await auth.register(form.elements.email.value,form.elements.password.value,form.elements.name.value);modal.close();await syncSession();}}));
}

function renderPasswordRecovery(){
  ui.openModal({title:'Definir nova senha',submitLabel:'Salvar nova senha',body:'<p>Escolha uma nova senha para sua conta. Use pelo menos 8 caracteres.</p><label class="form-field">Nova senha<input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label class="form-field">Repita a nova senha<input name="confirmPassword" type="password" minlength="8" autocomplete="new-password" required></label>',onSubmit:async(form,modal)=>{
    const password=form.elements.password.value;
    if(password!==form.elements.confirmPassword.value)throw new Error('As senhas não conferem.');
    await auth.setNewPassword(password);
    modal.close();
    ui.toast('Senha redefinida. Seu acesso será verificado.');
    await syncSession();
  }});
}

function renderPending(){
  cleanupPortal();applyPreferences();
  const blocked=user.status==='blocked';
  app.innerHTML=`<main class="pending-page" id="page-content"><section class="card pending-card"><img src="/assets/logo.png" alt="Logo do Ilé Asé"><p class="page-kicker">Olá, ${ui.escape(user.name)}</p><h1>${blocked?'Acesso indisponível':'Seu acesso está sendo preparado'}</h1><p>${blocked?'Converse com os administradores da casa para verificar seu acesso.':'Confirme seu e-mail, se necessário, e aguarde a aprovação de um administrador. Seus dados estão protegidos enquanto isso.'}</p><button class="btn btn-primary" type="button" id="check-approval">Verificar aprovação</button><button class="btn btn-secondary" type="button" id="pending-logout">Sair</button></section></main>`;
  document.querySelector('#check-approval').addEventListener('click',()=>syncSession().catch(error=>ui.toast(error.message,'error')));
  document.querySelector('#pending-logout').addEventListener('click',logout);
}

function cleanupPortal(){routeCleanup?.();routeCleanup=null;assistant?.dispose();assistant=null;clearInterval(pollTimer);Promise.resolve(auth?.stopPresence?.()).catch(()=>{});document.querySelectorAll('dialog').forEach(dialog=>{dialog.close();dialog.remove();});}
async function logout(){++sessionVersion;cleanupPortal();await auth.logout();user=null;state=null;renderLogin();}
function renderShell(){
  const nav=navigation.filter(item=>!item[3]||user.role==='admin');
  app.innerHTML=`<div class="portal-shell"><div class="sidebar-overlay"></div><aside class="sidebar" aria-label="Menu principal"><a class="brand" href="#/dashboard"><img class="brand-logo" src="/assets/logo.png" alt="Logo da casa"><span class="brand-name">Ilé Asé<span class="brand-subtitle">Oluaye Osumare Yoba</span></span></a><div class="nav-caption">Nosso espaço</div><nav>${nav.map(([route,label,ic])=>`<a class="nav-item" data-nav="${route}" href="#/${route}">${ui.icon(ic)}<span>${label}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="house-note"><strong>Uma casa, muitas histórias.</strong>Nosso espaço de cuidado e memória.</div><div class="sidebar-profile">${avatar(user)}<div class="profile-label"><strong>${ui.escape(user.name)}</strong><span>${user.role==='admin'?'Administrador':'Membro da casa'}</span></div><button class="btn btn-icon" type="button" data-logout aria-label="Sair do sistema">${ui.icon('logout')}</button></div></div></aside><div class="portal-main"><header class="topbar"><div class="topbar-left"><button class="btn btn-icon menu-toggle" type="button" aria-label="Abrir menu" aria-expanded="false">${ui.icon('menu')}</button><div class="breadcrumb"><span class="breadcrumb-house">Ilé Asé</span><span aria-hidden="true">/</span><strong id="current-section">Dashboard</strong></div></div><div class="topbar-actions"><span class="member-label">${user.role==='admin'?'Administração da casa':'Espaço do membro'}</span><div data-notification-control></div><button class="btn btn-icon" type="button" data-profile aria-label="Abrir meu perfil">${avatar(user)}</button></div></header><main class="page-content" id="page-content" tabindex="-1"></main></div></div>`;
  updateNotificationControl();
  document.querySelector('[data-logout]').addEventListener('click',logout);
  const topbarActions=document.querySelector('.topbar-actions');
  topbarActions.addEventListener('click',event=>{
    if(event.target.closest('[data-notifications-toggle]')){notificationOpen=!notificationOpen;updateNotificationControl();return;}
    if(event.target.closest('[data-notification-link]')){notificationOpen=false;updateNotificationControl();return;}
    if(event.target.closest('[data-dashboard]'))navigate('dashboard');
  });
  topbarActions.addEventListener('keydown',event=>{if(event.key==='Escape'&&notificationOpen){notificationOpen=false;updateNotificationControl();topbarActions.querySelector('[data-notifications-toggle]')?.focus();}});
  document.querySelector('[data-profile]').addEventListener('click',()=>navigate('settings'));
  const menu=document.querySelector('.menu-toggle'),sidebar=document.querySelector('.sidebar'),overlay=document.querySelector('.sidebar-overlay');
  const toggleMenu=enabled=>{sidebar.classList.toggle('open',enabled);overlay.classList.toggle('open',enabled);menu.setAttribute('aria-expanded',String(enabled));};
  menu.addEventListener('click',()=>toggleMenu(!sidebar.classList.contains('open')));overlay.addEventListener('click',()=>toggleMenu(false));
  sidebar.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>toggleMenu(false)));
  assistant=mountAssistant(document.querySelector('#assistant-root'),{api,navigate});
}

async function renderRoute(){
  if(!user||user.status!=='approved'||!state)return;
  let route=window.location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);if(!route.length)route=['dashboard'];
  if(!routes[route[0]]||(adminRoutes.has(route[0])&&user.role!=='admin')){navigate('dashboard');return;}
  const container=document.querySelector('#page-content');if(!container)return;
  routeCleanup?.();routeCleanup=null;
  container.onclick=null;
  document.querySelectorAll('[data-nav]').forEach(link=>{const active=link.dataset.nav===route[0];link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.querySelector('#current-section').textContent=navigation.find(item=>item[0]===route[0])?.[1]||'Dashboard';
  const ctx={user,state,api,ui,auth,navigate,refresh:()=>refresh(true),route,config,onUserUpdated:updated=>{user=updated;applyPreferences();}};
  try{const cleanup=await routes[route[0]](container,ctx);if(typeof cleanup==='function')routeCleanup=cleanup;}catch(error){container.innerHTML=ui.empty('Não foi possível abrir esta tela',error.message);}
}
async function refresh(forceRender=false){
  const version=sessionVersion;
  const session=await api('/api/session');if(version!==sessionVersion)return;user=session.user;applyPreferences();
  if(user.status!=='approved'){renderPending();return;}
  const data=await api('/api/bootstrap');if(version!==sessionVersion)return;state=data;
  updateNotificationControl();
  const currentRoute=window.location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
  if(!forceRender&&['orixas','members'].includes(currentRoute[0])&&currentRoute[1])return;
  // Role changes must update the navigation as well as the current route.
  const expected=navigation.filter(item=>!item[3]||user.role==='admin').length;
  if(document.querySelectorAll('[data-nav]').length!==expected){cleanupPortal();renderShell();startUpdates();}
  await renderRoute();
}
function startUpdates(){
  auth?.startPresence?.(user).catch(()=>{});
  pollTimer=setInterval(async()=>{if(document.hidden||document.querySelector('#modal-root dialog')||window.location.hash.startsWith('#/settings'))return;try{await refresh();}catch(error){if(error.status===401||error.status===403)await syncSession();}},30000);
}
async function syncSession(){
  const version=++sessionVersion;
  const previousUser=user;
  const openModal=document.querySelector('#modal-root dialog');
  const token=await auth?.getToken();
  if(!token){user=null;renderLogin();return;}
  try{
    const session=await api('/api/session');if(version!==sessionVersion)return;const nextUser=session.user;
    if(nextUser.status!=='approved'){user=nextUser;applyPreferences();renderPending();return;}
    const data=await api('/api/bootstrap');if(version!==sessionVersion)return;
    if(shouldPreserveModalOnSessionSync(previousUser,nextUser,openModal?.isConnected)){user=nextUser;state=data;applyPreferences();updateNotificationControl();return;}
    user=nextUser;applyPreferences();state=data;notificationOpen=false;
    cleanupPortal();renderShell();startUpdates();await renderRoute();
  }catch(error){if(version!==sessionVersion)return;renderLogin(error.message);}
}
window.addEventListener('hashchange',renderRoute);
async function init(){
  try{
    const response=await fetch('/api/config',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('O servidor está indisponível. Tente novamente em instantes.');config=await response.json();
    if(config.mode==='supabase'&&config.configured){const {createAuth}=await import('./lib/auth.js');auth=createAuth(config);api=createApi(()=>auth.getToken(),auth);authUnsubscribe=auth.subscribe((currentUser,event)=>{if(event==='PASSWORD_RECOVERY')renderPasswordRecovery();else if(shouldSyncSessionForAuthEvent(event,currentUser?.id,user?.id))syncSession();});}
    else{auth=null;api=createApi(async()=>null,null);renderLogin();}
  }catch(error){app.innerHTML=`<main class="pending-page" id="page-content"><section class="card pending-card"><h1>Seu espaço está sendo preparado.</h1><p>${ui.escape(error.message)}</p><button class="btn btn-primary" type="button" id="retry-init">Tentar novamente</button></section></main>`;document.querySelector('#retry-init').addEventListener('click',init);}
}
init();
