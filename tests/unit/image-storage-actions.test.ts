import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/lib/auth", () => ({ getActor: vi.fn() }));
vi.mock("../../src/features/identity/rate-limit", () => ({ limitRequest: vi.fn() }));
vi.mock("../../src/features/images/locations", () => ({ saveGlobalImageLocation: vi.fn(), selectValidationImageStorage: vi.fn(), createValidationImageFolder: vi.fn(), repairConfiguredNfsImageFolders: vi.fn() }));
import { getActor } from "../../src/lib/auth";
import { limitRequest } from "../../src/features/identity/rate-limit";
import { saveGlobalImageLocation, selectValidationImageStorage, createValidationImageFolder, repairConfiguredNfsImageFolders } from "../../src/features/images/locations";
import { saveGlobalImageLocationAction, selectValidationImageStorageAction, createValidationImageFolderAction, repairConfiguredNfsImageFoldersAction } from "../../src/features/images/actions";
import { initialActionState } from "../../src/lib/action-state";

const actor = { id: "60cdd814-f7dd-452c-a4f0-1c7fb2b05942", role: "ADMIN" as const, tenantId: null, sessionVersion: 0 };
function form() {
  const value = new FormData();
  value.set("id", "209f7990-f3fa-4c53-aaab-980d477c6ab3"); value.set("kind", "LOCAL"); value.set("rootPath", "/srv/valweb");
  return value;
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(getActor).mockResolvedValue(actor); vi.mocked(limitRequest).mockResolvedValue(true); });
it("requires a session for every storage mutation", async () => {
  vi.mocked(getActor).mockResolvedValue(null);
  for (const action of [saveGlobalImageLocationAction, selectValidationImageStorageAction, createValidationImageFolderAction, repairConfiguredNfsImageFoldersAction]) {
    expect(await action(initialActionState, form())).toMatchObject({ status: "error", message: expect.stringContaining("Inicia sesión") });
  }
  expect(saveGlobalImageLocation).not.toHaveBeenCalled(); expect(selectValidationImageStorage).not.toHaveBeenCalled(); expect(createValidationImageFolder).not.toHaveBeenCalled(); expect(repairConfiguredNfsImageFolders).not.toHaveBeenCalled();
});
it("denies global configuration to a client and bounds repeated operations", async () => {
  vi.mocked(getActor).mockResolvedValue({ ...actor, role: "CLIENT", tenantId: actor.id });
  expect((await saveGlobalImageLocationAction(initialActionState, form())).status).toBe("error");
  expect(saveGlobalImageLocation).not.toHaveBeenCalled();
  vi.mocked(limitRequest).mockResolvedValue(false);
  expect((await createValidationImageFolderAction(initialActionState, form())).message).toContain("demasiadas operaciones");
  expect(createValidationImageFolder).not.toHaveBeenCalled();
});
it("validates the selected destination and hides raw filesystem failures", async () => {
  const invalid = form(); invalid.set("kind", "../../etc");
  expect((await selectValidationImageStorageAction(initialActionState, invalid)).status).toBe("error");
  expect(selectValidationImageStorage).not.toHaveBeenCalled();
  vi.mocked(createValidationImageFolder).mockRejectedValue(new Error("EACCES /private/server/directory"));
  const result = await createValidationImageFolderAction(initialActionState, form());
  expect(result.status).toBe("error"); expect(result.message).not.toContain("/private/");
});

it("allows only administrators to repair configured NFS folder permissions", async () => {
  vi.mocked(repairConfiguredNfsImageFolders).mockResolvedValue({ repaired: 2, missing: 1 });
  expect(await repairConfiguredNfsImageFoldersAction(initialActionState, form())).toMatchObject({ status: "success" });
  expect(repairConfiguredNfsImageFolders).toHaveBeenCalledWith(actor);
  vi.mocked(getActor).mockResolvedValue({ ...actor, role: "CLIENT", tenantId: actor.id });
  expect(await repairConfiguredNfsImageFoldersAction(initialActionState, form())).toMatchObject({ status: "error" });
  expect(repairConfiguredNfsImageFolders).toHaveBeenCalledTimes(1);
});
