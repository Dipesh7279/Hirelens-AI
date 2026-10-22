import io
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import httpx
from docx import Document
from google.genai.errors import APIError

from app.services import gemini_client


def _api_error(code):
    return APIError(code, {"error": {"code": code, "message": "temporary test error"}})


def test_retry_after_hint_is_respected_and_capped():
    seconds_error = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "30"}))
    milliseconds_error = SimpleNamespace(response=SimpleNamespace(headers={"retry-after-ms": "1200"}))
    assert gemini_client._retry_delay_seconds(seconds_error, 0) == gemini_client.MAX_RETRY_DELAY_SECONDS
    assert gemini_client._retry_delay_seconds(milliseconds_error, 0) == 1.2


def test_retry_after_http_date_is_parsed(monkeypatch):
    class FixedDateTime:
        @staticmethod
        def now(_tz):
            from datetime import datetime, timezone
            return datetime(2026, 10, 21, 0, 0, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(gemini_client, "datetime", FixedDateTime)
    error = SimpleNamespace(response=SimpleNamespace(headers={"Retry-After": "Wed, 21 Oct 2026 00:00:03 GMT"}))
    assert gemini_client._retry_delay_seconds(error, 0) == 2


def test_gemini_client_configures_a_bounded_http_timeout(monkeypatch):
    constructed = Mock()
    monkeypatch.setattr(gemini_client, "get_settings", lambda: SimpleNamespace(GEMINI_API_KEY="test-only-dummy"))
    monkeypatch.setattr(gemini_client.genai, "Client", constructed)
    monkeypatch.setattr(gemini_client, "_client", None)

    gemini_client.get_client()

    options = constructed.call_args.kwargs["http_options"]
    assert options.timeout == gemini_client.GEMINI_REQUEST_TIMEOUT_MS


def _docx_bytes():
    document = Document()
    document.add_paragraph(
        "Experienced software engineer with Python, APIs, databases, and project delivery. "
        "Built several applications and collaborated with engineering teams."
    )
    stream = io.BytesIO()
    document.save(stream)
    return stream.getvalue()


def test_gemini_client_retries_503_then_returns_json(monkeypatch):
    generate = Mock(side_effect=[_api_error(503), Mock(output_text='{"ok": true}')])
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))
    monkeypatch.setattr(gemini_client.time, "sleep", lambda _delay: None)

    result = gemini_client.call_gemini_json("system", "user")

    assert result == {"ok": True}
    assert generate.call_count == 2


def test_gemini_client_uses_configured_text_model(monkeypatch):
    generate = Mock(return_value=Mock(output_text='{"ok": true}'))
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "gemini-2.5-flash")

    assert gemini_client.call_gemini_json("system", "user") == {"ok": True}
    assert generate.call_args.kwargs["model"] == "gemini-2.5-flash"
    assert generate.call_args.kwargs["input"] == "user"
    assert generate.call_args.kwargs["system_instruction"] == "system"
    assert generate.call_args.kwargs["response_format"] == {
        "type": "text",
        "mime_type": "application/json",
    }
    assert generate.call_args.kwargs["store"] is False


def test_gemini_client_falls_back_from_retired_flash_model_on_404(monkeypatch):
    generate = Mock(side_effect=[_api_error(404), Mock(output_text='{"ok": true}')])
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "gemini-2.5-flash")

    assert gemini_client.call_gemini_json("system", "user") == {"ok": True}
    assert [call.kwargs["model"] for call in generate.call_args_list] == [
        "gemini-2.5-flash", "gemini-3.8-flash",
    ]


def test_gemini_client_handles_compat_not_found_error_with_model_fallback(monkeypatch):
    try:
        from google.genai._gaos.lib import compat_errors
    except ImportError:
        pytest.skip("compat_errors not available in current environment")
    mock_resp = Mock(status_code=404, request=Mock(), headers={})
    compat_error = compat_errors.NotFoundError("model not found", response=mock_resp, body={"error": {"code": 404}})
    generate = Mock(side_effect=[compat_error, Mock(output_text='{"ok": true}')])
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "gemini-2.5-flash")

    assert gemini_client.call_gemini_json("system", "user") == {"ok": True}
    assert [call.kwargs["model"] for call in generate.call_args_list] == [
        "gemini-2.5-flash", "gemini-3.8-flash",
    ]


