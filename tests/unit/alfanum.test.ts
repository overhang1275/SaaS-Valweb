import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { imageAlfanum, normalizeAlfanum } from "../../src/features/records/alfanum";
import { createImageGrant, readImageGrant } from "../../src/features/public/grants";
import { readBoundedJson } from "../../src/lib/request-json";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
it("matches case-insensitive alfanum filenames without converting a displayed folio to number", () => {
  expect(normalizeAlfanum(" 4frs5 ")).toBe("4FRS5"); expect(imageAlfanum("4frs5.PNG")).toBe("4FRS5");
  expect(normalizeAlfanum("0001")).toBe("0001");
  expect(() => normalizeAlfanum("bad-code")).toThrow(); expect(() => imageAlfanum("4frs5.svg")).toThrow();
});
it("encrypts short-lived image grants and rejects tampering and expiration", () => {
  vi.stubEnv("NEXTAUTH_SECRET", "unit-only-secret-".repeat(4));
  const data = { validationId: randomUUID(), datasetId: randomUUID(), imageId: randomUUID(), storageKey: `${randomUUID()}.webp`, viewerHash: "a".repeat(64) };
  const grant = createImageGrant(data);
  expect(grant).not.toContain(data.storageKey); expect(readImageGrant(grant)).toMatchObject(data);
  const mutated = `${grant.slice(0, 20)}${grant[20] === "a" ? "b" : "a"}${grant.slice(21)}`;
  expect(readImageGrant(mutated)).toBeNull();
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 6 * 60000); expect(readImageGrant(grant)).toBeNull();
});
it("bounds JSON bodies even without Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(3000))); controller.close(); } });
  const request = new Request("http://localhost/test", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
  await expect(readBoundedJson(request, 2048)).rejects.toThrow(RangeError);
});
