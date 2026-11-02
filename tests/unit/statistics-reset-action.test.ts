import { beforeEach, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getActor: vi.fn() }));
vi.mock("@/features/identity/rate-limit", () => ({ limitRequest: vi.fn() }));
vi.mock("@/features/statistics/service", () => ({ resetUsageStatistics: vi.fn() }));
import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth";
import { limitRequest } from "@/features/identity/rate-limit";
import { resetUsageStatistics } from "@/features/statistics/service";
import { resetStatisticsAction } from "@/app/actions";
import { initialActionState } from "@/lib/action-state";

const actor = { id: "b00cfad9-835c-4677-927a-87aa55f82615", role: "ADMIN" as const, tenantId: null, sessionVersion: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActor).mockResolvedValue(actor);
  vi.mocked(limitRequest).mockResolvedValue(true);
});

it("rejects missing sessions, clients and rate limited requests", async () => {
  for (const user of [null, { ...actor, role: "CLIENT" as const, tenantId: actor.id }]) {
    vi.mocked(getActor).mockResolvedValue(user);
    expect((await resetStatisticsAction(initialActionState, new FormData())).status).toBe("error");
  }
  vi.mocked(getActor).mockResolvedValue(actor);
  vi.mocked(limitRequest).mockResolvedValue(false);
  expect((await resetStatisticsAction(initialActionState, new FormData())).status).toBe("error");
  expect(resetUsageStatistics).not.toHaveBeenCalled();
});

it("passes the selected account and refreshes both statistics views", async () => {
  const form = new FormData();
  form.set("tenantId", actor.id);
  expect((await resetStatisticsAction(initialActionState, form)).status).toBe("success");
  expect(resetUsageStatistics).toHaveBeenCalledWith(actor, actor.id);
  expect(revalidatePath).toHaveBeenCalledWith("/estadisticas");
  expect(revalidatePath).toHaveBeenCalledWith("/validaciones", "layout");
});

it("rejects invalid accounts and reports deletion failures without claiming success", async () => {
  const form = new FormData();
  form.set("tenantId", "invalid");
  expect((await resetStatisticsAction(initialActionState, form)).status).toBe("error");
  expect(resetUsageStatistics).not.toHaveBeenCalled();
  vi.mocked(resetUsageStatistics).mockRejectedValue(new Error("database failed"));
  expect((await resetStatisticsAction(initialActionState, new FormData())).status).toBe("error");
  expect(revalidatePath).not.toHaveBeenCalled();
});
