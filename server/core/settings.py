# server/core/settings.py
"""AI Agent 配置加载 — 适配 Flask 运行环境"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml


def _find_config() -> str:
    """按优先级查找配置文件"""
    candidates = [
        os.environ.get("AGENT_CONFIG", ""),
        str(Path(__file__).resolve().parent.parent / "agent_config.yaml"),
        str(Path(__file__).resolve().parent.parent.parent / "config" / "config.yaml"),
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    return candidates[0]


@dataclass
class Settings:
    model: dict = field(default_factory=dict)
    vision: dict = field(default_factory=dict)
    browser: dict = field(default_factory=dict)
    langfuse: dict = field(default_factory=dict)
    allure: dict = field(default_factory=dict)
    excel: dict = field(default_factory=dict)
    record: dict = field(default_factory=dict)

    @classmethod
    def load(cls, config_path: str | None = None) -> Settings:
        path = Path(config_path or _find_config())
        if not path.exists():
            raise FileNotFoundError(f"配置文件不存在: {config_path}")

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        return cls(
            model=data.get("model", {}),
            vision=data.get("vision", {}),
            browser=data.get("browser", {}),
            langfuse=data.get("langfuse", {}),
            allure=data.get("allure", {}),
            excel=data.get("excel", {}),
            record=data.get("record", {}),
        )

    def get_api_key(self, section: str) -> str | None:
        """获取 API Key — 优先直接值，其次环境变量"""
        section_data = getattr(self, section, {})
        direct_key = section_data.get("api_key")
        if direct_key:
            return direct_key
        env_name = section_data.get("api_key_env", "")
        return os.environ.get(env_name) if env_name else None

    PROVIDER_BASE_URLS = {
        "qianwen": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    }

    def create_llm_client(self, section: str = "model"):
        """创建 LLM 客户端 (openai / anthropic / qianwen / zhipu)"""
        section_data = getattr(self, section, {})
        provider = section_data.get("provider", "openai")
        api_key = self.get_api_key(section)

        if provider == "openai":
            from openai import OpenAI
            base_url = section_data.get("base_url")
            return OpenAI(api_key=api_key, base_url=base_url)
        elif provider == "anthropic":
            import anthropic
            return anthropic.Anthropic(api_key=api_key)
        elif provider in self.PROVIDER_BASE_URLS:
            from openai import OpenAI
            base_url = section_data.get("base_url", self.PROVIDER_BASE_URLS[provider])
            return OpenAI(api_key=api_key, base_url=base_url)
        else:
            raise ValueError(f"不支持的 LLM provider: {provider}")