def test_gemini_client_retries_compat_timeout_error(monkeypatch):
    try:
        from google.genai._gaos.lib import compat_errors
    except ImportError:
        pytest.skip("compat_errors not available in current environment")
    compat_timeout = compat_errors.APITimeoutError(Mock())
    generate = Mock(side_effect=[compat_timeout, Mock(output_text='{"ok": true}')])
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))
    monkeypatch.setattr(gemini_client.time, "sleep", lambda _delay: None)

    assert gemini_client.call_gemini_json("system", "user") == {"ok": True}
    assert generate.call_count == 2


def test_gemini_client_does_not_switch_models_on_invalid_request(monkeypatch):
    generate = Mock(side_effect=_api_error(400))
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "gemini-3-flash-preview")

    with pytest.raises(gemini_client.GeminiAPIError) as raised:
        gemini_client.call_gemini_json("system", "user")

    assert raised.value.status_code == 400
    assert generate.call_count == 1


def test_gemini_client_does_not_retry_invalid_model(monkeypatch):
    generate = Mock(side_effect=_api_error(404))
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "invalid-test-model")

    with pytest.raises(gemini_client.GeminiAPIError) as raised:
        gemini_client.call_gemini_json("system", "user")

    assert raised.value.status_code == 404
    assert generate.call_count == 1


def test_gemini_default_model_is_supported_text_model():
    from app.core.config import DEFAULT_GEMINI_MODEL

    assert DEFAULT_GEMINI_MODEL == "gemini-3.8-flash"


def test_gemini_client_logs_safe_non_transient_error_details(monkeypatch, caplog):
    caplog.set_level("INFO", logger=gemini_client.__name__)
    provider_error = APIError(400, {
        "error": {
            "code": 400,
            "message": "private provider diagnostic",
            "status": "INVALID_ARGUMENT",
            "details": [{
                "fieldViolations": [{
                    "field": "generationConfig.responseMimeType",
                    "description": "private request detail",
                }],
            }],
        },
    })
    generate = Mock(side_effect=provider_error)
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "test-model")

    with pytest.raises(gemini_client.GeminiAPIError) as raised:
        gemini_client.call_gemini_json("system", "user")

    assert raised.value.status_code == 400
    assert "private provider diagnostic" not in str(raised.value)
    assert "test-model with HTTP 400" in caplog.text
    assert "provider_status=INVALID_ARGUMENT" in caplog.text
    assert "google-genai=" in caplog.text
    assert "invalid_fields=generationConfig.responseMimeType" in caplog.text
    assert "private request detail" not in caplog.text
    assert "private provider diagnostic" not in caplog.text
    assert generate.call_count == 1


def test_gemini_client_retries_malformed_json_only_within_limit(monkeypatch):
    generate = Mock(side_effect=[
        Mock(output_text="not json"),
        Mock(output_text="still not json"),
        Mock(output_text="also not json"),
    ])
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))

    with pytest.raises(gemini_client.GeminiJSONError):
        gemini_client.call_gemini_json("system", "user")
    assert generate.call_count == 3


def test_gemini_client_returns_503_after_bounded_retries(monkeypatch):
    generate = Mock(side_effect=[_api_error(503), _api_error(503), _api_error(503)])
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))
    monkeypatch.setattr(gemini_client.time, "sleep", lambda _delay: None)

    with pytest.raises(gemini_client.GeminiAPIError, match="temporarily unavailable") as raised:
        gemini_client.call_gemini_json("system", "user")

    assert raised.value.status_code == 503
    assert generate.call_count == 3


def test_gemini_client_retries_network_timeout_with_bounded_attempts(monkeypatch):
    generate = Mock(side_effect=[httpx.ReadTimeout("test timeout"), Mock(output_text='{"ok": true}')])
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))
    monkeypatch.setattr(gemini_client.time, "sleep", lambda _delay: None)

    assert gemini_client.call_gemini_json("system", "user") == {"ok": True}
    assert generate.call_count == 2


