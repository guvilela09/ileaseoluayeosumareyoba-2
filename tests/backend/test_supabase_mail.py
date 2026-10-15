import httpx
import unittest

from backend.supabase_mail import MailConfigurationError, SupabaseMailService


def make_service(handler, *, recovery_allowed=None):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return SupabaseMailService(
        supabase_url="https://project.supabase.co",
        supabase_secret_key="sb_secret_do_not_log",
        resend_api_key="re_test_do_not_log",
        from_email="Ilé Asé <avisos@example.org>",
        allowed_redirect_urls=["https://ile.example.org/reset-password"],
        recovery_allowed=recovery_allowed,
        http_client=client,
    )


class SupabaseMailTests(unittest.TestCase):
  def test_recovery_link_is_generated_by_admin_api_and_sent_through_resend(self):
    requests = []

    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/admin/generate_link"):
            return httpx.Response(200, json={"action_link": "https://project.supabase.co/auth/v1/verify?token=private"})
        return httpx.Response(200, json={"id": "email-id"})

    service = make_service(handler, recovery_allowed=lambda email: email.endswith("@example.org"))
    result = service.send_password_recovery("member@example.org", "https://ile.example.org/reset-password")

    assert result == {"sent": True}
    assert requests[0].url.path == "/auth/v1/admin/generate_link"
    assert requests[0].headers["apikey"] == "sb_secret_do_not_log"
    assert requests[0].headers["authorization"] == "Bearer sb_secret_do_not_log"
    assert requests[1].url == "https://api.resend.com/emails"
    assert requests[1].headers["authorization"] == "Bearer re_test_do_not_log"
    assert "private" in requests[1].read().decode()


  def test_recovery_requires_explicit_policy_approval_before_admin_api_call(self):
    requests = []
    service = make_service(lambda request: (requests.append(request), httpx.Response(200, json={"action_link": "https://link"}))[1])

    with self.assertRaises(PermissionError):
        service.send_password_recovery("person@example.org", "https://ile.example.org/reset-password")

    assert requests == []


  def test_recovery_rejects_redirect_not_in_allowlist(self):
    service = make_service(lambda request: httpx.Response(200), recovery_allowed=lambda email: True)

    with self.assertRaises(MailConfigurationError):
        service.send_password_recovery("person@example.org", "https://evil.example/steal")


  def test_provider_errors_do_not_echo_secrets_or_action_links(self):
    service = make_service(
        lambda request: httpx.Response(500, text="sb_secret_do_not_log re_test_do_not_log https://private-link"),
        recovery_allowed=lambda email: True,
    )

    with self.assertRaises(RuntimeError) as raised:
        service.send_password_recovery("person@example.org", "https://ile.example.org/reset-password")

    message = str(raised.exception)
    assert "sb_secret_do_not_log" not in message
    assert "re_test_do_not_log" not in message
    assert "private-link" not in message


  def test_requires_verified_sender_and_resend_configuration(self):
    with self.assertRaises(MailConfigurationError):
        SupabaseMailService(
            supabase_url="https://project.supabase.co",
            supabase_secret_key="secret",
            resend_api_key="re_test",
            from_email="",
        )

  def test_announcement_sends_individually_without_disclosing_other_recipients(self):
    requests = []
    service = make_service(lambda request: (requests.append(request), httpx.Response(200, json={"id": "ok"}))[1])

    result = service.send_announcement(
        ["one@example.org", "two@example.org", "one@example.org"],
        subject="Comunicado",
        html_body="<p>Reunião</p>",
    )

    assert result == {"sent_count": 2}
    first_body, second_body = (request.read().decode() for request in requests)
    assert '"to":["one@example.org"]' in first_body and "two@example.org" not in first_body
    assert '"to":["two@example.org"]' in second_body and "one@example.org" not in second_body


if __name__ == "__main__":
    unittest.main()
