import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { purgeOrphanImages } from "../src/features/images/storage";

try {
  const [shared, records, staged] = await Promise.all([
    prisma.validation.findMany({ where: { imageKey: { not: null } }, select: { imageKey: true } }),
    prisma.recordImage.findMany({ select: { storageKey: true } }),
    prisma.importImageItem.findMany({ select: { storageKey: true } }),
  ]);
  const references = new Set([...shared.flatMap(row => row.imageKey ? [row.imageKey] : []), ...records.map(row => row.storageKey), ...staged.map(row => row.storageKey)]);
  const removed = await purgeOrphanImages(references);
  console.info(`Imágenes huérfanas eliminadas: ${removed}.`);
} catch { console.error("IMAGE_CLEANUP_FAILED"); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
