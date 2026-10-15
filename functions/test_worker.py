"""Exercise the real delivery handler with in-memory persistence and no network."""
import importlib.util
import unittest
from types import SimpleNamespace
from unittest.mock import patch, Mock
from datetime import datetime, timezone

AVAILABLE = importlib.util.find_spec('firebase_functions') is not None


class Snapshot:
    def __init__(self, value): self.value = value; self.exists = value is not None
    def to_dict(self): return dict(self.value) if self.value is not None else None


class Reference:
    def __init__(self, documents, path): self.documents = documents; self.path = path
    def get(self, **kwargs): return Snapshot(self.documents.get(self.path))
    def update(self, value): self.documents[self.path].update(value)


class Collection:
    def __init__(self, documents, name): self.documents = documents; self.name = name
    def document(self, identifier): return Reference(self.documents, f'{self.name}/{identifier}')


class Store:
    def __init__(self, documents): self.documents = documents
    def collection(self, name): return Collection(self.documents, name)
    def transaction(self): return SimpleNamespace(update=lambda ref, data: ref.update(data))


@unittest.skipUnless(AVAILABLE, 'Install functions/requirements.txt to exercise worker runtime')
class WorkerTests(unittest.TestCase):
    def setUp(self):
        import main
        self.module = main
        self.identifier = 'a' * 64
        self.documents = {
            f'deliveryJobs/{self.identifier}': {'kind':'announcement','sourceId':'campaign','uid':'member','status':'queued','attempts':0},
            'users/member': {'status':'approved','email':'member@example.test','preferences':{'emailNotifications':True}},
            'mailCampaigns/campaign': {'title':'Aviso','content':{'ops':[{'insert':'Olá'}]}},
        }
        self.record = SimpleNamespace(disabled=False,email_verified=True,email='member@example.test',provider_data=[])
        self.patches = [patch.object(main.firestore,'client',return_value=Store(self.documents)),
                        patch.object(main.firestore,'transactional',side_effect=lambda fn: fn),
                        patch.object(main.auth,'get_user',return_value=self.record),
                        patch.dict('os.environ',{'MAIL_FROM':'Portal <mail@example.test>','RESEND_API_KEY':'test-only'})]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    def invoke(self):
        return self.module.deliver_email.__wrapped__(SimpleNamespace(data={'jobId':self.identifier}))

    def test_duplicate_dispatch_is_not_a_duplicate_http_send(self):
        response = Mock(ok=True)
        response.json.return_value = {'id':'provider-test-id'}
        with patch.object(self.module.requests,'post',return_value=response) as post:
            self.invoke(); self.invoke()
        self.assertEqual(post.call_count, 1)
        self.assertEqual(post.call_args.kwargs['json']['to'], ['member@example.test'])
        self.assertEqual(post.call_args.kwargs['headers']['Idempotency-Key'], f'portal/{self.identifier}')
        self.assertEqual(self.documents[f'deliveryJobs/{self.identifier}']['status'], 'sent')

    def test_network_retry_reuses_identical_payload_and_key(self):
        response = Mock(ok=True)
        response.json.return_value = {'id':'provider-test-id'}
        with patch.object(self.module.requests,'post',side_effect=[TimeoutError(), response]) as post:
            with self.assertRaises(TimeoutError): self.invoke()
            envelope = dict(self.documents[f'deliveryJobs/{self.identifier}']['payload'])
            self.documents['mailCampaigns/campaign']['title'] = 'Edited after send'
            self.invoke()
        self.assertEqual(post.call_args_list[0].kwargs['json'], envelope)
        self.assertEqual(post.call_args_list[1].kwargs['json'], envelope)
        self.assertEqual(post.call_args_list[0].kwargs['headers'], post.call_args_list[1].kwargs['headers'])

    def test_recipient_blocked_after_queue_is_skipped(self):
        self.documents['users/member']['status'] = 'blocked'
        with patch.object(self.module.requests,'post') as post: self.invoke()
        post.assert_not_called()
        self.assertEqual(self.documents[f'deliveryJobs/{self.identifier}']['status'], 'skipped')

    def test_expired_idempotency_window_stops_sending(self):
        from datetime import timedelta
        self.documents[f'deliveryJobs/{self.identifier}']['firstAttemptAt'] = datetime.now(timezone.utc)-timedelta(hours=24)
        with patch.object(self.module.requests,'post') as post: self.invoke()
        post.assert_not_called()
        self.assertEqual(self.documents[f'deliveryJobs/{self.identifier}']['status'], 'uncertain')

    def test_queue_body_and_id_are_deterministic(self):
        queue = Mock()
        with patch.object(self.module.functions,'task_queue',return_value=queue), patch.object(self.module,'worker_url',return_value='https://worker.example.test'):
            self.module.enqueue(self.identifier)
        data, opts = queue.enqueue.call_args.args
        self.assertEqual(data, {'data':{'jobId':self.identifier}})
        self.assertEqual(opts.task_id, self.identifier)


if __name__ == '__main__': unittest.main()
