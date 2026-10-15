create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  name text not null default 'Novo membro',
  photo_path text not null default '',
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  preferences jsonb not null default '{"theme":"light","accent":"copper","fontScale":1,"reducedMotion":false,"emailNotifications":true}'::jsonb,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  priority text not null default 'normal' check (priority in ('important', 'normal', 'less')),
  content jsonb not null,
  published boolean not null default false,
  published_at timestamptz,
  created_by uuid not null references public.profiles(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  event_date date not null,
  event_time time,
  location text not null default '',
  created_by uuid not null references public.profiles(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  created_by uuid not null references public.profiles(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.list_progress (
  user_id uuid not null references public.profiles(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  checked_items jsonb not null default '[]'::jsonb check (jsonb_typeof(checked_items) = 'array'),
  item_versions jsonb not null default '{}'::jsonb check (jsonb_typeof(item_versions) = 'object'),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, list_id)
);

create table public.orixas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alias text not null default '',
  description text not null default '',
  image_path text not null default '',
  spotify_url text not null default '',
  sort_order integer not null default 99999,
  created_by uuid not null references public.profiles(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  alias text not null default '',
  description text not null default '',
  image_path text not null default '',
  spotify_url text not null default '',
  created_by uuid not null references public.profiles(id),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.site_settings (
  id text primary key check (id = 'config'),
  address text not null default '',
  map_url text not null default '',
  photo_path text not null default '',
  tribute_photo_path text not null default '',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.mail_campaigns (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null unique references public.announcements(id),
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'partial', 'failed')),
  recipient_count integer not null default 0 check (recipient_count >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mail_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mail_campaigns(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id),
  recipient_email text not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'accepted', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  provider_message_id text,
  last_error text not null default '',
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, recipient_id)
);

create table public.uploads (
  path text primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('image', 'import')),
  filename text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check ((kind = 'import' and expires_at is not null) or (kind = 'image' and expires_at is null))
);

create index announcements_published_idx on public.announcements (published_at desc) where published and not archived;
create index events_date_idx on public.events (event_date, event_time) where not archived;
create index lists_created_at_idx on public.lists (created_at desc) where not archived;
create index orixas_order_idx on public.orixas (sort_order, name) where not archived;
create index profiles_status_role_idx on public.profiles (status, role) where not archived;
create index mail_delivery_jobs_dispatch_idx on public.mail_delivery_jobs (next_attempt_at, created_at) where status in ('queued', 'failed');
create index uploads_expiry_idx on public.uploads (expires_at) where expires_at is not null;

create or replace function public.is_approved_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'approved' and not archived
  );
$$;

revoke all on function public.is_approved_admin() from public;
grant execute on function public.is_approved_admin() to authenticated;

create or replace function public.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'approved' and not archived
  );
$$;

revoke all on function public.is_approved_member() from public;
grant execute on function public.is_approved_member() to authenticated;

create or replace function public.prevent_last_admin_demote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  approved_admin_count integer;
begin
  if old.role = 'admin' and old.status = 'approved' and not old.archived
     and (new.role <> 'admin' or new.status <> 'approved' or new.archived) then
    perform pg_advisory_xact_lock(hashtextextended('portal-approved-admins', 0));
    select count(*) into approved_admin_count from public.profiles
      where role = 'admin' and status = 'approved' and not archived;
    if approved_admin_count <= 1 then
      raise exception 'At least one approved administrator must remain';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.prevent_profile_self_promotion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and (new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.archived is distinct from old.archived) then
    raise exception 'Profile access fields are server managed';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_access_fields
before update of role, status, archived on public.profiles
for each row execute function public.prevent_profile_self_promotion();

create trigger profiles_preserve_last_admin
before update of role, status, archived on public.profiles
for each row execute function public.prevent_last_admin_demote();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, photo_path)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'Novo membro'),
    ''
  ) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.touch_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set email = coalesce(new.email, ''), updated_at = now()
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_updated
after update of email on auth.users
for each row execute function public.touch_profile_from_auth();

alter table public.profiles enable row level security;
alter table public.announcements enable row level security;
alter table public.events enable row level security;
alter table public.lists enable row level security;
alter table public.list_progress enable row level security;
alter table public.orixas enable row level security;
alter table public.members enable row level security;
alter table public.site_settings enable row level security;
alter table public.mail_campaigns enable row level security;
alter table public.mail_delivery_jobs enable row level security;
alter table public.uploads enable row level security;

revoke all on public.profiles, public.announcements, public.events, public.lists, public.list_progress,
  public.orixas, public.members, public.site_settings, public.mail_campaigns,
  public.mail_delivery_jobs, public.uploads from anon, authenticated, public;
