from PIL import Image, ImageDraw
import math

S = 2048            # 4배로 그린 뒤 512 로 줄입니다 (가장자리가 매끄러워집니다)
OUT = 512

# ── 배경: 따뜻한 노을 그라데이션 ──────────────────────────────
top    = (255, 184,  77)     # 옅은 주황
bottom = (240,  88,  72)     # 붉은 주황
bg = Image.new("RGB", (S, S))
px = bg.load()
for y in range(S):
    t = y / (S - 1)
    # 가운데가 살짝 밝게 보이도록 약하게 휘어줍니다
    e = t ** 0.92
    row = tuple(round(top[i] + (bottom[i] - top[i]) * e) for i in range(3))
    for x in range(S):
        px[x, y] = row
im = bg.convert("RGBA")
d  = ImageDraw.Draw(im)

W = (255, 255, 255, 255)

# ── 길: 아래 왼쪽에서 핀까지 점선으로 ───────────────────────
def bez(p0, p1, p2, t):
    u = 1 - t
    return (u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0],
            u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1])

P0, P1, P2 = (470, 1455), (990, 1680), (1360, 1235)

R0 = 84 + 46 / 2 + 40          # 동그라미 바깥선 + 숨 쉴 틈
pts = [bez(P0, P1, P2, i / 600) for i in range(601)]
TIP = (1360, 1252)             # 핀 끝 — 점선이 핀을 뚫고 지나가지 않게 멈춥니다
pts = [q for q in pts if math.dist(q, P0) >= R0 and math.dist(q, TIP) >= 58] or pts
# 길이에 따라 점선을 끊습니다 (등간격이라야 점 크기가 고르게 보입니다)
seg, acc = [], 0.0
dash, gap, on, run = 86.0, 74.0, True, 0.0
cur = [pts[0]]
for a, b in zip(pts, pts[1:]):
    run += math.dist(a, b)
    cur.append(b)
    if run >= (dash if on else gap):
        if on: seg.append(cur)
        cur, run, on = [b], 0.0, not on
if on and len(cur) > 1:
    seg.append(cur)

for s in seg:
    d.line(s, fill=W, width=46, joint="curve")

# ── 출발점: 속이 빈 동그라미 ────────────────────────────────
r, wd = 86, 48
d.ellipse([P0[0]-r, P0[1]-r, P0[0]+r, P0[1]+r], outline=W, width=wd)

# ── 도착점: 지도 핀 ─────────────────────────────────────────
cx, cy, R = 1360, 830, 252
tip  = (1360, 1252)
half = 155                      # 핀 꼬리의 어깨 너비

d.ellipse([cx-R, cy-R, cx+R, cy+R], fill=W)
# 꼬리: 어깨를 원 안쪽에서 시작해 원과 매끄럽게 이어붙입니다
sy = cy + math.sqrt(max(R*R - half*half, 1)) - 6
d.polygon([(cx-half, sy), (cx+half, sy), tip], fill=W)
# 가운데 구멍은 배경색으로 뚫습니다
hole = 105
d.ellipse([cx-hole, cy-hole, cx+hole, cy+hole], fill=(0, 0, 0, 0))

# 구멍 자리에 배경을 다시 깔아줍니다 (alpha 0 으로 뚫으면 투명해지므로)
out = bg.copy()
out.paste(im, (0, 0), im)

out = out.resize((OUT, OUT), Image.LANCZOS)
out.save("app/assets/brand/app-icon-512.png", optimize=True)
print("저장:", out.size, out.mode)
