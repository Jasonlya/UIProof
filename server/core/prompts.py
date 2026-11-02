# server/core/prompts.py
"""Prompt 模板加载工具"""
from __future__ import annotations

from pathlib import Path

# prompts 目录在 server/ 下
PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts"


def load_prompt(name: str, **kwargs) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        raise FileNotFoundError(f"Prompt 模板不存在: {path}")

    template = path.read_text(encoding="utf-8")

    if kwargs:
        template = template.format(**kwargs)

    return template
