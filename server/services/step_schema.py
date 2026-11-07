"""Recorded step schema validation and normalization.

The extension owns the authoring format.  The server only accepts a small,
explicit contract so invalid or oversized payloads cannot silently enter a
case.  Legacy step fields are preserved, while screenshot bytes are always
removed (screenshots belong in StepSnapshot, never inside TestCase.steps).
"""
from __future__ import annotations


from __future__ import annotations

import json
from typing import Any


MAX_STEPS = 5000
MAX_STEP_BYTES = 512 * 1024
MAX_SELECTOR_LENGTH = 2000
MAX_FALLBACKS = 20
MAX_TEXT_LENGTH = 5000
MAX_ELEMENT_TEXT = 500
MAX_VALUES = 100

ALLOWED_STEP_TYPES = frozenset({
    "click",
    "input",
    "wait",
    "submit",
    "change",
    "toggle",
    "scroll",
    "setOptions",
    "press",
    "navigate",
    "assert",
})

_STRING_FIELDS = {
    "id": 128,
    "caseId": 128,
    "clientStepId": 128,
    "description": MAX_TEXT_LENGTH,
    "visualDescription": MAX_TEXT_LENGTH,
    "text": MAX_TEXT_LENGTH,
    "value": MAX_TEXT_LENGTH,
    "inputType": 64,
    "url": MAX_SELECTOR_LENGTH,
    "fromUrl": MAX_SELECTOR_LENGTH,
    "pageUrl": MAX_SELECTOR_LENGTH,
    "pageTitle": MAX_TEXT_LENGTH,
    "snapshotId": 128,
    "key": 64,
    "code": 64,
    "assertKind": 32,
}

_ELEMENT_STRING_FIELDS = {
    "tag": 64,
    "id": 256,
    "className": 1000,
    "role": 128,
    "ariaLabel": MAX_TEXT_LENGTH,
    "name": 256,
    "placeholder": MAX_TEXT_LENGTH,
    "inputType": 64,
    "testId": 256,
    "text": MAX_ELEMENT_TEXT,
}


class StepValidationError(ValueError):
    """Raised when a request contains an invalid recorded step payload."""


def _coerce_steps(raw: Any) -> list:
    if raw is None or raw == "":
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError) as exc:
            raise StepValidationError("steps 必须是合法的 JSON 数组") from exc
    if not isinstance(raw, list):
        raise StepValidationError("steps 必须是数组")
    if len(raw) > MAX_STEPS:
        raise StepValidationError(f"steps 最多允许 {MAX_STEPS} 个步骤")
    return raw


