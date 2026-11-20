"""Generate screenshots of the built-in sample library (fresh profile)."""
import asyncio, os
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8123/")
SHOTS = "screenshots"

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR")
        page = await ctx.new_page()
        await page.goto(BASE, wait_until="networkidle")
        await page.click("#sampleBtn")
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{SHOTS}/16-sample-library.png", full_page=True)
        await page.locator(".book-card").first.click()
        await page.wait_for_selector("#view-book:not([hidden])")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{SHOTS}/17-sample-book.png", full_page=True)
        await page.locator(".photo-card").first.click()
        await page.wait_for_selector("#lightbox:not([hidden])")
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{SHOTS}/18-sample-lightbox.png")
        await b.close()

asyncio.run(main())
