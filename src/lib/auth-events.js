const SESSION_SYNC_EVENTS = new Set(['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','USER_UPDATED']);

export function shouldSyncSessionForAuthEvent(event, authUserId, portalUserId) {
  if (event === 'SIGNED_OUT') return true;
  if (event === 'USER_UPDATED') return true;
  if (!SESSION_SYNC_EVENTS.has(event)) return false;
  return !authUserId || authUserId !== portalUserId;
}

export function shouldPreserveModalOnSessionSync(currentUser, nextUser, modalOpen) {
  return Boolean(modalOpen && currentUser?.id && currentUser.id === nextUser?.id &&
    currentUser.status === 'approved' && nextUser.status === 'approved' &&
    currentUser.role === nextUser.role);
}
