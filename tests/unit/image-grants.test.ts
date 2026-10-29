import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createImageGrant, readImageGrant } from "../../src/features/public/grants";

afterEach(() => vi.unstubAllEnvs());
it("round-trips legacy and destination image keys without exposing their paths", () => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-only-image-grant-secret");
  const validationId = randomUUID();
  for (const storageKey of [`${randomUUID()}.webp`, `v1:LOCAL:${randomUUID()}_${validationId}:${randomUUID()}.webp`]) {
    const input = { validationId, datasetId: randomUUID(), imageId: randomUUID(), storageKey, viewerHash: "a".repeat(64) };
    expect(readImageGrant(createImageGrant(input))).toMatchObject(input);
  }
});
