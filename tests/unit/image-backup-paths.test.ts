import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  root: "/tmp/valweb-backup-root",
  prisma: {
    $queryRaw: vi.fn(), validation: { findMany: vi.fn() }, recordImage: { findMany: vi.fn() },
    importImageItem: { findMany: vi.fn() }, importJob: { findMany: vi.fn() }, imageStorageLocation: { findMany: vi.fn() },
  },
}));
vi.mock("../../src/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../../src/features/images/filesystem", () => ({
  handlePath: () => mocks.root,
  openImageStorageRoot: vi.fn(async () => ({ close: vi.fn() })),
}));
import { openImageStorageRoot } from "../../src/features/images/filesystem";
import { managedImageBackupPaths } from "../../scripts/image-backup-paths";

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "valweb-backup-paths-")); mocks.root = root; });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$queryRaw.mockResolvedValue([{ exists: '"ImageStorageLocation"' }]);
  mocks.prisma.validation.findMany.mockResolvedValue([]);
  mocks.prisma.recordImage.findMany.mockResolvedValue([]);
  mocks.prisma.importImageItem.findMany.mockResolvedValue([]);
  mocks.prisma.importJob.findMany.mockResolvedValue([]);
  mocks.prisma.imageStorageLocation.findMany.mockResolvedValue([]);
});

it("uses only the legacy image path when the new database model is absent", async () => {
  mocks.prisma.$queryRaw.mockResolvedValue([{ exists: null }]);
  expect(await managedImageBackupPaths()).toEqual([]);
  expect(mocks.prisma.imageStorageLocation.findMany).not.toHaveBeenCalled();
});

it("verifies NFS but returns only local managed roots for the installer tar backup", async () => {
  mocks.prisma.validation.findMany.mockResolvedValue([{ imageStorageKind: "NFS" }]);
  mocks.prisma.recordImage.findMany.mockResolvedValue([{ storageKey: "v1:LOCAL:tenant_validation:abc.webp" }]);
  mocks.prisma.imageStorageLocation.findMany.mockResolvedValue([{ kind: "LOCAL", rootPath: "/var/lib/valweb/local" }, { kind: "NFS", rootPath: "/mnt/images" }]);
  expect(await managedImageBackupPaths()).toEqual(["/var/lib/valweb/local"]);
  expect(openImageStorageRoot).toHaveBeenCalledWith("/mnt/images", "NFS");
});

it("fails rather than silently skipping a required but unconfigured root", async () => {
  mocks.prisma.importJob.findMany.mockResolvedValue([{ imageStorageKind: "NFS" }]);
  await expect(managedImageBackupPaths()).rejects.toThrow("Falta configurar el destino NFS");
});
