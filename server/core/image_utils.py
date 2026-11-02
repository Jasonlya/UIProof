# server/core/image_utils.py
"""图片编码与截图保存工具"""
from __future__ import annotations

import base64
from pathlib import Path


def encode_image(image_bytes: bytes) -> str:
    return base64.b64encode(image_bytes).decode("utf-8")


def save_screenshot(image_bytes: bytes, directory: str, name: str) -> str:
    dir_path = Path(directory)
    dir_path.mkdir(parents=True, exist_ok=True)
    filepath = dir_path / f"{name}.png"
    filepath.write_bytes(image_bytes)
    return str(filepath.resolve())
