"""Standard-library localhost help preview, separate from a production portal.

Start from the workspace: python -B assistant-preview/server.py
No authentication, account storage, uploads or administrative operations exist here.
"""

import json
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from help import answer_question, validate_question


HOST = "127.0.0.1"
PORT = 8765
MAX_BODY_BYTES = 8192
ROOT = Path(__file__).resolve().parent.parent
STATIC_ROUTES = {
    "/": (ROOT / "assistant-preview/index.html", "text/html; charset=utf-8"),
    "/styles.css": (ROOT / "assistant-preview/styles.css", "text/css; charset=utf-8"),
    "/assistant.js": (ROOT / "assistant-preview/assistant.js", "text/javascript; charset=utf-8"),
    "/assets/assistant/avatar-open.png": (ROOT / "public/assets/assistant/avatar-open.png", "image/png"),
    "/assets/assistant/avatar-closed.png": (ROOT / "public/assets/assistant/avatar-closed.png", "image/png"),
}


def _reject_nonfinite(value):
    raise ValueError("JSON inválido.")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON contém campos repetidos.")
        result[key] = value
    return result


def parse_query(body, content_type="application/json"):
    """Validate a small JSON object with exactly one question field."""
    if len(body) > MAX_BODY_BYTES:
        raise ValueError("O corpo da requisição deve ter no máximo 8 KB.")
    if content_type.split(";", 1)[0].strip().lower() != "application/json":
        raise ValueError("Envie Content-Type application/json.")
    try:
        payload = json.loads(body.decode("utf-8"), parse_constant=_reject_nonfinite,
                             object_pairs_hook=_unique_object)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise ValueError("Envie um JSON válido em UTF-8.") from error
    if not isinstance(payload, dict) or set(payload) != {"question"}:
        raise ValueError("Envie um objeto JSON contendo apenas question.")
    return validate_question(payload["question"])


def static_path(request_path):
    """Resolve only five exact routes; no directory listing, decoding or traversal."""
    item = STATIC_ROUTES.get(request_path)
    if item is None:
        return None
    path = item[0]
    # Reject symbolic links/junctions that could turn a public route into a private file.
    if path.resolve() != path:
        return None
    return path


class PreviewHandler(BaseHTTPRequestHandler):
    server_version = "AssistantPreview/1.0"
    sys_version = ""
    timeout = 5

    def _json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _send(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _local_request(self):
        valid = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
        if self.headers.get("Host", "").lower() not in valid:
            self._json(400, {"error": "Use o endereço local da prévia."})
            return False
        return True

    def do_GET(self):
        if not self._local_request():
            return
        # Only a path and optional query are accepted; protocol-relative targets are rejected.
        target = urlsplit(self.path)
        if target.scheme or target.netloc:
            self._json(404, {"error": "Página não encontrada."})
            return
        if target.path == "/api/health":
            self._json(200, {"status": "ok", "mode": "local-help-preview"})
            return
        path = static_path(target.path)
        if path is None or not path.is_file():
            self._json(404, {"error": "Página não encontrada."})
            return
        try:
            body = path.read_bytes()
        except OSError:
            self._json(404, {"error": "Arquivo indisponível."})
            return
        self._send(200, body, STATIC_ROUTES[target.path][1])

    def do_POST(self):
        if not self._local_request():
            return
        if self.path != "/api/assistant/query":
            self._json(404, {"error": "Rota não encontrada."})
            return
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}:
            self._json(400, {"error": "Use a prévia no endereço local."})
            return
        try:
            lengths = self.headers.get_all("Content-Length", [])
            if self.headers.get("Transfer-Encoding") or len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                raise ValueError("Envie um Content-Length válido.")
            length = int(lengths[0])
            if not 1 <= length <= MAX_BODY_BYTES:
                raise ValueError("O corpo da requisição deve ter entre 1 byte e 8 KB.")
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("Corpo da requisição incompleto.")
            question = parse_query(body, self.headers.get("Content-Type", ""))
            result = answer_question(question)
        except (ValueError, socket.timeout):
            self._json(400, {"error": "Envie JSON {question: texto}, com pergunta de 1 a 500 "
                        "caracteres e corpo de até 8 KB."})
            return
        self._json(200, result)


def main():
    with ThreadingHTTPServer((HOST, PORT), PreviewHandler) as server:
        print(f"Prévia local de ajuda: http://{HOST}:{PORT}", flush=True)
        print("As funções do portal são planejadas; esta prévia responde apenas dúvidas de uso.", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
