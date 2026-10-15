"""Offline contract tests around server-controlled Firebase boundary data."""
import unittest
from fastapi import HTTPException
from backend.store import FirebaseStore
from backend.auth import authorized


class BlobFixture:
    def __init__(self):
        self.metadata = {'firebaseStorageDownloadTokens': 'untrusted-public-token', 'ownerUid': 'untrusted', 'kind': 'image'}
        self.content_type = 'image/png'
        self.size = 100
    def reload(self):
        pass
    def patch(self):
        pass


class BucketFixture:
    def __init__(self, blob):
        self.object = blob
    def blob(self, path):
        if path != 'uploads/member/object.png':
            raise AssertionError('Unexpected object path')
        return self.object


class UserTransaction:
    def get(self, collection, key):
        return {'id': 'member', 'status': 'approved', 'role': 'member', 'emailVerified': False}


class FirebaseBoundaryTest(unittest.TestCase):
    def test_registration_removes_public_token_and_uses_server_ownership(self):
        blob = BlobFixture()
        store = FirebaseStore.__new__(FirebaseStore)
        store.bucket = BucketFixture(blob)
        store.register_object('uploads/member/object.png', 'member', 'image', 'image/png')
        self.assertNotIn('firebaseStorageDownloadTokens', blob.metadata)
        self.assertEqual(blob.metadata['ownerUid'], 'member')
        self.assertEqual(blob.metadata['kind'], 'image')

    def test_unverified_approved_accounts_cannot_read_private_content(self):
        with self.assertRaises(HTTPException) as raised:
            authorized(UserTransaction(), 'member', verified=True)
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(authorized(UserTransaction(), 'member', approved=False)['status'], 'approved')