def test_gemini_client_stops_after_bounded_network_timeout_retries(monkeypatch):
    generate = Mock(side_effect=httpx.ReadTimeout("synthetic timeout"))
    monkeypatch.setattr(gemini_client, "get_client", lambda: Mock(interactions=Mock(create=generate)))
    monkeypatch.setattr(gemini_client.time, "sleep", lambda _delay: None)

    with pytest.raises(gemini_client.GeminiAPIError, match="temporarily unavailable") as raised:
        gemini_client.call_gemini_json("system", "user")
    assert raised.value.status_code == 503
    assert generate.call_count == 3


def test_resume_route_discloses_fallback_parse_mode(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import resume

    from app.models.resume_schema import ResumeParsed

    monkeypatch.setattr(
        resume,
        "structure_resume_with_mode",
        lambda _raw_text: (ResumeParsed(skills=["python"]), "heuristic_fallback"),
    )
    client = TestClient(app)
    response = client.post(
        "/ai/resume/parse",
        files={"file": ("resume.docx", _docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )

    assert response.status_code == 200
    assert response.json()["parsingMode"] == "heuristic_fallback"
    assert response.json()["parsed"]["skills"] == ["python"]


def test_resume_fallback_logs_safe_provider_status_without_resume_text(monkeypatch, caplog):
    from app.services import resume_structurer

    def unavailable(*_args, **_kwargs):
        raise gemini_client.GeminiAPIError("temporarily unavailable", status_code=429)

    monkeypatch.setattr(resume_structurer, "call_gemini_json", unavailable)
    resume_structurer.structure_resume_with_mode("Synthetic private resume text")

    assert "status=429" in caplog.text
    assert "Synthetic private resume text" not in caplog.text


def test_gemini_client_does_not_retry_rate_limit_429(monkeypatch):
    generate = Mock(side_effect=_api_error(429))
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)

    with pytest.raises(gemini_client.GeminiAPIError) as raised:
        gemini_client.call_gemini_json("system", "user")

    assert raised.value.status_code == 429
    assert generate.call_count == 1


def test_consecutive_parses_first_succeeds_second_falls_back_on_rate_limit(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services import gemini_client

    gemini_responses = [
        Mock(output_text='{"skills": ["python", "node"], "education": [], "experience": [], "projects": []}'),
        _api_error(429),
    ]
    generate = Mock(side_effect=gemini_responses)
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)

    test_client = TestClient(app)

    # First attempt: Gemini responds with structured JSON
    resp1 = test_client.post(
        "/ai/resume/parse",
        files={"file": ("resume.docx", _docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert resp1.status_code == 200
    assert resp1.json()["parsingMode"] == "gemini"
    assert "python" in [s.lower() for s in resp1.json()["parsed"]["skills"]]

    # Second attempt: Gemini hits rate limit (429) -> immediately falls back without hanging
    resp2 = test_client.post(
        "/ai/resume/parse",
        files={"file": ("resume.docx", _docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert resp2.status_code == 200
    assert resp2.json()["parsingMode"] == "heuristic_fallback"
    assert "python" in [s.lower() for s in resp2.json()["parsed"]["skills"]]
    assert generate.call_count == 2


def test_gemini_client_raises_401_for_missing_or_placeholder_key(monkeypatch):
    monkeypatch.setattr(gemini_client, "_client", None)
    monkeypatch.setattr(gemini_client, "get_settings", lambda: SimpleNamespace(GEMINI_API_KEY=""))
    with pytest.raises(gemini_client.GeminiAPIError) as empty_raised:
        gemini_client.get_client()
    assert empty_raised.value.status_code == 401

    monkeypatch.setattr(gemini_client, "_client", None)
    monkeypatch.setattr(gemini_client, "get_settings", lambda: SimpleNamespace(GEMINI_API_KEY="replace_with_gemini_key"))
    with pytest.raises(gemini_client.GeminiAPIError) as placeholder_raised:
        gemini_client.get_client()
    assert placeholder_raised.value.status_code == 401


def test_resume_pipeline_returns_gemini_api_key_invalid_when_key_unconfigured(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.services import gemini_client

    monkeypatch.setattr(gemini_client, "_client", None)
    monkeypatch.setattr(gemini_client, "get_settings", lambda: SimpleNamespace(GEMINI_API_KEY=""))

    client = TestClient(app)
    response = client.post(
        "/ai/resume/parse",
        files={"file": ("resume.docx", _docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert response.status_code == 503
    assert response.headers["x-error-code"] == "GEMINI_API_KEY_INVALID"


def test_call_gemini_json_handles_code_fenced_and_whitespace_responses(monkeypatch):
    fenced_output = "```json\n{\n  \"skills\": [\"python\", \"fastapi\"],\n  \"education\": [],\n  \"experience\": [],\n  \"projects\": []\n}\n```"
    generate = Mock(return_value=Mock(output_text=fenced_output))
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)

    result = gemini_client.call_gemini_json("system", "user")
    assert result == {
        "skills": ["python", "fastapi"],
        "education": [],
        "experience": [],
        "projects": [],
    }


def test_gemini_client_disables_gaos_internal_retry_strategy(monkeypatch):
    monkeypatch.setattr(gemini_client, "_client", None)
    monkeypatch.setattr(gemini_client, "get_settings", lambda: SimpleNamespace(GEMINI_API_KEY="test-key-for-retry-config", GEMINI_MODEL="gemini-3.8-flash"))
    client = gemini_client.get_client()
    assert hasattr(client, "interactions")
    assert client.interactions.sdk_configuration.retry_config.strategy == "none"


def test_call_gemini_json_passes_timeout_parameter_to_create(monkeypatch):
    generate = Mock(return_value=Mock(output_text='{"ok": true}'))
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)

    gemini_client.call_gemini_json("system", "user")
    assert "timeout" in generate.call_args.kwargs
    assert generate.call_args.kwargs["timeout"] == gemini_client.GEMINI_REQUEST_TIMEOUT_MS / 1000


def test_call_gemini_json_does_not_sleep_on_rate_limit_with_retry_after(monkeypatch):
    try:
        from google.genai._gaos.lib import compat_errors
    except ImportError:
        pytest.skip("compat_errors not available in current environment")

    mock_resp = Mock(status_code=429, request=Mock(), headers={"Retry-After": "58653"})
    rate_limit_error = compat_errors.RateLimitError("Quota exceeded", response=mock_resp, body={"error": {"code": 429}})
    generate = Mock(side_effect=rate_limit_error)
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)

    sleep_mock = Mock()
    monkeypatch.setattr(gemini_client.time, "sleep", sleep_mock)

    with pytest.raises(gemini_client.GeminiAPIError) as raised:
        gemini_client.call_gemini_json("system", "user")

    assert raised.value.status_code == 429
    assert generate.call_count == 1
    # Verify sleep was never called for 429 rate limit
    assert sleep_mock.call_count == 0


def test_gemini_client_falls_back_from_3_8_flash_to_preview_on_503(monkeypatch):
    generate = Mock(side_effect=[_api_error(503), Mock(output_text='{"recovered": true}')])
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "gemini-3.8-flash")

    result = gemini_client.call_gemini_json("system", "user")
    assert result == {"recovered": True}
    assert [call.kwargs["model"] for call in generate.call_args_list] == [
        "gemini-3.8-flash", "gemini-3-flash-preview",
    ]


def test_gemini_client_falls_back_from_3_8_flash_to_preview_on_timeout(monkeypatch):
    generate = Mock(side_effect=[httpx.ReadTimeout("read timeout"), Mock(output_text='{"recovered": true}')])
    client = Mock(interactions=Mock(create=generate))
    monkeypatch.setattr(gemini_client, "get_client", lambda: client)
    monkeypatch.setattr(gemini_client.settings, "GEMINI_MODEL", "gemini-3.8-flash")

    result = gemini_client.call_gemini_json("system", "user")
    assert result == {"recovered": True}
    assert [call.kwargs["model"] for call in generate.call_args_list] == [
        "gemini-3.8-flash", "gemini-3-flash-preview",
    ]




