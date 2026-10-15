"""Supabase access-token verification contract, using locally generated keys."""
import unittest
from unittest.mock import patch

try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from fastapi import HTTPException
    import jwt
    from backend.auth import authenticate, verify_supabase_token
    _DEPENDENCY_ERROR = None
except ImportError as dependency_error:
    _DEPENDENCY_ERROR = str(dependency_error)


PROJECT_URL = 'https://sample-project.supabase.co'
ISSUER = PROJECT_URL + '/auth/v1'
NOW = 1_800_000_000


def fixture_key():
    private = ec.generate_private_key(ec.SECP256R1())
    jwk = jwt.algorithms.ECAlgorithm.to_jwk(private.public_key(), as_dict=True)
    jwk.update(kid='key-1', alg='ES256', use='sig')
    return private, jwk


@unittest.skipIf(_DEPENDENCY_ERROR, f'Install project requirements to run JWT tests: {_DEPENDENCY_ERROR}')
class SupabaseJwtTest(unittest.TestCase):
    def setUp(self):
        self.private, self.jwk = fixture_key()
        self.keys = {'keys': [self.jwk]}

    def token(self, **overrides):
        claims = {
            'iss': ISSUER,
            'aud': 'authenticated',
            'sub': 'auth-user-123',
            'iat': NOW - 10,
            'exp': NOW + 300,
        }
        claims.update(overrides)
        return jwt.encode(claims, self.private, algorithm='ES256', headers={'kid': 'key-1'})

    def verify(self, token):
        return verify_supabase_token(
            token, PROJECT_URL,
            jwks_provider=lambda _url: self.keys,
            clock=lambda: NOW,
        )

    def test_accepts_valid_asymmetric_supabase_token(self):
        self.assertEqual(self.verify(self.token())['sub'], 'auth-user-123')

    def test_rejects_invalid_signature(self):
        other = ec.generate_private_key(ec.SECP256R1())
        token = jwt.encode({'iss': ISSUER, 'aud': 'authenticated', 'sub': 'user', 'exp': NOW + 50}, other, algorithm='ES256', headers={'kid': 'key-1'})
        with self.assertRaises(HTTPException):
            self.verify(token)

    def test_rejects_unknown_key_id(self):
        token = jwt.encode({'iss': ISSUER, 'aud': 'authenticated', 'sub': 'user', 'exp': NOW + 50}, self.private, algorithm='ES256', headers={'kid': 'unknown'})
        with self.assertRaises(HTTPException):
            self.verify(token)

    def test_rejects_wrong_issuer_or_audience(self):
        for claims in ({'iss': 'https://another.supabase.co/auth/v1'}, {'aud': 'anon'}):
            with self.subTest(claims=claims), self.assertRaises(HTTPException):
                self.verify(self.token(**claims))

    def test_rejects_expired_or_not_yet_valid_token_using_injected_clock(self):
        for claims in ({'exp': NOW}, {'exp': NOW + 100, 'nbf': NOW + 1}):
            with self.subTest(claims=claims), self.assertRaises(HTTPException):
                self.verify(self.token(**claims))

    def test_rejects_missing_or_empty_subject(self):
        for claims in ({'sub': ''}, {'sub': None}):
            with self.subTest(claims=claims), self.assertRaises(HTTPException):
                self.verify(self.token(**claims))

    def test_rejects_symmetric_or_unapproved_algorithm(self):
        token = jwt.encode({'iss': ISSUER, 'aud': 'authenticated', 'sub': 'user', 'exp': NOW + 50}, 'test-secret-with-at-least-thirty-two-bytes', algorithm='HS256', headers={'kid': 'key-1'})
        with self.assertRaises(HTTPException):
            self.verify(token)

    def test_supabase_authentication_returns_verified_subject_without_firebase(self):
        class Store:
            supabase_url = PROJECT_URL

        with patch('backend.auth.verify_supabase_token', return_value={'sub': '00000000-0000-0000-0000-000000000001'}) as verify:
            uid = authenticate(Store(), 'supabase', 'Bearer signed-token')
        self.assertEqual(uid, '00000000-0000-0000-0000-000000000001')
        verify.assert_called_once_with('signed-token', PROJECT_URL)


if __name__ == '__main__':
    unittest.main()
