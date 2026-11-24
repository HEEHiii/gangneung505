from PIL import Image, ImageDraw, ImageFont
import math, subprocess, glob

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

# ── 오른쪽: 핀과 길 (아이콘과 같은 모양) ──
def bez(p0, p1, p2, t):
    u = 1 - t
    return (u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0],
            u*u*p0[1] + 2*u*t*p1[1] + t*t*p2[1])

cx, cy, R = int(w * 0.805), int(h * 0.40), int(h * 0.115)
tip = (cx, cy + int(R * 1.62))
P0 = (int(w * 0.655), int(h * 0.80))
P1 = (int(w * 0.745), int(h * 0.90))
P2 = (tip[0], tip[1])

pts = [bez(P0, P1, P2, i / 600) for i in range(601)]
R0 = int(h * 0.055)
pts = [q for q in pts if math.dist(q, P0) >= R0 and math.dist(q, tip) >= h * 0.030]

seg, cur, run, on = [], [pts[0]], 0.0, True
dash, gap = h * 0.042, h * 0.036
for a, b in zip(pts, pts[1:]):
    run += math.dist(a, b); cur.append(b)
    if run >= (dash if on else gap):
        if on: seg.append(cur)
        cur, run, on = [b], 0.0, not on
if on and len(cur) > 1: seg.append(cur)
for sgl in seg:
    d.line(sgl, fill=W_, width=int(h * 0.022), joint="curve")

r0, wd = int(h * 0.040), int(h * 0.022)
d.ellipse([P0[0]-r0, P0[1]-r0, P0[0]+r0, P0[1]+r0], outline=W_, width=wd)

d.ellipse([cx-R, cy-R, cx+R, cy+R], fill=W_)
half = int(R * 0.62)
sy = cy + math.sqrt(max(R*R - half*half, 1)) - R * 0.03
d.polygon([(cx-half, sy), (cx+half, sy), tip], fill=W_)
hole = int(R * 0.415)
d.ellipse([cx-hole, cy-hole, cx+hole, cy+hole], fill=(0, 0, 0, 0))

out = bg.copy(); out.paste(im, (0, 0), im)
d2 = ImageDraw.Draw(out)

# ── 왼쪽: 글자 ──
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
REG  = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
f_big   = ImageFont.truetype(BOLD, int(h * 0.105), index=1)   # index 1 = 한국어
f_small = ImageFont.truetype(REG,  int(h * 0.050), index=1)

x = int(w * 0.075)
y = int(h * 0.285)
d2.text((x, y), "친구들과", font=f_big, fill=W_)
y += int(h * 0.125)
d2.text((x, y), "여행계획", font=f_big, fill=W_)

y += int(h * 0.155)
d2.text((x, y), "숙소도 맛집도 투표로 정하고,", font=f_small, fill=(255, 255, 255, 232))
y += int(h * 0.072)
d2.text((x, y), "일정과 정산까지 한 곳에서", font=f_small, fill=(255, 255, 255, 232))

out = out.resize((W, H), Image.LANCZOS)
out.save("app/assets/brand/og.png", optimize=True)
print("저장: app/assets/brand/og.png", out.size)
