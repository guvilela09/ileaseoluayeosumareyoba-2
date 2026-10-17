const SESSION_SYNC_EVENTS = new Set(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','USER_UPDATED']);

export function shouldSyncSessionForAuthEvent(event) {
  return SESSION_SYNC_EVENTS.has(event);
}
