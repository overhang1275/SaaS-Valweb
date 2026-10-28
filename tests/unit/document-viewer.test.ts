import { expect, it } from "vitest";
import { boundView, fitScale, zoomView, FIT_VIEW } from "../../src/components/ui/document-viewer-math";
import { imageViewerHash, validViewerSecret } from "../../src/features/public/viewer-session";
it("fits portrait and landscape images without cropping", () => {
  expect(fitScale({ width: 600, height: 400 }, { width: 1000, height: 1000 })).toBe(.4);
  expect(fitScale({ width: 300, height: 500 }, { width: 1200, height: 600 })).toBe(.25);
});
it("bounds zoom and panning so an image cannot be dragged out of its viewport", () => {
  const viewport = { width: 600, height: 400 }, image = { width: 1000, height: 1000 };
  expect(boundView({ zoom: 1, x: 900, y: -900 }, viewport, image)).toEqual(FIT_VIEW);
  expect(boundView({ zoom: 2, x: 900, y: -900 }, viewport, image)).toEqual({ zoom: 2, x: 100, y: -200 });
  expect(boundView({ zoom: 20, x: 0, y: 0 }, viewport, image).zoom).toBe(5);
  expect(boundView({ zoom: .1, x: 9, y: 9 }, viewport, image)).toEqual(FIT_VIEW);
});
it("keeps the same image point under the zoom anchor and resets at fit", () => {
  const viewport = { width: 400, height: 400 }, image = { width: 1000, height: 1000 };
  const next = zoomView(FIT_VIEW, 2, { x: 50, y: 30 }, viewport, image);
  expect(next).toEqual({ zoom: 2, x: -50, y: -30 });
  expect(zoomView(next, 1, { x: 50, y: 30 }, viewport, image)).toEqual(FIT_VIEW);
});
it("validates browser secrets and hashes the binding without exposing the secret", () => {
  const secret = "a".repeat(64);
  expect(validViewerSecret(secret)).toBe(secret);
  for (const value of [undefined, "", "bad", "x".repeat(64), "a".repeat(65)]) expect(validViewerSecret(value)).toBeNull();
  expect(imageViewerHash(secret)).toMatch(/^[a-f0-9]{64}$/);
  expect(imageViewerHash(secret)).not.toBe(secret);
  expect(imageViewerHash(secret)).not.toBe(imageViewerHash("b".repeat(64)));
});
