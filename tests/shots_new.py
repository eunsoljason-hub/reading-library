import asyncio, sys
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8123/"
OUT = "/workspace/reading-library-app/screenshots/new"

async def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch()
        page = await b.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/01-empty-desktop.png", full_page=True)

        # sample library
        await page.click("#sampleBtn")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/02-shelf-desktop.png", full_page=True)
        await page.screenshot(path=f"{OUT}/02b-shelf-viewport.png")

        # hover second book
        cards = page.locator(".book-card .book-card-btn")
        if await cards.count():
            await cards.nth(1).hover()
            await page.wait_for_timeout(600)
            await page.screenshot(path=f"{OUT}/03-shelf-hover.png")

        # book view
        await cards.nth(0).click()
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{OUT}/04-book-desktop.png", full_page=True)

        # notes tab
        await page.click("[data-tab='notes']")
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{OUT}/05-book-notes.png", full_page=True)

        # export tab
        await page.click("[data-tab='export']")
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"{OUT}/06-book-export.png", full_page=True)

        # studio
        await page.goto(BASE + "#shelf", wait_until="networkidle")
        await page.wait_for_timeout(600)
        await page.click("#weaveBtn")
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/07-weave.png", full_page=True)
        cards = page.locator(".book-card .book-card-btn")
        for i in range(await cards.count()):
            await cards.nth(i).click()
        await page.wait_for_timeout(400)
        await page.screenshot(path=f"{OUT}/08-weave-selected.png", full_page=True)
        await page.click("#selectionGo")
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{OUT}/09-studio.png", full_page=True)

        # book dialog
        await page.goto(BASE + "#shelf", wait_until="networkidle")
        await page.wait_for_timeout(500)
        await page.click("#addBookBtn")
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"{OUT}/10-dialog-book.png")

        # settings
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        await page.click("#settingsBtn")
        await page.wait_for_timeout(800)
        await page.screenshot(path=f"{OUT}/11-settings.png")

        # mobile
        m = await b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        await m.goto(BASE, wait_until="networkidle")
        await m.wait_for_timeout(1200)
        await m.screenshot(path=f"{OUT}/12-empty-mobile.png", full_page=True)
        await m.evaluate("() => { localStorage.clear(); }")
        await m.click("#sampleBtn")
        await m.wait_for_timeout(1600)
        await m.screenshot(path=f"{OUT}/13-shelf-mobile.png", full_page=True)
        await m.locator(".book-card .book-card-btn").nth(0).click()
        await m.wait_for_timeout(900)
        await m.screenshot(path=f"{OUT}/14-book-mobile.png", full_page=True)

        print("errors:", errs[:10])
        await b.close()

asyncio.run(main())
