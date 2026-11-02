from flask import Blueprint, request, jsonify, current_app
import json

bp = Blueprint('ai_heal', __name__, url_prefix='/api/ai')


# ─────────────────────────────────────────────
# AI 接口适配层（留空占位，替换此函数即可接入任意模型）
# ─────────────────────────────────────────────
def call_ai(prompt: str) -> str:
    """
    调用 AI 接口，返回模型回复的原始字符串。

    接入方式示例（三选一，取消注释并填入配置）：

    ── 方案 A：Anthropic Claude ──────────────────────────────────────
    import anthropic
    client = anthropic.Anthropic(api_key="sk-ant-...")
    msg = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}]
    )
    return msg.content[0].text

    ── 方案 B：OpenAI / 兼容接口（DeepSeek、本地 Ollama 等）─────────
    from openai import OpenAI
    client = OpenAI(api_key="sk-...", base_url="https://api.openai.com/v1")
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=512
    )
    return resp.choices[0].message.content

    ── 方案 C：HTTP 直接请求（无需 SDK）──────────────────────────────
    import requests as req
    resp = req.post(
        "https://your-llm-endpoint/v1/chat/completions",
        headers={"Authorization": "Bearer YOUR_KEY"},
        json={"model": "...", "messages": [{"role": "user", "content": prompt}], "max_tokens": 512},
        timeout=30
    )
    return resp.json()["choices"][0]["message"]["content"]
    """
    # 未配置时返回空，调用方会跳过自愈
    return ""


def build_heal_prompt(failed_selector: str, fallbacks: list, page_url: str,
                      step_type: str, dom_context: str) -> str:
    fallbacks_str = "\n".join(f"  - {f}" for f in (fallbacks or []))
    return f"""你是一个前端自动化测试专家，负责修复失效的 CSS 选择器。

## 任务
页面回放时，下面的选择器无法找到目标元素，请根据页面 DOM 片段推断正确的选择器。

## 失败信息
- 操作类型: {step_type}
- 失败选择器: {failed_selector}
- 已尝试的备选选择器（均失败）:
{fallbacks_str or "  （无）"}
- 页面 URL: {page_url}

## 页面 DOM 片段（失败选择器附近的 HTML）
```html
{dom_context}
```

## 要求
1. 只输出一个 JSON 对象，不要有任何解释文字
2. JSON 格式: {{"selector": "<CSS选择器或 text=\\"文字\\">"}}
3. 优先使用 data-testid / aria-label / name / placeholder 等稳定属性
4. 如果找不到合适的选择器，输出 {{"selector": ""}}
"""


def extract_selector_from_ai_response(ai_text: str) -> str:
    """从 AI 返回文本中提取选择器字符串。"""
    if not ai_text:
        return ""
    try:
        # 尝试直接解析整个响应
        obj = json.loads(ai_text.strip())
        return obj.get("selector", "")
    except Exception:
        pass
    # 尝试找到 JSON 块
    import re
    match = re.search(r'\{[^{}]*"selector"\s*:\s*"([^"]*)"[^{}]*\}', ai_text)
    if match:
        return match.group(1)
    return ""


# ─────────────────────────────────────────────
# 路由
# ─────────────────────────────────────────────

@bp.route('/heal', methods=['POST'])
def heal():
    """
    AI 自愈接口。

    请求体 (JSON):
    {
        "selector":        "失败的选择器",
        "selectorFallbacks": [...],
        "stepType":        "click" | "input",
        "pageUrl":         "当前页面 URL",
        "domContext":      "失败元素附近的 HTML 片段（≤3000字符）"
    }

    响应体 (JSON):
    {
        "ok": true,
        "selector": "AI 推断的新选择器"   // 空字符串表示 AI 无法修复
    }
    """
    data = request.get_json(silent=True) or {}

    failed_selector = data.get("selector", "")
    fallbacks = data.get("selectorFallbacks", [])
    step_type = data.get("stepType", "click")
    page_url = data.get("pageUrl", "")
    dom_context = data.get("domContext", "")[:3000]  # 限制长度，节省 token

    if not failed_selector:
        return jsonify({"ok": False, "error": "缺少 selector 参数"}), 400

    try:
        prompt = build_heal_prompt(failed_selector, fallbacks, page_url, step_type, dom_context)
        ai_text = call_ai(prompt)
        new_selector = extract_selector_from_ai_response(ai_text)

        current_app.logger.info(
            f"[AI自愈] 失败选择器: {failed_selector} → AI建议: {new_selector or '(无)'}"
        )

        return jsonify({"ok": True, "selector": new_selector})

    except Exception as e:
        current_app.logger.error(f"[AI自愈] 调用异常: {e}")
        return jsonify({"ok": False, "error": str(e), "selector": ""}), 500


