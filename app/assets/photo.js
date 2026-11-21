/* ============================================================
   photo.js — 올리기 전에 사진을 줄입니다

   ★ 왜 원본을 그대로 안 올리는가

   1) 용량이 이 서비스에서 유일하게 진짜 돈이 드는 자원입니다.
      요즘 휴대폰 사진 한 장이 3~5MB 입니다. 30장이면 150MB 이고,
      친구 열 명이 한 번씩 보면 1.5GB 가 오갑니다. 줄이면 같은
      사진이 250KB 가 되어 전송량이 20분의 1이 됩니다.

   2) ★ 위치정보가 지워집니다 — 이게 더 중요합니다.

      휴대폰 사진에는 찍은 자리의 GPS 좌표가 EXIF 로 박혀 있습니다.
      숙소에서 찍은 사진을 그대로 올리면 숙소 위치가 좌표까지
      그대로 공개됩니다. 링크를 가진 누구나 볼 수 있는 방인데요.

      캔버스에 다시 그려서 내보내면 EXIF 가 통째로 사라집니다.
      따로 지우는 코드를 쓰지 않아도, 줄이는 과정에서 저절로
      없어집니다. 그래서 "줄이기"를 선택이 아니라 필수로 둡니다.

   3) 회전 정보도 EXIF 에 있는데, createImageBitmap 의
      imageOrientation:"from-image" 가 그걸 보고 실제로 돌려줍니다.
      그래서 EXIF 를 지워도 사진이 눕지 않습니다.
   ============================================================ */

export const LIMITS = {
  longEdge: 1600,      // 긴 변 (보기용)
  thumbEdge: 400,      // 목록용
  quality: 0.82,
  thumbQuality: 0.72,
  maxBytes: 10 * 1024 * 1024,   // 올리기 전 원본 상한
};

/* 브라우저가 이 기능을 쓸 수 있나 */
export function canResize() {
  return typeof createImageBitmap === "function" &&
         (typeof OffscreenCanvas === "function" ||
          typeof document !== "undefined");
}

/* webp 를 못 만드는 브라우저면 jpeg 로 */
export function bestType() {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    if (c.toDataURL("image/webp").startsWith("data:image/webp")) return "image/webp";
  } catch (_) { /* 아래로 */ }
  return "image/jpeg";
}

function fit(w, h, edge) {
  if (w <= edge && h <= edge) return { w, h };
  const r = w > h ? edge / w : edge / h;
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
}

async function draw(bitmap, w, h, type, quality) {
  if (typeof OffscreenCanvas === "function") {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await c.convertToBlob({ type, quality });
  }
  /* OffscreenCanvas 가 없는 브라우저 (좀 된 사파리) */
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  return await new Promise((res) => c.toBlob(res, type, quality));
}

/**
 * 파일 하나를 "보기용"과 "목록용" 두 장으로 줄입니다.
 * @returns {{ full:Blob, thumb:Blob, width:number, height:number, type:string }}
 */
export async function prepare(file, opts = {}) {
  const L = { ...LIMITS, ...opts };

  if (!file || !/^image\//.test(file.type || "")) {
    throw new Error("사진 파일만 올릴 수 있어요");
  }
  if (file.size > L.maxBytes) {
    throw new Error("사진이 너무 커요 (10MB까지)");
  }
  if (!canResize()) {
    throw new Error("이 브라우저에서는 사진 올리기를 쓸 수 없어요");
  }

  /* ★ from-image: EXIF 의 회전 정보를 보고 실제로 돌려서 읽습니다.
     이걸 안 하면 아래에서 EXIF 를 지우는 순간 사진이 눕습니다. */
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (_) {
    bitmap = await createImageBitmap(file);   // 옵션을 모르는 브라우저
  }

  const type = bestType();
  const big = fit(bitmap.width, bitmap.height, L.longEdge);
  const small = fit(bitmap.width, bitmap.height, L.thumbEdge);

  const full = await draw(bitmap, big.w, big.h, type, L.quality);
  const thumb = await draw(bitmap, small.w, small.h, type, L.thumbQuality);
  if (bitmap.close) bitmap.close();

  if (!full || !thumb) throw new Error("사진을 줄이지 못했어요");

  return { full, thumb, width: big.w, height: big.h, type };
}

/* 사람이 읽는 용량 */
export const prettyBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v}B`;
  if (v < 1024 * 1024) return `${Math.round(v / 1024)}KB`;
  return `${(v / 1024 / 1024).toFixed(1)}MB`;
};
