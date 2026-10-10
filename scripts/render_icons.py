"""Render web/public/icon.svg to the PNG sizes the PWA manifest needs (uses Playwright)."""

import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

PUBLIC = Path(__file__).resolve().parent.parent / "web" / "public"


async def main() -> None:
    svg = (PUBLIC / "icon.svg").read_text()
    exe = os.environ.get("CHROMIUM_PATH")
    async with async_playwright() as p:
        browser = await p.chromium.launch(**({"executable_path": exe} if exe else {}))
        for size in (192, 512):
            page = await browser.new_page(viewport={"width": size, "height": size})
            await page.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width={size} height={size} ", 1)}</body></html>')
            await page.screenshot(path=str(PUBLIC / f"icon-{size}.png"), omit_background=True)
        await browser.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
