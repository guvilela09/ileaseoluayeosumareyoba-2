"""Persistence boundaries. Each service mutation executes in one transaction."""
import json
import os
import sqlite3
import threading
import hashlib
import hmac
import secrets
import time
from contextlib import contextmanager
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect(path, timeout=30):
    connection = sqlite3.connect(path, timeout=timeout)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


class SQLiteTransaction:
    def __init__(self, connection):
        self.connection = connection

    def get(self, collection, key):
        row = self.connection.execute('SELECT value FROM documents WHERE collection=? AND id=?', (collection, key)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self, collection):
        return [json.loads(row[0]) for row in self.connection.execute('SELECT value FROM documents WHERE collection=? ORDER BY rowid', (collection,))]

    def put(self, collection, key, value):
        self.connection.execute('INSERT INTO documents(collection,id,value) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET value=excluded.value', (collection, key, json.dumps(value, ensure_ascii=False)))


class SQLiteStore:
    """SQLite adapter for isolated API tests; the app factory never selects it."""
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with connect(path) as connection:
            connection.execute('CREATE TABLE IF NOT EXISTS documents(collection TEXT,id TEXT,value TEXT,PRIMARY KEY(collection,id))')
            connection.execute('CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,content BLOB)')
            connection.execute('CREATE TABLE IF NOT EXISTS settings(id TEXT PRIMARY KEY,value TEXT)')
            connection.execute('INSERT OR IGNORE INTO settings VALUES(?,?)', ('asset-secret', secrets.token_hex(32)))
            self.asset_secret = connection.execute('SELECT value FROM settings WHERE id=?', ('asset-secret',)).fetchone()[0].encode()

    def atomic(self, operation, actor_id=None):
        with self.lock, connect(self.path) as connection:
            connection.execute('BEGIN IMMEDIATE')
            return operation(SQLiteTransaction(connection))

    def read_collection(self, collection):
        return self.atomic(lambda tx: tx.all(collection))

    def save_bytes(self, path, content):
        with self.lock, connect(self.path) as connection:
            connection.execute('INSERT INTO files VALUES(?,?)', (path, content))

    def read_bytes(self, path):
        with connect(self.path) as connection:
            row = connection.execute('SELECT content FROM files WHERE path=?', (path,)).fetchone()
        if row is None:
            raise FileNotFoundError(path)
        return bytes(row[0])

    def image_url(self, path, uid):
        from urllib.parse import quote
        expires = int(time.time()) + 1800
        signature = hmac.new(self.asset_secret, f'{uid}:{expires}:{path}'.encode(), hashlib.sha256).hexdigest()
        return '/api/assets/' + quote(path, safe='/') + f'?uid={quote(uid)}&expires={expires}&signature={signature}'

    def verify_asset(self, path, uid, expires, signature):
        if expires < time.time() or expires > time.time() + 1801:
            return False
        expected = hmac.new(self.asset_secret, f'{uid}:{expires}:{path}'.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected)


class FirebaseTransaction:
    """Stage writes until all reads complete (Firestore forbids read-after-write)."""
    def __init__(self, client, transaction):
        self.client, self.transaction = client, transaction
        self.pending = {}

    def reference(self, collection, key):
        # Object paths contain slashes; use a flat private metadata collection.
        document_id = hashlib.sha256(key.encode()).hexdigest() if collection == 'uploads' else key
        return self.client.collection(collection).document(document_id)

    def get(self, collection, key):
        identity = (collection, key)
        if identity in self.pending:
            return self.pending[identity].copy()
        snap = self.reference(collection, key).get(transaction=self.transaction)
        return snap.to_dict() if snap.exists else None

    def all(self, collection):
        values = {snap.id: snap.to_dict() for snap in self.client.collection(collection).stream(transaction=self.transaction)}
        for (coll, key), value in self.pending.items():
            if coll == collection:
                values[key] = value.copy()
        return list(values.values())

    def put(self, collection, key, value):
        self.pending[(collection, key)] = value.copy()

    def flush(self):
        for (collection, key), value in self.pending.items():
            self.transaction.set(self.reference(collection, key), value)


