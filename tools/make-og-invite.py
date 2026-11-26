"""친구 초대 링크용 미리보기 그림 (app/assets/brand/og-invite.png)

실행:  python3 tools/make-og-invite.py

── 왜 따로 만드나

첫 화면과 방 링크가 같은 그림을 쓰고 있었다. 그런데 그 둘은
카톡에서 전혀 다른 상황에 뜬다.

  첫 화면  "이런 서비스가 있다"      — 처음 보는 사람에게
  방 링크  "너 초대했어, 들어와"      — 이미 아는 사람에게

같은 그림이면 받는 쪽이 "광고인가?" 하고 넘긴다. 봉투가 있으면
0.2초 만에 "나한테 온 것" 으로 읽힌다.

── 조형

make-og.py 와 같은 노을 그라데이션을 쓴다. 같은 서비스로 보여야
하니까. 다른 것은 오른쪽 그림뿐이다 — 핀 대신 봉투.
"""

from PIL import Image, ImageDraw, ImageFont
import math

W, H, S = 1200, 630, 3          # 3배로 그린 뒤 줄입니다
w, h = W * S, H * S

top, bottom = (255, 184, 77), (240, 88, 72)
bg = Image.new("RGB", (w, h))
px = bg.load()
for y in range(h):
    e = (y / (h - 1)) ** 0.92
    row = tuple(round(top[i] + (bottom[i] - top[i]) * e) for i in range(3))
    for x in range(w):
        px[x, y] = row
im = bg.convert("RGBA")
d = ImageDraw.Draw(im)
W_ = (255, 255, 255, 255)

# ── 오른쪽: 편지봉투 ──
#
# 열린 봉투로 그린다. 닫힌 봉투는 "아직 안 읽은 것" 이지만
# 열린 봉투는 "너한테 온 것" 에 가깝고, 안에 든 카드가 보여서
# 무언가 들어 있다는 것이 전달된다.
cx, cy = int(w * 0.785), int(h * 0.50)
bw, bh = int(w * 0.235), int(h * 0.335)      # 봉투 몸통
x0, y0 = cx - bw // 2, cy - bh // 2
x1, y1 = x0 + bw, y0 + bh
r = int(h * 0.022)
line = int(h * 0.020)

# 안에서 삐져나온 카드 (봉투보다 먼저 그려서 뒤에 깔립니다)
cw = int(bw * 0.74)
ch = int(bh * 0.72)
card_x = cx - cw // 2
card_y = y0 - int(bh * 0.26)
d.rounded_rectangle([card_x, card_y, card_x + cw, card_y + ch],
                    radius=int(h * 0.014), fill=W_)
# 카드 위의 글줄 두 개 (주황으로 비워서 '글이 적혀 있다'만 전합니다)
gap = int(ch * 0.22)
for i in range(2):
    ly = card_y + int(ch * 0.30) + i * gap
    d.rounded_rectangle(
        [card_x + int(cw * 0.18), ly,
         card_x + int(cw * (0.82 if i == 0 else 0.62)), ly + int(h * 0.016)],
        radius=int(h * 0.008), fill=(244, 128, 72, 255))

# 봉투 몸통 — 카드 아랫부분을 가립니다
d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=W_)

# 봉투 입구의 V 자 (몸통을 주황으로 파내서 접힌 덮개를 만듭니다)
flap_h = int(bh * 0.46)
d.polygon([(x0 + line, y0 + line),
           (x1 - line, y0 + line),
           (cx, y0 + flap_h)], fill=(0, 0, 0, 0))

out = bg.copy()
out.paste(im, (0, 0), im)
d2 = ImageDraw.Draw(out)

# 봉투 덮개를 다시 흰 선으로 그려 윤곽을 살립니다
d2.line([(x0 + line, y0 + line), (cx, y0 + flap_h), (x1 - line, y0 + line)],
        fill=W_, width=line, joint="curve")

# ── 왼쪽: 글자 ──
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
f_big = ImageFont.truetype(BOLD, int(h * 0.105), index=1)   # index 1 = 한국어
f_small = ImageFont.truetype(REG, int(h * 0.050), index=1)

x = int(w * 0.075)
y = int(h * 0.285)
d2.text((x, y), "여행에", font=f_big, fill=W_)
y += int(h * 0.125)
d2.text((x, y), "초대받았어요", font=f_big, fill=W_)

y += int(h * 0.155)
d2.text((x, y), "링크를 열고 비밀번호만 넣으면 끝.", font=f_small, fill=(255, 255, 255, 232))
y += int(h * 0.072)
d2.text((x, y), "가입은 없습니다.", font=f_small, fill=(255, 255, 255, 232))

out = out.resize((W, H), Image.LANCZOS)
out.save("app/assets/brand/og-invite.png", optimize=True)
print("저장: app/assets/brand/og-invite.png", out.size)
