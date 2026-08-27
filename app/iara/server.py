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


def response_events(value: Any) -> Iterator[dict[str, Any]]:
    """Converte uma resposta final da Iara no contrato SSE estrito do Codex."""

    response = jsonable(value)
    if not isinstance(response, dict):
        raise ValueError("A Iara retornou uma resposta em formato inválido.")
    response.setdefault("id", f"resp_indev_{uuid.uuid4().hex}")
    response.setdefault("object", "response")
    response.setdefault("created_at", int(time.time()))
    if not response.get("status"):
        response["status"] = "completed"
    output_items = response.get("output")
    if not isinstance(output_items, list):
        output_items = []
        response["output"] = output_items

    sequence = 0

    def event(event_type: str, **fields: Any) -> dict[str, Any]:
        nonlocal sequence
        result = {"type": event_type, **fields, "sequence_number": sequence}
        sequence += 1
        return result

    base = {**response, "status": "in_progress", "output": []}
    yield event("response.created", response=base)
    yield event("response.in_progress", response=base)

    for output_index, raw_item in enumerate(output_items):
        item = raw_item if isinstance(raw_item, dict) else jsonable(raw_item)
        if not isinstance(item, dict):
            continue
        item = dict(item)
        item_type = str(item.get("type", ""))
        item_id = str(item.get("id") or item.get("call_id") or f"item_{uuid.uuid4().hex}")
        item["id"] = item_id
        item.setdefault("status", "completed")
        output_items[output_index] = item
        added_item = {**item, "status": "in_progress"}
        if item_type == "message":
            added_item["content"] = []
        elif item_type == "function_call":
            added_item["arguments"] = ""
        yield event("response.output_item.added", output_index=output_index, item=added_item)

        if item_type == "message":
            content = item.get("content") if isinstance(item.get("content"), list) else []
            for content_index, raw_part in enumerate(content):
                part = raw_part if isinstance(raw_part, dict) else jsonable(raw_part)
                if not isinstance(part, dict):
                    continue
                part = dict(part)
                part_type = str(part.get("type", ""))
                if part_type == "output_text":
                    text = str(part.get("text", ""))
                    part.setdefault("annotations", [])
                    content[content_index] = part
                    item["content"] = content
                    yield event(
                        "response.content_part.added",
                        item_id=item_id,
                        output_index=output_index,
                        content_index=content_index,
                        part={**part, "text": ""},
                    )
                    if text:
                        yield event(
                            "response.output_text.delta",
                            item_id=item_id,
                            output_index=output_index,
                            content_index=content_index,
                            delta=text,
                            logprobs=[],
                        )
                    yield event(
                        "response.output_text.done",
                        item_id=item_id,
                        output_index=output_index,
                        content_index=content_index,
                        text=text,
                        logprobs=[],
                    )
                    yield event(
                        "response.content_part.done",
                        item_id=item_id,
                        output_index=output_index,
                        content_index=content_index,
                        part=part,
                    )
                elif part_type == "refusal":
                    refusal = str(part.get("refusal", ""))
                    yield event(
                        "response.content_part.added",
                        item_id=item_id,
                        output_index=output_index,
                        content_index=content_index,
                        part={**part, "refusal": ""},
                    )
                    if refusal:
                        yield event(
                            "response.refusal.delta",
                            item_id=item_id,
                            output_index=output_index,
                            content_index=content_index,
                            delta=refusal,
                        )
                    yield event(
                        "response.refusal.done",
                        item_id=item_id,
                        output_index=output_index,
                        content_index=content_index,
                        refusal=refusal,
                    )
                    yield event(
                        "response.content_part.done",
                        item_id=item_id,
                        output_index=output_index,
                        content_index=content_index,
                        part=part,
                    )
        elif item_type == "function_call":
            arguments = str(item.get("arguments", ""))
            if arguments:
                yield event(
                    "response.function_call_arguments.delta",
                    item_id=item_id,
                    output_index=output_index,
                    delta=arguments,
                )
            yield event(
                "response.function_call_arguments.done",
                item_id=item_id,
                output_index=output_index,
                name=str(item.get("name", "")),
                arguments=arguments,
            )

        yield event("response.output_item.done", output_index=output_index, item=item)

    terminal_type = {
        "completed": "response.completed",
        "failed": "response.failed",
    }.get(str(response.get("status")), "response.incomplete")
    yield event(terminal_type, response=response)


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
            response = mock_response(payload) if MOCK_MODE else get_client().responses.create(**payload)
            if streaming:
                self.send_events(response_events(response))
            else:
                self.send_json(200, response)
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
    if events.index("response.output_item.added") > events.index("response.output_text.delta"):
        raise RuntimeError("O delta de texto foi enviado antes da abertura do item.")

    function_response = {
        "id": "resp_tool_test",
        "status": "completed",
        "output": [{
            "id": "fc_test",
            "type": "function_call",
            "status": "completed",
            "call_id": "call_test",
            "name": "ler_arquivo",
            "arguments": "{\"path\":\"teste.txt\"}",
        }],
    }
    function_event_types = [event["type"] for event in response_events(function_response)]
    expected_function_events = [
        "response.output_item.added",
        "response.function_call_arguments.delta",
        "response.function_call_arguments.done",
        "response.output_item.done",
    ]
    if any(event_type not in function_event_types for event_type in expected_function_events):
        raise RuntimeError("O streaming normalizado não preservou a chamada de tool.")
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
