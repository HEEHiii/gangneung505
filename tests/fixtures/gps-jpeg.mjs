/* ============================================================
   GPS 가 박힌 사진 만들기 — 테스트용

   ★ 왜 이런 걸 만드는가

   휴대폰 사진에는 찍은 자리의 GPS 좌표가 EXIF 로 들어 있습니다.
   숙소에서 찍은 사진을 그대로 올리면 숙소 위치가 좌표까지 공개
   됩니다. 링크를 가진 누구나 볼 수 있는 방인데요.

   우리는 사진을 줄이면서 그게 저절로 지워진다고 말합니다. 그 말이
   진짜인지 확인하려면 "좌표가 박힌 사진"이 있어야 합니다.

   저장소에 사진 파일을 넣지 않고 여기서 만듭니다 —
   바이너리는 들여다볼 수 없어서, 정말 좌표가 들어 있는지 아무도
   확인하지 못한 채 믿게 됩니다. 코드는 읽을 수 있습니다.
   ============================================================ */

/* 320x240 노이즈 JPEG (EXIF 없음) */
const PLAIN_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0d" +
  "Hx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4e" +
  "Hh4eHh4eHh7/wAARCADwAUADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUF" +
  "BAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVW" +
  "V1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi" +
  "4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAEC" +
  "AxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm" +
  "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq" +
  "8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD5o0/w/wBPk/Sui0/w/wBPk/Su40/w/wBPk/Suj0/w/wBPk/SqwuIPIyjiXbU4fT/D/T5P" +
  "0rotP8P9Pk/Su40/w/0+T9K6LT/D/T5P0r6LC4g/T8o4l21PGfiL4f8A+Ketvk/5e17f7D1yEGjR28XmyrgD25J9BX0J8TtGjt/D" +
  "FvLIuALte3JOx+BXmSaTJdTB3TCj7q9gK9zG8cUchy9U6dpVpXsu396Xl2XX72viuLc9dXPnd6csTh00mS6lDumAPur2Arb0/wAP" +
  "9Pk/Su40/wAP9Pk/Sui0/wAP9Pk/Svyd5nWxlaVevJynJ3bf9f8ADH0+T8RqKSTOH0/w/wBPk/SuF8Y+H/8Air735P8Ann2/6ZrX" +
  "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";

const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];

/* 도·분·초 세 쌍 (각각 분자/분모 4바이트씩) */
function degBytes(v) {
  const d = Math.floor(v);
  const m = Math.floor((v - d) * 60);
  const s = Math.round((((v - d) * 60) - m) * 3600 * 100);
  return [...be32(d), ...be32(1), ...be32(m), ...be32(1), ...be32(s), ...be32(100)];
}

/* TIFF 헤더 + IFD0(GPSInfo 만) + GPS IFD + 값들 */
function exifWithGps(lat, lng) {
  const GPS_COUNT = 4;
  const TIFF_HEADER = 8;
  const IFD0_SIZE = 2 + 1 * 12 + 4;
  const GPS_IFD_SIZE = 2 + GPS_COUNT * 12 + 4;
  const gpsIfdOffset = TIFF_HEADER + IFD0_SIZE;
  const dataOffset = gpsIfdOffset + GPS_IFD_SIZE;

  const latB = degBytes(lat), lngB = degBytes(lng);

  const ifd0 = [
    ...be16(1),
    ...be16(0x8825), ...be16(4), ...be32(1), ...be32(gpsIfdOffset),
    ...be32(0),
  ];
  const gps = [
    ...be16(GPS_COUNT),
    ...be16(1), ...be16(2), ...be32(2), 0x4e, 0, 0, 0,                    // N
    ...be16(2), ...be16(5), ...be32(3), ...be32(dataOffset),              // 위도
    ...be16(3), ...be16(2), ...be32(2), 0x45, 0, 0, 0,                    // E
    ...be16(4), ...be16(5), ...be32(3), ...be32(dataOffset + latB.length),// 경도
    ...be32(0),
  ];

  return [
    0x45, 0x78, 0x69, 0x66, 0, 0,          // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, ...be32(8),    // MM (빅엔디언), 42, IFD0 위치
    ...ifd0, ...gps, ...latB, ...lngB,
  ];
}

const b64ToBytes = (s) => {
  const bin = typeof atob === "function"
    ? atob(s)
    : Buffer.from(s, "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** GPS 좌표가 박힌 JPEG 바이트를 돌려줍니다 */
export function gpsJpegBytes(lat = 37.8250, lng = 128.8780) {
  const jpg = b64ToBytes(PLAIN_JPEG_B64);
  const exif = exifWithGps(lat, lng);
  const app1 = [0xff, 0xe1, ...be16(exif.length + 2), ...exif];

  const out = new Uint8Array(jpg.length + app1.length);
  out.set(jpg.subarray(0, 2), 0);              // SOI
  out.set(app1, 2);                            // APP1(EXIF)
  out.set(jpg.subarray(2), 2 + app1.length);   // 나머지
  return out;
}
