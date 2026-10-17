import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldSyncSessionForAuthEvent} from '../../src/lib/auth-events.js';

test('token refresh does not rebuild the portal and discard an open modal',()=>{
  assert.equal(shouldSyncSessionForAuthEvent('TOKEN_REFRESHED'),false);
});

test('meaningful auth changes still synchronize the portal session',()=>{
  for (const event of ['INITIAL_SESSION','SIGNED_IN','SIGNED_OUT','USER_UPDATED']) {
    assert.equal(shouldSyncSessionForAuthEvent(event),true,event);
  }
});
