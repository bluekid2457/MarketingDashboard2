"""End-to-end wire-format test for the LinkedIn publish pipeline.

Proves that the bytes actually written into the HTTP payload sent to
``https://api.linkedin.com/v2/ugcPosts`` contain Math-Sans Unicode
glyphs (NOT raw markdown asterisks) when a caller drives the publish
pipeline starting at the FastAPI route, all the way down through
``publish_linkedin_text``, with the network layer mocked at
``httpx.AsyncClient.post``.

If this test passes but the user's real LinkedIn post still shows
``**bold**`` characters, the bug is environmental (stale uvicorn) and
NOT in the application code.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

from app.routers import publish as publish_router
from app.routers.publish import LinkedInPublishRequest, publish_linkedin_now


class _FakeResponse:
    """Minimal stand-in for httpx.Response used by publish_linkedin_text."""

    def __init__(self, status_code: int, body: dict[str, Any], headers: dict[str, str] | None = None):
        self.status_code = status_code
        self._body = body
        self.headers = headers or {}
        self.text = json.dumps(body)

    def json(self) -> dict[str, Any]:
        return self._body


@pytest.fixture()
def captured_linkedin_payload(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Mock every external boundary inside publish_linkedin_text:

    - Token decryption (returns a fake bearer token).
    - Firestore-backed author URN lookup (returns a fake URN).
    - ``httpx.AsyncClient.post`` — captures the JSON payload that would
      have been sent to LinkedIn.
    """
    captured: dict[str, Any] = {}

    from app.services import linkedin_publisher

    # 1) Stub token decryption.
    monkeypatch.setattr(
        linkedin_publisher.integration_connection_service,
        "get_decrypted_access_token",
        lambda user_id, provider: "fake-bearer-token",
    )

    # 2) Stub author URN read.
    monkeypatch.setattr(
        linkedin_publisher,
        "_read_publish_author_urn",
        lambda user_id: "urn:li:person:FAKE_AUTHOR",
    )

    # 3) Replace httpx.AsyncClient with a tiny stub that records the
    #    JSON body of the post call.
    class _FakeAsyncClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self._timeout = kwargs.get("timeout")

        async def __aenter__(self) -> "_FakeAsyncClient":
            return self

        async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            return None

        async def post(self, url: str, *, json: dict[str, Any], headers: dict[str, str]) -> _FakeResponse:
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            # Mimic LinkedIn's success envelope.
            return _FakeResponse(
                status_code=201,
                body={"id": "urn:li:share:1"},
                headers={"x-restli-id": "urn:li:share:1"},
            )

    monkeypatch.setattr(linkedin_publisher.httpx, "AsyncClient", _FakeAsyncClient)

    return captured


def _run(coro: Any) -> Any:
    return asyncio.new_event_loop().run_until_complete(coro)


def _drive_route(text: str) -> dict[str, Any]:
    body = LinkedInPublishRequest.model_validate({"userId": "uid-1", "text": text, "visibility": "PUBLIC"})
    return _run(publish_linkedin_now(body=body, verified_uid="uid-1"))


def test_endtoend_user_bug_input_emits_unicode_to_linkedin(captured_linkedin_payload: dict[str, Any]) -> None:
    """The exact input the user reported as failing on LinkedIn."""
    response = _drive_route("**sdf**")
    assert response["success"] is True

    # The actual JSON body sent to LinkedIn must contain Math-Sans Bold
    # codepoints and MUST NOT contain raw markdown asterisks.
    share_text = captured_linkedin_payload["json"]["specificContent"][
        "com.linkedin.ugc.ShareContent"
    ]["shareCommentary"]["text"]
    assert share_text == "\U0001D600\U0001D5F1\U0001D5F3", repr(share_text)
    assert "**" not in share_text


def test_endtoend_spaced_bold_input(captured_linkedin_payload: dict[str, Any]) -> None:
    """`** sdf **` (with internal spaces) must also convert."""
    response = _drive_route("** sdf **")
    assert response["success"] is True

    share_text = captured_linkedin_payload["json"]["specificContent"][
        "com.linkedin.ugc.ShareContent"
    ]["shareCommentary"]["text"]
    # Spaces inside delimiters pass through; letters become Math-Sans.
    assert share_text == " \U0001D600\U0001D5F1\U0001D5F3 ", repr(share_text)
    assert "**" not in share_text


def test_endtoend_realistic_post_body(captured_linkedin_payload: dict[str, Any]) -> None:
    """A realistic mixed post with heading, bold, italic, hashtag, link."""
    response = _drive_route(
        "# Headline\n\nA **big** announcement with *style* and #marketing — see [our blog](https://example.com)."
    )
    assert response["success"] is True

    share_text = captured_linkedin_payload["json"]["specificContent"][
        "com.linkedin.ugc.ShareContent"
    ]["shareCommentary"]["text"]
    assert "**" not in share_text
    assert "*style*" not in share_text
    # Heading and bold convert (sample one Math-Sans codepoint each).
    assert "\U0001D5DB" in share_text  # 'H' in Math Sans Bold (heading)
    assert "\U0001D5EF" in share_text  # 'b' in Math Sans Bold ("big")
    # Hashtag stays plain ASCII (so LinkedIn entity-recognises it).
    assert "#marketing" in share_text
    # Link renders as "text (url)".
    assert "(https://example.com)" in share_text


def test_endtoend_plain_text_passes_through_unchanged(captured_linkedin_payload: dict[str, Any]) -> None:
    """Plain text without markdown must not be modified."""
    response = _drive_route("plain text without markup")
    assert response["success"] is True

    share_text = captured_linkedin_payload["json"]["specificContent"][
        "com.linkedin.ugc.ShareContent"
    ]["shareCommentary"]["text"]
    assert share_text == "plain text without markup"
