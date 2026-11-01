import sharp from "sharp";

/**
 * 서버에서 이미지를 JPEG로 다시 저장해 maxBytes 아래로 줄인다. 버킷이 파일당 5MB만 받아서
 * 그보다 큰 회신 사진을 버리지 않고 줄여 저장하려고 쓴다(브라우저 쪽은 lib/shrink-image.ts).
 * 휴대폰 사진의 회전(EXIF)을 먼저 반영하고, JPEG는 투명을 못 담으므로 흰 바탕을 깐다.
 * 품질을 낮춰 보고 그래도 크면 긴 변을 줄여 가며 다시 시도한다. 못 줄이면 null.
 */
const QUALITIES = [85, 75, 65];
const LONG_EDGES = [4096, 3072, 2048, 1600, 1200];

export async function shrinkImageBuffer(
  data: Buffer,
  maxBytes: number
): Promise<{ data: Buffer; contentType: "image/jpeg" } | null> {
  try {
    const base = sharp(data, { failOn: "none", animated: false }).rotate().flatten({ background: "#ffffff" });
    for (const edge of LONG_EDGES) {
      const resized = base.clone().resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
      for (const quality of QUALITIES) {
        const out = await resized.clone().jpeg({ quality }).toBuffer();
        if (out.length <= maxBytes) return { data: out, contentType: "image/jpeg" };
      }
    }
    return null;
  } catch (error) {
    console.warn("[shrink-image] 이미지 줄이기 실패", error);
    return null;
  }
}
