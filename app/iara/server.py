"""Adaptador localhost entre o Codex Responses API e o SDK oficial da Iara."""

from __future__ import annotations

import hmac
import io
import json
import os
import signal
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Iterator


HOST = "127.0.0.1"
PORT = int(os.getenv("INDEV_IARA_PROXY_PORT", "4510"))
LOCAL_TOKEN = os.getenv("INDEV_IARA_PROXY_TOKEN", "")
MOCK_MODE = os.getenv("INDEV_IARA_MOCK", "").lower() in {"1", "true", "yes"}
MAX_BODY_BYTES = int(os.getenv("INDEV_IARA_MAX_BODY_BYTES", str(20 * 1024 * 1024)))

if os.getenv("IARA_CA_BUNDLE"):
    os.environ.setdefault("REQUESTS_CA_BUNDLE", os.environ["IARA_CA_BUNDLE"])
    os.environ.setdefault("SSL_CERT_FILE", os.environ["IARA_CA_BUNDLE"])

_client: Any = None


def jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    for method_name in ("model_dump", "to_dict", "dict"):
        method = getattr(value, method_name, None)
        if callable(method):
            try:
                return jsonable(method())
            except TypeError:
                continue
    data = getattr(value, "__dict__", None)
    if isinstance(data, dict):
        return jsonable({key: item for key, item in data.items() if not key.startswith("_")})
    return str(value)


def configured_models() -> list[str]:
    models = [item.strip() for item in os.getenv("IARA_MODELS", "").split(",") if item.strip()]
    default = os.getenv("IARA_MODEL", "gpt-4.1-mini")
    return list(dict.fromkeys([default, *models]))


def get_client() -> Any:
    global _client
    if _client is not None:
        return _client
    client_id = os.getenv("IARA_CLIENT_ID", "").strip()
    client_secret = os.getenv("IARA_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise RuntimeError("Configure IARA_CLIENT_ID e IARA_CLIENT_SECRET em app/.env.local.")
    try:
        from iaragenai import IaraGenAI
    except ImportError as error:
        raise RuntimeError("O SDK da Iara não está instalado. Execute npm run setup:iara.") from error
    client_options = {
        "client_id": client_id,
        "client_secret": client_secret,
        "environment": os.getenv("IARA_ENVIRONMENT", "homol"),
        "provider": os.getenv("IARA_PROVIDER", "azure_openai"),
        "correlation_id": f"indev_{uuid.uuid4()}",
    }
    access_token = os.getenv("IARA_ACCESS_TOKEN", "").strip()
    if access_token:
        client_options["access_token"] = access_token
    _client = IaraGenAI(**client_options)
    return _client


def mock_response(payload: dict[str, Any]) -> dict[str, Any]:
    response_id = f"resp_indev_{uuid.uuid4().hex}"
    text = os.getenv("INDEV_IARA_MOCK_TEXT", "Iara conectada ao InDev com sucesso.")
    return {
        "id": response_id,
        "object": "response",
        "created_at": int(time.time()),
        "status": "completed",
        "model": payload.get("model", os.getenv("IARA_MODEL", "gpt-4.1-mini")),
        "output": [{
            "id": f"msg_{uuid.uuid4().hex}",
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "text": text, "annotations": []}],
        }],
        "usage": {"input_tokens": 1, "output_tokens": 8, "total_tokens": 9},
    }


def mock_events(response: dict[str, Any]) -> Iterator[dict[str, Any]]:
    output = response["output"][0]
    part = output["content"][0]
    base = {**response, "status": "in_progress", "output": []}
    yield {"type": "response.created", "response": base, "sequence_number": 0}
    yield {"type": "response.in_progress", "response": base, "sequence_number": 1}
    yield {"type": "response.output_item.added", "output_index": 0, "item": {**output, "status": "in_progress", "content": []}, "sequence_number": 2}
    yield {"type": "response.content_part.added", "item_id": output["id"], "output_index": 0, "content_index": 0, "part": {**part, "text": ""}, "sequence_number": 3}
    yield {"type": "response.output_text.delta", "item_id": output["id"], "output_index": 0, "content_index": 0, "delta": part["text"], "logprobs": [], "sequence_number": 4}
    yield {"type": "response.output_text.done", "item_id": output["id"], "output_index": 0, "content_index": 0, "text": part["text"], "logprobs": [], "sequence_number": 5}
    yield {"type": "response.content_part.done", "item_id": output["id"], "output_index": 0, "content_index": 0, "part": part, "sequence_number": 6}
    yield {"type": "response.output_item.done", "output_index": 0, "item": output, "sequence_number": 7}
    yield {"type": "response.completed", "response": response, "sequence_number": 8}


