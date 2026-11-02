# server/mcp/tools.py
"""工具辅助 Agent — 截图保存与日志记录"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from server.core.image_utils import save_screenshot

logger = logging.getLogger(__name__)


class ToolAgent:
    """工具辅助 Agent"""

    def __init__(self, screenshots_dir: str = "screenshots", logs_dir: str = "logs"):
        self.screenshots_dir = screenshots_dir
        self.logs_dir = logs_dir

    async def save_step_screenshot(self, image_bytes: bytes, session_id: str, step_index: int) -> str:
        dir_path = Path(self.screenshots_dir) / session_id
        filepath = save_screenshot(image_bytes, str(dir_path), f"step_{step_index}")
        logger.info(f"截图已保存: {filepath}")
        return filepath

    async def save_error_screenshot(self, image_bytes: bytes, session_id: str, step_index: int) -> str:
        dir_path = Path(self.screenshots_dir) / session_id
        filepath = save_screenshot(image_bytes, str(dir_path), f"error_step_{step_index}")
        logger.info(f"错误截图已保存: {filepath}")
        return filepath

    async def write_log(self, session_id: str, message: str) -> None:
        log_dir = Path(self.logs_dir)
        log_dir.mkdir(parents=True, exist_ok=True)
        log_path = log_dir / f"{session_id}.log"
        timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(f"[{timestamp}] {message}\n")
