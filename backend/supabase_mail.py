"""Server-side Supabase Auth link generation and Resend delivery.

The admin recovery endpoint is deliberately gated by an application supplied
policy callback. Public password-reset routes must return the same generic
response whether an account exists or not; do not expose this module's errors
or delivery result to an unauthenticated caller.
"""

from __future__ import annotations

import html
import os
from collections.abc import Callable, Iterable
from urllib.parse import urlsplit

import httpx


class MailConfigurationError(ValueError):
    """Raised when required delivery configuration is absent or unsafe."""


class MailDeliveryError(RuntimeError):
    """Provider failure with intentionally redacted details."""


class SupabaseMailService:
    """Generate privileged Auth links and deliver email via Resend.

    ``recovery_allowed`` is an explicit application authorization policy. It
    must check that this recovery operation is allowed for the requested
    account (for example, the account is an approved portal member). The
    public password-reset endpoint must still respond generically to prevent
    account enumeration and should rate-limit requests.

    Announcement methods are intended to be called only after the application
    has authorized an administrator.
    """

    RESEND_EMAILS_URL = "https://api.resend.com/emails"

    def __init__(
        self,
        *,
        supabase_url: str,
        supabase_secret_key: str,
        resend_api_key: str,
        from_email: str,
        allowed_redirect_urls: Iterable[str] = (),
        recovery_allowed: Callable[[str], bool] | None = None,
        http_client: httpx.Client | None = None,
        timeout: float = 10.0,
    ) -> None:
        self.supabase_url = self._base_url(supabase_url)
        self.supabase_secret_key = self._required(supabase_secret_key, "SUPABASE_SECRET_KEY")
        self.resend_api_key = self._required(resend_api_key, "RESEND_API_KEY")
        self.from_email = self._required(from_email, "RESEND_FROM_EMAIL")
        self.allowed_redirect_urls = frozenset(self._safe_redirect(value) for value in allowed_redirect_urls)
        self.recovery_allowed = recovery_allowed
        self._client = http_client or httpx.Client(timeout=timeout)

    @classmethod
    def from_env(cls, *, recovery_allowed: Callable[[str], bool] | None = None,
                 http_client: httpx.Client | None = None) -> "SupabaseMailService":
        """Build the service from server-only environment variables."""
        return cls(
            supabase_url=os.getenv("SUPABASE_URL", ""),
            supabase_secret_key=os.getenv("SUPABASE_SECRET_KEY", ""),
            resend_api_key=os.getenv("RESEND_API_KEY", ""),
            from_email=os.getenv("RESEND_FROM_EMAIL", ""),
            allowed_redirect_urls=filter(None, os.getenv("SUPABASE_AUTH_REDIRECT_URLS", "").split(",")),
            recovery_allowed=recovery_allowed,
            http_client=http_client,
        )

    @staticmethod
    def _required(value: str, name: str) -> str:
        cleaned = (value or "").strip()
        if not cleaned:
            raise MailConfigurationError(f"Configuração ausente: {name}.")
        return cleaned

    @classmethod
    def _base_url(cls, value: str) -> str:
        value = cls._required(value, "SUPABASE_URL").rstrip("/")
        parsed = urlsplit(value)
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        if (parsed.scheme != "https" and not local_http) or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise MailConfigurationError("SUPABASE_URL deve ser uma URL HTTPS válida.")
        return value

    @staticmethod
    def _safe_redirect(value: str) -> str:
        parsed = urlsplit((value or "").strip())
        local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
        if ((parsed.scheme != "https" and not local_http) or not parsed.hostname
                or parsed.username or parsed.password or parsed.fragment):
            raise MailConfigurationError("URL de redirecionamento inválida.")
        return value.strip()

    def _request(self, method: str, url: str, *, headers: dict[str, str], json_body: dict) -> dict:
        try:
            response = self._client.request(method, url, headers=headers, json=json_body)
            if not 200 <= response.status_code < 300:
                raise MailDeliveryError("O provedor de e-mail não concluiu a operação.")
            payload = response.json()
            if not isinstance(payload, dict):
                raise MailDeliveryError("Resposta inválida do provedor de e-mail.")
            return payload
        except MailDeliveryError:
            raise
        except Exception:
            # Provider exceptions may include request headers, response bodies,
            # action links, or credentials. Never chain those into API logs.
            raise MailDeliveryError("Não foi possível concluir a operação de e-mail.") from None

    def _admin_headers(self) -> dict[str, str]:
        return {
            "apikey": self.supabase_secret_key,
            "Authorization": f"Bearer {self.supabase_secret_key}",
            "Content-Type": "application/json",
        }

    def _send(self, *, to: str, subject: str, html_body: str, text_body: str | None = None) -> None:
        payload = {
            "from": self.from_email,
            "to": [to],
            "subject": subject,
            "html": html_body,
        }
        if text_body:
            payload["text"] = text_body
        self._request(
            "POST", self.RESEND_EMAILS_URL,
            headers={"Authorization": f"Bearer {self.resend_api_key}", "Content-Type": "application/json"},
            json_body=payload,
        )

    def send_password_recovery(self, email: str, redirect_to: str) -> dict[str, bool]:
        """Send a password-recovery link, only when the injected policy allows it.

        Returns the same result for all successful calls. Callers should also
        use a generic response on their public endpoint, including when this
        method raises, so the endpoint cannot reveal account existence.
        """
        email = self._required(email, "email")
        redirect_to = self._safe_redirect(redirect_to)
        if redirect_to not in self.allowed_redirect_urls:
            raise MailConfigurationError("URL de redirecionamento não autorizada.")
        if self.recovery_allowed is None or not self.recovery_allowed(email):
            raise PermissionError("Operação de recuperação não autorizada.")

        data = self._request(
            "POST",
            f"{self.supabase_url}/auth/v1/admin/generate_link",
            headers=self._admin_headers(),
            json_body={"type": "recovery", "email": email, "redirect_to": redirect_to},
        )
        action_link = data.get("action_link")
        if not isinstance(action_link, str):
            raise MailDeliveryError("Não foi possível gerar o link de recuperação.")
        parsed_link = urlsplit(action_link)
        configured = urlsplit(self.supabase_url)
        if parsed_link.scheme != "https" or parsed_link.netloc != configured.netloc:
            raise MailDeliveryError("O provedor retornou um link de recuperação inválido.")

        escaped_link = html.escape(action_link, quote=True)
        self._send(
            to=email,
            subject="Redefinição de senha — Ilé Asé Oluaye Osumare Yoba",
            html_body=f'<p>Recebemos uma solicitação para redefinir sua senha.</p><p><a href="{escaped_link}">Redefinir senha</a></p><p>Se você não solicitou, ignore esta mensagem.</p>',
            text_body=f"Redefina sua senha usando este link: {action_link}\nSe você não solicitou, ignore esta mensagem.",
        )
        return {"sent": True}

    def send_announcement(self, recipients: Iterable[str], *, subject: str,
                          html_body: str, text_body: str | None = None) -> dict[str, int]:
        """Send an admin-authorized announcement privately to each recipient.

        Each member receives an individual message so recipient addresses are
        never disclosed to other members. The calling route must authorize an
        approved administrator before calling this helper.
        """
        subject = self._required(subject, "subject")
        if not html_body or not html_body.strip():
            raise MailConfigurationError("O comunicado não pode estar vazio.")
        clean_recipients = list(dict.fromkeys((email or "").strip() for email in recipients if email and email.strip()))
        sent = 0
        for recipient in clean_recipients:
            self._send(to=recipient, subject=subject, html_body=html_body, text_body=text_body)
            sent += 1
        return {"sent_count": sent}

