import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { ensureDefaultLocalImageLocation } from "../src/features/images/locations";

async function main() {
  const rootPath = process.env.DEFAULT_LOCAL_IMAGE_ROOT;
  if (!rootPath) throw new Error("DEFAULT_LOCAL_IMAGE_ROOT is required");
  const location = await prisma.$transaction(tx => ensureDefaultLocalImageLocation(tx, rootPath));
  console.info(`Destino LOCAL disponible: ${location.rootPath}`);
}

main().catch(() => {
  console.error("No se pudo preparar el destino LOCAL predeterminado.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