class Handler(BaseHTTPRequestHandler):
    server_version = "InDevIara/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format_string: str, *args: Any) -> None:
        sys.stdout.write(f"[iara] {format_string % args}\n")
        sys.stdout.flush()

    def send_json(self, status: int, payload: Any) -> None:
        body = json.dumps(jsonable(payload), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def authorized(self) -> bool:
        supplied = self.headers.get("Authorization", "")
        expected = f"Bearer {LOCAL_TOKEN}"
        return bool(LOCAL_TOKEN) and hmac.compare_digest(supplied, expected)

    def require_auth(self) -> bool:
        if self.authorized():
            return True
        self.send_json(401, {"error": {"type": "authentication_error", "message": "Token local inválido."}})
        return False

    def read_payload(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Corpo vazio ou acima do limite permitido.")
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("O corpo JSON deve ser um objeto.")
        return payload

    def do_GET(self) -> None:
        if self.path == "/healthz":
            sdk_available = MOCK_MODE
            if not sdk_available:
                try:
                    import iaragenai  # noqa: F401
                    sdk_available = True
                except ImportError:
                    sdk_available = False
            self.send_json(200, {
                "ready": True,
                "provider": "iara",
                "environment": os.getenv("IARA_ENVIRONMENT", "homol"),
                "backend": os.getenv("IARA_PROVIDER", "azure_openai"),
                "model": os.getenv("IARA_MODEL", "gpt-4.1-mini"),
                "credentialsConfigured": bool(os.getenv("IARA_CLIENT_ID") and os.getenv("IARA_CLIENT_SECRET")),
                "sdkAvailable": sdk_available,
                "mock": MOCK_MODE,
            })
            return
        if self.path.rstrip("/") == "/v1/models":
            if not self.require_auth():
                return
            self.send_json(200, {"object": "list", "data": [
                {"id": model, "object": "model", "owned_by": "iara"} for model in configured_models()
            ]})
            return
        self.send_json(404, {"error": {"type": "not_found", "message": "Rota não encontrada."}})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/responses":
            self.send_json(404, {"error": {"type": "not_found", "message": "Rota não encontrada."}})
            return
        if not self.require_auth():
            return
        try:
            payload = self.read_payload()
            streaming = bool(payload.pop("stream", False))
            if MOCK_MODE:
                response = mock_response(payload)
                if streaming:
                    self.send_events(mock_events(response))
                else:
                    self.send_json(200, response)
                return
            client = get_client()
            if streaming:
                with client.responses.stream(**payload) as stream:
                    self.send_events(stream)
            else:
                self.send_json(200, client.responses.create(**payload))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": {"type": "invalid_request_error", "message": str(error)}})
        except Exception as error:  # SDK normaliza erros HTTP; não expomos credenciais nem stack trace.
            status = int(getattr(error, "status_code", 0) or getattr(error, "status", 0) or 502)
            if status < 400 or status > 599:
                status = 502
            self.send_json(status, {"error": {"type": "iara_error", "message": str(error)}})

    def send_events(self, events: Iterator[Any]) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            for event in events:
                data = json.dumps(jsonable(event), ensure_ascii=False)
                self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
        except Exception as error:
            payload = {"type": "error", "error": {"type": "iara_stream_error", "message": str(error)}}
            self.wfile.write(f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8"))
            self.wfile.flush()
        self.close_connection = True


def shutdown(*_: Any) -> None:
    global _client
    if _client is not None:
        close = getattr(_client, "close", None)
        if callable(close):
            close()
    raise KeyboardInterrupt


def self_test() -> None:
    """Valida rotas, autenticação e SSE sem abrir uma porta de rede."""

    if not MOCK_MODE:
        raise RuntimeError("O autoteste exige INDEV_IARA_MOCK=1.")

    class MemoryHandler(Handler):
        def __init__(self, path: str, headers: dict[str, str] | None = None, body: bytes = b"") -> None:
            self.path = path
            self.headers = headers or {}
            self.rfile = io.BytesIO(body)
            self.wfile = io.BytesIO()
            self.status = 0
            self.response_headers: dict[str, str] = {}
            self.close_connection = False

        def send_response(self, code: int, message: str | None = None) -> None:
            self.status = code

        def send_header(self, keyword: str, value: str) -> None:
            self.response_headers[keyword.lower()] = value

        def end_headers(self) -> None:
            return

    health_handler = MemoryHandler("/healthz")
    health_handler.do_GET()
    health = json.loads(health_handler.wfile.getvalue())
    if health_handler.status != 200 or not health.get("ready") or not health.get("mock"):
        raise RuntimeError("A rota /healthz não confirmou o adaptador simulado.")

    unauthorized_handler = MemoryHandler("/v1/models")
    unauthorized_handler.do_GET()
    if unauthorized_handler.status != 401:
        raise RuntimeError(f"/v1/models retornou HTTP {unauthorized_handler.status}, esperado 401.")

    body = json.dumps({"model": configured_models()[0], "input": "teste", "stream": True}).encode("utf-8")
    streaming_handler = MemoryHandler(
        "/v1/responses",
        headers={
            "Authorization": f"Bearer {LOCAL_TOKEN}",
            "Content-Length": str(len(body)),
            "Content-Type": "application/json",
        },
        body=body,
    )
    streaming_handler.do_POST()
    events = streaming_handler.wfile.getvalue().decode("utf-8")
    if streaming_handler.status != 200 or streaming_handler.response_headers.get("content-type") != "text/event-stream":
        raise RuntimeError("A rota /v1/responses não iniciou o streaming SSE.")
    for expected in ("response.output_text.delta", "response.completed", "data: [DONE]"):
        if expected not in events:
            raise RuntimeError(f"O streaming não contém {expected!r}.")
    print("OK: adaptador Iara autenticado e compatível com Responses streaming", flush=True)


if __name__ == "__main__":
    if not LOCAL_TOKEN:
        raise SystemExit("INDEV_IARA_PROXY_TOKEN não foi definido.")
    if "--self-test" in sys.argv:
        self_test()
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[iara] Adaptador local pronto em http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()
