"""End-to-end verification of 내 서재 in headless Chromium (Playwright)."""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8123/")
SHOTS = "screenshots"
FIXTURE = "tests/fixtures/book-page.jpg"
ORIGINAL_BYTES = os.path.getsize(FIXTURE)

results = {}
errors = []
failures = []


def check(name, cond, extra=""):
    results[name] = {"ok": bool(cond), "detail": extra} if extra else {"ok": bool(cond)}
    if not cond:
        failures.append(f"{name} {extra}")
    print(("PASS " if cond else "FAIL ") + name + ((" | " + str(extra)) if extra else ""))


async def main():
    os.makedirs(SHOTS, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            permissions=["clipboard-read", "clipboard-write"],
            accept_downloads=True,
        )
        page = await ctx.new_page()
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        async def accept_dialog(dialog):
            await dialog.accept()

        page.on("dialog", accept_dialog)

        await page.goto(BASE, wait_until="networkidle")
        await page.wait_for_timeout(700)
        check("empty shelf shown", await page.locator("#shelfEmpty").is_visible())
        await page.screenshot(path=f"{SHOTS}/01-shelf-empty.png", full_page=True)

        # ---------- 1. add a book ----------
        await page.click("#addBookBtn")
        await page.wait_for_selector("#bookDialog[open]")
        await page.fill("#bookTitleInput", "덜어냄 연습")
        await page.fill("#bookAuthorInput", "한서윤")
        await page.click(".swatch[data-color='2']")
        await page.wait_for_timeout(350)
        await page.screenshot(path=f"{SHOTS}/02-book-dialog.png")
        await page.click("#bookSubmit")
        await page.wait_for_selector("#view-book:not([hidden])")
        await page.wait_for_timeout(500)
        check("book view opened", (await page.text_content("#bookTitle")).strip() == "덜어냄 연습")
        check("book view hash", "#book/" in page.url, page.url)

        # ---------- 2. photo upload + compression ----------
        await page.click("[data-add-photo]")
        await page.wait_for_selector("#photoDialog[open]")
        await page.set_input_files("#photoFile", FIXTURE)
        await page.wait_for_selector("#photoSubmit:not([disabled])", timeout=20000)
        size_info = (await page.text_content("#photoSizeInfo")).strip()
        await page.fill("#photoPage", "128")
        await page.fill("#photoCaption", "덜어냄은 비움이 아니라 선택이다")
        await page.check("#photoQuote")
        await page.wait_for_timeout(300)
        await page.screenshot(path=f"{SHOTS}/03-photo-upload.png")
        await page.click("#photoSubmit")
        await page.wait_for_selector(".photo-card")
        await page.wait_for_timeout(900)

        photo = await page.evaluate("() => window.__seoje.state.photos[0] || null")
        check("photo saved to IndexedDB", bool(photo), size_info)
        if photo:
            check("photo compressed under 400KB", photo["bytes"] < 400 * 1024, f"{photo['bytes']} bytes from {ORIGINAL_BYTES}")
            check("long edge resized to 1600", max(photo["width"], photo["height"]) == 1600, f"{photo['width']}x{photo['height']}")
            check("page + caption + quote tag stored", photo["page"] == 128 and photo["isQuote"] and bool(photo["caption"]))
        check("photo card rendered", await page.locator(".photo-card").count() == 1)
        img_box = await page.locator(".photo-card img").first.bounding_box()
        ratio = img_box["height"] / img_box["width"] if img_box and img_box["width"] else 0
        check("photo tile keeps 4:5 ratio", 1.15 < ratio < 1.35, f"{ratio:.2f} ({img_box['width']:.0f}x{img_box['height']:.0f})")

        blob_type = await page.evaluate(
            """async () => {
              const db = await new Promise((r) => { const q = indexedDB.open('nae-seoje'); q.onsuccess = () => r(q.result); });
              const id = window.__seoje.state.photos[0].id;
              const rec = await new Promise((r) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => r(q.result); });
              return rec && rec.blob ? rec.blob.type : null;
            }"""
        )
        check("photo blob stored separately", blob_type == "image/jpeg", str(blob_type))
        await page.screenshot(path=f"{SHOTS}/04-book-photos.png", full_page=True)
        await page.wait_for_timeout(2200)

        # lightbox
        await page.click(".photo-card")
        await page.wait_for_selector("#lightbox:not([hidden])")
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"{SHOTS}/05-lightbox.png")
        check("lightbox shows meta", "128" in (await page.text_content("#lbMeta")))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(300)
        check("lightbox closed by Esc", await page.locator("#lightbox").is_hidden())

        # ---------- 3. notes ----------
        await page.click("#tab-notes")
        await page.wait_for_selector("[data-panel='notes']:not([hidden])")
        await page.fill("#noteInput", "덜어낸다는 건 비우는 게 아니라 고르는 일이다. 오늘 책상 위에서 손이 세 번 멈췄던 물건들을 떠올렸다.")
        await page.click("#saveNoteBtn")
        await page.wait_for_selector(".note-item")
        await page.wait_for_timeout(400)
        check("note saved", await page.locator(".note-item").count() == 1)
        check("tab count updates", (await page.text_content("#tab-notes .tab-count")).strip() == "1")
        await page.fill("#noteInput", "아이 방 장난감도 이 기준으로 다시 보자. '언젠가 쓸 것'은 대부분 오지 않는다.")
        await page.click("#saveNoteBtn")
        await page.wait_for_timeout(400)
        check("second note saved", await page.locator(".note-item").count() == 2)
        await page.screenshot(path=f"{SHOTS}/06-notes.png", full_page=True)

        # ---------- 4. book export ----------
        await page.click("#tab-export")
        await page.wait_for_selector("[data-panel='export']:not([hidden])")
        await page.fill("#bookSummary", "많이 갖는 것이 아니라 남길 것을 고르는 일에 대한 책. 읽고 나서 서랍 두 개를 비웠다.")
        await page.wait_for_timeout(700)
        preview_text = await page.text_content("#bookPreview")
        check("book preview renders title", "덜어냄 연습" in preview_text)
        check("book preview includes notes", "고르는 일" in preview_text)
        check("book preview includes photo caption", "덜어냄은 비움이 아니라 선택이다" in preview_text)
        await page.screenshot(path=f"{SHOTS}/07-book-export.png", full_page=True)

        await page.click("[data-copy='book']")
        await page.wait_for_timeout(600)
        clip = await page.evaluate("() => navigator.clipboard.readText()")
        check("copy to clipboard works", "덜어냄 연습" in clip and "AI 창작 프롬프트" in clip, f"{len(clip)} chars")

        async with page.expect_download() as dl_info:
            await page.click("[data-download='book'][data-ext='md']")
        dl = await dl_info.value
        md_path = os.path.join(SHOTS, "export-sample-book.md")
        await dl.save_as(md_path)
        md_text = open(md_path, encoding="utf-8").read()
        check("book .md downloaded", dl.suggested_filename.endswith(".md") and "## ✍️ 나의 언어" in md_text, dl.suggested_filename)

        async with page.expect_download() as tx_info:
            await page.click("[data-download='book'][data-ext='txt']")
        tx = await tx_info.value
        check("book .txt downloaded", tx.suggested_filename.endswith(".txt"), tx.suggested_filename)

        # ---------- 5. second book ----------
        await page.click("[data-back]")
        await page.wait_for_selector("#view-shelf:not([hidden])")
        await page.click("#addBookBtn")
        await page.wait_for_selector("#bookDialog[open]")
        await page.fill("#bookTitleInput", "저녁의 문장들")
        await page.fill("#bookAuthorInput", "윤재하")
        await page.click(".swatch[data-color='4']")
        await page.set_input_files("#coverFile", FIXTURE)
        await page.wait_for_timeout(1200)
        check("cover photo compressed and previewed", await page.locator("#coverPreview img").count() == 1)
        await page.click("#bookSubmit")
        await page.wait_for_selector("#view-book:not([hidden])")
        await page.wait_for_timeout(400)
        await page.click("#tab-notes")
        await page.fill("#noteInput", "잘 쉬는 것도 연습이 필요하다는 말이 오래 남았다. 나는 쉬는 시간에도 뭔가를 하고 있었다.")
        await page.click("#saveNoteBtn")
        await page.wait_for_timeout(400)
        await page.click("[data-back]")
        await page.wait_for_selector("#view-shelf:not([hidden])")
        await page.wait_for_timeout(500)
        check("shelf shows two books", await page.locator(".book-card").count() == 2)
        await page.wait_for_timeout(2400)
        await page.screenshot(path=f"{SHOTS}/08-shelf-filled.png", full_page=True)

        # search
        await page.fill("#searchInput", "저녁")
        await page.wait_for_timeout(400)
        check("search filters books", await page.locator(".book-card").count() == 1)
        await page.fill("#searchInput", "")
        await page.wait_for_timeout(400)

        # ---------- 6. weave ----------
        await page.click("#weaveBtn")
        await page.wait_for_selector("#selectionBar:not([hidden])")
        cards = page.locator(".book-card")
        await cards.nth(0).click()
        await cards.nth(1).click()
        await page.wait_for_timeout(300)
        check("selection counted", "2권 선택됨" in (await page.text_content("#selectionText")))
        await page.screenshot(path=f"{SHOTS}/09-weave-select.png", full_page=True)
        await page.click("#selectionGo")
        await page.wait_for_selector("#view-studio:not([hidden])")
        await page.wait_for_timeout(600)
        await page.fill("#studioTitle", "덜어냄과 저녁")
        await page.fill("#studioIntent", "쉬는 법을 잊은 나에게, 덜어내고 남기는 일에 대한 기록을 한 권으로 건네고 싶다.")
        await page.fill("#studioEpilogue", "오늘은 하나만 덜어내고, 하나만 남기자.")
        await page.wait_for_timeout(800)
        studio_preview = await page.text_content("#studioPreview")
        check("studio preview has chapters", "## " in studio_preview or "1." in studio_preview)
        check("studio preview includes both books", "덜어냄 연습" in studio_preview and "저녁의 문장들" in studio_preview)
        check("studio preview includes intent", "쉬는 법을 잊은 나에게" in studio_preview)
        await page.wait_for_timeout(2600)
        await page.screenshot(path=f"{SHOTS}/10-studio.png", full_page=True)

        async with page.expect_download() as dl2_info:
            await page.click("[data-download='studio'][data-ext='md']")
        dl2 = await dl2_info.value
        studio_path = os.path.join(SHOTS, "export-sample-studio.md")
        await dl2.save_as(studio_path)
        studio_text = open(studio_path, encoding="utf-8").read()
        check("studio .md downloaded", dl2.suggested_filename.endswith(".md") and "## 목차" in studio_text, dl2.suggested_filename)

        # ---------- 7. persistence after reload ----------
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(900)
        check("data persists after reload", await page.locator(".book-card").count() == 2)
        check("service worker controls page", await page.evaluate("() => !!navigator.serviceWorker.controller"))
        check("photo count persists", "사진 1장" in (await page.text_content("#storageChip")) or "1" in (await page.text_content("#storageChip")), await page.text_content("#storageChip"))

        # ---------- 8. storage settings ----------
        await page.click("#settingsBtn")
        await page.wait_for_selector("#settingsDialog[open]")
        await page.wait_for_timeout(900)
        storage_line = await page.text_content("#storageLine")
        stats = await page.text_content("#storageStats")
        check("storage estimate reported", "사용" in storage_line or "저장공간" in storage_line, storage_line)
        check("storage stats show counts", "2권의 책" in stats and "1장의 사진" in stats, stats.replace("\n", " "))
        await page.screenshot(path=f"{SHOTS}/11-settings-storage.png")
        await page.click("#persistBtn")
        await page.wait_for_timeout(1200)
        persist_note = await page.text_content("#persistNote")
        check("persist request handled", bool(persist_note), persist_note)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)

        # ---------- 8b. backup / reset / restore ----------
        await page.click("#settingsBtn")
        await page.wait_for_selector("#settingsDialog[open]")
        async with page.expect_download() as bk_info:
            await page.click("#backupBtn")
        bk = await bk_info.value
        bk_path = os.path.join(SHOTS, "export-sample-backup.json")
        await bk.save_as(bk_path)
        payload = json.load(open(bk_path, encoding="utf-8"))
        check("backup json downloaded", payload.get("app") == "nae-seoje" and len(payload.get("books", [])) == 2, f"{len(payload.get('photos', []))} photos")
        check("backup carries photo data", any((p.get("data") or "").startswith("data:image") for p in payload.get("photos", [])))

        await page.click("#resetBtn")
        await page.wait_for_timeout(1200)
        check("reset empties shelf", await page.locator(".book-card").count() == 0)

        await page.click("#settingsBtn")
        await page.wait_for_selector("#settingsDialog[open]")
        await page.set_input_files("#restoreFile", bk_path)
        await page.wait_for_timeout(2500)
        check("restore brings books back", await page.locator(".book-card").count() == 2)
        restored = await page.evaluate("() => ({books: window.__seoje.state.books.length, photos: window.__seoje.state.photos.length, notes: window.__seoje.state.notes.length})")
        check("restore brings photos and notes", restored["photos"] == 1 and restored["notes"] == 3, json.dumps(restored))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)

        # ---------- 9. speech capability ----------
        speech = await page.evaluate("() => ({api: typeof (window.SpeechRecognition || window.webkitSpeechRecognition), btn: !!document.querySelector('#micBtn'), status: document.querySelector('#speechStatus').textContent})")
        check("speech path present (API or graceful notice)", speech["api"] != "undefined" or bool(speech["status"]), json.dumps(speech, ensure_ascii=False))
        if speech["api"] == "function":
            await page.click(".book-card")
            await page.wait_for_selector("#view-book:not([hidden])")
            await page.click("#tab-notes")
            await page.click("#micBtn")
            await page.wait_for_timeout(3000)
            status = await page.text_content("#speechStatus")
            listening = await page.get_attribute("#micBtn", "aria-pressed")
            check("dictation gives feedback without crashing", bool(status.strip()) or listening == "true", (status.strip() or f"listening={listening}"))
            if listening == "true":
                await page.click("#micBtn")
            await page.click("[data-back]")
            await page.wait_for_selector("#view-shelf:not([hidden])")

        # ---------- 10. mobile ----------
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.goto(BASE + "#shelf", wait_until="networkidle")
        await page.reload(wait_until="networkidle")
        await page.wait_for_timeout(1000)
        mobile_state = await page.evaluate("() => ({weave: window.__seoje.state.weaveMode, selected: document.querySelectorAll('.book-card.is-selected').length})")
        check("shelf shows no selection chrome on load", mobile_state["weave"] is False and mobile_state["selected"] == 0, json.dumps(mobile_state))
        await page.screenshot(path=f"{SHOTS}/12-mobile-shelf.png", full_page=True)
        await page.locator(".book-card").first.click()
        await page.wait_for_selector("#view-book:not([hidden])")
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{SHOTS}/13-mobile-book.png", full_page=True)

        # ---------- 11. tablet ----------
        await page.set_viewport_size({"width": 834, "height": 1112})
        await page.goto(BASE + "#shelf", wait_until="networkidle")
        await page.wait_for_timeout(900)
        await page.screenshot(path=f"{SHOTS}/14-tablet-shelf.png", full_page=True)
        await page.locator(".book-card").first.click()
        await page.wait_for_selector("#view-book:not([hidden])")
        await page.wait_for_timeout(700)
        await page.screenshot(path=f"{SHOTS}/15-tablet-book.png", full_page=True)

        est = await page.evaluate("async () => { const e = await navigator.storage.estimate(); return {usage: e.usage, quota: e.quota}; }")
        results["storage_estimate"] = est
        await browser.close()

    results["console_errors"] = errors
    print("\n=== SUMMARY ===")
    print(json.dumps({k: v for k, v in results.items() if k != "console_errors"}, ensure_ascii=False, indent=1))
    print("console errors:", len(errors))
    for e in errors:
        print("  ", e)
    print("failures:", len(failures))
    for f in failures:
        print("  ", f)
    return 0 if not failures and not errors else 1


sys.exit(asyncio.run(main()))
