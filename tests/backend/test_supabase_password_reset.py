import unittest
from fastapi import HTTPException

from backend.service import PortalService


ADMIN = {'id': 'admin', 'email': 'admin@example.org', 'role': 'admin', 'status': 'approved'}
MEMBER = {'id': 'member', 'email': 'member@example.org', 'role': 'member', 'status': 'approved'}


class Transaction:
    def __init__(self, users):
        self.users = users

    def get(self, collection, key):
        return self.users.get(key) if collection == 'users' else None

    def all(self, collection):
        return list(self.users.values()) if collection == 'users' else []


class Store:
    def __init__(self, users):
        self.tx = Transaction(users)

    def atomic(self, operation, actor_id=None):
        return operation(self.tx)


class Mailer:
    def __init__(self):
        self.calls = []

    def send_password_recovery(self, email, redirect):
        self.calls.append((email, redirect))


class SupabasePasswordResetTests(unittest.TestCase):
    def setUp(self):
        self.mailer = Mailer()
        self.service = PortalService(
            Store({'admin': ADMIN, 'member': MEMBER}), 'supabase', self.mailer,
            'https://portal.example.org/reset-password',
        )

    def test_admin_reset_sends_link_to_approved_member_without_returning_it(self):
        result = self.service.password_reset('admin', 'member')
        self.assertEqual(result, {'status': 'sent', 'message': 'E-mail de recuperação enviado.'})
        self.assertEqual(self.mailer.calls, [('member@example.org', 'https://portal.example.org/reset-password')])

    def test_pending_member_does_not_receive_recovery_link(self):
        self.service.store.tx.users['member']['status'] = 'pending'
        with self.assertRaises(HTTPException):
            self.service.password_reset('admin', 'member')
        self.assertEqual(self.mailer.calls, [])

    def test_missing_mail_configuration_fails_without_claiming_success(self):
        service = PortalService(self.service.store, 'supabase')
        with self.assertRaises(HTTPException) as raised:
            service.password_reset('admin', 'member')
        self.assertEqual(raised.exception.status_code, 503)


if __name__ == '__main__':
    unittest.main()