def _clean_string(value: Any, field: str, max_length: int, *, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise StepValidationError(f"{field} 必须是字符串")
    value = value.strip()
    if required and not value:
        raise StepValidationError(f"{field} 不能为空")
    if len(value) > max_length:
        raise StepValidationError(f"{field} 长度不能超过 {max_length}")
    return value


def _clean_optional_int(value: Any, field: str) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise StepValidationError(f"{field} 必须是整数")
    return value


def _normalize_element(element: Any, index: int) -> dict | None:
    if element is None:
        return None
    if not isinstance(element, dict):
        raise StepValidationError(f"步骤 {index + 1} 的 element 必须是对象")

    normalized: dict[str, Any] = {}
    for key, max_length in _ELEMENT_STRING_FIELDS.items():
        if key in element:
            normalized[key] = _clean_string(element[key], f"element.{key}", max_length)
    if "tag" not in normalized and "tagName" in element:
        normalized["tag"] = _clean_string(element["tagName"], "element.tagName", 64)

    rect = element.get("rect")
    if rect is not None:
        if not isinstance(rect, dict):
            raise StepValidationError(f"步骤 {index + 1} 的 element.rect 必须是对象")
        normalized["rect"] = {}
        for key in ("x", "y", "width", "height", "top", "left"):
            if key in rect:
                value = rect[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise StepValidationError(f"element.rect.{key} 必须是数字")
                normalized["rect"][key] = value
    return normalized or None


def normalize_steps(raw: Any) -> list[dict]:
    """Validate, trim, and return a JSON-serializable step list.

    The function intentionally keeps unknown extension fields for forward
    compatibility, but every known field is bounded.  Base64 screenshots are
    never accepted in a case payload.
    """

    steps = _coerce_steps(raw)
    normalized: list[dict] = []

    for index, step in enumerate(steps):
        if not isinstance(step, dict):
            raise StepValidationError(f"步骤 {index + 1} 必须是对象")

        step_type = _clean_string(step.get("type"), "type", 32, required=True)
        if step_type not in ALLOWED_STEP_TYPES:
            allowed = ", ".join(sorted(ALLOWED_STEP_TYPES))
            raise StepValidationError(f"步骤 {index + 1} 类型不支持: {step_type}（允许: {allowed}）")

        item = dict(step)
        item["type"] = step_type

        if "schemaVersion" in item:
            version = item["schemaVersion"]
            if isinstance(version, bool) or not isinstance(version, (int, str)):
                raise StepValidationError(f"步骤 {index + 1} 的 schemaVersion 必须是整数或字符串")
            item["schemaVersion"] = version[:16] if isinstance(version, str) else version

        selector = item.get("selector", "")
        if selector is None:
            selector = ""
        item["selector"] = _clean_string(selector, "selector", MAX_SELECTOR_LENGTH)

        if "selectorFallbacks" in item:
            fallbacks = item["selectorFallbacks"]
            if fallbacks is None:
                fallbacks = []
            if not isinstance(fallbacks, list):
                raise StepValidationError(f"步骤 {index + 1} 的 selectorFallbacks 必须是数组")
            if len(fallbacks) > MAX_FALLBACKS:
                raise StepValidationError(f"步骤 {index + 1} 的 selectorFallbacks 最多 {MAX_FALLBACKS} 项")
            item["selectorFallbacks"] = [
                _clean_string(value, "selectorFallbacks[]", MAX_SELECTOR_LENGTH)
                for value in fallbacks
                if value is not None and str(value).strip()
            ]

        if "values" in item:
            values = item["values"]
            if not isinstance(values, list):
                raise StepValidationError(f"步骤 {index + 1} 的 values 必须是数组")
            if len(values) > MAX_VALUES:
                raise StepValidationError(f"步骤 {index + 1} 的 values 最多 {MAX_VALUES} 项")
            item["values"] = [
                _clean_string(value, "values[]", MAX_TEXT_LENGTH) for value in values
            ]

        if "assertion" in item:
            assertion = item["assertion"]
            if not isinstance(assertion, dict):
                raise StepValidationError(f"步骤 {index + 1} 的 assertion 必须是对象")
            clean_assertion = dict(assertion)
            clean_assertion["kind"] = _clean_string(
                assertion.get("kind", "visible"), "assertion.kind", 32
            )
            clean_assertion["expected"] = _clean_string(
                assertion.get("expected", ""), "assertion.expected", MAX_TEXT_LENGTH
            )
            if "selector" in assertion:
                clean_assertion["selector"] = _clean_string(
                    assertion.get("selector", ""), "assertion.selector", MAX_SELECTOR_LENGTH
                )
            item["assertion"] = clean_assertion

        for field, max_length in _STRING_FIELDS.items():
            if field in item and field != "type":
                value = item[field]
                if field == "value" and isinstance(value, (int, float)) and not isinstance(value, bool):
                    value = str(value)
                item[field] = _clean_string(value, field, max_length)

        if "stepIndex" in item:
            item["stepIndex"] = _clean_optional_int(item["stepIndex"], "stepIndex")
        if "timestamp" in item and not isinstance(item["timestamp"], (str, int, float)):
            item["timestamp"] = None

        item["element"] = _normalize_element(item.get("element"), index)
        item.pop("screenshotBase64", None)

        try:
            encoded = json.dumps(item, ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError) as exc:
            raise StepValidationError(f"步骤 {index + 1} 包含不可序列化字段") from exc
        if len(encoded) > MAX_STEP_BYTES:
            raise StepValidationError(f"步骤 {index + 1} 数据过大")

        normalized.append(item)

    return normalized


def dump_steps(steps: list[dict]) -> str:
    """Serialize normalized steps for TestCase.steps."""

    return json.dumps(steps, ensure_ascii=False, separators=(",", ":"))
