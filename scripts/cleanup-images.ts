import "dotenv/config";
import { rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { importRoot } from "../src/features/imports/files";
import { purgeManagedOrphanImages, purgeOrphanImages } from "../src/features/images/storage";

try {
  const [shared, records, staged] = await Promise.all([
    prisma.validation.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } }),
    prisma.recordImage.findMany({ select: { storageKey: true } }),
    prisma.importImageItem.findMany({ select: { storageKey: true } }),
  ]);
  const references = new Set([...shared.flatMap(row => row.imageKey ? [row.imageKey] : []), ...records.map(row => row.storageKey), ...staged.map(row => row.storageKey)]);
  const [legacy, managed] = await Promise.all([purgeOrphanImages(references), purgeManagedOrphanImages(references)]);
  const jobs = await prisma.importJob.findMany({ where: { sourceKey: { endsWith: ".directory" }, status: { in: ["COMPLETED", "CANCELLED"] } }, select: { id: true, phase: true, status: true, updatedAt: true } });
  const directory = join(importRoot(), "directory"); let snapshots = 0;
  for (const job of jobs) {
    if ((job.status === "COMPLETED" && job.phase.includes("pendientes de limpieza")) || job.updatedAt.getTime() > Date.now() - 24 * 3600_000) continue;
    const path = join(directory, job.id);
    try { if ((await lstat(path)).isDirectory()) { await rm(path, { recursive: true, force: true }); snapshots++; } }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
  }
  console.info(`Imágenes huérfanas eliminadas: ${legacy + managed}; capturas antiguas eliminadas: ${snapshots}.`);
} catch { console.error("IMAGE_CLEANUP_FAILED"); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
