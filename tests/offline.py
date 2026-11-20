"""Verify the PWA shell still opens with the network switched off."""
import asyncio, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8123/")
SHOTS = "screenshots"


async def main():
    errors = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 420, "height": 900}, locale="ko-KR")
        page = await ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1500)
        controlled = await page.evaluate("() => !!navigator.serviceWorker.controller")
        await ctx.set_offline(True)
        await page.reload(wait_until="load")
        await page.wait_for_timeout(1200)
        title = await page.title()
        visible = await page.locator("#view-shelf").is_visible()
        brand = await page.locator(".brand-text strong").count()
        await page.screenshot(path=f"{SHOTS}/19-offline.png")
        await b.close()

    ok = controlled and visible and brand == 1 and not errors
    print(f"service worker controlled: {controlled}")
    print(f"offline title: {title}")
    print(f"shelf visible offline: {visible}")
    print(f"page errors: {errors}")
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


sys.exit(asyncio.run(main()))
