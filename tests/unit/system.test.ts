import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), actor: vi.fn(), currentActor: vi.fn(), limit: vi.fn(), audit: vi.fn(), refresh: vi.fn(), query: vi.fn(), jobs: vi.fn(), space: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.exec }));
vi.mock("node:fs/promises", async importOriginal => ({ ...await importOriginal<typeof import("node:fs/promises")>(), statfs: mocks.space }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (run: (tx: object) => unknown) => run({}), auditLog: { create: mocks.audit }, $queryRaw: mocks.query, importJob: { groupBy: mocks.jobs } } }));
vi.mock("@/lib/auth", () => ({ getActor: mocks.actor }));
vi.mock("@/features/identity/service", () => ({ currentActor: mocks.currentActor }));
vi.mock("@/features/identity/rate-limit", () => ({ limitRequest: mocks.limit }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { getImportWorkerStatus, getSystemStatus, restartImportWorker } from "@/features/system/service";
import { restartImportWorkerAction } from "@/features/system/actions";

const admin = { id: "admin", role: "ADMIN" as const, tenantId: null, sessionVersion: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VALWEB_TEST_INSTANCE", "");
  mocks.actor.mockResolvedValue(admin); mocks.currentActor.mockResolvedValue(admin); mocks.limit.mockResolvedValue(true);
  mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, "LoadState=loaded\nActiveState=active\nSubState=running\n"));
});
afterEach(() => { vi.unstubAllEnvs(); });
it("shows measured storage and real import counts, including zero", async () => {
  mocks.query.mockResolvedValue([{ value: 1 }]);
  mocks.space.mockResolvedValue({ bavail: 3 * 1024 ** 2, bsize: 1024 });
  mocks.jobs.mockResolvedValue([{ status: "QUEUED", _count: 2 }, { status: "REVIEW", _count: 1 }]);
  expect(await getSystemStatus(admin)).toMatchObject({ worker: "running", freeGiB: 3, queued: 2, processing: 0, review: 1, failed: 0 });
});
it("distinguishes unavailable checks from healthy zero counts", async () => {
  mocks.query.mockRejectedValue(new Error("offline")); mocks.space.mockRejectedValue(new Error("denied")); mocks.jobs.mockRejectedValue(new Error("offline"));
  expect(await getSystemStatus(admin)).toMatchObject({ database: null, freeGiB: null, queued: null, processing: null, review: null, failed: null });
});
it("never controls the main worker from the isolated test server", async () => {
  vi.stubEnv("VALWEB_TEST_INSTANCE", "1");
  expect(await getImportWorkerStatus()).toBe("unconfigured");
  await expect(restartImportWorker(admin)).rejects.toThrow("no está configurado");
  expect(mocks.exec).not.toHaveBeenCalled();
});
it.each([
  ["LoadState=loaded\nActiveState=active\nSubState=running", "running"],
  ["LoadState=loaded\nActiveState=deactivating\nSubState=stop-sigterm", "restarting"],
  ["LoadState=loaded\nActiveState=failed\nSubState=failed", "stopped"],
  ["LoadState=not-found\nActiveState=inactive\nSubState=dead", "unconfigured"],
])("reports service state without inventing availability: %s", async (output, expected) => {
  mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(null, output));
  expect(await getImportWorkerStatus()).toBe(expected);
});
it("reports unavailable when the service manager cannot be contacted", async () => {
  mocks.exec.mockImplementation((_file, _args, _options, callback) => callback(new Error("no bus"), ""));
  expect(await getImportWorkerStatus()).toBe("unavailable");
});
it.each([null, { ...admin, role: "CLIENT" }])("rejects missing sessions and clients before touching the service", async actor => {
  mocks.actor.mockResolvedValue(actor);
  expect((await restartImportWorkerAction()).status).toBe("error");
  expect(mocks.exec).not.toHaveBeenCalled();
});
it("rechecks the current administrator in the database", async () => {
  mocks.currentActor.mockRejectedValue(new Error("revoked"));
  await expect(restartImportWorker(admin)).rejects.toThrow("revoked");
  expect(mocks.currentActor).toHaveBeenCalledWith({}, admin, true);
  expect(mocks.exec).not.toHaveBeenCalled();
});
it("does not restart a service when globally rate limited", async () => {
  mocks.limit.mockResolvedValue(false);
  await expect(restartImportWorker(admin)).rejects.toThrow("Espera un minuto");
  expect(mocks.exec).toHaveBeenCalledTimes(1);
  expect(mocks.audit).not.toHaveBeenCalled();
});
it("only restarts the fixed import unit and audits the request", async () => {
  expect((await restartImportWorkerAction()).status).toBe("success");
  expect(mocks.exec).toHaveBeenLastCalledWith("systemctl", ["--user", "--no-block", "restart", "valweb-imports.service"], expect.objectContaining({ timeout: 5000 }), expect.any(Function));
  expect(mocks.audit).toHaveBeenCalledWith({ data: { actorId: admin.id, action: "IMPORT_WORKER_RESTART_REQUESTED", metadata: { service: "valweb-imports.service" } } });
  expect(mocks.refresh).toHaveBeenCalledWith("/admin/ajustes");
});
it("does not report success or leak command details if restart fails", async () => {
  mocks.exec.mockImplementationOnce((_file, _args, _options, callback) => callback(null, "LoadState=loaded\nActiveState=inactive\nSubState=dead"))
    .mockImplementationOnce((_file, _args, _options, callback) => callback(new Error("private system error"), ""));
  const state = await restartImportWorkerAction();
  expect(state.status).toBe("error"); expect(state.message).not.toContain("private");
  expect(mocks.refresh).not.toHaveBeenCalled();
});
