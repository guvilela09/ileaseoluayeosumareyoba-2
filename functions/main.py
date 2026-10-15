"""Privileged outboxes, isolated Cloud Tasks delivery and private Resend mail."""
import os
from datetime import datetime, timedelta, timezone
from html import escape
from functools import lru_cache
import requests
import google.auth
from google.auth.transport.requests import AuthorizedSession
from google.api_core.exceptions import AlreadyExists, NotFound
from firebase_admin import initialize_app, firestore, auth, functions, db as realtime, storage
from firebase_admin.exceptions import AlreadyExistsError
from firebase_functions import firestore_fn, tasks_fn, scheduler_fn, params, options
from mail_logic import eligible, job_id, announcement_payload, retryable, should_retry

initialize_app()
REGION = 'us-central1'
options.set_global_options(region=REGION, max_instances=3)
RESEND_API_KEY = params.SecretParam('RESEND_API_KEY')
MAIL_FROM = params.StringParam('MAIL_FROM', description='Sender on your verified Resend domain')
DATABASE_URL = params.StringParam('DATABASE_URL', description='Firebase Realtime Database HTTPS URL')
TERMINAL = {'sent', 'failed', 'skipped', 'uncertain'}


def now():
    return datetime.now(timezone.utc)


@lru_cache(maxsize=1)
def worker_url():
    credentials, project = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    project = os.environ.get('GCLOUD_PROJECT') or os.environ.get('GOOGLE_CLOUD_PROJECT') or project
    session = AuthorizedSession(credentials)
    response = session.get(f'https://cloudfunctions.googleapis.com/v2/projects/{project}/locations/{REGION}/functions/deliver_email', timeout=20)
    response.raise_for_status()
    return response.json()['serviceConfig']['uri']


def enqueue(job):
    queue = functions.task_queue(f'locations/{REGION}/functions/deliver_email')
    try:
        queue.enqueue({'data': {'jobId': job}}, functions.TaskOptions(task_id=job, uri=worker_url(), dispatch_deadline_seconds=120))
    except (AlreadyExists, AlreadyExistsError):
        pass


def create_job(store, identifier, data):
    try:
        store.collection('deliveryJobs').document(identifier).create({**data, 'status':'queued', 'attempts':0, 'createdAt':now()})
    except AlreadyExists:
        pass
    enqueue(identifier)


@firestore_fn.on_document_created(document='mailCampaigns/{campaignId}', timeout_sec=540)
def fanout_announcement(event):
    if event.data is None:
        return
    distribute_campaign(event.data, event.params['campaignId'])


def distribute_campaign(snapshot, campaign_id):
    store = firestore.client()
    campaign_ref = snapshot.reference
    # Freeze recipients before enqueueing so a trigger retry cannot add newly approved users.
    @firestore.transactional
    def freeze(transaction):
        campaign = campaign_ref.get(transaction=transaction).to_dict()
        if campaign.get('status') not in {'queued', 'distributed'}:
            return []
        if 'recipientUids' in campaign:
            return campaign['recipientUids']
        recipients = [doc.id for doc in store.collection('users').stream() if eligible(doc.to_dict())]
        transaction.update(campaign_ref, {'recipientUids': recipients})
        return recipients
    recipients = freeze(store.transaction())
    for uid in recipients:
        create_job(store, job_id('announcement', campaign_id, uid), {'kind':'announcement','sourceId':campaign_id,'uid':uid})
    campaign_ref.update({'status':'distributed', 'recipientCount':len(recipients), 'distributedAt':now()})


@firestore_fn.on_document_created(document='passwordResetJobs/{resetId}')
def enqueue_password_reset(event):
    if event.data is None:
        return
    distribute_reset(event.data, event.params['resetId'])


def distribute_reset(snapshot, reset_id):
    data = snapshot.to_dict()
    if data.get('status') != 'queued' or not data.get('uid'):
        return
    identifier = job_id('reset', reset_id, data['uid'])
    create_job(firestore.client(), identifier, {'kind':'reset','sourceId':reset_id,'uid':data['uid']})
    snapshot.reference.update({'status':'distributed','deliveryJobId':identifier})


@scheduler_fn.on_schedule(schedule='every 15 minutes', timeout_sec=540)
def recover_queued_outboxes(event):
    # Python SDK 0.6 does not expose event retry config. Durable outboxes are replayed
    # by this bounded sweep if an initial Firestore trigger or task enqueue fails.
    store = firestore.client()
    failures = 0
    for collection, distribute in [('mailCampaigns', distribute_campaign), ('passwordResetJobs', distribute_reset)]:
        snapshots = store.collection(collection).where(filter=firestore.FieldFilter('status','==','queued')).limit(100).stream()
        for snapshot in snapshots:
            try:
                distribute(snapshot, snapshot.id)
            except Exception:
                failures += 1
    for snapshot in store.collection('deliveryJobs').where(filter=firestore.FieldFilter('status','==','queued')).limit(1000).stream():
        try:
            enqueue(snapshot.id)
        except Exception:
            failures += 1
    if failures:
        raise RuntimeError(f'{failures} outboxes require a later retry')


