"""All portal reads and mutations pass through current membership checks."""
import importlib.util
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from fastapi import HTTPException
from . import models
from .auth import authorized
from .store import now

FAQ_PATH = Path(__file__).resolve().parents[1] / 'assistant-preview' / 'help.py'
_spec = importlib.util.spec_from_file_location('portal_faq', FAQ_PATH)
_faq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_faq)


def require_document(tx, collection, key):
    models.identifier(key)
    value = tx.get(collection, key)
    if not value or value.get('archived'):
        raise HTTPException(404, 'Conteúdo não encontrado.')
    return value


def normalize_progress(value, listing):
    current = {item['id']: item['version'] for item in listing['items']}
    value = value or {'checked': [], 'versions': {}, 'completed': False}
    checked = [key for key in value.get('checked', []) if key in current and value.get('versions', {}).get(key) == current[key]]
    return {'checked': checked, 'versions': {key: current[key] for key in checked}, 'completed': bool(value.get('completed')) and bool(current) and len(checked) == len(current)}


class PortalService:
    def __init__(self, store, mode, mailer=None, recovery_redirect_url=''):
        self.store, self.mode = store, mode
        self.mailer, self.recovery_redirect_url = mailer, recovery_redirect_url

    def run(self, uid, operation, admin=False, approved=True):
        def execute(tx):
            user = authorized(tx, uid, admin=admin, approved=approved, verified=self.mode == 'firebase')
            return operation(tx, user)
        # The actor is part of the transaction context for stores that need to
        # populate database-owned audit columns (for example Supabase.created_by).
        return self.store.atomic(execute, actor_id=uid)

    def asset_fields(self, value, uid):
        value = value.copy()
        for path_key, url_key in (('imagePath', 'imageUrl'), ('photoPath', 'photoUrl')):
            if value.get(path_key):
                value[url_key] = self.store.image_url(value[path_key], uid)
        return value

    def list_documents(self, tx, user, collection):
        values = [value for value in tx.all(collection) if not value.get('archived')]
        if collection == 'announcements' and user['role'] != 'admin':
            values = [value for value in values if value.get('published')]
        if collection == 'orixas':
            values.sort(key=lambda item: (item.get('order', 99999), item.get('createdAt', ''), item.get('id', '')))
        return [self.asset_fields(value, user['id']) for value in values]

    def session(self, uid):
        return self.run(uid, lambda tx, user: {'user': self.asset_fields(user, uid)}, approved=False)

    def bootstrap(self, uid):
        def read(tx, user):
            state = {'mode': self.mode}
            for collection in models.COLLECTIONS:
                state[collection] = self.list_documents(tx, user, collection)
            state['progress'] = {}
            for listing in state['lists']:
                value = tx.get(f'progress/{uid}/lists', listing['id'])
                if value:
                    state['progress'][listing['id']] = normalize_progress(value, listing)
            state['site'] = self.asset_fields(tx.get('site', 'config') or {'address': '', 'mapUrl': '', 'photoUrl': ''}, uid)
            if user['role'] == 'admin':
                state['users'] = self.user_list(tx, uid)
            return state
        return self.run(uid, read)

    def read(self, uid, collection):
        return self.run(uid, lambda tx, user: self.list_documents(tx, user, collection))

    def check_image(self, tx, uid, path):
        if not path:
            return
        value = tx.get('uploads', path)
        if not value or value.get('owner') != uid or value.get('kind') != 'image':
            raise HTTPException(403, 'Escolha uma imagem enviada pela sua conta.')

    def save(self, uid, collection, data, key=None):
        def write(tx, user):
            previous = require_document(tx, collection, key) if key else None
            value = models.document(collection, data, previous)
            if 'imagePath' in data and value.get('imagePath') != (previous or {}).get('imagePath'):
                self.check_image(tx, uid, value['imagePath'])
            timestamp = now()
            value.update(id=key or uuid.uuid4().hex, updatedAt=timestamp, archived=False)
            value.setdefault('createdAt', timestamp)
            if not previous:
                value['createdBy'] = uid
            tx.put(collection, value['id'], value)
            return self.asset_fields(value, uid)
        return self.run(uid, write, admin=True)

    def archive(self, uid, collection, key):
        def write(tx, user):
            value = require_document(tx, collection, key)
            value.update(archived=True, updatedAt=now())
            tx.put(collection, key, value)
            return value
        return self.run(uid, write, admin=True)

    def publish(self, uid, key):
        def write(tx, user):
            value = require_document(tx, 'announcements', key)
            campaign = tx.get('mailCampaigns', key)
            if value.get('published') and campaign:
                return {'announcement': value, 'emailStatus': 'already-published'}
            timestamp = now()
            value.update(published=True, publishedAt=value.get('publishedAt') or timestamp, updatedAt=timestamp)
            if not campaign:
                tx.put('mailCampaigns', key, {'announcementId': key, 'title': value['title'], 'content': value['content'], 'createdAt': timestamp, 'status': 'queued', 'requestedBy': uid})
            tx.put('announcements', key, value)
            return {'announcement': value, 'emailStatus': 'queued'}
        return self.run(uid, write, admin=True)

    def progress(self, uid, key, action, data=None):
        data = data or {}
        if action == 'check':
            models.fields(data, ('itemId', 'checked'))
            models.identifier(data.get('itemId'))
            if type(data.get('checked')) is not bool:
                models.invalid('Informe se o item está marcado.')
        else:
            models.fields(data, ())
        def write(tx, user):
            listing = require_document(tx, 'lists', key)
            collection = f'progress/{uid}/lists'
            value = normalize_progress(tx.get(collection, key), listing)
            if action == 'reset':
                value = {'checked': [], 'versions': {}, 'completed': False}
            elif action == 'complete':
                if not listing['items'] or len(value['checked']) != len(listing['items']):
                    raise HTTPException(409, 'Marque todos os itens antes de concluir.')
                value['completed'] = True
            else:
                item = next((item for item in listing['items'] if item['id'] == data['itemId']), None)
                if not item:
                    raise HTTPException(404, 'Item não encontrado nesta lista.')
                if data['checked'] and item['id'] not in value['checked']:
                    value['checked'].append(item['id'])
                    value['versions'][item['id']] = item['version']
                elif not data['checked']:
                    value['checked'] = [key for key in value['checked'] if key != item['id']]
                    value['versions'].pop(item['id'], None)
                value['completed'] = False
            tx.put(collection, key, {**value, 'updatedAt': now()})
            return value
        return self.run(uid, write)

    def user_list(self, tx, uid):
        values = []
        for value in tx.all('users'):
            if value.get('archived'):
                continue
            value = self.asset_fields(value, uid)
            values.append(value)
        return values

    def users(self, uid):
        return self.run(uid, lambda tx, user: self.user_list(tx, uid), admin=True)

    def update_user(self, uid, key, data):
        models.fields(data, ('role', 'status'))
        if not data or ('role' in data and data['role'] not in ('admin', 'member')) or ('status' in data and data['status'] not in ('pending', 'approved', 'blocked')):
            models.invalid('Perfil ou estado de acesso inválido.')
        def write(tx, user):
            value = require_document(tx, 'users', key)
            admins = [u for u in tx.all('users') if u.get('role') == 'admin' and u.get('status') == 'approved' and not u.get('archived')]
            revised = {**value, **data, 'updatedAt': now()}
            if value['role'] == 'admin' and value['status'] == 'approved' and (revised['role'] != 'admin' or revised['status'] != 'approved') and len(admins) <= 1:
                raise HTTPException(409, 'Mantenha pelo menos um administrador aprovado.')
            tx.put('users', key, revised)
            return revised
        value = self.run(uid, write, admin=True)
        if self.mode == 'firebase':
            self.store.synchronize_user(value)
        return value

    def password_reset(self, uid, key):
        def read_target(tx, user):
            target = require_document(tx, 'users', key)
            if not target.get('email') or target.get('status') != 'approved':
                models.invalid('Esta conta não tem e-mail cadastrado.')
            if self.mode == 'firebase':
                tx.put('passwordResetJobs', uuid.uuid4().hex, {'uid': key, 'status': 'queued', 'requestedBy': uid, 'createdAt': now()})
            return target.get('email')
        email = self.run(uid, read_target, admin=True)
        if self.mode == 'supabase':
            if not self.mailer or not self.recovery_redirect_url:
                raise HTTPException(503, 'O envio de recuperação de senha ainda não está configurado no servidor.')
            try:
                self.mailer.send_password_recovery(email, self.recovery_redirect_url)
            except PermissionError:
                raise HTTPException(403, 'Esta conta não está autorizada para recuperação.') from None
            except Exception:
                raise HTTPException(502, 'Não foi possível enviar o e-mail de recuperação.') from None
            return {'status': 'sent', 'message': 'E-mail de recuperação enviado.'}
        return {'status': 'queued', 'message': 'Solicitação de recuperação enfileirada.'}

    def profile(self, uid, data):
        models.fields(data, ('name', 'photoPath', 'preferences'))
        def write(tx, user):
            if 'name' in data:
                user['name'] = models.text(data['name'], 'Nome', 200, True)
            if 'preferences' in data:
                user['preferences'] = models.preferences(data['preferences'], user.get('preferences', models.DEFAULT_PREFERENCES.copy()))
            if 'photoPath' in data:
                path = models.text(data['photoPath'], 'Foto', 500)
                self.check_image(tx, uid, path)
                user['photoPath'] = path
                user['photoUrl'] = self.store.image_url(path, uid) if path else ''
            user['updatedAt'] = now()
            tx.put('users', uid, user)
            return {'user': self.asset_fields(user, uid)}
        return self.run(uid, write)

    def site(self, uid, data=None):
        if data is not None:
            models.fields(data, ('address', 'mapUrl', 'photoPath'))
        def operation(tx, user):
            value = tx.get('site', 'config') or {'id': 'config', 'address': '', 'mapUrl': '', 'photoUrl': '', 'createdAt': now(), 'archived': False}
            if data is not None:
                if 'address' in data:
                    value['address'] = models.text(data['address'], 'Endereço', 1000)
                if 'mapUrl' in data:
                    value['mapUrl'] = models.map_url(data['mapUrl'])
                if 'photoPath' in data:
                    path = models.text(data['photoPath'], 'Foto', 500)
                    self.check_image(tx, uid, path)
                    value.update(photoPath=path, photoUrl=self.store.image_url(path, uid) if path else '')
                value['updatedAt'] = now()
                value['updatedBy'] = uid
                tx.put('site', 'config', value)
            return self.asset_fields(value, uid)
        return self.run(uid, operation, admin=data is not None)

    def assistant(self, uid, data):
        models.fields(data, ('question',))
        try:
            question = _faq.validate_question(data.get('question'))
        except ValueError as error:
            models.invalid(str(error))
        def answer(tx, user):
            value = _faq.answer_question(question)
            replacements = {'No portal planejado, ': 'No sistema, ', 'portal planejado': 'sistema', 'o acesso terá entrada': 'o acesso permite entrada', 'você poderá': 'você pode', 'o administrador poderá': 'o administrador pode', 'aceitará': 'aceita', 'permitirão': 'permitem', 'terá sua própria': 'tem sua própria', 'ficará salvo': 'fica salvo', 'ficarão salvas': 'ficam salvas', 'reunirá': 'reúne', 'dependerá': 'depende', 'As alterações serão feitas': 'As alterações são feitas', 'mostrará': 'mostra', 'aparecerá': 'aparece', 'mostrará': 'mostra'}
            for source, target in replacements.items():
                value['answer'] = value['answer'].replace(source, target)
            value['answer'] = re.sub(r'\s*Esta prévia[^.]*\.', '', value['answer'], flags=re.IGNORECASE)
            value['answer'] = value['answer'].replace('; esta prévia não aprova contas nem altera permissões', '')
            return value
        return self.run(uid, answer)

    def validate_upload(self, content, filename, kind):
        if kind not in ('image', 'import'):
            models.invalid('Tipo de arquivo inválido.')
        limit = (5 if kind == 'image' else 10) * 1024 * 1024
        if not content or len(content) > limit:
            raise HTTPException(413, f'Arquivo vazio ou maior que {limit // 1024 // 1024} MB.')
        extension = Path(filename).suffix.lower()
        mime = None
        if kind == 'image':
            from io import BytesIO
            from PIL import Image
            try:
                with Image.open(BytesIO(content)) as image:
                    image.verify()
                    format_name = image.format
            except Exception:
                models.invalid('Escolha uma imagem PNG, JPEG ou WebP válida.')
            expected = {'PNG': ('.png', 'image/png'), 'JPEG': ('.jpg', 'image/jpeg'), 'WEBP': ('.webp', 'image/webp')}
            if format_name not in expected or extension not in (expected[format_name][0], '.jpeg' if format_name == 'JPEG' else expected[format_name][0]):
                models.invalid('O conteúdo e a extensão da imagem não correspondem.')
            mime = expected[format_name][1]
        elif extension not in ('.docx', '.xlsx', '.pdf') or (extension == '.pdf' and not content.startswith(b'%PDF-')) or (extension in ('.docx', '.xlsx') and not content.startswith(b'PK')):
            models.invalid('Escolha um documento DOCX, XLSX ou PDF válido.')
        return mime or {'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'pdf': 'application/pdf'}[extension[1:]]

    def owned_upload(self, tx, uid, path, kind=None):
        if not isinstance(path, str) or not path.startswith(f'uploads/{uid}/') or '..' in path or '\\' in path or path.count('/') != 2:
            raise HTTPException(403, 'O arquivo deve pertencer à sua conta.')
        value = tx.get('uploads', path)
        if not value or value.get('owner') != uid or (kind and value['kind'] != kind):
            raise HTTPException(403, 'Arquivo não encontrado entre os seus envios.')
        expires_at = value.get('expiresAt')
        if expires_at and datetime.fromisoformat(expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(410, 'Este arquivo de importação expirou. Envie-o novamente para continuar.')
        return value

    def upload(self, uid, content, filename, kind, path=None):
        self.run(uid, lambda tx, user: None, admin=kind == 'import')
        filename = re.sub(r'[^A-Za-z0-9_.-]', '-', str(filename).replace('\\', '/').split('/')[-1])[:180]
        if path is not None:
            if not isinstance(path, str) or not path.startswith(f'uploads/{uid}/') or '..' in path or '\\' in path or path.count('/') != 2:
                raise HTTPException(403, 'O arquivo deve pertencer à sua conta.')
            try:
                content = self.store.read_bytes(path)
            except Exception:
                models.invalid('Arquivo não encontrado ou maior que o limite permitido.')
        else:
            path = f'uploads/{uid}/{uuid.uuid4().hex}-{filename}'
        mime = self.validate_upload(content, filename, kind)
        if self.mode == 'firebase':
            try:
                self.store.register_object(path, uid, kind, mime)
            except ValueError as error:
                models.invalid(str(error))
        value = {'path': path, 'filename': filename, 'kind': kind, 'owner': uid, 'size': len(content), 'contentType': mime, 'createdAt': now()}
        if kind == 'import':
            value['expiresAt'] = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
        self.run(uid, lambda tx, user: tx.put('uploads', path, value), admin=kind == 'import')
        return {'path': path, 'filename': filename, 'url': self.store.image_url(path, uid) if kind == 'image' else ''}

    def import_preview(self, uid, data):
        models.fields(data, ('path', 'filename', 'sheet', 'columns'))
        upload = self.run(uid, lambda tx, user: self.owned_upload(tx, uid, data.get('path'), 'import'), admin=True)
        if data.get('filename') != upload['filename']:
            models.invalid('O nome do arquivo não corresponde ao envio.')
        from .importers import extract_candidates
        try:
            return extract_candidates(self.store.read_bytes(upload['path']), upload['filename'], data.get('sheet'), data.get('columns'))
        except ValueError as error:
            models.invalid(str(error))

