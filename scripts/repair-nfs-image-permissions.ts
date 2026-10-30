import dotenv from "dotenv";
import { prisma } from "../src/lib/prisma";
import { openImageStorageRoot } from "../src/features/images/filesystem";
import { repairNfsImageFolders } from "../src/features/images/permissions";

dotenv.config({ quiet: true });

async function main() {
  const groupId = Number(process.argv[2]);
  if (!Number.isInteger(groupId) || groupId < 1000 || groupId > 1999) throw new Error("GID de imágenes inválido.");
  const [location, validations] = await Promise.all([
    prisma.imageStorageLocation.findUnique({ where: { kind: "NFS" } }),
    prisma.validation.findMany({ where: { imageStorageKind: "NFS" }, select: { id: true, tenantId: true } }),
  ]);
  if (!location) { console.log("No hay una raíz NFS configurada; no se modificaron carpetas."); return; }
  const root = await openImageStorageRoot(location.rootPath, "NFS");
  try {
    const result = await repairNfsImageFolders(root, validations.map(row => `${row.tenantId}_${row.id}`), groupId);
    console.log(`Permisos FTP reparados en ${result.repaired} carpetas; ${result.missing} no tenían carpeta existente.`);
  } finally { await root.close(); }
}

main().catch(() => {
  console.error("No se pudieron reparar los permisos NFS. Comprueba el GID de la raíz y que valweb sea propietario de las carpetas.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