class FirebaseStore:
    def __init__(self):
        import firebase_admin
        from firebase_admin import credentials, firestore, storage
        project = os.environ.get('FIREBASE_PROJECT_ID')
        bucket = os.environ.get('FIREBASE_STORAGE_BUCKET')
        if not project or not bucket or not os.environ.get('FIREBASE_DATABASE_URL'):
            raise RuntimeError('Configure FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET e FIREBASE_DATABASE_URL.')
        service_account = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON')
        credential = credentials.Certificate(json.loads(service_account)) if service_account else credentials.ApplicationDefault()
        options = {'projectId': project, 'storageBucket': bucket}
        if os.environ.get('FIREBASE_DATABASE_URL'):
            options['databaseURL'] = os.environ['FIREBASE_DATABASE_URL']
        import uuid
        self.firebase_app = firebase_admin.initialize_app(credential, options, name='portal-' + uuid.uuid4().hex)
        self.client = firestore.client(self.firebase_app)
        self.bucket = storage.bucket(app=self.firebase_app)

    def atomic(self, operation, actor_id=None):
        from google.cloud import firestore
        @firestore.transactional
        def run(transaction):
            context = FirebaseTransaction(self.client, transaction)
            result = operation(context)
            context.flush()
            return result
        return run(self.client.transaction())

    def read_collection(self, collection):
        return [snap.to_dict() for snap in self.client.collection(collection).stream()]

    def read_bytes(self, path):
        blob = self.bucket.blob(path)
        blob.reload()
        if not blob.size or blob.size > 10 * 1024 * 1024:
            raise ValueError('Arquivo vazio ou maior que 10 MB.')
        return blob.download_as_bytes()

    def image_url(self, path, uid=None):
        return self.bucket.blob(path).generate_signed_url(expiration=timedelta(minutes=30), method='GET')

    def register_object(self, path, uid, kind, content_type):
        blob = self.bucket.blob(path)
        blob.reload()
        if blob.content_type != content_type:
            raise ValueError('O tipo declarado não corresponde ao conteúdo do arquivo.')
        metadata = dict(blob.metadata or {})
        metadata.pop('firebaseStorageDownloadTokens', None)
        metadata.update(ownerUid=uid, kind=kind)
        blob.metadata = metadata
        blob.patch()

    def synchronize_user(self, user):
        from firebase_admin import auth, db
        user_reference = self.client.collection('users').document(user['id'])
        reference = db.reference('serverMirror/approvedUsers/' + user['id'], app=self.firebase_app)
        for _ in range(3):
            snapshot = user_reference.get()
            if not snapshot.exists:
                # The Firestore delete trigger owns revocation; a stale caller must
                # never restore its old user object or supersede a recreated profile.
                return
            current_user = snapshot.to_dict()
            approved = current_user.get('status') == 'approved'
            admin = approved and current_user.get('role') == 'admin'
            revision = snapshot.update_time.isoformat()
            mirrored = reference.transaction(lambda existing: existing if existing and existing.get('updatedAt', '') > revision else {
                'approved': approved, 'admin': admin, 'updatedAt': revision,
            })
            if mirrored.get('updatedAt') != revision:
                continue
            if not approved:
                presence = db.reference('presence/' + user['id'], app=self.firebase_app)
                def retain_newer(existing):
                    if not isinstance(existing, dict):
                        return None
                    connections = existing.get('connections') or {}
                    newer = {key: value for key, value in connections.items()
                             if isinstance(value, dict) and value.get('revision', '') > revision}
                    return {'connections': newer} if newer else None
                presence.transaction(retain_newer)
            record = auth.get_user(user['id'], app=self.firebase_app)
            claims = dict(record.custom_claims or {})
            claims.update(role=current_user.get('role', 'member'), approved=approved, admin=admin, accessRevision=revision)
            auth.set_custom_user_claims(user['id'], claims, app=self.firebase_app)
            latest = user_reference.get()
            if latest.exists and latest.update_time and latest.update_time.isoformat() == revision:
                return
        raise RuntimeError('O perfil mudou repetidamente durante a sincronização de acesso.')
