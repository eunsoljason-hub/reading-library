import asyncio, json, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/"

async def main():
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1, locale="ko-KR")
        page = await ctx.new_page()
        page.on("console", lambda m: errors.append(f"[console.{m.type}] {m.text}") if m.type in ("error",) else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(800)
        title = await page.title()
        empty = await page.locator("#shelfEmpty").is_visible()
        print("title:", title, "| empty state visible:", empty)
        await page.screenshot(path="screenshots/00-smoke.png", full_page=True)
        print("ERRORS:", json.dumps(errors, ensure_ascii=False, indent=1))
        await browser.close()

asyncio.run(main())
