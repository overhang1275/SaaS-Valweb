import { open, writeFile, unlink, readdir, lstat, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, join, sep } from "node:path";
import { prisma } from "@/lib/prisma";
import { ImageError, MAX_IMAGE_BYTES } from "./limits";
import type { StorageKind, Prisma, ImageStorageLocation } from "@/generated/prisma/client";
import { handlePath, childDirectory, openDirectory, openImageStorageRoot } from "./filesystem";

export type ImageTarget = { kind: StorageKind; tenantId: string; validationId: string };
export function imageTarget(row: { id: string; tenantId: string; imageStorageKind: StorageKind | null }): ImageTarget | undefined {
  return row.imageStorageKind ? { kind: row.imageStorageKind, tenantId: row.tenantId, validationId: row.id } : undefined;
}

const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$/;
const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const destinationPattern = new RegExp(`^v1:(LOCAL|NFS):(${uuid}_${uuid}):(${keyPattern.source.slice(1, -1)})$`);
function root() {
  const directory = resolve(process.env.IMAGE_STORAGE_DIR || join(process.cwd(), "var", "assets"));
  const publicDirectory = resolve(process.cwd(), "public");
  if (directory === publicDirectory || directory.startsWith(`${publicDirectory}${sep}`)) throw new Error("El almacenamiento de imágenes debe estar fuera de public/.");
  return directory;
}
export async function lockImageLocation(tx: Prisma.TransactionClient, kind: StorageKind) {
  await tx.$queryRaw`SELECT kind FROM "ImageStorageLocation" WHERE kind=${kind}::"StorageKind" FOR UPDATE`;
  const location = await tx.imageStorageLocation.findUnique({ where: { kind } });
  if (!location) throw new ImageError(503, "El destino de imágenes no está configurado.");
  return location;
}
async function managedDirectory(location: ImageStorageLocation, destination: RegExpExecArray, create: boolean) {
  let handle = await openImageStorageRoot(location.rootPath, location.kind);
  try {
    for (const part of [destination[2], "procesadas"]) {
      const next = await childDirectory(handle, part, create);
      await handle.close();
      handle = next;
    }
    return { handle, path: join(handlePath(handle), destination[3]) };
  } catch (cause) { await handle.close(); throw cause; }
}
async function imageDirectory(key: string, create = false) {
  if (keyPattern.test(key)) {
    const handle = await openDirectory(root(), create);
    return { handle, path: join(handlePath(handle), key) };
  }
  const destination = destinationPattern.exec(key);
  if (!destination) throw new Error("Clave de imagen no válida.");
  const kind = destination[1] as StorageKind;
  if (!create) {
    const location = await prisma.imageStorageLocation.findUnique({ where: { kind } });
    if (!location) throw new ImageError(503, "El destino de imágenes no está configurado.");
    return managedDirectory(location, destination, false);
  }
  let opened: FileHandle | undefined;
  try {
    // Keep root configuration locked until the validation folder exists and prevents relocation.
    return await prisma.$transaction(async tx => {
      const result = await managedDirectory(await lockImageLocation(tx, kind), destination, true);
      opened = result.handle;
      return result;
    });
  } catch (cause) { await opened?.close(); throw cause; }
}

export async function writeImageFile(data: Buffer, target?: ImageTarget) {
  const filename = `${randomUUID()}.webp`;
  const key = target ? `v1:${target.kind}:${target.tenantId}_${target.validationId}:${filename}` : filename;
  const { handle, path } = await imageDirectory(key, true);
  try { await writeFile(path, data, { flag: "wx", mode: 0o600 }); }
  finally { await handle.close(); }
  return key;
}
export async function readImageFile(key: string) {
  const { handle, path } = await imageDirectory(key);
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new ImageError(413, "El archivo de imagen no es válido o supera los 10 MiB.");
      return await file.readFile();
    } finally { await file.close(); }
  } finally { await handle.close(); }
}
export async function removeImageFile(key: string) {
  try {
    const { handle, path } = await imageDirectory(key);
    try { await unlink(path); } finally { await handle.close(); }
  }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
}

export async function purgeOrphanImages(referenced: Set<string>) {
  // shortcut: destination orphan sweeps are added with managed-storage cleanup; FTP originals must never be swept.
  const handle = await openDirectory(root(), true);
  let removed = 0;
  try {
    for (const entry of await readdir(handlePath(handle), { withFileTypes: true })) {
      if (!entry.isFile() || !keyPattern.test(entry.name) || referenced.has(entry.name)) continue;
      const path = join(handlePath(handle), entry.name);
      const details = await lstat(path);
      if (!details.isFile()) continue;
      if (details.mtimeMs > Date.now() - 24 * 3600_000) continue;
      await unlink(path);
      removed++;
    }
  } finally { await handle.close(); }
  return removed;
}

export async function purgeManagedOrphanImages(referenced: Set<string>) {
  const locations = await prisma.imageStorageLocation.findMany();
  let removed = 0;
  for (const location of locations) {
    const root = await openImageStorageRoot(location.rootPath, location.kind);
    try {
      for (const folderEntry of await readdir(handlePath(root), { withFileTypes: true })) {
        if (!folderEntry.isDirectory() || !/^[a-f0-9-]{36}_[a-f0-9-]{36}$/i.test(folderEntry.name)) continue;
        let folder: FileHandle | undefined, processed: FileHandle | undefined;
        try {
          folder = await childDirectory(root, folderEntry.name, false);
          processed = await childDirectory(folder, "procesadas", false);
          for (const image of await readdir(handlePath(processed), { withFileTypes: true })) {
            if (!image.isFile() || !keyPattern.test(image.name)) continue;
            const key = `v1:${location.kind}:${folderEntry.name}:${image.name}`;
            if (referenced.has(key)) continue;
            const path = join(handlePath(processed), image.name), details = await lstat(path);
            if (!details.isFile() || details.mtimeMs > Date.now() - 24 * 3600_000) continue;
            await unlink(path); removed++;
          }
        } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
        finally { await processed?.close(); await folder?.close(); }
      }
    } finally { await root.close(); }
  }
  return removed;
}
