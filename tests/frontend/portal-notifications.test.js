import {test} from 'node:test';
import assert from 'node:assert/strict';
import {notificationMarkup, pendingUsers} from '../../src/lib/notifications.js';

test('pending-user notifications include only unresolved signups, newest first',()=>{
  const users=[
    {id:'old',status:'pending',createdAt:'2026-10-10T10:00:00Z'},
    {id:'approved',status:'approved',createdAt:'2026-10-15T10:00:00Z'},
    {id:'new',status:'pending',createdAt:'2026-10-14T10:00:00Z'},
    {id:'blocked',status:'blocked',createdAt:'2026-10-15T11:00:00Z'},
  ];
  assert.deepEqual(pendingUsers(users).map(user=>user.id),['new','old']);
  assert.deepEqual(pendingUsers([{id:'pending',status:'pending'}]).map(user=>user.id),['pending']);
  assert.deepEqual(pendingUsers(null),[]);
});

test('admin notification panel shows count, escaped pending identities and a review link',()=>{
  const ui={escape:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),icon:()=>'<svg></svg>'};
  const markup=notificationMarkup(ui,[{id:'p1',name:'<Novo>',email:'novo@example.test',status:'pending'}],true,false);
  assert.match(markup,/aria-label="Notificações; 1 usuário pendente"/);
  assert.match(markup,/&lt;Novo&gt;/);
  assert.match(markup,/novo@example\.test/);
  assert.match(markup,/#\/users\/pending/);
  assert.doesNotMatch(notificationMarkup(ui,[{id:'p1',status:'pending'}],false,false),/users\/pending/);
});
