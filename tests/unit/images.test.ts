import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { prepareImage, readImageBody, reserveImageUpload } from "../../src/features/images/processing";
import { writeImageFile, readImageFile, removeImageFile, purgeOrphanImages } from "../../src/features/images/storage";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "valweb-image-unit-"));
  vi.stubEnv("IMAGE_STORAGE_DIR", directory);
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("private image processing", () => {
  it("accepts JPEG/JPG/PNG/WebP and strips metadata by reencoding", async () => {
    for (const [extension, mime, format] of [["jpg", "image/jpeg", "jpeg"], ["jpeg", "image/jpeg", "jpeg"], ["png", "image/png", "png"], ["webp", "image/webp", "webp"]] as const) {
      const input = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#b8336a" } }).toFormat(format).withMetadata().toBuffer();
      const result = await prepareImage(input, `image.${extension}`, mime);
      const metadata = await sharp(result.data).metadata();
      expect(result.width).toBe(120); expect(result.height).toBe(80);
      expect(metadata.format).toBe("webp"); expect(metadata.exif).toBeUndefined(); expect(metadata.icc).toBeUndefined();
    }
  });
  it("rejects disguised, corrupt, unsupported and excessively large images", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareImage(png, "x.jpg", "image/jpeg")).rejects.toThrow();
    await expect(prepareImage(png, "x.svg", "image/svg+xml")).rejects.toThrow();
    await expect(prepareImage(Buffer.from("not an image"), "x.png", "image/png")).rejects.toThrow();
    await expect(prepareImage(Buffer.alloc(10 * 1024 * 1024 + 1), "x.png", "image/png")).rejects.toThrow();
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareImage(huge, "x.png", "image/png")).rejects.toThrow();
  });
  it("reports the exact JPEG warning instead of mixing unrelated causes", async () => {
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).jpeg().toBuffer();
    const corrupt = Buffer.concat([jpeg.subarray(0, 2), Buffer.from([1]), jpeg.subarray(2)]);
    await expect(prepareImage(corrupt, "6SbvATGJ.jpeg", "image/jpeg")).rejects.toThrow("1 byte sobrante antes del marcador JPEG 0xdb");
    await expect(prepareImage(corrupt, "6SbvATGJ.jpeg", "image/jpeg")).rejects.toThrow("Corrupt JPEG data");
  });
  it("distinguishes the actual format, empty files and pixel limits", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareImage(png, "x.jpg", "image/jpeg")).rejects.toThrow("contenido real es PNG");
    await expect(prepareImage(Buffer.alloc(0), "x.png", "image/png")).rejects.toThrow("vacío");
    const huge = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
    await expect(prepareImage(huge, "x.png", "image/png")).rejects.toThrow("20 millones de píxeles");
  });
  it("bounds streamed bytes even without an honest Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6 * 1024 * 1024)); controller.enqueue(new Uint8Array(6 * 1024 * 1024)); controller.close(); } });
    const request = new Request("http://localhost/upload", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    await expect(readImageBody(request)).rejects.toThrow();
    expect((await readImageBody(new Request("http://localhost/upload", { method: "POST", body: "small" }))).toString()).toBe("small");
  });
  it("stores random private keys and rejects path traversal", async () => {
    const data = Buffer.from("bounded test data");
    const key = await writeImageFile(data);
    expect(key).toMatch(/^[a-f0-9-]{36}\.webp$/);
    expect(await readImageFile(key)).toEqual(data);
    await expect(readImageFile("../../.env")).rejects.toThrow();
    await expect(removeImageFile("../outside.webp")).rejects.toThrow();
    await removeImageFile(key);
    await expect(readImageFile(key)).rejects.toThrow();
  });
  it("purges only old unreferenced files and keeps live or recent files", async () => {
    const old = await writeImageFile(Buffer.from("orphan"));
    const live = await writeImageFile(Buffer.from("live"));
    const recent = await writeImageFile(Buffer.from("recent"));
    const past = new Date(Date.now() - 48 * 3600000);
    await utimes(join(directory, old), past, past);
    await utimes(join(directory, live), past, past);
    expect(await purgeOrphanImages(new Set([live]))).toBe(1);
    await expect(readImageFile(old)).rejects.toThrow();
    expect((await readImageFile(live)).toString()).toBe("live");
    expect((await readImageFile(recent)).toString()).toBe("recent");
  });
  it("bounds simultaneous uploads and releases admission idempotently", () => {
    const first = reserveImageUpload(), second = reserveImageUpload();
    expect(() => reserveImageUpload()).toThrow();
    first(); first();
    const third = reserveImageUpload();
    expect(() => reserveImageUpload()).toThrow();
    second(); third();
  });
  it("does not allow configuring the private store inside public", async () => {
    vi.stubEnv("IMAGE_STORAGE_DIR", join(process.cwd(), "public", "uploads"));
    try { await expect(writeImageFile(Buffer.from("private"))).rejects.toThrow("fuera de public"); }
    finally { vi.stubEnv("IMAGE_STORAGE_DIR", directory); }
  });
});
