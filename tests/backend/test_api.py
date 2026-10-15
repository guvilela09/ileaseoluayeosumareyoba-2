import os
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import inspect

try:
    from backend.app import create_app
    from backend.auth import new_user
    from backend.store import SQLiteStore
except ImportError:
    create_app = new_user = SQLiteStore = None


class APIResult:
    def __init__(self, status_code, data):
        self.status_code = status_code
        self._data = data
        self.text = str(data)

    def json(self):
        return self._data


class InProcessAPI:
    """Invoke FastAPI route endpoints without relying on a worker-thread test server."""
    def __init__(self, app):
        self.app = app

    def request(self, method, path, json=None, headers=None, data=None, files=None):
        if data is not None or files is not None:
            raise AssertionError('Multipart upload routes are not part of the production API.')
        for route in self.app.routes:
            if not hasattr(route, 'path_regex') or method.upper() not in (route.methods or set()):
                continue
            match = route.path_regex.match(path)
            if not match:
                continue
            arguments = match.groupdict()
            try:
                for dependency in route.dependant.dependencies:
                    if dependency.name == 'user_id':
                        arguments['user_id'] = dependency.call(authorization=(headers or {}).get('Authorization'))
                if 'data' in inspect.signature(route.endpoint).parameters:
                    arguments['data'] = json
                return APIResult(200, route.endpoint(**arguments))
            except Exception as error:
                from fastapi import HTTPException
                if isinstance(error, HTTPException):
                    return APIResult(error.status_code, {'detail': error.detail})
                raise
        return APIResult(404, {'detail': 'Not found'})

    def get(self, path, **kwargs):
        return self.request('GET', path, **kwargs)

    def post(self, path, **kwargs):
        return self.request('POST', path, **kwargs)


class PortalTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(create_app, 'Portal API factory has not been implemented yet')
        temp_root = Path(__file__).resolve().parents[2] / '.local'
        temp_root.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=temp_root)
        store = SQLiteStore(self.tmp.name + '/portal.db')
        environment = {
            'SUPABASE_SECRET_KEY': 'test-only-secret',
            'SUPABASE_URL': 'https://portal-test.supabase.co',
            'SUPABASE_PUBLISHABLE_KEY': 'test-only-publishable-key',
        }
        with patch.dict(os.environ, environment):
            with patch('backend.supabase_store.SupabaseStore', return_value=store):
                self.app = create_app(mode='supabase')
        self.store = store
        self.users = {
            'admin': {'id': 'admin', 'name': 'Administrador', 'email': 'admin@example.test', 'role': 'admin', 'status': 'approved'},
            'member': {'id': 'member', 'name': 'Membro', 'email': 'member@example.test', 'role': 'member', 'status': 'approved'},
        }
        def seed(tx):
            for uid, data in self.users.items():
                tx.put('users', uid, {**new_user(uid, data['name'], data['email']), **data})
        self.store.atomic(seed)
        self.auth_patcher = patch('backend.app.authenticate', side_effect=self.authenticate_test_token)
        self.auth_patcher.start()
        self.client = InProcessAPI(self.app)
        self.admin = self.session('admin')
        self.member = self.session('member')

    def tearDown(self):
        self.auth_patcher.stop()
        self.tmp.cleanup()

    def session(self, role):
        return {'Authorization': 'Bearer test-' + role}

    def authenticate_test_token(self, store, mode, authorization):
        tokens = {'Bearer test-admin': 'admin', 'Bearer test-member': 'member'}
        uid = tokens.get(authorization)
        if not uid:
            from fastapi import HTTPException
            raise HTTPException(401, 'Sessão de teste inválida.')
        return uid

    def req(self, method, path, body=None, headers=None):
        return self.client.request(method, '/api/' + path, json=body, headers=headers or self.admin)

    def test_unauthorized_and_member_cannot_write_or_read_users(self):
        self.assertEqual(self.client.get('/api/bootstrap').status_code, 401)
        self.assertEqual(self.req('POST', 'events', {'title': 'X', 'date': '2026-10-14', 'time': '10:00'}, self.member).status_code, 403)
        self.assertEqual(self.req('GET', 'users', headers=self.member).status_code, 403)
        self.assertNotIn('users', self.req('GET', 'bootstrap', headers=self.member).json())

    def test_current_blocked_status_overrides_existing_token(self):
        uid = self.req('GET', 'session', headers=self.member).json()['user']['id']
        self.assertEqual(self.req('PATCH', 'users/' + uid, {'status': 'blocked'}).status_code, 200)
        self.assertEqual(self.req('GET', 'bootstrap', headers=self.member).status_code, 403)
        self.assertEqual(self.req('GET', 'session', headers=self.member).json()['user']['status'], 'blocked')

    def test_pending_member_cannot_use_api_or_assistant(self):
        uid = self.req('GET', 'session', headers=self.member).json()['user']['id']
        self.req('PATCH', 'users/' + uid, {'status': 'pending'})
        self.assertEqual(self.req('POST', 'assistant/query', {'question': 'lista'}, self.member).status_code, 403)
        self.assertEqual(self.req('PATCH', 'profile', {'name': 'Nome'}, self.member).status_code, 403)

    def test_upload_ownership_and_import_require_admin(self):
        self.assertEqual(self.req('POST', 'uploads/register', {'kind': 'image', 'path': 'uploads/other/pic.png', 'filename': 'pic.png'}, self.member).status_code, 403)
        self.assertEqual(self.req('POST', 'imports/preview', {'path': '../private.pdf', 'filename': 'private.pdf'}).status_code, 403)

    def test_profile_rejects_privileged_fields_and_last_admin_protected(self):
        uid = self.req('GET', 'session').json()['user']['id']
        self.assertEqual(self.req('PATCH', 'profile', {'role': 'admin'}, self.member).status_code, 422)
        self.assertEqual(self.req('PATCH', 'users/' + uid, {'role': 'member'}).status_code, 409)
        self.assertEqual(self.req('PATCH', 'users/' + uid, {'status': 'blocked'}).status_code, 409)

    def test_progress_is_personal_and_revision_invalidates_marks(self):
        created = self.req('POST', 'lists', {'title': 'Teste', 'description': '', 'items': [{'text': 'A'}, {'text': 'B'}]}).json()
        lid, a, b = created['id'], created['items'][0], created['items'][1]
        self.assertEqual(self.req('POST', f'progress/{lid}/complete', {}, self.member).status_code, 409)
        for item in (a, b):
            response = self.req('PATCH', f'progress/{lid}', {'itemId': item['id'], 'checked': True}, self.member)
            self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(self.req('POST', f'progress/{lid}/complete', {}, self.member).json()['completed'])
        self.assertEqual(self.req('GET', 'bootstrap').json()['progress'].get(lid, {}).get('checked', []), [])
        updated = self.req('PATCH', 'lists/' + lid, {'items': [{'id': a['id'], 'text': 'A alterado'}, b]}).json()
        self.assertEqual(updated['items'][0]['version'], 2)
        progress = self.req('GET', 'bootstrap', headers=self.member).json()['progress'][lid]
        self.assertEqual(progress['checked'], [b['id']])
        self.assertFalse(progress['completed'])
        self.assertEqual(self.req('PATCH', f'progress/{lid}', {'itemId': a['id'], 'checked': True, 'uid': 'someone'}, self.member).status_code, 422)
        self.assertEqual(self.req('POST', f'progress/{lid}/reset', {}, self.member).json()['checked'], [])

    def test_publish_is_idempotent_and_drafts_are_private(self):
        data = {'title': 'Rascunho', 'priority': 'normal', 'content': {'ops': [{'insert': 'Olá\n'}]}}
        draft = self.req('POST', 'announcements', data).json()
        self.assertNotIn(draft['id'], [x['id'] for x in self.req('GET', 'announcements', headers=self.member).json()])
        first = self.req('POST', 'announcements/' + draft['id'] + '/publish', {}).json()
        second = self.req('POST', 'announcements/' + draft['id'] + '/publish', {}).json()
        self.assertEqual(first['emailStatus'], 'queued')
        self.assertEqual(second['emailStatus'], 'already-published')
        self.req('PATCH', 'announcements/' + draft['id'], {'title': 'Editado'})
        self.assertEqual(self.req('POST', 'announcements/' + draft['id'] + '/publish', {}).json()['emailStatus'], 'already-published')
        self.assertEqual(len(self.app.state.store.read_collection('mailCampaigns')), 1)

    def test_validation_archive_and_faq(self):
        self.assertEqual(self.req('POST', 'events', {'title': 'X', 'date': '2026-02-30', 'time': '10:00'}).status_code, 422)
        self.assertEqual(self.req('POST', 'lists', {'title': 'X', 'items': []}).status_code, 422)
        self.assertEqual(self.req('POST', 'announcements', {'title': 'X', 'content': {'ops': [{'insert': {'image': 'javascript:x'}}]}}).status_code, 422)
        self.assertEqual(self.req('POST', 'members', {'name': 'X', 'spotifyUrl': 'https://evil.test/track/x'}).status_code, 422)
        item = self.req('POST', 'events', {'title': 'X', 'date': '2026-10-14', 'time': '10:00'}).json()
        self.assertEqual(self.req('DELETE', 'events/' + item['id']).status_code, 200)
        self.assertNotIn(item['id'], [x['id'] for x in self.req('GET', 'events').json()])
        answer = self.req('POST', 'assistant/query', {'question': 'Como concluir lista?'}).json()
        self.assertIn('No sistema', answer['answer'])
        self.assertNotIn('planejado', answer['answer'])

    def test_seed_does_not_invent_religious_content(self):
        from backend.seed import seed_cultural
        seed_cultural(self.app.state.store)
        orixas = self.req('GET', 'orixas').json()
        self.assertEqual(len(orixas), 21)
        self.assertTrue(all(x['description'] == '' for x in orixas))
        self.assertEqual(orixas[0]['name'], 'Lọ́gún ẹ̀dẹ́')

    def test_editor_toolbar_formats_are_accepted(self):
        for size in ('14px', '16px', '18px', '20px', '24px', '32px'):
            content = {'ops': [{'insert': 'Texto\n', 'attributes': {'font': 'sans', 'size': size, 'color': '#9c542c', 'bold': True}}]}
            response = self.req('POST', 'announcements', {'title': 'Editor', 'content': content})
            self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.req('GET', 'session').json()['user']['preferences']['theme'], 'light')
        self.assertEqual(self.req('GET', 'session').json()['user']['preferences']['accent'], 'copper')

    def test_concurrent_demotions_keep_one_active_admin(self):
        admin_id = self.req('GET', 'session').json()['user']['id']
        member_id = self.req('GET', 'session', headers=self.member).json()['user']['id']
        self.req('PATCH', 'users/' + member_id, {'role': 'admin'})
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(self.req, 'PATCH', 'users/' + uid, {'role': 'member'}, headers) for uid, headers in ((admin_id, self.admin), (member_id, self.member))]
            self.assertEqual(sorted(future.result().status_code for future in futures), [200, 409])
        remaining = [user for user in self.app.state.store.read_collection('users') if user['role'] == 'admin' and user['status'] == 'approved']
        self.assertEqual(len(remaining), 1)

    def test_production_seed_is_idempotent_and_preserves_editorial_content(self):
        from backend.seed import seed_cultural
        seed_cultural(self.app.state.store)
        self.req('PATCH', 'orixas/orixa-01', {'description': 'Texto fornecido pelo administrador'})
        seed_cultural(self.app.state.store)
        values = self.req('GET', 'orixas').json()
        self.assertEqual(len(values), 21)
        self.assertEqual(values[0]['description'], 'Texto fornecido pelo administrador')

    def test_profile_image_capability_expires_on_block_and_import_is_not_public(self):
        from io import BytesIO
        from PIL import Image
        stream = BytesIO()
        Image.new('RGB', (1, 1), '#ffffff').save(stream, format='PNG')
        path = 'uploads/member/photo.png'
        self.store.save_bytes(path, stream.getvalue())
        response = self.client.post('/api/uploads/register', headers=self.member, json={'kind': 'image', 'path': path, 'filename': 'foto.png'})
        self.assertEqual(response.status_code, 200, response.text)
        upload = response.json()
        self.assertEqual(upload['path'], path)
        self.assertEqual(self.req('PATCH', 'profile', {'photoPath': upload['path']}).status_code, 403)
        member_id = self.req('GET', 'session', headers=self.member).json()['user']['id']
        self.req('PATCH', 'users/' + member_id, {'status': 'blocked'})
        self.assertEqual(self.req('GET', 'bootstrap', headers=self.member).status_code, 403)


if __name__ == '__main__':
    unittest.main()