@scheduler_fn.on_schedule(schedule='every 1 hours', timeout_sec=540)
def prune_expired_imports(event):
    """Delete private list-import files after their 24-hour review window."""
    store = firestore.client()
    cutoff = now().isoformat()
    expired = (store.collection('uploads')
        .where(filter=firestore.FieldFilter('kind', '==', 'import'))
        .where(filter=firestore.FieldFilter('expiresAt', '<=', cutoff))
        .limit(500).stream())
    bucket = storage.bucket()
    failures = 0
    for snapshot in expired:
        upload = snapshot.to_dict() or {}
        path = upload.get('path')
        if not path or not path.startswith('uploads/'):
            snapshot.reference.delete()
            continue
        try:
            try:
                bucket.blob(path).delete()
            except NotFound:
                pass
            snapshot.reference.delete()
        except Exception:
            failures += 1
    # Uploads reach Storage before the API records their metadata. Scan one
    # persisted page per run so an interrupted/abandoned import is also removed.
    state_ref = store.collection('maintenance').document('importCleanup')
    state = state_ref.get().to_dict() or {}
    iterator = bucket.list_blobs(prefix='uploads/', max_results=1000, page_token=state.get('pageToken'))
    page = next(iterator.pages, [])
    for blob in page:
        metadata = blob.metadata or {}
        if metadata.get('kind') != 'import' or not blob.time_created or blob.time_created > now() - timedelta(hours=24):
            continue
        try:
            blob.delete()
        except NotFound:
            pass
        except Exception:
            failures += 1
    if failures:
        raise RuntimeError(f'{failures} imports could not be removed; a later sweep will retry')
    state_ref.set({'pageToken': iterator.next_page_token or None, 'updatedAt': now()})


def remove_stale_presence(uid, revision):
    reference = realtime.reference(f'presence/{uid}', url=DATABASE_URL.value)
    def retain_newer(existing):
        if not isinstance(existing, dict):
            return None
        connections = existing.get('connections') or {}
        current = {key: value for key, value in connections.items()
                   if isinstance(value, dict) and value.get('revision', '') > revision}
        return {'connections': current} if current else None
    reference.transaction(retain_newer)


@firestore_fn.on_document_written(document='users/{uid}')
def reconcile_access(event):
    # Backend performs synchronous mirror changes; this reconciles external/admin changes.
    store = firestore.client()
    uid = event.params['uid']
    user_ref = store.collection('users').document(uid)
    mirror = realtime.reference(f'serverMirror/approvedUsers/{uid}', url=DATABASE_URL.value)
    for _ in range(3):
        snapshot = user_ref.get()
        data = snapshot.to_dict() if snapshot.exists else {}
        approved = data.get('status') == 'approved'
        admin = approved and data.get('role') == 'admin'
        if snapshot.exists and snapshot.update_time:
            revision = snapshot.update_time.isoformat()
        else:
            if not event.data.before or not event.data.before.exists or not event.data.before.update_time:
                return
            previous = event.data.before.update_time.isoformat()
            revision = previous + '~deleted'
        def update_mirror(existing):
            if not snapshot.exists:
                if existing and existing.get('updatedAt', '') > revision:
                    return existing
                if existing and existing.get('approved') is False and existing.get('admin') is False:
                    return existing
                return {'approved': False, 'admin': False, 'updatedAt': revision}
            return existing if existing and existing.get('updatedAt', '') > revision else {
                'approved': approved, 'admin': admin, 'updatedAt': revision,
            }
        current = mirror.transaction(update_mirror)
        if current.get('updatedAt') != revision:
            if not snapshot.exists:
                return
            continue
        if not approved:
            remove_stale_presence(uid, revision)
        try:
            record = auth.get_user(uid)
            claims = dict(record.custom_claims or {})
            claims.update({'role': 'admin' if admin else 'member', 'approved': approved, 'accessRevision': revision})
            auth.set_custom_user_claims(uid, claims)
        except auth.UserNotFoundError:
            return
        latest = user_ref.get()
        if (not latest.exists and not snapshot.exists) or (latest.exists and snapshot.exists and latest.update_time.isoformat() == revision):
            return
    raise RuntimeError(f'Access for {uid} changed repeatedly while claims were being synchronized')


