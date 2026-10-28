import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn().mockResolvedValue(null) } } }));
vi.mock("argon2", async importOriginal => {
  const original = await importOriginal<typeof import("argon2")>();
  return { ...original, verify: vi.fn(original.verify) };
});

import { verify } from "argon2";
import { authenticate } from "../../src/features/identity/service";

describe("login account enumeration", () => {
  it("performs password verification even when the account does not exist", async () => {
    expect(await authenticate("unknown@example.test", "A-long-test-password-123")).toBeNull();
    expect(verify).toHaveBeenCalledOnce();
  });
});
