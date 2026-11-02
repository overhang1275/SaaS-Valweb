import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), save: vi.fn(), read: vi.fn(), send: vi.fn(), limit: vi.fn(), audit: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getActor: mocks.actor }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { create: mocks.audit } } }));
vi.mock("@/features/system/mail-settings", () => ({ saveMailSettings: mocks.save, getMailSettings: mocks.read, MailSettingsError: class extends Error {} }));
vi.mock("@/features/identity/mail", () => ({ sendConfiguredTestEmail: mocks.send }));
vi.mock("@/features/identity/rate-limit", () => ({ limitRequest: mocks.limit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { saveMailSettingsAction, sendConfiguredTestEmailAction } from "@/features/system/actions";
const state = { status: "idle" as const, message: "" };
const admin = { id: "admin", role: "ADMIN", tenantId: null, sessionVersion: 0 };
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue(admin); mocks.limit.mockResolvedValue(true); mocks.send.mockResolvedValue("recipient@example.test"); });
afterEach(() => { vi.restoreAllMocks(); });

it("saves the SMTP fields from the administrator form", async () => {
  const form = new FormData();
  for (const [key, value] of Object.entries({ host: "smtp.example.test", port: "587", from: "sender@example.test", user: "login", password: "secret" })) form.set(key, value);
  expect((await saveMailSettingsAction(state, form)).status).toBe("success");
  expect(mocks.save).toHaveBeenCalledWith(admin, { host: "smtp.example.test", port: "587", from: "sender@example.test", user: "login", password: "secret" });
});
it.each([null, { ...admin, role: "CLIENT" }])("rejects saving without an administrator session", async actor => {
  mocks.actor.mockResolvedValue(actor);
  expect((await saveMailSettingsAction(state, new FormData())).status).toBe("error");
  expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects a revoked administrator before sending a test message", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.read.mockRejectedValue(new Error("revoked"));
  expect((await sendConfiguredTestEmailAction(state, new FormData())).status).toBe("error");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("keeps the existing rate limit on test messages", async () => {
  mocks.limit.mockResolvedValue(false);
  expect((await sendConfiguredTestEmailAction(state, new FormData())).message).toMatch(/un minuto/);
  expect(mocks.send).not.toHaveBeenCalled();
});