@tasks_fn.on_task_dispatched(
    secrets=[RESEND_API_KEY], timeout_sec=90, invoker='private',
    retry_config=options.RetryConfig(max_attempts=8, min_backoff_seconds=60, max_retry_seconds=72000),
    rate_limits=options.RateLimits(max_concurrent_dispatches=2, max_dispatches_per_second=1))
def deliver_email(request):
    store = firestore.client()
    identifier = request.data.get('jobId')
    if not isinstance(identifier, str) or len(identifier) != 64:
        return
    job_ref = store.collection('deliveryJobs').document(identifier)
    @firestore.transactional
    def claim(transaction):
        snapshot = job_ref.get(transaction=transaction)
        if not snapshot.exists:
            return None
        job = snapshot.to_dict()
        timestamp = now()
        if job.get('status') in TERMINAL:
            return None
        if job.get('leaseUntil') and job['leaseUntil'] > timestamp:
            raise RuntimeError('Delivery already leased; retry later')
        first = job.get('firstAttemptAt', timestamp)
        if not should_retry(job.get('attempts', 0), first, timestamp):
            transaction.update(job_ref, {'status':'uncertain', 'updatedAt':timestamp, 'errorCode':'retry-limit-or-expired-key'})
            return None
        transaction.update(job_ref, {'status':'sending','leaseUntil':timestamp+timedelta(seconds=120),
                                    'firstAttemptAt':first,'attempts':job.get('attempts',0)+1,'updatedAt':timestamp})
        return {**job, 'attempts':job.get('attempts',0)+1}
    job = claim(store.transaction())
    if not job:
        return
    try:
        user_snapshot = store.collection('users').document(job['uid']).get()
        user = user_snapshot.to_dict() or {}
        record = auth.get_user(job['uid'])
        if record.disabled or not record.email_verified or not record.email or user.get('status') != 'approved':
            job_ref.update({'status':'skipped','leaseUntil':None,'errorCode':'recipient-no-longer-approved'})
            return
        if job['kind'] == 'announcement' and not eligible(user):
            job_ref.update({'status':'skipped','leaseUntil':None,'errorCode':'notifications-disabled'})
            return
        payload = job.get('payload')
        if payload and payload.get('to') != [record.email]:
            job_ref.update({'status':'skipped','leaseUntil':None,'errorCode':'recipient-email-changed'})
            return
        if not payload:
            if job['kind'] == 'announcement':
                campaign = store.collection('mailCampaigns').document(job['sourceId']).get().to_dict() or {}
                payload = announcement_payload(campaign, record.email, MAIL_FROM.value)
            elif job['kind'] == 'reset' and any(p.provider_id == 'password' for p in record.provider_data):
                link = auth.generate_password_reset_link(record.email)
                payload = {'from':MAIL_FROM.value,'to':[record.email],'subject':'Recuperar acesso — Ilé Asé',
                           'text':f'Para redefinir sua senha, abra: {link}',
                           'html':f'<p>Foi solicitada a recuperação de sua senha.</p><p><a href="{escape(link, quote=True)}">Redefinir senha</a></p>'}
            else:
                job_ref.update({'status':'skipped','leaseUntil':None,'errorCode':'google-managed-password'})
                return
            # Persist the exact envelope before the first HTTP attempt. Retries reuse it.
            job_ref.update({'payload':payload})
        response = requests.post('https://api.resend.com/emails', headers={'Authorization':f'Bearer {RESEND_API_KEY.value}',
            'Idempotency-Key':f'portal/{identifier}'}, json=payload, timeout=20)
        if response.ok:
            provider_id = response.json().get('id')
            if not provider_id:
                raise RuntimeError('Resend returned no delivery identifier')
            job_ref.update({'status':'sent','providerId':provider_id,'sentAt':now(),'leaseUntil':None,
                            'payload':firestore.DELETE_FIELD})
            return
        code = f'resend-{response.status_code}'
        if retryable(response.status_code) and job['attempts'] < 5:
            job_ref.update({'status':'retry','errorCode':code,'leaseUntil':None})
            raise RuntimeError(code)
        job_ref.update({'status':'failed','errorCode':code,'leaseUntil':None})
    except auth.UserNotFoundError:
        job_ref.update({'status':'skipped','errorCode':'recipient-removed','leaseUntil':None})
    except Exception:
        # Do not log sensitive provider bodies, recipient addresses or password links.
        current = job_ref.get().to_dict() or {}
        if current.get('status') not in TERMINAL:
            job_ref.update({'status':'uncertain' if job['attempts'] >= 5 else 'retry','errorCode':'delivery-interrupted','leaseUntil':None})
        raise
