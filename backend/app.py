"""FastAPI entry point. Missing backend configuration always fails closed."""
import logging
import os
from pathlib import Path
from fastapi import Body, Depends, FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from .auth import authenticate
from .models import COLLECTIONS, fields
from .service import PortalService
from .store import FirebaseStore
from .supabase_mail import SupabaseMailService

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / '.env.local', override=False)
logger = logging.getLogger(__name__)


class RequestTooLarge(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        used, started = 0, False
        async def limited_receive():
            nonlocal used
            message = await receive()
            if message['type'] == 'http.request':
                used += len(message.get('body', b''))
                if used > 11 * 1024 * 1024:
                    raise RequestTooLarge()
            return message
        async def tracked_send(message):
            nonlocal started
            if message['type'] == 'http.response.start':
                started = True
            await send(message)
        try:
            await self.app(scope, limited_receive, tracked_send)
        except RequestTooLarge:
            if not started:
                await JSONResponse({'detail': 'O envio excede o limite de 10 MB.'}, status_code=413)(scope, receive, send)


def public_config():
    mapping = {'apiKey': 'API_KEY', 'authDomain': 'AUTH_DOMAIN', 'projectId': 'PROJECT_ID', 'storageBucket': 'STORAGE_BUCKET', 'appId': 'APP_ID', 'messagingSenderId': 'MESSAGING_SENDER_ID', 'databaseURL': 'DATABASE_URL'}
    return {key: os.environ.get('FIREBASE_' + suffix) or os.environ.get('VITE_FIREBASE_' + suffix, '') for key, suffix in mapping.items()}


def public_supabase_config():
    return {
        'url': os.environ.get('SUPABASE_URL', ''),
        'publishableKey': os.environ.get('SUPABASE_PUBLISHABLE_KEY', ''),
    }


def create_app(mode=None):
    mode = mode or os.environ.get('APP_MODE', 'supabase')
    if mode not in ('firebase', 'supabase'):
        mode = 'supabase'
    app = FastAPI(title='Ilé Asé — API privada', docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(BodyLimitMiddleware)
    store = None
    try:
        if mode == 'supabase':
            from .supabase_store import SupabaseStore
            if not os.environ.get('SUPABASE_SECRET_KEY'):
                raise RuntimeError('Configure SUPABASE_SECRET_KEY no servidor.')
            candidate = SupabaseStore()
            if not public_supabase_config()['url'] or not public_supabase_config()['publishableKey']:
                raise RuntimeError('Configure SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.')
            store = candidate
        else:
            store = FirebaseStore()
    except Exception as error:
        logger.warning('%s indisponível: configure credenciais do servidor antes de usar a API.', mode.capitalize())
    mailer, recovery_redirect_url = None, os.environ.get('SUPABASE_PASSWORD_RESET_REDIRECT_URL', '').strip()
    if mode == 'supabase' and store and all(os.environ.get(name) for name in ('RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'SUPABASE_AUTH_REDIRECT_URLS', recovery_redirect_url)):
        def recovery_allowed(email):
            matches = store.atomic(lambda tx: [user for user in tx.all('users') if user.get('email', '').casefold() == email.casefold() and user.get('status') == 'approved' and not user.get('archived')])
            return bool(matches)
        try:
            mailer = SupabaseMailService.from_env(recovery_allowed=recovery_allowed)
        except Exception:
            logger.warning('Envio de recuperação Supabase indisponível: confira as variáveis privadas de e-mail e redirecionamento.')
    service = PortalService(store, mode, mailer=mailer, recovery_redirect_url=recovery_redirect_url) if store else None
    app.state.store, app.state.mode = store, mode

    def ready():
        if not store:
            raise HTTPException(503, f'{mode.capitalize()} não configurado. O administrador precisa configurar os serviços do servidor.')

    def uid(authorization: str | None = Header(default=None)):
        ready()
        try:
            return authenticate(store, mode, authorization)
        except HTTPException:
            raise
        except Exception:
            logger.exception('Falha de autenticação ou sincronização %s', mode.capitalize())
            raise HTTPException(503, 'O serviço de autenticação está temporariamente indisponível.')

    @app.exception_handler(Exception)
    async def unexpected_error(request, error):
        logger.error('Falha ao processar API: %s', type(error).__name__)
        return JSONResponse({'detail': 'O serviço está temporariamente indisponível. Tente novamente.'}, status_code=503)

    @app.get('/api/config')
    def config():
        result = {'mode': mode, 'configured': bool(store)}
        if mode == 'supabase':
            result['supabase'] = public_supabase_config()
        elif mode == 'firebase':
            result['firebase'] = public_config()
        return result

    @app.get('/api/session')
    def session(user_id=Depends(uid)):
        return service.session(user_id)

    @app.get('/api/bootstrap')
    def bootstrap(user_id=Depends(uid)):
        return service.bootstrap(user_id)

    @app.get('/api/users')
    def users(user_id=Depends(uid)):
        return service.users(user_id)

    @app.patch('/api/users/{key}')
    def update_user(key: str, data: dict = Body(...), user_id=Depends(uid)):
        return service.update_user(user_id, key, data)

    @app.post('/api/users/{key}/password-reset')
    def reset_password(key: str, user_id=Depends(uid)):
        return service.password_reset(user_id, key)

    @app.patch('/api/profile')
    def profile(data: dict = Body(...), user_id=Depends(uid)):
        return service.profile(user_id, data)

    @app.get('/api/site')
    def site(user_id=Depends(uid)):
        return service.site(user_id)

    @app.patch('/api/site')
    def update_site(data: dict = Body(...), user_id=Depends(uid)):
        return service.site(user_id, data)

    @app.post('/api/assistant/query')
    def assistant(data: dict = Body(...), user_id=Depends(uid)):
        return service.assistant(user_id, data)

    @app.patch('/api/progress/{key}')
    def progress(key: str, data: dict = Body(...), user_id=Depends(uid)):
        return service.progress(user_id, key, 'check', data)

    @app.post('/api/progress/{key}/complete')
    def complete(key: str, data: dict = Body(default={}), user_id=Depends(uid)):
        return service.progress(user_id, key, 'complete', data)

    @app.post('/api/progress/{key}/reset')
    def reset(key: str, data: dict = Body(default={}), user_id=Depends(uid)):
        return service.progress(user_id, key, 'reset', data)

    @app.post('/api/announcements/{key}/publish')
    def publish(key: str, user_id=Depends(uid)):
        return service.publish(user_id, key)

    @app.post('/api/uploads/register')
    def register(data: dict = Body(...), user_id=Depends(uid)):
        fields(data, ('path', 'filename', 'kind'))
        return service.upload(user_id, None, data.get('filename', ''), data.get('kind'), data.get('path'))

    @app.post('/api/imports/preview')
    def imports(data: dict = Body(...), user_id=Depends(uid)):
        return service.import_preview(user_id, data)

    def collection_valid(collection):
        if collection not in COLLECTIONS:
            raise HTTPException(404, 'Conteúdo não encontrado.')

    @app.get('/api/{collection}')
    def read(collection: str, user_id=Depends(uid)):
        collection_valid(collection)
        return service.read(user_id, collection)

    @app.post('/api/{collection}')
    def create(collection: str, data: dict = Body(...), user_id=Depends(uid)):
        collection_valid(collection)
        return service.save(user_id, collection, data)

    @app.patch('/api/{collection}/{key}')
    def update(collection: str, key: str, data: dict = Body(...), user_id=Depends(uid)):
        collection_valid(collection)
        return service.save(user_id, collection, data, key)

    @app.delete('/api/{collection}/{key}')
    def archive(collection: str, key: str, user_id=Depends(uid)):
        collection_valid(collection)
        return service.archive(user_id, collection, key)

    return app


app = create_app()
