import "dotenv/config";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { handlePath, openImageStorageRoot } from "../src/features/images/filesystem";

export async function managedImageBackupPaths() {
  const tables = await prisma.$queryRaw<Array<{ exists: string | null }>>`SELECT to_regclass('public."ImageStorageLocation"')::text AS exists`;
  if (!tables[0]?.exists) return []; // Older installations use only IMAGE_STORAGE_DIR.
  const [validations, records, staged, jobs, locations] = await Promise.all([
    prisma.validation.findMany({ where: { imageStorageKind: { not: null } }, distinct: ["imageStorageKind"], select: { imageStorageKind: true } }),
    prisma.recordImage.findMany({ select: { storageKey: true } }),
    prisma.importImageItem.findMany({ select: { storageKey: true } }),
    prisma.importJob.findMany({ where: { imageStorageKind: { not: null } }, distinct: ["imageStorageKind"], select: { imageStorageKind: true } }),
    prisma.imageStorageLocation.findMany(),
  ]);
  const used = new Set<string>();
  for (const row of [...validations, ...jobs]) if (row.imageStorageKind) used.add(row.imageStorageKind);
  for (const row of [...records, ...staged]) { const kind = /^v1:(LOCAL|NFS):/.exec(row.storageKey)?.[1]; if (kind) used.add(kind); }
  const roots: string[] = [];
  for (const kind of used) {
    const location = locations.find(row => row.kind === kind);
    if (!location) throw new Error(`Falta configurar el destino ${kind} que utiliza Valweb.`);
    const root = await openImageStorageRoot(location.rootPath, location.kind);
    try { await access(handlePath(root), constants.R_OK | constants.X_OK); }
    finally { await root.close(); }
    roots.push(resolve(location.rootPath));
  }
  return roots.sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await managedImageBackupPaths())); }
  catch { console.error("No se pudo verificar un destino de imágenes requerido para el respaldo."); process.exitCode = 1; }
  finally { await prisma.$disconnect(); }
}
