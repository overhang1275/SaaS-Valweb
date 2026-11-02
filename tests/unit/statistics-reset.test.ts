import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock("@/features/identity/service", () => ({ currentActor: vi.fn() }));
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/features/identity/service";
import { resetUsageStatistics } from "@/features/statistics/service";

const actor = { id: "b00cfad9-835c-4677-927a-87aa55f82615", role: "ADMIN" as const, tenantId: null, sessionVersion: 0 };
const tenantId = "b0ea44ee-e427-409f-92e0-0bde7dd6acda";
const tx = { validationDailyStat: { deleteMany: vi.fn() }, auditLog: { create: vi.fn() }, tenant: { findUnique: vi.fn() } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation(async (work: unknown) => (work as (tx: unknown) => Promise<unknown>)(tx));
  vi.mocked(currentActor).mockResolvedValue(actor as Awaited<ReturnType<typeof currentActor>>);
  tx.tenant.findUnique.mockResolvedValue({ id: tenantId });
  tx.validationDailyStat.deleteMany.mockResolvedValue({ count: 3 });
});

it("deletes only query history in the selected account and audits the reset", async () => {
  await resetUsageStatistics(actor, tenantId);
  expect(currentActor).toHaveBeenCalledWith(tx, actor, true);
  expect(tx.validationDailyStat.deleteMany).toHaveBeenCalledWith({ where: { tenantId } });
  expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { actorId: actor.id, tenantId, action: "STATISTICS_RESET", metadata: { deletedRows: 3 } } });
});

it("resets all accounts only when no account was requested", async () => {
  await resetUsageStatistics(actor);
  expect(tx.validationDailyStat.deleteMany).toHaveBeenCalledWith({ where: {} });
});

it("rejects malformed or missing accounts without falling back to all accounts", async () => {
  await expect(resetUsageStatistics(actor, "invalid")).rejects.toThrow();
  tx.tenant.findUnique.mockResolvedValue(null);
  await expect(resetUsageStatistics(actor, tenantId)).rejects.toThrow();
  expect(tx.validationDailyStat.deleteMany).not.toHaveBeenCalled();
});

it("does not delete history if the current session lacks admin permission", async () => {
  vi.mocked(currentActor).mockRejectedValue(new Error("No tienes permiso para esta acción."));
  await expect(resetUsageStatistics(actor)).rejects.toThrow("No tienes permiso");
  expect(tx.validationDailyStat.deleteMany).not.toHaveBeenCalled();
});
