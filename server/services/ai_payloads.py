"""Normalize AI request payloads from the extension and legacy clients."""
from __future__ import annotations

from typing import Any


def _pick(payload: dict[str, Any], *keys: str, default: Any = "") -> Any:
    for key in keys:
        value = payload.get(key)
        if value is not None and value != "":
            return value
    return default


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def normalize_heal_payload(payload: Any) -> dict:
    """Accept both extension camelCase and legacy snake_case heal payloads."""
    if not isinstance(payload, dict):
        payload = {}

    return {
        "failed_selector": str(
            _pick(payload, "failed_selector", "failedSelector", "selector", default="") or ""
        ),
        "selector_fallbacks": _as_list(
            _pick(payload, "selector_fallbacks", "selectorFallbacks", default=[])
        ),
        "step_type": str(_pick(payload, "step_type", "stepType", default="") or ""),
        "page_url": str(_pick(payload, "page_url", "pageUrl", default="") or ""),
        "html_context": str(
            _pick(payload, "html_context", "htmlContext", "domContext", default="") or ""
        ),
        "element_description": str(
            _pick(
                payload,
                "element_description",
                "elementDescription",
                default="",
            )
            or ""
        ),
    }


def normalize_generate_payload(payload: Any) -> dict:
    """Accept both extension camelCase and legacy snake_case generation payloads."""
    if not isinstance(payload, dict):
        payload = {}

    return {
        "elements": _as_list(_pick(payload, "elements", "interactives", default=[])),
        "page_url": str(_pick(payload, "page_url", "pageUrl", default="") or ""),
        "page_title": str(_pick(payload, "page_title", "pageTitle", default="") or ""),
    }