# ─────────────────────────────────────────────
# 自动生成用例接口
# ─────────────────────────────────────────────

def build_generate_prompt(page_url: str, page_title: str, interactives: list) -> str:
    """根据页面交互元素列表，构建生成用例的 prompt。"""
    elements_desc = json.dumps(interactives, ensure_ascii=False, indent=2)
    return f"""你是一个前端自动化测试专家。根据页面上的交互元素，生成有意义的自动化测试用例。

## 页面信息
- URL: {page_url}
- 标题: {page_title}

## 页面交互元素（JSON 格式）
```json
{elements_desc}
```

## 要求
1. 分析页面功能，识别主要业务流程（如登录、搜索、表单提交、导航等）
2. 每个用例聚焦一个独立功能点
3. 步骤中的 selector 直接使用元素提供的 selector 字段，不要发明新选择器
4. 生成 3~8 个用例，数量根据页面复杂度决定
5. 只输出 JSON 数组，不要有任何解释文字

## 输出格式（严格遵守）
```json
[
  {{
    "name": "用例名称（中文，简洁描述功能点）",
    "description": "用例描述（一句话说明目的）",
    "steps": [
      {{
        "type": "click | input | wait | navigate",
        "selector": "CSS选择器 或 text=\\"按钮文字\\"",
        "value": "input类型时的输入值，其他类型留空字符串",
        "description": "该步骤的说明"
      }}
    ]
  }}
]
```

注意：
- type 只能是 click、input、wait、navigate 之一
- wait 步骤的 value 填毫秒数字符串，如 "1000"
- navigate 步骤的 value 填目标 URL
- 不要编造页面上不存在的元素
"""


@bp.route('/generate-cases', methods=['POST'])
def generate_cases():
    """
    根据页面交互元素自动生成测试用例。

    请求体 (JSON):
    {
        "pageUrl":    "当前页面 URL",
        "pageTitle":  "页面标题",
        "interactives": [   // content.js 提取的交互元素列表
            {
                "tag": "button",
                "type": "",
                "text": "登录",
                "selector": "button[type='submit']",
                "ariaLabel": "",
                "placeholder": "",
                "name": "",
                "role": ""
            },
            ...
        ]
    }

    响应体 (JSON):
    {
        "ok": true,
        "cases": [
            {
                "name": "用例名称",
                "description": "描述",
                "steps": [ { "type": "click", "selector": "...", "value": "", "description": "..." } ]
            }
        ]
    }
    """
    data = request.get_json(silent=True) or {}
    page_url = data.get("pageUrl", "")
    page_title = data.get("pageTitle", "")
    interactives = data.get("interactives", [])

    if not interactives:
        return jsonify({"ok": False, "error": "页面无可交互元素"}), 400

    # 截断过多元素，避免超出 token 限制
    interactives = interactives[:80]

    try:
        prompt = build_generate_prompt(page_url, page_title, interactives)
        ai_text = call_ai(prompt)

        cases = []
        if ai_text:
            # 尝试提取 JSON 数组
            import re
            # 先尝试直接解析
            try:
                cases = json.loads(ai_text.strip())
            except Exception:
                # 找 JSON 代码块
                match = re.search(r'```(?:json)?\s*(\[[\s\S]*?\])\s*```', ai_text)
                if match:
                    try:
                        cases = json.loads(match.group(1))
                    except Exception:
                        pass
                if not cases:
                    # 找裸数组
                    match = re.search(r'\[[\s\S]*\]', ai_text)
                    if match:
                        try:
                            cases = json.loads(match.group(0))
                        except Exception:
                            pass

        current_app.logger.info(f"[AI生成用例] 页面: {page_url} → 生成 {len(cases)} 个用例")
        return jsonify({"ok": True, "cases": cases})

    except Exception as e:
        current_app.logger.error(f"[AI生成用例] 异常: {e}")
        return jsonify({"ok": False, "error": str(e), "cases": []}), 500

