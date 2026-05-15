"""Wire-format regression tests for the LinkedIn publish router.

These tests guarantee that the ``POST /publish/linkedin/now`` handler
applies ``markdown_to_linkedin_unicode`` to the request body BEFORE
delegating to ``publish_linkedin_text``. Without these, a future refactor
that drops the converter call would silently regress to literal
``**bold**`` showing up on the LinkedIn feed even when the frontend
wrapper is also accidentally dropped.

We do NOT spin up a TestClient here — the route depends on Firebase auth
and the Firestore client. Instead we call the async handler function
directly with a fake body, and monkey-patch the publisher so we can
capture exactly what ``text`` was forwarded.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.routers import publish as publish_router
from app.routers.publish import LinkedInPublishRequest, publish_linkedin_now


def _run(coro: Any) -> Any:
    return asyncio.new_event_loop().run_until_complete(coro)


def _success_outcome() -> dict[str, Any]:
    return {
        "success": True,
        "postUrn": "urn:li:share:1",
        "postUrl": "https://www.linkedin.com/feed/update/urn%3Ali%3Ashare%3A1",
    }


@pytest.fixture()
def captured_publish(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Patch ``publish_linkedin_text`` to capture the ``text`` it receives."""
    captured: dict[str, Any] = {}

    async def fake_publish_linkedin_text(*, user_id: str, text: str, visibility: str) -> dict[str, Any]:
        captured["user_id"] = user_id
        captured["text"] = text
        captured["visibility"] = visibility
        return _success_outcome()

    monkeypatch.setattr(publish_router, "publish_linkedin_text", fake_publish_linkedin_text)
    return captured


def _call_handler(text: str) -> dict[str, Any]:
    body = LinkedInPublishRequest.model_validate({"userId": "uid-1", "text": text, "visibility": "PUBLIC"})
    # `verify_firebase_id_token` is a FastAPI dependency injected at request
    # time; calling the handler function directly we pass `verified_uid`
    # ourselves, matching what the dependency would have resolved to.
    return _run(publish_linkedin_now(body=body, verified_uid="uid-1"))


def test_router_converts_simple_bold(captured_publish: dict[str, Any]) -> None:
    response = _call_handler("**sdf**")
    assert response["success"] is True
    # The publisher must NEVER see raw markdown asterisks.
    assert "**" not in captured_publish["text"]
    # Specifically: Math-Sans Bold 's', 'd', 'f'.
    assert captured_publish["text"] == "\U0001D600\U0001D5F1\U0001D5F3"


def test_router_converts_user_reported_input(captured_publish: dict[str, Any]) -> None:
    # The exact input from the bug report.
    response = _call_handler("** sdf **")
    assert response["success"] is True
    assert "**" not in captured_publish["text"]
    # Spaces inside the delimiters pass through unchanged; the converter
    # only substitutes the asterisks themselves.
    assert captured_publish["text"] == " \U0001D600\U0001D5F1\U0001D5F3 "


def test_router_passes_plain_text_through_unchanged(captured_publish: dict[str, Any]) -> None:
    response = _call_handler("plain text without markup")
    assert response["success"] is True
    assert captured_publish["text"] == "plain text without markup"


def test_router_converts_mid_sentence_bold(captured_publish: dict[str, Any]) -> None:
    response = _call_handler("hello **world** ok")
    assert response["success"] is True
    assert "**" not in captured_publish["text"]
    assert captured_publish["text"] == "hello \U0001D604\U0001D5FC\U0001D5FF\U0001D5F9\U0001D5F1 ok"
