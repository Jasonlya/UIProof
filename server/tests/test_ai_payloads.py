import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.ai_payloads import (  # noqa: E402
    normalize_generate_payload,
    normalize_heal_payload,
)


class AiPayloadTests(unittest.TestCase):
    def test_heal_accepts_extension_fields(self):
        normalized = normalize_heal_payload(
            {
                "selector": "button.old",
                "selectorFallbacks": ["[data-testid='submit']"],
                "stepType": "click",
                "pageUrl": "https://example.com",
                "domContext": "<button>提交</button>",
            }
        )

        self.assertEqual(normalized["failed_selector"], "button.old")
        self.assertEqual(normalized["selector_fallbacks"], ["[data-testid='submit']"])
        self.assertEqual(normalized["step_type"], "click")
        self.assertEqual(normalized["page_url"], "https://example.com")
        self.assertEqual(normalized["html_context"], "<button>提交</button>")

    def test_heal_accepts_legacy_fields(self):
        normalized = normalize_heal_payload(
            {
                "failed_selector": "button.old",
                "html_context": "<button>提交</button>",
                "element_description": "提交按钮",
            }
        )

        self.assertEqual(normalized["failed_selector"], "button.old")
        self.assertEqual(normalized["html_context"], "<button>提交</button>")
        self.assertEqual(normalized["element_description"], "提交按钮")

    def test_heal_is_safe_for_invalid_input(self):
        normalized = normalize_heal_payload(
            {"selector": None, "selectorFallbacks": "not-a-list"}
        )

        self.assertEqual(normalized["failed_selector"], "")
        self.assertEqual(normalized["selector_fallbacks"], [])
        self.assertEqual(normalize_heal_payload(None)["html_context"], "")

    def test_generate_accepts_extension_fields(self):
        normalized = normalize_generate_payload(
            {
                "interactives": [{"tag": "button", "text": "提交"}],
                "pageUrl": "https://example.com",
                "pageTitle": "示例",
            }
        )

        self.assertEqual(normalized["elements"][0]["tag"], "button")
        self.assertEqual(normalized["page_url"], "https://example.com")
        self.assertEqual(normalized["page_title"], "示例")

    def test_generate_accepts_legacy_fields(self):
        normalized = normalize_generate_payload(
            {
                "elements": [{"tag": "input", "text": "名称"}],
                "page_url": "https://example.com",
                "page_title": "示例",
            }
        )

        self.assertEqual(normalized["elements"][0]["tag"], "input")
        self.assertEqual(normalized["page_url"], "https://example.com")

    def test_ai_heal_blueprint_is_not_registered(self):
        routes_init = (
            Path(__file__).resolve().parents[1] / "routes" / "__init__.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("ai_heal", routes_init)
        self.assertIn("ai_service.bp", routes_init)


if __name__ == "__main__":
    unittest.main()
