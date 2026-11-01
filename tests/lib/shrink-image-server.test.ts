import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { shrinkImageBuffer } from "@/lib/shrink-image-server";

/** 무작위 픽셀이라 압축이 거의 안 되는 큰 PNG. */
async function noisyPng(width: number, height: number, channels: 3 | 4 = 3): Promise<Buffer> {
  return sharp(randomBytes(width * height * channels), { raw: { width, height, channels } }).png().toBuffer();
}

describe("shrinkImageBuffer", () => {
  it("re-encodes a big photo as JPEG under the limit", async () => {
    const big = await noisyPng(2000, 1500);
    const max = 1024 * 1024;
    expect(big.length).toBeGreaterThan(max);

    const result = await shrinkImageBuffer(big, max);

    expect(result).not.toBeNull();
    expect(result!.contentType).toBe("image/jpeg");
    expect(result!.data.length).toBeLessThanOrEqual(max);
    const meta = await sharp(result!.data).metadata();
    expect(meta.format).toBe("jpeg");
  });

  it("fills transparency with white instead of black", async () => {
    const transparent = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const result = await shrinkImageBuffer(transparent, 1024 * 1024);
    const { data } = await sharp(result!.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
  });

  it("returns null for bytes that are not an image", async () => {
    expect(await shrinkImageBuffer(Buffer.from("not an image"), 1024)).toBeNull();
  });
});
