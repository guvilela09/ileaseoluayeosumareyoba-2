export function bindModalCloseControls(element, close, isBlocked = () => false) {
  element.querySelectorAll('[data-modal-close]').forEach(button => button.addEventListener('click', () => {
    if (!isBlocked()) close();
  }));
  element.addEventListener('cancel', event => event.preventDefault());
}

export function keepModalOpenOnUnexpectedClose(element, reopen) {
  let explicitlyClosed = false;
  element.addEventListener('close', () => {
    if (explicitlyClosed || !element.isConnected || element.open) return;
    reopen();
  });
  return () => { explicitlyClosed = true; };
}

export function followVisualViewport(element, viewport = globalThis.visualViewport) {
  if (!viewport) return () => {};
  const update = () => {
    element.style.setProperty('--modal-viewport-height', `${viewport.height}px`);
    element.style.setProperty('--modal-viewport-offset-top', `${viewport.offsetTop}px`);
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  };
}
