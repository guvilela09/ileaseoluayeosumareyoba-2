begin;

select plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'member@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
update public.profiles set role = 'admin', status = 'approved' where id = '00000000-0000-0000-0000-000000000001';
update public.profiles set status = 'approved' where id = '00000000-0000-0000-0000-000000000002';
reset role;

insert into public.lists (id, title, created_by)
values
  ('10000000-0000-0000-0000-000000000001', 'Lista de teste', '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Lista arquivada', '00000000-0000-0000-0000-000000000001');
update public.lists set archived = true where id = '10000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*)::integer from public.profiles), 1, 'member only sees own profile');
select throws_ok(
  $$update public.profiles set role = 'admin' where id = auth.uid()$$,
  '42501', null, 'member cannot change own role'
);
select throws_ok(
  $$update public.profiles set photo_path = 'uploads/00000000-0000-0000-0000-000000000001/private.pdf' where id = auth.uid()$$,
  '42501', null, 'member cannot bypass server photo ownership checks'
);
select is((select count(*)::integer from public.lists), 1, 'approved member can read shared lists');

insert into public.list_progress (user_id, list_id, checked_items)
values ('00000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '["item-1"]');
select is((select count(*)::integer from public.list_progress), 1, 'member sees own progress');
select throws_ok(
  $$insert into public.list_progress (user_id, list_id, checked_items) values ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '[]')$$,
  '42501', null, 'member cannot write progress for another user'
);
select throws_ok(
  $$insert into public.announcements (title, content, created_by) values ('Denied', '{"ops":[{"insert":"x"}]}', auth.uid())$$,
  '42501', null, 'member cannot write shared content'
);

reset role;
select throws_ok(
  $$update public.profiles set status = 'blocked' where id = '00000000-0000-0000-0000-000000000001'$$,
  'P0001', 'At least one approved administrator must remain', 'cannot demote last approved administrator'
);
select is((select count(*)::integer from storage.buckets where id = 'portal-private' and not public), 1, 'private storage bucket exists');
select is((select relrowsecurity from pg_class where oid = 'public.mail_delivery_jobs'::regclass), true, 'outbox table has RLS enabled');

select * from finish();
rollback;
