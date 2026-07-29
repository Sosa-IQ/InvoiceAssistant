import json
import logging
from datetime import UTC, datetime
from typing import Any

import sentry_sdk

from app.config import settings

_SAFE_LOG_FIELDS = (
    "request_id",
    "method",
    "path",
    "status_code",
    "duration_ms",
    "exception_type",
)


class JsonFormatter(logging.Formatter):
    """Format logs as JSON while deliberately excluding arbitrary extras."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        for field in _SAFE_LOG_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        exc_type = record.exc_info[0] if record.exc_info else None
        if exc_type is not None:
            payload["exception_type"] = exc_type.__name__
        return json.dumps(payload, separators=(",", ":"), default=str)


def configure_logging() -> None:
    root = logging.getLogger()
    if any(getattr(handler, "_invoice_assistant_json", False) for handler in root.handlers):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler._invoice_assistant_json = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))


def _scrub_sentry_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("data", None)
        request.pop("cookies", None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                key: value
                for key, value in headers.items()
                if key.lower() not in {"authorization", "cookie", "set-cookie"}
            }
    event.pop("user", None)
    for container_name in ("exception", "threads"):
        container = event.get(container_name)
        if not isinstance(container, dict):
            continue
        values = container.get("values")
        if not isinstance(values, list):
            continue
        for value in values:
            if not isinstance(value, dict):
                continue
            stacktrace = value.get("stacktrace")
            if not isinstance(stacktrace, dict):
                continue
            frames = stacktrace.get("frames")
            if isinstance(frames, list):
                for frame in frames:
                    if isinstance(frame, dict):
                        frame.pop("vars", None)
    return event


def configure_sentry() -> None:
    if not settings.sentry_dsn:
        return
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_environment,
        include_local_variables=False,
        send_default_pii=False,
        max_request_body_size="never",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=_scrub_sentry_event,
    )
