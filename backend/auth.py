"""Supabase and Firebase token checks with server-owned privileges."""
import json
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen
from urllib.parse import urlsplit

from fastapi import HTTPException
from .models import DEFAULT_PREFERENCES
from .store import now


_JWKS_CACHE_TTL_SECONDS = 300
_JWKS_CACHE_MAX_ENTRIES = 8
_jwks_cache = {}
_jwks_cache_lock = threading.Lock()


def _fetch_supabase_jwks(url):
    """Fetch and briefly cache a Supabase project's public signing keys."""
    current = time.monotonic()
    with _jwks_cache_lock:
        cached = _jwks_cache.get(url)
        if cached and cached[0] > current:
            return cached[1]
    try:
        with urlopen(url, timeout=5) as response:
            if response.status != 200:
                raise ValueError('JWKS endpoint returned an unsuccessful response')
            payload = json.loads(response.read(1024 * 1024 + 1))
        if not isinstance(payload, dict) or not isinstance(payload.get('keys'), list):
            raise ValueError('Invalid JWKS document')
    except (OSError, URLError, ValueError, json.JSONDecodeError):
        raise HTTPException(401, 'Não foi possível validar a sessão.')
    with _jwks_cache_lock:
        if len(_jwks_cache) >= _JWKS_CACHE_MAX_ENTRIES:
            oldest = min(_jwks_cache, key=lambda key: _jwks_cache[key][0])
            del _jwks_cache[oldest]
        _jwks_cache[url] = (time.monotonic() + _JWKS_CACHE_TTL_SECONDS, payload)
    return payload


def verify_supabase_token(token, project_url, jwks_provider=None, clock=None):
    """Validate a Supabase asymmetric access JWT and return its claims.

    The clock and JWKS provider are injectable so verification tests never
    depend on wall-clock time or a network request.
    """
    import jwt

    try:
        parsed = urlsplit(project_url)
        local_http = parsed.scheme == 'http' and parsed.hostname in ('localhost', '127.0.0.1')
        if (parsed.scheme != 'https' and not local_http) or not parsed.hostname or parsed.path not in ('', '/') or parsed.query or parsed.fragment or parsed.username:
            raise ValueError('Invalid Supabase project URL')
        issuer = project_url.rstrip('/') + '/auth/v1'
        jwks_url = issuer + '/.well-known/jwks.json'
        provider = jwks_provider or _fetch_supabase_jwks
        jwks = provider(jwks_url)
        if not isinstance(jwks, dict) or not isinstance(jwks.get('keys'), list):
            raise ValueError('Invalid JWKS document')
        header = jwt.get_unverified_header(token)
        kid = header.get('kid')
        algorithm = header.get('alg')
        if algorithm not in ('ES256', 'RS256') or not kid:
            raise ValueError('Unsupported JWT signing algorithm')
        candidates = [key for key in jwks['keys'] if isinstance(key, dict) and key.get('kid') == kid]
        if len(candidates) != 1:
            raise ValueError('Signing key not found')
        jwk = candidates[0]
        if jwk.get('use') not in (None, 'sig') or jwk.get('alg') not in (None, algorithm):
            raise ValueError('Signing key cannot verify this algorithm')
        if jwk.get('kty') != ('EC' if algorithm == 'ES256' else 'RSA'):
            raise ValueError('Signing key type does not match algorithm')
        signing_key = jwt.PyJWK.from_dict(jwk, algorithm=algorithm).key
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=[algorithm],
            audience='authenticated',
            issuer=issuer,
            options={
                'verify_exp': False,
                'verify_nbf': False,
                'verify_iat': False,
                'require': ['exp', 'iss', 'aud', 'sub'],
            },
        )
        current_time = (clock or time.time)()
        expiry = claims.get('exp')
        not_before = claims.get('nbf')
        if isinstance(expiry, bool) or not isinstance(expiry, (int, float)) or expiry <= current_time:
            raise ValueError('Expired or invalid expiration claim')
        if not_before is not None and (isinstance(not_before, bool) or not isinstance(not_before, (int, float)) or not_before > current_time):
            raise ValueError('Token is not yet valid')
        if not isinstance(claims.get('sub'), str) or not claims['sub'].strip():
            raise ValueError('Missing subject')
        return claims
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, 'Sessão Supabase inválida ou expirada. Entre novamente.')


def new_user(uid, name='', email='', photo=''):
    timestamp = now()
    return {'id': uid, 'name': name or 'Novo membro', 'email': email, 'photoUrl': photo, 'role': 'member', 'status': 'pending', 'preferences': DEFAULT_PREFERENCES.copy(), 'createdAt': timestamp, 'updatedAt': timestamp, 'archived': False}


def authenticate(store, mode, authorization):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Entre com sua conta para continuar.')
    token = authorization[7:]
    if len(token) > 16000:
        raise HTTPException(401, 'Sessão inválida.')
    if mode == 'supabase':
        claims = verify_supabase_token(token, store.supabase_url)
        return claims['sub']
    from firebase_admin import auth
    try:
        decoded = auth.verify_id_token(token, app=store.firebase_app, check_revoked=True)
    except Exception:
        raise HTTPException(401, 'Sessão inválida ou expirada. Entre novamente.')
    uid = decoded['uid']
    def register(tx):
        user = tx.get('users', uid)
        if not user:
            user = new_user(uid, decoded.get('name', ''), decoded.get('email', ''), decoded.get('picture', ''))
            user['emailVerified'] = decoded.get('email_verified') is True
            tx.put('users', uid, user)
        elif user.get('emailVerified') != (decoded.get('email_verified') is True):
            user['emailVerified'] = decoded.get('email_verified') is True
            user['updatedAt'] = now()
            tx.put('users', uid, user)
        return user
    user = store.atomic(register)
    # Never infer admin from claims, email, provider, or creation order.
    store.synchronize_user(user)
    return uid


def authorized(tx, uid, admin=False, approved=True, verified=False):
    user = tx.get('users', uid)
    if not user or user.get('archived'):
        raise HTTPException(401, 'Conta não encontrada.')
    if approved and user.get('status') != 'approved':
        raise HTTPException(403, 'Seu acesso aguarda aprovação ou está bloqueado.')
    if approved and verified and user.get('emailVerified') is not True:
        raise HTTPException(403, 'Verifique seu e-mail antes de acessar o sistema.')
    if admin and user.get('role') != 'admin':
        raise HTTPException(403, 'Esta ação é exclusiva de administradores.')
    return user
