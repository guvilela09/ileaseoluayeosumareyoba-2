import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from scripts.bootstrap_supabase_admin import BootstrapError, bootstrap_admin

PROJECT_REF = 'xjnkfealkybuwebfiihf'
USER_ID = '00000000-0000-0000-0000-000000000001'
EMAIL = 'owner@example.com'


class FakeCursor:
    def __init__(self, *, admins=0, user=None):
        self.admins, self.user = admins, user
        self.rowcount = 0
        self.last_sql = ''
        self.last_params = None
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        self.last_sql, self.last_params = sql, params
        self.executed.append((sql, params))
        if sql.lstrip().lower().startswith('update public.profiles'):
            self.rowcount = 1

    def fetchone(self):
        sql = self.last_sql.lower()
        if 'count(*)' in sql:
            return (self.admins,)
        if 'from auth.users' in sql:
            return self.user
        return None


class FakeConnection:
    def __init__(self, cursor):
        self.fake_cursor = cursor
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.fake_cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class SupabaseAdminBootstrapTest(unittest.TestCase):
    def setUp(self):
        self.user = (USER_ID, EMAIL, datetime.now(timezone.utc), {'provider': 'google', 'providers': ['google']})
        self.cursor = FakeCursor(user=self.user)
        self.connection = FakeConnection(self.cursor)
        self.connect = lambda *args, **kwargs: self.connection
        self.env = {
            'SUPABASE_URL': f'https://{PROJECT_REF}.supabase.co',
            'SUPABASE_DB_URL': 'postgresql://postgres.xjnkfealkybuwebfiihf:secret@pooler.example:6543/postgres',
        }

    def test_promotes_only_explicit_verified_google_account_and_commits(self):
        result = bootstrap_admin(EMAIL, PROJECT_REF, env=self.env, connect=self.connect)
        self.assertEqual(result, {'id': USER_ID, 'email': EMAIL, 'status': 'approved', 'role': 'admin'})
        self.assertTrue(self.connection.committed)
        self.assertFalse(self.connection.rolled_back)
        update = next(sql for sql, _ in self.cursor.executed if sql.lstrip().lower().startswith('update public.profiles'))
        self.assertIn('role', update.lower())

    def test_refuses_bootstrap_if_an_approved_admin_already_exists(self):
        self.cursor.admins = 1
        with self.assertRaisesRegex(BootstrapError, 'administrador'):
            bootstrap_admin(EMAIL, PROJECT_REF, env=self.env, connect=self.connect)
        self.assertFalse(self.connection.committed)
        self.assertTrue(self.connection.rolled_back)

    def test_requires_google_provider_and_verified_email(self):
        self.cursor.user = (USER_ID, EMAIL, None, {'provider': 'email', 'providers': ['email']})
        with self.assertRaisesRegex(BootstrapError, 'Google'):
            bootstrap_admin(EMAIL, PROJECT_REF, env=self.env, connect=self.connect)
        self.assertTrue(self.connection.rolled_back)

    def test_refuses_mismatched_project_reference_before_connecting(self):
        with self.assertRaisesRegex(BootstrapError, 'referência'):
            bootstrap_admin(EMAIL, 'wrongprojectref', env=self.env, connect=lambda *_a, **_k: self.fail('must not connect'))

    def test_refuses_database_password_placeholder_before_connecting(self):
        self.env['SUPABASE_DB_URL'] = 'postgresql://postgres.xjnkfealkybuwebfiihf:[YOUR-PASSWORD]@pooler.example:6543/postgres'
        with self.assertRaisesRegex(BootstrapError, 'SUPABASE_DB_URL'):
            bootstrap_admin(EMAIL, PROJECT_REF, env=self.env, connect=lambda *_a, **_k: self.fail('must not connect'))


if __name__ == '__main__':
    unittest.main()