revoke all on public.profiles, public.announcements, public.events, public.lists, public.list_progress,
  public.orixas, public.members, public.site_settings, public.mail_campaigns,
  public.mail_delivery_jobs, public.uploads from public;

grant usage on schema public to authenticated;

grant select on public.profiles to authenticated;
grant update (name, preferences) on public.profiles to authenticated;
grant select, insert, update, delete on public.announcements, public.events, public.lists,
  public.orixas, public.members, public.site_settings to authenticated;
grant select, insert, update, delete on public.list_progress to authenticated;

create policy profiles_select_self_or_admin on public.profiles
for select to authenticated using (id = (select auth.uid()) or (select public.is_approved_admin()));

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy announcements_read_approved on public.announcements
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived)
  and not archived
  and (published or (select public.is_approved_admin()))
);
create policy announcements_admin_write on public.announcements
for all to authenticated using ((select public.is_approved_admin()))
with check ((select public.is_approved_admin()));

create policy events_read_approved on public.events
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived)
  and not archived
);
create policy events_admin_write on public.events
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));

create policy lists_read_approved on public.lists
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived)
  and not archived
);
create policy lists_admin_write on public.lists
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));

create policy list_progress_read_self on public.list_progress
for select to authenticated using (user_id = (select auth.uid()));
create policy list_progress_write_self on public.list_progress
for all to authenticated using (
  user_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived
  )
) with check (
  user_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived
  )
);

create policy orixas_read_approved on public.orixas
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived)
  and not archived
);
create policy orixas_admin_write on public.orixas
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));

create policy members_read_approved on public.members
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived)
  and not archived
);
create policy members_admin_write on public.members
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));

create policy site_settings_read_approved on public.site_settings
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'approved' and not p.archived)
);
create policy site_settings_admin_write on public.site_settings
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));

create policy uploads_read_owner_or_admin on public.uploads
for select to authenticated using (owner_id = (select auth.uid()) or (select public.is_approved_admin()));
create policy uploads_write_owner_or_admin on public.uploads
for all to authenticated using (
  owner_id = (select auth.uid()) or (select public.is_approved_admin())
) with check (
  owner_id = (select auth.uid()) or (select public.is_approved_admin())
);

create policy campaigns_admin_only on public.mail_campaigns
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));
create policy delivery_jobs_admin_only on public.mail_delivery_jobs
for all to authenticated using ((select public.is_approved_admin())) with check ((select public.is_approved_admin()));

create policy portal_presence_read_approved on realtime.messages
for select to authenticated using (
  extension = 'presence' and (select realtime.topic()) = 'portal-presence'
  and (select public.is_approved_member())
);
create policy portal_presence_track_approved on realtime.messages
for insert to authenticated with check (
  extension = 'presence' and (select realtime.topic()) = 'portal-presence'
  and (select public.is_approved_member())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-private', 'portal-private', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy portal_storage_read_owner_or_admin on storage.objects
for select to authenticated using (
  bucket_id = 'portal-private' and (
    ((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or (select public.is_approved_admin())
  )
);
create policy portal_storage_insert_owner on storage.objects
for insert to authenticated with check (
  bucket_id = 'portal-private' and (storage.foldername(name))[1] = 'uploads'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);
create policy portal_storage_update_owner on storage.objects
for update to authenticated using (
  bucket_id = 'portal-private' and (((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = (select auth.uid())::text) or (select public.is_approved_admin()))
) with check (
  bucket_id = 'portal-private' and (((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = (select auth.uid())::text) or (select public.is_approved_admin()))
);
create policy portal_storage_delete_owner on storage.objects
for delete to authenticated using (
  bucket_id = 'portal-private' and (((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = (select auth.uid())::text) or (select public.is_approved_admin()))
);

create trigger touch_profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_announcements_updated_at before update on public.announcements for each row execute function public.touch_updated_at();
create trigger touch_events_updated_at before update on public.events for each row execute function public.touch_updated_at();
create trigger touch_lists_updated_at before update on public.lists for each row execute function public.touch_updated_at();
create trigger touch_progress_updated_at before update on public.list_progress for each row execute function public.touch_updated_at();
create trigger touch_orixas_updated_at before update on public.orixas for each row execute function public.touch_updated_at();
create trigger touch_members_updated_at before update on public.members for each row execute function public.touch_updated_at();
create trigger touch_site_settings_updated_at before update on public.site_settings for each row execute function public.touch_updated_at();
create trigger touch_mail_campaigns_updated_at before update on public.mail_campaigns for each row execute function public.touch_updated_at();
create trigger touch_mail_jobs_updated_at before update on public.mail_delivery_jobs for each row execute function public.touch_updated_at();
