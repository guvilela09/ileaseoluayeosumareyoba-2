const panel = document.querySelector('#assistant-panel');
const launcher = document.querySelector('#assistant-launcher');
const questionInput = document.querySelector('#chat-question');
const form = document.querySelector('#chat-form');
const messages = document.querySelector('#chat-messages');
const status = document.querySelector('#chat-status');
const sendButton = document.querySelector('#send-question');
const motionButton = document.querySelector('#motion-toggle');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
let lastOpener = launcher;
let sending = false;

function openChat(opener = launcher) {
  lastOpener = opener;
  panel.hidden = false;
  launcher.setAttribute('aria-expanded', 'true');
  questionInput.focus({ preventScroll: true });
}

function closeChat() {
  panel.hidden = true;
  launcher.setAttribute('aria-expanded', 'false');
  lastOpener.focus({ preventScroll: true });
}

launcher.addEventListener('click', () => panel.hidden ? openChat() : closeChat());
document.querySelector('#close-chat').addEventListener('click', closeChat);
document.querySelectorAll('[data-open-chat]').forEach(button => button.addEventListener('click', () => openChat(button)));
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => {
  openChat(button);
  if (sending) return;
  questionInput.value = button.dataset.question;
  form.requestSubmit();
}));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.hidden) closeChat();
});
questionInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!sending) form.requestSubmit();
  }
});

function addMessage(text, speaker) {
  const message = document.createElement('div');
  message.className = `message ${speaker}-message`;
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  message.append(paragraph);
  messages.append(message);
  message.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const question = questionInput.value.trim();
  if (!question || sending) return;
  sending = true;
  sendButton.disabled = true;
  status.textContent = 'Buscando uma orientação…';
  addMessage(question, 'user');
  questionInput.value = '';
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('/api/assistant/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Request failed');
    const result = await response.json();
    if (typeof result.answer !== 'string') throw new Error('Invalid answer');
    addMessage(result.answer, 'assistant');
    status.textContent = '';
  } catch {
    status.textContent = 'Não consegui responder agora. Tente novamente.';
    questionInput.value = question;
  } finally {
    window.clearTimeout(timeout);
    sending = false;
    sendButton.disabled = false;
  }
});

function updateMotionLabel() {
  const reduced = motionPreference.matches && !document.body.classList.contains('motion-enabled');
  const paused = document.body.classList.contains('motion-paused') || reduced;
  motionButton.setAttribute('aria-pressed', String(paused));
  motionButton.textContent = reduced ? 'Ver animação' : paused ? 'Retomar animação' : 'Pausar animação';
}
motionButton.addEventListener('click', () => {
  if (motionPreference.matches) {
    document.body.classList.toggle('motion-enabled');
    document.body.classList.remove('motion-paused');
  } else {
    document.body.classList.toggle('motion-paused');
  }
  updateMotionLabel();
});
motionPreference.addEventListener('change', updateMotionLabel);
updateMotionLabel();
