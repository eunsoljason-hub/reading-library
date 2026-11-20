# 검증 결과 — 2026-11-20 10:54 KST

- 환경: headless Chromium (Playwright 1.65.2, chromium-headless-shell 1255), Linux x86_64
- 대상: http://127.0.0.1:8123/ (정적 서버)
- 결과: **PASS 43 / FAIL 0**, console error 0, page error 0
- 오프라인: **PASS** (서비스 워커 제어 후 네트워크 차단 상태에서 서재 렌더링, page error 0)
- 사진 압축 실측: 1,679,856 B → 65,761 B (96% 절약, 1200×1600)

## e2e 로그
```
PASS empty shelf shown
PASS book view opened
PASS book view hash | http://127.0.0.1:8123/#book/13c89f5a-647d-4bc7-b670-b60822fe0075
PASS photo saved to IndexedDB | 1.6 MB → 64.2 KB · 96% 절약
PASS photo compressed under 400KB | 65761 bytes from 1679856
PASS long edge resized to 1600 | 1200x1600
PASS page + caption + quote tag stored
PASS photo card rendered
PASS photo tile keeps 4:5 ratio | 1.25 (172x215)
PASS photo blob stored separately | image/jpeg
PASS lightbox shows meta
PASS lightbox closed by Esc
PASS note saved
PASS tab count updates
PASS second note saved
PASS book preview renders title
PASS book preview includes notes
PASS book preview includes photo caption
PASS copy to clipboard works | 719 chars
PASS book .md downloaded | 덜어냄 연습.md
PASS book .txt downloaded | 덜어냄 연습.txt
PASS cover photo compressed and previewed
PASS shelf shows two books
PASS search filters books
PASS selection counted
PASS studio preview has chapters
PASS studio preview includes both books
PASS studio preview includes intent
PASS studio .md downloaded | 덜어냄과 저녁.md
PASS data persists after reload
PASS service worker controls page
PASS photo count persists | 
PASS storage estimate reported | 사용 440.1 KB / 여유 약 10.00 GB (전체 10.00 GB)
PASS storage stats show counts |      2권의 책     1장의 사진 (64.2 KB)     3편의 기록     일반보관 등급
PASS persist request handled | 영구 보관을 허용하면 저장공간이 부족해질 때 브라우저가 서재를 임의로 지우지 않아요.
PASS backup json downloaded | 1 photos
PASS backup carries photo data
PASS reset empties shelf
PASS restore brings books back
PASS restore brings photos and notes | {"books": 2, "photos": 1, "notes": 3}
PASS speech path present (API or graceful notice) | {"api": "function", "btn": true, "status": ""}
PASS dictation gives feedback without crashing | 음성 인식을 시작하지 못했어요. 마이크 권한과 인터넷 연결을 확인하거나 타이핑으로 남겨주세요.
PASS shelf shows no selection chrome on load | {"weave": false, "selected": 0}
```

## 오프라인 로그
```
service worker controlled: True
offline title: 내 서재 — 읽고, 밑줄 긋고, 엮어서 한 권으로
shelf visible offline: True
page errors: []
RESULT: PASS
```
