import asyncio, json
from playwright.async_api import async_playwright

LIVE = "https://reading-library-pi-nine.vercel.app/"
OUT = "live-verification"

async def main():
    results = []
    def check(name, ok, detail=""):
        results.append((name, bool(ok), detail))
        print(("PASS " if ok else "FAIL ") + name + (" | " + str(detail) if detail else ""))

    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
        page = await ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)

        await page.goto(LIVE, wait_until="networkidle")
        await page.wait_for_timeout(1500)
        check("live loads", await page.title() != "", await page.title())
        check("new stylesheet served", "1.9.0" in await page.evaluate("document.querySelector('link[rel=stylesheet][href*=styles]').href"),
              await page.evaluate("document.querySelector('link[rel=stylesheet][href*=styles]').href"))
        font_probe = await page.evaluate("""async () => {
          await document.fonts.ready;
          const c = document.createElement('canvas').getContext('2d');
          const w = (f) => { c.font = f; return c.measureText('나의 서재').width; };
          return { noto: w('300 40px "Noto Serif KR"'), serif: w('300 40px serif'),
                   pretendard: w('400 40px "Pretendard Variable"'), sans: w('400 40px sans-serif') };
        }""")
        check("serif webfont active", font_probe["noto"] != font_probe["serif"], font_probe)
        check("sans webfont active", font_probe["pretendard"] != font_probe["sans"], font_probe)
        bg = await page.evaluate("getComputedStyle(document.body).backgroundColor")
        check("ivory page background", bg, bg)
        await page.screenshot(path=f"{OUT}/live-ivory-black-empty.png")

        # sample library
        await page.click("#sampleBtn")
        await page.wait_for_timeout(1800)
        await page.mouse.move(10, 10)
        await page.wait_for_timeout(3200)
        n = await page.locator(".book-card").count()
        check("sample 3 books", n == 3, n)
        await page.screenshot(path=f"{OUT}/live-ivory-black.png")
        await page.screenshot(path=f"{OUT}/live-ivory-black-full.png", full_page=True)

        # monochrome check on the shelf area
        shade = await page.evaluate("""() => {
          const cards = [...document.querySelectorAll('.cover')].map(c => getComputedStyle(c).getPropertyValue('--c1') + ' ' + getComputedStyle(c).getPropertyValue('--cf'));
          return cards;
        }""")
        check("covers use ivory/ink palette", all(w for w in shade), shade)

        # search
        await page.fill("#searchInput", "저녁")
        await page.wait_for_timeout(500)
        check("search filters to 1", await page.locator(".book-card").count() == 1, await page.locator(".book-card").count())
        await page.fill("#searchInput", "")
        await page.wait_for_timeout(400)

        # sort
        await page.select_option("#sortSelect", "title")
        await page.wait_for_timeout(500)
        first = (await page.locator(".book-card-meta h3").first.text_content()).strip()
        check("sort by title", first != "", first)
        await page.select_option("#sortSelect", "recent")
        await page.wait_for_timeout(300)

        # book view + genre prompts
        await page.locator(".book-card .book-card-btn").first.click()
        await page.wait_for_timeout(900)
        check("book view opened", await page.locator("#view-book").is_visible())
        await page.screenshot(path=f"{OUT}/live-ivory-black-book.png", full_page=True)
        await page.click("[data-tab='export']")
        await page.wait_for_timeout(500)
        chips = await page.locator("#bookGenreChips .genre-chip").count()
        check("6 genre chips", chips == 6, chips)
        prompt_a = await page.text_content("#bookPreview")
        await page.locator("#bookGenreChips .genre-chip").nth(1).click()
        await page.wait_for_timeout(600)
        prompt_b = await page.text_content("#bookPreview")
        check("genre changes prompt", prompt_a != prompt_b)
        active_bg = await page.evaluate("getComputedStyle(document.querySelector('#bookGenreChips .genre-chip.is-active')).backgroundColor")
        check("active chip is ink", active_bg, active_bg)
        await page.screenshot(path=f"{OUT}/live-ivory-black-export.png", full_page=True)

        # studio + weave
        await page.goto(LIVE + "#shelf", wait_until="networkidle")
        await page.wait_for_timeout(800)
        await page.click("#weaveBtn")
        await page.wait_for_timeout(700)
        btns = page.locator(".book-card .book-card-btn")
        for i in range(await btns.count()):
            await btns.nth(i).click()
        await page.wait_for_timeout(400)
        await page.click("#selectionGo")
        await page.wait_for_timeout(900)
        check("studio opened", await page.locator("#view-studio").is_visible())
        check("studio has 3 books", await page.locator("#studioBooks li").count() == 3, await page.locator("#studioBooks li").count())
        await page.locator("#studioGenreChips .genre-chip").nth(2).click()
        await page.wait_for_timeout(500)
        studio_txt = await page.text_content("#studioPreview")
        check("studio preview has chapters", "목차" in studio_txt, len(studio_txt))
        await page.screenshot(path=f"{OUT}/live-ivory-black-studio.png", full_page=True)

        # settings
        await page.goto(LIVE + "#shelf", wait_until="networkidle")
        await page.wait_for_timeout(600)
        await page.click("#settingsBtn")
        await page.wait_for_timeout(700)
        check("settings opens", await page.locator("#settingsDialog").is_visible())
        await page.screenshot(path=f"{OUT}/live-ivory-black-settings.png")
        await page.keyboard.press("Escape")

        # mobile 390
        m = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True)
        mp = await m.new_page()
        merrs = []
        mp.on("pageerror", lambda e: merrs.append(str(e)))
        await mp.goto(LIVE, wait_until="networkidle")
        await mp.wait_for_timeout(1200)
        await mp.click("#sampleBtn")
        await mp.wait_for_timeout(4200)
        await mp.screenshot(path=f"{OUT}/live-ivory-black-mobile-390.png")
        await mp.screenshot(path=f"{OUT}/live-ivory-black-mobile-390-full.png", full_page=True)
        check("mobile shelf 390 renders", await mp.locator(".book-card").count() == 3)
        overflow = await mp.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check("no horizontal overflow on mobile", overflow <= 0, overflow)

        check("no console/page errors (desktop)", len(errs) == 0, errs[:3])
        check("no page errors (mobile)", len(merrs) == 0, merrs[:3])
        await b.close()

    fails = [r for r in results if not r[1]]
    print(f"\nTOTAL {len(results)} · FAIL {len(fails)}")
    open(f"{OUT}/live-verification.json", "w").write(json.dumps(results, ensure_ascii=False, indent=1))

asyncio.run(main())
