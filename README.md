# 📚 내 서재 — 독서 기록 & 책 엮기

읽은 책을 꽂고, 마음에 남은 문장은 사진으로, 나의 생각은 목소리로 남긴 뒤
**여러 책을 엮어 한 편의 원고**로 내보내는 조용한 독서 서재입니다.

- 100% 브라우저에서 동작하는 정적 PWA (서버·계정·로그인 없음)
- 모든 기록은 이 기기의 **IndexedDB**에만 저장되고 어디로도 전송되지 않습니다.
- 빌드 도구 없이 `index.html` 하나로 열립니다.

## 주요 기능

| 영역 | 내용 |
| --- | --- |
| 저장공간 | IndexedDB에 책·사진·메모 저장, `navigator.storage.persist()` 영구 보관 요청, `estimate()`로 사용량/여유 공간 실시간 표시, 사진 장수·총 용량 표시 |
| 사진 압축 | 업로드·카메라 촬영 시 Canvas로 긴 변 1600px · JPEG 0.82로 자동 압축 (예: 1.6MB → 64KB, 96% 절약), 원본은 저장하지 않음 |
| 밑줄 사진 | 페이지 번호 · 짧은 메모 · 대표 인용문 태그, 클릭하면 전체화면 확대(한 번 더 누르면 확대), 좌우 이동, 삭제 |
| 나의 언어 | 직접 타이핑 + 음성 입력(Web Speech API, 한국어/English 전환). 오디오 파일은 저장하지 않아 용량 낭비 없음. 미지원·무응답 브라우저는 안내 문구 |
| 책장 | 따뜻한 미니멀 그리드, 표지 사진 또는 제목 기반 자동 표지(7가지 색), 사진/메모 수 뱃지, 검색, 정렬 |
| 한 권 내보내기 | 책 정보 + 밑줄 + 메모 + 요약을 Markdown/TXT로. 원클릭 복사(ChatGPT에 바로 붙여넣기), `.md`/`.txt` 다운로드 |
| 내 책 엮기 | 책장에서 여러 권 선택 → 순서 조정 → 목차·챕터·기획 의도·에필로그를 담은 통합 원고 미리보기 → 복사/다운로드. AI 창작 프롬프트 템플릿 포함 |
| 백업 | 책·사진·메모 전부를 JSON 한 파일로 내려받기/복원 (기기 이동·초기화 대비) |
| PWA | `manifest.webmanifest`, 아이콘, 서비스 워커 오프라인 캐시, 모바일·태블릿·데스크톱 반응형, 한국어 UI |

## 실행

```bash
# 아무 정적 서버나 사용 (서비스 워커는 http/https에서만 동작)
cd reading-library-app
python3 -m http.server 8080
# → http://localhost:8080
```

`index.html`을 파일로 직접 열어도 앱은 동작하지만(IndexedDB 사용 가능),
오프라인 캐시·설치는 로컬 서버나 배포 주소에서만 활성화됩니다.

### 아이폰 홈 화면에 추가

Safari로 주소를 연 뒤 **공유 → 홈 화면에 추가**. 전체화면 앱처럼 열리고,
한 번 열어두면 오프라인에서도 서재가 뜹니다.

## 배포 (Vercel)

```bash
npx vercel deploy --prod
# 또는 저장소를 Vercel에 연결하면 정적 사이트로 바로 배포됩니다.
```

`vercel.json`에 서비스 워커 캐시 헤더와 manifest Content-Type이 설정되어 있습니다.
GitHub Pages·Netlify 등 정적 호스팅에도 그대로 올릴 수 있습니다.

## 데이터 구조

IndexedDB `nae-seoje` (v1)

- `books` — `{ id, title, author, color, coverData, summary, createdAt, updatedAt }`
- `photos` — `{ id, bookId, page, caption, isQuote, width, height, bytes, type, createdAt }`
- `blobs` — `{ id, blob }` (압축된 JPEG 원본 바이너리, 사진과 분리 저장)
- `notes` — `{ id, bookId, text, source: 'text' | 'voice', createdAt, updatedAt }`

사진 목록을 그릴 때 바이너리를 읽지 않도록 메타데이터와 Blob을 분리했습니다.

## 검증

headless Chromium(Playwright)으로 실제 렌더링·저장·내보내기를 확인합니다.

```bash
python3 tests/make_fixture.py           # 테스트용 책 페이지 사진 생성
python3 -m http.server 8123 &
python3 tests/e2e.py                    # 결과: 40+ checks, console error 0
```

검증 항목: 책 추가/수정, 사진 압축(용량·해상도), IndexedDB Blob 저장, 라이트박스,
메모 저장, Markdown/TXT 다운로드, 클립보드 복사, 검색, 여러 책 엮기·미리보기,
새로고침 후 유지, 저장공간 표시, JSON 백업 → 초기화 → 복원, 서비스 워커, 모바일 레이아웃.

최근 실행 결과: `tests/RESULTS.md` (PASS 43 / FAIL 0, console error 0).

스크린샷: `screenshots/01-shelf-empty.png` … `screenshots/19-offline.png`

빈 서재에서 **샘플 서재로 둘러보기**를 누르면 예시 3권(밑줄 카드 포함)이 채워집니다.
지우고 내 기록으로 시작해도 됩니다.

## 파일

```
index.html            앱 셸 (모든 화면)
assets/styles.css     디자인 시스템
assets/app.js         IndexedDB · 이미지 압축 · 음성 · 내보내기
manifest.webmanifest  PWA 매니페스트
sw.js                 오프라인 서비스 워커
icons/                앱 아이콘 (192/512/maskable/apple-touch)
tests/                Playwright 검증 스크립트
screenshots/          검증 스크린샷 · 샘플 내보내기 결과
```
