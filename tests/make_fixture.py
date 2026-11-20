from PIL import Image, ImageDraw, ImageFont
import os

os.makedirs('tests/fixtures', exist_ok=True)
W, H = 2400, 3200
img = Image.new('RGB', (W, H), (248, 243, 233))
d = ImageDraw.Draw(img)
serif = ImageFont.truetype('/usr/share/fonts/pickle-hwp/NotoSerifCJKkr-Regular.otf', 78)
small = ImageFont.truetype('/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf', 46)

lines = [
    "덜어냄은 비움이 아니라 선택이다.",
    "우리는 무엇을 남길지 고를 때",
    "비로소 자기 자신이 된다.",
    "",
    "서랍을 열 때마다 손이 멈추는 물건이 있다.",
    "그 물건이 아직 나를 붙잡고 있다는 뜻이다.",
    "그러나 붙잡는 것과 필요한 것은 다르다.",
]
y = 620
for ln in lines:
    if ln:
        d.text((300, y), ln, font=serif, fill=(43, 37, 32))
    y += 140
# page number
d.text((W - 320, H - 220), "128", font=small, fill=(120, 105, 90))
# subtle underline
d.line([(300, 1060), (1500, 1060)], fill=(176, 96, 60), width=6)
img.save('tests/fixtures/book-page.jpg', quality=94)
print(os.path.getsize('tests/fixtures/book-page.jpg'))
