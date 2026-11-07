import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.step_schema import (  # noqa: E402
    ALLOWED_STEP_TYPES,
    MAX_STEPS,
    StepValidationError,
    dump_steps,
    normalize_steps,
)


class StepSchemaTests(unittest.TestCase):
    def test_normalizes_and_strips_screenshot_bytes(self):
        raw = json.dumps([
            {
                "type": "input",
                "selector": "#name",
                "selectorFallbacks": ["input[name=name]", ""],
                "value": "Ada",
                "schemaVersion": 2,
                "clientStepId": "c1",
                "element": {
                    "tagName": "input",
                    "text": "Name",
                    "rect": {"x": 1, "y": 2, "width": 3, "height": 4},
                },
                "screenshotBase64": "SHOULD_BE_REMOVED",
            }
        ])

        steps = normalize_steps(raw)

        self.assertEqual(len(steps), 1)
        self.assertNotIn("screenshotBase64", steps[0])
        self.assertEqual(steps[0]["schemaVersion"], 2)
        self.assertEqual(steps[0]["selectorFallbacks"], ["input[name=name]"])
        self.assertEqual(steps[0]["element"]["tag"], "input")
        self.assertEqual(json.loads(dump_steps(steps))[0]["clientStepId"], "c1")

    def test_accepts_every_supported_step_type(self):
        steps = normalize_steps([
            {"type": step_type, "selector": "#x"} for step_type in sorted(ALLOWED_STEP_TYPES)
        ])
        self.assertEqual({step["type"] for step in steps}, set(ALLOWED_STEP_TYPES))

    def test_accepts_navigate_value_and_url_assertion(self):
        steps = normalize_steps([
            {"type": "navigate", "value": "https://example.com"},
            {"type": "assert", "assertion": {"kind": "url", "expected": "example"}},
        ])
        self.assertEqual(steps[0]["value"], "https://example.com")
        self.assertEqual(steps[1]["assertion"]["kind"], "url")

    def test_accepts_numeric_wait_value(self):
        steps = normalize_steps([{"type": "wait", "value": 500}])
        self.assertEqual(steps[0]["value"], "500")

    def test_rejects_unknown_type(self):
        with self.assertRaises(StepValidationError):
            normalize_steps([{"type": "unknown", "selector": "#x"}])

    def test_rejects_non_list_payload(self):
        with self.assertRaises(StepValidationError):
            normalize_steps({"type": "click"})

    def test_rejects_too_many_steps(self):
        with self.assertRaises(StepValidationError):
            normalize_steps([{"type": "wait"}] * (MAX_STEPS + 1))

    def test_rejects_oversized_element_text(self):
        with self.assertRaises(StepValidationError):
            normalize_steps([{"type": "click", "selector": "#x", "element": {"text": "x" * 600}}])


if __name__ == "__main__":
    unittest.main()
