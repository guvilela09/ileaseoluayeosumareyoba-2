import Quill from 'quill';
import DOMPurify from 'dompurify';
import 'quill/dist/quill.snow.css';
import {deltaToHTML} from './rich.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const paths = {
  home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
  list:'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  book:'M12 5v16M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1',
  location:'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  user:'M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  users:'M16 21v-2a5 5 0 0 0-10 0v2m16 0v-2a5 5 0 0 0-4-5M15 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0m3-3a4 4 0 0 1 0 8',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z',
  plus:'M12 5v14M5 12h14',edit:'m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5',
  check:'m5 12 4 4L20 5',close:'m6 6 12 12M6 18 18 6',
  arrow:'M4 12h16m-6-6 6 6-6 6',chevron:'m9 5 7 7-7 7',
  upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  music:'M9 18V5l12-3v13M9 18c0 2-2 3-4 3s-3-1-3-2 2-3 4-3c1 0 3 0 3 2m12-3c0 2-2 3-4 3s-3-1-3-2 2-3 4-3c1 0 3 0 3 2',
  logout:'M9 3H3v18h6M10 12h12m-5-5 5 5-5 5',mail:'M3 5h18v14H3ZM3 5l9 8 9-8',menu:'M3 6h18M3 12h18M3 18h18',
};
export function icon(name) { return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.book}"/></svg>`; }

export function toast(message, type = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  element.textContent = message;
  document.querySelector('#toast-root').append(element);
  window.setTimeout(() => element.remove(), 6000);
}
export function empty(title, description, actionHtml = '') {
  return `<div class="empty-state"><span class="empty-symbol">${icon('book')}</span><h2>${escape(title)}</h2><p>${escape(description)}</p>${actionHtml}</div>`;
}

export function openModal({ title, body, onSubmit, submitLabel = 'Salvar', wide = false }) {
  const previousFocus = document.activeElement;
  const element = document.createElement('dialog');
  const titleId = `modal-${crypto.randomUUID()}`;
  element.className = `modal ${wide ? 'modal-wide' : ''}`;
  element.setAttribute('aria-labelledby', titleId);
  element.innerHTML = `<form class="modal-form"><header class="modal-header"><h2 id="${titleId}">${escape(title)}</h2><button class="btn btn-icon" type="button" data-modal-close aria-label="Fechar janela">${icon('close')}</button></header><div class="modal-body">${body}<p class="modal-error" role="alert" hidden></p></div><footer class="modal-footer"><button class="btn btn-secondary" type="button" data-modal-close>Cancelar</button><button class="btn btn-primary" type="submit">${escape(submitLabel)}</button></footer></form>`;
  document.querySelector('#modal-root').append(element);
  let submitting = false;
  const modal = {element, close: () => {
    if (!element.isConnected) return;
    element.close(); element.remove();
    if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
  }};
  element.querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click', () => { if (!submitting) modal.close(); }));
  element.addEventListener('cancel', event => { event.preventDefault(); if (!submitting) modal.close(); });
  element.addEventListener('click', event => { if (event.target === element && !submitting) { const r = element.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) modal.close(); } });
  element.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    const submit = element.querySelector('[type="submit"]');
    submit.disabled = true;
    const error = element.querySelector('.modal-error'); error.hidden = true;
    try { await onSubmit?.(event.currentTarget, modal); }
    catch (problem) { error.textContent = problem.message || 'Não foi possível salvar.'; error.hidden = false; }
    finally { submitting = false; submit.disabled = false; }
  });
  element.showModal();
  return modal;
}
export function confirm(message) {
  return new Promise(resolve => {
    const modal = openModal({ title:'Confirmar ação',body:`<p>${escape(message)}</p>`,submitLabel:'Confirmar',onSubmit:()=>{resolve(true);modal.close();} });
    const observer = new MutationObserver(() => {if (!modal.element.isConnected){resolve(false);observer.disconnect();}});
    observer.observe(document.querySelector('#modal-root'),{childList:true});
  });
}

const Font = Quill.import('formats/font'); Font.whitelist = ['sans','serif']; Quill.register(Font,true);
const Size = Quill.import('attributors/style/size'); Size.whitelist = ['14px','16px','18px','20px','24px','32px']; Quill.register(Size,true);
export function editor(element, initial = {ops:[{insert:'\n'}]}) {
  const toolbar = document.createElement('div');
  toolbar.className = 'editor-toolbar';
  toolbar.innerHTML = `<span class="ql-formats"><select class="ql-font" aria-label="Fonte"><option value="sans" selected>Noto Sans</option><option value="serif">Noto Serif</option></select><select class="ql-size" aria-label="Tamanho da fonte"><option value="14px">14</option><option value="16px" selected>16</option><option value="18px">18</option><option value="20px">20</option><option value="24px">24</option><option value="32px">32</option></select><select class="ql-color" aria-label="Cor das letras"><option value="#27211e" selected></option><option value="#a74517"></option><option value="#70533b"></option><option value="#36644b"></option></select></span><span class="ql-formats"><button class="ql-bold" aria-label="Negrito"></button><button class="ql-italic" aria-label="Itálico"></button><button class="ql-underline" aria-label="Sublinhado"></button><button class="ql-list" value="bullet" aria-label="Lista"></button></span>`;
  element.before(toolbar);
  const q = new Quill(element,{theme:'snow',modules:{toolbar},formats:['font','size','color','bold','italic','underline','list'],placeholder:'Escreva o comunicado…'});
  q.setContents(initial?.ops ? initial : {ops:[{insert:'\n'}]});
  q.root.setAttribute('aria-label','Descrição do comunicado'); q.root.setAttribute('role','textbox'); q.root.setAttribute('aria-multiline','true');
  return { getValue:()=>JSON.parse(JSON.stringify(q.getContents())),destroy:()=>{toolbar.remove();q.disable();} };
}
export function rich(delta) {
  return DOMPurify.sanitize(deltaToHTML(delta),{ALLOWED_TAGS:['p','ul','ol','li','span','br','strong','em','u'],ALLOWED_ATTR:['style']});
}

export const ui = {escape,icon,toast,empty,openModal,confirm,editor,rich};
