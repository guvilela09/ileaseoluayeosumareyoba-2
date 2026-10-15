import './assistant.css';
import {icon} from './ui.js';

export const BOT_NAME = 'Mae Oba';

export function mountAssistant(root, {api,navigate}) {
  root.innerHTML = `<section class="oba-panel" id="oba-panel" role="dialog" aria-modal="false" aria-labelledby="oba-title" hidden><header class="oba-header"><img src="/assets/assistant/avatar-happy.png" alt="" width="42" height="42"><div><p>Um apoio para você</p><h2 id="oba-title">${BOT_NAME}</h2></div><button class="btn btn-icon" type="button" data-oba-motion aria-label="Ativar movimentos da Mae Oba" title="Movimentos da personagem">${icon('music')}</button><button class="btn btn-icon" type="button" data-oba-close aria-label="Fechar conversa">${icon('close')}</button></header><div class="oba-log" role="log" aria-live="polite" aria-relevant="additions"><div class="oba-message oba-answer">Olá! Eu sou a Mae Oba. Posso ajudar você a usar as listas, encontrar os comunicados e cuidar do seu perfil. Como posso ajudar?</div></div><div class="oba-questions"><button type="button" data-question="Como usar as listas?">Usar as listas</button><button type="button" data-question="Como mudar o tema?">Mudar aparência</button></div><p class="oba-status" role="status"></p><form class="oba-form"><label class="sr-only" for="oba-question">Sua pergunta para a Mae Oba</label><textarea id="oba-question" maxlength="500" rows="2" placeholder="Pergunte à Mae Oba…" required></textarea><button class="btn btn-primary" type="submit" aria-label="Enviar pergunta">${icon('arrow')}</button></form><p class="oba-note">Orientações sobre o sistema. Suas ações continuam com você.</p></section><button class="oba-launcher" type="button" aria-label="Conversar com Mae Oba" aria-controls="oba-panel" aria-expanded="false"><span class="oba-portrait"><img src="/assets/assistant/avatar-open.png" alt="Mae Oba, assistente da casa" width="1254" height="1254"><img class="oba-happy" src="/assets/assistant/avatar-happy.png" alt="" aria-hidden="true" width="1254" height="1254"><img class="oba-eyelids" src="/assets/assistant/avatar-closed.png" alt="" aria-hidden="true" width="1254" height="1254"></span><span class="oba-launcher-dot" aria-hidden="true">${icon('bell')}</span></button><span class="oba-name-tag" aria-hidden="true">Mae Oba</span>`;
  const panel=root.querySelector('.oba-panel'), launcher=root.querySelector('.oba-launcher'), input=root.querySelector('textarea'), log=root.querySelector('.oba-log'), status=root.querySelector('.oba-status'), form=root.querySelector('form'), submit=form.querySelector('button');
  let smileTimer, busy=false, request=null, destroyed=false;
  const smile=()=>{root.classList.add('oba-is-happy');clearTimeout(smileTimer);smileTimer=setTimeout(()=>root.classList.remove('oba-is-happy'),2800);};
  const open=()=>{panel.hidden=false;launcher.setAttribute('aria-expanded','true');smile();input.focus({preventScroll:true});};
  const close=()=>{panel.hidden=true;launcher.setAttribute('aria-expanded','false');launcher.focus({preventScroll:true});};
  launcher.addEventListener('click',()=>panel.hidden?open():close());
  root.querySelector('[data-oba-close]').addEventListener('click',close);
  const escape=event=>{if(event.key==='Escape'&&!panel.hidden)close();};
  document.addEventListener('keydown',escape);
  const motion=root.querySelector('[data-oba-motion]');
  const reduced=window.matchMedia('(prefers-reduced-motion:reduce)');
  let manualMotion=null;
  const updateMotion=()=>{
    const active=manualMotion??(!reduced.matches&&document.documentElement.dataset.reducedMotion!=='true');
    root.classList.toggle('oba-motion-enabled',manualMotion===true);
    root.classList.toggle('oba-motion-paused',!active);
    motion.setAttribute('aria-pressed',String(active));
    motion.setAttribute('aria-label',active?'Pausar movimentos da Mae Oba':'Ativar movimentos da Mae Oba');
  };
  motion.addEventListener('click',()=>{
    manualMotion=motion.getAttribute('aria-pressed')!=='true';
    updateMotion();
  });
  const changedMotion=()=>{manualMotion=null;updateMotion();};
  reduced.addEventListener('change',changedMotion);
  const motionObserver=new MutationObserver(records=>{if(records.some(record=>record.oldValue!==document.documentElement.getAttribute('data-reduced-motion')))changedMotion();});
  motionObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-reduced-motion'],attributeOldValue:true});
  updateMotion();
  function message(text,answer){const bubble=document.createElement('div');bubble.className=`oba-message ${answer?'oba-answer':'oba-question'}`;bubble.textContent=text;log.append(bubble);log.scrollTop=log.scrollHeight;}
  form.addEventListener('submit',async event=>{
    event.preventDefault();const question=input.value.trim();if(!question||busy)return;
    busy=true;submit.disabled=true;status.textContent='Mae Oba está buscando uma orientação…';message(question,false);input.value='';
    request=api('/api/assistant/query',{method:'POST',body:{question}});
    try{const result=await request;if(destroyed)return;message(result.answer,true);status.textContent='';smile();}
    catch(error){if(destroyed)return;status.textContent=error.message||'Não consegui responder agora. Tente novamente.';input.value=question;}
    finally{if(!destroyed){busy=false;submit.disabled=false;}request=null;}
  });
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();if(!busy)form.requestSubmit();}});
  root.querySelectorAll('[data-question]').forEach(button=>button.addEventListener('click',()=>{if(!busy){input.value=button.dataset.question;form.requestSubmit();}}));
  return {open,dispose:()=>{destroyed=true;clearTimeout(smileTimer);motionObserver.disconnect();reduced.removeEventListener('change',changedMotion);document.removeEventListener('keydown',escape);root.innerHTML='';}};
}
