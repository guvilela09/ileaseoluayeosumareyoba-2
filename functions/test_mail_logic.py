import unittest
from datetime import datetime, timedelta, timezone
from mail_logic import eligible, job_id, announcement_payload, safe_delta_html, should_retry, retryable


class MailLogicTests(unittest.TestCase):
    def test_only_approved_explicit_opt_in(self):
        for status in ['pending', 'blocked']:
            self.assertFalse(eligible({'status':status,'email':'member@example.test','preferences':{'emailNotifications':True}}))
        self.assertFalse(eligible({'status':'approved','email':'member@example.test'}))
        self.assertTrue(eligible({'status':'approved','email':'member@example.test','preferences':{'emailNotifications':True}}))

    def test_deterministic_and_isolated_recipient_keys(self):
        self.assertEqual(job_id('announcement','a','u'), job_id('announcement','a','u'))
        self.assertNotEqual(job_id('announcement','a','u'), job_id('announcement','a','v'))
        self.assertNotEqual(job_id('reset','a','u'), job_id('announcement','a','u'))

    def test_single_recipient_and_escaped_editor(self):
        payload = announcement_payload({'title':'Aviso','content':{'ops':[{'insert':'<script>x</script>'},{'insert':{'image':'bad'}}]}}, 'one@example.test','Portal <mail@example.test>')
        self.assertEqual(payload['to'], ['one@example.test'])
        self.assertNotIn('<script>', payload['html'])
        self.assertEqual(payload['text'], '<script>x</script>')

    def test_bounded_retry_before_idempotency_expiration(self):
        now = datetime.now(timezone.utc)
        self.assertTrue(should_retry(1, now, now))
        self.assertFalse(should_retry(5, now, now))
        self.assertFalse(should_retry(1, now - timedelta(hours=24), now))
        self.assertTrue(retryable(429))
        self.assertFalse(retryable(422))

    def test_toolbar_formatting_is_preserved_with_strict_css_values(self):
        rendered = safe_delta_html({'ops':[
            {'insert':'Texto <seguro>', 'attributes':{'font':'serif','size':'24px','color':'#C17342','bold':True}},
            {'insert':'\n','attributes':{'list':'bullet'}},
            {'insert':'Sem injeção','attributes':{'font':'url(bad)','size':'expression(bad)','color':'red; background:url(bad)','link':'javascript:bad'}},
            {'insert':'\n','attributes':{'list':'bullet'}},
        ]})
        self.assertIn('font-family:Georgia, serif;font-size:24px;color:#C17342', rendered)
        self.assertIn('&lt;seguro&gt;', rendered)
        self.assertIn('<ul><li>', rendered)
        self.assertEqual(rendered.count('<ul>'), 1)
        self.assertNotIn('url(', rendered)
        self.assertNotIn('expression', rendered)
        self.assertNotIn('javascript', rendered)


if __name__ == '__main__':
    unittest.main()
