import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / 'supabase' / 'migrations'


class SupabaseSchemaContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = '\n'.join(path.read_text(encoding='utf-8') for path in sorted(MIGRATIONS.glob('*.sql'))).lower()

    def test_required_portal_tables_and_columns_exist(self):
        for table in ('profiles', 'announcements', 'events', 'lists', 'list_progress', 'orixas', 'members', 'site_settings', 'mail_campaigns', 'mail_delivery_jobs', 'uploads'):
            with self.subTest(table=table):
                self.assertRegex(self.sql, rf'create table\s+(if not exists\s+)?public\.{table}\b')
        self.assertIn('references auth.users(id)', self.sql)
        self.assertIn('preferences jsonb', self.sql)
        self.assertIn('content jsonb', self.sql)
        self.assertIn('checked_items jsonb', self.sql)

    def test_every_application_table_enables_rls(self):
        for table in ('profiles', 'announcements', 'events', 'lists', 'list_progress', 'orixas', 'members', 'site_settings', 'mail_campaigns', 'mail_delivery_jobs', 'uploads'):
            with self.subTest(table=table):
                self.assertRegex(self.sql, rf'alter table public\.{table}\s+enable row level security')

    def test_role_and_status_are_server_managed_and_progress_is_user_scoped(self):
        self.assertIn('id = (select auth.uid())', self.sql)
        self.assertRegex(self.sql, r'with check\s*\([^;]*user_id\s*=\s*\(select\s+auth\.uid\(\)\)')
        self.assertIn('storage.buckets', self.sql)
        self.assertIn("'portal-private'", self.sql)
        self.assertIn('grant update (name, preferences) on public.profiles to authenticated', self.sql)
        self.assertIn('create policy profiles_update_self on public.profiles', self.sql)
        self.assertRegex(self.sql, r'using\s*\(id = \(select auth\.uid\(\)\)\)\s*with check\s*\(id = \(select auth\.uid\(\)\)\)')
        self.assertNotRegex(self.sql, r'grant\s+[^;]*update\s+on\s+public\.profiles\s+to\s+authenticated')
        self.assertNotRegex(self.sql, r'grant update\s*\([^)]*photo_path[^)]*\) on public\.profiles to authenticated')
        self.assertIn('new.role is distinct from old.role', self.sql)
        self.assertIn('new.status is distinct from old.status', self.sql)

    def test_admin_mutations_are_transactional_and_last_admin_guarded(self):
        self.assertRegex(self.sql, r'create or replace function public\.is_approved_admin\(')
        self.assertRegex(self.sql, r'create or replace function public\.prevent_last_admin_demote\(')
        self.assertIn('for update', self.sql)
        self.assertIn('at least one approved administrator', self.sql)

    def test_private_storage_paths_match_uploads_uid_filename_layout(self):
        self.assertRegex(self.sql, r"foldername\(name\)\)\[1\] = 'uploads'")
        self.assertRegex(self.sql, r'foldername\(name\)\)\[2\] = \(select auth\.uid\(\)\)::text')

    def test_approved_members_cannot_read_archived_content_or_other_progress(self):
        for policy in ('announcements_read_approved', 'events_read_approved', 'lists_read_approved', 'orixas_read_approved', 'members_read_approved'):
            block = self.sql.split('create policy ' + policy, 1)[1].split(';', 1)[0]
            with self.subTest(policy=policy):
                self.assertIn('and not archived', block)
        self.assertIn('create policy list_progress_read_self on public.list_progress\nfor select to authenticated using (user_id = (select auth.uid()))', self.sql)

    def test_presence_channel_requires_approved_auth_user(self):
        self.assertIn('create policy portal_presence_read_approved on realtime.messages', self.sql)
        self.assertIn('create policy portal_presence_track_approved on realtime.messages', self.sql)
        for policy in ('portal_presence_read_approved', 'portal_presence_track_approved'):
            block = self.sql.split('create policy ' + policy, 1)[1].split(';', 1)[0]
            self.assertIn("extension = 'presence'", block)
            self.assertIn("'portal-presence'", block)
            self.assertIn('public.is_approved_member()', block)


if __name__ == '__main__':
    unittest.main()
