import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shouldPreserveModalOnSessionSync,shouldSyncSessionForAuthEvent} from '../../src/lib/auth-events.js';

test('auth refresh and same-account resume do not rebuild the portal',()=>{
  assert.equal(shouldSyncSessionForAuthEvent('TOKEN_REFRESHED','u1','u1'),false);
  assert.equal(shouldSyncSessionForAuthEvent('SIGNED_IN','u1','u1'),false);
  assert.equal(shouldSyncSessionForAuthEvent('USER_UPDATED','u1','u1'),true);
});

test('new sign-ins, startup sessions and sign-outs still synchronize the portal',()=>{
  assert.equal(shouldSyncSessionForAuthEvent('INITIAL_SESSION','u1',null),true);
  assert.equal(shouldSyncSessionForAuthEvent('SIGNED_IN','u2','u1'),true);
  assert.equal(shouldSyncSessionForAuthEvent('USER_UPDATED','u2','u1'),true);
  assert.equal(shouldSyncSessionForAuthEvent('SIGNED_OUT',null,'u1'),true);
});

test('a same-user session sync leaves an open editor intact',()=>{
  const current={id:'u1',status:'approved',role:'admin'};
  assert.equal(shouldPreserveModalOnSessionSync(current,{...current},true),true);
  assert.equal(shouldPreserveModalOnSessionSync(current,{...current,role:'member'},true),false);
  assert.equal(shouldPreserveModalOnSessionSync(current,{...current,status:'pending'},true),false);
  assert.equal(shouldPreserveModalOnSessionSync(current,{...current},false),false);
});
