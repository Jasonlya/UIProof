# server/mcp/playwright_client.py
"""Playwright 浏览器客户端封装"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from playwright.async_api import Browser, BrowserContext, Page, Playwright, async_playwright

logger = logging.getLogger(__name__)


class PlaywrightMCP:
    """Playwright 浏览器客户端"""

    def __init__(self, config: dict):
        self._config = config
        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._context: BrowserContext | None = None
        self._page: Page | None = None
        self._video_path: str | None = None

    @property
    def page(self) -> Page:
        if self._page is None:
            raise RuntimeError("浏览器未启动，请先调用 start()")
        return self._page

    @property
    def video_path(self) -> str | None:
        return self._video_path

    async def start(self) -> None:
        browser_config = self._config
        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=browser_config.get("headless", False),
            slow_mo=browser_config.get("slow_mo", 100),
        )

        viewport = browser_config.get("viewport", {"width": 1920, "height": 1080})

        record_video = browser_config.get("record_video", True)
        if record_video:
            video_dir = Path(browser_config.get("video_dir", "traces/videos"))
            video_dir.mkdir(parents=True, exist_ok=True)

            self._context = await self._browser.new_context(
                viewport=viewport,
                record_video_dir=str(video_dir),
            )
            self._page = await self._context.new_page()
            logger.info(f"浏览器已启动（录屏保存到: {video_dir}）")
        else:
            self._page = await self._browser.new_page(viewport=viewport)
            logger.info("浏览器已启动（无录屏）")

        timeout = browser_config.get("default_timeout", 30000)
        self._page.set_default_timeout(timeout)

    async def close(self) -> None:
        if self._context:
            if self._page and self._page.video:
                self._video_path = await self._page.video.path()
                logger.info(f"录屏文件: {self._video_path}")
            await self._context.close()
        elif self._page:
            await self._page.close()

        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("浏览器已关闭")

    async def navigate(self, url: str) -> None:
        await self.page.goto(url, wait_until="networkidle")
        await self.page.wait_for_timeout(2000)
        logger.info(f"导航到: {url}")

    async def screenshot(self) -> bytes:
        return await self.page.screenshot(type="png")

    async def click(self, x: float, y: float) -> None:
        await self.page.mouse.click(x, y)
        logger.info(f"点击坐标: ({x}, {y})")

    async def type_text(self, text: str) -> None:
        await self.page.keyboard.type(text, delay=50)
        logger.info(f"输入文字: {text[:20]}...")

    async def press_key(self, key: str) -> None:
        await self.page.keyboard.press(key)
        logger.info(f"按键: {key}")

    async def scroll(self, delta_x: float = 0, delta_y: float = 300) -> None:
        await self.page.mouse.wheel(delta_x, delta_y)
        logger.info(f"滚动: dx={delta_x}, dy={delta_y}")

    async def wait_for_timeout(self, ms: int) -> None:
        await self.page.wait_for_timeout(ms)
        logger.info(f"等待: {ms}ms")

    async def get_url(self) -> str:
        return self.page.url

    async def get_title(self) -> str:
        return await self.page.title()


async def create_browser(config: dict) -> PlaywrightMCP:
    """工厂函数：创建并启动浏览器"""
    mcp = PlaywrightMCP(config)
    await mcp.start()
    return mcp
